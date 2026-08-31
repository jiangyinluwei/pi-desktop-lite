// ==========================================================================
// 多预设工作区模块 (Workspace Presets & Runtime Materialization)
//
// 双轨模型：
//   - 内置预设 = 只读模板（打包进资源目录，与 default-area 同级）
//   - 运行时   = 用户目录副本（~/.pi-dl/workspaces/<id>/，可写，绝不覆盖）
//
// default-area 特殊处理：保持 ~/.pi-dl/default-area 路径不变，已用用户数据
// 零迁移、零覆盖；其余预设首次选中时整目录复制模板，已存在则直接返回。
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

/// 读取 ~/.pi-dl/config.json 中 workspace.activeId（缺省或非法时回退 default-area）
pub fn read_active_workspace_id() -> String {
    if let Ok(config) = read_pi_dl_json("config.json", json!({})) {
        if let Some(id) = config
            .get("workspace")
            .and_then(|w| w.get("activeId"))
            .and_then(|v| v.as_str())
        {
            if !id.trim().is_empty() {
                return id.to_string();
            }
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
    if let Some(obj) = config.as_object_mut() {
        obj.insert("workspace".to_string(), json!({ "activeId": id }));
    }
    write_pi_dl_json("config.json", &config)
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

/// 读取可选 workspace.json（无则用目录名生成 name，描述取 README.md 首段）
fn read_workspace_meta(dir: &Path, id: &str) -> (String, String, String) {
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
            return (name, desc, icon);
        }
    }
    (humanize_id(id), read_readme_first_paragraph(dir), String::new())
}

/// 供外部读取模板目录元数据（name, description, icon）
pub fn template_meta_for_path(dir: &Path, id: &str) -> (String, String, String) {
    read_workspace_meta(dir, id)
}

/// 预设发现：列出全部内置工作区模板及运行时状态
pub fn list_preset_templates(app_handle: &AppHandle) -> Vec<WorkspaceTemplate> {
    let active_id = read_active_workspace_id();
    let dirs = collect_template_dirs(app_handle);

    let mut presets: Vec<WorkspaceTemplate> = dirs
        .iter()
        .map(|(id, dir)| {
            let (name, desc, icon) = read_workspace_meta(dir, id);
            let runtime = runtime_workspace_path(id);
            WorkspaceTemplate {
                id: id.clone(),
                name,
                description: desc,
                icon,
                template_path: dir.to_string_lossy().to_string(),
                runtime_path: Some(runtime.to_string_lossy().to_string()),
                is_active: *id == active_id,
                is_runtime_ready: runtime.is_dir(),
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
