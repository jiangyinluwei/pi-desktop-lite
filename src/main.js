import { piClient } from "./services/pi-client.js";
import { sessionService } from "./services/session-service.js";
import { versionService } from "./services/version-service.js";
import { configService } from "./services/config-service.js";
import { invokeTauri } from "./services/tauri-bridge.js";
import { enhanceAllSelects, enhanceSelect } from "./services/sketch-select.js";

/**
 * 简单 HTML 转义防 XSS
 * @param {string} str
 * @returns {string}
 */
export const escapeHtml = (str) => {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * 规范化手绘风格 SVG 矢量图元字典 (Theme-adaptive with currentColor)
 */
const ICONS = {
  bolt: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 1.5 L3.5 9 L7.5 9 L6.5 14.5 L12.5 7 L8.5 7 Z" /></svg>`,
  sparkle: `<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 1.2 C8 4.8, 8.5 7.5, 14.8 8 C8.5 8.5, 8 11.2, 8 14.8 C8 11.2, 7.5 8.5, 1.2 8 C7.5 7.5, 8 4.8, 8 1.2 Z" /></svg>`,
  lock: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1.5" /><path d="M5.5 7 V4.5 C5.5 3.1, 6.6 2, 8 2 C9.4 2, 10.5 3.1, 10.5 4.5 V7" /><circle cx="8" cy="10.5" r="0.8" fill="currentColor" stroke="none" /></svg>`,
  edit: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2.5 L13.5 4.5 L4.5 13.5 L2 14 L2.5 11.5 Z" /><path d="M9.8 4.2 L11.8 6.2" /></svg>`,
  close: `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5" /><line x1="12.5" y1="3.5" x2="3.5" y2="12.5" /></svg>`,
  check: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" /></svg>`,
  dragHandle: `<svg viewBox="0 0 16 16" width="10" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="3.5" r="1.2" /><circle cx="11" cy="3.5" r="1.2" /><circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" /><circle cx="5" cy="12.5" r="1.2" /><circle cx="11" cy="12.5" r="1.2" /></svg>`,
  eye: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8 C3.5 4.5, 12.5 4.5, 14.5 8 C12.5 11.5, 3.5 11.5, 1.5 8 Z" /><circle cx="8" cy="8" r="2.2" /></svg>`,
  eyeOff: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2 L14 14" /><path d="M6.2 6.3 A2.2 2.2 0 0 0 9.7 9.8" /><path d="M4.5 4.8 C2.8 5.8, 1.8 7.2, 1.5 8 C3.5 11.5, 12.5 11.5, 14.5 8 C14.1 7.3, 13.3 6.3, 12.2 5.5" /><path d="M7 3.6 C7.3 3.5, 7.7 3.5, 8 3.5 C12.5 3.5, 14.5 8, 14.5 8" /></svg>`,
  warning: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 L1.5 13.5 L14.5 13.5 Z" /><line x1="8" y1="6" x2="8" y2="9.5" /><circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" /></svg>`,
  tool: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.8 2.2 C9.2 1.6, 8.2 1.4, 7.5 1.8 L6.2 3.1 L8.9 5.8 L10.2 4.5 C10.6 3.8, 10.4 2.8, 9.8 2.2 Z" /><path d="M8.2 6.5 L3.2 11.5 C2.8 11.9, 2.5 12.6, 2.7 13.2 C2.9 13.5, 3.2 13.8, 3.5 14 C4.1 14.2, 4.8 13.9, 5.2 13.5 L10.2 8.5 Z" /></svg>`,
  chevronDown: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6 L8 10 L12 6" /></svg>`,
};

window.addEventListener("DOMContentLoaded", () => {
  const appContainer = document.getElementById("app-container");
  const searchInputWrapper = document.getElementById("search-input-wrapper");
  const searchInput = document.getElementById("search-input");
  const searchMottoLayer = document.getElementById("search-motto-layer");
  const searchMottoTrack = document.getElementById("search-motto-track");
  const searchMottoText1 = document.getElementById("search-motto-text-1");
  const searchMottoText2 = document.getElementById("search-motto-text-2");
  const clearBtn = document.getElementById("clear-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsBadge = document.getElementById("settings-badge");
  const searchForm = document.getElementById("search-form");
  const flowStage = document.getElementById("flow-stage");
  const flowScrollArea = document.getElementById("flow-scroll-area");
  const flowConversation = document.getElementById("flow-conversation");
  const flowUserText = document.getElementById("flow-user-text");
  const thinkingToggleBtn = document.getElementById("thinking-toggle-btn");
  const agentThinkingCard = document.getElementById("agent-thinking-card");
  const thinkingDuration = document.getElementById("thinking-duration");
  const thinkingTextStream = document.getElementById("thinking-text-stream");
  const thinkingBody = document.getElementById("thinking-body");
  const toolCallsContainer = document.getElementById("tool-calls-container");
  const flowResponseContent = document.getElementById("flow-response-content");
  const flowModelTag = document.getElementById("flow-model-tag");
  const flowModelName = document.getElementById("flow-model-name");
  const flowInjectionCapsule = document.getElementById("flow-injection-capsule");
  const flowInjectionText = document.getElementById("flow-injection-text");


  // 设置独立全页面元素
  const topbarHintBanner = document.getElementById("topbar-hint-banner");
  let hintBannerTimeout = null;
  const hostStatusDot = document.getElementById("host-status-dot");
  const hostStatusText = document.getElementById("host-status-text");
  const hostVersionText = document.getElementById("host-version-text");
  const btnRestartHost = document.getElementById("btn-restart-host");
  const btnCheckUpdate = document.getElementById("btn-check-update");
  const updateNotice = document.getElementById("update-notice");
  const updateMsg = document.getElementById("update-msg");
  const btnNewSession = document.getElementById("btn-new-session");
  const sessionsList = document.getElementById("sessions-list");
  const sessionCount = document.getElementById("session-count");

  // 模型与推理设置元素
  const currentModelProvider = document.getElementById("current-model-provider");
  const currentModelName = document.getElementById("current-model-name");
  const currentModelInfo = document.getElementById("current-model-info");
  const thinkingSelectDropdown = document.getElementById("thinking-select-dropdown");
  const whitelistModelsList = document.getElementById("whitelist-models-list");

  // 官方通道设置元素
  const officialProviderSelect = document.getElementById("official-provider-select");
  const officialProviderTitle = document.getElementById("official-provider-title");
  const officialProviderDesc = document.getElementById("official-provider-desc");
  const officialProviderDoc = document.getElementById("official-provider-doc");
  const officialApiKeyInput = document.getElementById("official-api-key-input");
  const btnToggleKeyVisibility = document.getElementById("btn-toggle-key-visibility");
  const btnSaveOfficialKey = document.getElementById("btn-save-official-key");
  const officialKeyStatus = document.getElementById("official-key-status");
  const officialModelsGrid = document.getElementById("official-models-grid");

  // 自定义通道两步式元素
  const customProviderForm = document.getElementById("custom-provider-form");
  const customProviderId = document.getElementById("custom-provider-id");
  const customApiType = document.getElementById("custom-api-type");
  const customBaseUrl = document.getElementById("custom-base-url");
  const customApiKey = document.getElementById("custom-api-key");
  const customProvidersContainer = document.getElementById("custom-providers-container");

  // ==========================================================================
  // 四态界面状态机 (detailed | focus | flow | settings)
  // ==========================================================================
  const VIEW_DETAILED = "detailed";
  const VIEW_FOCUS = "focus";
  const VIEW_FLOW = "flow";
  const VIEW_SETTINGS = "settings";

  let currentView = VIEW_DETAILED;
  let previousView = VIEW_DETAILED;

  const setViewMode = (mode, shouldFocusInput = true) => {
    if (![VIEW_DETAILED, VIEW_FOCUS, VIEW_FLOW, VIEW_SETTINGS].includes(mode)) return;

    if (currentView !== VIEW_SETTINGS && mode === VIEW_SETTINGS) {
      previousView = currentView;
    }

    currentView = mode;
    if (appContainer) {
      appContainer.setAttribute("data-view", mode);
    }

    if (shouldFocusInput && searchInput) {
      if (mode === VIEW_FOCUS || mode === VIEW_FLOW) {
        searchInput.focus();
      } else if (mode === VIEW_DETAILED) {
        searchInput.blur();
      }
    }

    window.dispatchEvent(new CustomEvent("pi:view-change", { detail: { mode } }));
  };

  window.__piGetViewMode = () => currentView;
  window.__piSetViewMode = setViewMode;

  if (searchInput) {
    searchInput.addEventListener("focus", () => {
      if (currentView === VIEW_DETAILED) {
        setViewMode(VIEW_FOCUS, false);
      }
    });

    searchInput.addEventListener("click", () => {
      if (currentView === VIEW_DETAILED) {
        setViewMode(VIEW_FOCUS, true);
      }
    });
  }

  if (thinkingToggleBtn && agentThinkingCard) {
    thinkingToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = agentThinkingCard.classList.toggle("open");
      thinkingToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  // ==========================================================================
  // 0. 模型输出上限规范吸附辅助函数 (Snap to Closest Canonical Token Limits)
  // ==========================================================================
  const STANDARD_OUTPUT_TOKENS = [
    512, 1024, 2048, 4096, 8192, 16384, 32768, 64000, 65536, 100000, 128000, 131072,
  ];

  const snapToClosestStandardTokens = (inputVal) => {
    let num = parseInt(inputVal, 10);
    if (isNaN(num) || num <= 0) return 4096;

    let closest = STANDARD_OUTPUT_TOKENS[0];
    let minDiff = Math.abs(num - closest);

    for (const val of STANDARD_OUTPUT_TOKENS) {
      const diff = Math.abs(num - val);
      if (diff < minDiff) {
        minDiff = diff;
        closest = val;
      }
    }
    return closest;
  };

  const setupOutputTokensAutoSnap = (inputEl) => {
    if (!inputEl) return;
    const doSnap = () => {
      if (inputEl.value && inputEl.value.trim() !== "") {
        const snapped = snapToClosestStandardTokens(inputEl.value);
        inputEl.value = snapped.toString();
      }
    };
    inputEl.addEventListener("blur", doSnap);
    inputEl.addEventListener("change", doSnap);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSnap();
        inputEl.blur();
      }
    });
  };

  // ==========================================================================
  // 1. 软件主题色设置 (Theme Mode: 跟随系统、浅色、暗色)
  // ==========================================================================
  const initThemeControl = () => {
    configService.initTheme();
    const currentTheme = configService.getTheme();

    const themeButtons = document.querySelectorAll(".theme-option");
    themeButtons.forEach((btn) => {
      if (btn.getAttribute("data-theme-val") === currentTheme) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetTheme = btn.getAttribute("data-theme-val");
        configService.applyTheme(targetTheme);

        themeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    configService.addEventListener("theme-change", (e) => {
      const activeTheme = e.detail?.theme || configService.getTheme();
      themeButtons.forEach((b) => {
        if (b.getAttribute("data-theme-val") === activeTheme) {
          b.classList.add("active");
        } else {
          b.classList.remove("active");
        }
      });
    });
  };

  // 异步预加载 ~/.pi-dl/config.json 并初始化主题与控件
  (async () => {
    await configService.loadAppConfig();
    initThemeControl();
  })();

  // ==========================================================================
  // 2. 独立全页面设置视图导航交互
  // ==========================================================================
  const initSettingsTabs = () => {
    const tabButtons = document.querySelectorAll(".settings-tab-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetTab = btn.getAttribute("data-tab");
        if (!targetTab) return;

        tabButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        tabPanes.forEach((pane) => {
          if (pane.id === `pane-${targetTab.replace("tab-", "")}`) {
            pane.classList.add("active");
          } else {
            pane.classList.remove("active");
          }
        });
      });
    });
  };

  initSettingsTabs();

  const openSettingsView = async () => {
    if (currentView !== VIEW_SETTINGS) {
      previousView = currentView;
    }
    setViewMode(VIEW_SETTINGS, false);

    // 右上角提示 3 秒后平滑渐隐
    if (topbarHintBanner) {
      topbarHintBanner.classList.remove("fade-out");
      if (hintBannerTimeout) clearTimeout(hintBannerTimeout);
      hintBannerTimeout = setTimeout(() => {
        topbarHintBanner.classList.add("fade-out");
      }, 3000);
    }

    loadSessions();
    loadModelsAndState();
    loadOfficialProvidersConfig();
    loadCustomProvidersConfig();
  };

  const closeSettingsView = () => {
    if (currentView === VIEW_SETTINGS) {
      setViewMode(previousView || VIEW_DETAILED, true);
      return true;
    }
    return false;
  };

  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openSettingsView();
    });
  }

  if (flowModelTag) {
    flowModelTag.addEventListener("click", (e) => {
      e.preventDefault();
      openSettingsView();
    });
  }

  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen("navigate-settings", () => {
      openSettingsView();
    });
  }

  // ==========================================================================
  // 3. 当前模型列表与白名单机制 (最近选用 MRU 自动排序 + 选中模型禁止删除保护)
  // ==========================================================================
  let officialCatalog = [];

  const updateModelUI = (model, thinkingLevel = null) => {
    if (!model) return;
    const provider = model.provider || "anthropic";
    const name = model.name || model.id || "Unknown Model";
    const contextWin = model.contextWindow
      ? `${(model.contextWindow / 1000).toFixed(0)}k context`
      : "";
    const reasoningText = model.reasoning ? "支持深度推理 (Reasoning)" : "标准对话";

    if (currentModelProvider) currentModelProvider.textContent = provider.toUpperCase();
    if (currentModelName) currentModelName.textContent = name;
    if (currentModelInfo) {
      currentModelInfo.textContent = `${contextWin} · ${reasoningText}`;
    }
    if (flowModelName) {
      flowModelName.textContent = name;
    }

    if (thinkingLevel && thinkingSelectDropdown) {
      thinkingSelectDropdown.value = thinkingLevel;
    }
  };

  const renderWhitelistModels = (activeModel) => {
    if (!whitelistModelsList) return;
    let whitelist = configService.loadModelWhitelist();

    if (!whitelist || whitelist.length === 0) {
      whitelistModelsList.innerHTML = `<div class="empty-sessions">暂无已添加的模型，请前往“官方通道”或“自定义通道”添加模型。</div>`;
      return;
    }

    whitelistModelsList.innerHTML = "";

    whitelist.forEach((m, index) => {
      const item = document.createElement("div");
      item.className = "whitelist-model-item";
      item.setAttribute("data-index", index.toString());

      const isActive =
        activeModel &&
        activeModel.id?.toLowerCase() === m.id?.toLowerCase() &&
        activeModel.provider?.toLowerCase() === m.provider?.toLowerCase();

      if (isActive) {
        item.classList.add("active");
      }

      const contextWin = m.contextWindow
        ? `${(m.contextWindow / 1000).toFixed(0)}k context`
        : "";
      const reasoningTag = m.reasoning
        ? `<span class="flat-badge flat-badge-reasoning" style="display: inline-flex; align-items: center; gap: 4px;"><span class="badge-icon">${ICONS.sparkle}</span> 思考模型</span>`
        : "";
      const customTag = m.isCustom
        ? `<span class="flat-badge flat-badge-custom">自定义端点</span>`
        : "";

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
          <div class="model-item-info">
            <div class="model-item-header">
              <span class="flat-badge">${escapeHtml(m.provider?.toUpperCase() || "OTHER")}</span>
              <span class="model-item-name">${escapeHtml(m.name || m.id)}</span>
              ${reasoningTag}
              ${customTag}
            </div>
            <div class="model-item-meta">
              <span>ID: ${escapeHtml(m.id)}</span>
              ${contextWin ? `<span>· ${contextWin}</span>` : ""}
              ${m.maxTokens ? `<span>· max ${m.maxTokens} tokens</span>` : ""}
            </div>
          </div>
        </div>
        <div class="model-item-actions">
          ${
            isActive
              ? `<span class="flat-badge flat-badge-active">使用中</span>
                 <button type="button" class="flat-btn flat-btn-secondary mini btn-remove-model" disabled style="opacity: 0.35; cursor: not-allowed; display: inline-flex; align-items: center; gap: 4px;" title="当前使用中的模型禁止删除"><span class="btn-icon">${ICONS.lock}</span> 锁定</button>`
              : `<button type="button" class="flat-btn flat-btn-secondary mini btn-select-model">选用</button>
                 <button type="button" class="flat-btn flat-btn-secondary mini btn-remove-model" title="从列表移除" aria-label="从列表移除" style="display: inline-flex; align-items: center; justify-content: center; padding: 4px 6px;">${ICONS.close}</button>`
          }
        </div>
      `;

      // 选用按钮点击 -> 切换模型并将选用模型自动移到列表首位 (MRU)
      const selectBtn = item.querySelector(".btn-select-model");
      if (selectBtn) {
        selectBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          selectBtn.disabled = true;
          try {
            const switched = await piClient.setModel(m.provider, m.id);
            if (switched) {
              configService.saveSelectedModel(m.provider, m.id);
              updateModelUI(switched);
              renderWhitelistModels(switched);
            }
          } catch (err) {
            console.error("Failed to switch model:", err);
            alert(`切换模型失败: ${err}`);
          } finally {
            selectBtn.disabled = false;
          }
        });
      }

      // 移除按钮点击（激活中的模型已禁止删除）
      const removeBtn = item.querySelector(".btn-remove-model");
      if (removeBtn && !isActive) {
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isActive) {
            alert("当前模型正在使用中，禁止删除！");
            return;
          }
          configService.removeModelFromWhitelist(m.provider, m.id);
          renderWhitelistModels(piClient.currentModel);
        });
      }

      whitelistModelsList.appendChild(item);
    });
  };

  const loadModelsAndState = async () => {
    try {
      const [state, catalog] = await Promise.all([
        piClient.getState(),
        configService.getOfficialModelsCatalog(),
      ]);

      officialCatalog = catalog || [];

      // 检查白名单是否已存在，不存在则初始化
      let whitelist = configService.loadModelWhitelist();
      if (!whitelist || whitelist.length === 0) {
        if (state?.model) {
          configService.addModelToWhitelist(state.model);
        }
        officialCatalog.forEach((p) => {
          p.models
            .filter((m) => m.is_default)
            .forEach((m) => {
              configService.addModelToWhitelist(m);
            });
        });
      }

      // 检查本地持久化的用户所选模型
      const savedModel = configService.getSelectedModel();
      let currentActiveModel = state?.model || null;

      if (
        savedModel &&
        savedModel.provider &&
        savedModel.modelId &&
        (!currentActiveModel ||
          currentActiveModel.id?.toLowerCase() !== savedModel.modelId.toLowerCase() ||
          currentActiveModel.provider?.toLowerCase() !== savedModel.provider.toLowerCase())
      ) {
        try {
          const switched = await piClient.setModel(savedModel.provider, savedModel.modelId);
          if (switched) currentActiveModel = switched;
        } catch (e) {
          console.warn("[Main] Auto-switch to saved model failed:", e);
        }
      }

      const savedThinking = configService.getDefaultThinkingLevel();
      if (savedThinking && state?.thinkingLevel !== savedThinking) {
        try {
          await piClient.setThinkingLevel(savedThinking);
        } catch (e) {
          console.warn("[Main] Auto-set saved thinking level failed:", e);
        }
      }

      updateModelUI(currentActiveModel, savedThinking || state?.thinkingLevel);
      renderWhitelistModels(currentActiveModel);
    } catch (err) {
      console.warn("[Main] Failed to load models and state:", err);
    }
  };

  if (thinkingSelectDropdown) {
    thinkingSelectDropdown.addEventListener("change", async () => {
      const level = thinkingSelectDropdown.value;
      try {
        await piClient.setThinkingLevel(level);
        configService.saveDefaultThinkingLevel(level);
        await configService.saveSettingsConfig({ defaultThinkingLevel: level });
      } catch (err) {
        console.error("Failed to change thinking level:", err);
      }
    });
  }

  piClient.addEventListener("model-change", (e) => {
    if (e.detail?.provider && e.detail?.id) {
      configService.touchModelAsRecentlyUsed(e.detail.provider, e.detail.id);
    }
    updateModelUI(e.detail);
    renderWhitelistModels(e.detail);
  });

  // ==========================================================================
  // 4. 官方通道配置与自动拉取模型逻辑
  // ==========================================================================
  let currentOfficialAuth = {};

  const renderOfficialProviderDetails = (providerId) => {
    const provMeta = officialCatalog.find((p) => p.id === providerId);
    if (!provMeta) return;

    if (officialProviderTitle) officialProviderTitle.textContent = provMeta.name;
    if (officialProviderDesc) officialProviderDesc.textContent = provMeta.desc;
    if (officialProviderDoc) {
      officialProviderDoc.href = provMeta.doc_url || "#";
      officialProviderDoc.style.display = provMeta.doc_url ? "inline" : "none";
    }

    const authEntry = currentOfficialAuth[provMeta.id];
    const existingKey = typeof authEntry === "string" ? authEntry : authEntry?.key || "";

    if (officialApiKeyInput) {
      officialApiKeyInput.value = existingKey;
      officialApiKeyInput.placeholder = provMeta.placeholder || "输入 API Key";
    }

    if (officialKeyStatus) {
      if (existingKey) {
        officialKeyStatus.textContent = "● 已在 ~/.pi/agent/auth.json 中配置有效 Key";
        officialKeyStatus.style.color = "#10b981";
      } else {
        officialKeyStatus.textContent = "○ 未配置 API Key";
        officialKeyStatus.style.color = "var(--ink-muted)";
      }
    }

    if (officialModelsGrid) {
      officialModelsGrid.innerHTML = "";
      provMeta.models.forEach((m) => {
        const chip = document.createElement("div");
        chip.className = "official-model-chip";

        const isInWhitelist = configService.isModelInWhitelist(m.provider, m.id);
        const contextWin = m.context_window
          ? `${(m.context_window / 1000).toFixed(0)}k context`
          : "";
        const reasoningTag = m.reasoning
          ? `<span class="flat-badge flat-badge-reasoning" style="display: inline-flex; align-items: center; gap: 4px;"><span class="badge-icon">${ICONS.sparkle}</span> 思考</span>`
          : "";

        chip.innerHTML = `
          <div class="model-item-info">
            <div class="model-item-header">
              <span class="model-item-name">${escapeHtml(m.name || m.id)}</span>
              ${reasoningTag}
            </div>
            <div class="model-item-meta">
              <span>ID: ${escapeHtml(m.id)}</span>
              ${contextWin ? `<span>· ${contextWin}</span>` : ""}
            </div>
          </div>
          <button type="button" class="flat-btn ${isInWhitelist ? "flat-btn-secondary" : "flat-btn-primary"} mini btn-add-official-model" ${isInWhitelist ? "disabled" : ""} style="display: inline-flex; align-items: center; gap: 4px;">
            ${isInWhitelist ? `<span class="btn-icon">${ICONS.check}</span> 已添加` : "+ 添加到当前列表"}
          </button>
        `;

        const addBtn = chip.querySelector(".btn-add-official-model");
        if (addBtn && !isInWhitelist) {
          addBtn.addEventListener("click", () => {
            configService.addModelToWhitelist({
              id: m.id,
              name: m.name,
              provider: m.provider,
              contextWindow: m.context_window,
              maxTokens: m.max_tokens,
              reasoning: m.reasoning,
              isCustom: false,
            });
            addBtn.innerHTML = `<span class="btn-icon">${ICONS.check}</span> 已添加`;
            addBtn.className = "flat-btn flat-btn-secondary mini";
            addBtn.disabled = true;
            renderWhitelistModels(piClient.currentModel);
          });
        }

        officialModelsGrid.appendChild(chip);
      });
    }
  };

  const loadOfficialProvidersConfig = async () => {
    try {
      const [authConfig, catalog] = await Promise.all([
        configService.getAuthConfig(),
        configService.getOfficialModelsCatalog(),
      ]);

      currentOfficialAuth = authConfig || {};
      officialCatalog = catalog || [];

      if (officialProviderSelect) {
        officialProviderSelect.innerHTML = "";
        officialCatalog.forEach((p, idx) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.models.length} 个模型)`;
          if (idx === 0) opt.selected = true;
          officialProviderSelect.appendChild(opt);
        });

        if (officialCatalog.length > 0) {
          officialProviderSelect.value = officialCatalog[0].id;
          renderOfficialProviderDetails(officialCatalog[0].id);
        }

        if (officialProviderSelect.__sketchSelect) {
          officialProviderSelect.__sketchSelect.syncOptions();
        } else {
          enhanceSelect(officialProviderSelect);
        }
      }
    } catch (e) {
      console.warn("[Main] Load official config failed:", e);
    }
  };

  if (officialProviderSelect) {
    officialProviderSelect.addEventListener("change", () => {
      renderOfficialProviderDetails(officialProviderSelect.value);
    });
  }

  if (btnToggleKeyVisibility && officialApiKeyInput) {
    btnToggleKeyVisibility.addEventListener("click", () => {
      const isPwd = officialApiKeyInput.type === "password";
      officialApiKeyInput.type = isPwd ? "text" : "password";
      btnToggleKeyVisibility.innerHTML = isPwd ? ICONS.eye : ICONS.eyeOff;
    });
  }

  if (btnSaveOfficialKey && officialProviderSelect && officialApiKeyInput) {
    btnSaveOfficialKey.addEventListener("click", async () => {
      const provider = officialProviderSelect.value;
      const key = officialApiKeyInput.value.trim();
      btnSaveOfficialKey.disabled = true;

      try {
        await configService.saveProviderApiKey(provider, key);
        currentOfficialAuth = await configService.getAuthConfig();
        renderOfficialProviderDetails(provider);
        alert(`官方通道 [${provider}] API Key 已成功保存至 ~/.pi/agent/auth.json！`);
      } catch (err) {
        console.error("Save API Key failed:", err);
        alert(`保存失败: ${err}`);
      } finally {
        btnSaveOfficialKey.disabled = false;
      }
    });
  }

  // ==========================================================================
  // 5. 自定义通道两步式配置 (Step 1: 新增运营商, Step 2: 运营商内添加/管理模型)
  // ==========================================================================
  const loadCustomProvidersConfig = async () => {
    if (!customProvidersContainer) return;
    try {
      const customConfig = await configService.getCustomModels();
      const providers = customConfig?.providers || {};

      const providerKeys = Object.keys(providers);
      if (providerKeys.length === 0) {
        customProvidersContainer.innerHTML = `<div class="empty-sessions">暂无已配置的运营商，请在上方“步骤 1”中添加第一个运营商。</div>`;
        return;
      }

      customProvidersContainer.innerHTML = "";

      providerKeys.forEach((pKey) => {
        const provData = providers[pKey];
        const models = provData.models || [];

        const card = document.createElement("div");
        card.className = "custom-provider-card";

        const hasKey = provData.apiKey && provData.apiKey.trim().length > 0;
        const keyTag = hasKey
          ? `<span class="flat-badge" style="color: #10b981; border-color: #10b981;">Key: 已配置</span>`
          : `<span class="flat-badge" style="color: var(--ink-muted);">Key: 无</span>`;

        const compat = provData.compat || {};
        const supportsDeveloperRole = compat.supportsDeveloperRole !== undefined
          ? !!compat.supportsDeveloperRole
          : (provData.api === "openai-responses");
        const supportsReasoningEffort = compat.supportsReasoningEffort !== undefined
          ? !!compat.supportsReasoningEffort
          : false;

        const devRoleBadge = supportsDeveloperRole
          ? `<span class="flat-badge" style="color: #f59e0b; border-color: #f59e0b;" title="启用了 developer 消息角色">dev-role: 开</span>`
          : `<span class="flat-badge" style="color: #10b981; border-color: #10b981;" title="使用兼容的 system 消息角色 (安全)">system-role</span>`;

        card.innerHTML = `
          <div class="custom-provider-header">
            <div class="provider-info-left">
              <span class="flat-badge" style="color: #6366f1; border-color: #6366f1;">${escapeHtml(pKey.toUpperCase())}</span>
              <span class="flat-badge">${escapeHtml(provData.api || "openai-completions")}</span>
              ${keyTag}
              ${devRoleBadge}
              <span class="provider-url-meta" title="${escapeHtml(provData.baseUrl || "")}">URL: ${escapeHtml(provData.baseUrl || "")}</span>
            </div>
            <div class="provider-card-actions">
              <button type="button" class="flat-btn flat-btn-secondary mini btn-edit-provider" title="修改运营商接口协议、Base URL、Key 与兼容性配置" style="display: inline-flex; align-items: center; gap: 4px;"><span class="btn-icon">${ICONS.edit}</span> 修改配置</button>
              <button type="button" class="flat-btn flat-btn-primary mini btn-toggle-add-model">+ 新增模型</button>
              <button type="button" class="flat-btn flat-btn-secondary mini btn-delete-provider" style="color: #ef4444;" title="删除此运营商及所有模型">删除运营商</button>
            </div>
          </div>

          <!-- 折叠修改运营商配置表单 -->
          <div class="inline-edit-provider-box hidden" id="inline-edit-prov-${pKey}">
            <div style="font-size: 12px; font-weight: 600; color: var(--ink-primary); display: flex; align-items: center; justify-content: space-between;">
              <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="header-icon">${ICONS.edit}</span> 修改运营商配置 [${escapeHtml(pKey.toUpperCase())}]</span>
              <span style="font-size: 11px; color: var(--ink-muted); font-weight: normal;">修改后自动热加载并写入 ~/.pi/agent/models.json</span>
            </div>
            <div class="form-grid-2">
              <div class="form-field">
                <label class="form-label">接口类型 (API Protocol) <span class="req">*</span></label>
                <select class="flat-select input-edit-api-type">
                  <option value="openai-completions" ${provData.api === "openai-completions" ? "selected" : ""}>openai-completions (OpenAI Chat / 聚合代理 / 硅基 / 火山 / DeepSeek)</option>
                  <option value="openai-responses" ${provData.api === "openai-responses" ? "selected" : ""}>openai-responses (OpenAI Responses API / Azure OpenAI)</option>
                  <option value="anthropic-messages" ${provData.api === "anthropic-messages" ? "selected" : ""}>anthropic-messages (Anthropic Messages API / Claude)</option>
                  <option value="google-generative-ai" ${provData.api === "google-generative-ai" ? "selected" : ""}>google-generative-ai (Google Gemini API)</option>
                  <option value="ollama" ${provData.api === "ollama" ? "selected" : ""}>ollama (Ollama 本地端点)</option>
                </select>
              </div>
              <div class="form-field">
                <label class="form-label">接口地址 (Base URL) <span class="req">*</span></label>
                <input type="url" class="flat-input input-edit-base-url" value="${escapeHtml(provData.baseUrl || "")}" placeholder="如 https://api.siliconflow.cn/v1" required />
              </div>
            </div>
            <div class="form-field">
              <label class="form-label">API Key (留空表示清除，支持 $ENV_VAR 环境变量插值)</label>
              <input type="password" class="flat-input input-edit-api-key" value="${escapeHtml(provData.apiKey || "")}" placeholder="sk-... 或留空" />
            </div>
            <div class="form-grid-2" style="margin-top: 2px;">
              <div class="form-field checkbox-field">
                <label class="checkbox-label" title="开启后以 developer role 发送系统提示词。国内/聚合平台（DeepSeek、火山方舟等）不支持此角色，会导致 400 报错，请保持未勾选。">
                  <input type="checkbox" class="input-edit-developer-role" ${supportsDeveloperRole ? "checked" : ""} />
                  <span>启用 developer 角色 (兼容端点请勿勾)</span>
                </label>
              </div>
              <div class="form-field checkbox-field">
                <label class="checkbox-label" title="是否支持 reasoning_effort 思考参数">
                  <input type="checkbox" class="input-edit-reasoning-effort" ${supportsReasoningEffort ? "checked" : ""} />
                  <span>支持 reasoning_effort 思考参数</span>
                </label>
              </div>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
              <button type="button" class="flat-btn flat-btn-secondary mini btn-cancel-edit-prov">取消</button>
              <button type="button" class="flat-btn flat-btn-primary mini btn-save-edit-prov">保存修改</button>
            </div>
          </div>

          <!-- 折叠添加模型表单 -->
          <div class="inline-add-model-box hidden" id="inline-form-${pKey}">
            <div style="font-size: 12px; font-weight: 600; color: var(--ink-primary);">新增模型到运营商 [${escapeHtml(pKey.toUpperCase())}]</div>
            <div class="form-grid-2">
              <div class="form-field">
                <label class="form-label">模型标识 (Model ID) <span class="req">*</span></label>
                <input type="text" class="flat-input input-new-model-id" placeholder="如 deepseek-ai/DeepSeek-V3, gpt-4o" required />
              </div>
              <div class="form-field">
                <label class="form-label">显示名称 (Display Name)</label>
                <input type="text" class="flat-input input-new-model-name" placeholder="可选，如 DeepSeek V3" />
              </div>
            </div>
            <div class="form-grid-3">
              <div class="form-field">
                <label class="form-label">上下文 (Tokens)</label>
                <input type="number" class="flat-input input-new-context-win" value="64000" min="1000" step="1000" />
              </div>
              <div class="form-field">
                <label class="form-label">输出上限 (Tokens)</label>
                <input type="number" class="flat-input input-new-max-tokens" value="4096" min="256" step="256" />
              </div>
              <div class="form-field checkbox-field">
                <label class="checkbox-label">
                  <input type="checkbox" class="input-new-reasoning" checked />
                  <span>支持思考/推理</span>
                </label>
              </div>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button type="button" class="flat-btn flat-btn-secondary mini btn-cancel-add-model">取消</button>
              <button type="button" class="flat-btn flat-btn-primary mini btn-confirm-add-model">保存并添加到列表</button>
            </div>
          </div>

          <!-- 运营商下的模型列表 -->
          <div class="provider-models-wrapper">
            <div class="provider-models-title">
              <span>已挂载模型 (${models.length})</span>
            </div>
            <div class="provider-models-list">
              ${
                models.length === 0
                  ? `<div style="font-size: 11px; color: var(--ink-muted); padding: 4px 0;">暂无模型，点击右上角「+ 新增模型」添加。</div>`
                  : ""
              }
            </div>
          </div>
        `;

        // 绑定修改运营商配置
        const inlineEditForm = card.querySelector(".inline-edit-provider-box");
        const btnEditProvider = card.querySelector(".btn-edit-provider");
        const btnCancelEditProv = card.querySelector(".btn-cancel-edit-prov");
        const btnSaveEditProv = card.querySelector(".btn-save-edit-prov");
        const inlineAddForm = card.querySelector(".inline-add-model-box");

        // 绑定新增模型输入框输出上限自动规范吸附
        if (inlineAddForm) {
          const inputNewMaxTokens = inlineAddForm.querySelector(".input-new-max-tokens");
          setupOutputTokensAutoSnap(inputNewMaxTokens);
        }

        if (btnEditProvider && inlineEditForm) {
          btnEditProvider.addEventListener("click", () => {
            inlineEditForm.classList.toggle("hidden");
            if (!inlineEditForm.classList.contains("hidden") && inlineAddForm) {
              inlineAddForm.classList.add("hidden");
            }
          });
        }

        if (btnCancelEditProv && inlineEditForm) {
          btnCancelEditProv.addEventListener("click", () => {
            inlineEditForm.classList.add("hidden");
          });
        }

        if (btnSaveEditProv && inlineEditForm) {
          btnSaveEditProv.addEventListener("click", async () => {
            const inputApiType = inlineEditForm.querySelector(".input-edit-api-type");
            const inputBaseUrl = inlineEditForm.querySelector(".input-edit-base-url");
            const inputApiKey = inlineEditForm.querySelector(".input-edit-api-key");
            const inputDevRole = inlineEditForm.querySelector(".input-edit-developer-role");
            const inputReasoningEffort = inlineEditForm.querySelector(".input-edit-reasoning-effort");

            const newApiType = inputApiType?.value.trim() || "openai-completions";
            const newBaseUrl = inputBaseUrl?.value.trim();
            if (!newBaseUrl) {
              alert("接口地址 (Base URL) 不能为空");
              inputBaseUrl?.focus();
              return;
            }
            const newApiKey = inputApiKey?.value.trim() || null;
            const newDevRole = !!inputDevRole?.checked;
            const newReasoningEffort = !!inputReasoningEffort?.checked;

            btnSaveEditProv.disabled = true;
            try {
              await configService.saveCustomProvider({
                provider_id: pKey,
                api_type: newApiType,
                base_url: newBaseUrl,
                api_key: newApiKey,
                supports_developer_role: newDevRole,
                supports_reasoning_effort: newReasoningEffort,
              });

              alert(`运营商 [${pKey.toUpperCase()}] 配置已成功更新！`);
              loadCustomProvidersConfig();
            } catch (err) {
              console.error("Save custom provider failed:", err);
              alert(`更新运营商配置失败: ${err}`);
            } finally {
              btnSaveEditProv.disabled = false;
            }
          });
        }

        // 绑定删除运营商
        const btnDeleteProvider = card.querySelector(".btn-delete-provider");
        if (btnDeleteProvider) {
          btnDeleteProvider.addEventListener("click", async () => {
            if (confirm(`确定要删除运营商 [${pKey.toUpperCase()}] 及其全部模型配置吗？`)) {
              await configService.deleteCustomProvider(pKey);
              // 清理白名单中该运营商的模型
              models.forEach((m) => configService.removeModelFromWhitelist(pKey, m.id));
              loadCustomProvidersConfig();
              renderWhitelistModels(piClient.currentModel);
            }
          });
        }

        // 绑定新增模型折叠切换
        const btnToggleAddModel = card.querySelector(".btn-toggle-add-model");
        const btnCancelAddModel = card.querySelector(".btn-cancel-add-model");

        if (btnToggleAddModel && inlineAddForm) {
          btnToggleAddModel.addEventListener("click", () => {
            inlineAddForm.classList.toggle("hidden");
            if (!inlineAddForm.classList.contains("hidden") && inlineEditForm) {
              inlineEditForm.classList.add("hidden");
            }
          });
        }

        if (btnCancelAddModel && inlineAddForm) {
          btnCancelAddModel.addEventListener("click", () => {
            inlineAddForm.classList.add("hidden");
          });
        }

        // 提交添加模型
        const btnConfirmAddModel = card.querySelector(".btn-confirm-add-model");
        if (btnConfirmAddModel && inlineAddForm) {
          btnConfirmAddModel.addEventListener("click", async () => {
            const inputModelId = inlineAddForm.querySelector(".input-new-model-id");
            const inputModelName = inlineAddForm.querySelector(".input-new-model-name");
            const inputContextWin = inlineAddForm.querySelector(".input-new-context-win");
            const inputMaxTokens = inlineAddForm.querySelector(".input-new-max-tokens");
            const inputReasoning = inlineAddForm.querySelector(".input-new-reasoning");

            const modelIdVal = inputModelId?.value.trim();
            if (!modelIdVal) {
              alert("请输入模型标识 (Model ID)");
              inputModelId?.focus();
              return;
            }

            const modelNameVal = inputModelName?.value.trim() || modelIdVal;
            const contextWinVal = parseInt(inputContextWin?.value, 10) || 64000;
            const maxTokensVal = snapToClosestStandardTokens(inputMaxTokens?.value);
            if (inputMaxTokens) {
              inputMaxTokens.value = maxTokensVal.toString();
            }
            const reasoningVal = !!inputReasoning?.checked;

            btnConfirmAddModel.disabled = true;
            try {
              await configService.addCustomProviderModel({
                provider_id: pKey,
                model_id: modelIdVal,
                model_name: modelNameVal,
                context_window: contextWinVal,
                max_tokens: maxTokensVal,
                reasoning: reasoningVal,
              });

              // 自动添加到白名单 (插入到首位)
              configService.addModelToWhitelist({
                id: modelIdVal,
                name: modelNameVal,
                provider: pKey,
                contextWindow: contextWinVal,
                maxTokens: maxTokensVal,
                reasoning: reasoningVal,
                isCustom: true,
              });

              alert(`模型 [${modelNameVal}] 已成功添加至运营商 [${pKey.toUpperCase()}] 并加入当前模型列表！`);
              loadCustomProvidersConfig();
              renderWhitelistModels(piClient.currentModel);
            } catch (err) {
              console.error("Add model failed:", err);
              alert(`添加模型失败: ${err}`);
            } finally {
              btnConfirmAddModel.disabled = false;
            }
          });
        }

        // 渲染此运营商下的模型条目
        const modelsListEl = card.querySelector(".provider-models-list");
        if (modelsListEl && models.length > 0) {
          models.forEach((m) => {
            const chip = document.createElement("div");
            chip.className = "official-model-chip";

            const isInWhitelist = configService.isModelInWhitelist(pKey, m.id);
            const contextWin = m.contextWindow
              ? `${(m.contextWindow / 1000).toFixed(0)}k context`
              : "";
            const reasoningTag = m.reasoning
              ? `<span class="flat-badge flat-badge-reasoning" style="display: inline-flex; align-items: center; gap: 4px;"><span class="badge-icon">${ICONS.sparkle}</span> 思考</span>`
              : "";

            chip.innerHTML = `
              <div class="model-item-info">
                <div class="model-item-header">
                  <span class="model-item-name">${escapeHtml(m.name || m.id)}</span>
                  ${reasoningTag}
                </div>
                <div class="model-item-meta">
                  <span>ID: ${escapeHtml(m.id)}</span>
                  ${contextWin ? `<span>· ${contextWin}</span>` : ""}
                  ${m.maxTokens ? `<span>· max ${m.maxTokens} tokens</span>` : ""}
                </div>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <button type="button" class="flat-btn flat-btn-secondary mini btn-edit-custom-model" title="修改模型参数" style="display: inline-flex; align-items: center; gap: 4px;"><span class="btn-icon">${ICONS.edit}</span> 编辑</button>
                <button type="button" class="flat-btn ${isInWhitelist ? "flat-btn-secondary" : "flat-btn-primary"} mini btn-add-custom-whitelist" ${isInWhitelist ? "disabled" : ""} style="display: inline-flex; align-items: center; gap: 4px;">
                  ${isInWhitelist ? `<span class="btn-icon">${ICONS.check}</span> 已添加` : "+ 添加到当前列表"}
                </button>
                <button type="button" class="flat-btn flat-btn-danger mini btn-delete-custom-model" title="删除模型">删除</button>
              </div>
            `;

            // 模型行内编辑面板
            const modelEditBox = document.createElement("div");
            modelEditBox.className = "inline-add-model-box hidden";
            modelEditBox.innerHTML = `
              <div style="font-size: 11px; font-weight: 600; color: var(--ink-primary); display: flex; align-items: center; gap: 4px;"><span class="header-icon">${ICONS.edit}</span> 编辑模型 [${escapeHtml(m.id)}]</div>
              <div class="form-grid-2">
                <div class="form-field">
                  <label class="form-label">模型标识 (Model ID)</label>
                  <input type="text" class="flat-input input-edit-model-id" value="${escapeHtml(m.id)}" readonly style="opacity: 0.75; cursor: not-allowed;" />
                </div>
                <div class="form-field">
                  <label class="form-label">显示名称 (Display Name)</label>
                  <input type="text" class="flat-input input-edit-model-name" value="${escapeHtml(m.name || m.id)}" />
                </div>
              </div>
              <div class="form-grid-3">
                <div class="form-field">
                  <label class="form-label">上下文 (Tokens)</label>
                  <input type="number" class="flat-input input-edit-context-win" value="${m.contextWindow || 64000}" min="1000" step="1000" />
                </div>
                <div class="form-field">
                  <label class="form-label">输出上限 (Tokens)</label>
                  <input type="number" class="flat-input input-edit-max-tokens" value="${m.maxTokens || 4096}" min="256" step="256" />
                </div>
                <div class="form-field checkbox-field">
                  <label class="checkbox-label">
                    <input type="checkbox" class="input-edit-reasoning" ${m.reasoning ? "checked" : ""} />
                    <span>支持思考/推理</span>
                  </label>
                </div>
              </div>
              <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button type="button" class="flat-btn flat-btn-secondary mini btn-cancel-edit-model">取消</button>
                <button type="button" class="flat-btn flat-btn-primary mini btn-save-edit-model">保存模型修改</button>
              </div>
            `;

            // 绑定编辑模型输入框输出上限自动规范吸附
            const inputEditMaxTokens = modelEditBox.querySelector(".input-edit-max-tokens");
            setupOutputTokensAutoSnap(inputEditMaxTokens);

            // 绑定编辑模型按钮
            const btnEditModel = chip.querySelector(".btn-edit-custom-model");
            const btnCancelEditModel = modelEditBox.querySelector(".btn-cancel-edit-model");
            const btnSaveEditModel = modelEditBox.querySelector(".btn-save-edit-model");

            if (btnEditModel) {
              btnEditModel.addEventListener("click", () => {
                modelEditBox.classList.toggle("hidden");
              });
            }

            if (btnCancelEditModel) {
              btnCancelEditModel.addEventListener("click", () => {
                modelEditBox.classList.add("hidden");
              });
            }

            if (btnSaveEditModel) {
              btnSaveEditModel.addEventListener("click", async () => {
                const inputName = modelEditBox.querySelector(".input-edit-model-name");
                const inputContext = modelEditBox.querySelector(".input-edit-context-win");
                const inputMax = modelEditBox.querySelector(".input-edit-max-tokens");
                const inputReas = modelEditBox.querySelector(".input-edit-reasoning");

                const updatedName = inputName?.value.trim() || m.id;
                const updatedContext = parseInt(inputContext?.value, 10) || 64000;
                const updatedMax = snapToClosestStandardTokens(inputMax?.value);
                if (inputMax) {
                  inputMax.value = updatedMax.toString();
                }
                const updatedReas = !!inputReas?.checked;

                btnSaveEditModel.disabled = true;
                try {
                  await configService.addCustomProviderModel({
                    provider_id: pKey,
                    model_id: m.id,
                    model_name: updatedName,
                    context_window: updatedContext,
                    max_tokens: updatedMax,
                    reasoning: updatedReas,
                  });

                  // 如果该模型已在白名单中，同步更新白名单
                  if (configService.isModelInWhitelist(pKey, m.id)) {
                    configService.addModelToWhitelist({
                      id: m.id,
                      name: updatedName,
                      provider: pKey,
                      contextWindow: updatedContext,
                      maxTokens: updatedMax,
                      reasoning: updatedReas,
                      isCustom: true,
                    });
                  }

                  alert(`模型 [${updatedName}] 配置已成功更新！`);
                  loadCustomProvidersConfig();
                  renderWhitelistModels(piClient.currentModel);
                } catch (err) {
                  console.error("Update model failed:", err);
                  alert(`更新模型失败: ${err}`);
                } finally {
                  btnSaveEditModel.disabled = false;
                }
              });
            }

            // 添加到当前列表
            const addBtn = chip.querySelector(".btn-add-custom-whitelist");
            if (addBtn && !isInWhitelist) {
              addBtn.addEventListener("click", () => {
                configService.addModelToWhitelist({
                  id: m.id,
                  name: m.name || m.id,
                  provider: pKey,
                  contextWindow: m.contextWindow || 64000,
                  maxTokens: m.maxTokens || 4096,
                  reasoning: !!m.reasoning,
                  isCustom: true,
                });
                addBtn.innerHTML = `<span class="btn-icon">${ICONS.check}</span> 已添加`;
                addBtn.className = "flat-btn flat-btn-secondary mini";
                addBtn.disabled = true;
                renderWhitelistModels(piClient.currentModel);
              });
            }

            // 删除单个模型
            const delBtn = chip.querySelector(".btn-delete-custom-model");
            if (delBtn) {
              delBtn.addEventListener("click", async () => {
                if (confirm(`确定要删除模型 [${m.name || m.id}] 吗？`)) {
                  await configService.deleteCustomModel(pKey, m.id);
                  configService.removeModelFromWhitelist(pKey, m.id);
                  loadCustomProvidersConfig();
                  renderWhitelistModels(piClient.currentModel);
                }
              });
            }

            modelsListEl.appendChild(chip);
            modelsListEl.appendChild(modelEditBox);
          });
        }

        customProvidersContainer.appendChild(card);
      });
      enhanceAllSelects(customProvidersContainer);
    } catch (e) {
      console.warn("[Main] Load custom providers failed:", e);
    }
  };

  // 第一步：保存/更新自定义运营商
  if (customProviderForm) {
    customProviderForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const providerId = customProviderId.value.trim();
      const apiType = customApiType.value.trim();
      const baseUrl = customBaseUrl.value.trim();
      const apiKey = customApiKey.value.trim() || null;
      const customDevRole = document.getElementById("custom-supports-dev-role");
      const customReasoningEffort = document.getElementById("custom-supports-reasoning-effort");

      const saveBtn = document.getElementById("btn-save-custom-provider");
      if (saveBtn) saveBtn.disabled = true;

      try {
        await configService.saveCustomProvider({
          provider_id: providerId,
          api_type: apiType,
          base_url: baseUrl,
          api_key: apiKey,
          supports_developer_role: customDevRole ? !!customDevRole.checked : (apiType === "openai-responses"),
          supports_reasoning_effort: customReasoningEffort ? !!customReasoningEffort.checked : false,
        });

        alert(`运营商 [${providerId.toUpperCase()}] 已成功保存！现在可以在下方“步骤 2”中为该运营商添加具体模型或修改配置。`);
        customProviderId.value = "";
        customBaseUrl.value = "";
        customApiKey.value = "";

        loadCustomProvidersConfig();
      } catch (err) {
        console.error("Save custom provider failed:", err);
        alert(`保存运营商失败: ${err}`);
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  // 初始加载
  loadModelsAndState();

  // ==========================================================================
  // 6. 宿主与版本控制逻辑
  // ==========================================================================
  const updateHostUI = (statusPayload) => {
    const status = typeof statusPayload === "string" ? statusPayload : statusPayload?.status || "ready";
    if (hostStatusText) hostStatusText.textContent = status;
    if (hostStatusDot) {
      hostStatusDot.className = "status-dot";
      if (status === "ready") hostStatusDot.classList.add("status-ready");
      else if (status === "starting") hostStatusDot.classList.add("status-starting");
      else if (status === "crashed") hostStatusDot.classList.add("status-crashed");
      else hostStatusDot.classList.add("status-stopped");
    }

    if (statusPayload?.pi_version && hostVersionText) {
      hostVersionText.textContent = `v${statusPayload.pi_version}`;
    }
  };

  piClient.addEventListener("status-change", (e) => {
    updateHostUI(e.detail);
    if (e.detail?.status === "ready") {
      loadModelsAndState();
    }
  });

  if (btnRestartHost) {
    btnRestartHost.addEventListener("click", async () => {
      btnRestartHost.disabled = true;
      try {
        await piClient.restartHost();
      } catch (err) {
        console.error("Restart host failed:", err);
      } finally {
        setTimeout(() => {
          btnRestartHost.disabled = false;
        }, 1000);
      }
    });
  }

  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener("click", async () => {
      btnCheckUpdate.disabled = true;
      try {
        const res = await versionService.checkUpdate();
        if (res && res.has_update) {
          if (updateNotice) updateNotice.classList.remove("hidden");
          if (updateMsg) updateMsg.textContent = `发现新版本 v${res.latest_version}！`;
          if (settingsBadge) settingsBadge.classList.add("visible");
        } else {
          if (updateNotice) updateNotice.classList.remove("hidden");
          if (updateMsg) updateMsg.textContent = `已是最新版本 (v${res?.current_version || "0.84.3"})`;
        }
      } catch (err) {
        console.error("Check update failed:", err);
      } finally {
        btnCheckUpdate.disabled = false;
      }
    });
  }

  versionService.addEventListener("update-available", (e) => {
    const info = e.detail;
    if (info && info.has_update) {
      if (settingsBadge) settingsBadge.classList.add("visible");
      if (updateNotice) updateNotice.classList.remove("hidden");
      if (updateMsg) updateMsg.textContent = `发现新版本 v${info.latest_version}！`;
    }
  });

  // ==========================================================================
  // 7. 会话列表渲染与操作
  // ==========================================================================
  const loadSessions = async () => {
    if (!sessionsList) return;
    const list = await sessionService.listSessions();
    if (sessionCount) sessionCount.textContent = list.length.toString();

    if (list.length === 0) {
      sessionsList.innerHTML = `<div class="empty-sessions">暂无历史会话</div>`;
      return;
    }

    sessionsList.innerHTML = "";
    list.forEach((s) => {
      const item = document.createElement("div");
      item.className = "session-item";

      const formattedDate = s.modified_at
        ? new Date(s.modified_at).toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      item.innerHTML = `
        <div class="session-title-line">
          <span class="session-name" title="${escapeHtml(s.session_id)}">${escapeHtml(s.session_id.substring(0, 16))}...</span>
          <span class="session-date">${formattedDate}</span>
        </div>
        <div class="session-snippet">${escapeHtml(s.first_message || `(${s.message_count} 条消息)`)}</div>
      `;

      item.addEventListener("click", async () => {
        try {
          await sessionService.switchSession(s.file_path);
          closeSettingsView();
          setViewMode(VIEW_FLOW, true);
        } catch (err) {
          console.error("Failed to switch session:", err);
        }
      });

      sessionsList.appendChild(item);
    });
  };

  sessionService.addEventListener("sessions-change", () => {
    loadSessions();
  });

  if (btnNewSession) {
    btnNewSession.addEventListener("click", async () => {
      try {
        await sessionService.newSession();
        closeSettingsView();
        setViewMode(VIEW_DETAILED, false);
      } catch (err) {
        console.error("Failed to create new session:", err);
      }
    });
  }

  // ==========================================================================
  // 窗口控制元素
  // ==========================================================================
  const btnMinimize = document.getElementById("btn-minimize");
  const btnMaximize = document.getElementById("btn-maximize");
  const btnClose = document.getElementById("btn-close");
  const titlebar = document.getElementById("titlebar");

  if (btnMinimize) {
    btnMinimize.addEventListener("click", () => invokeTauri("minimize_window"));
  }
  if (btnMaximize) {
    btnMaximize.addEventListener("click", () => invokeTauri("toggle_maximize_window"));
  }
  if (btnClose) {
    btnClose.addEventListener("click", () => invokeTauri("close_window"));
  }

  if (titlebar) {
    titlebar.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".titlebar-controls") && !e.target.closest(".flow-mini-brand") && !e.target.closest(".flow-model-tag")) {
        invokeTauri("toggle_maximize_window");
      }
    });
  }

  // ==========================================================================
  // 极简安全 Markdown 渲染器
  // ==========================================================================
  const renderMarkdown = (text) => {
    if (!text) return "";
    let html = escapeHtml(text);

    // 1. 代码块 ```lang ... ```
    html = html.replace(/```([a-zA-Z0-9_\-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${code}</code></pre>`;
    });

    // 2. 行内代码 `code`
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // 3. 粗体与斜体
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // 4. 引用块 >
    html = html.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");

    // 5. 列表与换行
    html = html.replace(/^- (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

    // 6. 段落换行
    html = html.replace(/\n\n+/g, "</p><p>");
    html = html.replace(/\n/g, "<br/>");

    return `<p>${html}</p>`;
  };

  // ==========================================================================
  // 流式消息、工具调用与全链路错误渲染中心
  // ==========================================================================
  let thinkingStartTime = 0;
  let thinkingTimerInterval = null;
  let currentThinkingText = "";
  let currentResponseText = "";
  let lastUserQuery = "";
  let hasReceivedDelta = false;
  let hasAutoCollapsedThinking = false;
  const renderedToolCards = new Map();

  const collapseThinkingCard = () => {
    if (agentThinkingCard && agentThinkingCard.classList.contains("open")) {
      agentThinkingCard.classList.remove("open");
      if (thinkingToggleBtn) thinkingToggleBtn.setAttribute("aria-expanded", "false");
    }
  };

  const expandThinkingCard = () => {
    if (agentThinkingCard && !agentThinkingCard.classList.contains("open")) {
      agentThinkingCard.classList.add("open");
      if (thinkingToggleBtn) thinkingToggleBtn.setAttribute("aria-expanded", "true");
    }
  };

  const autoCollapseThinkingOnNextPhase = () => {
    if (!hasAutoCollapsedThinking) {
      hasAutoCollapsedThinking = true;
      collapseThinkingCard();
    }
  };

  const resetStreamState = (query) => {
    lastUserQuery = query;
    hasReceivedDelta = false;
    hasAutoCollapsedThinking = false;
    if (flowUserText) flowUserText.textContent = query;
    currentThinkingText = "";
    currentResponseText = "";
    renderedToolCards.clear();

    if (flowInjectionCapsule) {
      flowInjectionCapsule.classList.add("hidden");
    }

    if (thinkingTextStream) thinkingTextStream.innerHTML = "";
    if (toolCallsContainer) toolCallsContainer.innerHTML = "";
    if (flowResponseContent) {
      flowResponseContent.innerHTML = `<span class="streaming-cursor"></span>`;
    }

    expandThinkingCard();

    thinkingStartTime = Date.now();
    if (thinkingTimerInterval) clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = setInterval(() => {
      if (thinkingDuration) {
        const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        thinkingDuration.textContent = `思考中 (${elapsed}s)...`;
      }
    }, 100);
  };

  const finalizeStream = () => {
    if (thinkingTimerInterval) {
      clearInterval(thinkingTimerInterval);
      thinkingTimerInterval = null;
      if (thinkingDuration) {
        const finalElapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        thinkingDuration.textContent = `已思考 ${finalElapsed} 秒`;
      }
    }
    // 移除光标
    if (flowResponseContent) {
      const cursor = flowResponseContent.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
    }
  };

  /**
   * 渲染手绘草图风格异常诊断卡片并提供快捷操作
   * @param {{ message: string, model?: string, provider?: string }} errDetail
   */
  const renderErrorCard = (errDetail) => {
    finalizeStream();
    if (!flowResponseContent) return;

    const errMsg = errDetail?.message || "与模型服务通信中断或返回异常";
    const activeModelName = errDetail?.model || piClient.currentModel?.id || "当前模型";

    const cardHtml = `
      <div class="sketch-error-card">
        <div class="error-header">
          <span class="error-icon" aria-hidden="true">${ICONS.warning}</span>
          <span class="error-title">模型调用失败 [${escapeHtml(activeModelName)}]</span>
        </div>
        <div class="error-message-text">${escapeHtml(errMsg)}</div>
        <div class="error-actions">
          <button type="button" class="error-btn retry-btn" id="btn-err-retry">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2.5 8a5.5 5.5 0 0 1 9.39-3.89L13.5 5.5" />
              <path d="M13.5 2v3.5H10" />
              <path d="M13.5 8a5.5 5.5 0 0 1-9.39 3.89L2.5 10.5" />
              <path d="M2.5 14v-3.5H6" />
            </svg>
            重试当前提问
          </button>
          <button type="button" class="error-btn" id="btn-err-switch-model">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="8" r="3" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
            </svg>
            切换其他模型
          </button>
        </div>
      </div>
    `;

    // 如果未收到任何有效回答内容，直接替换错误卡片；若有部分内容，追加在末尾
    if (!hasReceivedDelta) {
      flowResponseContent.innerHTML = cardHtml;
    } else {
      flowResponseContent.insertAdjacentHTML("beforeend", cardHtml);
    }

    const btnRetry = document.getElementById("btn-err-retry");
    const btnSwitch = document.getElementById("btn-err-switch-model");

    if (btnRetry) {
      btnRetry.addEventListener("click", () => {
        if (lastUserQuery) {
          handleFlowQuery(lastUserQuery);
        }
      });
    }

    if (btnSwitch) {
      btnSwitch.addEventListener("click", () => {
        openSettingsView();
      });
    }
  };

  // 绑定 PiClient 流式事件
  piClient.addEventListener("thinking-start", () => {
    hasReceivedDelta = true;
    expandThinkingCard();
  });

  piClient.addEventListener("thinking-delta", (e) => {
    hasReceivedDelta = true;
    currentThinkingText += e.detail;
    if (thinkingTextStream) {
      thinkingTextStream.textContent = currentThinkingText;
    }
    if (thinkingBody) {
      thinkingBody.scrollTop = thinkingBody.scrollHeight;
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("thinking-end", () => {
    if (thinkingDuration) {
      const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
      thinkingDuration.textContent = `已思考 ${elapsed} 秒`;
    }
    autoCollapseThinkingOnNextPhase();
  });

  piClient.addEventListener("text-start", () => {
    hasReceivedDelta = true;
    autoCollapseThinkingOnNextPhase();
  });

  piClient.addEventListener("text-delta", (e) => {
    hasReceivedDelta = true;
    autoCollapseThinkingOnNextPhase();
    currentResponseText += e.detail;
    if (flowResponseContent) {
      flowResponseContent.innerHTML = renderMarkdown(currentResponseText) + `<span class="streaming-cursor"></span>`;
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  const activeToolSkillMappings = new Map();

  const loadInnerSkillMappings = async () => {
    try {
      const mappings = await invokeTauri("pi_get_skill_mappings");
      if (Array.isArray(mappings)) {
        activeToolSkillMappings.clear();
        mappings.forEach((item) => {
          if (Array.isArray(item.tools) && item.skill_name) {
            item.tools.forEach((t) => {
              activeToolSkillMappings.set(t.toLowerCase(), {
                skill: item.skill_name,
                label: `已激活运行态技能：${item.skill_name} (${item.skill_name === "windows-bash-compatibility" ? "Windows Shell 兼容规范" : "运行态约束"})`,
              });
            });
          }
        });
      }
    } catch (err) {
      console.warn("[Main] Failed to load skill mappings from RULES.md:", err);
      // 安全降级
      activeToolSkillMappings.set("bash", { skill: "windows-bash-compatibility", label: "已激活运行态技能：windows-bash-compatibility (Windows Shell 兼容规范)" });
      activeToolSkillMappings.set("powershell", { skill: "windows-bash-compatibility", label: "已激活运行态技能：windows-bash-compatibility (Windows Shell 兼容规范)" });
      activeToolSkillMappings.set("terminal", { skill: "windows-bash-compatibility", label: "已激活运行态技能：windows-bash-compatibility (Windows Shell 兼容规范)" });
      activeToolSkillMappings.set("cmd", { skill: "windows-bash-compatibility", label: "已激活运行态技能：windows-bash-compatibility (Windows Shell 兼容规范)" });
    }
  };

  const showInnerSkillCapsuleForTool = (rawToolName) => {
    if (!rawToolName || !flowInjectionCapsule || !flowInjectionText) return;
    const nameLower = rawToolName.toString().toLowerCase().trim();
    const mapped = activeToolSkillMappings.get(nameLower);
    if (mapped) {
      flowInjectionText.textContent = mapped.label || `已激活运行态技能：${mapped.skill}`;
      flowInjectionCapsule.classList.remove("hidden");
      if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  loadInnerSkillMappings();

  piClient.addEventListener("toolcall-delta-start", (e) => {
    autoCollapseThinkingOnNextPhase();
    const evt = e.detail;
    if (evt?.toolCall?.name) {
      showInnerSkillCapsuleForTool(evt.toolCall.name);
    }
  });

  piClient.addEventListener("tool-start", (e) => {
    hasReceivedDelta = true;
    autoCollapseThinkingOnNextPhase();
    const data = e.detail;
    const toolCallId = data.toolCallId;
    const toolName = data.toolName || "tool";

    // 当底层 Agent 触发调用映射工具（如 bash）时，即时显现运行态技能注入胶囊
    showInnerSkillCapsuleForTool(toolName);

    const card = document.createElement("div");
    card.className = "tool-card running";
    card.id = `tool-${toolCallId}`;

    const argsStr = data.args ? JSON.stringify(data.args, null, 2) : "";

    card.innerHTML = `
      <div class="tool-header">
        <div class="tool-title-group">
          <span class="tool-icon" aria-hidden="true">${ICONS.tool}</span>
          <span class="tool-name">${escapeHtml(toolName)}</span>
        </div>
        <span class="tool-status-badge">running</span>
      </div>
      <div class="tool-body">${escapeHtml(argsStr)}</div>
    `;

    if (toolCallsContainer) {
      toolCallsContainer.appendChild(card);
    }
    renderedToolCards.set(toolCallId, card);
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("bash-update", () => {
    showInnerSkillCapsuleForTool("bash");
  });

  piClient.addEventListener("tool-update", (e) => {
    const data = e.detail;
    const card = renderedToolCards.get(data.toolCallId);
    if (card) {
      const body = card.querySelector(".tool-body");
      if (body && data.partialResult) {
        const text = typeof data.partialResult === "string" ? data.partialResult : JSON.stringify(data.partialResult, null, 2);
        body.textContent = text;
      }
    }
  });

  piClient.addEventListener("tool-end", (e) => {
    const data = e.detail;
    const card = renderedToolCards.get(data.toolCallId);
    if (card) {
      card.classList.remove("running");
      card.classList.add(data.isError ? "error" : "done");
      const badge = card.querySelector(".tool-status-badge");
      if (badge) {
        badge.textContent = data.isError ? "failed" : "done";
      }
      const body = card.querySelector(".tool-body");
      if (body && data.result) {
        const resText = typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2);
        body.textContent = resText;
      }
    }
  });

  piClient.addEventListener("retry-status", (e) => {
    const data = e.detail;
    if (thinkingDuration && data.attempt) {
      thinkingDuration.textContent = `自动重试中 (${data.attempt}/${data.maxAttempts || 3})...`;
    }
  });

  piClient.addEventListener("agent-error", (e) => {
    renderErrorCard(e.detail);
  });

  piClient.addEventListener("agent-end", () => {
    finalizeStream();
  });

  /**
   * 触发用户提问并向 Pi 下发指令
   * @param {string} query
   */
  const handleFlowQuery = async (query) => {
    if (!query) return;

    resetStreamState(query);
    setViewMode(VIEW_FLOW, true);
    searchInput.value = "";
    updateInputState();

    try {
      await piClient.sendPrompt(query);
    } catch (err) {
      console.error("Failed to send prompt to Pi:", err);
      renderErrorCard({
        message: err.toString(),
      });
    }
  };



  // 表单回车提交
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
      handleFlowQuery(query);
    }
  });

  // 手绘草图快捷标签点击
  const sketchTags = document.querySelectorAll(".sketch-tag");
  sketchTags.forEach((tag) => {
    tag.addEventListener("click", () => {
      const query = tag.getAttribute("data-query");
      if (query) {
        handleFlowQuery(query);
      }
    });
  });

  // 控制清空按钮显隐与格言跑马灯层可见性
  const updateInputState = () => {
    if (!searchInput) return;
    const hasText = searchInput.value.length > 0;
    if (hasText) {
      clearBtn?.classList.add("visible");
      searchInputWrapper?.classList.add("has-value");
    } else {
      clearBtn?.classList.remove("visible");
      searchInputWrapper?.classList.remove("has-value");
    }
  };

  searchInput.addEventListener("input", updateInputState);

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    updateInputState();
    searchInput.focus();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (searchInput.value.length > 0) {
        searchInput.value = "";
        updateInputState();
      } else {
        searchInput.blur();
      }
    }
  });

  // ==========================================================================
  // 动态输入框灵感格言轮播与从右向左自适应循环滚动引擎
  // ==========================================================================
  const SEARCH_PROMPTS = [
    "别等完美，先打个草稿",
    "一句话，也能打开一扇门",
    "让模糊的念头，变成清楚的句子",
    "先完成，再完善",
    "把问题写清楚，答案就出来一半",
    "语言的边界，就是我世界的边界",
    "我有很多想法，只是它们还没学会自己排队",
    "我书写文字，并非为了让世界了解我，而是为了让我了解我自己",
    "我的大脑里有个委员会，他们现在正在为了用哪个词而激烈辩论",
    "完美是优秀的敌人",
    "灵感就像猫，你越追它越跑；你安静坐下，它反而会自己蹭过来",
    "最深刻的思想，往往藏在最简单的词语里",
    "每一个未被说出口的想法，都是一座等待被连接的孤岛",
    "文字是思想的琥珀，封存着那一刻最真实的温度",
    "与其在脑海中演练千遍，不如在现实中笨拙地表达一次",
    "思考是灵魂的自我对话，而文字是这场对话的足迹",
    "每一个看似随意的念头，都可能是改变生活轨迹的起点",
  ];

  const PROMPT_INTERVAL_MS = 30 * 60 * 1000;
  const STORAGE_KEY_CURRENT = "pi_placeholder_current";
  const STORAGE_KEY_TIMESTAMP = "pi_placeholder_timestamp";
  const STORAGE_KEY_HISTORY = "pi_placeholder_history";

  let promptTimer = null;
  let currentPromptText = "别等完美，先打个草稿";
  let mottoMeasureCanvas = null;

  /**
   * 精确测量格言文本在当前输入框字体环境下的实际渲染像素宽度
   * @param {string} text
   * @returns {number}
   */
  const measureMottoTextWidth = (text) => {
    if (!text) return 0;
    try {
      if (!mottoMeasureCanvas) {
        mottoMeasureCanvas = document.createElement("canvas");
      }
      const ctx = mottoMeasureCanvas.getContext("2d");
      if (ctx && searchInput) {
        const computed = window.getComputedStyle(searchInput);
        const fontStyle = computed.fontStyle || "normal";
        const fontWeight = computed.fontWeight || "400";
        const fontSize = computed.fontSize || "15.5px";
        const fontFamily = computed.fontFamily || "inherit";
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
        const metrics = ctx.measureText(text);
        return Math.ceil(metrics.width);
      }
    } catch (e) {
      console.warn("[Placeholder Marquee] Text measurement fallback:", e);
    }
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      width += text.charCodeAt(i) > 255 ? 16 : 9;
    }
    return width;
  };

  /**
   * 检查格言文本是否超出输入框宽度，超出则启用从右向左平滑无缝跑马灯
   */
  const checkAndUpdateMottoMarquee = () => {
    if (!searchInputWrapper || !searchMottoLayer || !searchMottoTrack || !searchMottoText1) {
      return;
    }

    const containerWidth = searchInputWrapper.clientWidth;
    if (containerWidth <= 0) return;

    const textWidth = measureMottoTextWidth(currentPromptText);
    const MARQUEE_GAP = 48; // 循环副本间距 (px)
    const MARQUEE_SPEED = 28; // 跑马灯恒定线速度 (px/s)

    // 留 6px 容差防微小亚像素舍入
    if (textWidth > containerWidth - 6) {
      const cycleDistance = textWidth + MARQUEE_GAP;
      const duration = Math.max(6, Math.round((cycleDistance / MARQUEE_SPEED) * 10) / 10);

      searchMottoTrack.style.setProperty("--motto-duration", `${duration}s`);
      searchMottoLayer.classList.add("is-scrolling");
      searchMottoTrack.classList.add("animating");
    } else {
      searchMottoLayer.classList.remove("is-scrolling");
      searchMottoTrack.classList.remove("animating");
      searchMottoTrack.style.removeProperty("--motto-duration");
    }
  };

  const getPromptHistory = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("[Placeholder] Failed to read history:", e);
    }
    return [];
  };

  const savePromptHistory = (history) => {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch (e) {
      console.warn("[Placeholder] Failed to save history:", e);
    }
  };

  const pickNextPrompt = () => {
    const cooldownCount = Math.floor(SEARCH_PROMPTS.length / 2);
    let history = getPromptHistory();

    let candidates = SEARCH_PROMPTS.filter((p) => !history.includes(p));

    if (candidates.length === 0) {
      const lastPicked = history[history.length - 1];
      candidates = SEARCH_PROMPTS.filter((p) => p !== lastPicked);
      if (candidates.length === 0) candidates = SEARCH_PROMPTS;
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    const chosenPrompt = candidates[randomIndex];

    history.push(chosenPrompt);

    while (history.length > cooldownCount) {
      history.shift();
    }

    savePromptHistory(history);
    return chosenPrompt;
  };

  const applyPrompt = (promptText, timestamp = Date.now()) => {
    currentPromptText = promptText || "";
    if (searchMottoText1) searchMottoText1.textContent = currentPromptText;
    if (searchMottoText2) searchMottoText2.textContent = currentPromptText;
    if (searchInput) {
      searchInput.setAttribute("aria-placeholder", currentPromptText);
    }
    checkAndUpdateMottoMarquee();
    try {
      localStorage.setItem(STORAGE_KEY_CURRENT, currentPromptText);
      localStorage.setItem(STORAGE_KEY_TIMESTAMP, timestamp.toString());
    } catch (e) {
      console.warn("[Placeholder] Failed to save prompt:", e);
    }
  };

  const rotatePrompt = () => {
    if (promptTimer) {
      clearTimeout(promptTimer);
      promptTimer = null;
    }

    const nextPrompt = pickNextPrompt();
    const now = Date.now();
    applyPrompt(nextPrompt, now);

    promptTimer = setTimeout(rotatePrompt, PROMPT_INTERVAL_MS);
  };

  const initPlaceholderRotation = () => {
    if (!searchInput) return;

    let storedCurrent = null;
    let storedTimestamp = 0;

    try {
      storedCurrent = localStorage.getItem(STORAGE_KEY_CURRENT);
      const rawTime = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
      if (rawTime) storedTimestamp = parseInt(rawTime, 10) || 0;
    } catch (e) {
      console.warn("[Placeholder] Failed to read storage:", e);
    }

    const now = Date.now();
    const elapsed = now - storedTimestamp;

    if (
      storedCurrent &&
      SEARCH_PROMPTS.includes(storedCurrent) &&
      elapsed < PROMPT_INTERVAL_MS &&
      elapsed >= 0
    ) {
      applyPrompt(storedCurrent, storedTimestamp);
      const remaining = PROMPT_INTERVAL_MS - elapsed;
      promptTimer = setTimeout(rotatePrompt, remaining);
    } else {
      rotatePrompt();
    }
  };

  // 容器尺寸响应式监听（窗口缩放、视图模式切换自适应）
  if (searchInputWrapper && typeof ResizeObserver !== "undefined") {
    const mottoResizeObserver = new ResizeObserver(() => {
      checkAndUpdateMottoMarquee();
    });
    mottoResizeObserver.observe(searchInputWrapper);
  }

  window.__piRotatePlaceholder = rotatePrompt;
  window.__piCheckMottoMarquee = checkAndUpdateMottoMarquee;
  window.__piSetMottoText = (text) => applyPrompt(text);
  initPlaceholderRotation();
  enhanceAllSelects();
  loadOfficialProvidersConfig();

  // ==========================================================================
  // 焦点与失焦控制（点击外部空白区域主动取消输入框高亮）
  // ==========================================================================
  document.addEventListener("pointerdown", (e) => {
    if (
      searchForm &&
      !searchForm.contains(e.target) &&
      !e.target.closest(".settings-view-stage") &&
      !e.target.closest(".settings-btn")
    ) {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        if (currentView === VIEW_DETAILED) {
          document.activeElement.blur();
        }
      }
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (currentView === VIEW_SETTINGS) {
        closeSettingsView();
      }
    }
  });

  // ==========================================================================
  // 全局右键行为规范：禁用上下文菜单，统一作为“返回上一步/回退 (Step Back)”
  // 回退层级：设置全页面 (settings) -> Flow (界面3, abort) -> Focus (界面2) -> Detailed (界面1) -> 失焦/清空
  // ==========================================================================
  const stepBackHandlers = [];

  const registerStepBackHandler = (handler) => {
    stepBackHandlers.push(handler);
    return () => {
      const idx = stepBackHandlers.indexOf(handler);
      if (idx !== -1) stepBackHandlers.splice(idx, 1);
    };
  };

  // 注册设置页面回退
  registerStepBackHandler(() => {
    return closeSettingsView();
  });

  const handleGlobalStepBack = (e) => {
    // 1. 逆序执行已注册的外部业务层回退钩子
    for (let i = stepBackHandlers.length - 1; i >= 0; i--) {
      try {
        const handled = stepBackHandlers[i](e);
        if (handled) return;
      } catch (err) {
        console.error("[StepBack] Error in handler:", err);
      }
    }

    // 2. Flow (界面3) -> 右键中止 Agent 并回退至 Focus (界面2)
    if (currentView === VIEW_FLOW) {
      piClient.abort();
      setViewMode(VIEW_FOCUS, true);
      return;
    }

    // Focus (界面2) -> 右键回退至 Detailed (界面1) 并失焦
    if (currentView === VIEW_FOCUS) {
      setViewMode(VIEW_DETAILED, false);
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
      return;
    }

    // Detailed (界面1) -> 失焦高亮输入框或清空内容
    const activeEl = document.activeElement;
    const isInputActive =
      activeEl &&
      (activeEl === searchInput ||
        ["INPUT", "TEXTAREA"].includes(activeEl.tagName) ||
        activeEl.getAttribute("contenteditable") === "true");

    if (isInputActive) {
      activeEl.blur();
      return;
    }

    if (searchInput && searchInput.value.trim().length > 0) {
      searchInput.value = "";
      updateInputState();
      return;
    }

    window.dispatchEvent(new CustomEvent("pi:step-back", { detail: { originalEvent: e } }));
  };

  window.__piRegisterStepBack = registerStepBackHandler;
  window.__piStepBack = handleGlobalStepBack;

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    handleGlobalStepBack(e);
  });
});
