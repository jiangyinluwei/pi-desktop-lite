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

/// 通用安全读取 ~/.pi-dl/ 下的 JSON 配置文件
pub fn read_pi_dl_json(filename: &str, default_val: Value) -> Result<Value, String> {
    let pi_dl_dir = get_pi_dl_dir()?;
    let path = pi_dl_dir.join(filename);
    if !path.exists() {
        return Ok(default_val);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    Ok(serde_json::from_str(&content).unwrap_or(default_val))
}

/// 通用安全写入 ~/.pi-dl/ 下的 JSON 配置文件
pub fn write_pi_dl_json(filename: &str, data: &Value) -> Result<(), String> {
    let pi_dl_dir = get_pi_dl_dir()?;
    let path = pi_dl_dir.join(filename);
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize {}: {}", filename, e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))
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

/// 通用安全读取 ~/.pi/agent/ 下的 JSON 配置文件
pub fn read_agent_json(filename: &str, default_val: Value) -> Result<Value, String> {
    let agent_dir = get_pi_agent_dir()?;
    let path = agent_dir.join(filename);
    if !path.exists() {
        return Ok(default_val);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    Ok(serde_json::from_str(&content).unwrap_or(default_val))
}

/// 通用安全写入 ~/.pi/agent/ 下的 JSON 配置文件
pub fn write_agent_json(filename: &str, data: &Value) -> Result<(), String> {
    let agent_dir = get_pi_agent_dir()?;
    let path = agent_dir.join(filename);
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize {}: {}", filename, e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))
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
    } else {
        map.insert(
            provider,
            json!({
                "type": "api_key",
                "key": trimmed_key
            }),
        );
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
    let root_obj = custom_config.as_object_mut().unwrap();
    if !root_obj.contains_key("providers") || !root_obj["providers"].is_object() {
        root_obj.insert("providers".to_string(), json!({}));
    }
    root_obj.get_mut("providers").unwrap().as_object_mut().unwrap()
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

    if !p_obj.contains_key("models") || !p_obj["models"].is_array() {
        p_obj.insert("models".to_string(), json!([]));
    }
    let models_arr = p_obj.get_mut("models").unwrap().as_array_mut().unwrap();

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
    let providers = match custom_config.get_mut("providers").and_then(|p| p.as_object_mut()) {
        Some(p) => p,
        None => return Ok(()),
    };

    let provider_key = provider_id.trim().to_lowercase();
    if let Some(m_id) = model_id {
        if let Some(provider_val) = providers.get_mut(&provider_key) {
            if let Some(models_arr) = provider_val.get_mut("models").and_then(|m| m.as_array_mut()) {
                models_arr.retain(|m| m.get("id").and_then(|v| v.as_str()) != Some(&m_id));
            }
        }
    } else {
        providers.remove(&provider_key);
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

/// 官方通道与模型基础元数据目录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficialProviderMeta {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub placeholder: String,
    pub doc_url: String,
    pub models: Vec<OfficialModelMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficialModelMeta {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_window: u64,
    pub max_tokens: u64,
    pub reasoning: bool,
    pub is_default: bool,
}

/// 获取官方支持的服务商与其罗列的可用模型清单（合并本地 models-store.json 与内置目录）
#[tauri::command]
pub fn pi_get_official_models_catalog() -> Result<Vec<OfficialProviderMeta>, String> {
    // 尝试读取本地 ~/.pi/agent/models-store.json 进行补充
    let agent_dir = get_pi_agent_dir().ok();
    let models_store: Option<Value> = agent_dir.and_then(|dir| {
        let store_path = dir.join("models-store.json");
        if store_path.exists() {
            fs::read_to_string(&store_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        } else {
            None
        }
    });

    let mut catalog = get_builtin_official_catalog();

    if let Some(store) = models_store {
        if let Some(store_obj) = store.as_object() {
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

fn get_builtin_official_catalog() -> Vec<OfficialProviderMeta> {
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
