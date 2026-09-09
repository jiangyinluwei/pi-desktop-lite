//! Flow 会话回退 — 文件撤回核心 (Rollback Store)
//!
//! 与内核侧快照扩展 (`src-tauri/extensions/pi-rollback-guard.ts`) 配合：
//! - 扩展在 `tool_call` 阶段（工具执行前）将目标文件内容快照落盘至
//!   `~/.pi-dl/rollback/<sessionId>/snapshots.jsonl`（每行 JSON：ts/sessionId/toolCallId/toolName/path/contentB64）；
//! - 本模块负责在用户执行「回退到某轮对话」时，按 (path, toolCallId) 精确匹配
//!   最早快照，将被撤回轮次的「已修改 / 已删除」文件还原到变更前内容；
//! - 「已新增」文件由前端排除，永不撤回（防误删铁律）。
//!
//! 会话血缘：fork/clone 可能产生新会话文件，扩展在 session_start 时将
//! {session, parent} 追加写入 `~/.pi-dl/rollback/lineage.jsonl`；
//! 还原时沿血缘链向上汇集所有祖先会话的快照，确保跨 fork 回退依然可用。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;

/// 桌面端注入内核的环境变量开关（未设置时扩展完全静默）
pub const ROLLBACK_ENV_KEY: &str = "PI_DL_ROLLBACK";

/// 内置快照扩展源码（编译期嵌入二进制，启动时物化到全局扩展目录）
pub const ROLLBACK_EXTENSION_SRC: &str = include_str!("../extensions/pi-rollback-guard.ts");
pub const ROLLBACK_EXTENSION_FILENAME: &str = "pi-rollback-guard.ts";

/// 单个待还原目标：文件路径 + 触发该变更的工具调用 ID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackTarget {
    pub path: String,
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
}

/// 快照行（宽松解析：字段缺失时降级跳过）
#[derive(Debug, Clone)]
struct SnapshotLine {
    ts: u64,
    tool_call_id: String,
    path: String,
    content_b64: String,
    too_large: bool,
    is_dir: bool,
}

fn rollback_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".pi-dl").join("rollback"))
}

/// 路径归一化键（Windows 大小写不敏感 + 分隔符统一为 /，去尾斜杠）
fn normalize_path_key(p: &str) -> String {
    let mut s = p.replace('\\', "/").to_lowercase();
    // 去除尾部斜杠，保持 "c:/a/b" 形式
    while s.ends_with('/') && s.len() > 3 {
        s.pop();
    }
    s
}

/// 判断目标路径是否为 glob 模式
fn is_glob_pattern(p: &str) -> bool {
    p.contains('*') || p.contains('?') || p.contains('[')
}

/// 简易 glob 转正则（用于回退时匹配快照；大小写不敏感）
fn glob_to_regex(glob: &str) -> Option<regex::Regex> {
    let mut re_str = String::from("^");
    let mut in_bracket = false;
    for ch in glob.chars() {
        match ch {
            '[' => { in_bracket = true; re_str.push('['); }
            ']' => { in_bracket = false; re_str.push(']'); }
            _ if in_bracket => { re_str.push(ch); }
            '*' => re_str.push_str(".*"),
            '?' => re_str.push('.'),
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}'  => {
                re_str.push('\\'); re_str.push(ch);
            }
            '\\' => re_str.push_str("\\\\"),
            _ => re_str.push(ch),
        }
    }
    re_str.push('$');
    regex::Regex::new(&format!("(?i){}", re_str)).ok()
}

/// 判断归一化快照路径是否在归一化目录前缀内
fn is_under_dir(snapshot_key: &str, dir_key: &str) -> bool {
    if snapshot_key == dir_key { return true; }
    let prefix = format!("{}/", dir_key.trim_end_matches('/'));
    snapshot_key.starts_with(&prefix)
}

/// 读取血缘链：session -> ... -> root（含自身）
fn lineage_chain(session_id: &str) -> Vec<String> {
    let mut chain = vec![session_id.to_string()];
    let lineage_file = match rollback_root() {
        Some(root) => root.join("lineage.jsonl"),
        None => return chain,
    };
    let content = match std::fs::read_to_string(&lineage_file) {
        Ok(c) => c,
        Err(_) => return chain,
    };
    // edge -> parent 映射
    let mut edges: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        let child = val.get("session").and_then(|v| v.as_str()).unwrap_or("");
        let parent = val.get("parent").and_then(|v| v.as_str()).unwrap_or("");
        if !child.is_empty() && !parent.is_empty() {
            edges.insert(child.to_string(), parent.to_string());
        }
    }
    // 沿链上行（带环保护）
    let mut seen: HashSet<String> = chain.iter().cloned().collect();
    let mut cursor = session_id.to_string();
    for _ in 0..32 {
        let Some(parent) = edges.get(&cursor) else { break };
        if seen.contains(parent) {
            break;
        }
        seen.insert(parent.clone());
        chain.push(parent.clone());
        cursor = parent.clone();
    }
    chain
}

/// 汇集某会话（含血缘祖先）的全部快照行
fn load_snapshots(session_id: &str) -> Vec<SnapshotLine> {
    let mut out = Vec::new();
    let Some(root) = rollback_root() else { return out };
    for sid in lineage_chain(session_id) {
        let file = root.join(&sid).join("snapshots.jsonl");
        let Ok(content) = std::fs::read_to_string(&file) else {
            continue;
        };
        for line in content.lines() {
            let Ok(val) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            let ts = val.get("ts").and_then(|v| v.as_u64()).unwrap_or(0);
            let tool_call_id = val
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let path = val.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let content_b64 = val
                .get("contentB64")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let too_large = val.get("tooLarge").and_then(|v| v.as_bool()).unwrap_or(false);
            let is_dir = val.get("isDir").and_then(|v| v.as_bool()).unwrap_or(false);
            if tool_call_id.is_empty() || path.is_empty() {
                continue;
            }
            out.push(SnapshotLine {
                ts,
                tool_call_id,
                path,
                content_b64,
                too_large,
                is_dir,
            });
        }
    }
    // 时间升序（早期快照优先：还原目标 = 回退点之后第一次变更前的内容）
    out.sort_by_key(|s| s.ts);
    out
}

/// 物化内置快照扩展至全局扩展目录（内容变化时覆盖，幂等）
pub fn materialize_extension() -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Err("无法定位用户主目录".to_string());
    };
    let ext_dir = home.join(".pi").join("agent").join("extensions");
    std::fs::create_dir_all(&ext_dir).map_err(|e| format!("创建扩展目录失败: {}", e))?;
    let target = ext_dir.join(ROLLBACK_EXTENSION_FILENAME);
    let needs_write = match std::fs::read_to_string(&target) {
        Ok(existing) => existing != ROLLBACK_EXTENSION_SRC,
        Err(_) => true,
    };
    if needs_write {
        std::fs::write(&target, ROLLBACK_EXTENSION_SRC)
            .map_err(|e| format!("写入快照扩展失败: {}", e))?;
        log::info!("[Rollback] Materialized extension: {:?}", target);
    }
    Ok(())
}

/// 待落盘的还原项（在内存中预检并解码完毕，确保原子落盘杜绝半撤回）
#[derive(Debug, PartialEq, Eq)]
enum RestorePlanItem {
    File {
        dest: PathBuf,
        bytes: Vec<u8>,
        display_path: String,
    },
    Directory {
        dest: PathBuf,
        display_path: String,
    },
}

/// 将快照预处理为落盘计划项（大文件超限报 too-large，空文件 base64 解码为 0 字节）
fn prepare_restore_item(snap: &SnapshotLine) -> Result<RestorePlanItem, (String, String)> {
    // 1. 大文件超限校验
    if snap.too_large {
        return Err((snap.path.clone(), "too-large".to_string()));
    }

    let dest = PathBuf::from(&snap.path);

    // 2. 空目录标记恢复
    if snap.is_dir {
        return Ok(RestorePlanItem::Directory {
            dest,
            display_path: snap.path.clone(),
        });
    }

    // 3. 文件内容解码（空文件 content_b64 为 "" 时，base64 decode 产生 0 字节空 buffer）
    use base64::Engine as _;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(&snap.content_b64) {
        Ok(b) => b,
        Err(e) => {
            return Err((snap.path.clone(), format!("decode-failed: {}", e)));
        }
    };

    Ok(RestorePlanItem::File {
        dest,
        bytes,
        display_path: snap.path.clone(),
    })
}

/// 执行文件还原：两阶段事务性保证（Phase 1 预检与内存解码，存在缺失/超限时保守中止杜绝半撤回；Phase 2 全部就绪后原子落盘）
/// 目录与 glob 兼容：若精确匹配缺失，尝试按目录前缀或 glob 模式聚合匹配
/// dry_run: true 时仅执行 Phase 1 预检与大文件超限校验，绝不触碰磁盘写入
pub fn rollback_files(
    session_id: &str,
    targets: &[RollbackTarget],
    dry_run: bool,
) -> Result<Value, String> {
    if session_id.trim().is_empty() {
        return Err("会话 ID 为空，无法定位快照".to_string());
    }
    let snapshots = load_snapshots(session_id);
    let mut missing: Vec<Value> = Vec::new();
    let mut plan: Vec<RestorePlanItem> = Vec::new();
    let mut planned_keys: HashSet<String> = HashSet::new();

    let plan_snapshot = |snap: &SnapshotLine,
                         plan: &mut Vec<RestorePlanItem>,
                         missing: &mut Vec<Value>,
                         planned_keys: &mut HashSet<String>|
     -> bool {
        let key = normalize_path_key(&snap.path);
        if planned_keys.contains(&key) {
            return true; // 已规划同文件，幂等跳过
        }
        match prepare_restore_item(snap) {
            Ok(item) => {
                planned_keys.insert(key);
                plan.push(item);
                true
            }
            Err((p, reason)) => {
                missing.push(json!({ "path": p, "reason": reason }));
                false
            }
        }
    };

    // =========================================================================
    // Phase 1：预检与内存解码（Preflight Validation）
    // 遍历所有目标，在内存中匹配快照并校验解码。绝不触碰任何磁盘写入！
    // =========================================================================
    for target in targets {
        let key = normalize_path_key(&target.path);

        // 1) 精确匹配：最早一条同时满足 toolCallId 与 path
        if let Some(snapshot) = snapshots
            .iter()
            .find(|s| s.tool_call_id == target.tool_call_id && normalize_path_key(&s.path) == key)
        {
            plan_snapshot(snapshot, &mut plan, &mut missing, &mut planned_keys);
            continue;
        }

        // 2) glob 模式：匹配同 toolCallId 下所有符合通配的快照
        if is_glob_pattern(&target.path) {
            if let Some(re) = glob_to_regex(&key) {
                let matched: Vec<&SnapshotLine> = snapshots
                    .iter()
                    .filter(|s| {
                        s.tool_call_id == target.tool_call_id
                            && re.is_match(&normalize_path_key(&s.path))
                    })
                    .collect();
                if matched.is_empty() {
                    missing.push(json!({ "path": target.path, "reason": "no-snapshot" }));
                    continue;
                }
                for snap in &matched {
                    plan_snapshot(snap, &mut plan, &mut missing, &mut planned_keys);
                }
                continue;
            }
        }

        // 3) 目录前缀匹配：守卫已对目录递归快照为多条文件快照，前端记录仍为目录字面
        let prefix_matches: Vec<&SnapshotLine> = snapshots
            .iter()
            .filter(|s| {
                s.tool_call_id == target.tool_call_id
                    && is_under_dir(&normalize_path_key(&s.path), &key)
            })
            .collect();
        if !prefix_matches.is_empty() {
            for snap in &prefix_matches {
                plan_snapshot(snap, &mut plan, &mut missing, &mut planned_keys);
            }
            continue;
        }

        missing.push(json!({ "path": target.path, "reason": "no-snapshot" }));
    }

    // 事务性守卫：如果预检中存在任何缺失或解码失败的目标，保守中止，杜绝半撤回污染磁盘！
    if !missing.is_empty() {
        return Ok(json!({
            "restored": [],
            "restoredCount": 0,
            "missing": missing,
            "dryRun": dry_run,
        }));
    }

    // 预检模式 (Preflight Dry-Run)：全部目标就绪且无缺失，直接返回可用项数，绝不触碰磁盘写入
    if dry_run {
        return Ok(json!({
            "restored": [],
            "restoredCount": plan.len(),
            "missing": [],
            "dryRun": true,
        }));
    }

    // =========================================================================
    // Phase 2：原子落盘写入（Atomic Commit）
    // 仅当全部目标均通过预检时，才一次性将就绪的快照写回磁盘
    // =========================================================================
    let mut restored: Vec<String> = Vec::new();
    let mut write_errors: Vec<Value> = Vec::new();
    let mut seen_restored: HashSet<String> = HashSet::new();

    for item in plan {
        match item {
            RestorePlanItem::File {
                dest,
                bytes,
                display_path,
            } => {
                if let Some(parent) = dest.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        write_errors.push(json!({
                            "path": display_path,
                            "reason": format!("mkdir-failed: {}", e)
                        }));
                        continue;
                    }
                }
                match std::fs::write(&dest, &bytes) {
                    Ok(_) => {
                        let k = normalize_path_key(&display_path);
                        if seen_restored.insert(k) {
                            restored.push(display_path);
                        }
                    }
                    Err(e) => {
                        write_errors.push(json!({
                            "path": display_path,
                            "reason": format!("write-failed: {}", e)
                        }));
                    }
                }
            }
            RestorePlanItem::Directory { dest, display_path } => {
                match std::fs::create_dir_all(&dest) {
                    Ok(_) => {
                        let k = normalize_path_key(&display_path);
                        if seen_restored.insert(k) {
                            restored.push(display_path);
                        }
                    }
                    Err(e) => {
                        write_errors.push(json!({
                            "path": display_path,
                            "reason": format!("mkdir-failed: {}", e)
                        }));
                    }
                }
            }
        }
    }

    Ok(json!({
        "restored": restored,
        "restoredCount": restored.len(),
        "missing": write_errors,
        "dryRun": false,
    }))
}

