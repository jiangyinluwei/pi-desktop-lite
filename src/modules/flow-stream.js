import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { notificationService } from "../services/notification-service.js";
import { taskManager } from "../services/task-manager.js";
import { modelFailoverEngine } from "../services/model-failover.js";
import { flowStore } from "../services/stores/flow-store.js";
import { flowView, resolveStreamTaskId } from "./flow-state-view.js";
import { createThinkingStepCard, createPhaseStepCard, syncThinkingPreview } from "./flow-render.js";

/**
 * 流式状态机、错误卡渲染与自动重连胶囊
 *
 * 阶段 7 批次 A 数据分层：
 *   - 纯数据（responseText / thinkingText / errorMessage / lastUserQuery / hasReceivedDelta /
 *     hasAutoCollapsedThinking / thinkingStartTime …）一律经 flowStore.for(taskId) 分仓读写；
 *     分仓键 = resolveStreamTaskId(显式 id || piClient.lastEventTaskId)，事件驱动写入点
 *     全部位于前台门禁之后，后台挂起任务事件绝不写入前台分仓；
 *   - 视图派生缓存（renderedToolCards / currentSteps / active*Step / 计时器 / activeTurnRefs /
 *     followBottom）一律走 flowView（flow-state-view.js 唯一属主）。
 */
export function initFlowStream(ctx) {
  const api = ctx.api;
  const flowView = ctx.flowView;
  const flowStore = ctx.flowStore;
  const flowDom = ctx.flowDom;

  const flowScrollArea = flowDom.flowScrollArea;
  const flowConversation = flowDom.flowConversation;
  const thinkingToggleBtn = flowDom.thinkingToggleBtn;
  const flowResponseContent = flowDom.flowResponseContent;
  const flowBtnAbort = flowDom.flowBtnAbort;
  const taskDetailsSidebar = flowDom.taskDetailsSidebar;

  /** 事件帧归属任务的纯数据分仓（事件处理器内调用；调用点均已过前台门禁）。 */
  const streamData = (explicit) => flowStore.for(resolveStreamTaskId(explicit));

  /**
   * 清理流式临时缓冲与定时器（在 resetStreamState 与 resetCurrentTurnForResend 中复用）
   */
  const clearStreamTimersAndBuffers = (taskId) => {
    streamData(taskId).set({
      thinkingText: "",
      responseText: "",
      errorMessage: null,
      hasReceivedDelta: false,
      hasAutoCollapsedThinking: false,
    });
    flowView.renderedToolCards.clear();
    flowView.currentSteps = [];
    flowView.activeThinkingStep = null;
    flowView.activeToolStep = null;
    flowView.activeTextStep = null;
    if (typeof api.removeActiveToolPseudoStep === "function") {
      api.removeActiveToolPseudoStep();
    }
    if (flowView.toolPseudoTimerInterval) {
      clearInterval(flowView.toolPseudoTimerInterval);
      flowView.toolPseudoTimerInterval = null;
    }
    if (flowView.toolRunTimerInterval) {
      clearInterval(flowView.toolRunTimerInterval);
      flowView.toolRunTimerInterval = null;
    }
    if (flowView.textTimerInterval) {
      clearInterval(flowView.textTimerInterval);
      flowView.textTimerInterval = null;
    }
  };

  /**
   * 封口当前活跃的思维切片（Thinking Step）：
   * 结算耗时并定格显示；若有真实文本或处于工具跃迁/显式思考则保留为“已完成思考”，若仅为首字占位伪框则移除
   * @param {Object} [options]
   * @param {boolean} [options.preserveForTool=false] 是否为进入工具调用时的结算
   */
  const sealActiveThinkingStep = (options = {}) => {
    if (flowView.activeThinkingStep) {
      const step = flowView.activeThinkingStep;
      const isToolTransition = Boolean(options && options.preserveForTool);

      // 铁律：只要产生过思考增量、或存在思考文本、或显式收到了 thinking-start 事件、或直接进入工具调用，
      // 均视为有效的思维决策阶段，必须定格保留，绝不能物理移除导致界面示意框突兀消失
      if (step.hasRealThinking || step.text?.trim() || step.isExplicitThinking || isToolTransition) {
        const elapsed = ((Date.now() - step.startTime) / 1000).toFixed(1);
        step.durationText = `(${elapsed}s)`;
        if (step.durationEl) {
          step.durationEl.textContent = step.durationText;
        }

        // 若没有具体的思维链文本（直接调用工具或空思考块），友好展示“已完成思考”
        if (!step.text?.trim()) {
          step.text = "已完成思考";
          if (step.cardEl) {
            step.cardEl.classList.add("no-fade");
            syncThinkingPreview(step.cardEl, step.text, step);
          }
          if (step.textStreamEl) {
            step.textStreamEl.textContent = step.text;
          }
        }

        step.cardEl?.classList.remove("running");
      } else {
        // 仅在纯正文直接输出（未调用工具且无显式思考事件）时，作为首字等待伪框静默移除
        step.cardEl?.remove();
        if (Array.isArray(flowView.currentSteps)) {
          flowView.currentSteps = flowView.currentSteps.filter((s) => s !== step);
        }
      }
      flowView.activeThinkingStep = null;
    }
    if (flowView.thinkingTimerInterval) {
      clearInterval(flowView.thinkingTimerInterval);
      flowView.thinkingTimerInterval = null;
    }
  };

  /**
   * 初始化/重置流式状态（支持多轮追加与新会话独立划分）
   * @param {string} query
   * @param {Array<any>} attachments
   * @param {boolean} isFollowUpTurn 是否为同会话多轮后续追问
   * @param {string} [taskId] 本轮归属任务 id（发送链显式传入；缺省回退前台活跃任务）
   */
  const resetStreamState = (query, attachments = [], isFollowUpTurn = false, taskId = null) => {
    streamData(taskId).set({ lastUserQuery: query });
    clearStreamTimersAndBuffers(taskId);

    if (!isFollowUpTurn) {
      // 全新会话 -> 清空 flowConversation 容器，并重置「注入提示」信息框状态
      if (flowConversation) {
        flowConversation.innerHTML = "";
      }
      if (typeof api.resetInjectionNotice === "function") {
        api.resetInjectionNotice();
      }
      if (typeof api.resetFileChanges === "function") {
        api.resetFileChanges();
      }
    } else {
      // 同工作流多轮对话 -> 固化上一轮（收起思考与工具卡片，移除上一轮光标）
      if (flowView.activeTurnRefs) {
        api.collapseThinkingCard(flowView.activeTurnRefs.thinkingCardEl, flowView.activeTurnRefs.thinkingToggleBtn);
        if (flowView.activeTurnRefs.responseContentEl) {
          const prevCursor = flowView.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
          if (prevCursor) prevCursor.remove();
        }
      }
      api.collapseAllDoneToolCards();
    }

    // 创建当前轮次的 DOM 组并追加到 flowConversation（默认折叠，不自动展开）
    flowView.activeTurnRefs = api.createFlowTurnGroupElement({
      query,
      attachments,
      thinkingText: "",
      thinkingDurationText: "(0.0s)...",
      responseText: "",
      toolCalls: [],
      steps: [],
      isOpenThinking: false,
    });

    if (flowConversation && flowView.activeTurnRefs?.groupEl) {
      flowConversation.appendChild(flowView.activeTurnRefs.groupEl);
    }

    if (flowView.activeTurnRefs.responseContentEl) {
      flowView.activeTurnRefs.responseContentEl.innerHTML = `<span class="streaming-cursor"></span>`;
    }

    streamData(taskId).set({ thinkingStartTime: Date.now() });

    // 立即触发“伪思考框” -- 显示 "Thinking (0.0s)..."，直到真正捕捉到思维链才流式刷新首行文本
    ensureActiveThinkingStep();

    if (flowScrollArea) {
      flowView.followBottom = true; // 新轮次默认重新开启吸底跟随
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }

    // 新轮次就绪后刷新顶部悬浮提问提示
    api.updateFlowQuestionTip();
    // 新轮次追加后刷新右侧多段对话定位导航显隐（>= 2 轮时显现）
    api.updateFlowTurnNav();
  };

  const finalizeStream = (taskId = null) => {
    piClient.isStreaming = false;
    const fs = streamData(taskId);
    // 若存在未封口的活跃阶段性输出切片，说明它是本轮最终输出段：
    // 移除 Point 卡（内容保留在最终输出卡中），不沉淀为步骤快照
    if (flowView.activeTextStep) {
      const lastStep = flowView.activeTextStep;
      flowView.activeTextStep = null;
      lastStep.cardEl?.remove();
      if (Array.isArray(flowView.currentSteps)) {
        flowView.currentSteps = flowView.currentSteps.filter((s) => s !== lastStep);
      }
    }
    if (flowView.textTimerInterval) {
      clearInterval(flowView.textTimerInterval);
      flowView.textTimerInterval = null;
    }
    sealActiveThinkingStep();
    // 伪工具运行框兜底清理：流式结束时若仍在参数流式期，定格读秒后移除占位卡
    if (typeof api.removeActiveToolPseudoStep === "function") {
      api.removeActiveToolPseudoStep();
    }
    if (flowView.toolRunTimerInterval) {
      clearInterval(flowView.toolRunTimerInterval);
      flowView.toolRunTimerInterval = null;
    }
    // 移除光标
    if (flowView.activeTurnRefs?.responseContentEl) {
      const cursor = flowView.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
    }
    // 流式结束时隐藏 Flow 中止按钮
    if (flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
    }
    // 正常完成且无错误时，为当前轮次输出卡片挂载保存按钮
    if (
      flowView.activeTurnRefs &&
      !fs.errorMessage &&
      fs.responseText &&
      fs.responseText.trim() &&
      typeof api.attachResponseSaveButton === "function"
    ) {
      api.attachResponseSaveButton(flowView.activeTurnRefs, {
        query: fs.lastUserQuery,
        responseText: fs.responseText,
        thinkingText: fs.thinkingText,
      });
    }
    // 输出全部结束的瞬间：单次定位到会话底部并恢复吸底跟随
    if (flowScrollArea) {
      flowView.followBottom = true;
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  /**
   * 自动重连切换：复用当前 Turn 容器重发相同输入前重置当前轮次流式状态
   * 不重建用户提问卡、不重复压入 prompt history、不新建 Task，仅清除上一轮临时产物
   * @param {string} [taskId] 自愈引擎重发的任务 id（onResendAttempt 显式传入）
   */
  const resetCurrentTurnForResend = (taskId = null) => {
    clearStreamTimersAndBuffers(taskId);

    // 移除上一轮临时错误卡片 (避免重复堆叠)
    if (flowView.activeTurnRefs?.responseContentEl) {
      const errCard = flowView.activeTurnRefs.responseContentEl.querySelector(".sketch-error-card");
      if (errCard) errCard.remove();
      const cursor = flowView.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
      flowView.activeTurnRefs.responseContentEl.innerHTML = `<span class="streaming-cursor"></span>`;
    }
    // 清空时序步骤容器
    if (flowView.activeTurnRefs?.stepsContainerEl) {
      flowView.activeTurnRefs.stepsContainerEl.innerHTML = "";
    }
    streamData(taskId).set({ thinkingStartTime: Date.now() });
    // 立即启动伪思考框
    ensureActiveThinkingStep();
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
    if (!flowView.activeTurnRefs?.failoverCapsuleEl || !flowView.activeTurnRefs?.failoverTextEl) return;
    const phase = payload.phase || "";
    const textEl = flowView.activeTurnRefs.failoverTextEl;
    const capsule = flowView.activeTurnRefs.failoverCapsuleEl;

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
    // 注：重连/切换胶囊更新不再强制滚动到底部，避免输出期间打断用户滚轮浏览
  };

  // 自动重连切换引擎进度事件 → 更新 Flow 进度胶囊
  modelFailoverEngine.addEventListener("failover-status", (e) => {
    const payload = e.detail || {};
    // 退避等待期间停止思考计时，避免耗时位残留「思考中」虚长
    if (
      (payload.status === "reconnecting" || payload.status === "switching") &&
      payload.phase === "waiting" &&
      flowView.thinkingTimerInterval
    ) {
      clearInterval(flowView.thinkingTimerInterval);
      flowView.thinkingTimerInterval = null;
    }
    if (
      (payload.status === "reconnecting" || payload.status === "switching") &&
      payload.phase === "waiting" &&
      flowView.textTimerInterval
    ) {
      clearInterval(flowView.textTimerInterval);
      flowView.textTimerInterval = null;
    }
    updateFailoverCapsule(payload);
    // 侧边栏挂起任务状态徽章 (自动重连中/切换模型中) 实时刷新
    if (
      taskDetailsSidebar &&
      taskDetailsSidebar.classList.contains("open") &&
      typeof api.renderTaskSidebarList === "function"
    ) {
      api.renderTaskSidebarList();
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
    if (flowView.activeTurnRefs?.responseContentEl) {
      const cursor = flowView.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
      if (!flowView.activeTurnRefs.responseContentEl.querySelector(".flow-abort-callout")) {
        flowView.activeTurnRefs.responseContentEl.insertAdjacentHTML("beforeend", renderAbortNoticeHtml());
      }
    }
    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  /**
   * 检查错误信息是否命中模型不支持多模态特征
   * @param {string} msg
   * @param {object} fs 事件归属任务的纯数据分仓（lastSentAttachments 按任务隔离读取）
   * @returns {boolean}
   */
  const isMultimodalError = (msg, fs) => {
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
      (lower.includes("400") && Array.isArray(fs.lastSentAttachments) && fs.lastSentAttachments.some((f) => f.category === "image"))
    );
  };

  /**
   * 渲染手绘草图风格异常诊断卡片并提供快捷操作与多模态建议
   * @param {{ message: string, model?: string, provider?: string, taskId?: string }} errDetail
   */
  const renderErrorCard = (errDetail) => {
    piClient.isStreaming = false;
    // 分仓键：错误帧自带 taskId（agent-error / 引擎 detail）优先，缺省回退前台活跃任务
    const bucketId = resolveStreamTaskId(errDetail?.taskId || errDetail?.task_id || errDetail?.raw?.task_id || null);
    const fs = flowStore.for(bucketId);
    fs.set({ errorMessage: errDetail?.message || "与模型服务通信中断或返回异常" });
    const currentTask = taskManager.getCurrentActiveTask();
    if (currentTask) {
      currentTask.status = "error";
      currentTask.completedAt = Date.now();
      currentTask.errorMessage = fs.errorMessage;
      taskManager.dispatchEvent(new CustomEvent("task-updated", { detail: currentTask }));
      taskManager.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: taskManager.getAllTasks() } }));
    }
    finalizeStream(bucketId);
    if (flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
    }
    const errMsg = fs.errorMessage;

    // 软件失焦时立即弹出报错终止通知 (带 Windows 默认提示音)
    // 注：不再传幻影 taskId "agent-prompt"，真实任务的注销与报错通知由 taskManager 的 agent-error 监听器负责
    notificationService.notifyError({
      title: "pi-dl",
      message: `模型调用异常终止：${errMsg.length > 80 ? errMsg.slice(0, 77) + "..." : errMsg}`,
    });

    const targetResponseEl = flowView.activeTurnRefs?.responseContentEl || flowResponseContent;
    if (!targetResponseEl) return;

    const activeModelName = errDetail?.model || piClient.currentModel?.id || "当前模型";
    const isMultiModalIssue = isMultimodalError(errMsg, fs);

    const multimodalHintHtml = isMultiModalIssue
      ? `
        <div class="multimodal-hint-box">
          <div class="hint-content-wrap">
            <span class="hint-icon">${ICONS.lightbulb}</span>
            <div class="hint-text">
              <strong>建议：</strong>当前模型不支持直接解析多模态文件。您可在<strong>「设置 ➔ 扩展组件」</strong>中安装推荐的 Pi 多模态解析插件以自动转换图像与文档。
            </div>
          </div>
          <button type="button" class="hint-action-btn error-goto-packages-btn">
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
          <button type="button" class="error-btn retry-btn">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2.5 8a5.5 5.5 0 0 1 9.39-3.89L13.5 5.5" />
              <path d="M13.5 2v3.5H10" />
              <path d="M13.5 8a5.5 5.5 0 0 1-9.39 3.89L2.5 10.5" />
              <path d="M2.5 14v-3.5H6" />
            </svg>
            重试当前提问
          </button>
          <button type="button" class="error-btn switch-model-btn">
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

    if (!fs.responseText || fs.responseText.trim().length === 0) {
      targetResponseEl.innerHTML = cardHtml;
    } else {
      targetResponseEl.insertAdjacentHTML("beforeend", cardHtml);
    }

    // 报错时确保移除可能已挂载的保存按钮
    if (flowView.activeTurnRefs && typeof api.attachResponseSaveButton === "function") {
      api.attachResponseSaveButton(flowView.activeTurnRefs, {
        errorMessage: fs.errorMessage,
      });
    }

    // 绑定当前轮次错误卡局部按钮事件（避免多轮 ID 冲突导致事件错位）
    const errorCardEl = targetResponseEl.querySelector(".sketch-error-card");
    if (errorCardEl) {
      const btnRetry = errorCardEl.querySelector(".retry-btn");
      const btnSwitch = errorCardEl.querySelector(".switch-model-btn");
      const btnGotoPackages = errorCardEl.querySelector(".error-goto-packages-btn, .hint-action-btn");

      if (btnRetry) {
        btnRetry.addEventListener("click", () => {
          if (fs.lastUserQuery) {
            api.handleFlowQuery(fs.lastUserQuery, fs.lastSentAttachments);
          }
        });
      }

      if (btnSwitch) {
        btnSwitch.addEventListener("click", () => {
          api.openSettingsView();
        });
      }

      if (btnGotoPackages) {
        btnGotoPackages.addEventListener("click", () => {
          api.openSettingsView("tab-packages");
        });
      }
    }

    // 报错终止时即时自动沉淀快照至历史记录
    api.archiveCurrentFlowToHistory();
  };

  /**
   * 辅助函数：确保当前存在活跃的思维切片卡片
   */
  const ensureActiveThinkingStep = () => {
    if (flowView.activeThinkingStep) return flowView.activeThinkingStep;

    const tStep = createThinkingStepCard({
      text: "",
      durationText: "(0.0s)...",
      isOpen: false, // 铁律：任何时候都不自动展开
    });

    if (flowView.activeTurnRefs?.stepsContainerEl) {
      flowView.activeTurnRefs.stepsContainerEl.appendChild(tStep.cardEl);
    }

    flowView.activeTurnRefs.thinkingCardEl = tStep.cardEl;
    flowView.activeTurnRefs.thinkingDurationEl = tStep.durationEl;
    flowView.activeTurnRefs.thinkingTextStreamEl = tStep.textStreamEl;
    flowView.activeTurnRefs.thinkingBodyEl = tStep.bodyEl;

    const stepItem = {
      type: "thinking",
      id: `think_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: "",
      durationText: "(0.0s)...",
      startTime: Date.now(),
      hasRealThinking: false,
      isExplicitThinking: false,
      cardEl: tStep.cardEl,
      headerEl: tStep.headerEl,
      durationEl: tStep.durationEl,
      previewEl: tStep.previewEl,
      previewStreamEl: tStep.previewStreamEl,
      previewTextEl: tStep.previewStreamEl,
      bodyEl: tStep.bodyEl,
      textStreamEl: tStep.textStreamEl,
    };

    flowView.activeThinkingStep = stepItem;
    if (!Array.isArray(flowView.currentSteps)) {
      flowView.currentSteps = [];
    }
    flowView.currentSteps.push(stepItem);

    if (!flowView.thinkingTimerInterval) {
      flowView.thinkingTimerInterval = setInterval(() => {
        if (flowView.activeThinkingStep?.durationEl) {
          const elapsed = ((Date.now() - flowView.activeThinkingStep.startTime) / 1000).toFixed(1);
          flowView.activeThinkingStep.durationEl.textContent = `(${elapsed}s)...`;
        }
      }, 100);
    }

    return stepItem;
  };

  /**
   * 辅助函数：确保当前存在活跃的阶段性输出切片 (Point 卡)
   * 阶段性输出流式期间内容在最终输出卡中实时可见（不折叠），
   * Point 卡仅在步骤流中承载「Point + 读秒」标题位，封口时内容整体折叠进卡片正文。
   */
  const ensureActiveTextStep = () => {
    if (flowView.activeTextStep) return flowView.activeTextStep;

    const pStep = createPhaseStepCard({
      text: "",
      durationText: "输出中 (0.0s)...",
      isOpen: false, // 铁律：任何时候都不自动展开
    });

    if (flowView.activeTurnRefs?.stepsContainerEl) {
      flowView.activeTurnRefs.stepsContainerEl.appendChild(pStep.cardEl);
    }

    const stepItem = {
      type: "text",
      id: `phase_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: "",
      durationText: "输出中 (0.0s)...",
      startTime: Date.now(),
      cardEl: pStep.cardEl,
      headerEl: pStep.headerEl,
      durationEl: pStep.durationEl,
      previewEl: pStep.previewEl,
      bodyEl: pStep.bodyEl,
      textStreamEl: pStep.textStreamEl,
    };

    flowView.activeTextStep = stepItem;
    if (!Array.isArray(flowView.currentSteps)) {
      flowView.currentSteps = [];
    }
    flowView.currentSteps.push(stepItem);

    if (!flowView.textTimerInterval) {
      flowView.textTimerInterval = setInterval(() => {
        if (flowView.activeTextStep?.durationEl) {
          const elapsed = ((Date.now() - flowView.activeTextStep.startTime) / 1000).toFixed(1);
          flowView.activeTextStep.durationEl.textContent = `输出中 (${elapsed}s)...`;
        }
      }, 100);
    }

    return stepItem;
  };

  /**
   * 封口当前活跃的阶段性输出切片：把已累积的中间段文本从最终输出卡
   * 折叠进 Point 卡正文，定格读秒，并重置最终输出卡以承接下一段输出。
   * 触发时机：tool-start（进入工具调用）或新一轮 text-start（上一段未结清）。
   * @param {string} [taskId] 事件帧归属任务 id（缺省回退前台活跃任务）
   */
  const sealActivePhaseOutput = (taskId = null) => {
    if (!flowView.activeTextStep) return;
    const step = flowView.activeTextStep;
    flowView.activeTextStep = null;
    if (flowView.textTimerInterval) {
      clearInterval(flowView.textTimerInterval);
      flowView.textTimerInterval = null;
    }

    const sealedText = (step.text || "").trim();
    if (!sealedText) {
      // 空段（无实际输出内容）：直接移除空 Point 卡，不沉淀
      step.cardEl?.remove();
      if (Array.isArray(flowView.currentSteps)) {
        flowView.currentSteps = flowView.currentSteps.filter((s) => s !== step);
      }
      return;
    }

    const elapsed = ((Date.now() - step.startTime) / 1000).toFixed(1);
    step.durationText = `已输出 ${elapsed}s`;
    step.text = sealedText;
    step.cardEl?.classList.remove("running");
    if (step.durationEl) {
      step.durationEl.textContent = step.durationText;
    }
    if (step.textStreamEl) {
      step.textStreamEl.innerHTML = api.renderMarkdown(sealedText);
    }

    // 重置最终输出卡：仅保留光标，承接下一段（最终）输出
    streamData(taskId).set({ responseText: "" });
    if (flowView.activeTurnRefs?.responseContentEl) {
      flowView.activeTurnRefs.responseContentEl.innerHTML = `<span class="streaming-cursor"></span>`;
    }
  };

  /**
   * 吸底跟随滚动：仅当用户当前位于底部附近（跟随模式开启）时才随输出定位到底部；
   * 用户向上滚动后 flowView.followBottom 被置 false，流式输出不再拽动视口；
   * 任意时刻用户重新滚回最底部，scroll 监听自动重新开启跟随。
   */
  const followScrollToBottom = () => {
    if (flowScrollArea && flowView.followBottom !== false) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  // 监听滚动位置：距底 ≤ 32px 视为“在底部”→ 开启跟随；向上滚离 → 终止跟随
  const FLOW_BOTTOM_FOLLOW_TOLERANCE_PX = 32;
  if (flowScrollArea) {
    flowScrollArea.addEventListener(
      "scroll",
      () => {
        const distanceToBottom =
          flowScrollArea.scrollHeight - flowScrollArea.scrollTop - flowScrollArea.clientHeight;
        flowView.followBottom = distanceToBottom <= FLOW_BOTTOM_FOLLOW_TOLERANCE_PX;
      },
      { passive: true }
    );
  }

  // 绑定 PiClient 流式事件
  // 流式输出期间仅在“吸底跟随”开启时随输出定位到底部；
  // 用户向上滚动即终止跟随，滚回底部任意时刻重新触发跟随；
  // 另在输出全部结束的瞬间 (finalizeStream / appendFlowAbortNotice) 单次定位到底部
  //
  // 串轮过滤铁律：事件帧携 task_id 且非当前前台活跃任务 (后台挂起任务) 时，
  // 增量内容只入 TaskManager 数据缓冲，绝不触碰前台 Flow DOM 与流式状态
  const isForegroundStreamEvent = () =>
    taskManager.isForegroundStreamTask(piClient.lastEventTaskId || null);

  piClient.addEventListener("thinking-start", () => {
    if (!isForegroundStreamEvent()) return;
    streamData(piClient.lastEventTaskId).set({ hasReceivedDelta: true });
    // 阶段性输出判定铁律：模型输出一段文字后再次进入 Thinking 状态，
    // 则前面那段文字属于「阶段性输出」——先封口为 Point 卡，再继续思维切片
    sealActivePhaseOutput(piClient.lastEventTaskId);
    // 模型回到思维链：工具并未真实执行，清理可能残留的伪工具运行框
    if (typeof api.removeActiveToolPseudoStep === "function") {
      api.removeActiveToolPseudoStep();
    }
    const step = ensureActiveThinkingStep();
    step.isExplicitThinking = true;
    followScrollToBottom();
  });

  piClient.addEventListener("thinking-delta", (e) => {
    if (!isForegroundStreamEvent()) return;
    const fs = streamData(piClient.lastEventTaskId);
    fs.set({ hasReceivedDelta: true });
    const delta = e.detail || "";
    fs.set({ thinkingText: fs.thinkingText + delta });

    const step = ensureActiveThinkingStep();
    step.hasRealThinking = true;
    step.text += delta;

    // 真正捕捉到思维链时，流式刷新收起态流动预览（实时跟踪最新输出流，从右向左流动）+ 展开态正文
    if (step.cardEl) {
      syncThinkingPreview(step.cardEl, step.text, step);
    } else if (step.previewEl) {
      // 兜底：旧卡结构（历史快照）
      step.previewEl.textContent = step.text.replace(/[\r\n\t]+/g, " ").trim();
    }
    if (step.textStreamEl) {
      step.textStreamEl.textContent = step.text;
    }
    if (step.durationEl) {
      const elapsed = ((Date.now() - step.startTime) / 1000).toFixed(1);
      step.durationEl.textContent = `(${elapsed}s)...`;
    }
    if (step.bodyEl) {
      step.bodyEl.scrollTop = step.bodyEl.scrollHeight;
    }
    followScrollToBottom();
  });

  piClient.addEventListener("thinking-end", () => {
    if (!isForegroundStreamEvent()) return;
    sealActiveThinkingStep();
  });

  piClient.addEventListener("text-start", () => {
    if (!isForegroundStreamEvent()) return;
    streamData(piClient.lastEventTaskId).set({ hasReceivedDelta: true });
    // 新一段文本开始：若上一段阶段性输出尚未封口（无工具调用边界），先封口
    sealActivePhaseOutput(piClient.lastEventTaskId);
    // 模型回到正文输出：工具并未真实执行，清理可能残留的伪工具运行框
    if (typeof api.removeActiveToolPseudoStep === "function") {
      api.removeActiveToolPseudoStep();
    }
    sealActiveThinkingStep();
    // 文本输出开始时，收起所有已完成的工具卡片
    api.collapseAllDoneToolCards();
  });

  piClient.addEventListener("text-delta", (e) => {
    if (!isForegroundStreamEvent()) return;
    const fs = streamData(piClient.lastEventTaskId);
    // appendResponse 同步累积响应文本并置 hasReceivedDelta（流式热路径）
    fs.appendResponse(e.detail || "");
    sealActiveThinkingStep();
    // 阶段性输出切片：首增量时创建 Point 卡（标题 + 读秒），内容仍在最终输出卡流式可见
    const textStep = ensureActiveTextStep();
    // 关键：同步累积 Point 步骤文本 —— 否则 sealActivePhaseOutput 读到的 step.text 恒为空，
    // 封口时会被误判为「空段」直接移除，导致 Point 卡永不保留（阶段性输出显示逻辑失效的根因）
    textStep.text += e.detail || "";
    if (textStep.previewEl) {
      textStep.previewEl.textContent = fs.responseText.replace(/[\r\n\t]+/g, " ").trim();
    }
    if (flowView.activeTurnRefs?.responseContentEl) {
      flowView.activeTurnRefs.responseContentEl.innerHTML =
        api.renderMarkdown(fs.responseText) + `<span class="streaming-cursor"></span>`;
    }
    followScrollToBottom();
  });

  api.resetStreamState = resetStreamState;
  api.finalizeStream = finalizeStream;
  api.sealActiveThinkingStep = sealActiveThinkingStep;
  api.ensureActiveThinkingStep = ensureActiveThinkingStep;
  api.sealActivePhaseOutput = sealActivePhaseOutput;
  api.resetCurrentTurnForResend = resetCurrentTurnForResend;
  api.renderAbortNoticeHtml = renderAbortNoticeHtml;
  api.appendFlowAbortNotice = appendFlowAbortNotice;
  api.renderErrorCard = renderErrorCard;
}
