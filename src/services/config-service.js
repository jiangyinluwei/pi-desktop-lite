/**
 * Pi Desktop Lite 配置与模型管理服务 (config-service.js)
 * 负责管理 ~/.pi/agent/auth.json、models.json、settings.json 以及软件主题与模型白名单
 */

const STORAGE_KEY_THEME = "pi_app_theme";
const STORAGE_KEY_WHITELIST = "pi_model_whitelist";
const STORAGE_KEY_SELECTED_MODEL = "pi_selected_model";

class ConfigService extends EventTarget {
  constructor() {
    super();
    this.currentTheme = "system";
    this.modelWhitelist = [];
    this.mediaQueryDark = window.matchMedia("(prefers-color-scheme: dark)");
  }

  /**
   * 安全调用 Tauri Invoke 指令
   * @param {string} command
   * @param {Record<string, any>} args
   */
  async invoke(command, args = {}) {
    if (window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke(command, args);
      } catch (err) {
        console.error(`[ConfigService] Invoke ${command} error:`, err);
        throw err;
      }
    } else {
      console.warn(`[ConfigService] Tauri invoke not available for ${command}`);
      return null;
    }
  }

  // ==========================================================================
  // 1. 软件主题色设置 (Theme Mode: system | light | dark)
  // ==========================================================================

  /**
   * 初始化应用主题
   */
  initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || "system";
    this.applyTheme(savedTheme);

    // 监听系统色彩偏好变化
    this.mediaQueryDark.addEventListener("change", () => {
      if (this.currentTheme === "system") {
        this.applyTheme("system");
      }
    });
  }

  /**
   * 应用并持久化主题色
   * @param {"system" | "light" | "dark"} theme
   */
  applyTheme(theme) {
    if (!["system", "light", "dark"].includes(theme)) {
      theme = "system";
    }
    this.currentTheme = theme;
    localStorage.setItem(STORAGE_KEY_THEME, theme);

    const docEl = document.documentElement;
    docEl.setAttribute("data-theme", theme);

    this.dispatchEvent(new CustomEvent("theme-change", { detail: { theme } }));
  }

  /**
   * 获取当前主题模式
   */
  getTheme() {
    return this.currentTheme || localStorage.getItem(STORAGE_KEY_THEME) || "system";
  }

  // ==========================================================================
  // 2. Pi 官方与自定义配置后端读写
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
    return (await this.invoke("pi_get_official_models_catalog")) || [];
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
  // 3. 当前模型列表与白名单机制 (Model Whitelist & Active Selection)
  // ==========================================================================

  /**
   * 加载模型白名单（优先本地持久化，无则根据已配置密钥和自定义模型自动初始化）
   */
  loadModelWhitelist() {
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
    this.dispatchEvent(new CustomEvent("whitelist-change", { detail: { list } }));
  }

  /**
   * 重新排序模型白名单 (拖拽排序)
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
   * 添加模型到白名单
   * @param {Object} model
   */
  addModelToWhitelist(model) {
    if (!model || !model.id || !model.provider) return;
    const list = this.loadModelWhitelist();
    const exists = list.some(
      (m) => m.id === model.id && m.provider === model.provider
    );
    if (!exists) {
      list.push({
        id: model.id,
        name: model.name || model.id,
        provider: model.provider,
        contextWindow: model.contextWindow || 64000,
        maxTokens: model.maxTokens || 4096,
        reasoning: !!model.reasoning,
        isCustom: !!model.isCustom,
      });
      this.saveModelWhitelist(list);
    }
  }

  /**
   * 从白名单移除模型
   * @param {string} provider
   * @param {string} modelId
   */
  removeModelFromWhitelist(provider, modelId) {
    let list = this.loadModelWhitelist();
    list = list.filter((m) => !(m.provider === provider && m.id === modelId));
    this.saveModelWhitelist(list);
  }

  /**
   * 检查模型是否在白名单中
   * @param {string} provider
   * @param {string} modelId
   */
  isModelInWhitelist(provider, modelId) {
    const list = this.loadModelWhitelist();
    return list.some((m) => m.provider === provider && m.id === modelId);
  }

  /**
   * 获取持久化的当前所选模型
   */
  getSelectedModel() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  /**
   * 保存当前所选模型
   * @param {string} provider
   * @param {string} modelId
   */
  saveSelectedModel(provider, modelId) {
    localStorage.setItem(
      STORAGE_KEY_SELECTED_MODEL,
      JSON.stringify({ provider, modelId })
    );
  }
}

export const configService = new ConfigService();
