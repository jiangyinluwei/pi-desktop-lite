import { escapeHtml, cleanUserPrompt } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { VIEW_FLOW } from "../lib/view-constants.js";
import { piClient } from "../services/pi-client.js";
import { sessionService } from "../services/session-service.js";
import { conversationHistoryService } from "../services/conversation-history.js";
import { taskManager } from "../services/task-manager.js";
import { modelFailoverEngine } from "../services/model-failover.js";

/**
 * 后台任务胶囊、侧边栏、历史恢复与快照归档
 */
export function initTaskPanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const flowScrollArea = el.flowScrollArea;
  const flowConversation = el.flowConversation;
  const thinkingToggleBtn = el.thinkingToggleBtn;
  const thinkingDuration = el.thinkingDuration;
  const flowModelName = el.flowModelName;
  const sketchMessagesDrawer = el.sketchMessagesDrawer;
  const messagesPrimaryRow = el.messagesPrimaryRow;
  const messagesExpandedGrid = el.messagesExpandedGrid;
  const miniTaskCapsule = el.miniTaskCapsule;
  const capsuleTaskText = el.capsuleTaskText;
  const flowBtnAbort = el.flowBtnAbort;
  const globalToastBanner = el.globalToastBanner;
  const globalToastText = el.globalToastText;
  const taskDetailsSidebar = el.taskDetailsSidebar;
  const taskSidebarSummary = el.taskSidebarSummary;
  const taskSidebarList = el.taskSidebarList;
  const btnCloseTaskSidebar = el.btnCloseTaskSidebar;

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
            actions.prepend(btnAbort);
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
          <div class="task-card-footer">
            <div class="task-card-actions">
              ${isRunning ? `<button type="button" class="task-card-action-btn btn-abort-task">⏹ 终止</button>` : ""}
            </div>
            <div class="task-hover-prompt" aria-hidden="true">
              <span class="prompt-text">进入 Flow</span>
              <span class="hover-arrow">→</span>
            </div>
          </div>
        `;

        card.addEventListener("click", (e) => {
          if (e.target.closest(".task-card-action-btn")) return;
          restoreTaskToFlow(task);
          closeTaskSidebar();
        });

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
      api.finalizeStream();
      api.appendFlowAbortNotice();
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
      api.finalizeStream();
      api.appendFlowAbortNotice();
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

  // ==========================================================================
  // Flow 历史轮次共享渲染器：清空会话区 → 逐轮渲染 → 末轮回填 flow.* 状态 → 切视图 → 滚动到底
  // 供 restoreTaskToFlow / restoreConversationToFlow 与内核会话还原管线 (enterKernelSessionFlow) 共用
  // ==========================================================================
  const renderTurnsIntoFlow = (task, turns, options = {}) => {
    if (!task || !Array.isArray(turns) || turns.length === 0) return;

    const {
      isRunning = false,
      syncModelName = false,
      sessionPath = null,
    } = options;

    taskManager.setActiveTask(task.id);

    if (flowConversation) {
      flowConversation.innerHTML = "";
    }

    turns.forEach((turn, idx) => {
      const isLast = idx === turns.length - 1;
      const isOpen = isLast && isRunning && (!turn.responseText || turn.responseText.trim().length === 0);

      const groupRefs = api.createFlowTurnGroupElement({
        query: turn.query || "",
        attachments: turn.attachments || [],
        thinkingText: turn.thinkingText || "",
        thinkingDurationText: turn.thinkingDurationText || turn.thinkingDuration || "已完成思考",
        responseText: turn.responseText || "",
        toolCalls: turn.toolCalls || [],
        injectedSkills: turn.injectedSkills || [],
        isOpenThinking: isOpen,
        isAborted: turn.isAborted || turn.responseText?.includes("刚刚会话已手动终止"),
        errorMessage: turn.errorMessage,
      });

      if (flowConversation && groupRefs?.groupEl) {
        flowConversation.appendChild(groupRefs.groupEl);
      }

      if (isLast) {
        flow.activeTurnRefs = groupRefs;
        flow.lastUserQuery = turn.query || "";
        flow.lastSentAttachments = turn.attachments || [];
        flow.currentThinkingText = turn.thinkingText || "";
        flow.currentResponseText = turn.responseText || "";
        flow.currentErrorMessage = turn.errorMessage || null;
        flow.hasReceivedDelta = Boolean(turn.responseText && turn.responseText.trim().length > 0);
        flow.hasAutoCollapsedThinking = !isOpen;

        if (isRunning && groupRefs.responseContentEl) {
          groupRefs.responseContentEl.innerHTML = api.renderMarkdown(turn.responseText || "") + `<span class="streaming-cursor"></span>`;
        }
      } else {
        // 历史轮次全部收起思考卡片与工具卡片
        api.collapseThinkingCard(groupRefs.thinkingCardEl, groupRefs.thinkingToggleBtn);
      }
    });

    if (syncModelName && flowModelName) {
      flowModelName.textContent = task.model || "Model";
    }

    if (flowBtnAbort) {
      if (isRunning) {
        flowBtnAbort.classList.remove("hidden");
      } else {
        flowBtnAbort.classList.add("hidden");
      }
    }

    api.setViewMode(VIEW_FLOW, true);

    // 同步切换底层 Pi 会话
    if (sessionPath) {
      sessionService.switchSession(sessionPath).catch((err) => {
        console.warn("[Main] Session sync switch warning:", err);
      });
    }

    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  const restoreTaskToFlow = (task) => {
    if (!task) return;

    if (view.mode === VIEW_FLOW && taskManager.getCurrentActiveTask()?.id !== task.id) {
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
      ? task.turns.map((t) => ({ ...t, query: cleanUserPrompt(t.query || "") }))
      : [
          {
            query: cleanUserPrompt(task.query || task.title || ""),
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

    renderTurnsIntoFlow(task, turns, { isRunning, syncModelName: true });
  };

  const restoreConversationToFlow = (conv) => {
    if (!conv) return;

    if (view.mode === VIEW_FLOW) {
      archiveCurrentFlowToHistory();
    }

    // 1. 刷新该讯息的浏览时间戳（MRU 刷新排序至第 1 位）
    conversationHistoryService.touchConversation(conv.id);

    // 2. 将该历史对话还原并绑定为 TaskManager 的当前活跃 Task，确保后续提问保留在同一个工作流
    const taskIdToUse = conv.taskId || conv.id;
    let task = taskManager.getTask(taskIdToUse);
    const turns = Array.isArray(conv.turns) && conv.turns.length > 0
      ? conv.turns.map((t) => ({ ...t, query: cleanUserPrompt(t.query || "") }))
      : [
          {
            query: cleanUserPrompt(conv.query || conv.title || ""),
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
        query: cleanUserPrompt(conv.query || conv.title || ""),
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

    renderTurnsIntoFlow(task, turns, { sessionPath: conv.sessionPath || null });
  };

  const archiveCurrentFlowToHistory = () => {
    const currentActive = taskManager.getCurrentActiveTask();
    const isAborted = Boolean(
      (currentActive && currentActive.status === "aborted") ||
      flow.activeTurnRefs?.responseContentEl?.querySelector(".flow-abort-callout")
    );

    let responseTextToSave = flow.currentResponseText;
    if (!responseTextToSave && (flow.currentErrorMessage || flow.activeTurnRefs?.responseContentEl?.querySelector(".sketch-error-card"))) {
      responseTextToSave = `> ⚠️ **模型调用失败**：${flow.currentErrorMessage || "模型执行异常终止"}`;
    }

    const toolCallsSnapshot = [];
    flow.renderedToolCards.forEach((cardEl, id) => {
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
            thinkingText: flow.currentThinkingText || turn.thinkingText || "",
            responseText: responseTextToSave || turn.responseText || "",
            toolCalls: toolCallsSnapshot.length > 0 ? toolCallsSnapshot : (turn.toolCalls || []),
            injectedSkills: Array.from(flow.activeTurnRefs?.activatedSkills || turn.injectedSkills || []),
            thinkingDurationText: flow.activeTurnRefs?.thinkingDurationEl ? flow.activeTurnRefs.thinkingDurationEl.textContent : (turn.thinkingDurationText || "已完成思考"),
            isAborted: isAborted || turn.isAborted,
            errorMessage: flow.currentErrorMessage || turn.errorMessage,
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
        query: firstTurn?.query || flow.lastUserQuery,
        title: firstTurn?.query ? conversationHistoryService.generateSummaryTitle(firstTurn.query) : undefined,
        turns: turnsToSave,
        thinkingText: lastTurn?.thinkingText || flow.currentThinkingText || "",
        responseText: lastTurn?.responseText || responseTextToSave || "",
        toolCalls: lastTurn?.toolCalls || toolCallsSnapshot,
        thinkingDuration: lastTurn?.thinkingDurationText || (flow.activeTurnRefs?.thinkingDurationEl ? flow.activeTurnRefs.thinkingDurationEl.textContent : null),
        modelId: currentActive.model || piClient.currentModel?.id || "",
        sessionPath: "",
        isAborted: turnsToSave.some((t) => t.isAborted),
      });

      if (savedConv && savedConv.id) {
        currentActive.conversationId = savedConv.id;
      }
    } else if (flow.lastUserQuery && (responseTextToSave || flow.currentThinkingText || isAborted)) {
      const savedConv = conversationHistoryService.recordConversation({
        id: currentActive?.conversationId || undefined,
        taskId: currentActive ? currentActive.id : undefined,
        query: flow.lastUserQuery,
        thinkingText: flow.currentThinkingText,
        responseText: responseTextToSave || "",
        toolCalls: toolCallsSnapshot,
        thinkingDuration: flow.activeTurnRefs?.thinkingDurationEl ? flow.activeTurnRefs.thinkingDurationEl.textContent : null,
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
        <svg class="sketch-card-circle-overlay" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
          <path class="sketch-circle-loop" d="M 14,32 C 10,13 36,4 102,4.5 C 168,5 192,15 190,32 C 187,49 162,56 98,55.5 C 34,55 8,45 10,27 C 12,14 38,5.5 106,6" />
        </svg>
        <button type="button" class="message-card-close-btn" title="不在列表中显示" aria-label="隐藏讯息">
          ${ICONS.close}
        </button>
        <div class="message-card-title" title="${escapeHtml(conv.query || conv.title)}">${escapeHtml(conv.title || conv.query)}</div>
        <div class="message-card-meta">
          <span class="message-card-time">${escapeHtml(timeStr)}</span>
        </div>
      `;

      let clickCount = 0;

      const resetClickState = () => {
        clickCount = 0;
        card.classList.remove("click-pending");
      };

      const handleTrigger = () => {
        resetClickState();
        restoreConversationToFlow(conv);
      };

      // 绑定点击卡片事件：需左键连续点击两次或双击触发
      card.addEventListener("click", (e) => {
        if (e.target.closest(".message-card-close-btn")) {
          resetClickState();
          return;
        }
        if (e.button !== 0) return; // 仅限鼠标左键

        clickCount += 1;
        if (clickCount >= 2) {
          handleTrigger();
        } else {
          card.classList.add("click-pending");
        }
      });

      // 绑定双击事件兜底
      card.addEventListener("dblclick", (e) => {
        if (e.target.closest(".message-card-close-btn")) {
          resetClickState();
          return;
        }
        if (e.button !== 0) return;
        handleTrigger();
      });

      // 鼠标移出当前框体时重置点击计数与状态，移回后需重新点两次
      card.addEventListener("mouseleave", () => {
        resetClickState();
      });

      // 键盘回车或空格支持
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (!e.target.closest(".message-card-close-btn")) {
            e.preventDefault();
            handleTrigger();
          }
        }
      });

      // 绑定关闭 "×" 按钮事件 (仅在 UI 中隐藏，不删除底层数据)
      const closeBtn = card.querySelector(".message-card-close-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          resetClickState();
          card.classList.add("removing");
          setTimeout(() => {
            conversationHistoryService.hideConversation(conv.id);
          }, 160);
        });
      }

      return card;
    };

    /**
     * 计算文本的视觉字符权重长度
     * 汉字/全角字符按 1 计算，半角/英文/符号按 0.55 计算，保底 4
     */
    const getTextVisualLength = (text) => {
      if (!text || typeof text !== "string") return 4;
      let len = 0;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code > 255) {
          len += 1.0;
        } else {
          len += 0.55;
        }
      }
      return Math.max(4, len);
    };

    /**
     * 根据当前行各项的标题文本动态生成带补正的 CSS Grid 列定义
     * 规则：根据实际标题文本长度分配比例，添加补正使得任意两框体宽度比例不超过 1:2，自适应且避免越界
     */
    const computeAdaptiveGridColumns = (items) => {
      if (!items || items.length === 0) return "minmax(0, 280px)";
      if (items.length === 1) return "minmax(0, 280px)";

      const lengths = items.map((item) => {
        const title = item.title || item.query || "";
        return getTextVisualLength(title);
      });

      const minL = Math.min(...lengths);
      const maxL = Math.max(...lengths);

      // 若所有项长度一致或最小值为 0，则均分
      if (maxL <= minL || minL === 0) {
        return items.map(() => "minmax(0, 1fr)").join(" ");
      }

      // 最大比例上限限制在 2.0 (即比例不超过 1 : 2)
      const targetMaxRatio = Math.min(2.0, maxL / minL);

      // 将各项长度平滑映射至 [1.0, targetMaxRatio]
      const weights = lengths.map((l) => {
        const normalized = (l - minL) / (maxL - minL);
        const weight = 1.0 + normalized * (targetMaxRatio - 1.0);
        return Number(weight.toFixed(3));
      });

      return weights.map((w) => `minmax(0, ${w}fr)`).join(" ");
    };

    // 第 1 行：根据标题实际长度动态按比例（不超过1:2）分配自适应列宽
    messagesPrimaryRow.style.gridTemplateColumns = computeAdaptiveGridColumns(primaryItems);

    primaryItems.forEach((conv) => {
      messagesPrimaryRow.appendChild(createMessageCard(conv));
    });

    // 下方展开区域：每 4 个切分为一行，每行渐出耗时 1 秒，前一行完全显现后下一行再启动渐出 (--row-delay: 0s, 1s, 2s...)
    const rowChunkSize = 4;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 600;
    const bottomLimit = viewportHeight - 10;

    for (let i = 0; i < expandedItems.length; i += rowChunkSize) {
      const chunk = expandedItems.slice(i, i + rowChunkSize);
      const rowIndex = Math.floor(i / rowChunkSize); // 0: 第2行(0s~1s), 1: 第3行(1s~2s), 2: 第4行(2s~3s)...
      const rowEl = document.createElement("div");
      rowEl.className = "messages-expanded-row";
      rowEl.dataset.rowIndex = String(rowIndex);
      rowEl.style.setProperty("--row-delay", `${rowIndex * 1}s`);
      rowEl.style.gridTemplateColumns = computeAdaptiveGridColumns(chunk);

      chunk.forEach((conv) => {
        rowEl.appendChild(createMessageCard(conv));
      });

      messagesExpandedGrid.appendChild(rowEl);

      // 若当前行显示后，高度会超过界面底部，则到此为止、不再显示后续
      const rowRect = rowEl.getBoundingClientRect();
      if (rowRect.bottom > bottomLimit) {
        rowEl.remove();
        break;
      }
    }
  };

  conversationHistoryService.addEventListener("conversations-change", () => {
    renderConversationMessages();
  });

  // 监听窗口尺寸变化，自适应重算并更新历史讯息可展示的行数
  let drawerResizeTimer = null;
  window.addEventListener("resize", () => {
    if (drawerResizeTimer) clearTimeout(drawerResizeTimer);
    drawerResizeTimer = setTimeout(() => {
      renderConversationMessages();
    }, 100);
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

  api.showGlobalToast = showGlobalToast;
  api.updateMiniTaskCapsuleUI = updateMiniTaskCapsuleUI;
  api.closeTaskSidebar = closeTaskSidebar;
  api.renderTaskSidebarList = renderTaskSidebarList;
  api.restoreTaskToFlow = restoreTaskToFlow;
  api.renderTurnsIntoFlow = renderTurnsIntoFlow;
  api.archiveCurrentFlowToHistory = archiveCurrentFlowToHistory;
  api.renderConversationMessages = renderConversationMessages;
}
