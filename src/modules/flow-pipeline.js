import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { VIEW_FLOW } from "../lib/view-constants.js";
import { bus } from "../lib/event-bus.js";
import {
  isInteractiveExtensionUiRequest,
  isGracePeriodError,
  isTransientServiceError,
  resolveEventTaskId,
} from "../lib/contracts.js";
import { piClient, isAbortError } from "../services/pi-client.js";
import { configService } from "../services/config-service.js";
import { promptHistoryNavigator } from "../services/prompt-history.js";
import { invokeTauri } from "../services/tauri-bridge.js";
import { notificationService, isTransientRateLimitMessage } from "../services/notification-service.js";
import { taskManager, resolveTaskSessionIdentity } from "../services/task-manager.js";
import { sketchAlert, sketchConfirm } from "../services/sketch-modal.js";
import { modelFailoverEngine } from "../services/model-failover.js";
import { flowStore } from "../services/stores/flow-store.js";
import { flowView, resolveStreamTaskId } from "./flow-state-view.js";
import { bindAll } from "../lib/el-binder.js";
import {
  createToolPseudoRunningCard,
  getFriendlyToolName,
  createToolStepCard,
  renderToolBodyInnerHtml,
  updateToolBadge,
} from "./flow-render.js";

/**
 * 提问下发、工具调用事件、自愈引擎接入与发送拦截流水线
 */
export function initFlowPipeline(ctx) {
  const api = ctx.api;
  const viewStore = ctx.viewStore;
  const settingsStore = ctx.settingsStore;
  const flowView = ctx.flowView;
  const flowStore = ctx.flowStore;
  const attachmentsStore = ctx.attachmentsStore;
  const flowDom = ctx.flowDom;

  // 事件帧归属任务的纯数据分仓（事件处理器内调用；调用点均已过前台门禁）
  const streamData = (explicit) => flowStore.for(resolveStreamTaskId(explicit));

  // 批次 B：模块自绑定（searchInput / searchForm 跨簇共享 id，同 id 同元素）
  const el = bindAll({
    searchInput: "search-input",
    searchForm: "search-form",
  });

  const searchInput = el.searchInput;
  const searchForm = el.searchForm;
  const flowScrollArea = flowDom.flowScrollArea;
  const flowBtnAbort = flowDom.flowBtnAbort;

  const getSkillDisplayName = (skillName) => {
    switch (skillName) {
      case "windows-bash-compatibility":
        return "windows-bash-compatibility (Windows Shell 兼容规范)";
      case "document-multimodal-inspection":
        return "document-multimodal-inspection (多模态视检与文档解析规范)";
      case "multi-agent-orchestration":
        return "multi-agent-orchestration (多 Agent 并行协作规范)";
      case "web-search-silent-access":
        return "web-search-silent-access (静默联网搜索与摘要规范)";
      case "persistent-memory-retrieval":
        return "persistent-memory-retrieval (持久化记忆检索规范)";
      case "dynamic-workflows-orchestration":
        return "dynamic-workflows-orchestration (动态工作流编排规范)";
      case "active-context-pruning":
        return "active-context-pruning (长会话主动上下文修剪规范)";
      case "temp-file-hygiene":
        return "temp-file-hygiene (临时文件沙盒与即用即删规范)";
      case "tool-failure-logging":
        return "tool-failure-logging (工具调用失败细节日志记录规范)";
      default:
        return `${skillName} (运行态约束)`;
    }
  };


  const flowConversation = flowDom.flowConversation;

  /* ========== 「注入提示」信息框（路由目标项目胶囊下方，默认收起显示标题与注入数量） ==========
   * 展示所有在调用模型之前注入的上下文条目（Inner-Skill 运行态技能、
   * 路由工作区 AGENTS.md / README.md、命中技能与路由上下文信封等），
   * 随会话动态累积（按 Task 隔离、跨轮保留、按 kind+name 去重），全新会话时重置。
   * 会话流缓存铁律：每个 Task 一份独立注入缓存，切换任务或回入 Flow 时由 restoreInjectionNoticeFor 恢复。
   */
  const INJECTION_KIND_LABELS = {
    inner_skill: "Inner-Skill 运行态技能",
    agents_md: "AGENTS.md",
    readme_md: "README.md",
    routed_skill: "路由项目技能",
    routing_context: "路由工作区上下文",
  };

  const LEGACY_INJECTION_KEY = "__legacy_session__";
  // 按 Task 隔离的注入条目缓存仓：taskId -> Map<`${kind}::${name}`, { kind, name }>
  const sessionInjectionStores = new Map();

  const getInjectionStore = (taskId) => {
    const key = taskId || LEGACY_INJECTION_KEY;
    if (!sessionInjectionStores.has(key)) {
      sessionInjectionStores.set(key, new Map());
    }
    return sessionInjectionStores.get(key);
  };

  const injectionNotice = {
    el: null,
    listEl: null,
    countEl: null,
    chevronEl: null,
    renderedKeys: new Set(),
    collapsed: true,
  };

  const applyInjectionNoticeCollapsedState = () => {
    if (!injectionNotice.el) return;
    injectionNotice.el.classList.toggle("collapsed", injectionNotice.collapsed);
    if (injectionNotice.chevronEl) {
      injectionNotice.chevronEl.style.transform = injectionNotice.collapsed ? "" : "rotate(180deg)";
    }
  };

  const ensureInjectionNoticeEl = () => {
    if (!flowConversation) return null;
    if (!injectionNotice.el || !injectionNotice.el.isConnected) {
      injectionNotice.el = document.createElement("div");
      injectionNotice.el.className = "flow-injection-notice";
      injectionNotice.el.setAttribute("role", "status");
      injectionNotice.el.setAttribute("aria-live", "polite");
      injectionNotice.el.innerHTML = `
        <button type="button" class="injection-notice-header" aria-expanded="false">
          <span class="injection-notice-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
          <span class="injection-notice-title">注入提示</span>
          <span class="injection-notice-count"></span>
        </button>
        <ul class="injection-notice-list"></ul>
      `;
      injectionNotice.listEl = injectionNotice.el.querySelector(".injection-notice-list");
      injectionNotice.countEl = injectionNotice.el.querySelector(".injection-notice-count");
      injectionNotice.chevronEl = injectionNotice.el.querySelector(".injection-notice-chevron");
      injectionNotice.renderedKeys.clear();

      // 挂载定位：优先置于首个消息组的「路由目标项目」胶囊下方；
      // 无路由胶囊时置于首组用户提问卡下方；再次兜底置于组首/会话流顶部
      const firstGroup = flowConversation.querySelector(":scope > .flow-message-group");
      const routeCapsule = firstGroup?.querySelector(":scope > .flow-route-capsule:not(.hidden)");
      const promptCard = firstGroup?.querySelector(":scope > .flow-user-prompt-card");
      if (routeCapsule) {
        routeCapsule.after(injectionNotice.el);
      } else if (promptCard) {
        promptCard.after(injectionNotice.el);
      } else if (firstGroup) {
        firstGroup.insertBefore(injectionNotice.el, firstGroup.firstChild);
      } else {
        flowConversation.insertBefore(injectionNotice.el, flowConversation.firstChild);
      }

      // 默认收起：点击头部在收起态与完整清单间切换
      injectionNotice.el
        .querySelector(".injection-notice-header")
        .addEventListener("click", () => {
          injectionNotice.collapsed = !injectionNotice.collapsed;
          injectionNotice.el
            ?.querySelector(".injection-notice-header")
            ?.setAttribute("aria-expanded", injectionNotice.collapsed ? "false" : "true");
          applyInjectionNoticeCollapsedState();
        });
      applyInjectionNoticeCollapsedState();
    }
    return injectionNotice.el;
  };

  const updateInjectionNoticeCount = (count = null) => {
    if (injectionNotice.countEl) {
      const actualCount = typeof count === "number" ? count : injectionNotice.renderedKeys.size;
      injectionNotice.countEl.textContent = actualCount > 0 ? `${actualCount} 项` : "";
    }
  };

  /** 从给定条目清单全量回填前台提示框 DOM */
  const renderInjectionNoticeItems = (items) => {
    const noticeEl = ensureInjectionNoticeEl();
    if (!noticeEl || !injectionNotice.listEl) return;
    injectionNotice.listEl.innerHTML = "";
    injectionNotice.renderedKeys.clear();

    items.forEach((item) => {
      if (!item?.kind || !item?.name) return;
      const key = `${item.kind}::${item.name}`;
      if (injectionNotice.renderedKeys.has(key)) return;
      injectionNotice.renderedKeys.add(key);
      const displayName = item.kind === "inner_skill" ? getSkillDisplayName(item.name) : item.name;
      const itemEl = document.createElement("li");
      itemEl.className = "injection-notice-item";
      itemEl.innerHTML = `
        <span class="item-kind">${escapeHtml(INJECTION_KIND_LABELS[item.kind] || item.kind)}</span>
        <span class="item-name">${escapeHtml(displayName)}</span>
      `;
      injectionNotice.listEl.appendChild(itemEl);
    });
    updateInjectionNoticeCount(injectionNotice.renderedKeys.size);
  };

  /** 向「注入提示」信息框追加一条注入条目（按 Task 归仓，kind+name 去重，跨轮累积） */
  const addInjectionNoticeItem = (kind, name, taskId = null) => {
    if (!kind || !name) return;
    const targetTaskId =
      taskId ||
      taskManager.currentActiveTaskId ||
      piClient.lastEventTaskId ||
      LEGACY_INJECTION_KEY;

    const store = getInjectionStore(targetTaskId);
    const key = `${kind}::${name}`;
    if (!store.has(key)) {
      store.set(key, { kind, name });
    }

    // 同步至 Task 结构体，支持历史记录持久化与切换回填
    const task = taskManager.getTask(targetTaskId);
    if (task) {
      task.injectedItems = Array.from(store.values());
    }

    // 串轮过滤铁律：仅当目标任务为当前前台活跃任务时，才直接更新前台 Flow DOM
    if (taskManager.isForegroundStreamTask(targetTaskId)) {
      const noticeEl = ensureInjectionNoticeEl();
      if (noticeEl && injectionNotice.listEl && !injectionNotice.renderedKeys.has(key)) {
        injectionNotice.renderedKeys.add(key);
        const displayName = kind === "inner_skill" ? getSkillDisplayName(name) : name;
        const itemEl = document.createElement("li");
        itemEl.className = "injection-notice-item";
        itemEl.innerHTML = `
          <span class="item-kind">${escapeHtml(INJECTION_KIND_LABELS[kind] || kind)}</span>
          <span class="item-name">${escapeHtml(displayName)}</span>
        `;
        injectionNotice.listEl.appendChild(itemEl);
        updateInjectionNoticeCount(injectionNotice.renderedKeys.size);
        // 仅吸底跟随开启时随内容定位到底部，向上滚离后不打断浏览
        if (flowScrollArea && flowView.followBottom !== false) {
          flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
        }
      }
    }
  };

  /**
   * 按 Task 恢复「注入提示」信息框（会话流缓存铁律，由 renderTurnsIntoFlow 回填调用）
   * @param {string} taskId
   */
  const restoreInjectionNoticeFor = (taskId) => {
    if (!taskId) return;
    const store = sessionInjectionStores.get(taskId);
    const task = taskManager.getTask(taskId);
    let items = [];
    if (store && store.size > 0) {
      items = Array.from(store.values());
    } else if (Array.isArray(task?.injectedItems) && task.injectedItems.length > 0) {
      items = task.injectedItems;
      const s = getInjectionStore(taskId);
      items.forEach((item) => {
        if (item?.kind && item?.name) s.set(`${item.kind}::${item.name}`, item);
      });
    }

    if (items.length > 0) {
      renderInjectionNoticeItems(items);
    } else {
      if (injectionNotice.el && injectionNotice.el.isConnected) {
        injectionNotice.el.remove();
      }
      injectionNotice.el = null;
      injectionNotice.listEl = null;
      injectionNotice.countEl = null;
      injectionNotice.chevronEl = null;
      injectionNotice.renderedKeys.clear();
    }
  };

  api.restoreInjectionNoticeFor = restoreInjectionNoticeFor;

  /** 全新会话时重置「注入提示」信息框（DOM 随 flowConversation 清空一并移除） */
  const resetInjectionNotice = (taskId = null) => {
    if (injectionNotice.el && injectionNotice.el.isConnected) {
      injectionNotice.el.remove();
    }
    injectionNotice.el = null;
    injectionNotice.listEl = null;
    injectionNotice.countEl = null;
    injectionNotice.chevronEl = null;
    injectionNotice.renderedKeys.clear();
    injectionNotice.collapsed = true;

    if (taskId) {
      sessionInjectionStores.delete(taskId);
    } else if (taskManager.currentActiveTaskId) {
      sessionInjectionStores.delete(taskManager.currentActiveTaskId);
    }
  };

  api.resetInjectionNotice = resetInjectionNotice;

  // 后端真实注入广播：inject_prompt（兑底 Inner-Skill + code-area 路由上下文）
  // 每次真实注入后携带条目清单广播，前端逐条追加至「注入提示」框
  piClient.addEventListener("context-injected", (e) => {
    const detail = e.detail || {};
    const targetTaskId =
      detail.task_id ||
      detail.taskId ||
      taskManager.currentActiveTaskId ||
      piClient.lastEventTaskId ||
      LEGACY_INJECTION_KEY;

    const items = detail.items;
    if (Array.isArray(items)) {
      items.forEach((item) => {
        if (item?.kind && item?.name) {
          addInjectionNoticeItem(item.kind, item.name, targetTaskId);
        }
      });
    }
  });

  // Tool-call Hook 命中：Inner-Skill 动态激活（steer 即时或兑底入队）即同步至「注入提示」框
  piClient.addEventListener("inner-skill-activated", (e) => {
    const detail = e.detail || {};
    const targetTaskId =
      detail.task_id ||
      detail.taskId ||
      taskManager.currentActiveTaskId ||
      piClient.lastEventTaskId ||
      LEGACY_INJECTION_KEY;

    const skillName = detail.skill;
    if (skillName) {
      addInjectionNoticeItem("inner_skill", skillName, targetTaskId);
    }
  });

  // 最近一次已宣布触发弧光高亮的工具调用 ID（避免 toolcall-delta-start 与 tool-start 双重触发）
  let lastAnnouncedToolCallId = null;

  /**
   * 辅助：确保当前存在“伪工具运行框”占位卡（工具参数流式期空窗辅助显示）
   * 对齐伪思考框机制：toolcall-delta-start 即插入「工具调用... + 读秒 + running」单行卡，
   * 参数流式结束 (toolcall_end) 后回填真实工具名，真实工具卡创建 (tool-start) 时移除。
   */
  const ensureActiveToolPseudoStep = () => {
    if (flowView.activeToolPseudoStep) return flowView.activeToolPseudoStep;

    const pCard = createToolPseudoRunningCard({ durationText: "(0.0s)..." });
    if (flowView.activeTurnRefs?.stepsContainerEl) {
      flowView.activeTurnRefs.stepsContainerEl.appendChild(pCard.cardEl);
    }

    const pseudoItem = {
      type: "tool-pseudo",
      name: "",
      startTime: Date.now(),
      cardEl: pCard.cardEl,
      titleEl: pCard.titleEl,
      durationEl: pCard.durationEl,
    };
    flowView.activeToolPseudoStep = pseudoItem;

    if (!flowView.toolPseudoTimerInterval) {
      flowView.toolPseudoTimerInterval = setInterval(() => {
        if (flowView.activeToolPseudoStep?.durationEl) {
          const elapsed = ((Date.now() - flowView.activeToolPseudoStep.startTime) / 1000).toFixed(1);
          flowView.activeToolPseudoStep.durationEl.textContent = `(${elapsed}s)...`;
        }
      }, 100);
    }

    return pseudoItem;
  };

  /**
   * 辅助：回填伪工具运行框的真实工具名（toolcall_end 携带 toolCall.name 时）
   */
  const updateToolPseudoName = (toolName) => {
    if (!flowView.activeToolPseudoStep || !toolName) return;
    const friendly = getFriendlyToolName(toolName);
    if (flowView.activeToolPseudoStep.titleEl) {
      flowView.activeToolPseudoStep.titleEl.textContent = `工具调用(${friendly})`;
    }
  };

  /**
   * 辅助：移除伪工具运行框（真实工具卡已就位或流式状态重置/结束时）
   */
  const removeActiveToolPseudoStep = () => {
    const pseudo = flowView.activeToolPseudoStep;
    if (!pseudo) return;
    flowView.activeToolPseudoStep = null;
    if (flowView.toolPseudoTimerInterval) {
      clearInterval(flowView.toolPseudoTimerInterval);
      flowView.toolPseudoTimerInterval = null;
    }
    pseudo.cardEl?.remove();
  };

  /**
   * 辅助：启动/接管真实工具卡片的读秒计时 (Running 文本 + 递增读秒)
   */
  const startToolRunTimer = () => {
    if (flowView.toolRunTimerInterval) {
      clearInterval(flowView.toolRunTimerInterval);
      flowView.toolRunTimerInterval = null;
    }
    flowView.toolRunTimerInterval = setInterval(() => {
      const step = flowView.activeToolStep;
      if (!step?.durationEl || step.status !== "running") return;
      const elapsed = ((Date.now() - step.startTime) / 1000).toFixed(1);
      step.durationText = `(${elapsed}s)...`;
      step.durationEl.textContent = step.durationText;
    }, 100);
  };

  piClient.addEventListener("toolcall-delta-start", (e) => {
    if (!isForegroundStreamEvent()) return;
    // 模型恢复输出：立即撤销流中断宽容期并清除错误态（若有）
    if (typeof api.resolveStreamInterruption === "function") {
      api.resolveStreamInterruption(piClient.lastEventTaskId);
    }
    checkResolveFailoverSuccess();
    // 阶段性输出判定铁律：模型输出一段文字后进入工具调用状态（工具参数流式开始即视为进入），
    // 先封口该段文字为 Point 卡，再进入工具调用切片（tool-start 处的封口为幂等兜底）
    if (typeof api.sealActivePhaseOutput === "function") {
      api.sealActivePhaseOutput();
    }
    // 工具参数流式开始说明思考阶段已正式结束：提前结算思维切片，避免参数生成期思维读秒继续空跑，
    // 且保留无思考文本直接调用工具时的思维卡（展示为“已完成思考”）
    if (typeof api.sealActiveThinkingStep === "function") {
      api.sealActiveThinkingStep({ preserveForTool: true });
    }
    api.autoCollapseThinkingOnNextPhase();
    // 伪工具运行框：参数流式期空窗即时呈现「工具调用... + 读秒 + running」
    ensureActiveToolPseudoStep();
    // 触发新一轮工具调用事件（通知额度图标弧光高亮）
    const deltaToolId = e.detail?.toolCallId || e.detail?.id || `delta_${Date.now()}`;
    lastAnnouncedToolCallId = deltaToolId;
    bus.emit("flow:step-start", {
      type: "tool",
      taskId: piClient.lastEventTaskId || taskManager.getCurrentActiveTask()?.id || null,
    });
  });

  piClient.addEventListener("toolcall-delta-end", (e) => {
    if (!isForegroundStreamEvent()) return;
    // 参数流式结束：回填真实工具名（工具调用(edit)）
    updateToolPseudoName(e.detail?.name || e.detail?.toolCall?.name);
  });

  piClient.addEventListener("tool-start", (e) => {
    if (!isForegroundStreamEvent()) return;
    // 模型恢复输出：立即撤销流中断宽容期并清除错误态（若有）
    if (typeof api.resolveStreamInterruption === "function") {
      api.resolveStreamInterruption(piClient.lastEventTaskId);
    }
    checkResolveFailoverSuccess();
    streamData(piClient.lastEventTaskId).set({ hasReceivedDelta: true });
    const data = e.detail;
    const toolCallId = data.toolCallId;
    const toolName = data.toolName || "tool";

    // 若此前未经过 toolcall-delta-start 阶段（例如非流式直接进入 tool-start），补发新一轮工具调用事件
    if (!lastAnnouncedToolCallId || (toolCallId && toolCallId !== lastAnnouncedToolCallId)) {
      lastAnnouncedToolCallId = toolCallId;
      bus.emit("flow:step-start", {
        type: "tool",
        taskId: piClient.lastEventTaskId || taskManager.getCurrentActiveTask()?.id || null,
      });
    }

    // 工具开始时，结算或清理当前活跃的思维切片（带有 preserveForTool: true 幂等兜底）
    if (typeof api.sealActiveThinkingStep === "function") {
      api.sealActiveThinkingStep({ preserveForTool: true });
    }

    // 工具开始前，封口当前活跃的阶段性输出切片 (Point 卡)：
    // 将已累积的中间段文本折叠进步骤流，保持「思维1-Point1-工具1-Point2...」时序因果链
    if (typeof api.sealActivePhaseOutput === "function") {
      api.sealActivePhaseOutput();
    }

    // 累计耗时铁律：继承伪工具运行框的起始时间（包含大模型构思与生成工具参数的延时）
    const initialStartTime = flowView.activeToolPseudoStep?.startTime || Date.now();
    const initialElapsed = ((Date.now() - initialStartTime) / 1000).toFixed(1);

    // 伪工具运行框已完成使命：真实工具名已知，移除占位卡
    removeActiveToolPseudoStep();

    // 创建单行极简工具卡片（默认折叠，任何时候不自动展开）
    const toolStep = createToolStepCard({
      id: toolCallId,
      name: toolName,
      args: data.args,
      status: "running",
      durationText: `(${initialElapsed}s)...`,
      isOpen: false,
    });

    const card = toolStep?.cardEl || document.createElement("div");
    if (!toolStep) {
      card.className = "flow-step-card flow-step-tool tool-card collapsed running";
      card.id = `tool-${toolCallId}`;
      const argsStr = data.args ? JSON.stringify(data.args, null, 2) : "";
      card.innerHTML = `
        <div class="flow-step-header tool-header" role="button" tabindex="0" aria-expanded="false">
          <div class="flow-step-header-left">
            <span class="flow-step-icon tool-icon" aria-hidden="true">${ICONS.tool}</span>
            <span class="flow-step-title tool-name">${escapeHtml(getFriendlyToolName(toolName))}</span>
          </div>
          <div class="flow-step-header-right tool-header-right">
            <span class="flow-step-duration tool-duration">(${initialElapsed}s)...</span>
            <span class="tool-status-badge running">running</span>
            <span class="flow-step-arrow tool-collapse-arrow" aria-hidden="true">${ICONS.chevronDown}</span>
          </div>
        </div>
        <div class="flow-step-body tool-body">${escapeHtml(argsStr)}</div>
      `;
    }

    if (flowView.activeTurnRefs?.stepsContainerEl) {
      flowView.activeTurnRefs.stepsContainerEl.appendChild(card);
    } else if (flowView.activeTurnRefs?.toolCallsContainerEl) {
      flowView.activeTurnRefs.toolCallsContainerEl.appendChild(card);
    }

    flowView.renderedToolCards.set(toolCallId, card);

    const stepItem = {
      type: "tool",
      id: toolCallId,
      name: toolName,
      args: data.args,
      status: "running",
      result: null,
      startTime: initialStartTime,
      durationText: `(${initialElapsed}s)...`,
      cardEl: card,
      badgeEl: toolStep?.badgeEl || card.querySelector(".tool-status-badge"),
      durationEl: toolStep?.durationEl || card.querySelector(".flow-step-duration") || card.querySelector(".tool-duration"),
      previewEl: toolStep?.previewEl || card.querySelector(".flow-step-preview"),
      bodyEl: toolStep?.bodyEl || card.querySelector(".flow-step-body") || card.querySelector(".tool-body"),
    };

    flowView.activeToolStep = stepItem;
    if (!Array.isArray(flowView.currentSteps)) {
      flowView.currentSteps = [];
    }
    flowView.currentSteps.push(stepItem);
    startToolRunTimer();
    // 仅吸底跟随开启时随内容定位到底部，向上滚离后不打断浏览
    if (flowScrollArea && flowView.followBottom !== false) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  });

  piClient.addEventListener("tool-update", (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail;
    let card = flowView.renderedToolCards.get(data.toolCallId);
    // H26 兜底自愈：若 Map 中未命中，尝试从 DOM ID 动态检索并自愈回填
    if (!card && data.toolCallId) {
      card = document.getElementById(`tool-${data.toolCallId}`) || document.getElementById(data.toolCallId);
      if (card) {
        flowView.renderedToolCards.set(data.toolCallId, card);
      }
    }
    const matchingStep = Array.isArray(flowView.currentSteps)
      ? flowView.currentSteps.find((s) => s.type === "tool" && s.id === data.toolCallId)
      : null;
    if (matchingStep) {
      matchingStep.result = data.partialResult;
    }
    if (card) {
      const body = card.querySelector(".flow-step-body") || card.querySelector(".tool-body");
      if (body) {
        body.innerHTML = renderToolBodyInnerHtml(matchingStep?.args, data.partialResult);
      }
    }
  });

  piClient.addEventListener("tool-end", (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail;
    let card = flowView.renderedToolCards.get(data.toolCallId);
    // H26 兜底自愈：若 Map 中未命中，尝试从 DOM ID 动态检索并自愈回填
    if (!card && data.toolCallId) {
      card = document.getElementById(`tool-${data.toolCallId}`) || document.getElementById(data.toolCallId);
      if (card) {
        flowView.renderedToolCards.set(data.toolCallId, card);
      }
    }
    const isError = Boolean(data.isError);
    const statusText = isError ? "failure" : "done";

    const matchingStep = Array.isArray(flowView.currentSteps)
      ? flowView.currentSteps.find((s) => s.type === "tool" && s.id === data.toolCallId)
      : null;
    if (matchingStep) {
      matchingStep.status = statusText;
      matchingStep.result = data.result;
      matchingStep.is_error = isError;
      // 定格工具执行读秒 (Running -> done/failed)，累计工具参数延时与执行耗时
      const elapsed = ((Date.now() - (matchingStep.startTime || Date.now())) / 1000).toFixed(1);
      matchingStep.durationText = `(${elapsed}s)`;
      if (matchingStep.durationEl) {
        matchingStep.durationEl.textContent = matchingStep.durationText;
      } else if (card) {
        let durEl = card.querySelector(".flow-step-duration") || card.querySelector(".tool-duration");
        if (!durEl) {
          const rightHeader = card.querySelector(".flow-step-header-right");
          if (rightHeader) {
            durEl = document.createElement("span");
            durEl.className = "flow-step-duration tool-duration";
            rightHeader.insertBefore(durEl, rightHeader.firstChild);
          }
        }
        if (durEl) {
          durEl.textContent = matchingStep.durationText;
        }
      }
    }

    if (flowView.toolRunTimerInterval) {
      clearInterval(flowView.toolRunTimerInterval);
      flowView.toolRunTimerInterval = null;
    }
    lastAnnouncedToolCallId = null;

    if (card) {
      card.classList.remove("running");
      card.classList.remove("done", "error", "failed", "failure");
      card.classList.add(isError ? "failed" : "done");
      if (isError) card.classList.add("error");

      const badge = card.querySelector(".tool-status-badge");
      if (badge) {
        updateToolBadge(badge, statusText);
      }

      const body = card.querySelector(".flow-step-body") || card.querySelector(".tool-body");
      if (body) {
        body.innerHTML = renderToolBodyInnerHtml(matchingStep?.args, data.result);
      }
    }

    if (flowView.activeToolStep?.id === data.toolCallId) {
      flowView.activeToolStep = null;
    }
    // 兼容漏收 tool-start 的异常流：兜底清理可能残留的伪工具运行框
    removeActiveToolPseudoStep();

    // 沿用“伪思考框”机制：工具调用结束后立即重新触发 Thinking (0.0s)... 占位卡片，
    // 覆盖工具结果回传后到下一轮模型响应首个事件（thinking-start / text-start）之间的空窗期；
    // 若模型随后直接输出正文或本轮就此结束，由 text-start / finalizeStream 的伪框清理逻辑自动移除
    if (piClient.isStreaming && typeof api.ensureActiveThinkingStep === "function") {
      api.ensureActiveThinkingStep();
      // 仅吸底跟随开启时随内容定位到底部，向上滚离后不打断浏览
      if (flowScrollArea && flowView.followBottom !== false) {
        flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
      }
    }
  });

  piClient.addEventListener("retry-status", (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail;
    // 引擎接管自愈时，内核内置 3 次快速重试降级为内部静默，不再覆盖耗时位展示
    if (modelFailoverEngine.isActive()) return;
    if (flowView.activeTurnRefs?.thinkingDurationEl && data.attempt) {
      flowView.activeTurnRefs.thinkingDurationEl.textContent = `自动重试中 (${data.attempt}/${data.maxAttempts || 3})...`;
    }
  });

  // 注：agent-start 不再向 notificationService 注册幻影任务 "agent-prompt"——
  // TaskManager.createTask 已用真实 taskId 注册，幻影 ID 永不注销会导致 hasRunningTasks()
  // 恒为 true，成功完成通知 (notifyAgentCompleted) 被永久静默拦截

  piClient.addEventListener("extension-ui", (e) => {
    const data = e?.detail || {};

    // 仅当扩展插件发出真正需要人工介入与交互确认的请求（如 confirm/prompt/select/input/form 等）时，
    // 且处于非聚焦状态才触发系统通知；常规的 setWidget / setStatus / notify(info) 等被动组件更新绝不触发人工介入通知
    // 交互判定唯一源见 src/lib/contracts.js（阶段 8 消除双份常量）
    if (isInteractiveExtensionUiRequest(data)) {
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
  // 自动强制重连引擎 (ModelFailoverEngine) 接入
  // 无痕内置重连：隐藏「模型XXX异常」窗体，后台静默续发「继续」文本，最多 10 次
  // ==========================================================================
  const failoverHooks = {
    // 同 Turn 复用当前轮次：重置流式缓冲但保留既有步骤/工具卡片，后台静默续发「继续」
    // (不重建提问卡、不重复压入 prompt history、不新建 Task，用户全程无感知)
    // 前后台双轨：前台任务重置轮次容器并重建「首 token 延迟」读秒伪框；
    // 后台挂起任务无前台轮次 DOM，跳过重置仅做数据层静默续发
    onResendAttempt: (taskId) => {
      if (taskManager.isForegroundStreamTask(taskId)) {
        api.resetCurrentTurnForResend(taskId);
      }
      const { sessionPath, sessionId } = resolveTaskSessionIdentity(taskManager.getTask(taskId));
      return piClient.sendPrompt("继续", null, null, taskId, sessionPath, sessionId);
    },
    // 10 次内置重连全部耗尽仍失败：前台渲染「模型XXX异常」错误卡并追加内置重连摘要；
    // 后台挂起任务无前台 Flow DOM，走 TaskManager 统一错误结算通道落定 error 终态
    onGiveUp: (errDetail, summary) => {
      const detail = { ...(errDetail || {}) };
      if (summary && summary.reconnectCount > 0) {
        detail.failoverSummary = summary;
      }
      const failTaskId = modelFailoverEngine.taskId;
      if (failTaskId && !taskManager.isForegroundStreamTask(failTaskId)) {
        taskManager.failTask(failTaskId, detail.message || "模型调用发生异常");
        return;
      }
      api.renderErrorCard(detail);
    },
    // 自愈成功：仅清除错误卡片与错误状态，绝不提前结束流式！真正的收尾留给 agent-end 自然触发
    // （仅前台任务存在可清除的错误状态 DOM；后台任务严禁触碰前台视图缓存）
    onSuccess: (payload = {}) => {
      if (taskManager.isForegroundStreamTask(payload.taskId) && typeof api.clearTurnErrorState === "function") {
        api.clearTurnErrorState();
      }
    },
  };

  /**
   * 首响应即时自愈结算：模型一旦恢复正常产生响应（思考/正文/工具），若自愈引擎活跃立即结算成功
   */
  const checkResolveFailoverSuccess = () => {
    if (modelFailoverEngine.isActive() && isForegroundStreamEvent()) {
      modelFailoverEngine.resolveTurnSuccess(piClient.lastEventTaskId);
    }
  };

  piClient.addEventListener("agent-error", (e) => {
    // 手动终止 / 中断类错误：绝不渲染错误卡，绝对不能触发自动内置重连
    if (isAbortError(e.detail)) {
      return;
    }

    const errTaskId = resolveEventTaskId(e.detail, piClient.lastEventTaskId);
    const isForeground = taskManager.isForegroundStreamTask(errTaskId);
    // 内置重连引擎是否正在服务该任务（后台挂起任务同样需要引擎结算在途尝试）
    const engineOwnsTask =
      modelFailoverEngine.isActive() &&
      (!modelFailoverEngine.taskId || String(modelFailoverEngine.taskId) === String(errTaskId));

    // 检查所属 Task 是否已处于中止状态或在中止黑名单中（前后台一致门禁）
    if (modelFailoverEngine.isTaskAborted(errTaskId)) {
      return;
    }
    if (errTaskId) {
      const task = taskManager.getTask(errTaskId);
      if (task && (task.status === "aborted" || task.isAborted)) {
        return;
      }
    }

    // 内置重连耗尽终态：错误卡已弹出后，同任务重复错误帧
    // (一次失败 run 会经 message_end/turn_end/agent_end/agent_settled 多次派发 agent-error)
    // 绝不再次自动冷启动、也不重复渲染错误卡；仅用户手动重试/新提问 (clearTaskAborted) 后重置
    if (modelFailoverEngine.isTaskExhausted(errTaskId)) {
      return;
    }
    // 无归属错误帧：近期发生过手动终止时保守静默 (手动终止全链路禁止触发内置重连)
    if (!errTaskId && modelFailoverEngine.hasRecentGlobalAbortion()) {
      return;
    }

    // 「终止并发送」进行中：旧轮报错视为已结算，不渲染错误卡、不进入自愈
    // （interruptSendTaskId 写入/读取均在 errTaskId 自己的分仓上，跨任务切换不串档）
    const errFs = flowStore.for(resolveStreamTaskId(errTaskId));
    if (errFs.interruptSendTaskId) {
      if (!errTaskId || errTaskId === errFs.interruptSendTaskId) {
        return;
      }
    }

    const autoReconnectEnabled = configService.getAutoReconnectSwitch();
    const isRateLimit =
      isTransientRateLimitMessage(e.detail?.message) ||
      isTransientRateLimitMessage(e.detail?.raw?.errorMessage);

    if (modelFailoverEngine.isActive()) {
      // 引擎活跃中：仅当错误属于引擎当前任务时热结算该在途尝试（含 RPC/扩展错误）；
      // 其他任务的错误交由 TaskManager 按其自身状态结算，绝不跨任务误结算、也绝不提前渲染错误卡打断自愈
      if (engineOwnsTask) {
        modelFailoverEngine.handleModelError(e.detail, failoverHooks);
      }
      return;
    }
    // 铁律：自动强制重连未勾选时，一票否决！任何错误（含速率限制）一律严禁进入重连流水线，直接渲染错误卡
    if (autoReconnectEnabled && (modelFailoverEngine.canHandle(e.detail) || isRateLimit)) {
      // 冷启动：自动强制重连开启且错误含模型上下文（或命中 TPM/RPM 速率限制）→ 统一交由引擎内置重连，绝不降级渲染错误卡。
      // 前台与后台挂起任务一视同仁：后台任务错误原被前台门禁拦截导致引擎永不启动，
      // 随后被 agent_end 误标 completed 且历史归档链路断裂（BUG2 根因）
      modelFailoverEngine.handleModelError(e.detail, failoverHooks);
    } else if (isForeground) {
      // 引擎不接管：仅前台渲染错误卡；后台任务交由 TaskManager 原生错误结算通道
      // 流中断宽容期（黄色倒计时等待）：瞬态可恢复错误一律不立即弹红色错误卡。
      // §6.1 的 isGracePeriodError 命中内核流截断/推理瞬时失败三短语；
      // isTransientServiceError 覆盖更广的「连接异常 / 服务异常」（超时、断连、
      // 502/503/504、fetch failed、速率限制…）：Pi 内核底层往往仍在重试，
      // 过一会即恢复输出；立即弹红框会把 Task 提前置 error 终态并隐藏终止按钮，
      // 内核随后恢复的输出被前台门禁拦截 → 红框永久滞留、按钮反复重建点击落空
      // （BUG1/BUG2）。改给 300 秒黄色等待窗口：恢复即静默撤销，仅超时才弹红框。
      if (isGracePeriodError(e.detail) || isTransientServiceError(e.detail)) {
        // 宽容期胶囊在极早时点可能尚未挂载（轮次 DOM 未建立）：回退直接弹红框，杜绝错误被静默吞掉
        if (api.handleStreamInterruption(e.detail)) return;
      }
      api.renderErrorCard(e.detail);
    }
  });

  piClient.addEventListener("agent-end", (e) => {
    const endTaskId = resolveEventTaskId(e.detail, piClient.lastEventTaskId);
    const isForeground = taskManager.isForegroundStreamTask(endTaskId);
    // 自动重连引擎接管铁律：若自愈引擎当前正服务该任务（处于退避等待、后台续发或失败延迟）：
    // 1. 若无在途重发尝试（!hasInflightAttempt），本帧属于刚刚被引擎接管的失败轮次的残余收口帧；
    // 2. 若存在在途重发尝试（hasInflightAttempt），由引擎结算该尝试结果；
    // 无论前台还是后台，只要引擎处于活跃接管状态，本帧绝不能穿透流向 api.finalizeStream 与归档，
    // 必须立即拦截 return，杜绝失败轮次 agent-end 误将前台流式界面瞬间终结并切断会话流！
    const engineOwnsTask =
      modelFailoverEngine.isActive() &&
      (!modelFailoverEngine.taskId || String(modelFailoverEngine.taskId) === String(endTaskId));
    if (engineOwnsTask) {
      if (modelFailoverEngine.hasInflightAttempt()) {
        modelFailoverEngine.resolveTurnSuccess(endTaskId);
      }
      return;
    }
    // 后台挂起任务的结束帧：不触发前台收尾与归档，仅由 TaskManager 结算数据
    if (!isForeground) {
      return;
    }
    // 「终止并发送」进行中：旧轮结算由 interrupt-send 流水线接管，跳过收尾与归档
    const endFs = flowStore.for(resolveStreamTaskId(piClient.lastEventTaskId));
    if (endFs.interruptSendTaskId) {
      const endTaskId = e.detail?.task_id || e.detail?.taskId;
      if (!endTaskId || endTaskId === endFs.interruptSendTaskId) {
        return;
      }
    }
    // 流中断宽容期收口：模型流虽无 finish_reason 但已真实产出内容（正文/思维/工具），
    // 视为已恢复正常——撤销黄色等待胶囊，交由下方正常收尾与归档，杜绝无谓的 300 秒空等；
    // 未产出任何内容的空轮保持等待，留给宽容期超时后再弹出红色提醒卡
    if (typeof api.resolveStreamInterruption === "function" && (endFs.responseText || endFs.hasReceivedDelta)) {
      api.resolveStreamInterruption(resolveEventTaskId(e.detail, piClient.lastEventTaskId));
    }
    // 完成后收起所有工具卡片（最终输出卡不收起）
    api.collapseAllToolCards();
    api.finalizeStream(resolveEventTaskId(e.detail, piClient.lastEventTaskId));
    api.archiveCurrentFlowToHistory();
    // 会话完成后展示「文件变更」收纳框（新增/修改的文件，点击可打开所在文件夹）
    if (typeof api.showFileChangesBox === "function") {
      api.showFileChangesBox();
    }
  });

  /**
   * 等待指定 Task 的当前轮次结算（agent-end / agent_settled / agent-error，超时兜底）
   * 监听器须在发起 abort 之前注册，避免结算事件先于等待窗口到达而永久悬挂
   * @param {string} taskId
   * @param {number} [timeoutMs=6000]
   * @returns {Promise<void>}
   */
  const waitForTurnSettled = (taskId, timeoutMs = 6000) => {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        piClient.removeEventListener("agent-end", onEnd);
        piClient.removeEventListener("agent-error", onErr);
        resolve();
      };
      const isTargetTask = (detail) => {
        const tid = detail?.task_id || detail?.taskId || detail?.raw?.task_id;
        return !tid || tid === taskId;
      };
      const onEnd = (e) => {
        if (isTargetTask(e.detail)) finish();
      };
      const onErr = (e) => {
        if (isTargetTask(e.detail)) finish();
      };
      piClient.addEventListener("agent-end", onEnd);
      piClient.addEventListener("agent-error", onErr);
      const timer = setTimeout(finish, timeoutMs);
    });
  };

  /**
   * 触发用户提问并向 Pi 下发指令（支持同一 Flow 多轮会话工作流、注入文件绝对路径与多任务隔离）
   * @param {string} query
   * @param {Array<any>} [filesToAttach=[]]
   */
  const handleFlowQuery = async (query, filesToAttach = []) => {
    if (!query && filesToAttach.length === 0) return;

    if (!piClient.hasKernel()) {
      await sketchAlert("未检测到 Pi 内核，无法执行对话指令。\n请前往「设置 ➔ 内核」面板一键下载安装最新内核。", {
        type: "warning",
        title: "未检测到内核",
      });
      return;
    }

    // 运行中提交拦截：同一 Flow 的当前轮仍在生成（思考/流式/工具执行/待确认）时，
    // 弹窗让用户选择「等待完成」或「终止并发送」。
    // 「终止并发送」先取消自愈流水线 → 后端 abort → 等待旧轮结算 → 再走正常多轮下发，
    // 彻底杜绝旧轮流式残留混入新轮、Task 提前置终态与历史提前归档等竞态
    const currentRunningTask =
      viewStore.mode === VIEW_FLOW
        ? (() => {
          const t = taskManager.getCurrentActiveTask();
          if (!t) return null;
          return t.status === "thinking" ||
            t.status === "streaming" ||
            t.status === "tool_exec" ||
            t.status === "paused" ||
            (modelFailoverEngine.isActive() && (!modelFailoverEngine.taskId || modelFailoverEngine.taskId === t.id))
            ? t
            : null;
        })()
        : null;

    if (currentRunningTask) {
      const userConfirm = await sketchConfirm(
        "上一轮对话仍在生成中（思考 / 流式输出 / 工具执行）。\n「终止并发送」将立即中断当前生成并发送新提问；「等待完成」则保留输入内容，待当前轮次结束后再发送。",
        {
          title: "上一轮仍在生成中",
          type: "confirm",
          confirmText: "终止并发送",
          cancelText: "等待完成",
          isDanger: true,
        }
      );
      if (!userConfirm) {
        // 等待完成：输入内容原样保留，仅回焦输入框
        if (searchInput) {
          searchInput.focus();
          const len = searchInput.value.length;
          searchInput.setSelectionRange(len, len);
        }
        return;
      }

      // 用户确认中断旧轮：取消自愈流水线 → 先注册结算监听 → 后端 abort → 等待结算
      modelFailoverEngine.cancel("new-query");
      const interruptTaskId = currentRunningTask.id;
      // 中断标记写入该任务自己的分仓：agent-error/agent-end 按任务键比对，跨任务切换不串档
      flowStore.for(interruptTaskId).set({ interruptSendTaskId: interruptTaskId });
      currentRunningTask.pendingInterruptSend = true;
      bus.emit("ui:toast", { text: "正在终止当前生成，即将发送新提问…", duration: 1500 });
      const settledPromise = waitForTurnSettled(interruptTaskId);
      try {
        await piClient.abort(interruptTaskId);
      } catch (_) {
        // abort 失败（子进程已退出等）不阻塞，由超时兜底继续
      }
      await settledPromise;
      flowStore.for(interruptTaskId).set({ interruptSendTaskId: null });
      // 显式清除（结算事件到达时 taskManager 已清除；超时兜底路径必须在此兜底清除，
      // 否则新轮次的 agent_end 会被误判为旧轮中断结算）
      currentRunningTask.pendingInterruptSend = false;

      // 旧轮已结算：头部耗时位定格为「已中断」，避免残留「思考中」字样
      if (flowView.activeTurnRefs?.thinkingDurationEl) {
        const elapsed = ((Date.now() - flowStore.for(interruptTaskId).thinkingStartTime) / 1000).toFixed(1);
        flowView.activeTurnRefs.thinkingDurationEl.textContent = `已中断 (${elapsed}s)`;
      }

      // 等待结算期间任务被挂起/切换：丢弃本次发送并回填输入内容
      const afterWaitTask = taskManager.getCurrentActiveTask();
      if (!afterWaitTask || afterWaitTask.id !== interruptTaskId || afterWaitTask.isSuspended) {
        searchInput.value = query;
        api.updateInputState();
        api.autoResizeSearchInput();
        return;
      }
    }

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

    // 检查 code-area 路由工作区门禁 (不可空置运行)
    try {
      const activeWs = settingsStore.activeWorkspace || (await workspaceService.getActiveWorkspace());
      if (activeWs && (activeWs.id === "code-area" || activeWs.requiresRoute)) {
        const routeInfo = await workspaceService.getCodeAreaRoute();
        const hasRoute = Boolean(routeInfo && routeInfo.routePath && routeInfo.exists);
        if (!hasRoute) {
          const promptFn = typeof api.promptCodeAreaRouteModal === "function"
            ? api.promptCodeAreaRouteModal
            : (typeof window !== "undefined" ? window.__piPromptCodeAreaRoute : null);
          const chosen = promptFn ? await promptFn("", "发起对话前 · 请绑定 code-area 路由目标项目") : null;
          if (!chosen) {
            bus.emit("ui:toast", { text: "code-area 必须绑定路由目标项目才能发起对话", duration: 2500 });
            return;
          }
          settingsStore.updateActiveWorkspace({
            routePath: chosen,
            routeName: chosen.split("/").pop() || chosen,
          });
        }
      }
    } catch (wsErr) {
      console.warn("[FlowPipeline] Workspace check error:", wsErr);
    }

    // 判断是否在 Flow 模式下向同一个工作流继续提问 (Multi-turn Follow-up)
    const activeTask = taskManager.getCurrentActiveTask();
    const isFollowUp = Boolean(viewStore.mode === VIEW_FLOW && activeTask);

    // 用户发起新的显式提问：若引擎正在自愈「当前活跃任务」，以手动操作为准取消其过期自愈，
    // 避免旧轮次退避重发污染新提问；后台挂起任务的自愈不受影响 (规范：挂起后台继续运行)
    if (modelFailoverEngine.isActive() && activeTask && modelFailoverEngine.taskId === activeTask.id) {
      modelFailoverEngine.cancel("new-query");
    }

    // 用户重新发起会话或追问：彻底清理历史残留的错误卡片与错误状态
    if (typeof api.clearTurnErrorState === "function") {
      api.clearTurnErrorState(activeTask?.id);
    }

    let currentTask = activeTask;

    if (isFollowUp && currentTask) {
      // 同一个 Flow 连续对话：在已有 Task 下开启新一轮 Turn
      taskManager.startNewTurn(currentTask.id, query, filesToAttach);
    } else {
      // 发起全新对话工作流：检查并发任务上限保护 (MAX_CONCURRENT_TASKS = 3)
      const runningTasks = taskManager.getActiveTasks();
      if (runningTasks.length >= taskManager.maxConcurrent) {
        bus.emit("ui:toast", { text: `后台任务已达上限 (${runningTasks.length}/${taskManager.maxConcurrent})，请等待某个任务完成后再发起新对话`, duration: 2500 });
        return;
      }

      currentTask = taskManager.createTask({
        query,
        attachments: filesToAttach,
        model: modelName,
        provider: providerName,
      });
    }

    if (currentTask?.id) {
      modelFailoverEngine.clearTaskAborted(currentTask.id);
    }

    if (flowBtnAbort) {
      flowBtnAbort.classList.remove("hidden");
    }

    // 记录本次附带的文件用于多模态失败检测与自适应重试（写入本任务分仓，按 Task 隔离）
    flowStore.for(currentTask?.id).set({ lastSentAttachments: [...filesToAttach] });

    // 构造下发给模型的 Prompt 与上下文注入（实际注入内容为文件/目录的系统绝对路径）
    let promptToSend = query;
    if (filesToAttach.length > 0) {
      const pathsBlock = filesToAttach
        .map((f) => {
          const isFolder = f.category === "folder" || f.category === "directory";
          const tag = isFolder ? "[目录/Folder]" : `[文件/${f.category || "File"}]`;
          return `- ${tag}: ${f.path || f.name}`;
        })
        .join("\n");

      const hasFolder = filesToAttach.some(
        (f) => f.category === "folder" || f.category === "directory"
      );
      const folderGuidance = hasFolder
        ? "\n\n（提示：附带项目中包含本地目录，请主动遍历检索其中的文件；若发现包含 .docx、.doc、.pdf、.pptx、.xlsx 或图像等格式，请自动调用专门的 OCR 或文档解析组件读取真实内容并深入分析）"
        : "";

      if (query) {
        promptToSend = `${query}\n\n[附带本地文件/目录绝对路径]:\n${pathsBlock}${folderGuidance}`;
      } else {
        promptToSend = `请查阅并分析以下本地文件/目录：\n\n[附带本地文件/目录绝对路径]:\n${pathsBlock}${folderGuidance}`;
      }
    }

    // 初始化/追加流式轮次 DOM
    api.resetStreamState(query, filesToAttach, isFollowUp);
    viewStore.morph(VIEW_FLOW, { shouldFocusInput: true });

    if (query && query.trim()) {
      promptHistoryNavigator.push(query.trim());
    }

    searchInput.value = "";
    api.clearAttachedFiles();
    api.updateInputState();
    api.autoResizeSearchInput();

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

      // 发送前预检：若在图片准备或排队期间用户已点击终止，直接短路退出
      if (currentTask && (currentTask.isAborted || currentTask.status === "aborted")) {
        console.warn(`[FlowPipeline] Task ${currentTask.id} was aborted before sendPrompt, skipping.`);
        return;
      }

      const sessionIdentity = resolveTaskSessionIdentity(currentTask);
      await piClient.sendPrompt(
        promptToSend,
        imagePayloads,
        null,
        currentTask.id,
        sessionIdentity.sessionPath,
        sessionIdentity.sessionId
      );
    } catch (err) {
      // 若任务已被用户手动终止，静默忽略异常，严禁复活为 error 态或渲染错误卡片
      if (currentTask && (currentTask.isAborted || currentTask.status === "aborted")) {
        return;
      }
      console.error("Failed to send prompt to Pi:", err);
      piClient.isStreaming = false;
      if (currentTask) {
        currentTask.status = "error";
        currentTask.completedAt = Date.now();
        currentTask.errorMessage = err.toString();
        taskManager.dispatchEvent(new CustomEvent("task-updated", { detail: currentTask }));
        taskManager.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: taskManager.getAllTasks() } }));
      }
      api.renderErrorCard({
        message: err.toString(),
        model: modelName,
        provider: providerName,
      });
    }
  };

  const submitCurrentPrompt = () => {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    if (query || attachmentsStore.files.length > 0) {
      handleFlowQuery(query, attachmentsStore.files);
      api.autoResizeSearchInput();
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
      if (viewStore.mode !== VIEW_FLOW) return;

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

  api.handleFlowQuery = handleFlowQuery;
  api.submitCurrentPrompt = submitCurrentPrompt;
  api.removeActiveToolPseudoStep = removeActiveToolPseudoStep;
}
