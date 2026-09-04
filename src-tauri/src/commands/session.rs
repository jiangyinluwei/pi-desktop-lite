//! `commands/session` — 会话索引与树状历史指令。

use crate::pi_runner::PiSupervisor;
use crate::session::{
    extract_timestamped_prompts_from_session, parse_session_entries, parse_session_turns,
    SessionEntrySummary, SessionIndexCache, SessionMetadata, SessionTurnDetail,
};
use std::path::Path;
use tauri::State;

/// 列出全部会话索引元数据
#[tauri::command]
pub fn pi_list_sessions(session_cache: State<'_, SessionIndexCache>) -> Result<Vec<SessionMetadata>, String> {
    Ok(session_cache.list_all())
}

/// 获取全局输入历史（严格时间序 + LIFO 去重保留最新）
#[tauri::command]
pub fn pi_get_prompt_history(session_cache: State<'_, SessionIndexCache>) -> Result<Vec<String>, String> {
    let sessions = session_cache.list_all();
    let mut all_timestamped: Vec<(i64, String)> = Vec::new();

    for s in &sessions {
        let p = Path::new(&s.file_path);
        let prompts = extract_timestamped_prompts_from_session(p);
        all_timestamped.extend(prompts);
    }

    // 严格按真实毫秒时间戳从小到大（从旧到新）排序
    all_timestamped.sort_by_key(|item| item.0);

    // 去重策略：保留最新出现（Keep Most Recent / LIFO）
    // 从后往前（从最新到最旧）遍历，先记录进 seen 的就是该 prompt 最新一次出现
    let mut seen = std::collections::HashSet::new();
    let mut deduped_reversed = Vec::new();

    for (_ts, prompt) in all_timestamped.into_iter().rev() {
        if seen.insert(prompt.clone()) {
            deduped_reversed.push(prompt);
        }
    }

    // 翻转回来，获得从旧到新的全局历史栈（最新发送的位于末尾）
    deduped_reversed.reverse();
    Ok(deduped_reversed)
}

/// 获取指定会话的树状历史条目摘要
#[tauri::command]
pub fn pi_get_session_tree(session_path: String) -> Result<Vec<SessionEntrySummary>, String> {
    let path = Path::new(&session_path);
    parse_session_entries(path)
}

/// 获取指定会话的完整轮次明细
#[tauri::command]
pub fn pi_get_session_detail(session_path: String) -> Result<Vec<SessionTurnDetail>, String> {
    let path = Path::new(&session_path);
    parse_session_turns(path)
}

/// 切换当前会话（内置技能轮次重置后下发 switch_session 命令）
#[tauri::command]
pub async fn pi_switch_session(
    supervisor: State<'_, PiSupervisor>,
    session_path: String,
) -> Result<(), String> {
    supervisor.reset_skill_turns();
    let val = serde_json::json!({
        "type": "switch_session",
        "sessionPath": session_path
    });
    supervisor.send_command(val).await
}

/// 新建会话（可选指定父会话）
#[tauri::command]
pub async fn pi_new_session(
    supervisor: State<'_, PiSupervisor>,
    parent_session: Option<String>,
) -> Result<(), String> {
    supervisor.reset_skill_turns();
    let mut val = serde_json::json!({
        "type": "new_session"
    });
    if let Some(p) = parent_session {
        val["parentSession"] = serde_json::Value::String(p);
    }
    supervisor.send_command(val).await
}
