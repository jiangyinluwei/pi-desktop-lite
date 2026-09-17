//! rpc.rs — 内核 RPC 共享基建（supervisor 与 host_pool 双宿主去重层）
//!
//! 此前 `send_command_with_response`（约 55 行）、stdin 写循环与 PATH 补全块在
//! supervisor.rs 与 host_pool.rs 中逐字平行复制，且已出现行为漂移（supervisor 的
//! send_command 校验指令必须为 JSON object，host_pool 不校验）——修一处漏一处的
//! 温床。本模块收敛为单一实现：请求 id 生成、pending 登记与三态等待响应、
//! stdin 序列化入队、stdin 写循环、PATH 补全。两个宿主仅保留各自的门禁差异
//! （supervisor 的运行态检查 / SessionHost 的 is_aborted 门禁）。

use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, Mutex, oneshot};
use tokio::process::Command;

/// 主监督器内核 RPC 默认等待时长（get_state / get_available_models / set_model 等）
pub const KERNEL_RPC_TIMEOUT: Duration = Duration::from_secs(8);
/// SessionHost 会话实时统计（get_session_stats）等待时长：高频遥测轮询，从严收紧
pub const SESSION_STATS_RPC_TIMEOUT: Duration = Duration::from_secs(4);

/// 待响应 RPC 请求登记表（请求 id → 响应通道），supervisor 与 SessionHost 各持一份
pub type PendingResponses = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// 生成带前缀的唯一请求 id（纳秒时间戳，同进程内单调递增足防碰撞）
pub fn next_request_id(prefix: &str) -> String {
    format!(
        "{}{}",
        prefix,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

/// 为指令附加 id 并登记等待通道；返回 (id, rx)。指令非 JSON object 时报错。
pub async fn register_pending(
    pending_responses: &PendingResponses,
    command_val: &mut Value,
) -> Result<(String, oneshot::Receiver<Value>), String> {
    let obj = command_val
        .as_object_mut()
        .ok_or_else(|| "Command must be a JSON object".to_string())?;
    let id = next_request_id("req_");
    obj.insert("id".to_string(), Value::String(id.clone()));
    let (tx, rx) = oneshot::channel::<Value>();
    pending_responses.lock().await.insert(id.clone(), tx);
    Ok((id, rx))
}

/// 从登记表摘除请求（发送失败路径）
pub async fn remove_pending(pending_responses: &PendingResponses, id: &str) {
    pending_responses.lock().await.remove(id);
}

/// 三态等待响应：成功取 data / 失败取 error / 超时与通道断开时清理登记表。
/// supervisor 与 SessionHost 的 with_response 唯一响应结算实现（防行为漂移）。
pub async fn await_response(
    pending_responses: &PendingResponses,
    id: String,
    rx: oneshot::Receiver<Value>,
    timeout_dur: Duration,
) -> Result<Value, String> {
    match tokio::time::timeout(timeout_dur, rx).await {
        Ok(Ok(response_val)) => {
            let success = response_val
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if success {
                Ok(response_val.get("data").cloned().unwrap_or(Value::Null))
            } else {
                let err = response_val
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("RPC command returned failure");
                Err(err.to_string())
            }
        }
        Ok(Err(_)) => {
            remove_pending(pending_responses, &id).await;
            Err("Response channel dropped before receiving response".to_string())
        }
        Err(_) => {
            remove_pending(pending_responses, &id).await;
            Err(format!("RPC command timed out after {:?}", timeout_dur))
        }
    }
}

/// 序列化并入队一行 RPC JSON 到内核 stdin 写通道
///
/// 统一校验指令必须为 JSON object（此前仅 supervisor 校验、SessionHost 不校验的
/// 漂移点在此收敛）。
pub async fn queue_stdin_line(
    stdin_tx: &Arc<Mutex<Option<mpsc::Sender<String>>>>,
    command_val: &Value,
    closed_err: String,
    queue_err_prefix: &str,
) -> Result<(), String> {
    if !command_val.is_object() {
        return Err("Command must be a JSON object".to_string());
    }
    let sender = stdin_tx.lock().await.clone();
    let tx = sender.ok_or(closed_err)?;
    let json_str = serde_json::to_string(command_val)
        .map_err(|e| format!("Failed to serialize command: {}", e))?;
    let line = format!("{}\n", json_str);
    tx.send(line)
        .await
        .map_err(|e| format!("{}: {}", queue_err_prefix, e))
}

/// 子进程 stdin 写循环（supervisor 与 SessionHost 同构，仅日志标签不同）
pub fn spawn_stdin_writer(
    stdin: tokio::process::ChildStdin,
    mut stdin_rx: mpsc::Receiver<String>,
    log_tag: &str,
) {
    let log_tag = log_tag.to_string();
    tokio::spawn(async move {
        let mut stdin_writer = stdin;
        while let Some(line) = stdin_rx.recv().await {
            if let Err(err) = stdin_writer.write_all(line.as_bytes()).await {
                log::error!("[{}] Failed writing to child stdin: {}", log_tag, err);
                break;
            }
            if let Err(err) = stdin_writer.flush().await {
                log::error!("[{}] Failed flushing child stdin: {}", log_tag, err);
                break;
            }
        }
    });
}

/// 为内核子进程命令补全 PATH（内核可执行文件所在目录前置；
/// 使用 std::env::var("PATH") 大小写兼容 Windows 系统环境变量 "Path"）
pub fn prepend_binary_dir_to_path(cmd: &mut Command, binary_path: &Path) {
    if let Some(bin_dir) = binary_path.parent() {
        let split_char = if cfg!(windows) { ';' } else { ':' };
        let existing_path = std::env::var("PATH").unwrap_or_default();
        let bin_dir_str = bin_dir.to_string_lossy().to_string();
        if !existing_path
            .split(split_char)
            .any(|p| p.eq_ignore_ascii_case(&bin_dir_str))
        {
            let new_path = format!("{}{}{}", bin_dir_str, split_char, existing_path);
            cmd.env("PATH", new_path);
        }
    }
}
