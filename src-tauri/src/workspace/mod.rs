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

