use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

static API_KEY_REGEXES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // Anthropic key
        Regex::new(r"sk-ant-[a-zA-Z0-9_\-]{20,}").unwrap(),
        // Generic OpenAI / others key
        Regex::new(r"sk-[a-zA-Z0-9_\-]{20,}").unwrap(),
        // GitHub Token
        Regex::new(r"ghp_[a-zA-Z0-9]{20,}").unwrap(),
        // Bearer token
        Regex::new(r"(?i)Bearer\s+([a-zA-Z0-9_\-\.]{20,})").unwrap(),
        // Basic auth tokens
        Regex::new(r"(?i)(authorization|password|secret|api_key)\s*[:=]\s*([^\s,;]+)").unwrap(),
    ]
});

static HOME_DIR_STR: Lazy<Option<String>> = Lazy::new(|| {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
});

/// 脱敏字符串中的 API Key、敏感 Token 及本地用户隐私目录
pub fn redact_str(input: &str) -> String {
    let mut result = input.to_string();

    // 1. 替换本地私有主目录路径
    if let Some(ref home) = *HOME_DIR_STR {
        if !home.is_empty() {
            result = result.replace(home, "[USER_HOME]");
            // 同时兼容 Windows 下的反斜杠与正斜杠形式
            let home_slash = home.replace('\\', "/");
            if home_slash != *home {
                result = result.replace(&home_slash, "[USER_HOME]");
            }
        }
    }

    // 2. 替换 API Key 与 Token
    for re in API_KEY_REGEXES.iter() {
        result = re
            .replace_all(&result, |caps: &regex::Captures| {
                let full = caps.get(0).map(|m| m.as_str()).unwrap_or("");
                if full.starts_with("sk-ant-") {
                    "sk-ant-***[REDACTED]***".to_string()
                } else if full.starts_with("sk-") {
                    "sk-***[REDACTED]***".to_string()
                } else if full.starts_with("ghp_") {
                    "ghp_***[REDACTED]***".to_string()
                } else if full.to_lowercase().starts_with("bearer ") {
                    "Bearer ***[REDACTED]***".to_string()
                } else {
                    "***[REDACTED_SECRET]***".to_string()
                }
            })
            .to_string();
    }

    result
}

/// 递归脱敏 JSON 中的字符串值
pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(redact_str(s)),
        Value::Array(arr) => Value::Array(arr.iter().map(redact_json).collect()),
        Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (k, v) in map {
                let k_lower = k.to_lowercase();
                if k_lower.contains("key")
                    || k_lower.contains("secret")
                    || k_lower.contains("token")
                    || k_lower.contains("password")
                    || k_lower.contains("auth")
                {
                    if let Value::String(_) = v {
                        new_map.insert(k.clone(), Value::String("***[REDACTED]***".to_string()));
                        continue;
                    }
                }
                new_map.insert(k.clone(), redact_json(v));
            }
            Value::Object(new_map)
        }
        _ => value.clone(),
    }
}
