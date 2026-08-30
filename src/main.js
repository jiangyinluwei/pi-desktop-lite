import { piClient } from "./services/pi-client.js";
import { sessionService } from "./services/session-service.js";
import { versionService } from "./services/version-service.js";
import { configService } from "./services/config-service.js";
import { conversationHistoryService } from "./services/conversation-history.js";
import { promptHistoryNavigator } from "./services/prompt-history.js";
import { invokeTauri } from "./services/tauri-bridge.js";
import { enhanceAllSelects, enhanceSelect } from "./services/sketch-select.js";
import {
  enhanceInputAutoFill,
  enhanceAllAutoFills,
  PROVIDER_PRESETS,
  COMMON_MODEL_PRESETS,
  saveAutofillHistory
} from "./services/sketch-autofill.js";
import { ProgressStepper } from "./services/progress-stepper.js";
import { startFloatingIcons, stopFloatingIcons } from "./services/floating-icons.js";
import { notificationService } from "./services/notification-service.js";
import { taskManager } from "./services/task-manager.js";
import { sketchAlert, sketchConfirm, sketchPrompt, SketchModal } from "./services/sketch-modal.js";
import { modelFailoverEngine } from "./services/model-failover.js";

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
 * CSS 属性选择器值转义
 * @param {string} str
 * @returns {string}
 */
const escapeCss = (str) => {
  if (typeof str !== "string") return "";
  return str.replace(/["'\\]/g, "\\$&");
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
  chevronDown: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6 L8 10 L12 6" /></svg>`,
  image: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><circle cx="5.5" cy="6" r="1" /><path d="M14 11.5 L10.5 8 L4.5 13.5" /><path d="M10 10.5 L12 12.5" /></svg>`,
  document: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2.5 H9.5 L12.5 5.5 V13.5 H3.5 Z" /><path d="M9.5 2.5 V5.5 H12.5" /><line x1="5.5" y1="8" x2="10.5" y2="8" /><line x1="5.5" y1="10.5" x2="9" y2="10.5" /></svg>`,
  code: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5.5 5 2.5 8 5.5 11" /><polyline points="10.5 5 13.5 8 10.5 11" /><line x1="9" y1="4" x2="7" y2="12" /></svg>`,
  lightbulb: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 C5.5 2, 4 3.8, 4 6 C4 7.6, 5.2 9, 5.8 10.2 H10.2 C10.8 9, 12 7.6, 12 6 C12 3.8, 10.5 2, 8 2 Z" /><line x1="6" y1="12" x2="10" y2="12" /><line x1="7" y1="14" x2="9" y2="14" /></svg>`,
  stop: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" /></svg>`,
  send: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 1.5 L7 9" /><path d="M14.5 1.5 L10 14.5 L7 9 L1.5 6 Z" /></svg>`,
};

window.addEventListener("DOMContentLoaded", () => {
  const appContainer = document.getElementById("app-container");
  const searchInputWrapper = document.getElementById("search-input-wrapper");
  const searchInput = document.getElementById("search-input");
  const attachedCapsulesContainer = document.getElementById("attached-capsules-container");
  const searchIconBox = document.getElementById("search-icon-box");
  const filePickerInput = document.getElementById("file-picker-input");
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
  const flowQuestionTip = document.getElementById("flow-question-tip");
  const flowQuestionTipText = document.getElementById("flow-question-tip-text");
  const flowTurnNav = document.getElementById("flow-turn-nav");
  const flowTurnNavUp = document.getElementById("flow-turn-nav-up");
  const flowTurnNavDown = document.getElementById("flow-turn-nav-down");
  const flowUserText = document.getElementById("flow-user-text");
  const flowPromptAttachments = document.getElementById("flow-prompt-attachments");
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

  // 底部手绘历史讯息抽屉元素
  const sketchMessagesDrawer = document.getElementById("sketch-messages-drawer");
  const messagesPrimaryRow = document.getElementById("messages-primary-row");
  const messagesExpandedWrap = document.getElementById("messages-expanded-wrap");
  const messagesExpandedGrid = document.getElementById("messages-expanded-grid");

  // 后台对话任务与侧边栏元素
  const miniTaskCapsule = document.getElementById("mini-task-capsule");
  const capsuleTaskText = document.getElementById("capsule-task-text");
  const flowBtnAbort = document.getElementById("flow-btn-abort");
  const searchHint = document.getElementById("search-hint");
  const searchHintKbd = document.getElementById("search-hint-kbd");
  const hintKeyText = document.getElementById("hint-key-text");
  const globalToastBanner = document.getElementById("global-toast-banner");
  const globalToastText = document.getElementById("global-toast-text");
  const taskDetailsSidebar = document.getElementById("task-details-sidebar");
  const taskSidebarSummary = document.getElementById("task-sidebar-summary");
  const taskSidebarList = document.getElementById("task-sidebar-list");
  const btnCloseTaskSidebar = document.getElementById("btn-close-task-sidebar");

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
  const updateNoticeActions = document.getElementById("update-notice-actions");
  const btnToggleChangelog = document.getElementById("btn-toggle-changelog");
  const btnIgnoreUpdate = document.getElementById("btn-ignore-update");
  const btnUpdateKernel = document.getElementById("btn-update-kernel");
  const kernelUpdateProgressWrap = document.getElementById("kernel-update-progress-wrap");
  const kernelProgressStage = document.getElementById("kernel-progress-stage");
  const kernelProgressPercent = document.getElementById("kernel-progress-percent");
  const btnCancelUpdate = document.getElementById("btn-cancel-update");
  const kernelProgressFill = document.getElementById("kernel-progress-fill");
  const kernelProgressSubMsg = document.getElementById("kernel-progress-sub-msg");
  const kernelChangelogDrawer = document.getElementById("kernel-changelog-drawer");
  const changelogVersionTag = document.getElementById("changelog-version-tag");
  const btnCloseChangelog = document.getElementById("btn-close-changelog");
  const kernelChangelogContent = document.getElementById("kernel-changelog-content");
  const btnNewSession = document.getElementById("btn-new-session");
  const sessionsList = document.getElementById("sessions-list");
  const sessionCount = document.getElementById("session-count");

  // 模型与推理设置元素
  const currentModelProvider = document.getElementById("current-model-provider");
  const currentModelName = document.getElementById("current-model-name");
  const currentModelInfo = document.getElementById("current-model-info");
  const thinkingSelectDropdown = document.getElementById("thinking-select-dropdown");
  const whitelistModelsList = document.getElementById("whitelist-models-list");
  const btnToggleOfficial = document.getElementById("btn-toggle-official");
  const btnToggleCustom = document.getElementById("btn-toggle-custom");
  const channelConfigOfficial = document.getElementById("channel-config-official");
  const channelConfigCustom = document.getElementById("channel-config-custom");
  const channelConfigDrawers = document.getElementById("channel-config-drawers");
  const autoReconnectSwitch = document.getElementById("auto-reconnect-switch");

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
  const btnFetchOfficialModels = document.getElementById("btn-fetch-official-models");
  const btnFetchOfficialModelsText = document.getElementById("btn-fetch-official-models-text");

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

    // 确保任何时候进入详细或专注视图时，终止方块按钮绝对隐藏
    if (mode !== VIEW_FLOW && flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
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

  // ==========================================================================
  // 发送逻辑与快捷键切换控制 (Send Shortcut Logic: enter | ctrlEnter)
  // ==========================================================================
  const updateSendShortcutUI = (shortcut) => {
    const isEnter = shortcut !== "ctrlEnter";
    if (hintKeyText) {
      hintKeyText.textContent = isEnter ? "Enter" : "Ctrl+Enter";
    }
    if (searchHint) {
      searchHint.setAttribute("title", isEnter ? "发送 (Enter)" : "发送 (Ctrl+Enter)");
      searchHint.setAttribute("aria-label", isEnter ? "发送 (Enter)" : "发送 (Ctrl+Enter)");
    }

    const shortcutButtons = document.querySelectorAll(".shortcut-option");
    shortcutButtons.forEach((btn) => {
      if (btn.getAttribute("data-shortcut-val") === (isEnter ? "enter" : "ctrlEnter")) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  };

  const initSendShortcutControl = () => {
    const currentShortcut = configService.getSendShortcut();
    updateSendShortcutUI(currentShortcut);

    const shortcutButtons = document.querySelectorAll(".shortcut-option");
    shortcutButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetShortcut = btn.getAttribute("data-shortcut-val") || "enter";
        configService.setSendShortcut(targetShortcut);
        updateSendShortcutUI(targetShortcut);
      });
    });

    configService.addEventListener("send-shortcut-change", (e) => {
      const activeShortcut = e.detail?.sendShortcut || configService.getSendShortcut();
      updateSendShortcutUI(activeShortcut);
    });

    if (searchHint) {
      searchHint.addEventListener("click", (e) => {
        e.preventDefault();
        submitCurrentPrompt();
      });
    }
  };

  // 异步预加载 ~/.pi-dl/config.json 并初始化主题与控件
  (async () => {
    await configService.loadAppConfig();
    initThemeControl();
    initSendShortcutControl();
    // 启动时 best-effort 向 Pi 内核注入推荐重连配置 (仅当自动重连开启时，失败静默不阻断)
    if (configService.getAutoReconnectSwitch()) {
      configService.applyModelFailoverPreset().catch(() => {});
    }
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
            if (targetTab === "tab-packages") {
              if (typeof loadInstalledPackages === "function") loadInstalledPackages();
              if (typeof loadRecommendedPlugins === "function") loadRecommendedPlugins();
              if (typeof loadCatalogPackages === "function" && !hasLoadedCatalogOnce) {
                loadCatalogPackages(1);
              }
            }
          } else {
            pane.classList.remove("active");
          }
        });
      });
    });
  };

  initSettingsTabs();

  // 设置面板自动平滑滚动到底部辅助函数 (针对官方通道/自定义通道抽屉及任意下拉详情展开行为)
  const scrollSettingsToBottom = (smooth = true) => {
    const settingsTabContent = document.querySelector(".settings-tab-content");
    if (!settingsTabContent) return;
    const doScroll = () => {
      settingsTabContent.scrollTo({
        top: settingsTabContent.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    };
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 80);
    setTimeout(doScroll, 220); // 覆盖抽屉 fadeInDrawer 动画耗时
  };

  // 自定义通道配置内层 Tab 切换 (步骤1 / 步骤2)
  const switchInnerTab = (targetId) => {
    const innerTabBtns = document.querySelectorAll(".inner-tab-btn");
    const innerTabPanes = document.querySelectorAll(".inner-tab-pane");

    innerTabBtns.forEach((b) => {
      if (b.getAttribute("data-inner-tab") === targetId) {
        b.classList.add("active");
      } else {
        b.classList.remove("active");
      }
    });

    innerTabPanes.forEach((pane) => {
      if (pane.id === targetId) {
        pane.classList.add("active");
      } else {
        pane.classList.remove("active");
      }
    });

    scrollSettingsToBottom(true);
  };

  const initInnerTabs = () => {
    const innerTabBtns = document.querySelectorAll(".inner-tab-btn");
    innerTabBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute("data-inner-tab");
        if (targetId) {
          switchInnerTab(targetId);
        }
      });
    });
  };

  initInnerTabs();

  // ==========================================================================
  // 模型配置面板内折叠通道抽屉 (官方通道配置 / 自定义通道配置)
  // ==========================================================================
  let expandedChannel = null; // null | 'official' | 'custom'

  const setExpandedChannel = (channel) => {
    expandedChannel = channel;

    if (channel === "official") {
      if (whitelistModelsList) whitelistModelsList.classList.add("collapsed-single");
      if (channelConfigOfficial) channelConfigOfficial.classList.remove("hidden");
      if (channelConfigCustom) channelConfigCustom.classList.add("hidden");

      if (btnToggleOfficial) {
        btnToggleOfficial.innerHTML = `<span>收起</span>${ICONS.chevronDown}`;
        btnToggleOfficial.classList.add("active");
      }
      if (btnToggleCustom) {
        btnToggleCustom.innerHTML = `<span>自定义通道配置</span>${ICONS.chevronDown}`;
        btnToggleCustom.classList.remove("active");
      }
      scrollSettingsToBottom(true);
    } else if (channel === "custom") {
      if (whitelistModelsList) whitelistModelsList.classList.add("collapsed-single");
      if (channelConfigOfficial) channelConfigOfficial.classList.add("hidden");
      if (channelConfigCustom) channelConfigCustom.classList.remove("hidden");

      if (btnToggleOfficial) {
        btnToggleOfficial.innerHTML = `<span>官方通道配置</span>${ICONS.chevronDown}`;
        btnToggleOfficial.classList.remove("active");
      }
      if (btnToggleCustom) {
        btnToggleCustom.innerHTML = `<span>收起</span>${ICONS.chevronDown}`;
        btnToggleCustom.classList.add("active");
      }
      scrollSettingsToBottom(true);
    } else {
      // 收起全部抽屉，恢复模型列表完整展示
      if (whitelistModelsList) whitelistModelsList.classList.remove("collapsed-single");
      if (channelConfigOfficial) channelConfigOfficial.classList.add("hidden");
      if (channelConfigCustom) channelConfigCustom.classList.add("hidden");

      if (btnToggleOfficial) {
        btnToggleOfficial.innerHTML = `<span>官方通道配置 - 展开</span>${ICONS.chevronDown}`;
        btnToggleOfficial.classList.remove("active");
      }
      if (btnToggleCustom) {
        btnToggleCustom.innerHTML = `<span>自定义通道配置 - 展开</span>${ICONS.chevronDown}`;
        btnToggleCustom.classList.remove("active");
      }
    }
  };

  const initChannelDrawers = () => {
    if (btnToggleOfficial) {
      btnToggleOfficial.addEventListener("click", (e) => {
        e.preventDefault();
        if (expandedChannel === "official") {
          setExpandedChannel(null);
        } else {
          setExpandedChannel("official");
        }
      });
    }

    if (btnToggleCustom) {
      btnToggleCustom.addEventListener("click", (e) => {
        e.preventDefault();
        if (expandedChannel === "custom") {
          setExpandedChannel(null);
        } else {
          setExpandedChannel("custom");
        }
      });
    }

    // 监听模型配置及官方/自定义通道抽屉展开与尺寸变化，自动将设置面板滚动条平滑定位到底部
    if (typeof ResizeObserver !== "undefined" && channelConfigDrawers) {
      let lastHeight = 0;
      const drawerResizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newHeight = entry.contentRect.height;
          // 仅在抽屉展开、尺寸增加且处于打开态时自动平滑滚动到底部
          if (newHeight > 0 && newHeight > lastHeight + 5 && expandedChannel) {
            scrollSettingsToBottom(true);
          }
          lastHeight = newHeight;
        }
      });
      drawerResizeObserver.observe(channelConfigDrawers);
    }
  };

  initChannelDrawers();

  const openSettingsView = async (targetTab = null) => {
    if (currentView !== VIEW_SETTINGS) {
      previousView = currentView;
    }
    setViewMode(VIEW_SETTINGS, false);

    if (targetTab) {
      const tabBtn = document.querySelector(`.settings-tab-btn[data-tab="${targetTab}"]`);
      if (tabBtn) {
        tabBtn.click();
      }
    }

    // 右上角提示：重置状态，延迟 1s 后弹入抖动显示，再 3s 后平滑渐隐
    if (topbarHintBanner) {
      topbarHintBanner.classList.remove("hint-visible", "fade-out");
      if (hintBannerTimeout) clearTimeout(hintBannerTimeout);
      hintBannerTimeout = setTimeout(() => {
        topbarHintBanner.classList.add("hint-visible");
        hintBannerTimeout = setTimeout(() => {
          topbarHintBanner.classList.remove("hint-visible");
          topbarHintBanner.classList.add("fade-out");
        }, 3000);
      }, 1000);
    }

    loadSessions();
    loadModelsAndState();
    loadOfficialProvidersConfig();
    loadCustomProvidersConfig();
    loadInstalledPackages();
    loadRecommendedPlugins();
    if (!hasLoadedCatalogOnce) {
      loadCatalogPackages(1);
    }
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

    // 监听窗口托盘/快捷唤醒事件 (多态路由分发：1个直通 Flow，>=2个进 Focus+显示胶囊，0个精准记忆恢复)
    window.__TAURI__.event.listen("app-awakened", () => {
      const suspended = taskManager.getActiveSuspendedTasks();
      if (suspended.length === 1) {
        closeSettingsView();
        restoreTaskToFlow(suspended[0]);
      } else if (suspended.length >= 2) {
        closeSettingsView();
        setViewMode(VIEW_FOCUS, true);
        updateMiniTaskCapsuleUI();
      }
      // 0 个挂起任务时保持当前视图 (精准记忆恢复)
    });

    // 监听用户点击系统通知事件：自动退出设置全屏页、切换至该 Task 的 Flow 模式并滚动到底部
    window.__TAURI__.event.listen("notification-clicked", (event) => {
      closeSettingsView();
      const targetTaskId = event?.payload?.taskId || event?.payload?.task_id;
      if (targetTaskId && taskManager.getTask(targetTaskId)) {
        restoreTaskToFlow(taskManager.getTask(targetTaskId));
      } else {
        const activeTasks = taskManager.getActiveTasks();
        if (activeTasks.length > 0) {
          restoreTaskToFlow(activeTasks[0]);
        } else {
          setViewMode(VIEW_FLOW, true);
        }
      }
      if (flowScrollArea) {
        flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
      }
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

    if (expandedChannel) {
      whitelistModelsList.classList.add("collapsed-single");
    } else {
      whitelistModelsList.classList.remove("collapsed-single");
    }

    let whitelist = configService.loadModelWhitelist();

    if (!whitelist || whitelist.length === 0) {
      whitelistModelsList.innerHTML = `<div class="empty-sessions">暂无已添加的模型，请展开下方“官方通道”或“自定义通道”添加模型。</div>`;
      return;
    }

    // 确保当前选中的激活模型始终固定在第一行 (index 0)
    const curActive = activeModel || piClient.currentModel || (configService.getSelectedModel() ? {
      id: configService.getSelectedModel().modelId,
      provider: configService.getSelectedModel().provider
    } : null);

    if (curActive && curActive.id && curActive.provider) {
      const activeIdx = whitelist.findIndex(
        (m) =>
          m.id?.toLowerCase() === curActive.id?.toLowerCase() &&
          m.provider?.toLowerCase() === curActive.provider?.toLowerCase()
      );
      if (activeIdx > 0) {
        const [activeItem] = whitelist.splice(activeIdx, 1);
        whitelist.unshift(activeItem);
        configService.saveModelWhitelist(whitelist);
      }
    }

    whitelistModelsList.innerHTML = "";

    whitelist.forEach((m, index) => {
      const item = document.createElement("div");
      item.className = "whitelist-model-item";
      item.setAttribute("data-index", index.toString());

      const isActive =
        curActive &&
        curActive.id?.toLowerCase() === m.id?.toLowerCase() &&
        curActive.provider?.toLowerCase() === m.provider?.toLowerCase();

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
            await sketchAlert(`切换模型失败: ${err}`, { type: "error", title: "切换模型失败" });
          } finally {
            selectBtn.disabled = false;
          }
        });
      }

      // 移除按钮点击（激活中的模型已禁止删除）
      const removeBtn = item.querySelector(".btn-remove-model");
      if (removeBtn && !isActive) {
        removeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (isActive) {
            await sketchAlert("当前模型正在使用中，禁止删除！", { type: "warning", title: "模型保护" });
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
      // 同步「自动重连切换」勾选状态至设置页 UI
      if (autoReconnectSwitch) {
        autoReconnectSwitch.checked = configService.getAutoReconnectSwitch();
      }
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

    const authEntry =
      currentOfficialAuth[provMeta.id] ||
      (provMeta.id.startsWith("opencode")
        ? currentOfficialAuth["opencode-zen"] ||
          currentOfficialAuth["opencode-go"] ||
          currentOfficialAuth["opencode"]
        : null);
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
      scrollSettingsToBottom(true);
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
        await sketchAlert(`官方通道 [${provider}] API Key 已成功保存至 ~/.pi/agent/auth.json！`, { type: "success", title: "保存成功" });
      } catch (err) {
        console.error("Save API Key failed:", err);
        await sketchAlert(`保存失败: ${err}`, { type: "error", title: "保存失败" });
      } finally {
        btnSaveOfficialKey.disabled = false;
      }
    });
  }

  if (btnFetchOfficialModels && officialProviderSelect) {
    btnFetchOfficialModels.addEventListener("click", async () => {
      const provider = officialProviderSelect.value;
      if (!provider) return;

      btnFetchOfficialModels.disabled = true;
      if (btnFetchOfficialModelsText) {
        btnFetchOfficialModelsText.textContent = "正在拉取...";
      }

      try {
        const fetchedModels = await configService.fetchOfficialModels(provider);
        if (Array.isArray(fetchedModels) && fetchedModels.length > 0) {
          const provMeta = officialCatalog.find((p) => p.id === provider);
          if (provMeta) {
            provMeta.models = fetchedModels;
          }
          renderOfficialProviderDetails(provider);
          scrollSettingsToBottom(true);
          if (officialKeyStatus) {
            officialKeyStatus.textContent = `● 成功从官网/内核拉取并同步 ${fetchedModels.length} 个最新可用模型`;
            officialKeyStatus.style.color = "#10b981";
          }
        } else {
          await sketchAlert(`未从官网拉取到新模型，已保持当前目录。`, { type: "info", title: "拉取完成" });
        }
      } catch (err) {
        console.error("[Main] Fetch official models failed:", err);
        await sketchAlert(`从官网拉取模型失败: ${err}`, { type: "error", title: "拉取失败" });
      } finally {
        btnFetchOfficialModels.disabled = false;
        if (btnFetchOfficialModelsText) {
          btnFetchOfficialModelsText.textContent = "从官网拉取最新模型";
        }
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
                  <option value="openai-completions" ${provData.api === "openai-completions" ? "selected" : ""}>openai-completions</option>
                  <option value="openai-responses" ${provData.api === "openai-responses" ? "selected" : ""}>openai-responses</option>
                  <option value="anthropic" ${(provData.api === "anthropic" || provData.api === "anthropic-messages") ? "selected" : ""}>anthropic</option>
                  <option value="ollama" ${provData.api === "ollama" ? "selected" : ""}>ollama</option>
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
            <div style="font-size: 12px; font-weight: 600; color: var(--ink-primary); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span>新增模型到运营商 [${escapeHtml(pKey.toUpperCase())}]</span>
              <button type="button" class="flat-btn flat-btn-secondary mini btn-fetch-custom-models" title="从该运营商端点获取在线可用模型列表并更新推荐表单" style="display: inline-flex; align-items: center; gap: 4px;">
                <svg class="icon-fetch-custom-models" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c2.3 0 4.3 1.4 5.1 3.5M13.5 2.5v3.5H10" />
                </svg>
                <span class="btn-fetch-text">获取模型列表</span>
              </button>
            </div>
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

          // 增强新增模型 Model ID 的手绘智能联想与参数全表联动 (按运营商隔离记忆与预设)
          const inputNewModelId = inlineAddForm.querySelector(".input-new-model-id");
          const inputNewModelName = inlineAddForm.querySelector(".input-new-model-name");
          const inputNewContextWin = inlineAddForm.querySelector(".input-new-context-win");
          const inputNewReasoning = inlineAddForm.querySelector(".input-new-reasoning");
          const btnFetchCustomModels = inlineAddForm.querySelector(".btn-fetch-custom-models");
          const btnFetchText = inlineAddForm.querySelector(".btn-fetch-text");

          const providerCategory = `model:${pKey.toLowerCase()}`;

          // 读取已缓存的该运营商在线模型列表或内置预设
          const getInitialModelPresets = () => {
            try {
              const cachedRaw = localStorage.getItem(`pi_dl_custom_models_${pKey.toLowerCase()}`);
              if (cachedRaw) {
                const parsed = JSON.parse(cachedRaw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
              }
            } catch {}

            const matchedPreset = PROVIDER_PRESETS.find((p) => p.id.toLowerCase() === pKey.toLowerCase());
            return (matchedPreset && Array.isArray(matchedPreset.models) && matchedPreset.models.length > 0)
              ? matchedPreset.models
              : COMMON_MODEL_PRESETS;
          };

          if (inputNewModelId) {
            enhanceInputAutoFill(inputNewModelId, {
              type: providerCategory,
              title: `推荐模型与参数预填 [${pKey.toUpperCase()}]`,
              presets: getInitialModelPresets(),
              onSelect: (model) => {
                // 覆盖填入原表单
                inputNewModelId.value = model.id || "";
                inputNewModelName.value = model.name || model.id || "";
                if (inputNewContextWin && (model.contextWindow || model.context_window)) {
                  inputNewContextWin.value = model.contextWindow || model.context_window;
                }
                if (inputNewMaxTokens && (model.maxTokens || model.max_tokens)) {
                  inputNewMaxTokens.value = snapToClosestStandardTokens(model.maxTokens || model.max_tokens);
                }
                if (inputNewReasoning && model.reasoning !== undefined) {
                  inputNewReasoning.checked = !!model.reasoning;
                }
              }
            });
          }

          // 绑定「获取模型列表」按钮：从该运营商端点在线拉取最新模型
          if (btnFetchCustomModels) {
            btnFetchCustomModels.addEventListener("click", async () => {
              btnFetchCustomModels.disabled = true;
              if (btnFetchText) btnFetchText.textContent = "正在获取...";

              try {
                const fetched = await configService.fetchCustomProviderModels({
                  providerId: pKey,
                  baseUrl: provData.baseUrl,
                  apiKey: provData.apiKey,
                  apiType: provData.api,
                });

                if (Array.isArray(fetched) && fetched.length > 0) {
                  const formatted = fetched.map((m) => ({
                    id: m.id,
                    name: m.name || m.id,
                    contextWindow: m.context_window || 64000,
                    maxTokens: m.max_tokens || 4096,
                    reasoning: !!m.reasoning,
                    tag: "在线拉取",
                    desc: m.context_window ? `${(m.context_window / 1000).toFixed(0)}k context` : ""
                  }));

                  // 缓存至该运营商的专属缓存中
                  try {
                    localStorage.setItem(`pi_dl_custom_models_${pKey.toLowerCase()}`, JSON.stringify(formatted));
                  } catch {}

                  // 更新 AutoFill 实例的预设并展开浮层
                  if (inputNewModelId && inputNewModelId.__sketchAutoFill) {
                    inputNewModelId.__sketchAutoFill.updatePresets(
                      formatted,
                      `在线可用模型 [${pKey.toUpperCase()}] (${formatted.length} 个)`
                    );
                    inputNewModelId.focus();
                    inputNewModelId.__sketchAutoFill.open();
                  }

                  scrollSettingsToBottom(true);
                  await sketchAlert(`成功从运营商 [${pKey.toUpperCase()}] 获取 ${formatted.length} 个在线模型！已更新至表单推荐列表，请点击选择填入。`, {
                    type: "success",
                    title: "获取成功"
                  });
                  if (inputNewModelId && inputNewModelId.__sketchAutoFill) {
                    inputNewModelId.focus();
                    inputNewModelId.__sketchAutoFill.open();
                  }
                } else {
                  await sketchAlert(`未从该运营商端点获取到模型，已保留当前推荐列表。`, { type: "info", title: "获取完成" });
                }
              } catch (err) {
                console.error("[Main] Fetch custom models failed:", err);
                await sketchAlert(`获取模型列表失败: ${err}`, { type: "error", title: "获取失败" });
              } finally {
                btnFetchCustomModels.disabled = false;
                if (btnFetchText) btnFetchText.textContent = "获取模型列表";
              }
            });
          }
        }

        if (btnEditProvider && inlineEditForm) {
          // 增强修改运营商的 Base URL 手绘智能联想
          const inputEditBaseUrl = inlineEditForm.querySelector(".input-edit-base-url");
          if (inputEditBaseUrl) {
            enhanceInputAutoFill(inputEditBaseUrl, {
              type: "url",
              title: `接口地址建议 [${pKey.toUpperCase()}]`,
              presets: [
                { id: provData.baseUrl || "https://api.siliconflow.cn/v1", name: `${pKey.toUpperCase()} 当前地址` },
                { id: "https://api.siliconflow.cn/v1", name: "硅基流动 (SiliconFlow)", tag: "推荐聚合" },
                { id: "https://api.deepseek.com/v1", name: "DeepSeek 官方 API", tag: "官方直连" },
                { id: "http://localhost:11434/v1", name: "Ollama 本地服务", tag: "本地部署" },
                { id: "https://openrouter.ai/api/v1", name: "OpenRouter 全球聚合", tag: "全球聚合" }
              ]
            });
          }

          btnEditProvider.addEventListener("click", () => {
            const willOpen = inlineEditForm.classList.contains("hidden");
            inlineEditForm.classList.toggle("hidden");
            if (!inlineEditForm.classList.contains("hidden") && inlineAddForm) {
              inlineAddForm.classList.add("hidden");
            }
            if (willOpen) {
              scrollSettingsToBottom(true);
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
            btnSaveEditProv.disabled = true;
            try {
              const inputApiType = inlineEditForm.querySelector("select.input-edit-api-type") || inlineEditForm.querySelector(".input-edit-api-type");
              const inputBaseUrl = inlineEditForm.querySelector(".input-edit-base-url");
              const inputApiKey = inlineEditForm.querySelector(".input-edit-api-key");
              const inputDevRole = inlineEditForm.querySelector(".input-edit-developer-role");
              const inputReasoningEffort = inlineEditForm.querySelector(".input-edit-reasoning-effort");

              const newApiType = (inputApiType?.value || "").trim() || "openai-completions";
              const newBaseUrl = (inputBaseUrl?.value || "").trim();
              if (!newBaseUrl) {
                await sketchAlert("接口地址 (Base URL) 不能为空", { type: "warning", title: "参数缺失" });
                inputBaseUrl?.focus();
                return;
              }
              const newApiKey = (inputApiKey?.value || "").trim() || null;
              const newDevRole = !!inputDevRole?.checked;
              const newReasoningEffort = !!inputReasoningEffort?.checked;

              await configService.saveCustomProvider({
                provider_id: pKey,
                api_type: newApiType,
                base_url: newBaseUrl,
                api_key: newApiKey,
                supports_developer_role: newDevRole,
                supports_reasoning_effort: newReasoningEffort,
              });

              // 保存至 URL 历史沉淀
              saveAutofillHistory("url", { id: newBaseUrl, value: newBaseUrl });

              await sketchAlert(`运营商 [${pKey.toUpperCase()}] 配置已成功更新！`, { type: "success", title: "更新成功" });
              loadCustomProvidersConfig();
            } catch (err) {
              console.error("Save custom provider failed:", err);
              await sketchAlert(`更新运营商配置失败: ${err}`, { type: "error", title: "更新失败" });
            } finally {
              btnSaveEditProv.disabled = false;
            }
          });
        }

        // 绑定删除运营商
        const btnDeleteProvider = card.querySelector(".btn-delete-provider");
        if (btnDeleteProvider) {
          btnDeleteProvider.addEventListener("click", async () => {
            const confirmed = await sketchConfirm(`确定要删除运营商 [${pKey.toUpperCase()}] 及其全部模型配置吗？`, {
              title: "删除运营商确认",
              isDanger: true
            });
            if (confirmed) {
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
            const willOpen = inlineAddForm.classList.contains("hidden");
            inlineAddForm.classList.toggle("hidden");
            if (!inlineAddForm.classList.contains("hidden") && inlineEditForm) {
              inlineEditForm.classList.add("hidden");
            }
            if (willOpen) {
              scrollSettingsToBottom(true);
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
              await sketchAlert("请输入模型标识 (Model ID)", { type: "warning", title: "参数缺失" });
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

              // 自动添加到白名单 (首位固定为当前选中模型，新模型插入其后)
              configService.addModelToWhitelist({
                id: modelIdVal,
                name: modelNameVal,
                provider: pKey,
                contextWindow: contextWinVal,
                maxTokens: maxTokensVal,
                reasoning: reasoningVal,
                isCustom: true,
              });

              // 沉淀至该运营商专有的模型历史池 (隔离记忆)
              const providerCategory = `model:${pKey.toLowerCase()}`;
              saveAutofillHistory(providerCategory, {
                id: modelIdVal,
                name: modelNameVal,
                contextWindow: contextWinVal,
                maxTokens: maxTokensVal,
                reasoning: reasoningVal
              });

              await sketchAlert(`模型 [${modelNameVal}] 已成功添加至运营商 [${pKey.toUpperCase()}] 并加入当前模型列表！`, { type: "success", title: "添加成功" });
              loadCustomProvidersConfig();
              renderWhitelistModels(piClient.currentModel);
            } catch (err) {
              console.error("Add model failed:", err);
              await sketchAlert(`添加模型失败: ${err}`, { type: "error", title: "添加失败" });
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
                const willOpen = modelEditBox.classList.contains("hidden");
                modelEditBox.classList.toggle("hidden");
                if (willOpen) {
                  scrollSettingsToBottom(true);
                }
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

                  await sketchAlert(`模型 [${updatedName}] 配置已成功更新！`, { type: "success", title: "更新成功" });
                  loadCustomProvidersConfig();
                  renderWhitelistModels(piClient.currentModel);
                } catch (err) {
                  console.error("Update model failed:", err);
                  await sketchAlert(`更新模型失败: ${err}`, { type: "error", title: "更新失败" });
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
                const confirmed = await sketchConfirm(`确定要删除模型 [${m.name || m.id}] 吗？`, {
                  title: "删除模型确认",
                  isDanger: true
                });
                if (confirmed) {
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
      enhanceAllAutoFills(customProvidersContainer);
    } catch (e) {
      console.warn("[Main] Load custom providers failed:", e);
    }
  };

  // 增强静态自定义运营商表单输入框
  if (customProviderId) {
    enhanceInputAutoFill(customProviderId, {
      type: "provider",
      onSelect: (preset) => {
        if (customApiType) {
          customApiType.value = preset.protocol || "openai-completions";
          if (customApiType.__sketchSelect) {
            customApiType.__sketchSelect.syncOptions();
          }
        }
        if (customBaseUrl) {
          if (!customBaseUrl.value || customBaseUrl.value.includes("api.siliconflow.cn") || customBaseUrl.value.includes("localhost:11434") || customBaseUrl.value.includes("api.deepseek.com")) {
            customBaseUrl.value = preset.baseUrl || "";
          }
        }
        const customDevRole = document.getElementById("custom-supports-dev-role");
        if (customDevRole) {
          customDevRole.checked = !!preset.devRole;
        }
        const customReasoningEffort = document.getElementById("custom-supports-reasoning-effort");
        if (customReasoningEffort) {
          customReasoningEffort.checked = preset.reasoningEffort !== undefined ? !!preset.reasoningEffort : true;
        }
      }
    });
  }

  if (customBaseUrl) {
    enhanceInputAutoFill(customBaseUrl, {
      type: "url",
      title: "常用接口地址与历史推荐",
      presets: [
        { id: "https://api.siliconflow.cn/v1", name: "硅基流动 (SiliconFlow)", tag: "推荐聚合" },
        { id: "https://api.deepseek.com/v1", name: "DeepSeek 官方 API", tag: "官方直连" },
        { id: "http://localhost:11434/v1", name: "Ollama 本地服务", tag: "本地部署" },
        { id: "https://openrouter.ai/api/v1", name: "OpenRouter 全球聚合", tag: "全球聚合" },
        { id: "https://dashscope.aliyuncs.com/compatible-mode/v1", name: "阿里云百炼 (DashScope)", tag: "通义千问" },
        { id: "https://open.bigmodel.cn/api/paas/v4", name: "智谱开放平台 (BigModel)", tag: "智谱 GLM" },
        { id: "https://api.groq.com/openai/v1", name: "Groq 极速端点", tag: "极速硬件" },
        { id: "https://api.moonshot.cn/v1", name: "月之暗面 (Moonshot / Kimi)", tag: "Kimi" },
        { id: "https://ark.cn-beijing.volces.com/api/v3", name: "火山方舟 / 豆包 (VolcEngine)", tag: "字节跳动" },
        { id: "http://localhost:8000/v1", name: "vLLM 本地服务", tag: "私有部署" },
        { id: "http://localhost:1234/v1", name: "LM Studio 本地服务", tag: "本地部署" }
      ]
    });
  }

  // 全局消灭原生 autofill 破相弹窗
  enhanceAllAutoFills(document);

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

        // 沉淀至运营商与 URL 历史池
        saveAutofillHistory("provider", { id: providerId, name: providerId, baseUrl });
        saveAutofillHistory("url", { id: baseUrl, value: baseUrl });

        customProviderId.value = "";
        customBaseUrl.value = "";
        customApiKey.value = "";

        // 保存后自动进入步骤 2：运营商列表与模型管理
        switchInnerTab("inner-step2");
        loadCustomProvidersConfig();
        scrollSettingsToBottom(true);

        await sketchAlert(`运营商 [${providerId.toUpperCase()}] 已成功保存！已自动切换至“步骤 2”，可在此为该运营商添加具体模型或管理配置。`, { type: "success", title: "保存成功" });
        scrollSettingsToBottom(true);
      } catch (err) {
        console.error("Save custom provider failed:", err);
        await sketchAlert(`保存运营商失败: ${err}`, { type: "error", title: "保存失败" });
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  // 初始加载
  loadModelsAndState();

  // ==========================================================================
  // 6. 内核与版本控制逻辑 (包含一键更新、取消更新、不再提醒与 Changelog 抽屉)
  // ==========================================================================
  let latestUpdateInfo = null;
  let updateNoticeFadeTimer = null;

  const clearUpdateNoticeFade = () => {
    if (updateNoticeFadeTimer) {
      clearTimeout(updateNoticeFadeTimer);
      updateNoticeFadeTimer = null;
    }
    if (updateNotice) {
      updateNotice.classList.remove("fade-out");
    }
  };

  const showUpdateNoticeAutoFade = (durationMs = 8000) => {
    if (!updateNotice) return;
    clearUpdateNoticeFade();
    updateNotice.classList.remove("hidden", "fade-out");

    updateNoticeFadeTimer = setTimeout(() => {
      updateNotice.classList.add("fade-out");
      setTimeout(() => {
        if (updateNotice.classList.contains("fade-out")) {
          updateNotice.classList.add("hidden");
          updateNotice.classList.remove("fade-out");
        }
      }, 500);
    }, durationMs);
  };

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

  const applyUpdateInfoToUI = (info, isManual = false) => {
    latestUpdateInfo = info;
    if (!info) return;

    if (info.has_update) {
      // 若非用户主动点击检查，且用户已勾选“不再提醒更新”，则静默不弹窗
      if (!isManual && configService.getIgnoreUpdateNotification()) {
        if (updateNotice) updateNotice.classList.add("hidden");
        if (settingsBadge) settingsBadge.classList.remove("visible");
        return;
      }

      clearUpdateNoticeFade();
      if (updateNotice) updateNotice.classList.remove("hidden");
      if (updateNoticeActions) updateNoticeActions.classList.remove("hidden");
      if (updateMsg) {
        updateMsg.textContent = `发现新版本 v${info.latest_version} (当前: v${info.current_version})！`;
      }
      if (btnUpdateKernel) {
        btnUpdateKernel.innerHTML = `
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 2v8M4 6l4 4 4-4M2 13h12" />
          </svg>
          一键更新到 v${info.latest_version}
        `;
      }
      if (settingsBadge) settingsBadge.classList.add("visible");
    } else {
      if (updateNoticeActions) updateNoticeActions.classList.add("hidden");
      if (kernelChangelogDrawer) kernelChangelogDrawer.classList.add("hidden");
      if (updateMsg) {
        updateMsg.textContent = `已是最新版本 (v${info.current_version || "0.84.3"})`;
      }
      if (settingsBadge) settingsBadge.classList.remove("visible");
      // "是最新版本" 提醒框 弹出8秒后自动渐隐
      showUpdateNoticeAutoFade(8000);
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
        // 主动点击检查更新：将 ignoreUpdateNotification 置 false 并持久化记忆
        await configService.setIgnoreUpdateNotification(false);
        const res = await versionService.checkUpdate();
        applyUpdateInfoToUI(res, true);
      } catch (err) {
        console.error("Check update failed:", err);
      } finally {
        btnCheckUpdate.disabled = false;
      }
    });
  }

  // 不再提醒更新
  if (btnIgnoreUpdate) {
    btnIgnoreUpdate.addEventListener("click", async () => {
      await configService.setIgnoreUpdateNotification(true);
      clearUpdateNoticeFade();
      if (updateNotice) updateNotice.classList.add("hidden");
      if (kernelChangelogDrawer) kernelChangelogDrawer.classList.add("hidden");
      if (settingsBadge) settingsBadge.classList.remove("visible");
    });
  }

  // 模型配置「自动重连切换」开关 (默认勾选，全局持久化)
  if (autoReconnectSwitch) {
    autoReconnectSwitch.checked = configService.getAutoReconnectSwitch();
    autoReconnectSwitch.addEventListener("change", () => {
      configService.setAutoReconnectSwitch(autoReconnectSwitch.checked, true);
    });
  }
  configService.addEventListener("auto-reconnect-change", (e) => {
    if (autoReconnectSwitch && e.detail?.value !== undefined) {
      autoReconnectSwitch.checked = e.detail.value;
    }
  });

  // 取消内核更新
  if (btnCancelUpdate) {
    btnCancelUpdate.addEventListener("click", async () => {
      btnCancelUpdate.disabled = true;
      kernelUpdateStepper.stopTimer();
      if (kernelProgressStage) kernelProgressStage.textContent = "正在取消更新...";
      if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = "正在停止下载并清理临时文件...";
      try {
        await versionService.cancelKernelUpdate();
      } catch (err) {
        console.warn("Cancel kernel update error:", err);
      }
    });
  }

  // 展开/收起更新日志抽屉
  if (btnToggleChangelog && kernelChangelogDrawer) {
    btnToggleChangelog.addEventListener("click", () => {
      const isHidden = kernelChangelogDrawer.classList.toggle("hidden");
      if (!isHidden && latestUpdateInfo) {
        if (changelogVersionTag) {
          changelogVersionTag.textContent = latestUpdateInfo.latest_version
            ? `v${latestUpdateInfo.latest_version}`
            : "最新版本";
        }
        if (kernelChangelogContent) {
          kernelChangelogContent.textContent =
            latestUpdateInfo.release_notes?.trim() || "暂无该版本的更新日志详情。";
        }
      }
    });
  }

  if (btnCloseChangelog && kernelChangelogDrawer) {
    btnCloseChangelog.addEventListener("click", () => {
      kernelChangelogDrawer.classList.add("hidden");
    });
  }

  // 内核更新平滑进度步进器（每隔2秒增加1%，直到下个阶段-1%）
  const kernelMilestones = [0, 5, 8, 10, 72, 80, 86, 90, 95, 100];
  const kernelUpdateStepper = new ProgressStepper({
    milestones: kernelMilestones,
    intervalMs: 2000,
    onUpdate: (currentPercent, payload) => {
      if (kernelUpdateProgressWrap) {
        kernelUpdateProgressWrap.classList.remove("hidden");
      }
      if (kernelProgressFill) {
        kernelProgressFill.style.width = `${currentPercent}%`;
      }
      if (kernelProgressPercent) {
        kernelProgressPercent.textContent = `${currentPercent}%`;
      }
      if (payload) {
        if (payload.stageText && kernelProgressStage) {
          kernelProgressStage.textContent = payload.stageText;
        }
        if (payload.subMsgText && kernelProgressSubMsg) {
          kernelProgressSubMsg.textContent = payload.subMsgText;
        }
      }
    },
  });

  // 一键更新内核逻辑
  if (btnUpdateKernel) {
    btnUpdateKernel.addEventListener("click", async () => {
      const targetVer = latestUpdateInfo?.latest_version;
      if (!targetVer) {
        await sketchAlert("未找到可用更新版本", { type: "info", title: "检查更新" });
        return;
      }

      // 注册内核更新任务
      notificationService.registerTask("kernel-update", {
        targetVer,
        type: "kernel",
      });

      // 禁用操作按钮防止重复触发
      btnUpdateKernel.disabled = true;
      if (btnRestartHost) btnRestartHost.disabled = true;
      if (btnCheckUpdate) btnCheckUpdate.disabled = true;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      // 显示进度卡片并重置步进器
      if (kernelUpdateProgressWrap) {
        kernelUpdateProgressWrap.classList.remove("hidden");
        if (kernelProgressFill) kernelProgressFill.style.width = "0%";
        if (kernelProgressPercent) kernelProgressPercent.textContent = "0%";
        if (kernelProgressStage) kernelProgressStage.textContent = "正在准备下载内核...";
        if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = "正在连接 GitHub Releases...";
      }

      kernelUpdateStepper.reset();
      kernelUpdateStepper.step(0, {
        stageText: "正在准备下载内核...",
        subMsgText: "正在连接 GitHub Releases...",
      });

      try {
        await versionService.updateKernel(targetVer);
      } catch (err) {
        console.error("Kernel update failed:", err);
        kernelUpdateStepper.stopTimer();
        if (kernelProgressStage) kernelProgressStage.textContent = "内核更新失败";
        if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = String(err);
        btnUpdateKernel.disabled = false;
        if (btnRestartHost) btnRestartHost.disabled = false;
        if (btnCheckUpdate) btnCheckUpdate.disabled = false;
        if (btnCancelUpdate) btnCancelUpdate.disabled = false;
        notificationService.notifyError({
          title: "pi-dl",
          message: `内核更新失败：${String(err)}`,
          taskId: "kernel-update",
        });
      }
    });
  }

  // 监听内核更新流式进度事件
  versionService.addEventListener("kernel-update-progress", (e) => {
    const p = e.detail;
    if (!p) return;

    let subMsg = p.message || "";
    if (p.stage === "downloading" && p.total_bytes > 0) {
      const mbDown = (p.downloaded_bytes / (1024 * 1024)).toFixed(1);
      const mbTot = (p.total_bytes / (1024 * 1024)).toFixed(1);
      // 仅保留最右侧百分比，下方与左侧不再显示冗余百分比
      subMsg = `流式下载中: ${mbDown} MB / ${mbTot} MB`;
    }

    if (p.stage === "completed") {
      kernelUpdateStepper.stopTimer();
      kernelUpdateStepper.step(100, {
        stageText: p.message || `Pi 内核已成功更新至最新版本 v${p.target_version}！`,
        subMsgText: subMsg,
      });

      if (hostVersionText) {
        hostVersionText.textContent = `v${p.target_version}`;
      }
      if (updateNoticeActions) {
        updateNoticeActions.classList.add("hidden");
      }
      if (kernelChangelogDrawer) {
        kernelChangelogDrawer.classList.add("hidden");
      }
      if (updateMsg) {
        updateMsg.textContent = `Pi 内核已成功更新至最新版本 v${p.target_version}！`;
      }
      if (settingsBadge) {
        settingsBadge.classList.remove("visible");
      }

      if (btnUpdateKernel) btnUpdateKernel.disabled = false;
      if (btnRestartHost) btnRestartHost.disabled = false;
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      // 触发全任务完成通知
      notificationService.notifyIfAllCompleted({
        title: "pi-dl",
        message: `Pi 内核已成功更新至最新版本 v${p.target_version}！`,
        taskId: "kernel-update",
      });

      // "更新成功" 的提醒框 弹出8秒后自动渐隐
      showUpdateNoticeAutoFade(8000);

      // 3.5秒后自动隐去进度卡片
      setTimeout(() => {
        if (kernelUpdateProgressWrap) {
          kernelUpdateProgressWrap.classList.add("hidden");
        }
      }, 3500);
    } else if (p.stage === "cancelled") {
      kernelUpdateStepper.stopTimer();
      if (kernelProgressStage) kernelProgressStage.textContent = "内核更新已取消";
      if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = "已中止下载并清理临时文件";
      if (kernelProgressPercent) kernelProgressPercent.textContent = "0%";
      if (kernelProgressFill) kernelProgressFill.style.width = "0%";

      if (btnUpdateKernel) btnUpdateKernel.disabled = false;
      if (btnRestartHost) btnRestartHost.disabled = false;
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      notificationService.unregisterTask("kernel-update");

      setTimeout(() => {
        if (kernelUpdateProgressWrap) {
          kernelUpdateProgressWrap.classList.add("hidden");
        }
      }, 2000);
    } else if (p.stage === "error") {
      kernelUpdateStepper.stopTimer();
      if (kernelProgressStage) kernelProgressStage.textContent = "内核更新失败";
      if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = p.message || "更新发生异常";

      if (btnUpdateKernel) btnUpdateKernel.disabled = false;
      if (btnRestartHost) btnRestartHost.disabled = false;
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      notificationService.notifyError({
        title: "pi-dl",
        message: `内核更新失败：${p.message || "更新发生异常"}`,
        taskId: "kernel-update",
      });
    } else {
      // 正常多阶段推进：立即跳至 p.percent，并在等待期间每 2s 步进 +1% 直到下个阶段 - 1%
      kernelUpdateStepper.step(p.percent, {
        stageText: p.message || "正在处理内核更新...",
        subMsgText: subMsg,
      });
    }
  });

  versionService.addEventListener("update-available", (e) => {
    applyUpdateInfoToUI(e.detail, false);
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
  // ==========================================================================
  // 流式消息、工具调用与全链路错误渲染中心 (多轮 Flow 交互工作流架构)
  // ==========================================================================
  let thinkingStartTime = 0;
  let thinkingTimerInterval = null;
  let currentThinkingText = "";
  let currentResponseText = "";
  let currentErrorMessage = null;
  let lastUserQuery = "";
  let hasReceivedDelta = false;
  let hasAutoCollapsedThinking = false;
  const renderedToolCards = new Map();

  // 自动重连切换：缓存最近一次下发的构造 Prompt 与图片 Payload，供引擎同 Turn 复用重发
  let lastSentPrompt = "";
  let lastImagePayloads = null;

  /**
   * 当前活跃轮次的 DOM 引用缓存
   */
  let activeTurnRefs = null;

  /**
   * 折叠单张工具卡片
   * @param {HTMLElement} card
   */
  const collapseToolCard = (card) => {
    if (card && !card.classList.contains("collapsed")) {
      card.classList.add("collapsed");
      const header = card.querySelector(".tool-header");
      if (header) header.setAttribute("aria-expanded", "false");
    }
  };

  /**
   * 展开单张工具卡片
   * @param {HTMLElement} card
   */
  const expandToolCard = (card) => {
    if (card && card.classList.contains("collapsed")) {
      card.classList.remove("collapsed");
      const header = card.querySelector(".tool-header");
      if (header) header.setAttribute("aria-expanded", "true");
    }
  };

  /** 收起所有工具卡片（不包括 running 状态） */
  const collapseAllDoneToolCards = () => {
    renderedToolCards.forEach((card) => {
      if (!card.classList.contains("running")) {
        collapseToolCard(card);
      }
    });
  };

  /** 收起所有工具卡片（包括 running） */
  const collapseAllToolCards = () => {
    renderedToolCards.forEach((card) => {
      collapseToolCard(card);
    });
  };

  const collapseThinkingCard = (cardEl = null, btnEl = null) => {
    const targetCard = cardEl || activeTurnRefs?.thinkingCardEl || agentThinkingCard;
    const targetBtn = btnEl || activeTurnRefs?.thinkingToggleBtn || thinkingToggleBtn;
    if (targetCard && targetCard.classList.contains("open")) {
      targetCard.classList.remove("open");
      if (targetBtn) targetBtn.setAttribute("aria-expanded", "false");
    }
  };

  const expandThinkingCard = (cardEl = null, btnEl = null) => {
    const targetCard = cardEl || activeTurnRefs?.thinkingCardEl || agentThinkingCard;
    const targetBtn = btnEl || activeTurnRefs?.thinkingToggleBtn || thinkingToggleBtn;
    if (targetCard && !targetCard.classList.contains("open")) {
      targetCard.classList.add("open");
      if (targetBtn) targetBtn.setAttribute("aria-expanded", "true");
    }
  };

  const autoCollapseThinkingOnNextPhase = () => {
    if (!hasAutoCollapsedThinking) {
      hasAutoCollapsedThinking = true;
      collapseThinkingCard();
    }
  };

  /**
   * 动态创建单轮对话的 DOM 消息组 (Turn Message Group)
   * @param {Object} options
   * @param {string} options.query
   * @param {Array<any>} [options.attachments=[]]
   * @param {string} [options.thinkingText=""]
   * @param {string} [options.thinkingDurationText=""]
   * @param {string} [options.responseText=""]
   * @param {Array<any>} [options.toolCalls=[]]
   * @param {boolean} [options.isOpenThinking=true]
   * @param {boolean} [options.isAborted=false]
   * @param {string | null} [options.errorMessage=null]
   * @returns {Object} 包含该轮各子元素引用的对象
   */
  const createFlowTurnGroupElement = ({
    query = "",
    attachments = [],
    thinkingText = "",
    thinkingDurationText = "",
    responseText = "",
    toolCalls = [],
    isOpenThinking = true,
    isAborted = false,
    errorMessage = null,
  } = {}) => {
    const groupEl = document.createElement("div");
    groupEl.className = "flow-message-group";

    // 1. 用户问题卡片
    const userPromptCard = document.createElement("div");
    userPromptCard.className = "flow-user-prompt-card";

    let attachmentsHtml = "";
    if (Array.isArray(attachments) && attachments.length > 0) {
      const chips = attachments
        .map(
          (f) => `
        <span class="flow-attachment-chip" title="${escapeHtml(f.path || f.name)}">
          <span class="chip-icon">${getFileCategoryIcon(f.category)}</span>
          <span class="chip-name">${escapeHtml(f.name)}</span>
        </span>
      `
        )
        .join("");
      attachmentsHtml = `<div class="flow-prompt-attachments">${chips}</div>`;
    }

    userPromptCard.innerHTML = `
      <div class="prompt-icon">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M4 10 L16 10 M11 5 L16 10 L11 15" />
        </svg>
      </div>
      <div class="prompt-main-wrap">
        ${attachmentsHtml}
        <p class="prompt-content">${escapeHtml(query || (attachments.length > 0 ? `[附带 ${attachments.length} 个文件/图片]` : ""))}</p>
      </div>
    `;
    groupEl.appendChild(userPromptCard);

    // 2. 运行态上下文/Inner-Skill 注入胶囊
    const injectionCapsuleEl = document.createElement("div");
    injectionCapsuleEl.className = "flow-injection-capsule hidden";
    injectionCapsuleEl.setAttribute("role", "status");
    injectionCapsuleEl.setAttribute("aria-live", "polite");
    injectionCapsuleEl.innerHTML = `
      <span class="capsule-icon" aria-hidden="true">${ICONS.sparkle}</span>
      <span class="capsule-text">已注入运行态技能：windows-bash-compatibility</span>
    `;
    groupEl.appendChild(injectionCapsuleEl);

    // 2b. 自动重连/切换进度胶囊 (手绘草图风格，运行态瞬态展示，不沉淀历史)
    const failoverCapsuleEl = document.createElement("div");
    failoverCapsuleEl.className = "flow-failover-capsule hidden";
    failoverCapsuleEl.setAttribute("role", "status");
    failoverCapsuleEl.setAttribute("aria-live", "polite");
    failoverCapsuleEl.innerHTML = `
      <span class="capsule-icon" aria-hidden="true">${ICONS.bolt}</span>
      <span class="capsule-text">模型调用异常 · 自动重连中</span>
    `;
    groupEl.appendChild(failoverCapsuleEl);

    // 3. AI Agent 思考过程卡片
    const thinkingCardEl = document.createElement("div");
    thinkingCardEl.className = `agent-thinking-card ${isOpenThinking ? "open" : ""}`;
    thinkingCardEl.innerHTML = `
      <div class="thinking-header" role="button" tabindex="0" aria-expanded="${isOpenThinking ? "true" : "false"}">
        <div class="thinking-status-indicator">
          <span class="thinking-dot"></span>
          <span class="thinking-title">思考过程</span>
          <span class="thinking-duration">${escapeHtml(thinkingDurationText || "思考中...")}</span>
        </div>
        <div class="thinking-arrow-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </div>
      </div>
      <div class="thinking-body">
        <div class="thinking-text-stream">${escapeHtml(thinkingText)}</div>
      </div>
    `;

    const thinkingToggleBtn = thinkingCardEl.querySelector(".thinking-header");
    const thinkingDurationEl = thinkingCardEl.querySelector(".thinking-duration");
    const thinkingTextStreamEl = thinkingCardEl.querySelector(".thinking-text-stream");
    const thinkingBodyEl = thinkingCardEl.querySelector(".thinking-body");

    if (thinkingToggleBtn) {
      thinkingToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = thinkingCardEl.classList.toggle("open");
        thinkingToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    }

    groupEl.appendChild(thinkingCardEl);

    // 4. 工具调用卡片容器
    const toolCallsContainerEl = document.createElement("div");
    toolCallsContainerEl.className = "tool-calls-container";
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      toolCalls.forEach((tc) => {
        if (tc.html) {
          toolCallsContainerEl.insertAdjacentHTML("beforeend", tc.html);
        }
      });
      // 重新绑定历史工具卡片的点击折叠
      toolCallsContainerEl.querySelectorAll(".tool-card").forEach((card) => {
        const header = card.querySelector(".tool-header");
        if (header) {
          header.addEventListener("click", () => {
            if (card.classList.contains("collapsed")) {
              expandToolCard(card);
            } else {
              collapseToolCard(card);
            }
          });
        }
      });
    }
    groupEl.appendChild(toolCallsContainerEl);

    // 5. Agent 回答卡片
    const responseCardEl = document.createElement("div");
    responseCardEl.className = "flow-response-card";
    const responseContentEl = document.createElement("div");
    responseContentEl.className = "response-content";

    let initialHtml = renderMarkdown(responseText);
    if (isAborted || responseText?.includes("刚刚会话已手动终止")) {
      if (!initialHtml.includes("flow-abort-callout") && !initialHtml.includes("刚刚会话已手动终止")) {
        initialHtml += renderAbortNoticeHtml();
      }
    }
    if (errorMessage) {
      initialHtml += `
        <div class="sketch-error-card" style="margin-top: 10px;">
          <div class="error-header">
            <span class="error-icon" aria-hidden="true">${ICONS.warning}</span>
            <span class="error-title">模型调用失败</span>
          </div>
          <div class="error-message-text">${escapeHtml(errorMessage)}</div>
        </div>
      `;
    }
    responseContentEl.innerHTML = initialHtml;
    responseCardEl.appendChild(responseContentEl);
    groupEl.appendChild(responseCardEl);

    const userTextEl = userPromptCard.querySelector(".prompt-content");
    const promptAttachmentsEl = userPromptCard.querySelector(".flow-prompt-attachments");
    const injectionTextEl = injectionCapsuleEl.querySelector(".capsule-text");
    const failoverTextEl = failoverCapsuleEl.querySelector(".capsule-text");

    return {
      groupEl,
      userTextEl,
      promptAttachmentsEl,
      injectionCapsuleEl,
      injectionTextEl,
      failoverCapsuleEl,
      failoverTextEl,
      thinkingCardEl,
      thinkingToggleBtn,
      thinkingDurationEl,
      thinkingTextStreamEl,
      thinkingBodyEl,
      toolCallsContainerEl,
      responseContentEl,
    };
  };

  /**
   * 多段对话顶部悬浮当前提问提示 (Flow Floating Question Tip)
   * 仅当内容溢出触发滚动条 (scrollHeight > clientHeight) 时显现；
   * sticky 吸附于对话区域顶部、靠左对齐；纯提醒用途，无任何鼠标行为 (pointer-events: none)。
   * 多段对话锚定：根据滚动位置定位「当前所在对话段」——
   * 当视口顶部定位于第 N 段至第 N+1 段之间时，显示第 N 段对话顶部信息 (其提问文本)。
   */
  const updateFlowQuestionTip = () => {
    if (!flowQuestionTip || !flowQuestionTipText || !flowScrollArea) return;
    const overflowing = flowScrollArea.scrollHeight > flowScrollArea.clientHeight + 1;

    // 锚定当前对话段：取「顶部仍高于/等于视口顶边」的最后一个 flow-message-group
    let question = "";
    if (overflowing && flowConversation) {
      const groups = flowConversation.querySelectorAll(".flow-message-group");
      if (groups.length > 0) {
        const areaTop = flowScrollArea.getBoundingClientRect().top;
        let anchorGroup = groups[0];
        for (const g of groups) {
          if (g.getBoundingClientRect().top <= areaTop) {
            anchorGroup = g;
          } else {
            break;
          }
        }
        const qEl = anchorGroup.querySelector(".flow-user-prompt-card .prompt-content");
        question = qEl?.textContent?.trim() || lastUserQuery?.trim() || "";
      } else {
        question = String(lastUserQuery?.trim() || activeTurnRefs?.userTextEl?.textContent?.trim() || "");
      }
    }

    flowQuestionTipText.textContent = question;
    const shouldShow = currentView === VIEW_FLOW && overflowing && Boolean(question);
    flowQuestionTip.classList.toggle("visible", shouldShow);
  };

  // 内容尺寸变化（流式增长/折叠展开/多轮追加）与容器尺寸变化（窗口缩放）时自动刷新悬浮提示
  if (flowConversation && flowScrollArea) {
    const tipResizeObserver = new ResizeObserver(() => updateFlowQuestionTip());
    tipResizeObserver.observe(flowConversation);
    tipResizeObserver.observe(flowScrollArea);
    window.addEventListener("resize", updateFlowQuestionTip);
    // 滚动位置变化时重算锚定的对话段
    flowScrollArea.addEventListener("scroll", updateFlowQuestionTip, { passive: true });
  }
  // 视图切换进入/离开 Flow 时刷新悬浮提示显隐
  window.addEventListener("pi:view-change", () => updateFlowQuestionTip());

  // ==========================================================================
  // 多段对话上下轮次定位导航 (Flow Turn Navigation)
  // 触发条件：Flow 视图下对话轮次 >= 2 时，在 flow 内容区右侧（内容外）纵向显现「上 / 下」按钮；
  // 交互铁律：所有定位效果仅在「鼠标弹起」时响应 —— 按下后移出按钮再弹起不生效，
  //           故按下状态在 mouseleave 时即作废，mouseup 仅当指针仍在按钮上才会触发；
  // 定位目标：每轮对话定位到「该轮最终输出内容」的顶部，对齐显示窗体顶部；
  // 锚定与定位同源：连续多次点击可逐轮向上/向下定位（修复二次点击失效）；
  // 长按「下」满 1.5 秒：立即定位到会话最底部，无需弹起。
  // ==========================================================================
  const LONG_PRESS_MS = 1500;
  let navPressState = null; // { type: 'up'|'down', startTime, done }
  let downLongPressTimer = null;

  const resetNavButtonVisual = (type) => {
    const btn = type === "up" ? flowTurnNavUp : flowTurnNavDown;
    if (!btn) return;
    btn.classList.remove("holding", "long-press");
    if (type === "down") {
      btn.setAttribute("title", "下一个对话 (长按 1.5 秒直接定位到底部)");
    }
  };

  const beginNavPress = (type) => {
    if (navPressState) cancelNavPress(navPressState.type);
    navPressState = { type, startTime: Date.now(), done: false };
    const btn = type === "up" ? flowTurnNavUp : flowTurnNavDown;
    if (btn) btn.classList.add("holding");
    if (type === "down") {
      clearTimeout(downLongPressTimer);
      downLongPressTimer = setTimeout(() => {
        if (navPressState && navPressState.type === "down" && !navPressState.done) {
          navPressState.done = true; // 长按满 1.5 秒：立即定位到底部，无需弹起
          scrollToConversationBottom();
          if (flowTurnNavDown) {
            flowTurnNavDown.classList.add("long-press");
            flowTurnNavDown.setAttribute("title", "已定位到会话最底部");
          }
        }
      }, LONG_PRESS_MS);
    }
  };

  const endNavPress = (type) => {
    if (!navPressState || navPressState.type !== type) return;
    const wasDone = navPressState.done;
    navPressState = null;
    clearTimeout(downLongPressTimer);
    downLongPressTimer = null;
    resetNavButtonVisual(type);
    if (wasDone) return; // 长按已触发定位，弹起不再重复定位
    if (type === "up") {
      scrollToPreviousTurn();
    } else {
      scrollToNextTurn();
    }
  };

  const cancelNavPress = (type) => {
    if (navPressState && navPressState.type === type) {
      navPressState = null;
      clearTimeout(downLongPressTimer);
      downLongPressTimer = null;
      resetNavButtonVisual(type);
    }
  };

  const getFlowTurnCount = () =>
    flowConversation ? flowConversation.querySelectorAll(".flow-message-group").length : 0;

  // 顶部悬浮提问提示的吸附高度（锚定判定与定位偏移共用，保证目标内容不被遮挡）
  const getStickyTipOffset = () =>
    flowQuestionTip && flowQuestionTip.classList.contains("visible")
      ? flowQuestionTip.offsetHeight + 8
      : 0;

  // 每轮对话的定位锚点 = 该轮「最终输出内容」卡片（.flow-response-card / .agent-response-card），
  // 兜底回退到 .response-content 或整组。
  const getTurnResponseAnchor = (group) =>
    group?.querySelector(".flow-response-card") ||
    group?.querySelector(".agent-response-card") ||
    group?.querySelector(".response-content") ||
    group;

  // 当前锚定轮次：取「最终输出内容顶部 <= 视口顶边(+提示吸附高度)」的最后一个轮次；
  // 与定位使用同一目标，点击后锚定随之推进，可连续多次向上/向下定位（修复二次点击失效）。
  const getAnchoredTurnIndex = () => {
    if (!flowScrollArea || !flowConversation) return -1;
    const groups = flowConversation.querySelectorAll(".flow-message-group");
    if (groups.length === 0) return -1;
    const areaTop = flowScrollArea.getBoundingClientRect().top;
    const threshold = areaTop + getStickyTipOffset();
    let anchor = 0;
    for (let i = 0; i < groups.length; i++) {
      if (getTurnResponseAnchor(groups[i]).getBoundingClientRect().top <= threshold) {
        anchor = i;
      } else {
        break;
      }
    }
    return anchor;
  };

  // 定位到第 index 段对话「最终输出内容」顶部（对齐显示窗体顶部，扣除顶部悬浮提示吸附高度）
  const scrollToTurnStart = (index) => {
    if (!flowScrollArea || !flowConversation) return;
    const groups = flowConversation.querySelectorAll(".flow-message-group");
    if (index < 0 || index >= groups.length) return;
    const target = getTurnResponseAnchor(groups[index]);
    const areaTop = flowScrollArea.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    const tipOffset = getStickyTipOffset();
    const maxTop = flowScrollArea.scrollHeight - flowScrollArea.clientHeight;
    const nextTop = Math.max(
      0,
      Math.min(flowScrollArea.scrollTop + (targetTop - areaTop) - tipOffset, maxTop)
    );
    flowScrollArea.scrollTop = nextTop;
  };

  const scrollToPreviousTurn = () => {
    const anchor = getAnchoredTurnIndex();
    if (anchor <= 0) return; // 已是第一轮（或无可定位轮次）
    scrollToTurnStart(anchor - 1);
  };

  const scrollToNextTurn = () => {
    const anchor = getAnchoredTurnIndex();
    const count = getFlowTurnCount();
    if (anchor < 0 || anchor >= count - 1) return; // 已是最后一轮（或无可定位轮次）
    scrollToTurnStart(anchor + 1);
  };

  const scrollToConversationBottom = () => {
    if (!flowScrollArea) return;
    flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  };

  // 垂直对齐：按钮已右移到 flow 内容区域之外，垂直方向动态对齐 flow 内容区底部（问题3）
  const positionFlowTurnNav = () => {
    if (!flowTurnNav || !flowStage || !appContainer || currentView !== VIEW_FLOW) return;
    const appRect = appContainer.getBoundingClientRect();
    const stageRect = flowStage.getBoundingClientRect();
    const navHeight = flowTurnNav.offsetHeight || 0;
    flowTurnNav.style.top = `${Math.round(stageRect.bottom - appRect.top - navHeight - 14)}px`;
  };

  const updateFlowTurnNav = () => {
    if (!flowTurnNav) return;
    const shouldShow = currentView === VIEW_FLOW && getFlowTurnCount() >= 2;
    flowTurnNav.classList.toggle("visible", shouldShow);
    if (!shouldShow) {
      cancelNavPress("up");
      cancelNavPress("down");
    }
    positionFlowTurnNav();
  };

  // flow 内容区尺寸变化（窗口缩放 / 输入框多行高度变化 / 视图切换）时保持按钮垂直对齐
  if (flowStage) {
    const navStageResizeObserver = new ResizeObserver(() => positionFlowTurnNav());
    navStageResizeObserver.observe(flowStage);
    window.addEventListener("resize", positionFlowTurnNav);
  }

  // 绑定上/下按钮：mouseup 仅在指针仍停留在按钮上时触发（按下后移出再弹起不会生效）；
  // 同时补充键盘 Enter/Space 支持以保证可访问性。
  const bindTurnNavButton = (type) => {
    const btn = type === "up" ? flowTurnNavUp : flowTurnNavDown;
    if (!btn) return;
    btn.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      beginNavPress(type);
    });
    btn.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
      endNavPress(type);
    });
    btn.addEventListener("mouseleave", () => cancelNavPress(type));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        beginNavPress(type);
      }
    });
    btn.addEventListener("keyup", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        endNavPress(type);
      }
    });
  };
  bindTurnNavButton("up");
  bindTurnNavButton("down");

  // 视图切换进入/离开 Flow 时刷新定位导航显隐（新轮次追加在 resetStreamState 内联动刷新）
  window.addEventListener("pi:view-change", () => updateFlowTurnNav());

  /**
   * 初始化/重置流式状态（支持多轮追加与新会话独立划分）
   * @param {string} query
   * @param {Array<any>} attachments
   * @param {boolean} isFollowUpTurn 是否为同会话多轮后续追问
   */
  const resetStreamState = (query, attachments = [], isFollowUpTurn = false) => {
    lastUserQuery = query;
    currentErrorMessage = null;
    hasReceivedDelta = false;
    hasAutoCollapsedThinking = false;
    currentThinkingText = "";
    currentResponseText = "";
    renderedToolCards.clear();

    if (!isFollowUpTurn) {
      // 全新会话 -> 清空 flowConversation 容器
      if (flowConversation) {
        flowConversation.innerHTML = "";
      }
    } else {
      // 同工作流多轮对话 -> 固化上一轮（收起思考与工具卡片，移除上一轮光标）
      if (activeTurnRefs) {
        collapseThinkingCard(activeTurnRefs.thinkingCardEl, activeTurnRefs.thinkingToggleBtn);
        if (activeTurnRefs.responseContentEl) {
          const prevCursor = activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
          if (prevCursor) prevCursor.remove();
        }
      }
      collapseAllDoneToolCards();
    }

    // 创建当前轮次的 DOM 组并追加到 flowConversation
    activeTurnRefs = createFlowTurnGroupElement({
      query,
      attachments,
      thinkingText: "",
      thinkingDurationText: "思考中...",
      responseText: "",
      toolCalls: [],
      isOpenThinking: true,
    });

    if (flowConversation && activeTurnRefs?.groupEl) {
      flowConversation.appendChild(activeTurnRefs.groupEl);
    }

    if (activeTurnRefs.responseContentEl) {
      activeTurnRefs.responseContentEl.innerHTML = `<span class="streaming-cursor"></span>`;
    }

    expandThinkingCard(activeTurnRefs.thinkingCardEl, activeTurnRefs.thinkingToggleBtn);

    thinkingStartTime = Date.now();
    if (thinkingTimerInterval) clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = setInterval(() => {
      if (activeTurnRefs?.thinkingDurationEl) {
        const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        activeTurnRefs.thinkingDurationEl.textContent = `思考中 (${elapsed}s)...`;
      }
    }, 100);

    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }

    // 新轮次就绪后刷新顶部悬浮提问提示
    updateFlowQuestionTip();
    // 新轮次追加后刷新右侧多段对话定位导航显隐（>= 2 轮时显现）
    updateFlowTurnNav();
  };

  const finalizeStream = () => {
    piClient.isStreaming = false;
    if (thinkingTimerInterval) {
      clearInterval(thinkingTimerInterval);
      thinkingTimerInterval = null;
      if (activeTurnRefs?.thinkingDurationEl) {
        const finalElapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        activeTurnRefs.thinkingDurationEl.textContent = `已思考 ${finalElapsed} 秒`;
      }
    }
    // 移除光标
    if (activeTurnRefs?.responseContentEl) {
      const cursor = activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
    }
    // 流式结束时隐藏 Flow 中止按钮
    if (flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
    }
  };

  /**
   * 自动重连切换：复用当前 Turn 容器重发相同输入前重置当前轮次流式状态
   * 不重建用户提问卡、不重复压入 prompt history、不新建 Task，仅清除上一轮临时产物
   */
  const resetCurrentTurnForResend = () => {
    currentThinkingText = "";
    currentResponseText = "";
    currentErrorMessage = null;
    hasReceivedDelta = false;
    hasAutoCollapsedThinking = false;
    renderedToolCards.clear();

    // 移除上一轮临时错误卡片 (避免重复堆叠)
    if (activeTurnRefs?.responseContentEl) {
      const errCard = activeTurnRefs.responseContentEl.querySelector(".sketch-error-card");
      if (errCard) errCard.remove();
      const cursor = activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
      activeTurnRefs.responseContentEl.innerHTML = `<span class="streaming-cursor"></span>`;
    }
    // 清空思考流文本与工具卡片容器
    if (activeTurnRefs?.thinkingTextStreamEl) {
      activeTurnRefs.thinkingTextStreamEl.textContent = "";
    }
    if (activeTurnRefs?.toolCallsContainerEl) {
      activeTurnRefs.toolCallsContainerEl.innerHTML = "";
    }
    // 重开思考卡片并重置耗时计时
    expandThinkingCard(activeTurnRefs.thinkingCardEl, activeTurnRefs.thinkingToggleBtn);
    thinkingStartTime = Date.now();
    if (thinkingTimerInterval) clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = setInterval(() => {
      if (activeTurnRefs?.thinkingDurationEl) {
        const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        activeTurnRefs.thinkingDurationEl.textContent = `思考中 (${elapsed}s)...`;
      }
    }, 100);
    // 自愈期间保留「⏹ 终止」按钮可见
    if (flowBtnAbort) {
      flowBtnAbort.classList.remove("hidden");
    }
    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  /**
   * 更新自动重连/切换进度胶囊 (手绘草图风格，无 Emoji)
   */
  const updateFailoverCapsule = (payload = {}) => {
    if (!activeTurnRefs?.failoverCapsuleEl || !activeTurnRefs?.failoverTextEl) return;
    const phase = payload.phase || "";
    const textEl = activeTurnRefs.failoverTextEl;
    const capsule = activeTurnRefs.failoverCapsuleEl;

    if (payload.status === "succeeded" && payload.switched) {
      textEl.textContent = `已自动切换至 ${payload.modelName || "其他模型"} · 已记入最近使用`;
      capsule.classList.remove("hidden");
      capsule.classList.add("ok");
      // 2s 后淡出
      setTimeout(() => capsule.classList.add("hidden"), 2000);
      return;
    }
    if (payload.status === "succeeded") {
      // 重连成功 (未切换)：淡出「已恢复连接」
      textEl.textContent = "已恢复连接";
      capsule.classList.remove("hidden");
      capsule.classList.add("ok");
      setTimeout(() => capsule.classList.add("hidden"), 1500);
      return;
    }
    if (payload.status === "gave_up" || payload.status === "cancelled") {
      capsule.classList.add("hidden");
      capsule.classList.remove("ok");
      return;
    }

    // 重连中 / 切换中
    capsule.classList.remove("ok");
    if (payload.status === "reconnecting") {
      const codeStr = payload.code ? ` ${payload.code}` : "";
      if (phase === "waiting" && payload.nextDelayMs) {
        const secs = Math.max(1, Math.round(payload.nextDelayMs / 1000));
        textEl.textContent = `模型调用异常${codeStr} · 自动重连中 ${payload.attempt}/${payload.maxAttempts} · ${secs}s 后重试`;
      } else {
        textEl.textContent = `自动重连中 ${payload.attempt}/${payload.maxAttempts}`;
      }
      capsule.classList.remove("hidden");
    } else if (payload.status === "switching") {
      if (phase === "switching_model") {
        textEl.textContent = `正在自动切换至 ${payload.modelName || "其他模型"} 重试 … (${payload.candidateIndex + 1}/${payload.candidateTotal})`;
      } else {
        textEl.textContent = `${payload.modelName || "候选模型"} 重试中 … (${payload.candidateIndex + 1}/${payload.candidateTotal})`;
      }
      capsule.classList.remove("hidden");
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  };

  // 自动重连切换引擎进度事件 → 更新 Flow 进度胶囊
  modelFailoverEngine.addEventListener("failover-status", (e) => {
    const payload = e.detail || {};
    // 退避等待期间停止思考计时，避免耗时位残留「思考中」虚长
    if (
      (payload.status === "reconnecting" || payload.status === "switching") &&
      payload.phase === "waiting" &&
      thinkingTimerInterval
    ) {
      clearInterval(thinkingTimerInterval);
      thinkingTimerInterval = null;
    }
    updateFailoverCapsule(payload);
    // 侧边栏挂起任务状态徽章 (自动重连中/切换模型中) 实时刷新
    if (
      taskDetailsSidebar &&
      taskDetailsSidebar.classList.contains("open") &&
      typeof renderTaskSidebarList === "function"
    ) {
      renderTaskSidebarList();
    }
  });

  /**
   * 渲染手绘草图质感手动终止提示字段
   * @returns {string}
   */
  const renderAbortNoticeHtml = () => {
    return `<div class="sketch-callout flow-abort-callout" style="margin-top: 12px;"><span class="callout-icon" aria-hidden="true">${ICONS.stop}</span><span>刚刚会话已手动终止</span></div>`;
  };

  /**
   * 在 Flow 对话末尾安全追加手动终止提示
   */
  const appendFlowAbortNotice = () => {
    if (activeTurnRefs?.responseContentEl) {
      const cursor = activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
      if (!activeTurnRefs.responseContentEl.querySelector(".flow-abort-callout")) {
        activeTurnRefs.responseContentEl.insertAdjacentHTML("beforeend", renderAbortNoticeHtml());
      }
    }
    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  /**
   * 检查错误信息是否命中模型不支持多模态特征
   * @param {string} msg
   * @returns {boolean}
   */
  const isMultimodalError = (msg) => {
    if (!msg) return false;
    const lower = String(msg).toLowerCase();
    return (
      lower.includes("multimodal") ||
      lower.includes("vision") ||
      lower.includes("image") ||
      lower.includes("does not support image") ||
      lower.includes("unsupported media") ||
      lower.includes("unsupported content type") ||
      lower.includes("not support binary") ||
      lower.includes("file attachments are not supported") ||
      lower.includes("messages.content: array") ||
      lower.includes("content parts") ||
      (lower.includes("400") && Array.isArray(lastSentAttachments) && lastSentAttachments.some((f) => f.category === "image"))
    );
  };

  /**
   * 渲染手绘草图风格异常诊断卡片并提供快捷操作与多模态建议
   * @param {{ message: string, model?: string, provider?: string }} errDetail
   */
  const renderErrorCard = (errDetail) => {
    piClient.isStreaming = false;
    currentErrorMessage = errDetail?.message || "与模型服务通信中断或返回异常";
    const currentTask = taskManager.getCurrentActiveTask();
    if (currentTask) {
      currentTask.status = "error";
      currentTask.completedAt = Date.now();
      currentTask.errorMessage = currentErrorMessage;
      taskManager.dispatchEvent(new CustomEvent("task-updated", { detail: currentTask }));
      taskManager.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: taskManager.getAllTasks() } }));
    }
    finalizeStream();
    if (flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
    }
    const errMsg = currentErrorMessage;

    // 软件失焦时立即弹出报错终止通知 (带 Windows 默认提示音)
    notificationService.notifyError({
      title: "pi-dl",
      message: `模型调用异常终止：${errMsg.length > 80 ? errMsg.slice(0, 77) + "..." : errMsg}`,
      taskId: "agent-prompt",
    });

    const targetResponseEl = activeTurnRefs?.responseContentEl || flowResponseContent;
    if (!targetResponseEl) return;

    const activeModelName = errDetail?.model || piClient.currentModel?.id || "当前模型";
    const isMultiModalIssue = isMultimodalError(errMsg);

    const multimodalHintHtml = isMultiModalIssue
      ? `
        <div class="multimodal-hint-box">
          <div class="hint-content-wrap">
            <span class="hint-icon">${ICONS.lightbulb}</span>
            <div class="hint-text">
              <strong>建议：</strong>当前模型不支持直接解析多模态文件。您可在<strong>「设置 ➔ 扩展组件」</strong>中安装推荐的 Pi 多模态解析插件以自动转换图像与文档。
            </div>
          </div>
          <button type="button" class="hint-action-btn" id="btn-err-goto-packages">
            ${ICONS.sparkle} 前往安装组件
          </button>
        </div>
      `
      : "";

    // 自愈摘要行：仅当引擎发生过自动重连/切换时才追加 (复用 renderErrorCard 终态渲染)
    let failoverSummaryHtml = "";
    if (errDetail?.failoverSummary) {
      if (errDetail.failoverSummary.singleModelOnly) {
        failoverSummaryHtml = `<div class="error-failover-summary">当前仅配置 1 个模型，无其他候选模型可自动切换</div>`;
      } else {
        const parts = [];
        if (errDetail.failoverSummary.reconnectCount > 0) {
          parts.push(`已尝试重连 ${errDetail.failoverSummary.reconnectCount} 次`);
        }
        if (errDetail.failoverSummary.triedCandidates > 0) {
          parts.push(`已依次尝试 ${errDetail.failoverSummary.triedCandidates} 个模型`);
        }
        if (parts.length > 0) {
          failoverSummaryHtml = `<div class="error-failover-summary">${parts.join(" / ")} 后仍失败</div>`;
        }
      }
    }

    const cardHtml = `
      <div class="sketch-error-card">
        <div class="error-header">
          <span class="error-icon" aria-hidden="true">${ICONS.warning}</span>
          <span class="error-title">模型调用失败 [${escapeHtml(activeModelName)}]</span>
        </div>
        <div class="error-message-text">${escapeHtml(errMsg)}</div>
        ${failoverSummaryHtml}
        ${multimodalHintHtml}
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

    // 移除已存在的错误卡片，避免重复堆叠
    const existingCard = targetResponseEl.querySelector(".sketch-error-card");
    if (existingCard) {
      existingCard.remove();
    }

    if (!currentResponseText || currentResponseText.trim().length === 0) {
      targetResponseEl.innerHTML = cardHtml;
    } else {
      targetResponseEl.insertAdjacentHTML("beforeend", cardHtml);
    }

    const btnRetry = document.getElementById("btn-err-retry");
    const btnSwitch = document.getElementById("btn-err-switch-model");
    const btnGotoPackages = document.getElementById("btn-err-goto-packages");

    if (btnRetry) {
      btnRetry.addEventListener("click", () => {
        if (lastUserQuery) {
          handleFlowQuery(lastUserQuery, lastSentAttachments);
        }
      });
    }

    if (btnSwitch) {
      btnSwitch.addEventListener("click", () => {
        openSettingsView();
      });
    }

    if (btnGotoPackages) {
      btnGotoPackages.addEventListener("click", () => {
        openSettingsView("tab-packages");
      });
    }

    // 报错终止时即时自动沉淀快照至历史记录
    archiveCurrentFlowToHistory();
  };

  // 绑定 PiClient 流式事件
  piClient.addEventListener("thinking-start", () => {
    hasReceivedDelta = true;
    if (!hasAutoCollapsedThinking) {
      expandThinkingCard();
    }
  });

  piClient.addEventListener("thinking-delta", (e) => {
    hasReceivedDelta = true;
    currentThinkingText += e.detail;
    if (activeTurnRefs?.thinkingTextStreamEl) {
      activeTurnRefs.thinkingTextStreamEl.textContent = currentThinkingText;
    }
    if (activeTurnRefs?.thinkingBodyEl) {
      activeTurnRefs.thinkingBodyEl.scrollTop = activeTurnRefs.thinkingBodyEl.scrollHeight;
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("thinking-end", () => {
    if (activeTurnRefs?.thinkingDurationEl) {
      const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
      activeTurnRefs.thinkingDurationEl.textContent = `已思考 ${elapsed} 秒`;
    }
    autoCollapseThinkingOnNextPhase();
  });

  piClient.addEventListener("text-start", () => {
    hasReceivedDelta = true;
    autoCollapseThinkingOnNextPhase();
    // 文本输出开始时，收起所有已完成的工具卡片
    collapseAllDoneToolCards();
  });

  piClient.addEventListener("text-delta", (e) => {
    hasReceivedDelta = true;
    autoCollapseThinkingOnNextPhase();
    currentResponseText += e.detail;
    if (activeTurnRefs?.responseContentEl) {
      activeTurnRefs.responseContentEl.innerHTML = renderMarkdown(currentResponseText) + `<span class="streaming-cursor"></span>`;
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
    if (!rawToolName || !activeTurnRefs?.injectionCapsuleEl || !activeTurnRefs?.injectionTextEl) return;
    const nameLower = rawToolName.toString().toLowerCase().trim();
    const mapped = activeToolSkillMappings.get(nameLower);
    if (mapped) {
      activeTurnRefs.injectionTextEl.textContent = mapped.label || `已激活运行态技能：${mapped.skill}`;
      activeTurnRefs.injectionCapsuleEl.classList.remove("hidden");
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

    // 新工具卡片出现时，自动收起所有已完成的旧工具卡片
    collapseAllDoneToolCards();

    // 当底层 Agent 触发调用映射工具（如 bash）时，即时显现运行态技能注入胶囊
    showInnerSkillCapsuleForTool(toolName);

    const card = document.createElement("div");
    card.className = "tool-card running";
    card.id = `tool-${toolCallId}`;

    const argsStr = data.args ? JSON.stringify(data.args, null, 2) : "";

    card.innerHTML = `
      <div class="tool-header" role="button" tabindex="0" aria-expanded="true">
        <div class="tool-title-group">
          <span class="tool-icon" aria-hidden="true">${ICONS.tool}</span>
          <span class="tool-name">${escapeHtml(toolName)}</span>
        </div>
        <div class="tool-header-right">
          <span class="tool-status-badge">running</span>
          <span class="tool-collapse-arrow" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </span>
        </div>
      </div>
      <div class="tool-body">${escapeHtml(argsStr)}</div>
    `;

    // 点击 header 切换折叠/展开
    const header = card.querySelector(".tool-header");
    if (header) {
      const toggle = () => {
        if (card.classList.contains("collapsed")) {
          expandToolCard(card);
        } else {
          collapseToolCard(card);
        }
      };
      header.addEventListener("click", toggle);
      header.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggle();
        }
      });
    }

    if (activeTurnRefs?.toolCallsContainerEl) {
      activeTurnRefs.toolCallsContainerEl.appendChild(card);
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
    // 引擎接管自愈时，内核内置 3 次快速重试降级为内部静默，不再覆盖耗时位展示
    if (modelFailoverEngine.isActive()) return;
    if (activeTurnRefs?.thinkingDurationEl && data.attempt) {
      activeTurnRefs.thinkingDurationEl.textContent = `自动重试中 (${data.attempt}/${data.maxAttempts || 3})...`;
    }
  });

  piClient.addEventListener("agent-start", () => {
    notificationService.registerTask("agent-prompt", { type: "agent" });
  });

  piClient.addEventListener("extension-ui", (e) => {
    const data = e?.detail || {};
    const method = String(data.method || "").toLowerCase();

    // 仅当扩展插件发出真正需要人工介入与交互确认的请求（如 confirm/prompt/select/input/form 等）时，
    // 且处于非聚焦状态才触发系统通知；常规的 setWidget / setStatus / notify(info) 等被动组件更新绝不触发人工介入通知
    const INTERACTIVE_METHODS = [
      "confirm",
      "prompt",
      "select",
      "input",
      "editor",
      "form",
      "ask_user",
      "human_intervention",
      "decision",
    ];
    const isInteractive =
      INTERACTIVE_METHODS.includes(method) ||
      data.interactive === true ||
      data.requiresConfirmation === true;

    if (isInteractive) {
      const msg =
        data.message ||
        data.title ||
        data.prompt ||
        "模型/扩展插件请求人工介入处理，请返回确认操作。";
      notificationService.notifyHumanIntervention({
        title: "pi-dl",
        message: msg,
      });
    }
  });

  // ==========================================================================
  // 自动重连切换引擎 (ModelFailoverEngine) 接入
  // 瞬态错误自动重连 / 永久错误自动切换，全程无需用户介入，绝不提前渲染错误卡与归档
  // ==========================================================================
  const failoverHooks = {
    // 同 Turn 复用重发相同输入 (不重建提问卡、不重复压入 prompt history、不新建 Task)
    onResendAttempt: (taskId) => {
      resetCurrentTurnForResend();
      return piClient.sendPrompt(lastSentPrompt, lastImagePayloads, null, taskId);
    },
    // 全部失败兜底：复用既有错误卡并追加自愈摘要
    onGiveUp: (errDetail, summary) => {
      const detail = { ...(errDetail || {}) };
      if (summary && (summary.reconnectCount > 0 || summary.triedCandidates > 0)) {
        detail.failoverSummary = summary;
      }
      renderErrorCard(detail);
    },
    // 自愈成功：正常收尾 (收起工具卡 + 结束流式 + 沉淀历史快照)
    onSuccess: () => {
      collapseAllToolCards();
      finalizeStream();
      archiveCurrentFlowToHistory();
    },
  };

  piClient.addEventListener("agent-error", (e) => {
    if (modelFailoverEngine.isActive()) {
      // 自愈进行中：该错误即为当前重发尝试的结果 (含 RPC/扩展错误)，一律交由引擎结算，
      // 避免引擎在途尝试悬空挂起，也绝不提前渲染错误卡打断自愈
      modelFailoverEngine.handleModelError(e.detail, failoverHooks);
    } else if (modelFailoverEngine.canHandle(e.detail)) {
      // 冷启动：自动重连开启且错误含模型上下文 → 交给引擎自愈
      modelFailoverEngine.handleModelError(e.detail, failoverHooks);
    } else {
      renderErrorCard(e.detail);
    }
  });

  piClient.addEventListener("agent-end", () => {
    // 引擎自愈进行中：结算当前重发尝试为成功，由引擎负责收尾，避免提前归档历史
    if (modelFailoverEngine.isActive()) {
      modelFailoverEngine.resolveTurnSuccess();
      return;
    }
    // 完成后收起所有工具卡片（最终输出卡不收起）
    collapseAllToolCards();
    finalizeStream();
    archiveCurrentFlowToHistory();
  });

  /**
   * 触发用户提问并向 Pi 下发指令（支持同一 Flow 多轮会话工作流、注入文件绝对路径与多任务隔离）
   * @param {string} query
   * @param {Array<any>} [filesToAttach=[]]
   */
  const handleFlowQuery = async (query, filesToAttach = []) => {
    if (!query && filesToAttach.length === 0) return;

    const savedSelected = configService.getSelectedModel();
    const modelName =
      piClient.currentModel?.id ||
      piClient.currentModel?.modelId ||
      piClient.currentModel?.name ||
      savedSelected?.modelId ||
      "default";
    const providerName =
      piClient.currentModel?.provider ||
      savedSelected?.provider ||
      "anthropic";

    // 判断是否在 Flow 模式下向同一个工作流继续提问 (Multi-turn Follow-up)
    const activeTask = taskManager.getCurrentActiveTask();
    const isFollowUp = Boolean(currentView === VIEW_FLOW && activeTask);

    // 用户发起新的显式提问：若引擎正在自愈「当前活跃任务」，以手动操作为准取消其过期自愈，
    // 避免旧轮次退避重发污染新提问；后台挂起任务的自愈不受影响 (规范：挂起后台继续运行)
    if (modelFailoverEngine.isActive() && activeTask && modelFailoverEngine.taskId === activeTask.id) {
      modelFailoverEngine.cancel("new-query");
    }

    let currentTask = activeTask;

    if (isFollowUp && currentTask) {
      // 同一个 Flow 连续对话：在已有 Task 下开启新一轮 Turn
      taskManager.startNewTurn(currentTask.id, query, filesToAttach);
    } else {
      // 发起全新对话工作流：检查并发任务上限保护 (MAX_CONCURRENT_TASKS = 3)
      const runningTasks = taskManager.getActiveTasks();
      if (runningTasks.length >= taskManager.maxConcurrent) {
        showGlobalToast(`后台任务已达上限 (${runningTasks.length}/${taskManager.maxConcurrent})，请等待某个任务完成后再发起新对话`, 2500);
        return;
      }

      currentTask = taskManager.createTask({
        query,
        attachments: filesToAttach,
        model: modelName,
        provider: providerName,
      });
    }

    if (flowBtnAbort) {
      flowBtnAbort.classList.remove("hidden");
    }

    // 记录本次附带的文件用于多模态失败检测与自适应重试
    lastSentAttachments = [...filesToAttach];

    // 构造下发给模型的 Prompt 与上下文注入（实际注入内容为文件的系统绝对路径）
    let promptToSend = query;
    if (filesToAttach.length > 0) {
      const pathsBlock = filesToAttach.map((f) => `- ${f.path || f.name}`).join("\n");
      if (query) {
        promptToSend = `${query}\n\n[附带本地文件绝对路径]:\n${pathsBlock}`;
      } else {
        promptToSend = `请查阅并分析以下文件内容：\n\n[附带本地文件绝对路径]:\n${pathsBlock}`;
      }
    }

    // 初始化/追加流式轮次 DOM
    resetStreamState(query, filesToAttach, isFollowUp);
    setViewMode(VIEW_FLOW, true);

    if (query && query.trim()) {
      promptHistoryNavigator.push(query.trim());
    }

    searchInput.value = "";
    clearAttachedFiles();
    updateInputState();
    autoResizeSearchInput();

    try {
      // 优先直接将多模态文件注入模型（构造原生图片 Payload 与绝对路径直传模型）
      let imagePayloads = null;
      const imageFiles = filesToAttach.filter((f) => f.category === "image" && f.path);
      if (imageFiles.length > 0) {
        const payloadResults = await Promise.all(
          imageFiles.map(async (f) => {
            try {
              return await invokeTauri("pi_prepare_image_payload", { path: f.path });
            } catch (_) {
              return null;
            }
          })
        );
        imagePayloads = payloadResults.filter(Boolean);
        if (imagePayloads.length === 0) imagePayloads = null;
      }

      // 同一个 Flow 使用同一个 currentTask.id 保持会话上下文
      // 缓存构造后的 Prompt 与图片 Payload，供自动重连切换引擎同 Turn 复用重发
      lastSentPrompt = promptToSend;
      lastImagePayloads = imagePayloads;
      await piClient.sendPrompt(promptToSend, imagePayloads, null, currentTask.id);
    } catch (err) {
      console.error("Failed to send prompt to Pi:", err);
      piClient.isStreaming = false;
      if (currentTask) {
        currentTask.status = "error";
        currentTask.completedAt = Date.now();
        currentTask.errorMessage = err.toString();
        taskManager.dispatchEvent(new CustomEvent("task-updated", { detail: currentTask }));
        taskManager.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: taskManager.getAllTasks() } }));
      }
      renderErrorCard({
        message: err.toString(),
        model: modelName,
        provider: providerName,
      });
    }
  };

  const submitCurrentPrompt = () => {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    if (query || attachedFiles.length > 0) {
      handleFlowQuery(query, attachedFiles);
      autoResizeSearchInput();
    } else {
      searchInput.focus();
    }
  };

  // 表单回车提交
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (configService.getSendShortcut() !== "ctrlEnter") {
      submitCurrentPrompt();
    }
  });

  // ==========================================================================
  // Flow 界面全局滚轮委托：window capture 阶段拦截，将滚动委托给 flow-scroll-area。
  // 仅在 flow 视图激活时生效；若目标在独立可滚动子区域（thinking-body/tool-body）
  // 且该区域本身仍有剩余滚动空间，则不拦截，让其自然滚动。
  // ==========================================================================
  if (flowScrollArea) {
    window.addEventListener("wheel", (e) => {
      // 仅在 flow 视图激活时处理
      if (currentView !== VIEW_FLOW) return;

      // 检测是否在独立可滚动子区域内且该子区域仍有剩余滚动空间
      const scrollableInner = e.target.closest(".thinking-body") ||
        e.target.closest(".tool-body");
      if (scrollableInner) {
        const canScrollUp = e.deltaY < 0 && scrollableInner.scrollTop > 0;
        const canScrollDown = e.deltaY > 0 &&
          scrollableInner.scrollTop < scrollableInner.scrollHeight - scrollableInner.clientHeight - 1;
        if (canScrollUp || canScrollDown) return; // 子区域还能滚，不拦截
      }

      // 将滚动量全部委托给 flow-scroll-area
      e.preventDefault();
      flowScrollArea.scrollTop += e.deltaY;
    }, { passive: false, capture: true });
  }

  // ==========================================================================
  // 详细界面历史对话讯息方框交互引擎 (Sketch Message Drawer & MRU Flow Recovery)
  // 1. 常态展示第 1 行（3 个），悬浮向下平滑渐出展示更多（下方每行 4 个）；
  // 2. 讯息按最近浏览时间（lastViewedAt）排序，点击即刷新该时间重排至第 1 位；
  // 3. 点击讯息方框即可恢复该次对话（问题、思考链、工具调用与回答完整恢复至 Flow 模式）；
  // 4. 悬浮出现右上角 "×" 按钮，点击仅在 UI 中隐藏该条目，保留底层数据。
  // ==========================================================================
  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return "";
    const diffMs = Date.now() - Number(timestamp);
    if (diffMs < 60000) return "刚刚";
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return "昨天";
    if (diffDay < 7) return `${diffDay} 天前`;
    const d = new Date(timestamp);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // ==========================================================================
  // 后台任务管理与多任务侧边栏交互 (TaskManager, Mini Capsule & Task Sidebar)
  // ==========================================================================
  let globalToastTimeout = null;
  const showGlobalToast = (message, duration = 1500) => {
    if (!globalToastBanner || !globalToastText) return;
    globalToastText.textContent = message;
    globalToastBanner.classList.remove("hidden");
    if (globalToastTimeout) clearTimeout(globalToastTimeout);
    globalToastTimeout = setTimeout(() => {
      globalToastBanner.classList.add("hidden");
    }, duration);
  };

  const updateMiniTaskCapsuleUI = () => {
    if (!miniTaskCapsule || !capsuleTaskText) return;
    const total = taskManager.getTotalSuspendedCount();
    const completed = taskManager.getCompletedSuspendedCount();
    const active = taskManager.getActiveSuspendedTasks();

    if (total === 0) {
      miniTaskCapsule.classList.add("hidden");
      return;
    }

    miniTaskCapsule.classList.remove("hidden");
    capsuleTaskText.textContent = `${completed}/${total} Task`;

    if (active.length > 0) {
      miniTaskCapsule.classList.add("is-running");
      miniTaskCapsule.classList.remove("all-completed");
    } else {
      miniTaskCapsule.classList.remove("is-running");
      if (completed === total) {
        miniTaskCapsule.classList.add("all-completed");
      } else {
        miniTaskCapsule.classList.remove("all-completed");
      }
    }
  };

  const openTaskSidebar = () => {
    if (!taskDetailsSidebar) return;
    renderTaskSidebarList();
    taskDetailsSidebar.classList.add("open");
    document.body.classList.add("has-task-sidebar-open");
  };

  const closeTaskSidebar = () => {
    if (!taskDetailsSidebar) return false;
    const wasOpen = taskDetailsSidebar.classList.contains("open");
    if (wasOpen) {
      taskDetailsSidebar.classList.remove("open");
      document.body.classList.remove("has-task-sidebar-open");
      return true;
    }
    return false;
  };

  const renderTaskSidebarList = () => {
    if (!taskSidebarList || !taskSidebarSummary) return;
    const tasks = taskManager.getSuspendedTasks();
    const completed = taskManager.getCompletedSuspendedCount();
    const total = taskManager.getTotalSuspendedCount();

    taskSidebarSummary.textContent = `已完成 ${completed} / 共 ${total} 个`;

    if (tasks.length === 0) {
      taskSidebarList.innerHTML = `<div class="empty-tasks-placeholder">暂无后台挂起任务</div>`;
      return;
    }

    // 移除 placeholder
    const placeholder = taskSidebarList.querySelector(".empty-tasks-placeholder");
    if (placeholder) placeholder.remove();

    // 收集现有 card 映射以支持原地增量更新，杜绝 hover 闪烁
    const existingCards = new Map();
    taskSidebarList.querySelectorAll(".sidebar-task-card").forEach((el) => {
      if (el.dataset.id) {
        existingCards.set(el.dataset.id, el);
      }
    });

    const activeIds = new Set(tasks.map((t) => t.id));

    // 移除已不存在的 card
    for (const [id, el] of existingCards) {
      if (!activeIds.has(id)) {
        el.remove();
        existingCards.delete(id);
      }
    }

    tasks.forEach((task) => {
      const isRunning = task.status === "thinking" || task.status === "streaming" || task.status === "tool_exec";
      const isCurrent = taskManager.currentActiveTaskId === task.id;

      // 自动重连切换进行中：该 Task 绑定引擎自愈流水线时展示专属状态徽章
      const engineStatus =
        modelFailoverEngine.isActive() &&
        modelFailoverEngine.taskId &&
        modelFailoverEngine.taskId === task.id
          ? modelFailoverEngine.status
          : null;

      let statusText = "已完成";
      if (engineStatus === "reconnecting") {
        statusText = "自动重连中";
      } else if (engineStatus === "switching") {
        statusText = "切换模型中";
      } else if (task.status === "thinking") {
        const elapsed = ((Date.now() - task.startedAt) / 1000).toFixed(0);
        statusText = `思考中 (${elapsed}s)`;
      } else if (task.status === "streaming") {
        statusText = "流式生成中";
      } else if (task.status === "tool_exec") {
        statusText = `执行工具: ${task.activeToolName || "tool"}`;
      } else if (task.status === "paused") {
        statusText = "待确认";
      } else if (task.status === "aborted") {
        statusText = "已终止";
      } else if (task.status === "error") {
        statusText = "异常终止";
      }

      let card = existingCards.get(task.id);
      if (card) {
        // 原地更新已存在的节点，保持鼠标 hover 状态不丢失、不闪烁
        card.className = `sidebar-task-card status-${task.status} ${isRunning ? "active-running" : ""} ${isCurrent ? "is-selected" : ""}`;
        const badge = card.querySelector(".task-card-status-badge");
        if (badge && badge.textContent !== statusText) {
          badge.textContent = statusText;
        }
        const titleEl = card.querySelector(".task-card-title");
        const newTitle = task.title || task.query || "未命名任务";
        if (titleEl && titleEl.textContent !== newTitle) {
          titleEl.textContent = newTitle;
          titleEl.title = task.query || task.title || "";
        }
        const modelEl = card.querySelector(".task-card-model");
        if (modelEl && modelEl.textContent !== (task.model || "Model")) {
          modelEl.textContent = task.model || "Model";
        }
        let btnAbort = card.querySelector(".btn-abort-task");
        if (isRunning && !btnAbort) {
          const actions = card.querySelector(".task-card-actions");
          if (actions) {
            btnAbort = document.createElement("button");
            btnAbort.type = "button";
            btnAbort.className = "task-card-action-btn btn-abort-task";
            btnAbort.textContent = "⏹ 终止";
            btnAbort.addEventListener("click", async (e) => {
              e.stopPropagation();
              await taskManager.abortTask(task.id);
              renderTaskSidebarList();
              updateMiniTaskCapsuleUI();
            });
            actions.appendChild(btnAbort);
          }
        } else if (!isRunning && btnAbort) {
          btnAbort.remove();
        }
      } else {
        // 新建卡片
        card = document.createElement("div");
        card.dataset.id = task.id;
        card.className = `sidebar-task-card status-${task.status} ${isRunning ? "active-running" : ""} ${isCurrent ? "is-selected" : ""}`;
        card.innerHTML = `
          <div class="task-card-header">
            <span class="task-card-model">${escapeHtml(task.model || "Model")}</span>
            <span class="task-card-status-badge">${escapeHtml(statusText)}</span>
          </div>
          <div class="task-card-title" title="${escapeHtml(task.query || task.title)}">${escapeHtml(task.title || task.query)}</div>
          <div class="task-card-actions">
            <button type="button" class="task-card-action-btn btn-enter-flow">进入 Flow</button>
            ${isRunning ? `<button type="button" class="task-card-action-btn btn-abort-task">⏹ 终止</button>` : ""}
          </div>
        `;

        card.addEventListener("click", (e) => {
          if (e.target.closest(".task-card-action-btn")) return;
          restoreTaskToFlow(task);
          closeTaskSidebar();
        });

        const btnEnter = card.querySelector(".btn-enter-flow");
        if (btnEnter) {
          btnEnter.addEventListener("click", (e) => {
            e.stopPropagation();
            restoreTaskToFlow(task);
            closeTaskSidebar();
          });
        }

        const btnAbort = card.querySelector(".btn-abort-task");
        if (btnAbort) {
          btnAbort.addEventListener("click", async (e) => {
            e.stopPropagation();
            await taskManager.abortTask(task.id);
            renderTaskSidebarList();
            updateMiniTaskCapsuleUI();
          });
        }

        taskSidebarList.appendChild(card);
      }
    });
  };

  if (miniTaskCapsule) {
    miniTaskCapsule.addEventListener("click", (e) => {
      e.stopPropagation();
      openTaskSidebar();
    });
  }

  if (btnCloseTaskSidebar) {
    btnCloseTaskSidebar.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTaskSidebar();
    });
  }

  if (flowBtnAbort) {
    flowBtnAbort.addEventListener("click", async (e) => {
      e.stopPropagation();
      // 立即终止引擎待执行的退避定时器与切换流水线
      modelFailoverEngine.cancel("user");
      const current = taskManager.getCurrentActiveTask();
      if (current) {
        await taskManager.abortTask(current.id);
      } else {
        await piClient.abort();
      }
      finalizeStream();
      appendFlowAbortNotice();
      showGlobalToast("当前任务已手动终止", 1200);
      archiveCurrentFlowToHistory();
    });
  }

  taskManager.addEventListener("task-aborted", (e) => {
    const abortedTask = e.detail;
    const current = taskManager.getCurrentActiveTask();
    if (current && current.id === abortedTask?.id) {
      // 终止与该 Task 绑定的自愈流水线 (退避定时器与切换流水线)
      modelFailoverEngine.cancel("abort");
      finalizeStream();
      appendFlowAbortNotice();
      archiveCurrentFlowToHistory();
    }
  });

  taskManager.addEventListener("tasks-changed", () => {
    updateMiniTaskCapsuleUI();
    renderConversationMessages();
    if (taskDetailsSidebar && taskDetailsSidebar.classList.contains("open")) {
      renderTaskSidebarList();
    }
  });

  taskManager.addEventListener("task-updated", () => {
    updateMiniTaskCapsuleUI();
    renderConversationMessages();
    if (taskDetailsSidebar && taskDetailsSidebar.classList.contains("open")) {
      renderTaskSidebarList();
    }
  });

  const restoreTaskToFlow = (task) => {
    if (!task) return;

    if (currentView === VIEW_FLOW && taskManager.getCurrentActiveTask()?.id !== task.id) {
      archiveCurrentFlowToHistory();
    }

    if (!task.conversationId) {
      const existingConv = conversationHistoryService.conversations.find(
        (c) => c.taskId === task.id || c.id === task.id
      );
      if (existingConv) {
        task.conversationId = existingConv.id;
        if ((!Array.isArray(task.turns) || task.turns.length === 0) && Array.isArray(existingConv.turns) && existingConv.turns.length > 0) {
          task.turns = JSON.parse(JSON.stringify(existingConv.turns));
        }
      }
    }

    taskManager.setActiveTask(task.id);
    if (flowConversation) {
      flowConversation.innerHTML = "";
    }

    const turns = Array.isArray(task.turns) && task.turns.length > 0
      ? task.turns
      : [
          {
            query: task.query || task.title || "",
            attachments: task.attachments || [],
            thinkingText: task.thinkingText || "",
            thinkingDurationText: task.thinkingDurationText || "已完成思考",
            responseText: task.responseText || "",
            toolCalls: task.toolCalls || [],
            isAborted: task.status === "aborted",
            errorMessage: task.errorMessage || (task.status === "error" ? "模型调用发生异常终止" : null),
          },
        ];

    const isRunning = task.status === "thinking" || task.status === "streaming" || task.status === "tool_exec";

    turns.forEach((turn, idx) => {
      const isLast = idx === turns.length - 1;
      const isOpen = isLast && isRunning && (!turn.responseText || turn.responseText.trim().length === 0);

      const groupRefs = createFlowTurnGroupElement({
        query: turn.query || "",
        attachments: turn.attachments || [],
        thinkingText: turn.thinkingText || "",
        thinkingDurationText: turn.thinkingDurationText || "已完成思考",
        responseText: turn.responseText || "",
        toolCalls: turn.toolCalls || [],
        isOpenThinking: isOpen,
        isAborted: turn.isAborted || (!isLast && turn.responseText?.includes("刚刚会话已手动终止")),
        errorMessage: turn.errorMessage,
      });

      if (flowConversation && groupRefs?.groupEl) {
        flowConversation.appendChild(groupRefs.groupEl);
      }

      if (isLast) {
        activeTurnRefs = groupRefs;
        lastUserQuery = turn.query || "";
        lastSentAttachments = turn.attachments || [];
        currentThinkingText = turn.thinkingText || "";
        currentResponseText = turn.responseText || "";
        currentErrorMessage = turn.errorMessage || null;
        hasReceivedDelta = Boolean(turn.responseText && turn.responseText.trim().length > 0);
        hasAutoCollapsedThinking = !isOpen;

        if (isRunning && groupRefs.responseContentEl) {
          groupRefs.responseContentEl.innerHTML = renderMarkdown(turn.responseText || "") + `<span class="streaming-cursor"></span>`;
        }
      } else {
        // 历史轮次全部收起思考卡片与工具卡片
        collapseThinkingCard(groupRefs.thinkingCardEl, groupRefs.thinkingToggleBtn);
      }
    });

    if (flowModelName) {
      flowModelName.textContent = task.model || "Model";
    }

    if (flowBtnAbort) {
      if (isRunning) {
        flowBtnAbort.classList.remove("hidden");
      } else {
        flowBtnAbort.classList.add("hidden");
      }
    }

    setViewMode(VIEW_FLOW, true);

    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  const restoreConversationToFlow = (conv) => {
    if (!conv) return;

    if (currentView === VIEW_FLOW) {
      archiveCurrentFlowToHistory();
    }

    // 1. 刷新该讯息的浏览时间戳（MRU 刷新排序至第 1 位）
    conversationHistoryService.touchConversation(conv.id);

    // 2. 将该历史对话还原并绑定为 TaskManager 的当前活跃 Task，确保后续提问保留在同一个工作流
    const taskIdToUse = conv.taskId || conv.id;
    let task = taskManager.getTask(taskIdToUse);
    const turns = Array.isArray(conv.turns) && conv.turns.length > 0
      ? conv.turns
      : [
          {
            query: conv.query || conv.title || "",
            attachments: [],
            thinkingText: conv.thinkingText || "",
            thinkingDurationText: conv.thinkingDuration || "已完成思考",
            responseText: conv.responseText || "",
            toolCalls: conv.toolCalls || [],
            isAborted: conv.isAborted,
            status: "completed",
          },
        ];

    if (!task) {
      task = taskManager.createTask({
        id: taskIdToUse,
        conversationId: conv.id,
        query: conv.query || conv.title || "",
        model: conv.modelId || piClient.currentModel?.id || "default",
        isSuspended: false,
      });
    }
    task.turns = JSON.parse(JSON.stringify(turns));
    task.conversationId = conv.id;
    task.status = "completed";
    const lastTurn = turns[turns.length - 1];
    task.thinkingText = lastTurn?.thinkingText || conv.thinkingText || "";
    task.responseText = lastTurn?.responseText || conv.responseText || "";
    task.toolCalls = lastTurn?.toolCalls || conv.toolCalls || [];
    task.thinkingDurationText = lastTurn?.thinkingDurationText || conv.thinkingDuration || "已完成思考";

    taskManager.setActiveTask(task.id);

    if (flowConversation) {
      flowConversation.innerHTML = "";
    }

    turns.forEach((turn, idx) => {
      const isLast = idx === turns.length - 1;
      const groupRefs = createFlowTurnGroupElement({
        query: turn.query || "",
        attachments: turn.attachments || [],
        thinkingText: turn.thinkingText || "",
        thinkingDurationText: turn.thinkingDurationText || turn.thinkingDuration || "已完成思考",
        responseText: turn.responseText || "",
        toolCalls: turn.toolCalls || [],
        isOpenThinking: false,
        isAborted: turn.isAborted || turn.responseText?.includes("刚刚会话已手动终止"),
        errorMessage: turn.errorMessage,
      });

      if (flowConversation && groupRefs?.groupEl) {
        flowConversation.appendChild(groupRefs.groupEl);
      }

      // 历史所有轮次收起思考卡片
      collapseThinkingCard(groupRefs.thinkingCardEl, groupRefs.thinkingToggleBtn);

      if (isLast) {
        activeTurnRefs = groupRefs;
        lastUserQuery = turn.query || "";
        currentThinkingText = turn.thinkingText || "";
        currentResponseText = turn.responseText || "";
      }
    });

    if (flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
    }
    setViewMode(VIEW_FLOW, true);

    // 同步切换底层 Pi 会话
    if (conv.sessionPath) {
      sessionService.switchSession(conv.sessionPath).catch((err) => {
        console.warn("[Main] Session sync switch warning:", err);
      });
    }

    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  const archiveCurrentFlowToHistory = () => {
    const currentActive = taskManager.getCurrentActiveTask();
    const isAborted = Boolean(
      (currentActive && currentActive.status === "aborted") ||
      activeTurnRefs?.responseContentEl?.querySelector(".flow-abort-callout")
    );

    let responseTextToSave = currentResponseText;
    if (!responseTextToSave && (currentErrorMessage || activeTurnRefs?.responseContentEl?.querySelector(".sketch-error-card"))) {
      responseTextToSave = `> ⚠️ **模型调用失败**：${currentErrorMessage || "模型执行异常终止"}`;
    }

    const toolCallsSnapshot = [];
    renderedToolCards.forEach((cardEl, id) => {
      toolCallsSnapshot.push({
        id,
        html: cardEl.outerHTML,
      });
    });

    if (currentActive && Array.isArray(currentActive.turns) && currentActive.turns.length > 0) {
      const turnsToSave = currentActive.turns.map((turn, index) => {
        const isLastTurn = index === currentActive.turns.length - 1;
        if (isLastTurn) {
          return {
            ...turn,
            thinkingText: currentThinkingText || turn.thinkingText || "",
            responseText: responseTextToSave || turn.responseText || "",
            toolCalls: toolCallsSnapshot.length > 0 ? toolCallsSnapshot : (turn.toolCalls || []),
            thinkingDurationText: activeTurnRefs?.thinkingDurationEl ? activeTurnRefs.thinkingDurationEl.textContent : (turn.thinkingDurationText || "已完成思考"),
            isAborted: isAborted || turn.isAborted,
            errorMessage: currentErrorMessage || turn.errorMessage,
          };
        }
        return turn;
      });

      // 同步内存中的 turns 状态
      currentActive.turns = turnsToSave;

      const firstTurn = turnsToSave[0];
      const lastTurn = turnsToSave[turnsToSave.length - 1];
      const savedConv = conversationHistoryService.recordConversation({
        id: currentActive.conversationId || undefined,
        taskId: currentActive.id,
        query: firstTurn?.query || lastUserQuery,
        title: firstTurn?.query ? conversationHistoryService.generateSummaryTitle(firstTurn.query) : undefined,
        turns: turnsToSave,
        thinkingText: lastTurn?.thinkingText || currentThinkingText || "",
        responseText: lastTurn?.responseText || responseTextToSave || "",
        toolCalls: lastTurn?.toolCalls || toolCallsSnapshot,
        thinkingDuration: lastTurn?.thinkingDurationText || (activeTurnRefs?.thinkingDurationEl ? activeTurnRefs.thinkingDurationEl.textContent : null),
        modelId: currentActive.model || piClient.currentModel?.id || "",
        sessionPath: "",
        isAborted: turnsToSave.some((t) => t.isAborted),
      });

      if (savedConv && savedConv.id) {
        currentActive.conversationId = savedConv.id;
      }
    } else if (lastUserQuery && (responseTextToSave || currentThinkingText || isAborted)) {
      const savedConv = conversationHistoryService.recordConversation({
        id: currentActive?.conversationId || undefined,
        taskId: currentActive ? currentActive.id : undefined,
        query: lastUserQuery,
        thinkingText: currentThinkingText,
        responseText: responseTextToSave || "",
        toolCalls: toolCallsSnapshot,
        thinkingDuration: activeTurnRefs?.thinkingDurationEl ? activeTurnRefs.thinkingDurationEl.textContent : null,
        modelId: piClient.currentModel?.id || "",
        sessionPath: "",
        isAborted,
      });

      if (savedConv && savedConv.id && currentActive) {
        currentActive.conversationId = savedConv.id;
      }
    }
  };

  const renderConversationMessages = () => {
    if (!sketchMessagesDrawer || !messagesPrimaryRow || !messagesExpandedGrid) return;

    const conversations = conversationHistoryService.getVisibleConversations() || [];

    if (conversations.length === 0) {
      sketchMessagesDrawer.classList.add("hidden");
      messagesPrimaryRow.innerHTML = "";
      messagesExpandedGrid.innerHTML = "";
      return;
    }

    sketchMessagesDrawer.classList.remove("hidden");
    messagesPrimaryRow.innerHTML = "";
    messagesExpandedGrid.innerHTML = "";

    // 第 1 行：前 3 个项目
    const primaryItems = conversations.slice(0, 3);
    // 下方展开区域：第 4 个及之后的项目（下方每行 4 个）
    const expandedItems = conversations.slice(3);

    const createMessageCard = (conv) => {
      const card = document.createElement("div");
      card.className = "sketch-message-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.dataset.id = conv.id;

      const timeStr = formatRelativeTime(conv.lastViewedAt || conv.createdAt);

      card.innerHTML = `
        <button type="button" class="message-card-close-btn" title="不在列表中显示" aria-label="隐藏讯息">
          ${ICONS.close}
        </button>
        <div class="message-card-title" title="${escapeHtml(conv.query || conv.title)}">${escapeHtml(conv.title || conv.query)}</div>
        <div class="message-card-meta">
          <span class="message-card-time">${escapeHtml(timeStr)}</span>
        </div>
      `;

      // 绑定点击卡片恢复对话事件
      card.addEventListener("click", (e) => {
        if (e.target.closest(".message-card-close-btn")) return;
        restoreConversationToFlow(conv);
      });

      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (!e.target.closest(".message-card-close-btn")) {
            e.preventDefault();
            restoreConversationToFlow(conv);
          }
        }
      });

      // 绑定关闭 "×" 按钮事件 (仅在 UI 中隐藏，不删除底层数据)
      const closeBtn = card.querySelector(".message-card-close-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          card.classList.add("removing");
          setTimeout(() => {
            conversationHistoryService.hideConversation(conv.id);
          }, 160);
        });
      }

      return card;
    };

    primaryItems.forEach((conv) => {
      messagesPrimaryRow.appendChild(createMessageCard(conv));
    });

    // 下方展开区域：每 4 个切分为一行，每行渐出耗时 1 秒，前一行完全显现后下一行再启动渐出 (--row-delay: 0s, 1s, 2s...)
    const rowChunkSize = 4;
    for (let i = 0; i < expandedItems.length; i += rowChunkSize) {
      const chunk = expandedItems.slice(i, i + rowChunkSize);
      const rowIndex = Math.floor(i / rowChunkSize); // 0: 第2行(0s~1s), 1: 第3行(1s~2s), 2: 第4行(2s~3s)...
      const rowEl = document.createElement("div");
      rowEl.className = "messages-expanded-row";
      rowEl.dataset.rowIndex = String(rowIndex);
      rowEl.style.setProperty("--row-delay", `${rowIndex * 1}s`);

      chunk.forEach((conv) => {
        rowEl.appendChild(createMessageCard(conv));
      });

      messagesExpandedGrid.appendChild(rowEl);
    }
  };

  conversationHistoryService.addEventListener("conversations-change", () => {
    renderConversationMessages();
  });

  // --------------------------------------------------------------------------
  // 纯 CSS 硬件加速过渡：历史讯息抽屉展开/收起
  // 级联渐出（各行延迟1秒渐出）与移出平滑渐隐（2秒）完全由 GPU 合成器处理，彻底消除闪烁
  // --------------------------------------------------------------------------
  if (sketchMessagesDrawer) {
    sketchMessagesDrawer.addEventListener("mouseenter", () => {
      sketchMessagesDrawer.classList.add("is-hovered");
    });

    sketchMessagesDrawer.addEventListener("mouseleave", () => {
      sketchMessagesDrawer.classList.remove("is-hovered");
    });
  }

  // 初始渲染讯息方框
  renderConversationMessages();

  // ==========================================================================
  // 输入框文件拖入、手绘概述胶囊与多模态文件注入引擎
  // ==========================================================================
  let attachedFiles = [];
  let lastSentAttachments = [];

  const getFileCategoryIcon = (category) => {
    if (category === "image") return ICONS.image;
    if (category === "code") return ICONS.code;
    return ICONS.document;
  };

  const renderAttachedCapsules = () => {
    if (!attachedCapsulesContainer) return;
    attachedCapsulesContainer.innerHTML = "";

    if (attachedFiles.length === 0) {
      searchInputWrapper?.classList.remove("has-capsules");
      updateInputState();
      return;
    }

    searchInputWrapper?.classList.add("has-capsules");

    attachedFiles.forEach((file, index) => {
      const capsule = document.createElement("div");
      capsule.className = "sketch-file-capsule";
      capsule.title = file.path || file.name;
      capsule.innerHTML = `
        <span class="capsule-file-icon">${getFileCategoryIcon(file.category)}</span>
        <span class="capsule-file-name">${escapeHtml(file.name)}</span>
        <button type="button" class="capsule-remove-btn" aria-label="移除 ${escapeHtml(file.name)}" title="移除文件">
          ${ICONS.close}
        </button>
      `;

      const removeBtn = capsule.querySelector(".capsule-remove-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeAttachedFile(index);
        });
      }

      attachedCapsulesContainer.appendChild(capsule);
    });

    updateInputState();
  };

  const addAttachedFiles = async (paths) => {
    if (!Array.isArray(paths) || paths.length === 0) return;

    for (const rawPath of paths) {
      if (typeof rawPath !== "string" || !rawPath.trim()) continue;
      const path = rawPath.trim();
      if (attachedFiles.some((f) => f.path === path)) continue;

      try {
        const fileMeta = await invokeTauri("pi_inspect_file", { path });
        if (fileMeta) {
          attachedFiles.push(fileMeta);
        }
      } catch (_) {
        const normalized = path.replace(/\\/g, "/");
        const name = normalized.split("/").pop() || "file";
        const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
        const codeExts = ["js", "jsx", "ts", "tsx", "rs", "py", "go", "java", "c", "cpp", "json", "yaml", "yml", "html", "css", "md", "sql", "sh"];
        let category = "document";
        if (imageExts.includes(ext)) category = "image";
        else if (codeExts.includes(ext)) category = "code";

        attachedFiles.push({
          path,
          name,
          ext,
          category,
          size: 0,
          is_text: category !== "image",
        });
      }
    }

    renderAttachedCapsules();
    if (searchInput) searchInput.focus();
  };

  const removeAttachedFile = (index) => {
    if (index >= 0 && index < attachedFiles.length) {
      attachedFiles.splice(index, 1);
      renderAttachedCapsules();
    }
  };

  const clearAttachedFiles = () => {
    attachedFiles = [];
    renderAttachedCapsules();
  };

  // 绑定 Tauri 文件拖拽广播事件
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen("file-drop-paths", (event) => {
      const paths = event.payload;
      if (Array.isArray(paths) && paths.length > 0) {
        addAttachedFiles(paths);
      }
      searchForm?.classList.remove("drag-over", "drag-active");
    });

    window.__TAURI__.event.listen("file-drag-enter", () => {
      searchForm?.classList.add("drag-over");
    });

    window.__TAURI__.event.listen("file-drag-leave", () => {
      searchForm?.classList.remove("drag-over", "drag-active");
    });
  }

  // 绑定原生 DOM Drag & Drop 视觉高亮与防止误跳转
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    searchForm?.classList.add("drag-over");
  });

  window.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) {
      searchForm?.classList.remove("drag-over", "drag-active");
    }
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    searchForm?.classList.remove("drag-over", "drag-active");
  });

  // 点击导入图标唤起文件选择
  if (searchIconBox && filePickerInput) {
    searchIconBox.addEventListener("click", (e) => {
      e.preventDefault();
      filePickerInput.value = "";
      filePickerInput.click();
    });

    searchIconBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        filePickerInput.value = "";
        filePickerInput.click();
      }
    });

    filePickerInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        const paths = files.map((f) => f.path || f.name);
        addAttachedFiles(paths);
      }
    });
  }

  const MAX_INPUT_LINES = 16;
  const INPUT_LINE_HEIGHT = 24;
  const MAX_INPUT_HEIGHT = MAX_INPUT_LINES * INPUT_LINE_HEIGHT; // 384px

  // 输入框多行内容高度自适应（换行自动增加高度，最多容纳16行，超出显示极简滚动条）
  const autoResizeSearchInput = () => {
    if (!searchInput) return;
    searchInput.style.height = "24px";
    const scrollHeight = searchInput.scrollHeight;
    const targetHeight = Math.min(Math.max(scrollHeight, 24), MAX_INPUT_HEIGHT);
    searchInput.style.height = `${targetHeight}px`;
  };

  // 控制清空按钮显隐与格言跑马灯层可见性
  const updateInputState = () => {
    if (!searchInput) return;
    const hasText = searchInput.value.length > 0;
    const hasCapsules = attachedFiles.length > 0;

    if (hasText || hasCapsules) {
      clearBtn?.classList.add("visible");
    } else {
      clearBtn?.classList.remove("visible");
    }

    if (hasText) {
      searchInputWrapper?.classList.add("has-value");
    } else {
      searchInputWrapper?.classList.remove("has-value");
    }
  };

  searchInput.addEventListener("input", () => {
    updateInputState();
    autoResizeSearchInput();
  });

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearAttachedFiles();
    promptHistoryNavigator.resetIndex();
    updateInputState();
    autoResizeSearchInput();
    searchInput.focus();
  });

  const applyNavigatedValue = (val) => {
    searchInput.value = val;
    searchInput.setSelectionRange(val.length, val.length);
    updateInputState();
    autoResizeSearchInput();
  };

  searchInput.addEventListener("keydown", (e) => {
    const sendMode = configService.getSendShortcut();

    if (e.key === "Enter") {
      // 避免中文拼音输入法选词上屏时误触发
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      if (sendMode === "enter") {
        // 发送逻辑 A：Enter 发送，Ctrl+Enter / Shift+Enter 换行
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          submitCurrentPrompt();
        } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          const start = searchInput.selectionStart;
          const end = searchInput.selectionEnd;
          const val = searchInput.value;
          searchInput.value = val.substring(0, start) + "\n" + val.substring(end);
          searchInput.selectionStart = searchInput.selectionEnd = start + 1;
          updateInputState();
          autoResizeSearchInput();
        }
      } else {
        // 发送逻辑 B：Ctrl+Enter 发送，Enter 换行
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          submitCurrentPrompt();
        } else {
          // Enter 换行：textarea 原生插入换行，延时刷新高度与输入状态
          setTimeout(() => {
            updateInputState();
            autoResizeSearchInput();
          }, 0);
        }
      }
      return;
    }

    if (e.key === "Escape") {
      if (searchInput.value.length > 0 || attachedFiles.length > 0) {
        searchInput.value = "";
        clearAttachedFiles();
        promptHistoryNavigator.resetIndex();
        updateInputState();
        autoResizeSearchInput();
      } else {
        searchInput.blur();
      }
    } else if (e.key === "ArrowUp") {
      const isCaretAtStart = searchInput.selectionStart === 0 && searchInput.selectionEnd === 0;
      const isEmpty = searchInput.value.length === 0;
      const isAllSelected = searchInput.selectionStart === 0 && searchInput.selectionEnd === searchInput.value.length;

      if (isEmpty || isCaretAtStart || isAllSelected || promptHistoryNavigator.isNavigating) {
        const res = promptHistoryNavigator.getPrevious(searchInput.value);
        if (res.changed) {
          e.preventDefault();
          applyNavigatedValue(res.value);
        }
      }
    } else if (e.key === "ArrowDown") {
      if (promptHistoryNavigator.isNavigating) {
        const res = promptHistoryNavigator.getNext(searchInput.value);
        if (res.changed) {
          e.preventDefault();
          applyNavigatedValue(res.value);
        }
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

  // 启动边框图标飘荡特效（仅在 detailed / focus 模式下活跃）
  startFloatingIcons(appContainer);

  // 视图切换时暂停/恢复飘荡特效
  window.addEventListener("pi:view-change", (e) => {
    const mode = e.detail?.mode;
    if (mode === "flow" || mode === "settings") {
      stopFloatingIcons();
    } else {
      startFloatingIcons(appContainer);
    }
  });

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

  // ==========================================================================
  // 8. 扩展组件管理与 Package Catalog 市场 (Installed & Catalog Market)
  // ==========================================================================
  const installedPackagesWrapper = document.getElementById("installed-packages-wrapper");
  const installedSectionToggle = document.getElementById("installed-section-toggle");
  const installedPackagesCount = document.getElementById("installed-packages-count");
  const installedPackagesList = document.getElementById("installed-packages-list");
  const btnInstallRecommendedPackages = document.getElementById("btn-install-recommended-packages");
  const btnUpdateAllPackages = document.getElementById("btn-update-all-packages");
  const btnCheckAllPackageUpdates = document.getElementById("btn-check-all-package-updates");

  const packagesSearchInput = document.getElementById("packages-search-input");
  const btnClearPackageSearch = document.getElementById("btn-clear-package-search");
  const packagesTypeSelect = document.getElementById("packages-type-select");
  const packagesSortSelect = document.getElementById("packages-sort-select");
  const btnSearchPackages = document.getElementById("btn-search-packages");

  const packagesTotalInfo = document.getElementById("packages-total-info");
  const packagesCatalogGrid = document.getElementById("packages-catalog-grid");
  const packagesPagination = document.getElementById("packages-pagination");
  const btnPackagesPrevPage = document.getElementById("btn-packages-prev-page");
  const btnPackagesNextPage = document.getElementById("btn-packages-next-page");
  const packagesPageIndicator = document.getElementById("packages-page-indicator");

  const packageProgressFloatCard = document.getElementById("package-progress-float-card");
  const packageProgressTitle = document.getElementById("package-progress-title");
  const packageProgressPkgName = document.getElementById("package-progress-pkg-name");
  const packageProgressPercent = document.getElementById("package-progress-percent");
  const packageProgressFill = document.getElementById("package-progress-fill");
  const packageProgressMessage = document.getElementById("package-progress-message");
  const packageQueueBadge = document.getElementById("package-queue-badge");
  const btnClosePackageProgress = document.getElementById("btn-close-package-progress");

  let installedPackages = [];
  let recommendedPlugins = [];
  let packageUpdatesMap = new Map(); // packageName -> { latestVersion, hasUpdate }
  let packageOperationMap = new Map(); // packageName -> 'installing' | 'uninstalling' | 'updating'
  let packageProgressMap = new Map(); // packageName -> { stage, percent, message }
  let packageSteppersMap = new Map(); // packageName.toLowerCase() -> ProgressStepper

  // 扩展任务队列：FIFO 顺序执行安装、更新与卸载，保证互斥不冲突
  let packageTaskQueue = []; // Array<{ id: string, packageName: string, action: 'install' | 'uninstall' | 'update' }>
  let currentRunningTask = null;
  let isProcessingQueue = false;

  let currentCatalogPage = 1;
  let currentCatalogResult = null;
  let hasLoadedCatalogOnce = false;
  let floatCardDismissTimer = null;

  // 队列状态查询辅助函数
  const isPackageRunning = (pkgName) => {
    return (
      currentRunningTask !== null &&
      currentRunningTask.packageName.toLowerCase() === pkgName.toLowerCase()
    );
  };

  const getPackageQueueIndex = (pkgName) => {
    return packageTaskQueue.findIndex(
      (t) => t.packageName.toLowerCase() === pkgName.toLowerCase()
    );
  };

  const getQueuedPackageTask = (pkgName) => {
    return packageTaskQueue.find(
      (t) => t.packageName.toLowerCase() === pkgName.toLowerCase()
    );
  };

  const isPackageInQueue = (pkgName) => {
    return getPackageQueueIndex(pkgName) !== -1;
  };

  const isPackageBusy = (pkgName) => {
    return isPackageRunning(pkgName) || isPackageInQueue(pkgName);
  };

  // 实时更新队列提示徽章
  const updateQueueBadge = () => {
    if (!packageQueueBadge) return;
    if (packageTaskQueue.length > 0) {
      packageQueueBadge.textContent = `队列待执行: ${packageTaskQueue.length}`;
      packageQueueBadge.classList.remove("hidden");
    } else {
      packageQueueBadge.classList.add("hidden");
    }
  };

  // 统一刷新已安装组件列表与扩展市场卡片视图
  const refreshPackageViews = () => {
    renderInstalledPackages();
    updateRecommendedButtonVisibility();
    updateBatchUpdateButtonVisibility();
    if (currentCatalogResult?.packages) {
      renderCatalogGrid(currentCatalogResult.packages);
    }
  };

  if (btnClosePackageProgress && packageProgressFloatCard) {
    btnClosePackageProgress.addEventListener("click", () => {
      if (floatCardDismissTimer) clearTimeout(floatCardDismissTimer);
      packageProgressFloatCard.classList.add("hidden");
      packageProgressFloatCard.classList.remove("fade-out");
    });
  }

  // 获取各组件操作的阶段里程碑
  const getPackageMilestones = (stage, action) => {
    if (stage === "uninstalling" || stage === "uninstalled" || action === "uninstall") {
      return [0, 30, 100];
    }
    if (stage === "updating" || action === "update") {
      return [0, 5, 10, 15, 35, 55, 75, 90, 100];
    }
    return [0, 5, 15, 35, 55, 75, 90, 100];
  };

  // 获取或创建单个组件的平滑步进器
  const getOrCreatePackageStepper = (packageName, stage, action) => {
    const key = (packageName || "").toLowerCase();
    let stepper = packageSteppersMap.get(key);
    const milestones = getPackageMilestones(stage, action);
    if (!stepper) {
      stepper = new ProgressStepper({
        milestones,
        intervalMs: 2000,
        onUpdate: (currentPercent, payload) => {
          applyPackageProgressToUI(
            payload?.packageName || packageName,
            payload?.stage || stage,
            currentPercent,
            payload?.message || ""
          );
        },
      });
      packageSteppersMap.set(key, stepper);
    } else {
      stepper.setMilestones(milestones);
    }
    return stepper;
  };

  // 应用进度变化到 UI (浮动卡片 + 已安装列表与市场卡片局部/全局同步)
  const applyPackageProgressToUI = (packageName, stage, percent, message) => {
    if (!packageName) return;
    const cleanPercent = Math.min(100, Math.max(0, Number(percent) || 0));

    packageProgressMap.set(packageName, {
      stage,
      percent: cleanPercent,
      message: message || "",
    });

    if (packageProgressFloatCard) {
      if (floatCardDismissTimer) clearTimeout(floatCardDismissTimer);
      packageProgressFloatCard.classList.remove("hidden", "fade-out");

      if (packageProgressTitle) {
        if (stage === "uninstalling" || stage === "uninstalled") {
          packageProgressTitle.textContent = "正在卸载";
        } else if (stage === "updating") {
          packageProgressTitle.textContent = "正在更新";
        } else {
          packageProgressTitle.textContent = "正在安装";
        }
      }

      if (packageProgressPkgName) packageProgressPkgName.textContent = packageName;
      if (packageProgressPercent) packageProgressPercent.textContent = `${cleanPercent}%`;
      if (packageProgressFill) packageProgressFill.style.width = `${cleanPercent}%`;
      if (packageProgressMessage) packageProgressMessage.textContent = message || "";

      // 实时更新队列提示徽章
      updateQueueBadge();

      // 当单项任务结束且队列为空时，平滑渐隐
      if (
        (stage === "completed" || stage === "uninstalled" || stage === "error") &&
        packageTaskQueue.length === 0
      ) {
        floatCardDismissTimer = setTimeout(() => {
          packageProgressFloatCard.classList.add("fade-out");
          setTimeout(() => {
            packageProgressFloatCard.classList.add("hidden");
            packageProgressFloatCard.classList.remove("fade-out");
          }, 350);
        }, 1800);
      }
    }

    // 局部同步已安装列表与卡片中的进度条与百分比（极速无重绘）
    let updatedInList = false;
    let updatedInGrid = false;

    if (installedPackagesList) {
      const activeInstalledItem = installedPackagesList.querySelector(
        `[data-package="${escapeCss(packageName)}"]`
      );
      if (activeInstalledItem) {
        const pctEl = activeInstalledItem.querySelector(".card-progress-pct");
        const fillEl = activeInstalledItem.querySelector(".sketch-progress-fill");
        const msgEl = activeInstalledItem.querySelector(".card-progress-msg");
        if (pctEl && fillEl) {
          pctEl.textContent = `${cleanPercent}%`;
          fillEl.style.width = `${cleanPercent}%`;
          if (msgEl && message) {
            msgEl.textContent = message;
            msgEl.title = message;
          }
          updatedInList = true;
        }
      }
    }

    if (packagesCatalogGrid) {
      const activeCard = packagesCatalogGrid.querySelector(
        `[data-package="${escapeCss(packageName)}"]`
      );
      if (activeCard) {
        const pctEl = activeCard.querySelector(".card-progress-pct");
        const fillEl = activeCard.querySelector(".sketch-progress-fill");
        const msgEl = activeCard.querySelector(".card-progress-msg");
        if (pctEl && fillEl) {
          pctEl.textContent = `${cleanPercent}%`;
          fillEl.style.width = `${cleanPercent}%`;
          if (msgEl && message) {
            msgEl.textContent = message;
            msgEl.title = message;
          }
          updatedInGrid = true;
        }
      }
    }

    // 若 DOM 尚未挂载进度条结构（如刚由常态按钮进入运行态），全量渲染一次挂载结构
    if (!updatedInList) {
      renderInstalledPackages();
    }
    if (!updatedInGrid && currentCatalogResult?.packages) {
      renderCatalogGrid(currentCatalogResult.packages);
    }
  };

  // 更新进度条 UI (接入平滑步进引擎)
  const updatePackageProgressUI = (payload) => {
    if (!payload || !payload.packageName) return;
    const { packageName, stage, percent, message } = payload;
    const cleanPercent = Math.min(100, Math.max(0, Number(percent) || 0));

    const stepper = getOrCreatePackageStepper(
      packageName,
      stage,
      packageOperationMap.get(packageName)
    );

    if (stage === "completed" || stage === "uninstalled" || stage === "error") {
      stepper.stopTimer();
      stepper.step(cleanPercent, { packageName, stage, message });
      packageSteppersMap.delete(packageName.toLowerCase());
    } else {
      // 阶段触发：立即跳至 cleanPercent，并在等待期间每 2s 步进 +1% 直到下个阶段 - 1%
      stepper.step(cleanPercent, { packageName, stage, message });
    }
  };

  // 监听 Tauri 派发的 package-progress 事件
  if (window.__TAURI__?.event?.listen) {
    try {
      window.__TAURI__.event.listen("package-progress", (event) => {
        if (event.payload) {
          updatePackageProgressUI(event.payload);
        }
      });
    } catch (e) {
      console.warn("[PackageManager] Failed to register package-progress listener:", e);
    }
  }

  // 折叠/展开已安装列表
  if (installedSectionToggle && installedPackagesWrapper) {
    installedSectionToggle.addEventListener("click", () => {
      const isCollapsed = installedPackagesWrapper.classList.toggle("collapsed");
      installedSectionToggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    });
  }

  // 动态更新“安装推荐插件”按钮可见性（若全部推荐插件均已安装，则自动隐藏）
  const updateRecommendedButtonVisibility = () => {
    if (!btnInstallRecommendedPackages) return;
    if (!recommendedPlugins || recommendedPlugins.length === 0) {
      btnInstallRecommendedPackages.classList.add("hidden");
      return;
    }

    const uninstalled = recommendedPlugins.filter(
      (p) => !isPackageInstalled(p.name)
    );

    if (uninstalled.length === 0) {
      btnInstallRecommendedPackages.classList.add("hidden");
    } else {
      btnInstallRecommendedPackages.classList.remove("hidden");
      btnInstallRecommendedPackages.title = `一键队列安装推荐扩展插件 (待安装 ${uninstalled.length} 个)`;
    }
  };

  // 动态更新“一键全部更新”按钮可见性（检测到 >= 2 个组件有可用更新时显现）
  const updateBatchUpdateButtonVisibility = () => {
    if (!btnUpdateAllPackages) return;

    const updatablePkgs = installedPackages.filter((pkg) => {
      const updateInfo = packageUpdatesMap.get(pkg.name);
      return updateInfo && updateInfo.hasUpdate;
    });

    if (updatablePkgs.length >= 2) {
      btnUpdateAllPackages.classList.remove("hidden");
      const pendingUpdates = updatablePkgs.filter((pkg) => !isPackageBusy(pkg.name));
      if (pendingUpdates.length > 0) {
        btnUpdateAllPackages.disabled = false;
        btnUpdateAllPackages.title = `一键将 ${updatablePkgs.length} 个有可用更新的组件加入队列自动按序升级`;
      } else {
        btnUpdateAllPackages.disabled = true;
        btnUpdateAllPackages.title = "所有待更新组件已在队列中或正在执行";
      }
    } else {
      btnUpdateAllPackages.classList.add("hidden");
    }
  };

  // 加载内嵌推荐插件列表
  const loadRecommendedPlugins = async () => {
    try {
      const list = await configService.getRecommendedPlugins();
      recommendedPlugins = Array.isArray(list) ? list : [];
      updateRecommendedButtonVisibility();
    } catch (err) {
      console.warn("[PackageManager] Failed to load recommended plugins:", err);
    }
  };

  // 加载已安装组件
  const loadInstalledPackages = async () => {
    try {
      const list = await configService.getInstalledPackages();
      installedPackages = Array.isArray(list) ? list : [];
      if (installedPackagesCount) {
        installedPackagesCount.textContent = installedPackages.length.toString();
      }
      renderInstalledPackages();
      updateRecommendedButtonVisibility();
      updateBatchUpdateButtonVisibility();
      if (currentCatalogResult && currentCatalogResult.packages) {
        renderCatalogGrid(currentCatalogResult.packages);
      }
    } catch (err) {
      console.warn("[PackageManager] Failed to load installed packages:", err);
    }
  };

  // 渲染已安装组件列表
  const renderInstalledPackages = () => {
    if (!installedPackagesList) return;

    if (!installedPackages || installedPackages.length === 0) {
      installedPackagesList.innerHTML = `<div class="packages-empty-hint">暂未安装任何扩展组件。可在下方市场中搜索并一键安装。</div>`;
      return;
    }

    installedPackagesList.innerHTML = "";
    installedPackages.forEach((pkg) => {
      const item = document.createElement("div");
      item.className = "installed-package-item";
      item.dataset.package = pkg.name;

      const updateInfo = packageUpdatesMap.get(pkg.name);
      const isRunning = isPackageRunning(pkg.name);
      const isQueued = isPackageInQueue(pkg.name);
      const progress = packageProgressMap.get(pkg.name);

      const verBadgeClass = updateInfo?.hasUpdate ? "installed-pkg-ver update-available" : "installed-pkg-ver";
      const verText = updateInfo?.hasUpdate
        ? `v${pkg.version} → v${updateInfo.latestVersion}`
        : `v${pkg.version}`;

      let actionsHtml = "";
      if (isRunning && progress) {
        actionsHtml = `
          <div class="card-progress-wrap" style="min-width: 140px;">
            <div class="card-progress-labels">
              <span class="card-progress-msg" title="${escapeHtml(progress.message)}">${escapeHtml(progress.message)}</span>
              <span class="card-progress-pct">${progress.percent}%</span>
            </div>
            <div class="sketch-progress-track">
              <div class="sketch-progress-fill" style="width: ${progress.percent}%;"></div>
            </div>
          </div>
        `;
      } else if (isQueued) {
        const queuePos = getPackageQueueIndex(pkg.name) + 1;
        const queuedTask = getQueuedPackageTask(pkg.name);
        const taskAction = queuedTask ? queuedTask.action : "uninstall";
        let queueText = `排队中 (#${queuePos})`;
        let queueTitle = "点击取消排队";
        let queueClass = "flat-btn flat-btn-secondary mini btn-queue-cancel";
        if (taskAction === "update") {
          queueText = `更新排队中 (#${queuePos})`;
          queueTitle = "点击取消更新排队";
          queueClass += " update-queued";
        } else if (taskAction === "uninstall") {
          queueText = `卸载排队中 (#${queuePos})`;
          queueTitle = "点击取消卸载排队";
          queueClass += " uninstall-queued";
        } else if (taskAction === "install") {
          queueText = `安装排队中 (#${queuePos})`;
          queueTitle = "点击取消安装排队";
        }
        actionsHtml = `
          <button type="button" class="${queueClass}" data-name="${escapeHtml(pkg.name)}" title="${queueTitle}">
            <span class="thinking-dot"></span> ${escapeHtml(queueText)}
          </button>
        `;
      } else {
        const hasUnappliedPreset = pkg.hasPreset && !pkg.isPresetApplied;
        actionsHtml = `
          ${
            hasUnappliedPreset
              ? `<button type="button" class="flat-btn flat-btn-secondary mini btn-preset-pkg" data-name="${escapeHtml(pkg.name)}" title="应用推荐配置：${escapeHtml(pkg.presetTitle || '推荐配置')}">
                   推荐配置
                 </button>`
              : ""
          }
          ${
            updateInfo?.hasUpdate
              ? `<button type="button" class="flat-btn flat-btn-primary mini btn-update-pkg" data-name="${escapeHtml(pkg.name)}">
                   更新
                 </button>`
              : ""
          }
          <button type="button" class="flat-btn flat-btn-secondary mini btn-uninstall-pkg" data-name="${escapeHtml(pkg.name)}" title="卸载组件" aria-label="卸载组件">
            卸载
          </button>
        `;
      }

      item.innerHTML = `
        <div class="installed-pkg-info">
          <div class="installed-pkg-header">
            <span class="installed-pkg-name">${escapeHtml(pkg.name)}</span>
            <span class="${verBadgeClass}">${escapeHtml(verText)}</span>
          </div>
          ${pkg.description ? `<p class="installed-pkg-desc">${escapeHtml(pkg.description)}</p>` : ""}
        </div>
        <div class="installed-pkg-actions">
          ${actionsHtml}
        </div>
      `;

      // 绑定应用推荐配置
      const btnPreset = item.querySelector(".btn-preset-pkg");
      if (btnPreset) {
        btnPreset.addEventListener("click", (e) => {
          e.stopPropagation();
          handleApplyPackagePreset(pkg.name, btnPreset);
        });
      }

      // 绑定卸载
      const btnUninstall = item.querySelector(".btn-uninstall-pkg");
      if (btnUninstall) {
        btnUninstall.addEventListener("click", (e) => {
          e.stopPropagation();
          handleUninstallPackage(pkg.name);
        });
      }

      // 绑定更新
      const btnUpdate = item.querySelector(".btn-update-pkg");
      if (btnUpdate) {
        btnUpdate.addEventListener("click", (e) => {
          e.stopPropagation();
          handleUpdatePackage(pkg.name);
        });
      }

      // 绑定取消排队
      const btnCancel = item.querySelector(".btn-queue-cancel");
      if (btnCancel) {
        btnCancel.addEventListener("click", (e) => {
          e.stopPropagation();
          cancelQueuedPackageTask(pkg.name);
        });
      }

      installedPackagesList.appendChild(item);
    });
  };

  // 加载官网组件市场
  const loadCatalogPackages = async (page = 1) => {
    if (!packagesCatalogGrid) return;
    currentCatalogPage = page;

    if (packagesTotalInfo) {
      packagesTotalInfo.textContent = "正在从 pi.dev 获取官方组件目录...";
    }

    packagesCatalogGrid.innerHTML = `
      <div class="packages-empty-hint" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span class="thinking-dot"></span>
        <span>加载官方组件目录中...</span>
      </div>
    `;

    try {
      const query = packagesSearchInput?.value?.trim() || "";
      const pkgType = packagesTypeSelect?.value || "";
      const sort = packagesSortSelect?.value || "downloads";

      const res = await configService.searchPackages(query, pkgType, sort, page);
      if (!res || !Array.isArray(res.packages)) {
        if (packagesTotalInfo) {
          packagesTotalInfo.textContent = "未能获取官方组件数据";
        }
        packagesCatalogGrid.innerHTML = `<div class="packages-empty-hint">未能获取到官方组件数据，请检查网络连接后重试</div>`;
        return;
      }

      currentCatalogResult = res;
      hasLoadedCatalogOnce = true;

      if (packagesTotalInfo) {
        if (res.totalCount === 0) {
          packagesTotalInfo.textContent = "未找到符合条件的组件";
        } else {
          packagesTotalInfo.textContent = `共找到 ${res.totalCount} 个组件 (第 ${res.page} / ${res.totalPages} 页)`;
        }
      }

      renderCatalogGrid(res.packages);

      // 分页器处理
      if (packagesPagination) {
        if (res.totalPages > 1) {
          packagesPagination.classList.remove("hidden");
          if (packagesPageIndicator) {
            packagesPageIndicator.textContent = `第 ${res.page} / ${res.totalPages} 页`;
          }
          if (btnPackagesPrevPage) {
            btnPackagesPrevPage.disabled = res.page <= 1;
          }
          if (btnPackagesNextPage) {
            btnPackagesNextPage.disabled = !res.hasMore;
          }
        } else {
          packagesPagination.classList.add("hidden");
        }
      }
    } catch (err) {
      console.error("[PackageManager] Failed to search catalog:", err);
      if (packagesTotalInfo) {
        packagesTotalInfo.textContent = "组件目录加载失败";
      }
      packagesCatalogGrid.innerHTML = `
        <div class="packages-empty-hint" style="color: #ef4444;">
          获取官方组件失败：${escapeHtml(err?.toString() || "网络错误")}
        </div>
      `;
    }
  };

  // 检查某个包是否已安装
  const isPackageInstalled = (pkgName) => {
    const cleanName = pkgName.toLowerCase().replace(/^npm:/, "");
    return installedPackages.some(
      (p) => p.name.toLowerCase() === cleanName || p.name.toLowerCase() === `npm:${cleanName}`
    );
  };

  // 渲染市场卡片网格
  const renderCatalogGrid = (packages) => {
    if (!packagesCatalogGrid) return;

    if (!packages || packages.length === 0) {
      packagesCatalogGrid.innerHTML = `<div class="packages-empty-hint">暂无匹配的组件，请尝试更换关键词或类型筛选</div>`;
      return;
    }

    packagesCatalogGrid.innerHTML = "";

    packages.forEach((pkg) => {
      const card = document.createElement("article");
      card.className = "package-card";
      card.dataset.package = pkg.name;

      const isInstalled = isPackageInstalled(pkg.name);
      const isRunning = isPackageRunning(pkg.name);
      const isQueued = isPackageInQueue(pkg.name);
      const updateInfo = packageUpdatesMap.get(pkg.name);
      const progress = packageProgressMap.get(pkg.name);

      let actionBtnHtml = "";
      if (isRunning && progress) {
        actionBtnHtml = `
          <div class="card-progress-wrap" style="min-width: 140px;">
            <div class="card-progress-labels">
              <span class="card-progress-msg" title="${escapeHtml(progress.message)}">${escapeHtml(progress.message)}</span>
              <span class="card-progress-pct">${progress.percent}%</span>
            </div>
            <div class="sketch-progress-track">
              <div class="sketch-progress-fill" style="width: ${progress.percent}%;"></div>
            </div>
          </div>
        `;
      } else if (isQueued) {
        const queuePos = getPackageQueueIndex(pkg.name) + 1;
        const queuedTask = getQueuedPackageTask(pkg.name);
        const taskAction = queuedTask ? queuedTask.action : "install";
        let queueText = `排队中 (#${queuePos})`;
        let queueTitle = "点击取消排队";
        let queueClass = "flat-btn flat-btn-secondary mini btn-queue-cancel";
        if (taskAction === "update") {
          queueText = `更新排队中 (#${queuePos})`;
          queueTitle = "点击取消更新排队";
          queueClass += " update-queued";
        } else if (taskAction === "uninstall") {
          queueText = `卸载排队中 (#${queuePos})`;
          queueTitle = "点击取消卸载排队";
          queueClass += " uninstall-queued";
        } else if (taskAction === "install") {
          queueText = `安装排队中 (#${queuePos})`;
          queueTitle = "点击取消安装排队";
        }
        actionBtnHtml = `<button type="button" class="${queueClass}" data-name="${escapeHtml(pkg.name)}" title="${queueTitle}"><span class="thinking-dot"></span> ${escapeHtml(queueText)}</button>`;
      } else if (isInstalled && updateInfo?.hasUpdate) {
        actionBtnHtml = `<button type="button" class="flat-btn flat-btn-primary mini package-card-btn-action btn-catalog-update" data-name="${escapeHtml(pkg.name)}">更新到 v${escapeHtml(updateInfo.latestVersion)}</button>`;
      } else if (isInstalled) {
        actionBtnHtml = `<button type="button" class="flat-btn flat-btn-secondary mini package-card-btn-action" disabled style="opacity: 0.6; display: inline-flex; align-items: center; gap: 4px;"><span class="btn-icon">${ICONS.check}</span> 已安装</button>`;
      } else {
        actionBtnHtml = `<button type="button" class="flat-btn flat-btn-primary mini package-card-btn-action btn-catalog-install" data-name="${escapeHtml(pkg.name)}">+ 一键安装</button>`;
      }

      const linksHtml = [];
      if (pkg.npmUrl) {
        linksHtml.push(`<a href="${escapeHtml(pkg.npmUrl)}" target="_blank" rel="noreferrer" class="package-link-icon" title="在 npm 查看">npm</a>`);
      }
      if (pkg.repoUrl) {
        linksHtml.push(`<a href="${escapeHtml(pkg.repoUrl)}" target="_blank" rel="noreferrer" class="package-link-icon" title="查看源码仓库">repo</a>`);
      }

      card.innerHTML = `
        <div class="package-card-top">
          <div class="package-card-header">
            <h4 class="package-card-name">${escapeHtml(pkg.name)}</h4>
            <span class="package-type-badge" data-type="${escapeHtml(pkg.pkgType)}">${escapeHtml(pkg.pkgType)}</span>
          </div>
          ${pkg.description ? `<p class="package-card-desc" title="${escapeHtml(pkg.description)}">${escapeHtml(pkg.description)}</p>` : ""}
          <div class="package-card-meta">
            ${pkg.author ? `<span class="package-meta-item">👤 ${escapeHtml(pkg.author)}</span>` : ""}
            ${pkg.downloadsFormatted ? `<span class="package-meta-item">⬇️ ${escapeHtml(pkg.downloadsFormatted)}</span>` : ""}
            ${pkg.timeAgo ? `<span class="package-meta-item">🕒 ${escapeHtml(pkg.timeAgo)}</span>` : ""}
          </div>
        </div>
        <div class="package-card-footer">
          <div class="package-card-links">
            ${linksHtml.join("")}
          </div>
          ${actionBtnHtml}
        </div>
      `;

      // 绑定安装事件
      const btnInstall = card.querySelector(".btn-catalog-install");
      if (btnInstall) {
        btnInstall.addEventListener("click", (e) => {
          e.stopPropagation();
          handleInstallPackage(pkg.name);
        });
      }

      // 绑定更新事件
      const btnUpdate = card.querySelector(".btn-catalog-update");
      if (btnUpdate) {
        btnUpdate.addEventListener("click", (e) => {
          e.stopPropagation();
          handleUpdatePackage(pkg.name);
        });
      }

      // 绑定取消排队事件
      const btnCancel = card.querySelector(".btn-queue-cancel");
      if (btnCancel) {
        btnCancel.addEventListener("click", (e) => {
          e.stopPropagation();
          cancelQueuedPackageTask(pkg.name);
        });
      }

      packagesCatalogGrid.appendChild(card);
    });
  };

  // 入队新任务
  const enqueuePackageTask = (packageName, action) => {
    if (isPackageBusy(packageName)) {
      console.warn(`[PackageManager] Package ${packageName} is already busy or queued.`);
      return;
    }

    const task = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      packageName,
      action, // 'install' | 'uninstall' | 'update'
    };

    packageTaskQueue.push(task);

    // 注册包管理器队列并发任务
    notificationService.registerTask("package-queue", {
      count: packageTaskQueue.length,
      type: "package",
    });

    // 如果当前没有运行中的任务，且浮动提示存在，显示初始入队提示
    if (!currentRunningTask && packageProgressFloatCard) {
      updatePackageProgressUI({
        packageName,
        stage: action === "uninstall" ? "uninstalling" : action === "update" ? "updating" : "installing",
        percent: 5,
        message: "任务已加入队列，准备执行...",
      });
    }

    updateQueueBadge();
    refreshPackageViews();

    processPackageQueue();
  };

  // 取消排队中的任务
  const cancelQueuedPackageTask = (packageName) => {
    const idx = getPackageQueueIndex(packageName);
    if (idx !== -1) {
      packageTaskQueue.splice(idx, 1);
      packageProgressMap.delete(packageName);
      const stepper = packageSteppersMap.get(packageName.toLowerCase());
      if (stepper) {
        stepper.stopTimer();
        packageSteppersMap.delete(packageName.toLowerCase());
      }
      if (packageTaskQueue.length === 0 && !currentRunningTask) {
        notificationService.unregisterTask("package-queue");
      }
      updateQueueBadge();
      refreshPackageViews();
    }
  };

  // 队列处理循环引擎 (FIFO 严格排他互斥执行)
  const processPackageQueue = async () => {
    if (isProcessingQueue) return;
    if (packageTaskQueue.length === 0) {
      currentRunningTask = null;
      if (packageQueueBadge) packageQueueBadge.classList.add("hidden");
      notificationService.notifyIfAllCompleted({
        title: "pi-dl",
        message: "扩展组件安装与更新任务已全部完成。",
        taskId: "package-queue",
      });
      refreshPackageViews();
      return;
    }

    isProcessingQueue = true;
    currentRunningTask = packageTaskQueue.shift();
    const { packageName, action } = currentRunningTask;

    packageOperationMap.set(
      packageName,
      action === "uninstall" ? "uninstalling" : action === "update" ? "updating" : "installing"
    );

    updateQueueBadge();
    refreshPackageViews();

    try {
      if (action === "install") {
        await configService.installPackage(packageName);
      } else if (action === "uninstall") {
        await configService.uninstallPackage(packageName);
      } else if (action === "update") {
        await configService.updatePackage(packageName);
        packageUpdatesMap.delete(packageName);
      }
      await loadInstalledPackages();
    } catch (err) {
      console.error(`[PackageManager] Task ${action} error for ${packageName}:`, err);
      await sketchAlert(
        `组件 ${packageName} ${
          action === "uninstall" ? "卸载" : action === "update" ? "更新" : "安装"
        } 失败：\n${err?.toString() || "未知错误"}`,
        { type: "error", title: "组件操作失败" }
      );
    } finally {
      packageOperationMap.delete(packageName);
      const stepper = packageSteppersMap.get(packageName.toLowerCase());
      if (stepper) {
        stepper.stopTimer();
        packageSteppersMap.delete(packageName.toLowerCase());
      }
      setTimeout(() => {
        packageProgressMap.delete(packageName);
        refreshPackageViews();
      }, 1500);

      currentRunningTask = null;
      isProcessingQueue = false;

      refreshPackageViews();

      // 自动出队继续执行下一个任务
      if (packageTaskQueue.length > 0) {
        processPackageQueue();
      } else {
        if (packageQueueBadge) packageQueueBadge.classList.add("hidden");
        // 队列全部清空且当前无任务，注销任务并触发全任务完成判定通知
        notificationService.notifyIfAllCompleted({
          title: "pi-dl",
          message: "扩展组件安装与更新任务已全部完成。",
          taskId: "package-queue",
        });
      }
    }
  };

  // 应用推荐配置预设
  const handleApplyPackagePreset = async (packageName, btnElement) => {
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.textContent = "配置中...";
    }
    try {
      await configService.applyPackagePreset(packageName);
      await loadInstalledPackages();
    } catch (err) {
      console.error(`[PackageManager] Failed to apply preset for ${packageName}:`, err);
      await sketchAlert(`应用组件【${packageName}】推荐配置失败：\n${err?.toString() || "未知错误"}`, {
        type: "error",
        title: "应用推荐配置失败"
      });
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = "推荐配置";
      }
    }
  };

  // 安装组件
  const handleInstallPackage = (packageName) => {
    enqueuePackageTask(packageName, "install");
  };

  // 卸载组件
  const handleUninstallPackage = async (packageName) => {
    const confirmed = await sketchConfirm(`确定要从系统中卸载扩展组件「${packageName}」吗？\n（将加入操作队列自动执行）`, {
      title: "卸载扩展组件确认",
      isDanger: true
    });
    if (!confirmed) {
      return;
    }
    enqueuePackageTask(packageName, "uninstall");
  };

  // 更新单个组件
  const handleUpdatePackage = (packageName) => {
    enqueuePackageTask(packageName, "update");
  };

  // 批量检查更新
  const handleCheckAllUpdates = async () => {
    if (!btnCheckAllPackageUpdates) return;
    const origText = btnCheckAllPackageUpdates.innerHTML;
    btnCheckAllPackageUpdates.disabled = true;
    btnCheckAllPackageUpdates.innerHTML = `
      <span class="thinking-dot" style="margin-right: 4px;"></span>
      检查中...
    `;

    try {
      const updates = await configService.checkPackageUpdates();
      packageUpdatesMap.clear();
      let updateCount = 0;
      if (Array.isArray(updates)) {
        updates.forEach((u) => {
          packageUpdatesMap.set(u.name, u);
          if (u.hasUpdate) updateCount++;
        });
      }
      renderInstalledPackages();
      updateBatchUpdateButtonVisibility();
      if (currentCatalogResult?.packages) renderCatalogGrid(currentCatalogResult.packages);

      if (updateCount > 0) {
        await sketchAlert(`检查完成：发现 ${updateCount} 个组件有可用更新！`, { type: "success", title: "检查完成" });
      } else {
        await sketchAlert("已安装组件均为最新版本！", { type: "info", title: "检查完成" });
      }
    } catch (err) {
      console.error("[PackageManager] Check updates error:", err);
      await sketchAlert(`检查更新失败：${err?.toString() || "网络错误"}`, { type: "error", title: "检查更新失败" });
    } finally {
      btnCheckAllPackageUpdates.disabled = false;
      btnCheckAllPackageUpdates.innerHTML = origText;
    }
  };

  // 一键队列安装推荐扩展插件
  const handleInstallRecommendedPackages = () => {
    if (!recommendedPlugins || recommendedPlugins.length === 0) return;

    // 过滤出尚未安装且未在排队/运行中的推荐插件
    const toInstall = recommendedPlugins.filter(
      (p) => !isPackageInstalled(p.name) && !isPackageBusy(p.name)
    );

    if (toInstall.length === 0) {
      updateRecommendedButtonVisibility();
      return;
    }

    // 依次加入 FIFO 安装任务队列
    toInstall.forEach((p) => {
      enqueuePackageTask(p.name, "install");
    });
  };

  // 一键更新所有有可用更新的组件
  const handleUpdateAllPackages = () => {
    const updatablePkgs = installedPackages.filter((pkg) => {
      const updateInfo = packageUpdatesMap.get(pkg.name);
      return updateInfo && updateInfo.hasUpdate && !isPackageBusy(pkg.name);
    });

    if (updatablePkgs.length === 0) return;

    updatablePkgs.forEach((pkg) => {
      enqueuePackageTask(pkg.name, "update");
    });
  };

  if (btnInstallRecommendedPackages) {
    btnInstallRecommendedPackages.addEventListener("click", (e) => {
      e.stopPropagation();
      handleInstallRecommendedPackages();
    });
  }

  if (btnUpdateAllPackages) {
    btnUpdateAllPackages.addEventListener("click", (e) => {
      e.stopPropagation();
      handleUpdateAllPackages();
    });
  }

  if (btnCheckAllPackageUpdates) {
    btnCheckAllPackageUpdates.addEventListener("click", (e) => {
      e.stopPropagation();
      handleCheckAllUpdates();
    });
  }

  // 搜索栏交互绑定
  if (packagesSearchInput) {
    packagesSearchInput.addEventListener("input", () => {
      if (btnClearPackageSearch) {
        if (packagesSearchInput.value.trim().length > 0) {
          btnClearPackageSearch.classList.remove("hidden");
        } else {
          btnClearPackageSearch.classList.add("hidden");
        }
      }
    });

    packagesSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadCatalogPackages(1);
      }
    });
  }

  if (btnClearPackageSearch) {
    btnClearPackageSearch.addEventListener("click", () => {
      if (packagesSearchInput) {
        packagesSearchInput.value = "";
        btnClearPackageSearch.classList.add("hidden");
        loadCatalogPackages(1);
      }
    });
  }

  if (btnSearchPackages) {
    btnSearchPackages.addEventListener("click", () => {
      loadCatalogPackages(1);
    });
  }

  if (packagesTypeSelect) {
    packagesTypeSelect.addEventListener("change", () => {
      loadCatalogPackages(1);
    });
  }

  if (packagesSortSelect) {
    packagesSortSelect.addEventListener("change", () => {
      loadCatalogPackages(1);
    });
  }

  // 分页按钮绑定
  if (btnPackagesPrevPage) {
    btnPackagesPrevPage.addEventListener("click", () => {
      if (currentCatalogPage > 1) {
        loadCatalogPackages(currentCatalogPage - 1);
      }
    });
  }

  if (btnPackagesNextPage) {
    btnPackagesNextPage.addEventListener("click", () => {
      if (currentCatalogResult?.hasMore) {
        loadCatalogPackages(currentCatalogPage + 1);
      }
    });
  }

  // 初始化增强下拉框
  enhanceSelect(packagesTypeSelect);
  enhanceSelect(packagesSortSelect);

  // ==========================================================================
  // 全局右键与 Esc 行为规范：禁用上下文菜单，统一作为“返回上一步/回退 (Step Back)”
  // 回退层级：侧边栏 (最高优先) -> 设置全页面 (settings) -> Flow (界面3, suspend to background) -> Focus (界面2) -> Detailed (界面1) -> 失焦/清空
  // ==========================================================================
  const stepBackHandlers = [];

  const registerStepBackHandler = (handler) => {
    stepBackHandlers.push(handler);
    return () => {
      const idx = stepBackHandlers.indexOf(handler);
      if (idx !== -1) stepBackHandlers.splice(idx, 1);
    };
  };

  // 1. 注册侧边栏回退（最高优先级）
  registerStepBackHandler(() => {
    return closeTaskSidebar();
  });

  // 2. 注册设置页面回退
  registerStepBackHandler(() => {
    return closeSettingsView();
  });

  const handleGlobalStepBack = (e) => {
    // 1. 逆序执行已注册的外部业务层回退钩子（优先收起侧边栏、设置页面等）
    for (let i = stepBackHandlers.length - 1; i >= 0; i--) {
      try {
        const handled = stepBackHandlers[i](e);
        if (handled) return;
      } catch (err) {
        console.error("[StepBack] Error in handler:", err);
      }
    }

    // 2. Flow (界面3) -> 右键转入后台挂起 (若仍在运行或处于暂停待确认态) 或 归档至历史记录 (若已结束/已中断)
    if (currentView === VIEW_FLOW) {
      const activeTask = taskManager.getCurrentActiveTask();
      const isRunning = activeTask
        ? (activeTask.status === "thinking" || activeTask.status === "streaming" || activeTask.status === "tool_exec")
        : piClient.isStreaming;
      const isPaused = activeTask ? activeTask.status === "paused" : false;

      if (isRunning || isPaused) {
        // 正在运行中或处于暂停/待确认状态 -> 右键/Esc 无感转入后台挂起 (isSuspended = true)
        const suspended = taskManager.suspendCurrentFlow();
        setViewMode(VIEW_FOCUS, true);
        const taskTitle = suspended?.title || "Task";
        const pauseSuffix = isPaused ? " [待确认]" : "";
        showGlobalToast(`已转入后台运行 (${taskTitle})${pauseSuffix}`, 1500);
        updateMiniTaskCapsuleUI();
        return;
      } else {
        // 运行已结束 (Done / Completed / Aborted / Error / Idle 中断或正常结束) -> 右键/Esc 归档为历史记录并清除 Task
        archiveCurrentFlowToHistory();
        if (activeTask) {
          taskManager.removeTask(activeTask.id);
        }
        setViewMode(VIEW_FOCUS, true);
        updateMiniTaskCapsuleUI();
        renderConversationMessages();
        return;
      }
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

    if ((searchInput && searchInput.value.trim().length > 0) || attachedFiles.length > 0) {
      searchInput.value = "";
      clearAttachedFiles();
      updateInputState();
      autoResizeSearchInput();
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

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      handleGlobalStepBack(e);
    }
  });

  // 窗口生命周期与关闭保护：在窗口关闭、页面隐藏或离开时自动归档 Flow
  window.addEventListener("beforeunload", () => {
    if (currentView === VIEW_FLOW) {
      archiveCurrentFlowToHistory();
    }
  });

  window.addEventListener("pagehide", () => {
    if (currentView === VIEW_FLOW) {
      archiveCurrentFlowToHistory();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentView === VIEW_FLOW) {
      archiveCurrentFlowToHistory();
    }
  });
});
