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
    this._appConfigLoaded = false;
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
        this._appConfigLoaded = true;
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
   * 添加模型到白名单（插入到首位作为最新模型）
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

    if (existsIndex >= 0) {
      // 存在则更新并提到最前面
      list.splice(existsIndex, 1);
      list.unshift(modelObj);
    } else {
      list.unshift(modelObj);
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
   * 使用当前或指定模型翻译文本 (主要用于内核更新日志翻译)
   * @param {string} text
   * @param {string|null} [provider]
   * @param {string|null} [modelId]
   * @returns {Promise<string>}
   */
  async translateText(text, provider = null, modelId = null) {
    return this.invoke("pi_translate_text", {
      text,
      provider,
      modelId,
    });
  }
}

export const configService = new ConfigService();


