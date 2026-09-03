use once_cell::sync::Lazy;
use regex::Regex;
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
                            // 剥离运行态注入信封与附件后判定是否为真实用户提问（摘要同样使用净化后文本）
                            let raw = extract_message_text(msg_obj.get("content"));
                            let clean = clean_user_prompt(&raw);
                            if !clean.is_empty() {
                                pending_query = true;
                                if first_message.is_none() {
                                    first_message = Some(clean.chars().take(100).collect());
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
                let raw = extract_message_text(msg_obj.get("content"));
                let clean = clean_user_prompt(&raw);
                if !clean.is_empty() {
                    text_preview = Some(clean.chars().take(80).collect());
                } else if !raw.trim().is_empty() {
                    text_preview = Some(raw.trim().chars().take(80).collect());
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

const KNOWN_TAG_NAMES: &[&str] = &[
    "runtime_context_rules",
    "runtime_inner_skills",
    "runtime_inner_skill",
    "code_area_routing_context",
    "routed_agents_md",
    "routed_readme_md",
    "routed_project_skills",
    "routed_skill",
    "workspace_context",
    "runtime_rules",
    "inner_skills_context",
    "inner_skill_rules",
    "prompt_context",
];

static KNOWN_INJECTED_TAGS_REGEX: Lazy<Regex> = Lazy::new(|| {
    let patterns: Vec<String> = KNOWN_TAG_NAMES
        .iter()
        .map(|tag| format!(r#"<{}(?:\s[^>]*)?>.*?</{}>"#, tag, tag))
        .collect();
    Regex::new(&format!(r#"(?is)(?:{})"#, patterns.join("|"))).unwrap()
});

static UNCLOSED_KNOWN_TAGS_REGEX: Lazy<Regex> = Lazy::new(|| {
    let patterns: Vec<String> = KNOWN_TAG_NAMES
        .iter()
        .map(|tag| format!(r#"<{}(?:\s[^>]*)?>.*$"#, tag))
        .collect();
    Regex::new(&format!(r#"(?is)(?:{})"#, patterns.join("|"))).unwrap()
});

static GENERIC_OPEN_TAG_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<([a-zA-Z0-9_-]*(?:context|rules|skill|routing)[a-zA-Z0-9_-]*)(?:\s[^>]*)?>"#).unwrap()
});

fn strip_generic_tags(mut text: String) -> String {
    let mut search_from = 0;
    while search_from < text.len() {
        let captures = match GENERIC_OPEN_TAG_REGEX.captures(&text[search_from..]) {
            Some(c) => c,
            None => break,
        };

        let full_match = captures.get(0).unwrap();
        let tag_name = captures.get(1).unwrap().as_str().to_lowercase();
        let open_start = search_from + full_match.start();
        let open_end = search_from + full_match.end();
        let close_tag = format!("</{}>", tag_name);

        let rest = &text[open_end..];
        if let Some(rel_close) = rest.to_lowercase().find(&close_tag) {
            let close_end = open_end + rel_close + close_tag.len();
            text.replace_range(open_start..close_end, "");
            search_from = open_start;
        } else {
            // 未闭合标签：游标向前推进，避免死循环短路，同时确保后续真实标签不被漏剥离
            search_from = open_end;
        }
    }
    text
}

/// 剥离宿主运行态注入的所有上下文信封（如 <runtime_context_rules>, <runtime_inner_skill name="..."> 等），还原真实用户提问
pub fn strip_injected_contexts(text: &str) -> String {
    let mut current = text.to_string();

    // 循环剥离以支持可能的多层信封嵌套（如 <runtime_inner_skills> 内嵌 <runtime_inner_skill name="...">）
    for _ in 0..4 {
        let after_known = KNOWN_INJECTED_TAGS_REGEX.replace_all(&current, "").to_string();
        let after_generic = strip_generic_tags(after_known);
        if after_generic == current {
            break;
        }
        current = after_generic;
    }

    // 针对流式截断或未闭合已知信封做末尾兜底清理
    let final_clean = UNCLOSED_KNOWN_TAGS_REGEX.replace_all(&current, "").to_string();
    final_clean.trim().to_string()
}

/// 兼容旧命名别名
#[inline]
pub fn strip_runtime_context_rules(text: &str) -> String {
    strip_injected_contexts(text)
}

const ATTACHMENT_MARKERS: &[&str] = &[
    "[附带本地文件/目录绝对路径]:",
    "[附带本地文件绝对路径]:",
    "[附带本地目录绝对路径]:",
    "[附带本地文件路径]:",
    "[附带本地目录路径]:",
    "[附带文件绝对路径]:",
    "[附带文件路径]:",
];

/// 清洗用户提问文本：剥离注入信封、附件清单以及引导提示语
pub fn clean_user_prompt(text: &str) -> String {
    let text_no_contexts = strip_injected_contexts(text);
    let mut raw = text_no_contexts.as_str();
    let mut earliest_pos = None;

    for marker in ATTACHMENT_MARKERS {
        if let Some(pos) = raw.find(marker) {
            match earliest_pos {
                Some(p) if pos < p => earliest_pos = Some(pos),
                None => earliest_pos = Some(pos),
                _ => {}
            }
        }
    }

    if let Some(pos) = earliest_pos {
        raw = &raw[..pos];
    }

    let mut cleaned = raw.trim().to_string();

    // 剔除末尾可能残留的目录引导语
    if let Some(pos) = cleaned.find("（提示：附带项目中包含本地目录") {
        cleaned.truncate(pos);
        cleaned = cleaned.trim().to_string();
    }
    if let Some(pos) = cleaned.find("(提示：附带项目中包含本地目录") {
        cleaned.truncate(pos);
        cleaned = cleaned.trim().to_string();
    }

    // 针对纯附件对话时的系统默认占位前缀，还原为空字符串以触发前端 "[附带 N 个文件/图片]" 展示
    if cleaned == "请查阅并分析以下本地文件/目录："
        || cleaned == "请查阅并分析以下本地文件/目录:"
        || cleaned == "请查阅并分析以下本地文件："
        || cleaned == "请查阅并分析以下本地文件:"
        || cleaned == "请查阅并分析以下本地目录："
        || cleaned == "请查阅并分析以下本地目录:"
    {
        cleaned.clear();
    }

    cleaned
}

/// 从用户提问尾注中提取附带本地文件/目录路径列表
pub fn split_user_prompt_attachments(text: &str) -> (String, Vec<String>) {
    let text_no_contexts = strip_injected_contexts(text);
    let mut earliest_pos = None;
    let mut marker_len = 0;

    for marker in ATTACHMENT_MARKERS {
        if let Some(pos) = text_no_contexts.find(marker) {
            match earliest_pos {
                Some(p) if pos < p => {
                    earliest_pos = Some(pos);
                    marker_len = marker.len();
                }
                None => {
                    earliest_pos = Some(pos);
                    marker_len = marker.len();
                }
                _ => {}
            }
        }
    }

    let attachments: Vec<String> = match earliest_pos {
        Some(pos) => {
            let after_marker = &text_no_contexts[pos + marker_len..];
            let mut paths = Vec::new();
            for line in after_marker.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed.starts_with("（提示：")
                    || trimmed.starts_with("(提示：")
                    || trimmed.starts_with('<')
                    || (trimmed.starts_with('[') && !trimmed.starts_with("- [") && !trimmed.starts_with("* ["))
                {
                    continue;
                }
                let mut path_str = trimmed;
                if path_str.starts_with('-') || path_str.starts_with('*') {
                    path_str = path_str[1..].trim();
                }
                if let Some(idx) = path_str.find("]:") {
                    path_str = path_str[idx + 2..].trim();
                } else if let Some(idx) = path_str.find("]: ") {
                    path_str = path_str[idx + 3..].trim();
                } else if let Some(idx) = path_str.find(':') {
                    let prefix = &path_str[..idx];
                    if prefix.contains("文件")
                        || prefix.contains("目录")
                        || prefix.eq_ignore_ascii_case("folder")
                        || prefix.eq_ignore_ascii_case("file")
                    {
                        path_str = path_str[idx + 1..].trim();
                    }
                }
                let clean_path = path_str
                    .trim()
                    .trim_matches(',')
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim();
                if !clean_path.is_empty() {
                    paths.push(clean_path.to_string());
                }
            }
            paths
        }
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

fn parse_prompt_timestamp(val: &Value, msg_obj: Option<&Value>, fallback_ms: i64) -> i64 {
    if let Some(msg) = msg_obj {
        if let Some(ms) = msg.get("timestamp").and_then(|v| v.as_i64()) {
            return ms;
        }
        if let Some(ts_str) = msg.get("timestamp").and_then(|v| v.as_str()) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                return dt.timestamp_millis();
            }
        }
    }
    if let Some(ms) = val.get("timestamp").and_then(|v| v.as_i64()) {
        return ms;
    }
    if let Some(ts_str) = val.get("timestamp").and_then(|v| v.as_str()) {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
            return dt.timestamp_millis();
        }
    }
    fallback_ms
}

/// 从单个 .jsonl 会话文件中提取带时间戳的用户提问 (timestamp_millis, clean_prompt)
pub fn extract_timestamped_prompts_from_session(path: &Path) -> Vec<(i64, String)> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let file_mod_time = file
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let reader = BufReader::new(file);
    let mut prompts = Vec::new();
    let mut last_ts = 0i64;

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
                        let raw = extract_message_text(msg_obj.get("content"));
                        let clean = clean_user_prompt(&raw);
                        if !clean.is_empty() {
                            let fallback = if last_ts > 0 { last_ts + 1 } else { file_mod_time };
                            let ts = parse_prompt_timestamp(&val, Some(msg_obj), fallback);
                            last_ts = ts;
                            prompts.push((ts, clean));
                        }
                    }
                }
            }
        }
    }
    prompts
}

/// 从单个 .jsonl 会话文件中提取所有真实用户提问 (role: "user")
pub fn extract_user_prompts_from_session(path: &Path) -> Vec<String> {
    extract_timestamped_prompts_from_session(path)
        .into_iter()
        .map(|(_, text)| text)
        .collect()
}

// ==========================================================================
// 会话完整轮次解析（供 Flow 界面历史还原使用）
// ==========================================================================

/// 工具调用详情：用于会话历史还原工具卡片
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionToolCallDetail {
    pub id: String,
    pub name: String,
    pub arguments_text: String,
    pub result_text: Option<String>,
    pub is_error: bool,
}

/// 会话流步骤详情（交织思维链与工具调用时序切片）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionStepDetail {
    Thinking {
        text: String,
    },
    Tool {
        id: String,
        name: String,
        arguments_text: String,
        result_text: Option<String>,
        is_error: bool,
    },
}

/// 单轮对话详情：一次用户提问 + 后续 assistant 思考 / 工具调用 / 最终回答
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTurnDetail {
    pub query: String,
    pub attachments: Vec<String>,
    pub thinking_text: String,
    pub response_text: String,
    pub tool_calls: Vec<SessionToolCallDetail>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<SessionStepDetail>,
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
                let (query, attachments) = split_user_prompt_attachments(&raw);
                turns.push(SessionTurnDetail {
                    query,
                    attachments,
                    thinking_text: String::new(),
                    response_text: String::new(),
                    tool_calls: Vec::new(),
                    steps: Vec::new(),
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
                        steps: Vec::new(),
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
                                    turn.steps.push(SessionStepDetail::Thinking {
                                        text: t.to_string(),
                                    });
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
                                    id: id.clone(),
                                    name: name.clone(),
                                    arguments_text: arguments_text.clone(),
                                    result_text: None,
                                    is_error: false,
                                });
                                turn.steps.push(SessionStepDetail::Tool {
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
                let mut result = extract_message_text(msg_obj.get("content"));
                // 截断超长工具结果，避免前端卡片与序列化体积过大
                const MAX_RESULT_CHARS: usize = 4000;
                if result.chars().count() > MAX_RESULT_CHARS {
                    result = result.chars().take(MAX_RESULT_CHARS).collect::<String>()
                        + "\n...(结果过长已截断)";
                }
                let is_error = msg_obj
                    .get("isError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                if let Some(tc) = turn.tool_calls.iter_mut().rev().find(|tc| tc.id == tool_call_id) {
                    tc.result_text = Some(result.clone());
                    tc.is_error = is_error;
                }
                if let Some(step) = turn.steps.iter_mut().rev().find(|s| match s {
                    SessionStepDetail::Tool { id, .. } => id == tool_call_id,
                    _ => false,
                }) {
                    if let SessionStepDetail::Tool { result_text, is_error: step_err, .. } = step {
                        *result_text = Some(result);
                        *step_err = is_error;
                    }
                }
            }
            _ => {}
        }
    }

    Ok(turns)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_injected_contexts() {
        let raw = "<runtime_context_rules>\nSome rules...\n</runtime_context_rules>\n\nHello World\n\n<code_area_routing_context>\nTarget: /path\n</code_area_routing_context>";
        let stripped = strip_injected_contexts(raw);
        assert_eq!(stripped, "Hello World");
    }

    #[test]
    fn test_strip_injected_contexts_with_attributes_and_nesting() {
        // 1. 单个带属性标签剥离
        let raw1 = "<runtime_inner_skill name=\"windows-bash-compatibility\">\nBash rules\n</runtime_inner_skill>\n\nHello World";
        assert_eq!(strip_injected_contexts(raw1), "Hello World");

        // 2. 多个带属性标签与路由信封
        let raw2 = "<routed_agents_md filename=\"AGENTS.md\">\n# AGENTS RULES\n</routed_agents_md>\n\n分析目标项目\n\n<routed_readme_md filename=\"README.md\">\n# README\n</routed_readme_md>";
        assert_eq!(strip_injected_contexts(raw2), "分析目标项目");

        // 3. 嵌套信封剥离
        let raw3 = "<runtime_inner_skills>\n<runtime_inner_skill name=\"subagent\">\nsubagent rules\n</runtime_inner_skill>\n</runtime_inner_skills>\n\n帮我写一个测试";
        assert_eq!(strip_injected_contexts(raw3), "帮我写一个测试");

        // 4. 未闭合截断信封兜底清理
        let raw4 = "用户提问\n\n<runtime_inner_skill name=\"unclosed\">\n未闭合流式截断内容";
        assert_eq!(strip_injected_contexts(raw4), "用户提问");

        // 5. 普通 HTML 标签保护（不被误删）
        let raw5 = "How to style <div class=\"container\">hello</div> in HTML?";
        assert_eq!(strip_injected_contexts(raw5), "How to style <div class=\"container\">hello</div> in HTML?");

        // 6. 前置未闭合伪标签不影响后续真实标签剥离 (H5 防短路)
        let raw6 = "前置未闭合伪标签 <custom_context> 文本内容，后续标签 <custom_rules>\n真实规则\n</custom_rules>\n\n真正的用户提问";
        assert_eq!(strip_injected_contexts(raw6), "前置未闭合伪标签 <custom_context> 文本内容，后续标签 \n\n真正的用户提问");
    }

    #[test]
    fn test_clean_user_prompt_with_attachments_and_guidance() {
        let raw = "<runtime_context_rules>\nRULES\n</runtime_context_rules>\n\n分析这个项目结构\n\n[附带本地文件/目录绝对路径]:\n- [目录/Folder]: C:/Users/test/project\n\n（提示：附带项目中包含本地目录，请主动遍历检索其中的文件；若发现包含 .docx、.doc、.pdf、.pptx、.xlsx 或图像等格式，请自动调用专门的 OCR 或文档解析组件读取真实内容并深入分析）\n\n<code_area_routing_context>\nTarget: C:/Users/test/project\n</code_area_routing_context>";
        let clean = clean_user_prompt(raw);
        assert_eq!(clean, "分析这个项目结构");

        let (query, attachments) = split_user_prompt_attachments(raw);
        assert_eq!(query, "分析这个项目结构");
        assert_eq!(attachments, vec!["C:/Users/test/project"]);
    }

    #[test]
    fn test_clean_user_prompt_attachments_only() {
        let raw = "请查阅并分析以下本地文件/目录：\n\n[附带本地文件/目录绝对路径]:\n- [文件/code]: C:/test.rs";
        let clean = clean_user_prompt(raw);
        assert_eq!(clean, "");

        let (query, attachments) = split_user_prompt_attachments(raw);
        assert_eq!(query, "");
        assert_eq!(attachments, vec!["C:/test.rs"]);
    }
}
