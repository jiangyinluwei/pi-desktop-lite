import { VIEW_DETAILED, VIEW_FOCUS, VIEW_FLOW } from "../lib/view-constants.js";
import { piClient } from "../services/pi-client.js";
import { taskManager } from "../services/task-manager.js";
import { openExternalUrl } from "../services/tauri-bridge.js";

/**
 * 全局右键/Esc 回退、窗口生命周期与关闭保护
 */
export function initGlobalInteractions(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const searchInput = el.searchInput;
  const searchForm = el.searchForm;

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
    return api.closeTaskSidebar();
  });

  // 2. 注册设置页面回退
  registerStepBackHandler(() => {
    return api.closeSettingsView();
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
    if (view.mode === VIEW_FLOW) {
      // 定向回退特例：从设置页会话记录 Tab 进入的 Flow（flowFromSettings 标志）
      // 空闲/已结束态 → 不挂起、不归档，直接回设置页会话记录 Tab（Flow 现场保留）；
      // 运行/暂停态 → 清标志后落入下方原有挂起通道，防运行中误回设置页丢失感知。
      const flowFromSettings = Boolean(view.flowFromSettings);
      if (flowFromSettings) {
        view.flowFromSettings = false;
      }

      const activeTask = taskManager.getCurrentActiveTask();
      const isRunning = activeTask
        ? (activeTask.status === "thinking" || activeTask.status === "streaming" || activeTask.status === "tool_exec")
        : piClient.isStreaming;
      const isPaused = activeTask ? activeTask.status === "paused" : false;

      if (flowFromSettings && !isRunning && !isPaused) {
        api.openSettingsView("tab-sessions", { previousMode: VIEW_DETAILED });
        return;
      }

      if (isRunning || isPaused) {
        // 正在运行中或处于暂停/待确认状态 -> 右键/Esc 无感转入后台挂起 (isSuspended = true)
        const suspended = taskManager.suspendCurrentFlow();
        api.setViewMode(VIEW_FOCUS, true);
        const taskTitle = suspended?.title || "Task";
        const pauseSuffix = isPaused ? " [待确认]" : "";
        api.showGlobalToast(`已转入后台运行 (${taskTitle})${pauseSuffix}`, 1500);
        api.updateMiniTaskCapsuleUI();
        return;
      } else {
        // 运行已结束 (Done / Completed / Aborted / Error / Idle 中断或正常结束) -> 右键/Esc 归档为历史记录并清除 Task
        api.archiveCurrentFlowToHistory();
        if (activeTask) {
          taskManager.removeTask(activeTask.id);
        }
        api.setViewMode(VIEW_FOCUS, true);
        api.updateMiniTaskCapsuleUI();
        api.renderConversationMessages();
        return;
      }
    }

    // Focus (界面2) -> 右键回退至 Detailed (界面1) 并失焦
    if (view.mode === VIEW_FOCUS) {
      api.setViewMode(VIEW_DETAILED, false);
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

    if ((searchInput && searchInput.value.trim().length > 0) || attachments.files.length > 0) {
      searchInput.value = "";
      api.clearAttachedFiles();
      api.updateInputState();
      api.autoResizeSearchInput();
      return;
    }

    window.dispatchEvent(new CustomEvent("pi:step-back", { detail: { originalEvent: e } }));
  };

  window.__piRegisterStepBack = registerStepBackHandler;
  window.__piStepBack = handleGlobalStepBack;

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (view.mode === VIEW_DETAILED && searchForm && searchForm.contains(e.target)) {
      return;
    }
    handleGlobalStepBack(e);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      handleGlobalStepBack(e);
    }
  });

  // 窗口生命周期与关闭保护：在窗口关闭、页面隐藏或离开时自动归档 Flow
  window.addEventListener("beforeunload", () => {
    if (view.mode === VIEW_FLOW) {
      api.archiveCurrentFlowToHistory();
    }
  });

  window.addEventListener("pagehide", () => {
    if (view.mode === VIEW_FLOW) {
      api.archiveCurrentFlowToHistory();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && view.mode === VIEW_FLOW) {
      api.archiveCurrentFlowToHistory();
    }
  });

  // 全局拦截所有外部超链接点击，统一唤起系统默认浏览器打开
  document.addEventListener(
    "click",
    (e) => {
      const linkEl = e.target && typeof e.target.closest === "function" ? e.target.closest("a") : null;
      if (!linkEl) return;
      const href = linkEl.getAttribute("href");
      if (!href) return;

      const trimmedHref = href.trim();
      if (
        trimmedHref.startsWith("http://") ||
        trimmedHref.startsWith("https://") ||
        trimmedHref.startsWith("mailto:")
      ) {
        e.preventDefault();
        e.stopPropagation();
        openExternalUrl(trimmedHref);
      }
    },
    true
  );
}
