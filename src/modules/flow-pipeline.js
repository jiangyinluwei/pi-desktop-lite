import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { VIEW_FLOW } from "../lib/view-constants.js";
import { piClient, isAbortError } from "../services/pi-client.js";
import { configService } from "../services/config-service.js";
import { promptHistoryNavigator } from "../services/prompt-history.js";
import { invokeTauri } from "../services/tauri-bridge.js";
import { notificationService } from "../services/notification-service.js";
import { taskManager } from "../services/task-manager.js";
import { sketchAlert, sketchConfirm } from "../services/sketch-modal.js";
import { modelFailoverEngine } from "../services/model-failover.js";

/**
 * 提问下发、工具调用事件、自愈引擎接入与发送拦截流水线
 */
export function initFlowPipeline(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const searchInput = el.searchInput;
  const searchForm = el.searchForm;
  const flowScrollArea = el.flowScrollArea;
  const flowBtnAbort = el.flowBtnAbort;

  const getSkillDisplayName = (skillName) => {
    switch (skillName) {
      case "windows-bash-compatibility":
        return "windows-bash-compatibility (Windows Shell 兼容规范)";
      case "document-multimodal-inspection":
        return "document-multimodal-inspection (多格式文档与 OCR 解析规范)";
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
      default:
        return `${skillName} (运行态约束)`;
    }
  };


  api.getSkillDisplayName = getSkillDisplayName;

  const flowConversation = el.flowConversation;

  /* ========== 「注入提示」信息框（路由目标项目胶囊下方，默认收起显示标题与注入数量） ==========
   * 展示所有在调用模型之前注入的上下文条目（Inner-Skill 运行态技能、
   * 路由工作区 AGENTS.md / README.md、命中技能与路由上下文信封等），
   * 随会话动态累积（跨轮保留，按 kind+name 去重），全新会话时重置。
   */
  const INJECTION_KIND_LABELS = {
    inner_skill: "Inner-Skill 运行态技能",
    agents_md: "AGENTS.md",
    readme_md: "README.md",
    routed_skill: "路由项目技能",
    routing_context: "路由工作区上下文",
  };

  const injectionNotice = {
    el: null,
    listEl: null,
    countEl: null,
    items: new Set(),
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
      injectionNotice.items.clear();
      // 置于首个消息组的「路由目标项目」胶囊下方（胶囊缺失时回退至组首/会话流顶部）
      const firstGroup = flowConversation.querySelector(":scope > .flow-message-group");
      const routeCapsule = firstGroup?.querySelector(":scope > .flow-route-capsule:not(.hidden)");
      if (routeCapsule) {
        routeCapsule.after(injectionNotice.el);
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

  const updateInjectionNoticeCount = () => {
    if (injectionNotice.countEl) {
      injectionNotice.countEl.textContent =
        injectionNotice.items.size > 0 ? `${injectionNotice.items.size} 项` : "";
    }
  };

  /** 向「注入提示」信息框追加一条注入条目（kind+name 去重，跨轮累积） */
  const addInjectionNoticeItem = (kind, name) => {
    if (!kind || !name) return;
    const key = `${kind}::${name}`;
    const noticeEl = ensureInjectionNoticeEl();
    if (!noticeEl || injectionNotice.items.has(key)) return;
    injectionNotice.items.add(key);
    const displayName = kind === "inner_skill" ? getSkillDisplayName(name) : name;
    const itemEl = document.createElement("li");
    itemEl.className = "injection-notice-item";
    itemEl.innerHTML = `
      <span class="item-kind">${escapeHtml(INJECTION_KIND_LABELS[kind] || kind)}</span>
      <span class="item-name">${escapeHtml(displayName)}</span>
    `;
    injectionNotice.listEl.appendChild(itemEl);
    updateInjectionNoticeCount();
    // 仅吸底跟随开启时随内容定位到底部，向上滚离后不打断浏览
    if (flowScrollArea && flow.followBottom !== false) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  /** 全新会话时重置「注入提示」信息框（DOM 随 flowConversation 清空一并移除） */
  const resetInjectionNotice = () => {
    injectionNotice.el = null;
    injectionNotice.listEl = null;
    injectionNotice.countEl = null;
    injectionNotice.chevronEl = null;
    injectionNotice.items.clear();
    injectionNotice.collapsed = true;
  };

  api.resetInjectionNotice = resetInjectionNotice;

  // 串轮过滤铁律：事件帧携 task_id 且非当前前台活跃任务 (后台挂起任务) 时，
  // 绝不向前台 Flow 注入任何步骤卡/胶囊/错误卡，也不触发收尾归档
  const isForegroundStreamEvent = () =>
    taskManager.isForegroundStreamTask(piClient.lastEventTaskId || null);

  // 后端真实注入广播：inject_prompt（兑底 Inner-Skill + code-area 路由上下文）
  // 每次真实注入后携带条目清单广播，前端逐条追加至「注入提示」框
  piClient.addEventListener("context-injected", (e) => {
    if (!isForegroundStreamEvent()) return;
    const items = e.detail?.items;
    if (Array.isArray(items)) {
      items.forEach((item) => {
        if (item?.kind && item?.name) addInjectionNoticeItem(item.kind, item.name);
      });
    }
  });

  // Tool-call Hook 命中：Inner-Skill 动态激活（steer 即时或兑底入队）即同步至「注入提示」框
  piClient.addEventListener("inner-skill-activated", (e) => {
    if (!isForegroundStreamEvent()) return;
    const skillName = e.detail?.skill;
    if (skillName) {
      addInjectionNoticeItem("inner_skill", skillName);
    }
  });

  piClient.addEventListener("toolcall-delta-start", (e) => {
    if (!isForegroundStreamEvent()) return;
    // 阶段性输出判定铁律：模型输出一段文字后进入工具调用状态（工具参数流式开始即视为进入），
    // 先封口该段文字为 Point 卡，再进入工具调用切片（tool-start 处的封口为幂等兜底）
    if (typeof api.sealActivePhaseOutput === "function") {
      api.sealActivePhaseOutput();
    }
    api.autoCollapseThinkingOnNextPhase();
  });

  piClient.addEventListener("tool-start", (e) => {
    if (!isForegroundStreamEvent()) return;
    flow.hasReceivedDelta = true;
    const data = e.detail;
    const toolCallId = data.toolCallId;
    const toolName = data.toolName || "tool";

    // 工具开始时，结算或清理当前活跃的思维切片
    if (flow.activeThinkingStep) {
      if (flow.activeThinkingStep.hasRealThinking || flow.activeThinkingStep.text?.trim()) {
        const elapsed = ((Date.now() - flow.activeThinkingStep.startTime) / 1000).toFixed(1);
        flow.activeThinkingStep.durationText = `(${elapsed}s)`;
        if (flow.activeThinkingStep.durationEl) {
          flow.activeThinkingStep.durationEl.textContent = flow.activeThinkingStep.durationText;
        }
      } else {
        flow.activeThinkingStep.cardEl?.remove();
        if (Array.isArray(flow.currentSteps)) {
          flow.currentSteps = flow.currentSteps.filter((s) => s !== flow.activeThinkingStep);
        }
      }
      flow.activeThinkingStep = null;
    }
    if (flow.thinkingTimerInterval) {
      clearInterval(flow.thinkingTimerInterval);
      flow.thinkingTimerInterval = null;
    }

    // 工具开始前，封口当前活跃的阶段性输出切片 (Point 卡)：
    // 将已累积的中间段文本折叠进步骤流，保持「思维1-Point1-工具1-Point2...」时序因果链
    if (typeof api.sealActivePhaseOutput === "function") {
      api.sealActivePhaseOutput();
    }

    // 创建单行极简工具卡片（默认折叠，任何时候不自动展开）
    const toolStep = typeof api.createToolStepCard === "function"
      ? api.createToolStepCard({
          id: toolCallId,
          name: toolName,
          args: data.args,
          status: "running",
          isOpen: false,
        })
      : null;

    const card = toolStep?.cardEl || document.createElement("div");
    if (!toolStep) {
      card.className = "flow-step-card flow-step-tool tool-card collapsed running";
      card.id = `tool-${toolCallId}`;
      const argsStr = data.args ? JSON.stringify(data.args, null, 2) : "";
      card.innerHTML = `
        <div class="flow-step-header tool-header" role="button" tabindex="0" aria-expanded="false">
          <div class="flow-step-header-left">
            <span class="flow-step-icon tool-icon" aria-hidden="true">${ICONS.tool}</span>
            <span class="flow-step-title tool-name">${escapeHtml(api.getFriendlyToolName ? api.getFriendlyToolName(toolName) : toolName)}</span>
          </div>
          <div class="flow-step-header-right tool-header-right">
            <span class="tool-status-badge running">running</span>
            <span class="flow-step-arrow tool-collapse-arrow" aria-hidden="true">${ICONS.chevronDown}</span>
          </div>
        </div>
        <div class="flow-step-body tool-body">${escapeHtml(argsStr)}</div>
      `;
    }

    if (flow.activeTurnRefs?.stepsContainerEl) {
      flow.activeTurnRefs.stepsContainerEl.appendChild(card);
    } else if (flow.activeTurnRefs?.toolCallsContainerEl) {
      flow.activeTurnRefs.toolCallsContainerEl.appendChild(card);
    }

    flow.renderedToolCards.set(toolCallId, card);

    const stepItem = {
      type: "tool",
      id: toolCallId,
      name: toolName,
      args: data.args,
      status: "running",
      result: null,
      cardEl: card,
      badgeEl: toolStep?.badgeEl || card.querySelector(".tool-status-badge"),
      previewEl: toolStep?.previewEl || card.querySelector(".flow-step-preview"),
      bodyEl: toolStep?.bodyEl || card.querySelector(".flow-step-body") || card.querySelector(".tool-body"),
    };

    flow.activeToolStep = stepItem;
    if (!Array.isArray(flow.currentSteps)) {
      flow.currentSteps = [];
    }
    flow.currentSteps.push(stepItem);
    // 仅吸底跟随开启时随内容定位到底部，向上滚离后不打断浏览
    if (flowScrollArea && flow.followBottom !== false) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  });

  piClient.addEventListener("tool-update", (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail;
    const card = flow.renderedToolCards.get(data.toolCallId);
    const matchingStep = Array.isArray(flow.currentSteps)
      ? flow.currentSteps.find((s) => s.type === "tool" && s.id === data.toolCallId)
      : null;
    if (matchingStep) {
      matchingStep.result = data.partialResult;
    }
    if (card) {
      const body = card.querySelector(".flow-step-body") || card.querySelector(".tool-body");
      if (body) {
        if (typeof api.renderToolBodyInnerHtml === "function") {
          body.innerHTML = api.renderToolBodyInnerHtml(matchingStep?.args, data.partialResult);
        } else if (data.partialResult) {
          const text = typeof data.partialResult === "string" ? data.partialResult : JSON.stringify(data.partialResult, null, 2);
          body.textContent = text;
        }
      }
    }
  });

  piClient.addEventListener("tool-end", (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail;
    const card = flow.renderedToolCards.get(data.toolCallId);
    const isError = Boolean(data.isError);
    const statusText = isError ? "failure" : "done";

    const matchingStep = Array.isArray(flow.currentSteps)
      ? flow.currentSteps.find((s) => s.type === "tool" && s.id === data.toolCallId)
      : null;
    if (matchingStep) {
      matchingStep.status = statusText;
      matchingStep.result = data.result;
      matchingStep.is_error = isError;
    }

    if (card) {
      card.classList.remove("running");
      card.classList.remove("done", "error", "failed", "failure");
      card.classList.add(isError ? "failed" : "done");
      if (isError) card.classList.add("error");

      const badge = card.querySelector(".tool-status-badge");
      if (badge) {
        if (typeof api.updateToolBadge === "function") {
          api.updateToolBadge(badge, statusText);
        } else {
          badge.className = `tool-status-badge ${statusText}`;
          badge.textContent = statusText;
        }
      }

      const body = card.querySelector(".flow-step-body") || card.querySelector(".tool-body");
      if (body) {
        if (typeof api.renderToolBodyInnerHtml === "function") {
          body.innerHTML = api.renderToolBodyInnerHtml(matchingStep?.args, data.result);
        } else {
          let fullContent = "";
          if (matchingStep?.args) {
            fullContent += `[入参 / Arguments]\n${typeof matchingStep.args === "string" ? matchingStep.args : JSON.stringify(matchingStep.args, null, 2)}\n\n`;
          }
          if (data.result) {
            const resText = typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2);
            fullContent += `[结果 / Result]\n${resText}`;
          }
          body.textContent = fullContent || (typeof data.result === "string" ? data.result : JSON.stringify(data.result || {}, null, 2));
        }
      }
    }

    if (flow.activeToolStep?.id === data.toolCallId) {
      flow.activeToolStep = null;
    }

    // 沿用“伪思考框”机制：工具调用结束后立即重新触发 Thinking (0.0s)... 占位卡片，
    // 覆盖工具结果回传后到下一轮模型响应首个事件（thinking-start / text-start）之间的空窗期；
    // 若模型随后直接输出正文或本轮就此结束，由 text-start / finalizeStream 的伪框清理逻辑自动移除
    if (piClient.isStreaming && typeof api.ensureActiveThinkingStep === "function") {
      api.ensureActiveThinkingStep();
      // 仅吸底跟随开启时随内容定位到底部，向上滚离后不打断浏览
      if (flowScrollArea && flow.followBottom !== false) {
        flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
      }
    }
  });

  piClient.addEventListener("retry-status", (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail;
    // 引擎接管自愈时，内核内置 3 次快速重试降级为内部静默，不再覆盖耗时位展示
    if (modelFailoverEngine.isActive()) return;
    if (flow.activeTurnRefs?.thinkingDurationEl && data.attempt) {
      flow.activeTurnRefs.thinkingDurationEl.textContent = `自动重试中 (${data.attempt}/${data.maxAttempts || 3})...`;
    }
  });

  // 注：agent-start 不再向 notificationService 注册幻影任务 "agent-prompt"——
  // TaskManager.createTask 已用真实 taskId 注册，幻影 ID 永不注销会导致 hasRunningTasks()
  // 恒为 true，成功完成通知 (notifyAgentCompleted) 被永久静默拦截

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
      api.resetCurrentTurnForResend();
      return piClient.sendPrompt(flow.lastSentPrompt, flow.lastImagePayloads, null, taskId);
    },
    // 全部失败兜底：复用既有错误卡并追加自愈摘要
    onGiveUp: (errDetail, summary) => {
      const detail = { ...(errDetail || {}) };
      if (summary && (summary.reconnectCount > 0 || summary.triedCandidates > 0)) {
        detail.failoverSummary = summary;
      }
      api.renderErrorCard(detail);
    },
    // 自愈成功：正常收尾 (收起工具卡 + 结束流式 + 沉淀历史快照)
    onSuccess: () => {
      api.collapseAllToolCards();
      api.finalizeStream();
      api.archiveCurrentFlowToHistory();
    },
  };

  piClient.addEventListener("agent-error", (e) => {
    // 手动终止 / 中断类错误：绝不渲染错误卡，绝对不能触发自动重连或切换
    if (isAbortError(e.detail)) {
      return;
    }

    const errTaskId = e.detail?.taskId || e.detail?.raw?.task_id || e.detail?.task_id || piClient.lastEventTaskId;

    // 后台挂起任务的报错：只由 TaskManager 结算数据与通知，绝不污染前台 Flow
    if (!taskManager.isForegroundStreamTask(errTaskId)) {
      return;
    }

    // 检查所属 Task 是否已处于中止状态或在中止黑名单中
    if (modelFailoverEngine.isTaskAborted(errTaskId)) {
      return;
    }
    if (errTaskId) {
      const task = taskManager.getTask(errTaskId);
      if (task && (task.status === "aborted" || task.isAborted)) {
        return;
      }
    }

    // 「终止并发送」进行中：旧轮报错视为已结算，不渲染错误卡、不进入自愈
    if (flow.interruptSendTaskId) {
      if (!errTaskId || errTaskId === flow.interruptSendTaskId) {
        return;
      }
    }
    if (modelFailoverEngine.isActive()) {
      // 自愈进行中：该错误即为当前重发尝试的结果 (含 RPC/扩展错误)，一律交由引擎结算，
      // 避免引擎在途尝试悬空挂起，也绝不提前渲染错误卡打断自愈
      modelFailoverEngine.handleModelError(e.detail, failoverHooks);
    } else if (modelFailoverEngine.canHandle(e.detail)) {
      // 冷启动：自动重连开启且错误含模型上下文 → 交给引擎自愈
      modelFailoverEngine.handleModelError(e.detail, failoverHooks);
    } else {
      api.renderErrorCard(e.detail);
    }
  });

  piClient.addEventListener("agent-end", (e) => {
    // 后台挂起任务的结束帧：不触发前台收尾与归档，仅由 TaskManager 结算数据
    if (!taskManager.isForegroundStreamTask(e.detail?.task_id || e.detail?.taskId || piClient.lastEventTaskId)) {
      return;
    }
    // 引擎自愈进行中：结算当前重发尝试为成功，由引擎负责收尾，避免提前归档历史
    if (modelFailoverEngine.isActive()) {
      modelFailoverEngine.resolveTurnSuccess();
      return;
    }
    // 「终止并发送」进行中：旧轮结算由 interrupt-send 流水线接管，跳过收尾与归档
    if (flow.interruptSendTaskId) {
      const endTaskId = e.detail?.task_id || e.detail?.taskId;
      if (!endTaskId || endTaskId === flow.interruptSendTaskId) {
        return;
      }
    }
    // 完成后收起所有工具卡片（最终输出卡不收起）
    api.collapseAllToolCards();
    api.finalizeStream();
    api.archiveCurrentFlowToHistory();
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
      view.mode === VIEW_FLOW
        ? (() => {
            const t = taskManager.getCurrentActiveTask();
            if (!t) return null;
            return t.status === "thinking" ||
              t.status === "streaming" ||
              t.status === "tool_exec" ||
              t.status === "paused"
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
      flow.interruptSendTaskId = interruptTaskId;
      currentRunningTask.pendingInterruptSend = true;
      api.showGlobalToast("正在终止当前生成，即将发送新提问…", 1500);
      const settledPromise = waitForTurnSettled(interruptTaskId);
      try {
        await piClient.abort(interruptTaskId);
      } catch (_) {
        // abort 失败（子进程已退出等）不阻塞，由超时兜底继续
      }
      await settledPromise;
      flow.interruptSendTaskId = null;
      // 显式清除（结算事件到达时 taskManager 已清除；超时兜底路径必须在此兜底清除，
      // 否则新轮次的 agent_end 会被误判为旧轮中断结算）
      currentRunningTask.pendingInterruptSend = false;

      // 旧轮已结算：头部耗时位定格为「已中断」，避免残留「思考中」字样
      if (flow.activeTurnRefs?.thinkingDurationEl) {
        const elapsed = ((Date.now() - flow.thinkingStartTime) / 1000).toFixed(1);
        flow.activeTurnRefs.thinkingDurationEl.textContent = `已中断 (${elapsed}s)`;
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
      const activeWs = settings.activeWorkspace || (await workspaceService.getActiveWorkspace());
      if (activeWs && (activeWs.id === "code-area" || activeWs.requiresRoute)) {
        const routeInfo = await workspaceService.getCodeAreaRoute();
        const hasRoute = Boolean(routeInfo && routeInfo.routePath && routeInfo.exists);
        if (!hasRoute) {
          const promptFn = typeof api.promptCodeAreaRouteModal === "function"
            ? api.promptCodeAreaRouteModal
            : (typeof window !== "undefined" ? window.__piPromptCodeAreaRoute : null);
          const chosen = promptFn ? await promptFn("", "发起对话前 · 请绑定 code-area 路由目标项目") : null;
          if (!chosen) {
            api.showGlobalToast("code-area 必须绑定路由目标项目才能发起对话", 2500);
            return;
          }
          if (settings.activeWorkspace) {
            settings.activeWorkspace.routePath = chosen;
            settings.activeWorkspace.routeName = chosen.split("/").pop() || chosen;
          }
        }
      }
    } catch (wsErr) {
      console.warn("[FlowPipeline] Workspace check error:", wsErr);
    }

    // 判断是否在 Flow 模式下向同一个工作流继续提问 (Multi-turn Follow-up)
    const activeTask = taskManager.getCurrentActiveTask();
    const isFollowUp = Boolean(view.mode === VIEW_FLOW && activeTask);

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
        api.showGlobalToast(`后台任务已达上限 (${runningTasks.length}/${taskManager.maxConcurrent})，请等待某个任务完成后再发起新对话`, 2500);
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

    // 记录本次附带的文件用于多模态失败检测与自适应重试
    flow.lastSentAttachments = [...filesToAttach];

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
    api.setViewMode(VIEW_FLOW, true);

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
      // 缓存构造后的 Prompt 与图片 Payload，供自动重连切换引擎同 Turn 复用重发
      flow.lastSentPrompt = promptToSend;
      flow.lastImagePayloads = imagePayloads;
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
    if (query || attachments.files.length > 0) {
      handleFlowQuery(query, attachments.files);
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
      if (view.mode !== VIEW_FLOW) return;

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
}
