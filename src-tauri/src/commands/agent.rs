//! `commands/agent` — Pi Agent 核心 RPC、监督控制、任务、模型与工作区指令。

use crate::config_manager::sync_subagent_pinned_model_if_enabled;
use crate::pi_runner::{FollowUpRequest, HostStatus, PiHostPool, PiSupervisor, PromptRequest, SteerRequest};
use tauri::State;

/// 发送主提示词（新建对话）
#[tauri::command]
pub async fn pi_send_prompt(
    host_pool: State<'_, PiHostPool>,
    request: PromptRequest,
) -> Result<String, String> {
    host_pool.send_prompt(request).await
}

/// 向运行中 Agent 发送引导指令 (Steer)
#[tauri::command]
pub async fn pi_send_steer(
    host_pool: State<'_, PiHostPool>,
    request: SteerRequest,
) -> Result<(), String> {
    host_pool.send_steer(request).await
}

/// 向当前会话发送 FollowUp 追问
#[tauri::command]
pub async fn pi_send_follow_up(
    host_pool: State<'_, PiHostPool>,
    request: FollowUpRequest,
) -> Result<(), String> {
    host_pool.send_follow_up(request).await
}

/// 向监督器发送任意 RPC 命令（forward 到内核）
#[tauri::command]
pub async fn pi_send_command(
    supervisor: State<'_, PiSupervisor>,
    command: serde_json::Value,
) -> Result<(), String> {
    supervisor.send_command(command).await
}

/// 中止指定任务（task_id 为空时中止主会话）
#[tauri::command]
pub async fn pi_abort(
    host_pool: State<'_, PiHostPool>,
    task_id: Option<String>,
) -> Result<(), String> {
    host_pool.abort_task(task_id).await
}

/// 销毁指定任务及子进程
#[tauri::command]
pub async fn pi_destroy_task(
    host_pool: State<'_, PiHostPool>,
    task_id: String,
) -> Result<(), String> {
    host_pool.destroy_task(&task_id).await
}

/// 获取当前活跃任务 ID 列表
#[tauri::command]
pub async fn pi_get_active_tasks(
    host_pool: State<'_, PiHostPool>,
) -> Result<Vec<String>, String> {
    Ok(host_pool.get_active_task_ids().await)
}

/// 重启 Pi 宿主进程
#[tauri::command]
pub async fn pi_restart_host(supervisor: State<'_, PiSupervisor>) -> Result<(), String> {
    supervisor.restart().await
}

/// 获取宿主状态（Ready / Busy / Crashed 等）
#[tauri::command]
pub async fn pi_get_host_status(supervisor: State<'_, PiSupervisor>) -> Result<HostStatus, String> {
    Ok(supervisor.get_status().await)
}

/// 获取内核版本号
#[tauri::command]
pub async fn pi_get_version(supervisor: State<'_, PiSupervisor>) -> Result<Option<String>, String> {
    Ok(supervisor.get_version().await)
}

/// 获取当前会话状态
#[tauri::command]
pub async fn pi_get_state(supervisor: State<'_, PiSupervisor>) -> Result<serde_json::Value, String> {
    supervisor.get_session_state().await
}

/// 获取内核可用模型列表（含各 provider 与模型）
#[tauri::command]
pub async fn pi_get_available_models(
    supervisor: State<'_, PiSupervisor>,
) -> Result<serde_json::Value, String> {
    supervisor.get_available_models().await
}

/// 设置当前模型（联动手动钉住子代理模型）
#[tauri::command]
pub async fn pi_set_model(
    supervisor: State<'_, PiSupervisor>,
    host_pool: State<'_, PiHostPool>,
    provider: String,
    model_id: String,
) -> Result<serde_json::Value, String> {
    host_pool.set_active_model(provider.clone(), model_id.clone()).await;
    let res = supervisor.set_model(&provider, &model_id).await;
    // 联动同步：若启用了 pi-subagents，自动将子代理配置钉住为当前所选模型
    let _ = sync_subagent_pinned_model_if_enabled(&model_id);
    res
}

/// 设置思考等级
#[tauri::command]
pub async fn pi_set_thinking_level(
    supervisor: State<'_, PiSupervisor>,
    host_pool: State<'_, PiHostPool>,
    level: String,
) -> Result<(), String> {
    host_pool.set_active_thinking_level(level.clone()).await;
    supervisor.set_thinking_level(&level).await
}

/// 获取当前工作区绝对路径
#[tauri::command]
pub async fn pi_get_workspace(supervisor: State<'_, PiSupervisor>) -> Result<String, String> {
    Ok(supervisor.get_workspace().await.to_string_lossy().to_string())
}

/// 设置当前工作区
#[tauri::command]
pub async fn pi_set_workspace(
    supervisor: State<'_, PiSupervisor>,
    workspace_path: String,
) -> Result<(), String> {
    let p = std::path::PathBuf::from(workspace_path);
    supervisor.set_workspace(p).await;
    Ok(())
}
