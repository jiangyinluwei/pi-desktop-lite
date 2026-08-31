import { VIEW_DETAILED, VIEW_FOCUS, VIEW_FLOW, VIEW_SETTINGS } from "../lib/view-constants.js";
import { taskManager } from "../services/task-manager.js";

/**
 * 四态界面状态机、设置页打开/关闭与 Tauri 唤醒路由
 */
export function initViewMode(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const appContainer = el.appContainer;
  const searchInput = el.searchInput;
  const settingsBtn = el.settingsBtn;
  const searchForm = el.searchForm;
  const flowScrollArea = el.flowScrollArea;
  const thinkingToggleBtn = el.thinkingToggleBtn;
  const agentThinkingCard = el.agentThinkingCard;
  const flowModelTag = el.flowModelTag;
  const flowBtnAbort = el.flowBtnAbort;
  const topbarHintBanner = el.topbarHintBanner;

  // ==========================================================================
  // 四态界面状态机 (detailed | focus | flow | settings)
  // ==========================================================================


  const setViewMode = (mode, shouldFocusInput = true) => {
    if (![VIEW_DETAILED, VIEW_FOCUS, VIEW_FLOW, VIEW_SETTINGS].includes(mode)) return;

    if (view.mode !== VIEW_SETTINGS && mode === VIEW_SETTINGS) {
      view.previous = view.mode;
    }

    view.mode = mode;
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

  window.__piGetViewMode = () => view.mode;
  window.__piSetViewMode = setViewMode;

  if (searchInput) {
    // 详细界面下按右键阻止触发原生获焦
    searchInput.addEventListener("mousedown", (e) => {
      if (e.button === 2 && view.mode === VIEW_DETAILED) {
        e.preventDefault();
      }
    });

    searchInput.addEventListener("focus", () => {
      if (view.mode === VIEW_DETAILED) {
        setViewMode(VIEW_FOCUS, false);
      }
    });

    searchInput.addEventListener("click", (e) => {
      if (e.button === 0 && view.mode === VIEW_DETAILED) {
        setViewMode(VIEW_FOCUS, true);
      }
    });
  }

  if (searchForm) {
    // 详细界面下搜索框区域按右键阻止默认行为与冒泡，杜绝触发界面瞬切与抖动
    searchForm.addEventListener("mousedown", (e) => {
      if (e.button === 2 && view.mode === VIEW_DETAILED) {
        e.preventDefault();
      }
    });

    searchForm.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (view.mode === VIEW_DETAILED) {
        e.stopPropagation();
        e.stopImmediatePropagation();
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
  const openSettingsView = async (targetTab = null) => {
    if (view.mode !== VIEW_SETTINGS) {
      view.previous = view.mode;
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
      if (view.hintBannerTimeout) clearTimeout(view.hintBannerTimeout);
      view.hintBannerTimeout = setTimeout(() => {
        topbarHintBanner.classList.add("hint-visible");
        view.hintBannerTimeout = setTimeout(() => {
          topbarHintBanner.classList.remove("hint-visible");
          topbarHintBanner.classList.add("fade-out");
        }, 3000);
      }, 1000);
    }

    api.loadSessions();
    api.loadModelsAndState();
    api.loadOfficialProvidersConfig();
    api.loadCustomProvidersConfig();
    api.loadInstalledPackages();
    api.loadRecommendedPlugins();
    if (typeof api.loadWorkspaces === "function") {
      api.loadWorkspaces();
    }
    if (!api.hasCatalogLoadedOnce()) {
      api.loadCatalogPackages(1);
    }
  };

  const closeSettingsView = () => {
    if (view.mode === VIEW_SETTINGS) {
      setViewMode(view.previous || VIEW_DETAILED, true);
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
        api.restoreTaskToFlow(suspended[0]);
      } else if (suspended.length >= 2) {
        closeSettingsView();
        setViewMode(VIEW_FOCUS, true);
        api.updateMiniTaskCapsuleUI();
      }
      // 0 个挂起任务时保持当前视图 (精准记忆恢复)
    });

    // 监听用户点击系统通知事件：自动退出设置全屏页、切换至该 Task 的 Flow 模式并滚动到底部
    window.__TAURI__.event.listen("notification-clicked", (event) => {
      closeSettingsView();
      const targetTaskId = event?.payload?.taskId || event?.payload?.task_id;
      if (targetTaskId && taskManager.getTask(targetTaskId)) {
        api.restoreTaskToFlow(taskManager.getTask(targetTaskId));
      } else {
        const activeTasks = taskManager.getActiveTasks();
        if (activeTasks.length > 0) {
          api.restoreTaskToFlow(activeTasks[0]);
        } else {
          setViewMode(VIEW_FLOW, true);
        }
      }
      if (flowScrollArea) {
        flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
      }
    });
  }

  api.setViewMode = setViewMode;
  api.openSettingsView = openSettingsView;
  api.closeSettingsView = closeSettingsView;
}
