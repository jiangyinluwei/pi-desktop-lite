use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadata {
    pub session_id: String,
    pub file_path: String,
    pub cwd: Option<String>,
    pub message_count: usize,
    pub first_message: Option<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub size_bytes: u64,
    /// 是否至少包含一轮「真实用户提问 → 非空回答」的完整对话
    pub has_complete_turn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEntrySummary {
    pub id: String,
    pub parent_id: Option<String>,
    pub entry_type: String,
    pub timestamp: Option<String>,
    pub text_preview: Option<String>,
}

/// 解析单个 .jsonl 会话文件的元数据
pub fn parse_session_file(path: &Path) -> Result<SessionMetadata, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open session file: {}", e))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let size_bytes = metadata.len();

    let reader = BufReader::new(file);
    let mut session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut cwd = None;
    let mut created_at = None;
    let mut modified_at = None;
    let mut message_count = 0;
    let mut first_message = None;
    let mut has_complete_turn = false;
    let mut pending_query = false;

    if let Ok(mod_time) = metadata.modified() {
        let datetime: chrono::DateTime<chrono::Utc> = mod_time.into();
        modified_at = Some(datetime.to_rfc3339());
    }

    for (idx, line_res) in reader.lines().enumerate() {
        let line = match line_res {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
            if idx == 0 {
                // Header Line
                if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                    session_id = id.to_string();
                }
                if let Some(c) = val.get("cwd").and_then(|v| v.as_str()) {
                    cwd = Some(c.to_string());
                }
                if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
                    created_at = Some(ts.to_string());
                }
            } else {
                // Entry Line
                let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if entry_type == "message" {
                    message_count += 1;
                    if let Some(msg_obj) = val.get("message") {
                        let role = msg_obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
                        if role == "user" {
                            // 剥离运行态注入信封后判定是否为真实用户提问（摘要同样使用净化后文本）
                            let raw = extract_message_text(msg_obj.get("content"));
                            let stripped = strip_runtime_context_rules(&raw);
                            if !stripped.trim().is_empty() {
                                pending_query = true;
                                if first_message.is_none() {
                                    first_message = Some(stripped.chars().take(100).collect());
                                }
                            }
                        } else if role == "assistant" && pending_query {
                            // 已有真实提问，且该轮产生了非空回答 → 记为完整对话轮
                            let text = extract_message_text(msg_obj.get("content"));
                            if !text.trim().is_empty() {
                                has_complete_turn = true;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(SessionMetadata {
        session_id,
        file_path: path.to_string_lossy().to_string(),
        cwd,
        message_count,
        first_message,
        created_at,
        modified_at,
        size_bytes,
        has_complete_turn,
    })
}

/// 解析会话文件的所有条目摘要，用于构建分支树
pub fn parse_session_entries(path: &Path) -> Result<Vec<SessionEntrySummary>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for (idx, line_res) in reader.lines().enumerate() {
        if idx == 0 {
            continue; // Skip header
        }
        let line = match line_res {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
            let id = val
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let parent_id = val
                .get("parentId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let entry_type = val
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let timestamp = val
                .get("timestamp")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let mut text_preview = None;
            if let Some(msg_obj) = val.get("message") {
                if let Some(content) = msg_obj.get("content").and_then(|v| v.as_str()) {
                    text_preview = Some(content.chars().take(80).collect());
                }
            }

            if !id.is_empty() {
                entries.push(SessionEntrySummary {
                    id,
                    parent_id,
                    entry_type,
                    timestamp,
                    text_preview,
                });
            }
        }
    }

    Ok(entries)
}

fn clean_user_prompt(text: &str) -> String {
    let mut raw = text;
    if let Some(pos) = raw.find("\n\n[附带本地文件绝对路径]:") {
        raw = &raw[..pos];
    }
    raw.trim().to_string()
}

/// 剥离宿主运行态注入的 <runtime_context_rules> 信封，还原真实用户提问
fn strip_runtime_context_rules(text: &str) -> String {
    const OPEN: &str = "<runtime_context_rules>";
    const CLOSE: &str = "</runtime_context_rules>";
    if let Some(start) = text.find(OPEN) {
        if let Some(end) = text.find(CLOSE) {
            let after = end + CLOSE.len();
            let mut result = String::from(&text[..start]);
            result.push_str(text[after..].trim_start());
            return result.trim().to_string();
        }
    }
    text.to_string()
}

/// 从用户提问尾注中提取附带本地文件路径列表
fn split_user_prompt_attachments(text: &str) -> (String, Vec<String>) {
    const ATTACHMENT_MARKER: &str = "[附带本地文件绝对路径]:";
    let attachments: Vec<String> = match text.find(ATTACHMENT_MARKER) {
        Some(pos) => text[pos + ATTACHMENT_MARKER.len()..]
            .lines()
            .map(|l| l.trim().trim_end_matches(',').to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        None => Vec::new(),
    };
    let query = clean_user_prompt(text);
    (query, attachments)
}

/// 提取消息正文：content 为 string 时直接返回，为 blocks 数组时拼接全部 text 块
fn extract_message_text(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(arr) = content.as_array() {
        let mut parts = Vec::new();
        for item in arr {
            if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    parts.push(t.to_string());
                }
            }
        }
        return parts.join("\n\n");
    }
    String::new()
}

/// 从单个 .jsonl 会话文件中提取所有真实用户提问 (role: "user")
pub fn extract_user_prompts_from_session(path: &Path) -> Vec<String> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let reader = BufReader::new(file);
    let mut prompts = Vec::new();

    for (idx, line_res) in reader.lines().enumerate() {
        if idx == 0 {
            continue; // Skip header
        }
        let line = match line_res {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
            let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if entry_type == "message" {
                if let Some(msg_obj) = val.get("message") {
                    let role = msg_obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
                    if role == "user" {
                        if let Some(content) = msg_obj.get("content") {
                            if let Some(text) = content.as_str() {
                                let clean = clean_user_prompt(text);
                                if !clean.is_empty() {
                                    prompts.push(clean);
                                }
                            } else if let Some(arr) = content.as_array() {
                                for item in arr {
                                    if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                                        let clean = clean_user_prompt(t);
                                        if !clean.is_empty() {
                                            prompts.push(clean);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    prompts
}

// ==========================================================================
// 会话完整轮次解析（供 Flow 界面历史还原使用）
// ==========================================================================

/// 单次工具调用详情（结构化，由前端渲染为手绘工具卡片）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionToolCallDetail {
    pub id: String,
    pub name: String,
    pub arguments_text: String,
    pub result_text: Option<String>,
    pub is_error: bool,
}

/// 单轮对话详情：一次用户提问 + 后续 assistant 思考 / 工具调用 / 最终回答
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTurnDetail {
    pub query: String,
    pub attachments: Vec<String>,
    pub thinking_text: String,
    pub response_text: String,
    pub tool_calls: Vec<SessionToolCallDetail>,
    pub timestamp: Option<String>,
    pub is_aborted: bool,
}

/// 按顺序配对解析会话 JSONL 中的 user/assistant/toolResult 消息，还原完整多轮对话。
/// 解析逐字段防御：content 结构变异（string vs blocks）或缺失时降级为空文本。
pub fn parse_session_turns(path: &Path) -> Result<Vec<SessionTurnDetail>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);
    let mut turns: Vec<SessionTurnDetail> = Vec::new();

    for (idx, line_res) in reader.lines().enumerate() {
        if idx == 0 {
            continue; // Skip header
        }
        let line = match line_res {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let val = match serde_json::from_str::<Value>(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if val.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        let msg_obj = match val.get("message") {
            Some(m) => m,
            None => continue,
        };
        let role = msg_obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let timestamp = val
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        match role {
            "user" => {
                let raw = extract_message_text(msg_obj.get("content"));
                let stripped = strip_runtime_context_rules(&raw);
                let (query, attachments) = split_user_prompt_attachments(&stripped);
                turns.push(SessionTurnDetail {
                    query,
                    attachments,
                    thinking_text: String::new(),
                    response_text: String::new(),
                    tool_calls: Vec::new(),
                    timestamp,
                    is_aborted: false,
                });
            }
            "assistant" => {
                // 防御：异常会话中 assistant 先于 user 出现时，兜底创建空提问轮次
                if turns.is_empty() {
                    turns.push(SessionTurnDetail {
                        query: String::new(),
                        attachments: Vec::new(),
                        thinking_text: String::new(),
                        response_text: String::new(),
                        tool_calls: Vec::new(),
                        timestamp,
                        is_aborted: false,
                    });
                }
                let turn = turns.last_mut().expect("turns is non-empty");

                let mut thinkings: Vec<String> = Vec::new();
                if let Some(arr) = msg_obj.get("content").and_then(|v| v.as_array()) {
                    for block in arr {
                        match block.get("type").and_then(|v| v.as_str()) {
                            Some("thinking") => {
                                if let Some(t) = block.get("thinking").and_then(|v| v.as_str()) {
                                    thinkings.push(t.to_string());
                                }
                            }
                            Some("toolCall") => {
                                let id = block
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let name = block
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("tool")
                                    .to_string();
                                let arguments_text = block
                                    .get("arguments")
                                    .map(|a| {
                                        serde_json::to_string_pretty(a).unwrap_or_default()
                                    })
                                    .unwrap_or_default();
                                turn.tool_calls.push(SessionToolCallDetail {
                                    id,
                                    name,
                                    arguments_text,
                                    result_text: None,
                                    is_error: false,
                                });
                            }
                            _ => {}
                        }
                    }
                }
                if !thinkings.is_empty() {
                    if !turn.thinking_text.is_empty() {
                        turn.thinking_text.push_str("\n\n");
                    }
                    turn.thinking_text.push_str(&thinkings.join("\n\n"));
                }

                // 回答正文取该轮最后一段非空 assistant 文本（中间 toolUse 轮的空白正文忽略）
                let text = extract_message_text(msg_obj.get("content"));
                let text = text.trim().to_string();
                if !text.is_empty() {
                    turn.response_text = text;
                }

                if msg_obj.get("stopReason").and_then(|v| v.as_str()) == Some("aborted") {
                    turn.is_aborted = true;
                }
            }
            "toolResult" => {
                if turns.is_empty() {
                    continue;
                }
                let tool_call_id = msg_obj
                    .get("toolCallId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let turn = turns.last_mut().expect("turns is non-empty");
                if let Some(tc) = turn.tool_calls.iter_mut().rev().find(|tc| tc.id == tool_call_id) {
                    let mut result = extract_message_text(msg_obj.get("content"));
                    // 截断超长工具结果，避免前端卡片与序列化体积过大
                    const MAX_RESULT_CHARS: usize = 4000;
                    if result.chars().count() > MAX_RESULT_CHARS {
                        result = result.chars().take(MAX_RESULT_CHARS).collect::<String>()
                            + "\n...(结果过长已截断)";
                    }
                    tc.result_text = Some(result);
                    tc.is_error = msg_obj
                        .get("isError")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                }
            }
            _ => {}
        }
    }

    Ok(turns)
}
