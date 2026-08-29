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
                    if first_message.is_none() {
                        if let Some(msg_obj) = val.get("message") {
                            let role = msg_obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
                            if role == "user" {
                                if let Some(content) = msg_obj.get("content") {
                                    if let Some(text) = content.as_str() {
                                        first_message = Some(text.chars().take(100).collect());
                                    } else if let Some(arr) = content.as_array() {
                                        for item in arr {
                                            if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                                                first_message = Some(t.chars().take(100).collect());
                                                break;
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
