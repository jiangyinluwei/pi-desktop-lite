use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;


/// 获取 ~/.pi/agent 目录路径并确保其存在
pub fn get_pi_agent_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to find user home directory".to_string())?;
    let agent_dir = home.join(".pi").join("agent");
    if !agent_dir.exists() {
        fs::create_dir_all(&agent_dir)
            .map_err(|e| format!("Failed to create directory {:?}: {}", agent_dir, e))?;
    }
    Ok(agent_dir)
}

/// 获取 ~/.pi-dl 目录路径并确保其存在 (若不存在则自动新建)
pub fn get_pi_dl_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to find user home directory".to_string())?;
    let pi_dl_dir = home.join(".pi-dl");
    if !pi_dl_dir.exists() {
        fs::create_dir_all(&pi_dl_dir)
            .map_err(|e| format!("Failed to create directory {:?}: {}", pi_dl_dir, e))?;
    }
    Ok(pi_dl_dir)
}

/// 通用底层读取指定目录下的 JSON 配置文件
fn read_json_in(dir: PathBuf, filename: &str, default_val: Value) -> Result<Value, String> {
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(default_val);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    Ok(serde_json::from_str(&content).unwrap_or(default_val))
}

/// 通用底层写入指定目录下的 JSON 配置文件
fn write_json_in(dir: PathBuf, filename: &str, data: &Value) -> Result<(), String> {
    let path = dir.join(filename);
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize {}: {}", filename, e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))
}

/// 通用安全读取 ~/.pi-dl/ 下的 JSON 配置文件
pub fn read_pi_dl_json(filename: &str, default_val: Value) -> Result<Value, String> {
    read_json_in(get_pi_dl_dir()?, filename, default_val)
}

/// 通用安全写入 ~/.pi-dl/ 下的 JSON 配置文件
pub fn write_pi_dl_json(filename: &str, data: &Value) -> Result<(), String> {
    write_json_in(get_pi_dl_dir()?, filename, data)
}

/// 读取 ~/.pi-dl/config.json 应用全局持久化配置
#[tauri::command]
pub fn pi_get_app_config() -> Result<Value, String> {
    read_pi_dl_json("config.json", json!({}))
}

/// 写入 ~/.pi-dl/config.json 应用全局持久化配置 (含主题色、默认思考强度、所选模型、模型列表排序等)
#[tauri::command]
pub fn pi_save_app_config(config_data: Value) -> Result<(), String> {
    write_pi_dl_json("config.json", &config_data)
}

/// 检查用户是否配置了“不再提醒更新”（若为 true 则直接跳过启动自检与后台自动轮询）
pub fn is_update_notification_ignored() -> bool {
    if let Ok(config) = read_pi_dl_json("config.json", json!({})) {
        if let Some(ignored) = config.get("ignoreUpdateNotification").and_then(|v| v.as_bool()) {
            return ignored;
        }
    }
    false
}

/// 通用安全读取 ~/.pi/agent/ 下的 JSON 配置文件
pub fn read_agent_json(filename: &str, default_val: Value) -> Result<Value, String> {
    read_json_in(get_pi_agent_dir()?, filename, default_val)
}

/// 通用安全写入 ~/.pi/agent/ 下的 JSON 配置文件
pub fn write_agent_json(filename: &str, data: &Value) -> Result<(), String> {
    write_json_in(get_pi_agent_dir()?, filename, data)
}

/// 读取 auth.json
#[tauri::command]
pub fn pi_get_auth_config() -> Result<Value, String> {
    read_agent_json("auth.json", json!({}))
}

/// 写入 auth.json
#[tauri::command]
pub fn pi_save_auth_config(auth_data: Value) -> Result<(), String> {
    write_agent_json("auth.json", &auth_data)
}

/// 保存单个官方 Provider 的 API Key
#[tauri::command]
pub fn pi_save_provider_api_key(provider: String, api_key: String) -> Result<(), String> {
    let mut current_auth = pi_get_auth_config().unwrap_or_else(|_| json!({}));
    let map = current_auth.as_object_mut().ok_or_else(|| "auth.json is not an object".to_string())?;

    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        map.remove(&provider);
        if provider == "opencode-zen" || provider == "opencode-go" {
            if !map.contains_key("opencode-zen") && !map.contains_key("opencode-go") {
                map.remove("opencode");
            }
        }
    } else {
        let auth_obj = json!({
            "type": "api_key",
            "key": trimmed_key
        });
        map.insert(provider.clone(), auth_obj.clone());
        if provider == "opencode-zen" || provider == "opencode-go" {
            map.insert("opencode".to_string(), auth_obj);
        }
    }

    pi_save_auth_config(current_auth)
}

/// 读取 models.json (自定义模型与端点)
#[tauri::command]
pub fn pi_get_custom_models() -> Result<Value, String> {
    read_agent_json("models.json", json!({ "providers": {} }))
}

/// 写入 models.json
#[tauri::command]
pub fn pi_save_custom_models(models_data: Value) -> Result<(), String> {
    write_agent_json("models.json", &models_data)
}

/// 确保 custom_config 中包含合法的 providers Map 引用
fn ensure_providers_map_mut(custom_config: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !custom_config.is_object() {
        *custom_config = json!({ "providers": {} });
    }
    if let Some(root_obj) = custom_config.as_object_mut() {
        if !root_obj.contains_key("providers") || !root_obj["providers"].is_object() {
            root_obj.insert("providers".to_string(), json!({}));
        }
    }
    custom_config
        .get_mut("providers")
        .and_then(|v| v.as_object_mut())
        .expect("providers must be a map")
}

/// 保存或更新自定义运营商 (第一步)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProviderEntry {
    pub provider_id: String,
    pub api_type: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub supports_developer_role: Option<bool>,
    pub supports_reasoning_effort: Option<bool>,
}

#[tauri::command]
pub fn pi_save_custom_provider(entry: CustomProviderEntry) -> Result<(), String> {
    let mut custom_config = pi_get_custom_models().unwrap_or_else(|_| json!({ "providers": {} }));
    let provider_key = entry.provider_id.trim().to_lowercase();
    if provider_key.is_empty() {
        return Err("运营商标识 (Provider ID) 不能为空".to_string());
    }

    let api_type_str = entry.api_type.trim();
    let default_dev_role = api_type_str == "openai-responses";
    let compat_val = json!({
        "supportsDeveloperRole": entry.supports_developer_role.unwrap_or(default_dev_role),
        "supportsReasoningEffort": entry.supports_reasoning_effort.unwrap_or(false)
    });

    let providers = ensure_providers_map_mut(&mut custom_config);
    let p_obj = providers
        .entry(&provider_key)
        .or_insert_with(|| json!({ "models": [] }))
        .as_object_mut()
        .ok_or_else(|| "Provider entry is not an object".to_string())?;

    p_obj.insert("baseUrl".to_string(), json!(entry.base_url.trim()));
    p_obj.insert("api".to_string(), json!(api_type_str));
    p_obj.insert("compat".to_string(), compat_val);

    if let Some(key) = entry.api_key {
        let key_trimmed = key.trim();
        if !key_trimmed.is_empty() {
            p_obj.insert("apiKey".to_string(), json!(key_trimmed));
        } else {
            p_obj.remove("apiKey");
        }
    }

    if !p_obj.contains_key("models") || !p_obj["models"].is_array() {
        p_obj.insert("models".to_string(), json!([]));
    }

    pi_save_custom_models(custom_config)
}

/// 删除运营商及其全部关联模型
#[tauri::command]
pub fn pi_delete_custom_provider(provider_id: String) -> Result<(), String> {
    let mut custom_config = pi_get_custom_models().unwrap_or_else(|_| json!({ "providers": {} }));
    let providers = match custom_config.get_mut("providers").and_then(|p| p.as_object_mut()) {
        Some(p) => p,
        None => return Ok(()),
    };

    let provider_key = provider_id.trim().to_lowercase();
    providers.remove(&provider_key);
    pi_save_custom_models(custom_config)
}

/// 在指定运营商下添加或更新模型 (第二步)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProviderModelEntry {
    pub provider_id: String,
    pub model_id: String,
    pub model_name: Option<String>,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub reasoning: Option<bool>,
}

#[tauri::command]
pub fn pi_add_custom_provider_model(entry: CustomProviderModelEntry) -> Result<(), String> {
    let mut custom_config = pi_get_custom_models().unwrap_or_else(|_| json!({ "providers": {} }));
    let provider_key = entry.provider_id.trim().to_lowercase();
    if provider_key.is_empty() {
        return Err("运营商标识 (Provider ID) 不能为空".to_string());
    }

    let model_id_trimmed = entry.model_id.trim().to_string();
    if model_id_trimmed.is_empty() {
        return Err("模型标识 (Model ID) 不能为空".to_string());
    }

    let model_name = entry
        .model_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| model_id_trimmed.clone());

    let model_item = json!({
        "id": model_id_trimmed,
        "name": model_name.trim(),
        "contextWindow": entry.context_window.unwrap_or(64000),
        "maxTokens": entry.max_tokens.unwrap_or(4096),
        "reasoning": entry.reasoning.unwrap_or(false)
    });

    let providers = ensure_providers_map_mut(&mut custom_config);
    let p_obj = providers
        .get_mut(&provider_key)
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| format!("未找到运营商 [{}], 请先创建该运营商", provider_key))?;

    let models_arr = match p_obj.get_mut("models").and_then(|v| v.as_array_mut()) {
        Some(arr) => arr,
        None => return Err("models 字段不是合法数组".to_string()),
    };

    let mut found = false;
    for m in models_arr.iter_mut() {
        if m.get("id").and_then(|v| v.as_str()) == Some(entry.model_id.trim()) {
            *m = model_item.clone();
            found = true;
            break;
        }
    }
    if !found {
        models_arr.push(model_item);
    }

    pi_save_custom_models(custom_config)
}

/// 保存单个自定义 Provider / Model 到 models.json (兼容旧接口)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomModelEntry {
    pub provider_id: String,
    pub api_key: Option<String>,
    pub base_url: String,
    pub api_type: String,
    pub model_id: String,
    pub model_name: Option<String>,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub reasoning: Option<bool>,
}

#[tauri::command]
pub fn pi_add_custom_model(entry: CustomModelEntry) -> Result<(), String> {
    pi_save_custom_provider(CustomProviderEntry {
        provider_id: entry.provider_id.clone(),
        api_type: entry.api_type.clone(),
        base_url: entry.base_url.clone(),
        api_key: entry.api_key.clone(),
        supports_developer_role: None,
        supports_reasoning_effort: None,
    })?;

    pi_add_custom_provider_model(CustomProviderModelEntry {
        provider_id: entry.provider_id,
        model_id: entry.model_id,
        model_name: entry.model_name,
        context_window: entry.context_window,
        max_tokens: entry.max_tokens,
        reasoning: entry.reasoning,
    })
}

/// 删除自定义模型或整个 Provider
#[tauri::command]
pub fn pi_delete_custom_model(provider_id: String, model_id: Option<String>) -> Result<(), String> {
    let mut custom_config = pi_get_custom_models().unwrap_or_else(|_| json!({ "providers": {} }));
    let providers = ensure_providers_map_mut(&mut custom_config);
    let p_key = provider_id.trim();

    if let Some(target_mid) = model_id {
        let m_key = target_mid.trim();
        if let Some(p_val) = providers.get_mut(p_key).and_then(|v| v.as_object_mut()) {
            if let Some(models_arr) = p_val.get_mut("models").and_then(|v| v.as_array_mut()) {
                models_arr.retain(|m| {
                    m.get("id").and_then(|id_v| id_v.as_str()) != Some(m_key)
                });
            }
        }
    } else {
        providers.remove(p_key);
    }

    pi_save_custom_models(custom_config)
}

/// 读取 settings.json
#[tauri::command]
pub fn pi_get_settings_config() -> Result<Value, String> {
    read_agent_json("settings.json", json!({}))
}

/// 写入 settings.json
#[tauri::command]
pub fn pi_save_settings_config(settings_data: Value) -> Result<(), String> {
    write_agent_json("settings.json", &settings_data)
}

/// 向 Pi 内核 ~/.pi/agent/settings.json 探测式注入模型自动重连推荐配置 (best-effort, 失败静默)
///
/// 轨道 A (内核参数注入)：若内核识别重试键则让其自身按推荐值 (24 次 / 2-4-8s 退避) 重连；
/// 轨道 B (桌面 ModelFailoverEngine) 为行为主实现，无论本指令是否生效均能保证「恰好 24 次」语义。
/// 本指令对未知 schema 安全跳过、绝不报错，绝不阻断引擎自愈流水线。
#[tauri::command]
pub fn pi_apply_model_failover_preset(config: Value) -> Result<(), String> {
    let max_attempts = config
        .get("maxReconnectAttempts")
        .and_then(|v| v.as_u64())
        .unwrap_or(24);

    // 退避序列 (ms) 转为秒级数组供内核使用，并封顶 maxBackoffMs
    let backoff_secs: Vec<Value> = config
        .get("reconnectBackoffMs")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|ms| {
                    let s = ms.as_u64().unwrap_or(2000) / 1000;
                    Value::from(s.max(1))
                })
                .collect()
        })
        .unwrap_or_else(|| vec![Value::from(2u64), Value::from(4u64), Value::from(8u64)]);

    let max_backoff_secs = config
        .get("maxBackoffMs")
        .and_then(|v| v.as_u64())
        .map(|ms| (ms / 1000).max(1))
        .unwrap_or(8);

    let mut settings = pi_get_settings_config().unwrap_or_else(|_| json!({}));
    if !settings.is_object() {
        settings = json!({});
    }

    let retry_block = json!({
        "maxAttempts": max_attempts,
        "backoff": backoff_secs,
        "maxBackoffSeconds": max_backoff_secs
    });

    if let Some(obj) = settings.as_object_mut() {
        // 仅当内核 settings.json 未显式声明禁用重试时注入推荐值；
        // 已存在用户自定义 retry 配置则尊重原值不覆盖，避免破坏用户刻意调优。
        let has_user_retry = obj
            .get("retry")
            .map(|r| r.is_object())
            .unwrap_or(false);
        if !has_user_retry {
            obj.insert("retry".to_string(), retry_block);
        }
    }

    // 写回为 best-effort：失败仅记录日志，返回 Ok 绝不阻断前端引擎
    if let Err(e) = pi_save_settings_config(settings) {
        log::warn!("[config_manager] Failed to apply model failover preset: {}", e);
    }
    Ok(())
}

/// 官方通道与模型基础元数据目录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialProviderMeta {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub placeholder: String,
    pub doc_url: String,
    pub models: Vec<OfficialModelMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialModelMeta {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_window: u64,
    pub max_tokens: u64,
    pub reasoning: bool,
    #[serde(default)]
    pub is_default: bool,
}

/// 解析字符串格式的 Token 数量（如 "1M", "200K", "65.5K", "128000"）
pub fn parse_token_count(s: &str) -> u64 {
    let s = s.trim().to_uppercase();
    if let Some(num_str) = s.strip_suffix('M') {
        if let Ok(num) = num_str.parse::<f64>() {
            return (num * 1_000_000.0) as u64;
        }
    }
    if let Some(num_str) = s.strip_suffix('K') {
        if let Ok(num) = num_str.parse::<f64>() {
            return (num * 1_000.0) as u64;
        }
    }
    s.parse::<u64>().unwrap_or(8192)
}

/// 格式化模型显示名称
pub fn format_model_display_name(model_id: &str) -> String {
    let parts: Vec<&str> = model_id.split('-').collect();
    let formatted: Vec<String> = parts
        .iter()
        .map(|p| {
            let lower = p.to_lowercase();
            if lower == "gpt" || lower == "glm" || lower == "r1" || lower == "v3" || lower == "v4" || lower == "k3" || lower == "m3" || lower == "lpu" || lower == "api" {
                p.to_uppercase()
            } else if p.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                p.to_string()
            } else {
                let mut c = p.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            }
        })
        .collect();
    formatted.join(" ")
}

/// 从本地 Pi 内核动态执行 `pi --list-models` 获取实时发现的全部模型
pub fn fetch_models_from_pi_cli(app_handle: Option<&tauri::AppHandle>) -> Vec<OfficialModelMeta> {
    let pi_path = match crate::pi_runner::supervisor::PiSupervisor::find_pi_binary(app_handle) {
        Some(p) => p,
        None => return Vec::new(),
    };

    let mut cmd = std::process::Command::new(&pi_path);
    cmd.arg("--list-models");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = match cmd.output() {
        Ok(out) => out,
        Err(_) => return Vec::new(),
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout_str.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("provider") || line.starts_with("---") {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() >= 4 {
            let provider_raw = cols[0];
            let model_id = cols[1].to_string();
            let context_str = cols[2];
            let max_out_str = cols[3];
            let thinking_str = cols.get(4).copied().unwrap_or("no");

            let context_window = parse_token_count(context_str);
            let max_tokens = parse_token_count(max_out_str);
            let reasoning = thinking_str.eq_ignore_ascii_case("yes");
            let name = format_model_display_name(&model_id);

            results.push(OfficialModelMeta {
                id: model_id,
                name,
                provider: provider_raw.to_string(),
                context_window,
                max_tokens,
                reasoning,
                is_default: false,
            });
        }
    }

    results
}

/// 从远程官方 API 或 Pi 动态自省拉取指定服务商的最新可用模型并持久化缓存
#[tauri::command]
pub async fn pi_fetch_official_models(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<Vec<OfficialModelMeta>, String> {
    let provider_key = provider_id.trim().to_lowercase();
    let mut fetched_models: Vec<OfficialModelMeta> = Vec::new();

    // 1. 先通过 Pi 引擎自省读取已注册和可用模型
    let cli_models = fetch_models_from_pi_cli(Some(&app));
    for m in cli_models {
        if provider_key.starts_with("opencode") {
            if m.provider.eq_ignore_ascii_case("opencode") {
                if provider_key == "opencode-go" {
                    let id_lower = m.id.to_lowercase();
                    if id_lower.contains("deepseek")
                        || id_lower.contains("kimi")
                        || id_lower.contains("glm")
                        || id_lower.contains("qwen")
                        || id_lower.contains("minimax")
                        || id_lower.contains("pickle")
                        || id_lower.contains("hy3")
                        || id_lower.contains("mimo")
                        || id_lower.contains("muse")
                        || id_lower.contains("nemotron")
                    {
                        fetched_models.push(m);
                    }
                } else {
                    fetched_models.push(m);
                }
            }
        } else if m.provider.eq_ignore_ascii_case(&provider_key) {
            fetched_models.push(m);
        }
    }

    // 2. 针对 OpenRouter 官方公开端点直接请求最新列表
    if provider_key == "openrouter" {
        if let Ok(resp) = reqwest::Client::new()
            .get("https://openrouter.ai/api/v1/models")
            .header("User-Agent", "pi-desktop-lite")
            .timeout(std::time::Duration::from_secs(6))
            .send()
            .await
        {
            if let Ok(json_data) = resp.json::<Value>().await {
                if let Some(arr) = json_data.get("data").and_then(|d| d.as_array()) {
                    for item in arr {
                        if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                            let name = item.get("name").and_then(|n| n.as_str()).unwrap_or(id).to_string();
                            let context_window = item.get("context_length").and_then(|c| c.as_u64()).unwrap_or(128000);
                            let max_tokens = item.get("top_provider")
                                .and_then(|tp| tp.get("max_completion_tokens"))
                                .and_then(|m| m.as_u64())
                                .unwrap_or(8192);
                            let id_lower = id.to_lowercase();
                            let reasoning = id_lower.contains("reasoning")
                                || id_lower.contains("r1")
                                || id_lower.contains("o1")
                                || id_lower.contains("o3")
                                || id_lower.contains("thinking")
                                || id_lower.contains("sonnet");

                            if !fetched_models.iter().any(|m| m.id == id) {
                                fetched_models.push(OfficialModelMeta {
                                    id: id.to_string(),
                                    name,
                                    provider: "openrouter".to_string(),
                                    context_window,
                                    max_tokens,
                                    reasoning,
                                    is_default: false,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. 针对配置了 API Key 的官方服务商（OpenAI, DeepSeek, Groq 等），尝试请求官方 models 接口
    let auth = pi_get_auth_config().unwrap_or_else(|_| json!({}));
    let api_key = auth.get(&provider_key)
        .or_else(|| {
            if provider_key.starts_with("opencode") {
                auth.get("opencode")
            } else {
                None
            }
        })
        .and_then(|v| {
            if v.is_string() {
                v.as_str().map(|s| s.to_string())
            } else {
                v.get("key").and_then(|k| k.as_str()).map(|s| s.to_string())
            }
        });

    if let Some(key) = api_key {
        let (url, auth_header) = match provider_key.as_str() {
            "openai" => ("https://api.openai.com/v1/models", format!("Bearer {}", key)),
            "deepseek" => ("https://api.deepseek.com/models", format!("Bearer {}", key)),
            "groq" => ("https://api.groq.com/openai/v1/models", format!("Bearer {}", key)),
            "xai" => ("https://api.x.ai/v1/models", format!("Bearer {}", key)),
            _ => ("", String::new()),
        };

        if !url.is_empty() {
            if let Ok(resp) = reqwest::Client::new()
                .get(url)
                .header("Authorization", auth_header)
                .header("User-Agent", "pi-desktop-lite")
                .timeout(std::time::Duration::from_secs(6))
                .send()
                .await
            {
                if let Ok(json_data) = resp.json::<Value>().await {
                    if let Some(arr) = json_data.get("data").and_then(|d| d.as_array()) {
                        for item in arr {
                            if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                                if !fetched_models.iter().any(|m| m.id == id) {
                                    let id_lower = id.to_lowercase();
                                    let reasoning = id_lower.contains("o1")
                                        || id_lower.contains("o3")
                                        || id_lower.contains("reasoner")
                                        || id_lower.contains("r1")
                                        || id_lower.contains("thinking");
                                    fetched_models.push(OfficialModelMeta {
                                        id: id.to_string(),
                                        name: format_model_display_name(id),
                                        provider: provider_key.clone(),
                                        context_window: 128000,
                                        max_tokens: 8192,
                                        reasoning,
                                        is_default: false,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. 持久化缓存至 ~/.pi-dl/official_models_cache.json
    if !fetched_models.is_empty() {
        let mut cache = read_pi_dl_json("official_models_cache.json", json!({})).unwrap_or_else(|_| json!({}));
        if let Some(cache_map) = cache.as_object_mut() {
            cache_map.insert(provider_key.clone(), json!(fetched_models));
        }
        let _ = write_pi_dl_json("official_models_cache.json", &cache);
    }

    // 5. 如果拉取结果为空，返回内置保底列表
    if fetched_models.is_empty() {
        let catalog = get_builtin_official_catalog();
        if let Some(prov) = catalog.iter().find(|p| p.id.eq_ignore_ascii_case(&provider_key)) {
            return Ok(prov.models.clone());
        }
    }

    Ok(fetched_models)
}

/// 获取官方支持的服务商与其罗列的可用模型清单（合并本地 models.json、动态缓存与内置目录）
#[tauri::command]
pub fn pi_get_official_models_catalog() -> Result<Vec<OfficialProviderMeta>, String> {
    let mut catalog = get_builtin_official_catalog().to_vec();

    // 合并持久化缓存的官方拉取模型 (~/.pi-dl/official_models_cache.json)
    if let Ok(cache_val) = read_pi_dl_json("official_models_cache.json", json!({})) {
        if let Some(cache_obj) = cache_val.as_object() {
            for (prov_id, models_v) in cache_obj {
                if let Ok(models_list) = serde_json::from_value::<Vec<OfficialModelMeta>>(models_v.clone()) {
                    if let Some(prov) = catalog.iter_mut().find(|p| p.id.eq_ignore_ascii_case(prov_id)) {
                        for m in models_list {
                            if !prov.models.iter().any(|item| item.id == m.id) {
                                prov.models.push(m);
                            }
                        }
                    }
                }
            }
        }
    }

    // 合并 models.json 中用户自定义的挂载模型
    if let Ok(custom_val) = pi_get_custom_models() {
        if let Some(store_obj) = custom_val.get("providers").and_then(|p| p.as_object()) {
            for (provider_key, provider_val) in store_obj {
                if let Some(models_arr) = provider_val.get("models").and_then(|m| m.as_array()) {
                    let target_provider = catalog.iter_mut().find(|p| p.id.eq_ignore_ascii_case(provider_key));
                    let extra_models: Vec<OfficialModelMeta> = models_arr
                        .iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            let name = m.get("name").and_then(|n| n.as_str()).unwrap_or(&id).to_string();
                            let context_window = m.get("contextWindow").and_then(|c| c.as_u64()).unwrap_or(128000);
                            let max_tokens = m.get("maxTokens").and_then(|c| c.as_u64()).unwrap_or(8192);
                            let reasoning = m.get("reasoning").and_then(|r| r.as_bool()).unwrap_or(false);
                            Some(OfficialModelMeta {
                                id,
                                name,
                                provider: provider_key.clone(),
                                context_window,
                                max_tokens,
                                reasoning,
                                is_default: false,
                            })
                        })
                        .collect();

                    if let Some(prov) = target_provider {
                        for em in extra_models {
                            if !prov.models.iter().any(|m| m.id == em.id) {
                                prov.models.push(em);
                            }
                        }
                    } else if !extra_models.is_empty() {
                        catalog.push(OfficialProviderMeta {
                            id: provider_key.clone(),
                            name: provider_key.to_uppercase(),
                            desc: format!("Official {}", provider_key),
                            placeholder: "sk-...".to_string(),
                            doc_url: "".to_string(),
                            models: extra_models,
                        });
                    }
                }
            }
        }
    }

    Ok(catalog)
}

fn get_builtin_official_catalog() -> &'static [OfficialProviderMeta] {
    static CATALOG: std::sync::OnceLock<Vec<OfficialProviderMeta>> = std::sync::OnceLock::new();
    CATALOG.get_or_init(build_builtin_official_catalog)
}

fn build_builtin_official_catalog() -> Vec<OfficialProviderMeta> {
    vec![
        OfficialProviderMeta {
            id: "anthropic".to_string(),
            name: "Anthropic Claude".to_string(),
            desc: "Claude 3.7 / 3.5 系列模型，卓越的代码与多轮思考能力".to_string(),
            placeholder: "sk-ant-...".to_string(),
            doc_url: "https://console.anthropic.com/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "claude-3-7-sonnet-20250219".to_string(),
                    name: "Claude 3.7 Sonnet (Hybrid Thinking)".to_string(),
                    provider: "anthropic".to_string(),
                    context_window: 200000,
                    max_tokens: 64000,
                    reasoning: true,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "claude-3-5-sonnet-latest".to_string(),
                    name: "Claude 3.5 Sonnet (Latest)".to_string(),
                    provider: "anthropic".to_string(),
                    context_window: 200000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "claude-3-5-haiku-latest".to_string(),
                    name: "Claude 3.5 Haiku (Fast & Lightweight)".to_string(),
                    provider: "anthropic".to_string(),
                    context_window: 200000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "claude-3-opus-latest".to_string(),
                    name: "Claude 3 Opus (High Intelligence)".to_string(),
                    provider: "anthropic".to_string(),
                    context_window: 200000,
                    max_tokens: 4096,
                    reasoning: false,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            desc: "GPT-4o 与 o1/o3-mini 系列模型".to_string(),
            placeholder: "sk-...".to_string(),
            doc_url: "https://platform.openai.com/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "gpt-4o".to_string(),
                    name: "GPT-4o (Omni Multimodal)".to_string(),
                    provider: "openai".to_string(),
                    context_window: 128000,
                    max_tokens: 16384,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini (Fast & Efficient)".to_string(),
                    provider: "openai".to_string(),
                    context_window: 128000,
                    max_tokens: 16384,
                    reasoning: false,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "o3-mini".to_string(),
                    name: "o3-mini (High-speed Reasoning)".to_string(),
                    provider: "openai".to_string(),
                    context_window: 200000,
                    max_tokens: 100000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "o1".to_string(),
                    name: "o1 (Deep Reasoning)".to_string(),
                    provider: "openai".to_string(),
                    context_window: 200000,
                    max_tokens: 100000,
                    reasoning: true,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "deepseek".to_string(),
            name: "DeepSeek (深度求索)".to_string(),
            desc: "DeepSeek V3 / R1 原生官方直连 API".to_string(),
            placeholder: "sk-...".to_string(),
            doc_url: "https://platform.deepseek.com/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "deepseek-chat".to_string(),
                    name: "DeepSeek-V3 (Chat / General)".to_string(),
                    provider: "deepseek".to_string(),
                    context_window: 64000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "deepseek-reasoner".to_string(),
                    name: "DeepSeek-R1 (Full Reasoning)".to_string(),
                    provider: "deepseek".to_string(),
                    context_window: 64000,
                    max_tokens: 8192,
                    reasoning: true,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "google".to_string(),
            name: "Google Gemini".to_string(),
            desc: "Gemini 2.0 Flash / Pro 系列大模型".to_string(),
            placeholder: "AIzaSy...".to_string(),
            doc_url: "https://aistudio.google.com/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "gemini-2.0-flash".to_string(),
                    name: "Gemini 2.0 Flash (Fast & Capable)".to_string(),
                    provider: "google".to_string(),
                    context_window: 1048576,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "gemini-2.0-flash-thinking-exp".to_string(),
                    name: "Gemini 2.0 Flash Thinking Exp".to_string(),
                    provider: "google".to_string(),
                    context_window: 1048576,
                    max_tokens: 65536,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "gemini-2.0-pro-exp-02-05".to_string(),
                    name: "Gemini 2.0 Pro Experimental".to_string(),
                    provider: "google".to_string(),
                    context_window: 2097152,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "opencode-zen".to_string(),
            name: "OpenCode Zen".to_string(),
            desc: "OpenCode Zen 按量计费服务，按需调用 Claude、GPT-5、Gemini 3.7、DeepSeek 等顶尖模型".to_string(),
            placeholder: "sk-...".to_string(),
            doc_url: "https://opencode.ai/zen".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "claude-sonnet-4-5".to_string(),
                    name: "Claude Sonnet 4.5".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1000000,
                    max_tokens: 64000,
                    reasoning: true,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "claude-opus-4-5".to_string(),
                    name: "Claude Opus 4.5".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 200000,
                    max_tokens: 64000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "claude-haiku-4-5".to_string(),
                    name: "Claude Haiku 4.5".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 200000,
                    max_tokens: 64000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "gemini-3.7-flash".to_string(),
                    name: "Gemini 3.7 Flash (Hybrid Thinking)".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1048576,
                    max_tokens: 65536,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "gemini-3.5-flash".to_string(),
                    name: "Gemini 3.5 Flash".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1048576,
                    max_tokens: 65536,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "gpt-5.4".to_string(),
                    name: "GPT-5.4 (Reasoning)".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 272000,
                    max_tokens: 128000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "gpt-5.2".to_string(),
                    name: "GPT-5.2".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 400000,
                    max_tokens: 128000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "gpt-5.1-codex".to_string(),
                    name: "GPT-5.1 Codex (Code Specialized)".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 400000,
                    max_tokens: 128000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "deepseek-v4-pro".to_string(),
                    name: "DeepSeek V4 Pro".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1000000,
                    max_tokens: 384000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "grok-4.6".to_string(),
                    name: "Grok 4.6".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 500000,
                    max_tokens: 500000,
                    reasoning: true,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "opencode-go".to_string(),
            name: "OpenCode Go".to_string(),
            desc: "OpenCode Go 月费订阅服务 ($10/月)，高频/低成本调用精选开源前沿代码模型".to_string(),
            placeholder: "sk-...".to_string(),
            doc_url: "https://opencode.ai/go".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "deepseek-v4-flash".to_string(),
                    name: "DeepSeek V4 Flash (Fast)".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1000000,
                    max_tokens: 384000,
                    reasoning: true,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "deepseek-v4-pro".to_string(),
                    name: "DeepSeek V4 Pro".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1000000,
                    max_tokens: 384000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "kimi-k3".to_string(),
                    name: "Kimi K3 (1M Context)".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1000000,
                    max_tokens: 131072,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "kimi-k2.7-code".to_string(),
                    name: "Kimi K2.7 Code".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 262144,
                    max_tokens: 262144,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "glm-5.2".to_string(),
                    name: "GLM 5.2 (1M Context)".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 1000000,
                    max_tokens: 131072,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "qwen3.6-plus".to_string(),
                    name: "Qwen 3.6 Plus".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 262144,
                    max_tokens: 65536,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "minimax-m3".to_string(),
                    name: "MiniMax M3".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 512000,
                    max_tokens: 128000,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "big-pickle".to_string(),
                    name: "Big Pickle (Reasoning)".to_string(),
                    provider: "opencode".to_string(),
                    context_window: 200000,
                    max_tokens: 32000,
                    reasoning: true,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            desc: "统一接入数百种全球大模型与路由平台".to_string(),
            placeholder: "sk-or-v1-...".to_string(),
            doc_url: "https://openrouter.ai/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "anthropic/claude-3.7-sonnet".to_string(),
                    name: "Claude 3.7 Sonnet (via OpenRouter)".to_string(),
                    provider: "openrouter".to_string(),
                    context_window: 200000,
                    max_tokens: 64000,
                    reasoning: true,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "deepseek/deepseek-r1".to_string(),
                    name: "DeepSeek R1 (via OpenRouter)".to_string(),
                    provider: "openrouter".to_string(),
                    context_window: 128000,
                    max_tokens: 8192,
                    reasoning: true,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "openai/gpt-4o".to_string(),
                    name: "GPT-4o (via OpenRouter)".to_string(),
                    provider: "openrouter".to_string(),
                    context_window: 128000,
                    max_tokens: 16384,
                    reasoning: false,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "qwen-token-plan".to_string(),
            name: "通义千问 (Qwen DashScope)".to_string(),
            desc: "阿里云百炼大模型服务与 Qwen Coder".to_string(),
            placeholder: "sk-sp-...".to_string(),
            doc_url: "https://dashscope.aliyun.com/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "qwen-max-latest".to_string(),
                    name: "Qwen Max (通义千问旗舰)".to_string(),
                    provider: "qwen-token-plan".to_string(),
                    context_window: 32000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "qwen-plus-latest".to_string(),
                    name: "Qwen Plus (平衡加速)".to_string(),
                    provider: "qwen-token-plan".to_string(),
                    context_window: 128000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: false,
                },
                OfficialModelMeta {
                    id: "qwen-coder-plus-latest".to_string(),
                    name: "Qwen Coder Plus (代码强化)".to_string(),
                    provider: "qwen-token-plan".to_string(),
                    context_window: 128000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "kimi-coding".to_string(),
            name: "月之暗面 (Kimi / Moonshot)".to_string(),
            desc: "超长文本上下文与深度代码分析".to_string(),
            placeholder: "sk-...".to_string(),
            doc_url: "https://platform.moonshot.cn/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "moonshot-v1-128k".to_string(),
                    name: "Moonshot v1 128k".to_string(),
                    provider: "kimi-coding".to_string(),
                    context_window: 128000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "moonshot-v1-32k".to_string(),
                    name: "Moonshot v1 32k".to_string(),
                    provider: "kimi-coding".to_string(),
                    context_window: 32000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "minimax".to_string(),
            name: "MiniMax (名之梦)".to_string(),
            desc: "MiniMax Text-01 与中文理解模型".to_string(),
            placeholder: "sk-...".to_string(),
            doc_url: "https://api.minimax.chat/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "MiniMax-Text-01".to_string(),
                    name: "MiniMax Text-01 (1M Context)".to_string(),
                    provider: "minimax".to_string(),
                    context_window: 1000000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "abab6.5s-chat".to_string(),
                    name: "abab 6.5s Chat (Speed)".to_string(),
                    provider: "minimax".to_string(),
                    context_window: 245000,
                    max_tokens: 4096,
                    reasoning: false,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "groq".to_string(),
            name: "Groq (LPU 极速推理)".to_string(),
            desc: "超高每秒 token 吞吐量".to_string(),
            placeholder: "gsk_...".to_string(),
            doc_url: "https://console.groq.com/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "llama-3.3-70b-versatile".to_string(),
                    name: "Llama 3.3 70B Versatile".to_string(),
                    provider: "groq".to_string(),
                    context_window: 128000,
                    max_tokens: 32768,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "deepseek-r1-distill-llama-70b".to_string(),
                    name: "DeepSeek R1 Distill Llama 70B".to_string(),
                    provider: "groq".to_string(),
                    context_window: 128000,
                    max_tokens: 8192,
                    reasoning: true,
                    is_default: false,
                },
            ],
        },
        OfficialProviderMeta {
            id: "xai".to_string(),
            name: "xAI (Grok)".to_string(),
            desc: "xAI Grok-2 与视觉模型".to_string(),
            placeholder: "xai-...".to_string(),
            doc_url: "https://console.x.ai/".to_string(),
            models: vec![
                OfficialModelMeta {
                    id: "grok-2-latest".to_string(),
                    name: "Grok-2 Latest".to_string(),
                    provider: "xai".to_string(),
                    context_window: 128000,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: true,
                },
                OfficialModelMeta {
                    id: "grok-2-vision-latest".to_string(),
                    name: "Grok-2 Vision Latest".to_string(),
                    provider: "xai".to_string(),
                    context_window: 32768,
                    max_tokens: 8192,
                    reasoning: false,
                    is_default: false,
                },
            ],
        },
    ]
}


