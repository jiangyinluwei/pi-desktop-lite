/**
 * Pi Desktop Lite 配置与模型管理服务 (config-service.js)
 * 负责管理 ~/.pi-dl/config.json (应用全局配置: 主题/思考深度/选中模型/模型顺序)
 * 以及 ~/.pi/agent/auth.json、models.json、settings.json 等 Pi 内核配置
 */

import { invokeTauri } from "./tauri-bridge.js";

const STORAGE_KEY_THEME = "pi_app_theme";
const STORAGE_KEY_WHITELIST = "pi_model_whitelist";
const STORAGE_KEY_SELECTED_MODEL = "pi_selected_model";
const STORAGE_KEY_THINKING_LEVEL = "pi_thinking_level";
const STORAGE_KEY_IGNORE_UPDATE = "pi_ignore_update_notification";

class ConfigService extends EventTarget {
  constructor() {
    super();
    this.currentTheme = "system";
    this.defaultThinkingLevel = "medium";
    this.selectedModel = null;
    this.modelWhitelist = [];
    this.ignoreUpdateNotification = false;
    this.mediaQueryDark = window.matchMedia("(prefers-color-scheme: dark)");
  }

  /**
   * 安全调用 Tauri Invoke 指令 (转发至统一桥接器)
   */
  async invoke(command, args = {}) {
    return invokeTauri(command, args);
  }

  // ==========================================================================
  // 1. 应用全局配置持久化 (~/.pi-dl/config.json)
  // ==========================================================================

  /**
   * 从 ~/.pi-dl/config.json 加载应用配置
   */
  async loadAppConfig() {
    try {
      const config = await this.invoke("pi_get_app_config");
      if (config && typeof config === "object") {
        if (config.theme && ["system", "light", "dark"].includes(config.theme)) {
          this.currentTheme = config.theme;
          localStorage.setItem(STORAGE_KEY_THEME, this.currentTheme);
        }
        if (config.defaultThinkingLevel) {
          this.defaultThinkingLevel = config.defaultThinkingLevel;
          localStorage.setItem(STORAGE_KEY_THINKING_LEVEL, this.defaultThinkingLevel);
        }
        if (config.selectedModel && config.selectedModel.provider && config.selectedModel.modelId) {
          this.selectedModel = config.selectedModel;
          localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, JSON.stringify(this.selectedModel));
        }
        if (Array.isArray(config.modelWhitelist) && config.modelWhitelist.length > 0) {
          this.modelWhitelist = config.modelWhitelist;
          localStorage.setItem(STORAGE_KEY_WHITELIST, JSON.stringify(this.modelWhitelist));
        }
        if (typeof config.ignoreUpdateNotification === "boolean") {
          this.ignoreUpdateNotification = config.ignoreUpdateNotification;
          localStorage.setItem(STORAGE_KEY_IGNORE_UPDATE, String(this.ignoreUpdateNotification));
        } else {
          this.ignoreUpdateNotification = localStorage.getItem(STORAGE_KEY_IGNORE_UPDATE) === "true";
        }
        return config;
      }
    } catch (e) {
      console.warn("[ConfigService] Failed to load app config from ~/.pi-dl/config.json:", e);
    }
    return null;
  }

  /**
   * 将当前应用配置完整保存至 ~/.pi-dl/config.json
   */
  async saveAppConfig() {
    const configData = {
      theme: this.getTheme(),
      defaultThinkingLevel: this.getDefaultThinkingLevel(),
      selectedModel: this.getSelectedModel(),
      modelWhitelist: this.loadModelWhitelist(),
      ignoreUpdateNotification: this.getIgnoreUpdateNotification(),
    };

    try {
      await this.invoke("pi_save_app_config", { configData });
    } catch (e) {
      console.warn("[ConfigService] Failed to save app config to ~/.pi-dl/config.json:", e);
    }
  }

  /**
   * 获取是否屏蔽版本更新自动弹窗提醒
   */
  getIgnoreUpdateNotification() {
    return Boolean(this.ignoreUpdateNotification);
  }

  /**
   * 设置并持久化是否屏蔽版本更新自动弹窗提醒
   * @param {boolean} ignored
   */
  async setIgnoreUpdateNotification(ignored) {
    this.ignoreUpdateNotification = Boolean(ignored);
    localStorage.setItem(STORAGE_KEY_IGNORE_UPDATE, String(this.ignoreUpdateNotification));
    await this.saveAppConfig();
    this.dispatchEvent(new CustomEvent("ignore-update-change", { detail: { ignored: this.ignoreUpdateNotification } }));
  }

  // ==========================================================================
  // 2. 软件主题色设置 (Theme Mode: system | light | dark)
  // ==========================================================================

  /**
   * 初始化应用主题
   */
  initTheme() {
    const savedTheme = this.currentTheme || localStorage.getItem(STORAGE_KEY_THEME) || "system";
    this.applyTheme(savedTheme, false);

    // 监听系统色彩偏好变化
    this.mediaQueryDark.addEventListener("change", () => {
      if (this.currentTheme === "system") {
        this.applyTheme("system", false);
      }
    });
  }

  /**
   * 应用并持久化主题色
   * @param {"system" | "light" | "dark"} theme
   * @param {boolean} [persistToFile=true]
   */
  applyTheme(theme, persistToFile = true) {
    if (!["system", "light", "dark"].includes(theme)) {
      theme = "system";
    }
    this.currentTheme = theme;
    localStorage.setItem(STORAGE_KEY_THEME, theme);

    const docEl = document.documentElement;
    docEl.setAttribute("data-theme", theme);

    if (persistToFile) {
      this.saveAppConfig();
    }

    this.dispatchEvent(new CustomEvent("theme-change", { detail: { theme } }));
  }

  /**
   * 获取当前主题模式
   */
  getTheme() {
    return this.currentTheme || localStorage.getItem(STORAGE_KEY_THEME) || "system";
  }

  // ==========================================================================
  // 3. 默认思考强度设置 (Thinking Level)
  // ==========================================================================

  /**
   * 获取默认思考强度
   */
  getDefaultThinkingLevel() {
    return (
      this.defaultThinkingLevel ||
      localStorage.getItem(STORAGE_KEY_THINKING_LEVEL) ||
      "medium"
    );
  }

  /**
   * 保存默认思考强度
   * @param {string} level
   */
  saveDefaultThinkingLevel(level) {
    if (!level) return;
    this.defaultThinkingLevel = level;
    localStorage.setItem(STORAGE_KEY_THINKING_LEVEL, level);
    this.saveAppConfig();
  }

  // ==========================================================================
  // 4. Pi 官方与自定义配置后端读写 (~/.pi/agent/)
  // ==========================================================================

  /**
   * 读取 auth.json 中的凭据
   */
  async getAuthConfig() {
    return (await this.invoke("pi_get_auth_config")) || {};
  }

  /**
   * 写入/更新 auth.json
   */
  async saveAuthConfig(authData) {
    return await this.invoke("pi_save_auth_config", { authData });
  }

  /**
   * 保存指定官方通道 API Key
   * @param {string} provider
   * @param {string} apiKey
   */
  async saveProviderApiKey(provider, apiKey) {
    return await this.invoke("pi_save_provider_api_key", { provider, apiKey });
  }

  /**
   * 读取 models.json 中的自定义配置
   */
  async getCustomModels() {
    return (await this.invoke("pi_get_custom_models")) || { providers: {} };
  }

  /**
   * 保存完整 models.json
   */
  async saveCustomModels(modelsData) {
    return await this.invoke("pi_save_custom_models", { modelsData });
  }

  /**
   * 保存或更新自定义运营商 (第一步)
   * @param {Object} entry { provider_id, api_type, base_url, api_key }
   */
  async saveCustomProvider(entry) {
    return await this.invoke("pi_save_custom_provider", { entry });
  }

  /**
   * 删除运营商及其关联模型
   * @param {string} providerId
   */
  async deleteCustomProvider(providerId) {
    return await this.invoke("pi_delete_custom_provider", { providerId });
  }

  /**
   * 在指定运营商下添加或更新模型 (第二步)
   * @param {Object} entry { provider_id, model_id, model_name, context_window, max_tokens, reasoning }
   */
  async addCustomProviderModel(entry) {
    return await this.invoke("pi_add_custom_provider_model", { entry });
  }

  /**
   * 添加单个自定义模型通道配置 (兼容旧接口)
   * @param {Object} entry
   */
  async addCustomModel(entry) {
    return await this.invoke("pi_add_custom_model", { entry });
  }

  /**
   * 删除自定义模型
   * @param {string} providerId
   * @param {string|null} [modelId]
   */
  async deleteCustomModel(providerId, modelId = null) {
    return await this.invoke("pi_delete_custom_model", { providerId, modelId });
  }

  /**
   * 获取官方模型目录与服务商元数据
   */
  async getOfficialModelsCatalog() {
    try {
      const list = await this.invoke("pi_get_official_models_catalog");
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (e) {
      console.warn("[ConfigService] Failed to invoke pi_get_official_models_catalog:", e);
    }
    return this.getBuiltinOfficialCatalogFallback();
  }

  /**
   * 动态从官网 / Pi 内核自省拉取指定服务商的最新可用模型
   * @param {string} providerId
   */
  async fetchOfficialModels(providerId) {
    try {
      const list = await this.invoke("pi_fetch_official_models", { providerId });
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (e) {
      console.warn(`[ConfigService] Failed to fetch official models for ${providerId}:`, e);
    }
    const catalog = await this.getOfficialModelsCatalog();
    const prov = catalog.find((p) => p.id === providerId);
    return prov ? prov.models : [];
  }

  /**
   * 内置官方服务商与模型目录保底数据
   */
  getBuiltinOfficialCatalogFallback() {
    return [
      {
        id: "anthropic",
        name: "Anthropic Claude",
        desc: "Claude 3.7 / 3.5 系列模型，卓越的代码与多轮思考能力",
        placeholder: "sk-ant-...",
        doc_url: "https://console.anthropic.com/",
        models: [
          { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet (Hybrid Thinking)", provider: "anthropic", context_window: 200000, max_tokens: 64000, reasoning: true, is_default: true },
          { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet (Latest)", provider: "anthropic", context_window: 200000, max_tokens: 8192, reasoning: false, is_default: false },
          { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku (Fast & Lightweight)", provider: "anthropic", context_window: 200000, max_tokens: 8192, reasoning: false, is_default: false },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        desc: "GPT-4o 与 o1/o3-mini 系列模型",
        placeholder: "sk-...",
        doc_url: "https://platform.openai.com/",
        models: [
          { id: "gpt-4o", name: "GPT-4o (Omni Multimodal)", provider: "openai", context_window: 128000, max_tokens: 16384, reasoning: false, is_default: true },
          { id: "gpt-4o-mini", name: "GPT-4o Mini (Fast & Efficient)", provider: "openai", context_window: 128000, max_tokens: 16384, reasoning: false, is_default: false },
          { id: "o3-mini", name: "o3-mini (High-speed Reasoning)", provider: "openai", context_window: 200000, max_tokens: 100000, reasoning: true, is_default: false },
        ],
      },
      {
        id: "deepseek",
        name: "DeepSeek (深度求索)",
        desc: "DeepSeek V3 / R1 原生官方直连 API",
        placeholder: "sk-...",
        doc_url: "https://platform.deepseek.com/",
        models: [
          { id: "deepseek-chat", name: "DeepSeek-V3 (Chat / General)", provider: "deepseek", context_window: 64000, max_tokens: 8192, reasoning: false, is_default: true },
          { id: "deepseek-reasoner", name: "DeepSeek-R1 (Full Reasoning)", provider: "deepseek", context_window: 64000, max_tokens: 8192, reasoning: true, is_default: false },
        ],
      },
      {
        id: "google",
        name: "Google Gemini",
        desc: "Gemini 2.0 Flash / Pro 系列大模型",
        placeholder: "AIzaSy...",
        doc_url: "https://aistudio.google.com/",
        models: [
          { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (Fast & Capable)", provider: "google", context_window: 1048576, max_tokens: 8192, reasoning: false, is_default: true },
          { id: "gemini-2.0-flash-thinking-exp", name: "Gemini 2.0 Flash Thinking Exp", provider: "google", context_window: 1048576, max_tokens: 65536, reasoning: true, is_default: false },
        ],
      },
      {
        id: "opencode-zen",
        name: "OpenCode Zen",
        desc: "OpenCode Zen 按量计费服务，按需调用 Claude、GPT-5、Gemini 3.7、DeepSeek 等顶尖模型",
        placeholder: "sk-...",
        doc_url: "https://opencode.ai/zen",
        models: [
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "opencode", context_window: 1000000, max_tokens: 64000, reasoning: true, is_default: true },
          { id: "claude-opus-4-5", name: "Claude Opus 4.5", provider: "opencode", context_window: 200000, max_tokens: 64000, reasoning: true, is_default: false },
          { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "opencode", context_window: 200000, max_tokens: 64000, reasoning: true, is_default: false },
          { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash (Hybrid Thinking)", provider: "opencode", context_window: 1048576, max_tokens: 65536, reasoning: true, is_default: false },
          { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "opencode", context_window: 1048576, max_tokens: 65536, reasoning: true, is_default: false },
          { id: "gpt-5.4", name: "GPT-5.4 (Reasoning)", provider: "opencode", context_window: 272000, max_tokens: 128000, reasoning: true, is_default: false },
          { id: "gpt-5.2", name: "GPT-5.2", provider: "opencode", context_window: 400000, max_tokens: 128000, reasoning: true, is_default: false },
          { id: "gpt-5.1-codex", name: "GPT-5.1 Codex (Code Specialized)", provider: "opencode", context_window: 400000, max_tokens: 128000, reasoning: true, is_default: false },
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "opencode", context_window: 1000000, max_tokens: 384000, reasoning: true, is_default: false },
          { id: "grok-4.6", name: "Grok 4.6", provider: "opencode", context_window: 500000, max_tokens: 500000, reasoning: true, is_default: false },
        ],
      },
      {
        id: "opencode-go",
        name: "OpenCode Go",
        desc: "OpenCode Go 月费订阅服务 ($10/月)，高频/低成本调用精选开源前沿代码模型",
        placeholder: "sk-...",
        doc_url: "https://opencode.ai/go",
        models: [
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (Fast)", provider: "opencode", context_window: 1000000, max_tokens: 384000, reasoning: true, is_default: true },
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "opencode", context_window: 1000000, max_tokens: 384000, reasoning: true, is_default: false },
          { id: "kimi-k3", name: "Kimi K3 (1M Context)", provider: "opencode", context_window: 1000000, max_tokens: 131072, reasoning: true, is_default: false },
          { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", provider: "opencode", context_window: 262144, max_tokens: 262144, reasoning: true, is_default: false },
          { id: "glm-5.2", name: "GLM 5.2 (1M Context)", provider: "opencode", context_window: 1000000, max_tokens: 131072, reasoning: true, is_default: false },
          { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", provider: "opencode", context_window: 262144, max_tokens: 65536, reasoning: true, is_default: false },
          { id: "minimax-m3", name: "MiniMax M3", provider: "opencode", context_window: 512000, max_tokens: 128000, reasoning: true, is_default: false },
          { id: "big-pickle", name: "Big Pickle (Reasoning)", provider: "opencode", context_window: 200000, max_tokens: 32000, reasoning: true, is_default: false },
        ],
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        desc: "统一接入数百种全球大模型与路由平台",
        placeholder: "sk-or-v1-...",
        doc_url: "https://openrouter.ai/",
        models: [
          { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (via OpenRouter)", provider: "openrouter", context_window: 200000, max_tokens: 64000, reasoning: true, is_default: true },
          { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (via OpenRouter)", provider: "openrouter", context_window: 128000, max_tokens: 8192, reasoning: true, is_default: false },
          { id: "openai/gpt-4o", name: "GPT-4o (via OpenRouter)", provider: "openrouter", context_window: 128000, max_tokens: 16384, reasoning: false, is_default: false },
        ],
      },
      {
        id: "qwen-token-plan",
        name: "通义千问 (Qwen DashScope)",
        desc: "阿里云百炼大模型服务与 Qwen Coder",
        placeholder: "sk-sp-...",
        doc_url: "https://dashscope.aliyun.com/",
        models: [
          { id: "qwen-max-latest", name: "Qwen Max (通义千问旗舰)", provider: "qwen-token-plan", context_window: 32000, max_tokens: 8192, reasoning: false, is_default: true },
          { id: "qwen-plus-latest", name: "Qwen Plus (平衡加速)", provider: "qwen-token-plan", context_window: 128000, max_tokens: 8192, reasoning: false, is_default: false },
          { id: "qwen-coder-plus-latest", name: "Qwen Coder Plus (代码强化)", provider: "qwen-token-plan", context_window: 128000, max_tokens: 8192, reasoning: false, is_default: false },
        ],
      },
      {
        id: "kimi-coding",
        name: "月之暗面 (Kimi / Moonshot)",
        desc: "超长文本上下文与深度代码分析",
        placeholder: "sk-...",
        doc_url: "https://platform.moonshot.cn/",
        models: [
          { id: "moonshot-v1-128k", name: "Moonshot v1 128k", provider: "kimi-coding", context_window: 128000, max_tokens: 8192, reasoning: false, is_default: true },
          { id: "moonshot-v1-32k", name: "Moonshot v1 32k", provider: "kimi-coding", context_window: 32000, max_tokens: 8192, reasoning: false, is_default: false },
        ],
      },
      {
        id: "minimax",
        name: "MiniMax (名之梦)",
        desc: "MiniMax Text-01 与中文理解模型",
        placeholder: "sk-...",
        doc_url: "https://api.minimax.chat/",
        models: [
          { id: "MiniMax-Text-01", name: "MiniMax Text-01 (1M Context)", provider: "minimax", context_window: 1000000, max_tokens: 8192, reasoning: false, is_default: true },
          { id: "abab6.5s-chat", name: "abab 6.5s Chat (Speed)", provider: "minimax", context_window: 245000, max_tokens: 4096, reasoning: false, is_default: false },
        ],
      },
      {
        id: "groq",
        name: "Groq (LPU 极速推理)",
        desc: "超高每秒 token 吞吐量",
        placeholder: "gsk_...",
        doc_url: "https://console.groq.com/",
        models: [
          { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", provider: "groq", context_window: 128000, max_tokens: 32768, reasoning: false, is_default: true },
          { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill Llama 70B", provider: "groq", context_window: 128000, max_tokens: 8192, reasoning: true, is_default: false },
        ],
      },
      {
        id: "xai",
        name: "xAI (Grok)",
        desc: "xAI Grok-2 与视觉模型",
        placeholder: "xai-...",
        doc_url: "https://console.x.ai/",
        models: [
          { id: "grok-2-latest", name: "Grok-2 Latest", provider: "xai", context_window: 128000, max_tokens: 8192, reasoning: false, is_default: true },
          { id: "grok-2-vision-latest", name: "Grok-2 Vision Latest", provider: "xai", context_window: 32768, max_tokens: 8192, reasoning: false, is_default: false },
        ],
      },
    ];
  }

  /**
   * 读取 settings.json
   */
  async getSettingsConfig() {
    return (await this.invoke("pi_get_settings_config")) || {};
  }

  /**
   * 写入 settings.json
   */
  async saveSettingsConfig(settingsData) {
    return await this.invoke("pi_save_settings_config", { settingsData });
  }

  // ==========================================================================
  // 5. 当前模型列表与白名单机制 (MRU 顺序、持久化与选中保护)
  // ==========================================================================

  /**
   * 加载模型白名单（优先内存/本地持久化，无则根据已配置密钥和自定义模型自动初始化）
   */
  loadModelWhitelist() {
    if (this.modelWhitelist && this.modelWhitelist.length > 0) {
      return this.modelWhitelist;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY_WHITELIST);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.modelWhitelist = parsed;
          return this.modelWhitelist;
        }
      }
    } catch (_) {}

    return this.modelWhitelist || [];
  }

  /**
   * 保存模型白名单
   * @param {Array<any>} list
   */
  saveModelWhitelist(list) {
    this.modelWhitelist = list;
    localStorage.setItem(STORAGE_KEY_WHITELIST, JSON.stringify(list));
    this.saveAppConfig();
    this.dispatchEvent(new CustomEvent("whitelist-change", { detail: { list } }));
  }

  /**
   * 将指定模型标记为最近选用 (MRU)：将其移动到白名单首位 (index 0)，新的在前旧的在后
   * @param {string} provider
   * @param {string} modelId
   */
  touchModelAsRecentlyUsed(provider, modelId) {
    if (!provider || !modelId) return;
    const list = [...this.loadModelWhitelist()];
    const index = list.findIndex(
      (m) =>
        m.id.toLowerCase() === modelId.toLowerCase() &&
        m.provider.toLowerCase() === provider.toLowerCase()
    );

    if (index > 0) {
      const [item] = list.splice(index, 1);
      list.unshift(item);
      this.saveModelWhitelist(list);
    } else if (index === -1) {
      list.unshift({
        id: modelId,
        name: modelId,
        provider: provider,
        contextWindow: 64000,
        maxTokens: 4096,
        reasoning: false,
        isCustom: false,
      });
      this.saveModelWhitelist(list);
    }
  }

  /**
   * 重新排序模型白名单
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  reorderModelWhitelist(fromIndex, toIndex) {
    const list = [...this.loadModelWhitelist()];
    if (
      fromIndex < 0 ||
      fromIndex >= list.length ||
      toIndex < 0 ||
      toIndex >= list.length ||
      fromIndex === toIndex
    ) {
      return list;
    }

    const [movedItem] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, movedItem);
    this.saveModelWhitelist(list);
    return list;
  }

  /**
   * 添加模型到白名单（固定第一行为当前选中的模型，新增模型插入到当前选中模型之后）
   * @param {Object} model
   */
  addModelToWhitelist(model) {
    if (!model || !model.id || !model.provider) return;
    let list = [...this.loadModelWhitelist()];
    const existsIndex = list.findIndex(
      (m) =>
        m.id.toLowerCase() === model.id.toLowerCase() &&
        m.provider.toLowerCase() === model.provider.toLowerCase()
    );

    const modelObj = {
      id: model.id,
      name: model.name || model.id,
      provider: model.provider,
      contextWindow: model.contextWindow || 64000,
      maxTokens: model.maxTokens || 4096,
      reasoning: !!model.reasoning,
      isCustom: !!model.isCustom,
    };

    const selected = this.getSelectedModel();
    const isThisModelSelected = selected &&
      selected.provider?.toLowerCase() === model.provider.toLowerCase() &&
      selected.modelId?.toLowerCase() === model.id.toLowerCase();

    if (existsIndex >= 0) {
      // 存在则原地更新属性
      list[existsIndex] = { ...list[existsIndex], ...modelObj };
      // 如果当前编辑/更新的模型正是已选中的模型，确保其在首位
      if (isThisModelSelected && existsIndex > 0) {
        const [item] = list.splice(existsIndex, 1);
        list.unshift(item);
      }
    } else {
      // 新增模型
      if (list.length === 0 || isThisModelSelected) {
        list.unshift(modelObj);
      } else {
        // 第一行必须固定为当前选中的模型！新增模型插入到当前选中模型之后 (index 1)
        if (selected) {
          const activeIdx = list.findIndex(
            (m) =>
              m.id.toLowerCase() === selected.modelId?.toLowerCase() &&
              m.provider.toLowerCase() === selected.provider?.toLowerCase()
          );
          if (activeIdx > 0) {
            const [activeItem] = list.splice(activeIdx, 1);
            list.unshift(activeItem);
          }
        }
        // 插入到首位选中的模型之后（index 1）
        list.splice(1, 0, modelObj);
      }
    }

    this.saveModelWhitelist(list);
  }

  /**
   * 从白名单移除模型
   * @param {string} provider
   * @param {string} modelId
   */
  removeModelFromWhitelist(provider, modelId) {
    let list = this.loadModelWhitelist();
    list = list.filter(
      (m) =>
        !(
          m.provider.toLowerCase() === provider.toLowerCase() &&
          m.id.toLowerCase() === modelId.toLowerCase()
        )
    );
    this.saveModelWhitelist(list);
  }

  /**
   * 检查模型是否在白名单中
   * @param {string} provider
   * @param {string} modelId
   */
  isModelInWhitelist(provider, modelId) {
    const list = this.loadModelWhitelist();
    return list.some(
      (m) =>
        m.provider.toLowerCase() === provider.toLowerCase() &&
        m.id.toLowerCase() === modelId.toLowerCase()
    );
  }

  /**
   * 获取持久化的当前所选模型
   */
  getSelectedModel() {
    if (this.selectedModel && this.selectedModel.provider && this.selectedModel.modelId) {
      return this.selectedModel;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.provider && parsed.modelId) {
          this.selectedModel = parsed;
          return this.selectedModel;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * 保存当前所选模型
   * @param {string} provider
   * @param {string} modelId
   */
  saveSelectedModel(provider, modelId) {
    this.selectedModel = { provider, modelId };
    localStorage.setItem(
      STORAGE_KEY_SELECTED_MODEL,
      JSON.stringify(this.selectedModel)
    );
    this.touchModelAsRecentlyUsed(provider, modelId);
    this.saveAppConfig();
  }

  // ==========================================================================
  // 6. Pi Package Catalog 扩展组件管理
  // ==========================================================================

  /**
   * 搜索与获取官网组件目录
   * @param {string|null} query
   * @param {string|null} pkgType
   * @param {string|null} sort
   * @param {number|null} page
   * @returns {Promise<{packages: Array, page: number, totalCount: number, totalPages: number, hasMore: boolean}>}
   */
  async searchPackages(query = null, pkgType = null, sort = null, page = 1) {
    return this.invoke("pi_search_packages", {
      query: query || null,
      pkgType: pkgType || null,
      sort: sort || null,
      page: page || 1,
    });
  }

  /**
   * 获取本地已安装的扩展组件列表
   * @returns {Promise<Array<{name: string, version: string, description: string, source: string}>>}
   */
  async getInstalledPackages() {
    return this.invoke("pi_get_installed_packages");
  }

  /**
   * 安装指定组件
   * @param {string} packageName
   * @returns {Promise<string>}
   */
  async installPackage(packageName) {
    return this.invoke("pi_install_package", { packageName });
  }

  /**
   * 卸载指定组件
   * @param {string} packageName
   * @returns {Promise<string>}
   */
  async uninstallPackage(packageName) {
    return this.invoke("pi_uninstall_package", { packageName });
  }

  /**
   * 批量检查已安装组件的最新版本更新
   * @returns {Promise<Array<{name: string, currentVersion: string, latestVersion: string, hasUpdate: boolean}>>}
   */
  async checkPackageUpdates() {
    return this.invoke("pi_check_package_updates");
  }

  /**
   * 更新指定组件
   * @param {string} packageName
   * @returns {Promise<string>}
   */
  async updatePackage(packageName) {
    return this.invoke("pi_update_package", { packageName });
  }

  /**
   * 为指定组件应用推荐配置预设
   * @param {string} packageName
   * @returns {Promise<boolean>}
   */
  async applyPackagePreset(packageName) {
    return this.invoke("pi_apply_package_preset", { packageName });
  }

  /**
   * 获取内嵌的推荐扩展组件列表
   * @returns {Promise<Array<{name: string, description?: string, source?: string}>>}
   */
  async getRecommendedPlugins() {
    return this.invoke("pi_get_recommended_plugins");
  }
}

export const configService = new ConfigService();



