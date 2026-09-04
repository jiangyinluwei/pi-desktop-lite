//! `commands/rollback` — 会话回退与文件撤回链路（配合内核 fork + 工具执行前快照）。

use crate::pi_runner::PiHostPool;
use crate::rollback::RollbackTarget;
use tauri::State;

const RPC_RESPONSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// 获取当前会话可回退的历史用户消息列表 (内核原生 get_fork_messages)。
/// task_id 为空时路由主会话 (Supervisor)，否则路由对应 Task 子进程。
#[tauri::command]
pub async fn pi_get_fork_messages(
    host_pool: State<'_, PiHostPool>,
    task_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let command = serde_json::json!({ "type": "get_fork_messages" });
    match task_id {
        Some(id) if !id.trim().is_empty() => {
            host_pool
                .send_command_to_task_with_response(&id, command, RPC_RESPONSE_TIMEOUT)
                .await
        }
        _ => {
            let supervisor = host_pool.supervisor();
            supervisor
                .send_command_with_response(command, RPC_RESPONSE_TIMEOUT)
                .await
        }
    }
}

/// 在指定历史用户消息处创建回退分支 (内核原生 fork)。
#[tauri::command]
pub async fn pi_fork_session(
    host_pool: State<'_, PiHostPool>,
    task_id: Option<String>,
    entry_id: String,
) -> Result<serde_json::Value, String> {
    if entry_id.trim().is_empty() {
        return Err("回退目标 entryId 为空".to_string());
    }
    let command = serde_json::json!({ "type": "fork", "entryId": entry_id });
    let data = match task_id {
        Some(id) if !id.trim().is_empty() => {
            host_pool
                .send_command_to_task_with_response(&id, command, RPC_RESPONSE_TIMEOUT)
                .await?
        }
        _ => {
            let supervisor = host_pool.supervisor();
            supervisor
                .send_command_with_response(command, RPC_RESPONSE_TIMEOUT)
                .await?
        }
    };
    let cancelled = data
        .get("cancelled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if cancelled {
        return Err("回退被内核扩展取消".to_string());
    }
    Ok(data)
}

/// 撤回指定会话的「已修改 / 已删除」文件：按 (path, toolCallId) 匹配工具执行前快照还原。
/// dry_run: true 时仅执行无副作用快照预检与大文件超限校验，不写磁盘。
#[tauri::command]
pub async fn pi_rollback_files(
    host_pool: State<'_, PiHostPool>,
    task_id: Option<String>,
    targets: Vec<RollbackTarget>,
    dry_run: Option<bool>,
) -> Result<serde_json::Value, String> {
    // 会话 ID 定位：Task 路由其专属 SessionHost；主会话从内核 get_state 提取
    let session_id = match task_id {
        Some(ref id) if !id.trim().is_empty() => host_pool
            .get_task_session_id(id)
            .await
            .ok_or_else(|| format!("Task {} 不存在，无法定位会话快照", id))?,
        _ => {
            let supervisor = host_pool.supervisor();
            let state = supervisor
                .send_command_with_response(
                    serde_json::json!({ "type": "get_state" }),
                    RPC_RESPONSE_TIMEOUT,
                )
                .await?;
            ["sessionId", "session_id", "id"]
                .iter()
                .find_map(|k| state.get(*k).and_then(|v| v.as_str()).map(|s| s.to_string()))
                .ok_or_else(|| "主会话 ID 不可用，无法定位快照".to_string())?
        }
    };
    crate::rollback::rollback_files(&session_id, &targets, dry_run.unwrap_or(false))
}
