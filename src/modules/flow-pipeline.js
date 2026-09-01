import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { VIEW_FLOW } from "../lib/view-constants.js";
import { piClient } from "../services/pi-client.js";
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
    if (!rawToolName || !flow.activeTurnRefs?.injectionCapsuleEl || !flow.activeTurnRefs?.injectionTextEl) return;
    const nameLower = rawToolName.toString().toLowerCase().trim();
    const mapped = activeToolSkillMappings.get(nameLower);
    if (mapped) {
      flow.activeTurnRefs.injectionTextEl.textContent = mapped.label || `已激活运行态技能：${mapped.skill}`;
      flow.activeTurnRefs.injectionCapsuleEl.classList.remove("hidden");
      if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  loadInnerSkillMappings();

  piClient.addEventListener("toolcall-delta-start", (e) => {
    api.autoCollapseThinkingOnNextPhase();
    const evt = e.detail;
    if (evt?.toolCall?.name) {
      showInnerSkillCapsuleForTool(evt.toolCall.name);
    }
  });

  piClient.addEventListener("tool-start", (e) => {
    flow.hasReceivedDelta = true;
    api.autoCollapseThinkingOnNextPhase();
    const data = e.detail;
    const toolCallId = data.toolCallId;
    const toolName = data.toolName || "tool";

    // 新工具卡片出现时，自动收起所有已完成的旧工具卡片
    api.collapseAllDoneToolCards();

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
          api.expandToolCard(card);
        } else {
          api.collapseToolCard(card);
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

    if (flow.activeTurnRefs?.toolCallsContainerEl) {
      flow.activeTurnRefs.toolCallsContainerEl.appendChild(card);
    }
    flow.renderedToolCards.set(toolCallId, card);
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("bash-update", () => {
    showInnerSkillCapsuleForTool("bash");
  });

  piClient.addEventListener("tool-update", (e) => {
    const data = e.detail;
    const card = flow.renderedToolCards.get(data.toolCallId);
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
    const card = flow.renderedToolCards.get(data.toolCallId);
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
    if (flow.activeTurnRefs?.thinkingDurationEl && data.attempt) {
      flow.activeTurnRefs.thinkingDurationEl.textContent = `自动重试中 (${data.attempt}/${data.maxAttempts || 3})...`;
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
    // 「终止并发送」进行中：旧轮报错视为已结算，不渲染错误卡、不进入自愈
    if (flow.interruptSendTaskId) {
      const errTaskId = e.detail?.taskId || e.detail?.raw?.task_id || e.detail?.task_id;
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

    if (flowBtnAbort) {
      flowBtnAbort.classList.remove("hidden");
    }

    // 记录本次附带的文件用于多模态失败检测与自适应重试
    flow.lastSentAttachments = [...filesToAttach];

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
