import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { notificationService } from "../services/notification-service.js";
import { taskManager } from "../services/task-manager.js";
import { modelFailoverEngine } from "../services/model-failover.js";

/**
 * 流式状态机、错误卡渲染与自动重连胶囊
 */
export function initFlowStream(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const flowScrollArea = el.flowScrollArea;
  const flowConversation = el.flowConversation;
  const thinkingToggleBtn = el.thinkingToggleBtn;
  const flowResponseContent = el.flowResponseContent;
  const flowBtnAbort = el.flowBtnAbort;
  const taskDetailsSidebar = el.taskDetailsSidebar;

  /**
   * 初始化/重置流式状态（支持多轮追加与新会话独立划分）
   * @param {string} query
   * @param {Array<any>} attachments
   * @param {boolean} isFollowUpTurn 是否为同会话多轮后续追问
   */
  const resetStreamState = (query, attachments = [], isFollowUpTurn = false) => {
    flow.lastUserQuery = query;
    flow.currentErrorMessage = null;
    flow.hasReceivedDelta = false;
    flow.hasAutoCollapsedThinking = false;
    flow.currentThinkingText = "";
    flow.currentResponseText = "";
    flow.renderedToolCards.clear();

    if (!isFollowUpTurn) {
      // 全新会话 -> 清空 flowConversation 容器
      if (flowConversation) {
        flowConversation.innerHTML = "";
      }
    } else {
      // 同工作流多轮对话 -> 固化上一轮（收起思考与工具卡片，移除上一轮光标）
      if (flow.activeTurnRefs) {
        api.collapseThinkingCard(flow.activeTurnRefs.thinkingCardEl, flow.activeTurnRefs.thinkingToggleBtn);
        if (flow.activeTurnRefs.responseContentEl) {
          const prevCursor = flow.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
          if (prevCursor) prevCursor.remove();
        }
      }
      api.collapseAllDoneToolCards();
    }

    // 创建当前轮次的 DOM 组并追加到 flowConversation
    flow.activeTurnRefs = api.createFlowTurnGroupElement({
      query,
      attachments,
      thinkingText: "",
      thinkingDurationText: "思考中...",
      responseText: "",
      toolCalls: [],
      isOpenThinking: true,
    });

    if (flowConversation && flow.activeTurnRefs?.groupEl) {
      flowConversation.appendChild(flow.activeTurnRefs.groupEl);
    }

    if (flow.activeTurnRefs.responseContentEl) {
      flow.activeTurnRefs.responseContentEl.innerHTML = `<span class="streaming-cursor"></span>`;
    }

    api.expandThinkingCard(flow.activeTurnRefs.thinkingCardEl, flow.activeTurnRefs.thinkingToggleBtn);

    flow.thinkingStartTime = Date.now();
    if (flow.thinkingTimerInterval) clearInterval(flow.thinkingTimerInterval);
    flow.thinkingTimerInterval = setInterval(() => {
      if (flow.activeTurnRefs?.thinkingDurationEl) {
        const elapsed = ((Date.now() - flow.thinkingStartTime) / 1000).toFixed(1);
        flow.activeTurnRefs.thinkingDurationEl.textContent = `思考中 (${elapsed}s)...`;
      }
    }, 100);

    if (flowScrollArea) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }

    // 新轮次就绪后刷新顶部悬浮提问提示
    api.updateFlowQuestionTip();
    // 新轮次追加后刷新右侧多段对话定位导航显隐（>= 2 轮时显现）
    api.updateFlowTurnNav();
  };

  const finalizeStream = () => {
    piClient.isStreaming = false;
    if (flow.thinkingTimerInterval) {
      clearInterval(flow.thinkingTimerInterval);
      flow.thinkingTimerInterval = null;
      if (flow.activeTurnRefs?.thinkingDurationEl) {
        const finalElapsed = ((Date.now() - flow.thinkingStartTime) / 1000).toFixed(1);
        flow.activeTurnRefs.thinkingDurationEl.textContent = `已思考 ${finalElapsed} 秒`;
      }
    }
    // 移除光标
    if (flow.activeTurnRefs?.responseContentEl) {
      const cursor = flow.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
    }
    // 流式结束时隐藏 Flow 中止按钮
    if (flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
    }
    // 正常完成且无错误时，为当前轮次输出卡片挂载保存按钮
    if (
      flow.activeTurnRefs &&
      !flow.currentErrorMessage &&
      flow.currentResponseText &&
      flow.currentResponseText.trim() &&
      typeof api.attachResponseSaveButton === "function"
    ) {
      api.attachResponseSaveButton(flow.activeTurnRefs, {
        query: flow.lastUserQuery,
        responseText: flow.currentResponseText,
        thinkingText: flow.currentThinkingText,
      });
    }
  };

  /**
   * 自动重连切换：复用当前 Turn 容器重发相同输入前重置当前轮次流式状态
   * 不重建用户提问卡、不重复压入 prompt history、不新建 Task，仅清除上一轮临时产物
   */
  const resetCurrentTurnForResend = () => {
    flow.currentThinkingText = "";
    flow.currentResponseText = "";
    flow.currentErrorMessage = null;
    flow.hasReceivedDelta = false;
    flow.hasAutoCollapsedThinking = false;
    flow.renderedToolCards.clear();

    // 移除上一轮临时错误卡片 (避免重复堆叠)
    if (flow.activeTurnRefs?.responseContentEl) {
      const errCard = flow.activeTurnRefs.responseContentEl.querySelector(".sketch-error-card");
      if (errCard) errCard.remove();
      const cursor = flow.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
      flow.activeTurnRefs.responseContentEl.innerHTML = `<span class="streaming-cursor"></span>`;
    }
    // 清空思考流文本与工具卡片容器
    if (flow.activeTurnRefs?.thinkingTextStreamEl) {
      flow.activeTurnRefs.thinkingTextStreamEl.textContent = "";
    }
    if (flow.activeTurnRefs?.toolCallsContainerEl) {
      flow.activeTurnRefs.toolCallsContainerEl.innerHTML = "";
    }
    // 重置运行态技能胶囊
    if (flow.activeTurnRefs) {
      if (flow.activeTurnRefs.activatedSkills) {
        flow.activeTurnRefs.activatedSkills.clear();
      }
      if (flow.activeTurnRefs.injectionCapsuleEl) {
        flow.activeTurnRefs.injectionCapsuleEl.classList.add("hidden");
      }
      if (flow.activeTurnRefs.injectionTextEl) {
        flow.activeTurnRefs.injectionTextEl.textContent = "";
      }
    }
    // 重开思考卡片并重置耗时计时
    api.expandThinkingCard(flow.activeTurnRefs.thinkingCardEl, flow.activeTurnRefs.thinkingToggleBtn);
    flow.thinkingStartTime = Date.now();
    if (flow.thinkingTimerInterval) clearInterval(flow.thinkingTimerInterval);
    flow.thinkingTimerInterval = setInterval(() => {
      if (flow.activeTurnRefs?.thinkingDurationEl) {
        const elapsed = ((Date.now() - flow.thinkingStartTime) / 1000).toFixed(1);
        flow.activeTurnRefs.thinkingDurationEl.textContent = `思考中 (${elapsed}s)...`;
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
    if (!flow.activeTurnRefs?.failoverCapsuleEl || !flow.activeTurnRefs?.failoverTextEl) return;
    const phase = payload.phase || "";
    const textEl = flow.activeTurnRefs.failoverTextEl;
    const capsule = flow.activeTurnRefs.failoverCapsuleEl;

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
      flow.thinkingTimerInterval
    ) {
      clearInterval(flow.thinkingTimerInterval);
      flow.thinkingTimerInterval = null;
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
    if (flow.activeTurnRefs?.responseContentEl) {
      const cursor = flow.activeTurnRefs.responseContentEl.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
      if (!flow.activeTurnRefs.responseContentEl.querySelector(".flow-abort-callout")) {
        flow.activeTurnRefs.responseContentEl.insertAdjacentHTML("beforeend", renderAbortNoticeHtml());
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
      (lower.includes("400") && Array.isArray(flow.lastSentAttachments) && flow.lastSentAttachments.some((f) => f.category === "image"))
    );
  };

  /**
   * 渲染手绘草图风格异常诊断卡片并提供快捷操作与多模态建议
   * @param {{ message: string, model?: string, provider?: string }} errDetail
   */
  const renderErrorCard = (errDetail) => {
    piClient.isStreaming = false;
    flow.currentErrorMessage = errDetail?.message || "与模型服务通信中断或返回异常";
    const currentTask = taskManager.getCurrentActiveTask();
    if (currentTask) {
      currentTask.status = "error";
      currentTask.completedAt = Date.now();
      currentTask.errorMessage = flow.currentErrorMessage;
      taskManager.dispatchEvent(new CustomEvent("task-updated", { detail: currentTask }));
      taskManager.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: taskManager.getAllTasks() } }));
    }
    finalizeStream();
    if (flowBtnAbort) {
      flowBtnAbort.classList.add("hidden");
    }
    const errMsg = flow.currentErrorMessage;

    // 软件失焦时立即弹出报错终止通知 (带 Windows 默认提示音)
    notificationService.notifyError({
      title: "pi-dl",
      message: `模型调用异常终止：${errMsg.length > 80 ? errMsg.slice(0, 77) + "..." : errMsg}`,
      taskId: "agent-prompt",
    });

    const targetResponseEl = flow.activeTurnRefs?.responseContentEl || flowResponseContent;
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

    if (!flow.currentResponseText || flow.currentResponseText.trim().length === 0) {
      targetResponseEl.innerHTML = cardHtml;
    } else {
      targetResponseEl.insertAdjacentHTML("beforeend", cardHtml);
    }

    // 报错时确保移除可能已挂载的保存按钮
    if (flow.activeTurnRefs && typeof api.attachResponseSaveButton === "function") {
      api.attachResponseSaveButton(flow.activeTurnRefs, {
        errorMessage: flow.currentErrorMessage,
      });
    }

    const btnRetry = document.getElementById("btn-err-retry");
    const btnSwitch = document.getElementById("btn-err-switch-model");
    const btnGotoPackages = document.getElementById("btn-err-goto-packages");

    if (btnRetry) {
      btnRetry.addEventListener("click", () => {
        if (flow.lastUserQuery) {
          api.handleFlowQuery(flow.lastUserQuery, flow.lastSentAttachments);
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

    // 报错终止时即时自动沉淀快照至历史记录
    api.archiveCurrentFlowToHistory();
  };

  // 绑定 PiClient 流式事件
  piClient.addEventListener("thinking-start", () => {
    flow.hasReceivedDelta = true;
    if (!flow.hasAutoCollapsedThinking) {
      api.expandThinkingCard();
    }
  });

  piClient.addEventListener("thinking-delta", (e) => {
    flow.hasReceivedDelta = true;
    flow.currentThinkingText += e.detail;
    if (flow.activeTurnRefs?.thinkingTextStreamEl) {
      flow.activeTurnRefs.thinkingTextStreamEl.textContent = flow.currentThinkingText;
    }
    if (flow.activeTurnRefs?.thinkingBodyEl) {
      flow.activeTurnRefs.thinkingBodyEl.scrollTop = flow.activeTurnRefs.thinkingBodyEl.scrollHeight;
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("thinking-end", () => {
    if (flow.activeTurnRefs?.thinkingDurationEl) {
      const elapsed = ((Date.now() - flow.thinkingStartTime) / 1000).toFixed(1);
      flow.activeTurnRefs.thinkingDurationEl.textContent = `已思考 ${elapsed} 秒`;
    }
    api.autoCollapseThinkingOnNextPhase();
  });

  piClient.addEventListener("text-start", () => {
    flow.hasReceivedDelta = true;
    api.autoCollapseThinkingOnNextPhase();
    // 文本输出开始时，收起所有已完成的工具卡片
    api.collapseAllDoneToolCards();
  });

  piClient.addEventListener("text-delta", (e) => {
    flow.hasReceivedDelta = true;
    api.autoCollapseThinkingOnNextPhase();
    flow.currentResponseText += e.detail;
    if (flow.activeTurnRefs?.responseContentEl) {
      flow.activeTurnRefs.responseContentEl.innerHTML = api.renderMarkdown(flow.currentResponseText) + `<span class="streaming-cursor"></span>`;
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  api.resetStreamState = resetStreamState;
  api.finalizeStream = finalizeStream;
  api.resetCurrentTurnForResend = resetCurrentTurnForResend;
  api.renderAbortNoticeHtml = renderAbortNoticeHtml;
  api.appendFlowAbortNotice = appendFlowAbortNotice;
  api.renderErrorCard = renderErrorCard;
}
