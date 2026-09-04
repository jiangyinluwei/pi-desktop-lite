use serde::{Deserialize, Serialize};


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

pub(crate) fn get_builtin_official_catalog() -> &'static [OfficialProviderMeta] {
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
