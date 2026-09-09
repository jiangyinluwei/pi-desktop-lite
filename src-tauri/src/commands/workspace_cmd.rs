//! `commands/workspace_cmd` — 多预设工作区与 code-area 路由指令。
//! 注：模块名加 `_cmd` 后缀以规避与 `crate::workspace` 模块的同名遮蔽。

use crate::pi_runner::{HostStatus, PiHostPool, PiSupervisor};
use crate::workspace;
use std::path::Path;
use tauri::State;

/// 列出全部内置工作区预设（模板 + 运行时状态）
#[tauri::command]
pub fn pi_list_workspaces(app: tauri::AppHandle) -> Result<Vec<workspace::WorkspaceTemplate>, String> {
    Ok(workspace::list_preset_templates(&app))
}

/// 解析当前生效工作区（含运行时覆盖/环境变量优先级/路由工作区）
#[tauri::command]
pub async fn pi_get_active_workspace(
    app: tauri::AppHandle,
    supervisor: State<'_, PiSupervisor>,
) -> Result<serde_json::Value, String> {
    let path = supervisor.get_workspace().await;
    let active_id = workspace::read_active_workspace_id();
    let route_path = workspace::read_code_area_route_path();

    // 判定生效来源 id：环境变量 > 配置 activeId（路径一致）> custom
    let effective_id = if std::env::var("PI_WORKSPACE")
        .map(|v| Path::new(&v).is_dir())
        .unwrap_or(false)
    {
        "env".to_string()
    } else {
        let expected = workspace::runtime_workspace_path(&active_id);
        if expected.to_string_lossy().eq(path.to_string_lossy().as_ref()) {
            active_id.clone()
        } else {
            "custom".to_string()
        }
    };

    let (name, requires_route) = workspace::find_template_dir(&app, &active_id)
        .map(|dir| {
            let meta = workspace::template_meta_for_path(&dir, &active_id);
            (meta.0, meta.3)
        })
        .unwrap_or_else(|| {
            if active_id == "default-area" {
                ("默认工作区".to_string(), false)
            } else {
                (active_id.clone(), active_id == "code-area")
            }
        });

    let route_name = route_path.as_ref().map(|p| {
        Path::new(p)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(p)
            .to_string()
    });

    Ok(serde_json::json!({
        "id": effective_id,
        "name": name,
        "path": path.to_string_lossy().to_string().replace('\\', "/"),
        "requiresRoute": requires_route,
        "routePath": route_path,
        "routeName": route_name,
    }))
}

/// 切换当前激活的工作区：校验 → 物化运行时副本 → 持久化 → set_workspace → 空闲则重启重锚 CWD
#[tauri::command]
pub async fn pi_set_active_workspace(
    app: tauri::AppHandle,
    supervisor: State<'_, PiSupervisor>,
    host_pool: State<'_, PiHostPool>,
    id: String,
) -> Result<serde_json::Value, String> {
    let template = workspace::find_template_dir(&app, &id)
        .ok_or_else(|| format!("工作区 [{}] 不存在", id))?;

    let runtime = workspace::ensure_runtime_workspace(&id, &template)?;
    workspace::write_active_workspace_id(&id)?;
    supervisor.set_workspace(runtime.clone()).await;

    let active_tasks = host_pool.get_active_tasks_count().await;
    let mut restarted = false;

    // 主宿主空闲（无运行任务且处于 Ready）时自动重启以重新锚定 CWD；否则跳过由空闲后重启生效
    let status = supervisor.get_status().await;
    if active_tasks == 0 && matches!(status, HostStatus::Ready { .. }) {
        if let Err(e) = supervisor.restart().await {
            log::warn!("[Workspace] Failed to restart supervisor after switch to {}: {}", id, e);
        } else {
            restarted = true;
        }
    }

    let route_path = workspace::read_code_area_route_path();
    let requires_route = id == "code-area";

    Ok(serde_json::json!({
        "path": runtime.to_string_lossy().to_string().replace('\\', "/"),
        "restarted": restarted,
        "activeTasks": active_tasks,
        "requiresRoute": requires_route,
        "routePath": route_path,
    }))
}

/// 原生唤起系统文件夹选择器
#[tauri::command]
pub fn pi_select_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    workspace::native_select_folder(default_path)
}

/// 获取 code-area 路由工作区状态（路径、历史、技能集）
#[tauri::command]
pub fn pi_get_code_area_route(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let route_path = workspace::read_code_area_route_path();
    let history = workspace::read_code_area_route_history();
    let skills = workspace::list_code_area_skills(&app);

    let (exists, name) = if let Some(ref p) = route_path {
        let is_dir = Path::new(p).is_dir();
        let folder_name = Path::new(p)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(p)
            .to_string();
        (is_dir, folder_name)
    } else {
        (false, String::new())
    };

    Ok(serde_json::json!({
        "routePath": route_path,
        "name": name,
        "exists": exists,
        "history": history,
        "skills": skills,
    }))
}

/// 设置并保存 code-area 路由工作区路径
#[tauri::command]
pub fn pi_set_code_area_route(route_path: String) -> Result<serde_json::Value, String> {
    let trimmed = route_path.trim();
    if trimmed.is_empty() {
        return Err("路由工作区路径不能为空".to_string());
    }
    let p = Path::new(trimmed);
    if !p.is_dir() {
        return Err(format!("指定路径不存在或不是有效文件夹: {}", trimmed));
    }

    workspace::write_code_area_route_path(trimmed)?;
    let history = workspace::read_code_area_route_history();
    let folder_name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(trimmed)
        .to_string();

    Ok(serde_json::json!({
        "routePath": trimmed.replace('\\', "/"),
        "name": folder_name,
        "history": history,
    }))
}

/// 列出 code-area 内置编码技能集
#[tauri::command]
pub fn pi_list_code_area_skills(app: tauri::AppHandle) -> Result<Vec<workspace::CodeAreaSkillInfo>, String> {
    Ok(workspace::list_code_area_skills(&app))
}
