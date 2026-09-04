use serde_json::{json, Value};
use super::io::{read_agent_json, write_agent_json, read_pi_dl_json, write_pi_dl_json};
use super::schema::{
    CustomProviderEntry, CustomProviderModelEntry, CustomModelEntry,
    OfficialModelMeta, OfficialProviderMeta,
    parse_token_count, format_model_display_name, get_builtin_official_catalog,
};


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

/// 动态从指定自定义运营商端点拉取模型列表
#[tauri::command]
pub async fn pi_fetch_custom_provider_models(
    provider_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
    api_type: Option<String>,
) -> Result<Vec<OfficialModelMeta>, String> {
    let p_key = provider_id.trim().to_lowercase();

    // 1. 读取或回退已保存的配置
    let custom_config = pi_get_custom_models().unwrap_or_else(|_| json!({ "providers": {} }));
    let prov_obj = custom_config
        .get("providers")
        .and_then(|p| p.get(&p_key))
        .and_then(|v| v.as_object());

    let final_base_url = base_url
        .filter(|s| !s.trim().is_empty())
        .or_else(|| prov_obj.and_then(|o| o.get("baseUrl").and_then(|u| u.as_str()).map(|s| s.to_string())))
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string();

    if final_base_url.is_empty() {
        return Err(format!("运营商 [{}] 的 Base URL 接口地址为空，无法获取模型列表", provider_id));
    }

    let raw_api_key = api_key
        .filter(|s| !s.trim().is_empty())
        .or_else(|| prov_obj.and_then(|o| o.get("apiKey").and_then(|k| k.as_str()).map(|s| s.to_string())));

    // 解析环境变量插值 (如 $MY_KEY)
    let final_api_key = raw_api_key.map(|k| {
        let trimmed = k.trim();
        if let Some(env_var) = trimmed.strip_prefix('$') {
            std::env::var(env_var).unwrap_or_else(|_| trimmed.to_string())
        } else {
            trimmed.to_string()
        }
    });

    let final_api_type = api_type
        .filter(|s| !s.trim().is_empty())
        .or_else(|| prov_obj.and_then(|o| o.get("api").and_then(|a| a.as_str()).map(|s| s.to_string())))
        .unwrap_or_else(|| "openai-completions".to_string())
        .to_lowercase();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut fetched_models: Vec<OfficialModelMeta> = Vec::new();

    // 2. 针对 Ollama 端点处理
    if final_api_type == "ollama" || final_base_url.contains("11434") {
        let tags_url = if final_base_url.ends_with("/v1") {
            format!("{}/api/tags", final_base_url.trim_end_matches("/v1"))
        } else {
            format!("{}/api/tags", final_base_url)
        };

        if let Ok(resp) = client.get(&tags_url).header("User-Agent", "pi-desktop-lite").send().await {
            if let Ok(json_data) = resp.json::<Value>().await {
                if let Some(models_arr) = json_data.get("models").and_then(|m| m.as_array()) {
                    for m in models_arr {
                        if let Some(id) = m.get("name").or_else(|| m.get("model")).and_then(|v| v.as_str()) {
                            let name = format_model_display_name(id);
                            let id_lower = id.to_lowercase();
                            let reasoning = id_lower.contains("r1") || id_lower.contains("reason") || id_lower.contains("thinking");
                            fetched_models.push(OfficialModelMeta {
                                id: id.to_string(),
                                name,
                                provider: p_key.clone(),
                                context_window: 32768,
                                max_tokens: 4096,
                                reasoning,
                                is_default: false,
                            });
                        }
                    }
                }
            }
        }
    }

    // 3. 通用 OpenAI 兼容 /models 端点请求
    if fetched_models.is_empty() {
        let mut candidate_urls = Vec::new();
        if final_base_url.ends_with("/v1") || final_base_url.ends_with("/v2") || final_base_url.ends_with("/v3") || final_base_url.ends_with("/v4") {
            candidate_urls.push(format!("{}/models", final_base_url));
        } else {
            candidate_urls.push(format!("{}/v1/models", final_base_url));
            candidate_urls.push(format!("{}/models", final_base_url));
        }

        for url in candidate_urls {
            let mut req = client.get(&url).header("User-Agent", "pi-desktop-lite");
            if let Some(ref key) = final_api_key {
                if !key.is_empty() {
                    req = req.header("Authorization", format!("Bearer {}", key));
                }
            }

            if let Ok(resp) = req.send().await {
                if resp.status().is_success() {
                    if let Ok(json_data) = resp.json::<Value>().await {
                        let items_opt = json_data.get("data").and_then(|d| d.as_array())
                            .or_else(|| json_data.get("models").and_then(|d| d.as_array()))
                            .or_else(|| json_data.as_array());

                        if let Some(items) = items_opt {
                            for item in items {
                                let id_opt = item.get("id")
                                    .or_else(|| item.get("name"))
                                    .or_else(|| item.get("model"))
                                    .and_then(|v| v.as_str())
                                    .or_else(|| item.as_str());

                                if let Some(id) = id_opt {
                                    let id_str = id.trim();
                                    if id_str.is_empty() || fetched_models.iter().any(|m| m.id == id_str) {
                                        continue;
                                    }

                                    let name = item.get("name")
                                        .or_else(|| item.get("display_name"))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                        .unwrap_or_else(|| format_model_display_name(id_str));

                                    let context_window = item.get("context_length")
                                        .or_else(|| item.get("context_window"))
                                        .or_else(|| item.get("max_context_length"))
                                        .or_else(|| item.get("max_input_tokens"))
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or_else(|| {
                                            let lower = id_str.to_lowercase();
                                            if lower.contains("1m") || lower.contains("1000k") { 1000000 }
                                            else if lower.contains("200k") { 200000 }
                                            else if lower.contains("128k") { 128000 }
                                            else if lower.contains("64k") { 64000 }
                                            else if lower.contains("32k") { 32768 }
                                            else if lower.contains("16k") { 16384 }
                                            else if lower.contains("8k") { 8192 }
                                            else { 64000 }
                                        });

                                    let max_tokens = item.get("max_tokens")
                                        .or_else(|| item.get("max_completion_tokens"))
                                        .or_else(|| item.get("max_output_tokens"))
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or_else(|| {
                                            let lower = id_str.to_lowercase();
                                            if lower.contains("r1") || lower.contains("reason") || lower.contains("o1") || lower.contains("o3") { 16384 }
                                            else { 4096 }
                                        });

                                    let id_lower = id_str.to_lowercase();
                                    let reasoning = id_lower.contains("reason")
                                        || id_lower.contains("r1")
                                        || id_lower.contains("o1")
                                        || id_lower.contains("o3")
                                        || id_lower.contains("thinking")
                                        || id_lower.contains("qwq")
                                        || id_lower.contains("sonnet");

                                    fetched_models.push(OfficialModelMeta {
                                        id: id_str.to_string(),
                                        name,
                                        provider: p_key.clone(),
                                        context_window,
                                        max_tokens,
                                        reasoning,
                                        is_default: false,
                                    });
                                }
                            }
                            if !fetched_models.is_empty() {
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if fetched_models.is_empty() {
        return Err(format!("未能从运营商 [{}] 的端点 ({}) 获取到有效模型列表，请确认接口地址、网络连接与 API Key 是否正确。", provider_id, final_base_url));
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
