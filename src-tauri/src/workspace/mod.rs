// ==========================================================================
// 多预设工作区模块 (Workspace Presets & Runtime Materialization)
//
// 双轨模型：
//   - 内置预设 = 只读模板（打包进资源目录，与 default-area 同级）
//   - 运行时   = 用户目录副本（~/.pi-dl/workspaces/<id>/，可写，绝不覆盖）
//
// default-area 特殊处理：保持 ~/.pi-dl/default-area 路径不变，已用用户数据
// 零迁移、零覆盖；其余预设首次选中时整目录复制模板，已存在则直接返回。
//
// code-area 路由工作区：
//   - 物理 CWD 依然锁定在 code-area（确保全局编码技能集可原生感知）；
//   - 针对具体需求必须绑定路由目标项目，所有代码读写/命令执行均重定向至目标项目。
// ==========================================================================

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::config_manager::{read_pi_dl_json, write_pi_dl_json};

/// 工作区预设元数据（pi_list_workspaces 返回结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub template_path: String,
    pub runtime_path: Option<String>,
    pub is_active: bool,
    pub is_runtime_ready: bool,
    pub requires_route: bool,
    pub route_path: Option<String>,
}

/// code-area 内置编码技能元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAreaSkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
}

/// 命中映射的目标路由项目 Skill
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MatchedSkillInfo {
    pub id: String,
    pub name: String,
    pub source: String,
    pub content: String,
}

/// 目标路由项目规约与文档读取结果
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoutedWorkspaceDocContext {
    pub agents_md: Option<(String, String)>,
    pub readme_md: Option<(String, String)>,
    pub matched_skills: Vec<MatchedSkillInfo>,
}

/// 模板根目录候选（多层寻址，与 find_pi_binary 同源思路）
fn template_roots(app_handle: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    // 1. Tauri Resource 目录（安装版 / Release，default-area 与各预设同级）
    if let Some(app) = app_handle {
        if let Ok(resource_dir) = app.path().resource_dir() {
            roots.push(resource_dir.clone());
        }
    }

    // 2. exe 所在目录及 resources 子目录（便携 / 绿色版）
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            roots.push(exe_dir.join("resources"));
            roots.push(exe_dir.to_path_buf());
        }
    }

    // 3. 开发模式仓库根：<cwd>、<cwd>/../、src-tauri/../（覆盖 npm run dev 与 cargo run 两种工作目录）
    if let Ok(curr_dir) = std::env::current_dir() {
        roots.push(curr_dir.clone());
        roots.push(curr_dir.join(".."));
        roots.push(curr_dir.join("..").join(".."));
    }

    roots
}

/// 收集全部预设模板目录（按 id 去重，首个命中生效），返回 (id, 模板目录)
fn collect_template_dirs(app_handle: &AppHandle) -> Vec<(String, PathBuf)> {
    let mut result: Vec<(String, PathBuf)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for root in template_roots(Some(app_handle)) {
        // 1. default-area（默认预设，无 workspace.json，显式处理）
        let default_dir = root.join("default-area");
        if default_dir.is_dir() && !seen.contains("default-area") {
            seen.insert("default-area".to_string());
            result.push(("default-area".to_string(), default_dir));
        }

        // 2. workspaces/<id>/（仓库开发布局）
        let workspaces_root = root.join("workspaces");
        if let Ok(entries) = fs::read_dir(&workspaces_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && p.join("workspace.json").is_file() {
                    if let Some(id) = p.file_name().and_then(|n| n.to_str()) {
                        if !seen.contains(id) {
                            seen.insert(id.to_string());
                            result.push((id.to_string(), p));
                        }
                    }
                }
            }
        }

        // 3. root/<id>/（打包后与 default-area 同级，通过 workspace.json 识别）
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.flatten() {
                let p = entry.path();
                let name_str = entry.file_name().to_string_lossy().to_string();
                if p.is_dir()
                    && name_str != "workspaces"
                    && name_str != "default-area"
                    && p.join("workspace.json").is_file()
                {
                    if let Some(id) = entry.file_name().to_str() {
                        if !seen.contains(id) {
                            seen.insert(id.to_string());
                            result.push((id.to_string(), p));
                        }
                    }
                }
            }
        }
    }

    result
}

/// 按 id 查找模板目录
pub fn find_template_dir(app_handle: &AppHandle, id: &str) -> Option<PathBuf> {
    collect_template_dirs(app_handle)
        .into_iter()
        .find(|(i, _)| i == id)
        .map(|(_, p)| p)
}

/// 运行时工作区根目录 (~/.pi-dl)
fn get_pi_dl_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".pi-dl"))
        .unwrap_or_else(|| PathBuf::from(".pi-dl"))
}

/// 计算某预设的运行时工作区路径（default-area 沿用旧路径，其余在 ~/.pi-dl/workspaces/<id>/）
pub fn runtime_workspace_path(id: &str) -> PathBuf {
    let pi_dl_dir = get_pi_dl_dir();
    if id == "default-area" {
        pi_dl_dir.join("default-area")
    } else {
        pi_dl_dir.join("workspaces").join(id)
    }
}

/// 递归复制目录（不跟随符号链接，保持相对结构）
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {:?}: {}", dst, e))?;
    let entries = fs::read_dir(src).map_err(|e| format!("读取模板目录失败 {:?}: {}", src, e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target)
                .map_err(|e| format!("复制文件失败 {:?} -> {:?}: {}", path, target, e))?;
        }
    }
    Ok(())
}

/// 确保某预设的运行时副本存在：
/// - default-area → 直接返回 ~/.pi-dl/default-area（沿用既有播种逻辑）
/// - 其他 → 目标 ~/.pi-dl/workspaces/<id>/；不存在则整目录复制模板；已存在绝不覆盖
pub fn ensure_runtime_workspace(id: &str, template: &Path) -> Result<PathBuf, String> {
    let target = runtime_workspace_path(id);

    if id == "default-area" {
        // 沿用现有播种逻辑（仅创建目录，种子内容由 PiSupervisor::get_default_workspace 维护）
        fs::create_dir_all(&target)
            .map_err(|e| format!("创建默认工作区目录失败 {:?}: {}", target, e))?;
        return Ok(target);
    }

    if target.is_dir() {
        // 升级或再次选中：副本已存在，绝不覆盖用户数据
        return Ok(target);
    }

    if !template.is_dir() {
        return Err(format!("工作区模板不存在: {:?}", template));
    }

    copy_dir_recursive(template, &target)?;

    // 回写 AGENTS.md（模板已含则保留，缺失时播种最小运行时约束）
    let agents_md = target.join("AGENTS.md");
    if !agents_md.exists() {
        let seed = format!(
            "# Pi Agent 运行时工作区指南 (AGENTS.md)\n\n欢迎使用 **Pi Desktop Lite** 工作区 (`{}`)。\n",
            id
        );
        let _ = fs::write(&agents_md, seed);
    }

    Ok(target)
}

/// 读取 ~/.pi-dl/config.json 中的 workspace 对象
pub fn read_workspace_config() -> serde_json::Map<String, Value> {
    if let Ok(config) = read_pi_dl_json("config.json", json!({})) {
        if let Some(obj) = config.get("workspace").and_then(|w| w.as_object()) {
            return obj.clone();
        }
    }
    serde_json::Map::new()
}

/// 读取 ~/.pi-dl/config.json 中 workspace.activeId（缺省或非法时回退 default-area）
pub fn read_active_workspace_id() -> String {
    let ws = read_workspace_config();
    if let Some(id) = ws.get("activeId").and_then(|v| v.as_str()) {
        if !id.trim().is_empty() {
            return id.to_string();
        }
    }
    "default-area".to_string()
}

/// 写入 ~/.pi-dl/config.json 的 workspace.activeId（浅合并，保留其余字段）
pub fn write_active_workspace_id(id: &str) -> Result<(), String> {
    let mut config = read_pi_dl_json("config.json", json!({})).unwrap_or_else(|_| json!({}));
    if !config.is_object() {
        config = json!({});
    }
    let obj = config.as_object_mut().unwrap();
    let ws_val = obj.entry("workspace".to_string()).or_insert_with(|| json!({}));
    if !ws_val.is_object() {
        *ws_val = json!({});
    }
    let ws_obj = ws_val.as_object_mut().unwrap();
    ws_obj.insert("activeId".to_string(), json!(id));

    write_pi_dl_json("config.json", &config)
}

/// 校验并自愈清理 code-area 的当前路由目标与历史记录：
/// 检查当前选择的路由路径与历史列表是否真实存在于文件系统，
/// 若不存在则自动从配置中清除并持久化，返回 (清理后的有效当前路径, 清理后的有效历史列表)
pub fn validate_and_cleanup_code_area_routes() -> (Option<String>, Vec<String>) {
    let mut config = read_pi_dl_json("config.json", json!({})).unwrap_or_else(|_| json!({}));
    if !config.is_object() {
        return (None, Vec::new());
    }

    let mut changed = false;
    let (mut current_path, mut history) = if let Some(ws) = config.get("workspace").and_then(|w| w.as_object()) {
        let curr = ws.get("codeAreaRoutePath")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().replace('\\', "/"))
            .filter(|s| !s.is_empty());
        let hist: Vec<String> = ws.get("codeAreaRouteHistory")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().replace('\\', "/")))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        (curr, hist)
    } else {
        (None, Vec::new())
    };

    // 1. 校验当前选择的路由工作区是否存在
    if let Some(ref p) = current_path {
        let exists = Path::new(p).is_dir();
        if !exists {
            log::info!("[Workspace] code-area route path no longer exists, clearing: {}", p);
            current_path = None;
            changed = true;
        }
    }

    // 2. 校验历史记录列表，剔除不存在的项目
    let original_hist_len = history.len();
    history.retain(|p| Path::new(p).is_dir());
    if history.len() != original_hist_len {
        log::info!(
            "[Workspace] Cleared {} invalid code-area route history entries",
            original_hist_len - history.len()
        );
        changed = true;
    }

    // 3. 若发生变更，持久化写回 config.json
    if changed {
        if let Some(ws_val) = config.get_mut("workspace") {
            if let Some(ws_obj) = ws_val.as_object_mut() {
                if let Some(ref p) = current_path {
                    ws_obj.insert("codeAreaRoutePath".to_string(), json!(p));
                } else {
                    ws_obj.remove("codeAreaRoutePath");
                }
                ws_obj.insert("codeAreaRouteHistory".to_string(), json!(history));
                let _ = write_pi_dl_json("config.json", &config);
            }
        }
    }

    (current_path, history)
}

/// 读取 code-area 绑定的路由工作区路径（自动检验存在性，不存在自动清除）
pub fn read_code_area_route_path() -> Option<String> {
    validate_and_cleanup_code_area_routes().0
}

/// 读取 code-area 的路由历史列表（自动检验存在性，剔除失效历史）
pub fn read_code_area_route_history() -> Vec<String> {
    validate_and_cleanup_code_area_routes().1
}

/// 写入 code-area 绑定的路由工作区路径与历史记录
pub fn write_code_area_route_path(route_path: &str) -> Result<(), String> {
    let path_str = route_path.trim().replace('\\', "/");
    let mut config = read_pi_dl_json("config.json", json!({})).unwrap_or_else(|_| json!({}));
    if !config.is_object() {
        config = json!({});
    }
    let obj = config.as_object_mut().unwrap();
    let ws_val = obj.entry("workspace".to_string()).or_insert_with(|| json!({}));
    if !ws_val.is_object() {
        *ws_val = json!({});
    }
    let ws_obj = ws_val.as_object_mut().unwrap();
    ws_obj.insert("codeAreaRoutePath".to_string(), json!(path_str));

    // 更新历史记录（按最近使用去重排序，最多保留 10 项）
    let mut history: Vec<String> = ws_obj
        .get("codeAreaRouteHistory")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.replace('\\', "/")))
                .collect()
        })
        .unwrap_or_default();

    history.retain(|p| !p.eq_ignore_ascii_case(&path_str));
    if !path_str.is_empty() {
        history.insert(0, path_str);
    }
    if history.len() > 10 {
        history.truncate(10);
    }
    ws_obj.insert("codeAreaRouteHistory".to_string(), json!(history));

    write_pi_dl_json("config.json", &config)
}

/// 扫描 code-area 运行态或模板目录下的内置技能清单
pub fn list_code_area_skills(app_handle: &AppHandle) -> Vec<CodeAreaSkillInfo> {
    let mut skills = Vec::new();
    let mut candidate_dirs = Vec::new();

    // 1. 优先扫描运行时副本 ~/.pi-dl/workspaces/code-area/.agents/skills
    let runtime_skills = runtime_workspace_path("code-area").join(".agents").join("skills");
    if runtime_skills.is_dir() {
        candidate_dirs.push(runtime_skills);
    }

    // 2. 扫描模板目录 workspaces/code-area/.agents/skills
    if let Some(template) = find_template_dir(app_handle, "code-area") {
        let tmpl_skills = template.join(".agents").join("skills");
        if tmpl_skills.is_dir() {
            candidate_dirs.push(tmpl_skills);
        }
    }

    let mut seen_ids = HashSet::new();
    for skills_dir in candidate_dirs {
        if let Ok(entries) = fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let skill_folder = entry.path();
                if skill_folder.is_dir() {
                    let skill_file = skill_folder.join("SKILL.md");
                    if skill_file.is_file() {
                        let id = skill_folder
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or_default()
                            .to_string();

                        if !id.is_empty() && seen_ids.insert(id.clone()) {
                            let (name, desc) = parse_skill_meta(&skill_file, &id);
                            skills.push(CodeAreaSkillInfo {
                                id,
                                name,
                                description: desc,
                                path: skill_folder.to_string_lossy().to_string().replace('\\', "/"),
                            });
                        }
                    }
                }
            }
        }
    }

    skills
}

/// 解析 SKILL.md 中的 frontmatter 元数据（name 与 description）
fn parse_skill_meta(skill_file: &Path, default_id: &str) -> (String, String) {
    if let Ok(content) = fs::read_to_string(skill_file) {
        let mut name = String::new();
        let mut desc = String::new();

        let mut in_frontmatter = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == "---" {
                if in_frontmatter {
                    break;
                } else {
                    in_frontmatter = true;
                    continue;
                }
            }

            if in_frontmatter {
                if let Some(val) = trimmed.strip_prefix("name:") {
                    name = val.trim().to_string();
                } else if let Some(val) = trimmed.strip_prefix("description:") {
                    desc = val.trim().to_string();
                }
            }
        }

        let final_name = if !name.is_empty() {
            name
        } else {
            humanize_id(default_id)
        };

        let final_desc = if !desc.is_empty() {
            desc
        } else {
            read_readme_first_paragraph(&skill_file.parent().unwrap_or(skill_file))
        };

        return (final_name, final_desc);
    }

    (humanize_id(default_id), String::new())
}

/// 将 "code-area" 风格 id 转为可读名称
fn humanize_id(id: &str) -> String {
    id.split(['-', '_', ' '])
        .filter(|s| !s.is_empty())
        .map(|s| {
            let mut c = s.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// 读取 README.md 首段作为描述兜底
fn read_readme_first_paragraph(dir: &Path) -> String {
    let readme = dir.join("README.md");
    if let Ok(content) = fs::read_to_string(&readme) {
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.starts_with('#') {
                return trimmed.chars().take(120).collect();
            }
        }
    }
    String::new()
}

/// 读取可选 workspace.json（无则用目录名生成 name，描述取 README.md 首段，读取 requiresRoute 标记）
fn read_workspace_meta(dir: &Path, id: &str) -> (String, String, String, bool) {
    let ws_json = dir.join("workspace.json");
    if let Ok(content) = fs::read_to_string(&ws_json) {
        if let Ok(v) = serde_json::from_str::<Value>(&content) {
            let name = v
                .get("name")
                .and_then(|n| n.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| humanize_id(id));
            let desc = v
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let icon = v
                .get("icon")
                .and_then(|i| i.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let requires_route = v
                .get("requiresRoute")
                .and_then(|r| r.as_bool())
                .unwrap_or(id == "code-area");
            return (name, desc, icon, requires_route);
        }
    }
    (
        humanize_id(id),
        read_readme_first_paragraph(dir),
        String::new(),
        id == "code-area",
    )
}

/// 供外部读取模板目录元数据（name, description, icon, requiresRoute）
pub fn template_meta_for_path(dir: &Path, id: &str) -> (String, String, String, bool) {
    read_workspace_meta(dir, id)
}

/// 预设发现：列出全部内置工作区模板及运行时状态
pub fn list_preset_templates(app_handle: &AppHandle) -> Vec<WorkspaceTemplate> {
    let active_id = read_active_workspace_id();
    let dirs = collect_template_dirs(app_handle);
    let current_route = read_code_area_route_path();

    let mut presets: Vec<WorkspaceTemplate> = dirs
        .iter()
        .map(|(id, dir)| {
            let (name, desc, icon, req_route) = read_workspace_meta(dir, id);
            let runtime = runtime_workspace_path(id);
            let route_path = if id == "code-area" {
                current_route.clone()
            } else {
                None
            };
            WorkspaceTemplate {
                id: id.clone(),
                name,
                description: desc,
                icon,
                template_path: dir.to_string_lossy().to_string().replace('\\', "/"),
                runtime_path: Some(runtime.to_string_lossy().to_string().replace('\\', "/")),
                is_active: *id == active_id,
                is_runtime_ready: runtime.is_dir(),
                requires_route: req_route,
                route_path,
            }
        })
        .collect();

    // default-area 恒排最前，其余按 id 字典序稳定展示
    presets.sort_by(|a, b| {
        if a.id == "default-area" {
            std::cmp::Ordering::Less
        } else if b.id == "default-area" {
            std::cmp::Ordering::Greater
        } else {
            a.id.cmp(&b.id)
        }
    });
    presets
}

/// 原生唤起本地文件夹选择器（基于 rfd 原生 IFileOpenDialog，右下角为标准的「选择文件夹」/「打开」，零网页上传提示与弹窗）
pub fn native_select_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new()
        .set_title("选择路由工作区项目根目录");

    if let Some(ref p) = default_path {
        let p_trimmed = p.trim();
        if !p_trimmed.is_empty() && Path::new(p_trimmed).is_dir() {
            dialog = dialog.set_directory(p_trimmed);
        }
    }

    let result = dialog.pick_folder();
    let selected_str = result.map(|p| p.to_string_lossy().to_string().replace('\\', "/"));
    Ok(selected_str)
}

/// 安全读取文本文件内容（单文件最大限制 max_bytes，避免大文件内存溢出）
fn read_file_safely(path: &Path, max_bytes: usize) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    if let Ok(file) = fs::File::open(path) {
        use std::io::Read;
        let mut reader = file.take(max_bytes as u64);
        let mut buf = Vec::new();
        if reader.read_to_end(&mut buf).is_ok() {
            return String::from_utf8(buf).ok();
        }
    }
    None
}

/// 读取目标路由项目根路径或子目录下的 AGENTS.md / AGENT.md
pub fn read_routed_project_agents_md(route_path: &Path) -> Option<(String, String)> {
    let candidates = [
        "AGENTS.md",
        "AGENT.md",
        "agents.md",
        "agent.md",
        "CLAUDE.md",
        "AGENTS.MD",
        "AGENT.MD",
    ];
    for name in &candidates {
        let file_path = route_path.join(name);
        if let Some(content) = read_file_safely(&file_path, 120_000) {
            return Some((name.to_string(), content));
        }
    }

    let sub_candidates = [
        ".agents/AGENTS.md",
        ".agents/AGENT.md",
        ".pi/AGENTS.md",
        ".pi/AGENT.md",
    ];
    for name in &sub_candidates {
        let file_path = route_path.join(name);
        if let Some(content) = read_file_safely(&file_path, 120_000) {
            return Some((name.to_string(), content));
        }
    }

    None
}

/// 读取目标路由项目根路径下的 README.md 文档
pub fn read_routed_project_readme_md(route_path: &Path) -> Option<(String, String)> {
    let candidates = [
        "README.md",
        "readme.md",
        "README.MD",
        "README_zh.md",
        "README_en.md",
        "README.txt",
        "README",
    ];
    for name in &candidates {
        let file_path = route_path.join(name);
        if let Some(content) = read_file_safely(&file_path, 120_000) {
            return Some((name.to_string(), content));
        }
    }

    None
}

/// 智能解析并提取目标路由工作区 AGENTS.md / README.md 中命中映射的 Skill 规约内容
pub fn resolve_matched_routed_skills(
    route_path: &str,
    hub_skills: &[CodeAreaSkillInfo],
    skill_injector: &crate::pi_runner::inner_skills::InnerSkillInjector,
    combined_docs_text: &str,
) -> Vec<MatchedSkillInfo> {
    if combined_docs_text.trim().is_empty() {
        return Vec::new();
    }

    let mut matched = Vec::new();
    let mut seen_ids = HashSet::new();
    let root = Path::new(route_path);

    // 1. 扫描目标项目本地 Skills（.agents/skills, skills, .pi/skills, .doc 等）
    let mut local_skill_candidates = Vec::new();
    let skill_search_dirs = [
        root.join(".agents").join("skills"),
        root.join("skills"),
        root.join(".pi").join("skills"),
        root.join(".doc"),
    ];

    for s_dir in &skill_search_dirs {
        if s_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(s_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let skill_file = p.join("SKILL.md");
                        if skill_file.is_file() {
                            let id = p
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or_default()
                                .to_string();
                            if !id.is_empty() {
                                let (name, _) = parse_skill_meta(&skill_file, &id);
                                let rel_path = match p.strip_prefix(root) {
                                    Ok(rel) => rel
                                        .join("SKILL.md")
                                        .to_string_lossy()
                                        .to_string()
                                        .replace('\\', "/"),
                                    Err(_) => skill_file
                                        .to_string_lossy()
                                        .to_string()
                                        .replace('\\', "/"),
                                };
                                local_skill_candidates.push((id, name, rel_path, skill_file));
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 正则/前缀提取 AGENTS.md / README.md 中的显式 Markdown 技能文件引用链接
    // 支持形如 [.agents/skills/xxx/SKILL.md], (file:///.agents/skills/xxx/SKILL.md), (skills/xxx/SKILL.md), (.doc/xxx/SKILL.md)
    let re_links = [
        ".agents/skills/",
        "skills/",
        ".doc/",
        ".pi/skills/",
    ];
    for prefix in &re_links {
        let mut search_idx = 0;
        while let Some(pos) = combined_docs_text[search_idx..].find(prefix) {
            let actual_pos = search_idx + pos;
            let after = &combined_docs_text[actual_pos..];
            let path_snippet: String = after
                .chars()
                .take_while(|c| !c.is_whitespace() && *c != ')' && *c != ']' && *c != '"' && *c != '\'' && *c != '`')
                .collect();
            search_idx = actual_pos + prefix.len();

            let trimmed_path = path_snippet.trim_matches(['/', '\\']);
            if !trimmed_path.is_empty() {
                let rel_candidate = if trimmed_path.ends_with("SKILL.md") || trimmed_path.ends_with("skill.md") {
                    PathBuf::from(trimmed_path)
                } else {
                    PathBuf::from(trimmed_path).join("SKILL.md")
                };
                let full_cand = root.join(&rel_candidate);
                if full_cand.is_file() {
                    let parent = full_cand.parent().unwrap_or(&full_cand);
                    let id = parent
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default()
                        .to_string();
                    if !id.is_empty() && seen_ids.insert(id.clone()) {
                        if let Some(content) = read_file_safely(&full_cand, 60_000) {
                            let (name, _) = parse_skill_meta(&full_cand, &id);
                            matched.push(MatchedSkillInfo {
                                id,
                                name,
                                source: rel_candidate.to_string_lossy().to_string().replace('\\', "/"),
                                content,
                            });
                        }
                    }
                }
            }
        }
    }

    // 3. 匹配本地候选 Skills
    for (id, name, rel_source, skill_file) in local_skill_candidates {
        if seen_ids.contains(&id) {
            continue;
        }
        if is_skill_referenced_in_text(&id, &name, combined_docs_text) {
            if seen_ids.insert(id.clone()) {
                if let Some(content) = read_file_safely(&skill_file, 60_000) {
                    matched.push(MatchedSkillInfo {
                        id,
                        name,
                        source: rel_source,
                        content,
                    });
                }
            }
        }
    }

    // 4. 匹配 Hub 内置 Skills
    for hub in hub_skills {
        if seen_ids.contains(&hub.id) {
            continue;
        }
        if is_skill_referenced_in_text(&hub.id, &hub.name, combined_docs_text) {
            if seen_ids.insert(hub.id.clone()) {
                let skill_p = Path::new(&hub.path).join("SKILL.md");
                let content = read_file_safely(&skill_p, 60_000)
                    .or_else(|| read_file_safely(Path::new(&hub.path), 60_000))
                    .unwrap_or_default();
                if !content.is_empty() {
                    matched.push(MatchedSkillInfo {
                        id: hub.id.clone(),
                        name: hub.name.clone(),
                        source: format!("hub:{}", hub.id),
                        content,
                    });
                }
            }
        }
    }

    // 5. 匹配 Inner-Skills 运行态技能
    for m in skill_injector.get_skill_mappings() {
        let skill_id = &m.skill_name;
        if seen_ids.contains(skill_id) {
            continue;
        }
        if is_skill_referenced_in_text(skill_id, skill_id, combined_docs_text) {
            if seen_ids.insert(skill_id.clone()) {
                if let Some(detail) = skill_injector.get_skill_detail(skill_id) {
                    matched.push(MatchedSkillInfo {
                        id: skill_id.clone(),
                        name: humanize_id(skill_id),
                        source: format!("embedded:inner-skills/{}", skill_id),
                        content: detail.to_string(),
                    });
                }
            }
        }
    }

    matched
}

/// 检查 Skill 是否在文本中被映射或引用（支持反引号、粗体、中括号、表格行、路径或独立单词边界）
fn is_skill_referenced_in_text(skill_id: &str, skill_name: &str, text: &str) -> bool {
    let lower_text = text.to_lowercase();
    let lower_id = skill_id.to_lowercase();
    if lower_id.is_empty() {
        return false;
    }

    let patterns = [
        format!("`{}`", lower_id),
        format!("**{}**", lower_id),
        format!("*{}*", lower_id),
        format!("[{}]", lower_id),
        format!("\"{}\"", lower_id),
        format!("'{}'", lower_id),
        format!("| {} |", lower_id),
        format!("skills/{}", lower_id),
        format!(".agents/skills/{}", lower_id),
        format!(".doc/{}", lower_id),
        format!("/{}", lower_id),
    ];
    for p in &patterns {
        if lower_text.contains(p) {
            return true;
        }
    }

    if lower_id.len() >= 3 && lower_text.contains(&lower_id) {
        let mut start = 0;
        while let Some(pos) = lower_text[start..].find(&lower_id) {
            let actual = start + pos;
            let before_ok = if actual == 0 {
                true
            } else {
                let prev = lower_text.as_bytes()[actual - 1];
                !prev.is_ascii_alphanumeric() && prev != b'_' && prev != b'-'
            };
            let end = actual + lower_id.len();
            let after_ok = if end >= lower_text.len() {
                true
            } else {
                let next = lower_text.as_bytes()[end];
                !next.is_ascii_alphanumeric() && next != b'_' && next != b'-'
            };
            if before_ok && after_ok {
                return true;
            }
            start = actual + lower_id.len();
        }
    }

    let lower_name = skill_name.to_lowercase();
    if lower_name != lower_id && lower_name.len() >= 4 {
        if lower_text.contains(&format!("`{}`", lower_name))
            || lower_text.contains(&format!("**{}**", lower_name))
        {
            return true;
        }
    }

    false
}

/// 构建完整的 code-area 路由上下文信封，包含：
/// 1. 核心调度与免污染铁律
/// 2. code-area Hub 预置技能清单
/// 3. 目标路由项目的 AGENTS.md / AGENT.md 规范与要求
/// 4. 目标路由项目的 README.md 文档
/// 5. 目标项目中命中映射的 Skill 完整规约
pub fn build_code_area_routing_context(
    route_path: &str,
    hub_skills: &[CodeAreaSkillInfo],
    skill_injector: &crate::pi_runner::inner_skills::InnerSkillInjector,
) -> String {
    build_code_area_routing_context_with_items(route_path, hub_skills, skill_injector).0
}

/// 带注入条目清单的完整构建：除返回路由上下文信封文本外，
/// 同时返回本次注入的文件/技能条目（agents_md / readme_md / routed_skill / routing_context），
/// 供前端会话流顶部「注入提示」信息框展示。
pub fn build_code_area_routing_context_with_items(
    route_path: &str,
    hub_skills: &[CodeAreaSkillInfo],
    skill_injector: &crate::pi_runner::inner_skills::InnerSkillInjector,
) -> (String, Vec<crate::pi_runner::inner_skills::InjectedItem>) {
    use crate::pi_runner::inner_skills::InjectedItem;

    let mut injected_items: Vec<InjectedItem> = Vec::new();
    // 路由上下文信封本身在 code-area 工作区每次 Prompt 均强制注入，始终作为条目上报
    injected_items.push(InjectedItem {
        kind: "routing_context".to_string(),
        name: "code_area_routing_context".to_string(),
    });
    let mut skills_summary = String::new();
    if !hub_skills.is_empty() {
        for s in hub_skills {
            skills_summary.push_str(&format!("  - [{}] {}: {}\n", s.id, s.name, s.description));
        }
    } else {
        skills_summary.push_str("  (暂无额外扩展技能，遵循通用编码与重构规范)\n");
    }

    let is_valid_route = !route_path.is_empty() && Path::new(route_path).is_dir();
    let display_path = if is_valid_route {
        route_path
    } else {
        "[未配置有效路由目标，请提醒用户绑定目标项目]"
    };

    let mut project_docs_section = String::new();
    if is_valid_route {
        let root = Path::new(route_path);
        let agents_doc = read_routed_project_agents_md(root);
        let readme_doc = read_routed_project_readme_md(root);

        let mut combined_text = String::new();

        if let Some((filename, content)) = agents_doc {
            combined_text.push_str(&content);
            combined_text.push('\n');
            injected_items.push(InjectedItem {
                kind: "agents_md".to_string(),
                name: filename.clone(),
            });
            project_docs_section.push_str(&format!(
                "\n[ROUTED PROJECT SPECIFICATIONS & RULES (AGENTS.MD)]:\n\
                <routed_agents_md filename=\"{}\">\n\
                {}\n\
                </routed_agents_md>\n",
                filename,
                content.trim()
            ));
        } else {
            project_docs_section.push_str(
                "\n[ROUTED PROJECT SPECIFICATIONS & RULES (AGENTS.MD)]:\n\
                (目标项目未检测到 AGENTS.md / AGENT.md 规范文件)\n"
            );
        }

        if let Some((filename, content)) = readme_doc {
            combined_text.push_str(&content);
            combined_text.push('\n');
            injected_items.push(InjectedItem {
                kind: "readme_md".to_string(),
                name: filename.clone(),
            });
            project_docs_section.push_str(&format!(
                "\n[ROUTED PROJECT DOCUMENTATION (README.MD)]:\n\
                <routed_readme_md filename=\"{}\">\n\
                {}\n\
                </routed_readme_md>\n",
                filename,
                content.trim()
            ));
        } else {
            project_docs_section.push_str(
                "\n[ROUTED PROJECT DOCUMENTATION (README.MD)]:\n\
                (目标项目未检测到 README.md 文档)\n"
            );
        }

        // 解析命中映射的 Skill
        let matched_skills = resolve_matched_routed_skills(
            route_path,
            hub_skills,
            skill_injector,
            &combined_text,
        );

        if !matched_skills.is_empty() {
            for s in &matched_skills {
                injected_items.push(InjectedItem {
                    kind: "routed_skill".to_string(),
                    name: s.name.clone(),
                });
            }
            project_docs_section.push_str(&format!(
                "\n[ROUTED PROJECT MATCHED SKILLS (MAPPED SKILLS INJECTION)]:\n\
                <routed_project_skills count=\"{}\">\n",
                matched_skills.len()
            ));
            for s in matched_skills {
                project_docs_section.push_str(&format!(
                    "<routed_skill id=\"{}\" name=\"{}\" source=\"{}\">\n\
                    {}\n\
                    </routed_skill>\n",
                    s.id,
                    s.name,
                    s.source,
                    s.content.trim()
                ));
            }
            project_docs_section.push_str("</routed_project_skills>\n");
        }
    }

    let formatted_context = format!(
        "\n\n<code_area_routing_context>\n\
        [CODE-AREA ACTIVE: ROUTED WORKSPACE TARGET]\n\
        Target Project Path: {}\n\
        Hub CWD: ~/.pi-dl/workspaces/code-area\n\n\
        CORE DISPATCH RULES:\n\
        1. TARGET INTEGRITY: ALL file inspection, reading, code creation, edits, refactoring, tests, and patches MUST be performed inside the Target Project Path: '{}'.\n\
        2. COMMAND EXECUTION: When executing shell/terminal commands (e.g. bash/powershell/git/npm/cargo), explicitly set working directory to '{}' or execute inside it.\n\
        3. HUB PRESERVATION: The Hub CWD is the global skill registry. DO NOT create project files or temporary dumps in the Hub CWD.\n\
        4. AVAILABLE BUILT-IN CODING SKILLS IN HUB:\n\
        {}\
        {}\
        </code_area_routing_context>",
        display_path,
        if is_valid_route { route_path } else { "[未配置]" },
        if is_valid_route { route_path } else { "./" },
        skills_summary,
        project_docs_section
    );

    (formatted_context, injected_items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_skill_referenced_in_text() {
        let text = "本项目规则：参考 `auto-compile-and-fix` 规范以及 [.agents/skills/sketch-drafting-ui/SKILL.md]";
        assert!(is_skill_referenced_in_text("auto-compile-and-fix", "Auto Compile", text));
        assert!(is_skill_referenced_in_text("sketch-drafting-ui", "Sketch UI", text));
        assert!(!is_skill_referenced_in_text("unknown-skill", "Unknown", text));
    }

    #[test]
    fn test_build_code_area_routing_context_unconfigured() {
        let injector = crate::pi_runner::inner_skills::InnerSkillInjector::new();
        let ctx = build_code_area_routing_context("", &[], &injector);
        assert!(ctx.contains("<code_area_routing_context>"));
        assert!(ctx.contains("[未配置有效路由目标，请提醒用户绑定目标项目]"));
        assert!(ctx.contains("</code_area_routing_context>"));
    }

    #[test]
    fn test_read_routed_project_docs_and_skills() {
        // 使用当前仓库作为测试目标路径
        let current_dir = std::env::current_dir().unwrap();
        let repo_root = current_dir.parent().unwrap();
        let repo_path = repo_root.to_string_lossy().to_string().replace('\\', "/");

        let injector = crate::pi_runner::inner_skills::InnerSkillInjector::new();
        let hub_skills = vec![CodeAreaSkillInfo {
            id: "code-refactoring".to_string(),
            name: "Code Refactoring".to_string(),
            description: "Refactor code".to_string(),
            path: "".to_string(),
        }];

        let ctx = build_code_area_routing_context(&repo_path, &hub_skills, &injector);
        assert!(ctx.contains("<code_area_routing_context>"));
        assert!(ctx.contains(&repo_path));
        assert!(ctx.contains("<routed_agents_md"));
        assert!(ctx.contains("<routed_readme_md"));
        assert!(ctx.contains("<routed_project_skills"));
        assert!(ctx.contains("</code_area_routing_context>"));
    }
}


