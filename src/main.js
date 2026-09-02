/**
 * pi-dl 前端入口 (Orchestrator)
 *
 * 职责边界：本文件只负责三件事
 * 1. 收集静态 DOM 引用（ctx.el）
 * 2. 构建共享状态上下文（view / settings / flow / attachments / api）
 * 3. 按依赖顺序初始化 src/modules/ 下的各功能模块
 *
 * 具体业务逻辑一律存放在 src/modules/ 与 src/services/ 中。
 */
import { initViewMode } from "./modules/view-mode.js";
import { initPreferences } from "./modules/preferences.js";
import { initSettingsNavigation } from "./modules/settings-navigation.js";
import { initModelPanel } from "./modules/model-panel.js";
import { initCustomProviderPanel } from "./modules/custom-provider-panel.js";
import { initKernelPanel } from "./modules/kernel-panel.js";
import { initSessionsPanel } from "./modules/sessions-panel.js";
import { initWorkspacePanel } from "./modules/workspace-panel.js";
import { initWindowControls } from "./modules/window-controls.js";
import { initFlowUi } from "./modules/flow-ui.js";
import { initFlowStream } from "./modules/flow-stream.js";
import { initFlowPipeline } from "./modules/flow-pipeline.js";
import { initTaskPanel } from "./modules/task-panel.js";
import { initFileAttachments } from "./modules/file-attachments.js";
import { initSearchInput } from "./modules/search-input.js";
import { initPackagesPanel } from "./modules/packages-panel.js";
import { initGlobalInteractions } from "./modules/global-interactions.js";

window.addEventListener("DOMContentLoaded", () => {
  const el = {
    appContainer: document.getElementById("app-container"),
    searchInputWrapper: document.getElementById("search-input-wrapper"),
    searchInput: document.getElementById("search-input"),
    attachedCapsulesContainer: document.getElementById("attached-capsules-container"),
    searchIconBox: document.getElementById("search-icon-box"),
    filePickerInput: document.getElementById("file-picker-input"),
    searchMottoLayer: document.getElementById("search-motto-layer"),
    searchMottoTrack: document.getElementById("search-motto-track"),
    searchMottoText1: document.getElementById("search-motto-text-1"),
    searchMottoText2: document.getElementById("search-motto-text-2"),
    clearBtn: document.getElementById("clear-btn"),
    settingsBtn: document.getElementById("settings-btn"),
    settingsBadge: document.getElementById("settings-badge"),
    searchForm: document.getElementById("search-form"),
    flowStage: document.getElementById("flow-stage"),
    flowScrollArea: document.getElementById("flow-scroll-area"),
    flowConversation: document.getElementById("flow-conversation"),
    flowQuestionTip: document.getElementById("flow-question-tip"),
    flowQuestionTipText: document.getElementById("flow-question-tip-text"),
    flowTurnNav: document.getElementById("flow-turn-nav"),
    flowTurnNavUp: document.getElementById("flow-turn-nav-up"),
    flowTurnNavDown: document.getElementById("flow-turn-nav-down"),
    flowUserText: document.getElementById("flow-user-text"),
    flowPromptAttachments: document.getElementById("flow-prompt-attachments"),
    thinkingToggleBtn: document.getElementById("thinking-toggle-btn"),
    agentThinkingCard: document.getElementById("agent-thinking-card"),
    thinkingDuration: document.getElementById("thinking-duration"),
    thinkingTextStream: document.getElementById("thinking-text-stream"),
    thinkingBody: document.getElementById("thinking-body"),
    toolCallsContainer: document.getElementById("tool-calls-container"),
    flowResponseContent: document.getElementById("flow-response-content"),
    flowModelTag: document.getElementById("flow-model-tag"),
    flowModelName: document.getElementById("flow-model-name"),
    flowInjectionCapsule: document.getElementById("flow-injection-capsule"),
    flowInjectionText: document.getElementById("flow-injection-text"),
    sketchMessagesDrawer: document.getElementById("sketch-messages-drawer"),
    messagesPrimaryRow: document.getElementById("messages-primary-row"),
    messagesExpandedWrap: document.getElementById("messages-expanded-wrap"),
    messagesExpandedGrid: document.getElementById("messages-expanded-grid"),
    miniTaskCapsule: document.getElementById("mini-task-capsule"),
    kernelAlert: document.getElementById("kernel-alert"),
    kernelAlertText: document.getElementById("kernel-alert-text"),
    capsuleTaskText: document.getElementById("capsule-task-text"),
    flowBtnAbort: document.getElementById("flow-btn-abort"),
    searchHint: document.getElementById("search-hint"),
    searchHintKbd: document.getElementById("search-hint-kbd"),
    hintKeyText: document.getElementById("hint-key-text"),
    globalToastBanner: document.getElementById("global-toast-banner"),
    globalToastText: document.getElementById("global-toast-text"),
    taskDetailsSidebar: document.getElementById("task-details-sidebar"),
    taskSidebarSummary: document.getElementById("task-sidebar-summary"),
    taskSidebarList: document.getElementById("task-sidebar-list"),
    btnCloseTaskSidebar: document.getElementById("btn-close-task-sidebar"),
    topbarHintBanner: document.getElementById("topbar-hint-banner"),
    hostStatusDot: document.getElementById("host-status-dot"),
    hostStatusText: document.getElementById("host-status-text"),
    hostVersionText: document.getElementById("host-version-text"),
    btnRestartHost: document.getElementById("btn-restart-host"),
    btnCheckUpdate: document.getElementById("btn-check-update"),
    updateNotice: document.getElementById("update-notice"),
    updateMsg: document.getElementById("update-msg"),
    updateNoticeActions: document.getElementById("update-notice-actions"),
    btnToggleChangelog: document.getElementById("btn-toggle-changelog"),
    btnIgnoreUpdate: document.getElementById("btn-ignore-update"),
    btnUpdateKernel: document.getElementById("btn-update-kernel"),
    kernelUpdateProgressWrap: document.getElementById("kernel-update-progress-wrap"),
    kernelProgressStage: document.getElementById("kernel-progress-stage"),
    kernelProgressPercent: document.getElementById("kernel-progress-percent"),
    btnCancelUpdate: document.getElementById("btn-cancel-update"),
    kernelProgressFill: document.getElementById("kernel-progress-fill"),
    kernelProgressSubMsg: document.getElementById("kernel-progress-sub-msg"),
    kernelChangelogDrawer: document.getElementById("kernel-changelog-drawer"),
    changelogVersionTag: document.getElementById("changelog-version-tag"),
    btnCloseChangelog: document.getElementById("btn-close-changelog"),
    kernelChangelogContent: document.getElementById("kernel-changelog-content"),
    kernelPackagesArea: document.getElementById("kernel-packages-area"),
    btnClearUiSessions: document.getElementById("btn-clear-ui-sessions"),
    sessionsSearchInput: document.getElementById("sessions-search-input"),
    sessionsTimeFilter: document.getElementById("sessions-time-filter"),
    sessionsList: document.getElementById("sessions-list"),
    sessionCount: document.getElementById("session-count"),
    workspaceList: document.getElementById("workspace-list"),
    workspaceActiveName: document.getElementById("workspace-active-name"),
    workspaceActivePath: document.getElementById("workspace-active-path"),
    workspaceActiveBadge: document.getElementById("workspace-active-badge"),
    codeAreaRouteCard: document.getElementById("code-area-route-card"),
    codeAreaRouteInput: document.getElementById("code-area-route-input"),
    codeAreaRouteStatus: document.getElementById("code-area-route-status"),
    btnBrowseRouteFolder: document.getElementById("btn-browse-route-folder"),
    btnSaveRoutePath: document.getElementById("btn-save-route-path"),
    codeAreaHistorySection: document.getElementById("code-area-history-section"),
    codeAreaHistoryList: document.getElementById("code-area-history-list"),
    codeAreaSkillsSection: document.getElementById("code-area-skills-section"),
    codeAreaSkillsList: document.getElementById("code-area-skills-list"),
    codeAreaSkillsCount: document.getElementById("code-area-skills-count"),
    currentModelProvider: document.getElementById("current-model-provider"),
    currentModelName: document.getElementById("current-model-name"),
    currentModelInfo: document.getElementById("current-model-info"),
    thinkingSelectDropdown: document.getElementById("thinking-select-dropdown"),
    whitelistModelsList: document.getElementById("whitelist-models-list"),
    btnToggleOfficial: document.getElementById("btn-toggle-official"),
    btnToggleCustom: document.getElementById("btn-toggle-custom"),
    channelConfigOfficial: document.getElementById("channel-config-official"),
    channelConfigCustom: document.getElementById("channel-config-custom"),
    channelConfigDrawers: document.getElementById("channel-config-drawers"),
    autoReconnectSwitch: document.getElementById("auto-reconnect-switch"),
    officialProviderSelect: document.getElementById("official-provider-select"),
    officialProviderTitle: document.getElementById("official-provider-title"),
    officialProviderDesc: document.getElementById("official-provider-desc"),
    officialProviderDoc: document.getElementById("official-provider-doc"),
    officialApiKeyInput: document.getElementById("official-api-key-input"),
    btnToggleKeyVisibility: document.getElementById("btn-toggle-key-visibility"),
    btnSaveOfficialKey: document.getElementById("btn-save-official-key"),
    officialKeyStatus: document.getElementById("official-key-status"),
    officialModelsGrid: document.getElementById("official-models-grid"),
    btnFetchOfficialModels: document.getElementById("btn-fetch-official-models"),
    btnFetchOfficialModelsText: document.getElementById("btn-fetch-official-models-text"),
    customProviderForm: document.getElementById("custom-provider-form"),
    customProviderId: document.getElementById("custom-provider-id"),
    customApiType: document.getElementById("custom-api-type"),
    customBaseUrl: document.getElementById("custom-base-url"),
    customApiKey: document.getElementById("custom-api-key"),
    customProvidersContainer: document.getElementById("custom-providers-container"),
  };

  /**
   * 模块共享上下文
   * - view:         四态界面状态机共享状态
   * - settings:     设置页跨模块共享状态（通道抽屉、官方目录、认证缓存）
   * - flow:         Flow 流式交互共享状态（当前轮次 DOM、流式文本、工具卡注册表等）
   * - attachments:  输入框附件胶囊共享状态
   * - api:          各模块按需注册的跨模块函数调用面
   */
  const ctx = {
    el,
    view: {
      mode: "detailed",
      previous: "detailed",
      flowFromSettings: false,
      hintBannerTimeout: null,
    },
    settings: {
      expandedChannel: null,
      officialCatalog: [],
      currentOfficialAuth: {},
    },
    flow: {
      thinkingStartTime: 0,
      thinkingTimerInterval: null,
      currentThinkingText: "",
      currentResponseText: "",
      currentErrorMessage: null,
      lastUserQuery: "",
      hasReceivedDelta: false,
      hasAutoCollapsedThinking: false,
      renderedToolCards: new Map(),
      interruptSendTaskId: null,
      lastSentPrompt: "",
      lastImagePayloads: null,
      activeTurnRefs: null,
      lastSentAttachments: [],
    },
    attachments: {
      files: [],
    },
    api: {},
  };

  initViewMode(ctx);
  initPreferences(ctx);
  initSettingsNavigation(ctx);
  initModelPanel(ctx);
  initCustomProviderPanel(ctx);
  initKernelPanel(ctx);
  initSessionsPanel(ctx);
  initWorkspacePanel(ctx);
  initWindowControls(ctx);
  initFlowUi(ctx);
  initFlowStream(ctx);
  initFlowPipeline(ctx);
  initTaskPanel(ctx);
  initFileAttachments(ctx);
  initSearchInput(ctx);
  initPackagesPanel(ctx);
  initGlobalInteractions(ctx);
});

