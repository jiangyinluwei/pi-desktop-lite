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

/// 剥离宿主运行态注入的所有上下文信封（如 <runtime_context_rules>, <code_area_routing_context> 等），还原真实用户提问
pub fn strip_injected_contexts(text: &str) -> String {
    let mut result = text.to_string();

    // 1. 已知确定的注入信封标签对列表
    let known_tags = [
        ("runtime_context_rules", "runtime_context_rules"),
        ("code_area_routing_context", "code_area_routing_context"),
        ("workspace_context", "workspace_context"),
        ("runtime_rules", "runtime_rules"),
        ("inner_skills_context", "inner_skills_context"),
        ("inner_skill_rules", "inner_skill_rules"),
        ("prompt_context", "prompt_context"),
    ];

    for (open_name, close_name) in known_tags {
        let open_tag = format!("<{}>", open_name);
        let close_tag = format!("</{}>", close_name);
        while let Some(start) = result.find(&open_tag) {
            if let Some(rel_end) = result[start..].find(&close_tag) {
                let end = start + rel_end + close_tag.len();
                let mut new_res = String::from(&result[..start]);
                new_res.push_str(&result[end..]);
                result = new_res;
            } else {
                result.truncate(start);
                break;
            }
        }
    }

    // 2. 通用 XML-like context/rules 标签对清洗（防御未来新增的注入标签）
    loop {
        let mut found = false;
        if let Some(open_idx) = result.find('<') {
            if let Some(close_idx) = result[open_idx..].find('>') {
                let tag_content = &result[open_idx + 1..open_idx + close_idx];
                let tag_name = tag_content.trim();
                if (tag_name.ends_with("_context")
                    || tag_name.ends_with("_rules")
                    || tag_name.contains("context")
                    || tag_name.contains("rules"))
                    && !tag_name.starts_with('/')
                    && !tag_name.is_empty()
                    && tag_name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                {
                    let end_tag = format!("</{}>", tag_name);
                    if let Some(rel_close) = result[open_idx..].find(&end_tag) {
                        let end_pos = open_idx + rel_close + end_tag.len();
                        let mut new_res = String::from(&result[..open_idx]);
                        new_res.push_str(&result[end_pos..]);
                        result = new_res;
                        found = true;
                    }
                }
            }
        }
        if !found {
            break;
        }
    }

    result.trim().to_string()
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
                        let raw = extract_message_text(msg_obj.get("content"));
                        let clean = clean_user_prompt(&raw);
                        if !clean.is_empty() {
                            prompts.push(clean);
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
                let (query, attachments) = split_user_prompt_attachments(&raw);
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
