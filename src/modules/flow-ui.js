import { escapeHtml, cleanUserPrompt } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { VIEW_FLOW } from "../lib/view-constants.js";
import { invokeTauri } from "../services/tauri-bridge.js";
import { renderMarkdown, initMarkdownInteractions } from "../lib/markdown-renderer.js";
import { flowStore } from "../services/stores/flow-store.js";
import { resolveStreamTaskId } from "./flow-state-view.js";
import { collapseToolCard, createThinkingStepCard, createPhaseStepCard, createToolStepCard } from "./flow-render.js";
import { bindAll } from "../lib/el-binder.js";
import { getFileCategoryIcon } from "./file-attachments.js";

/**
 * Flow 渲染核心：Markdown、轮次 DOM、悬浮提问提示与上下定位导航
 */
export function initFlowUi(ctx) {
  const api = ctx.api;
  const viewStore = ctx.viewStore;
  const settingsStore = ctx.settingsStore;
  const flowView = ctx.flowView;
  const flowStore = ctx.flowStore;
  const flowDom = ctx.flowDom;

  // 用户交互路径（保存按钮 / 悬浮提示 / 自动折叠）读取前台任务纯数据分仓
  const streamData = () => flowStore.for(resolveStreamTaskId());

  // 批次 B：模块自绑定（appContainer 跨簇共享 id，同 id 同元素）
  const el = bindAll({
    appContainer: "app-container",
  });

  const appContainer = el.appContainer;
  const flowStage = flowDom.flowStage;
  const flowScrollArea = flowDom.flowScrollArea;
  const flowConversation = flowDom.flowConversation;
  const flowQuestionTip = flowDom.flowQuestionTip;
  const flowQuestionTipText = flowDom.flowQuestionTipText;
  const flowTurnNav = flowDom.flowTurnNav;
  const flowTurnNavUp = flowDom.flowTurnNavUp;
  const flowTurnNavDown = flowDom.flowTurnNavDown;
  const thinkingToggleBtn = flowDom.thinkingToggleBtn;
  const agentThinkingCard = flowDom.agentThinkingCard;

  // 初始化代码块一键复制与 Markdown 内部交互委托
  initMarkdownInteractions(document);

  // 用户提问卡片一键复制（事件委托：同时覆盖静态初始模板与动态历史轮次）
  if (flowConversation) {
    flowConversation.addEventListener("click", async (e) => {
      const copyBtn = e.target.closest(".prompt-copy-btn");
      if (!copyBtn) return;
      e.stopPropagation();
      const card = copyBtn.closest(".flow-user-prompt-card");
      const text = (copyBtn.dataset.copyText || card?.dataset?.copyText || card?.querySelector(".prompt-content")?.textContent || "").trim();
      if (!text || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.classList.add("copied");
        copyBtn.title = "已复制";
        setTimeout(() => {
          copyBtn.classList.remove("copied");
          copyBtn.title = "复制提问";
        }, 1400);
      } catch (err) {
        console.warn("[FlowUi] Prompt copy failed:", err);
      }
    });
  }

  // ==========================================================================
  // Flow 流式渲染核心
  // 说明：视图派生缓存（当前轮次 DOM 引用、工具卡注册表、活跃切片卡、计时器）
  //       收敛于 flowView（flow-state-view.js 唯一属主）；流式纯数据一律经
  //       flowStore.for(taskId) 分仓读写，两者严禁混用。
  // ==========================================================================

  /** 收起所有工具卡片（不包括 running 状态） */
  const collapseAllDoneToolCards = () => {
    flowView.renderedToolCards.forEach((card) => {
      if (!card.classList.contains("running")) {
        collapseToolCard(card);
      }
    });
  };

  /** 收起所有工具卡片（包括 running） */
  const collapseAllToolCards = () => {
    flowView.renderedToolCards.forEach((card) => {
      collapseToolCard(card);
    });
  };

  const collapseThinkingCard = (cardEl = null, btnEl = null) => {
    const targetCard = cardEl || flowView.activeTurnRefs?.thinkingCardEl || agentThinkingCard;
    const targetBtn = btnEl || flowView.activeTurnRefs?.thinkingToggleBtn || thinkingToggleBtn;
    if (targetCard && targetCard.classList.contains("open")) {
      targetCard.classList.remove("open");
      if (targetBtn) targetBtn.setAttribute("aria-expanded", "false");
    }
  };

  const autoCollapseThinkingOnNextPhase = () => {
    const fs = streamData();
    if (!fs.hasAutoCollapsedThinking) {
      fs.set({ hasAutoCollapsedThinking: true });
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
   * @param {Array<any>} [options.steps=[]]
   * @param {boolean} [options.isOpenThinking=false]
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
    steps = [],
    isOpenThinking = false,
    isAborted = false,
    errorMessage = null,
  } = {}) => {
    const groupEl = document.createElement("div");
    groupEl.className = "flow-message-group";

    // 1. 用户问题卡片（净化剥离注入信封与绝对路径尾注，始终展示真实用户输入）
    const userPromptCard = document.createElement("div");
    userPromptCard.className = "flow-user-prompt-card";

    const cleanQuery = cleanUserPrompt(query);

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

    if (cleanQuery) {
      userPromptCard.dataset.copyText = cleanQuery;
    }
    userPromptCard.innerHTML = `
      <div class="prompt-icon">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M4 10 L16 10 M11 5 L16 10 L11 15" />
        </svg>
      </div>
      <div class="prompt-main-wrap">
        ${attachmentsHtml}
        <p class="prompt-content">${escapeHtml(cleanQuery || (attachments.length > 0 ? `[附带 ${attachments.length} 个文件/图片]` : ""))}</p>
      </div>
      <button class="prompt-copy-btn" type="button" title="复制提问" aria-label="复制提问">${ICONS.copy}</button>
      <button class="flow-rollback-btn" type="button" title="回退到此处（撤回此轮及之后的文件变更）" aria-label="回退到此处">${ICONS.rewind}</button>
    `;
    groupEl.appendChild(userPromptCard);

    // 2. code-area 路由目标项目胶囊
    const isCodeArea = settingsStore.activeWorkspace?.id === "code-area" || settingsStore.activeWorkspace?.requiresRoute;
    const routePath = settingsStore.activeWorkspace?.routePath;
    const routeName = settingsStore.activeWorkspace?.routeName || (routePath ? routePath.split("/").pop() : "");

    const routeCapsuleEl = document.createElement("div");
    routeCapsuleEl.className = `flow-route-capsule ${isCodeArea && routePath ? "" : "hidden"}`;
    routeCapsuleEl.setAttribute("title", `路由目标物理路径: ${routePath || ""}`);
    routeCapsuleEl.innerHTML = `
      <span class="capsule-icon" aria-hidden="true">${ICONS.folder}</span>
      <span class="capsule-text">路由目标项目：<strong>${escapeHtml(routeName || routePath || "")}</strong></span>
    `;
    groupEl.appendChild(routeCapsuleEl);

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

    // 3. 【时序步骤流容器】：按时间拼接思维切片与工具切片 (思维1-工具1-思维2-工具2...)
    const stepsContainerEl = document.createElement("div");
    stepsContainerEl.className = "flow-steps-container";

    let firstThinkingRef = null;

    // 若传入结构化 steps 数组，按序渲染切片
    if (Array.isArray(steps) && steps.length > 0) {
      steps.forEach((step) => {
        if (step.type === "text") {
          // 阶段性输出切片 (Point)：必须在 thinking 回退分支之前判断，
          // 否则携带 text 字段的历史步骤会被误渲染为 Thinking 卡
          const pStep = createPhaseStepCard({
            text: step.text || "",
            durationText: step.durationText || "已输出",
            isOpen: false,
          });
          stepsContainerEl.appendChild(pStep.cardEl);
        } else if (step.type === "thinking" || step.text) {
          const tStep = createThinkingStepCard({
            text: step.text || "",
            durationText: step.durationText || "已完成思考",
            isOpen: false,
          });
          if (!firstThinkingRef) firstThinkingRef = tStep;
          stepsContainerEl.appendChild(tStep.cardEl);
        } else if (step.type === "tool" || step.name || step.id) {
          const toolStep = createToolStepCard({
            id: step.id || "",
            name: step.name || "tool",
            args: step.args || step.arguments_text,
            status: step.status || (step.is_error ? "failure" : "done"),
            result: step.result || step.result_text,
            durationText: step.durationText || "",
            isOpen: false,
          });
          stepsContainerEl.appendChild(toolStep.cardEl);
        }
      });
    } else {
      // 兼容历史单一 thinkingText 与 toolCalls 格式
      if (thinkingText && thinkingText.trim()) {
        const tStep = createThinkingStepCard({
          text: thinkingText,
          durationText: thinkingDurationText || "已完成思考",
          isOpen: false,
        });
        firstThinkingRef = tStep;
        stepsContainerEl.appendChild(tStep.cardEl);
      }
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        toolCalls.forEach((tc) => {
          if (tc.html && tc.html.includes("flow-step-card")) {
            stepsContainerEl.insertAdjacentHTML("beforeend", tc.html);
          } else {
            const toolStep = createToolStepCard({
              id: tc.id || "",
              name: tc.name || "tool",
              args: tc.args || tc.arguments_text,
              status: tc.status || (tc.is_error ? "failure" : "done"),
              result: tc.result || tc.result_text,
              isOpen: false,
            });
            stepsContainerEl.appendChild(toolStep.cardEl);
          }
        });
      }
    }

    // 重绑历史快照卡片的点击折叠：仅处理 outerHTML 快照解析出的卡片（解析后无任何监听器）。
    // 工厂新创建的卡片已在创建时绑定并标记 __piBound（expando 不序列化），此处跳过，
    // 杜绝双重绑定导致一次点击 toggle 两次互消（表现为收起状态无法点开）；
    // 快照 HTML 中可能残留旧的 data-bound="1" 标记，一律忽略并无条件重绑
    stepsContainerEl.querySelectorAll(".tool-card, .flow-step-card").forEach((card) => {
      const header = card.querySelector(".flow-step-header") || card.querySelector(".tool-header");
      if (!header || header.__piBound) return;
      const toggleCardCollapse = () => {
        const open = card.classList.toggle("open");
        card.classList.toggle("collapsed", !open);
        header.setAttribute("aria-expanded", open ? "true" : "false");
        if (!open) {
          const previewEl = card.querySelector(".thinking-preview");
          if (previewEl) previewEl.scrollLeft = previewEl.scrollWidth;
        }
      };
      header.addEventListener("click", toggleCardCollapse);
      header.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCardCollapse();
        }
      });
    });

    // 确保收起态的思维切片预览滚动对齐至最右侧（跟踪最新思考内容）
    stepsContainerEl.querySelectorAll(".flow-step-thinking:not(.open) .thinking-preview").forEach((prevEl) => {
      prevEl.scrollLeft = prevEl.scrollWidth;
    });

    // 历史步骤卡片一键复制委托
    stepsContainerEl.addEventListener("click", async (e) => {
      const copyBtn = e.target.closest(".tool-copy-btn");
      if (copyBtn) {
        e.stopPropagation();
        const textToCopy = copyBtn.dataset.copyText || "";
        if (textToCopy && navigator.clipboard) {
          try {
            await navigator.clipboard.writeText(textToCopy);
            const tip = copyBtn.querySelector(".copy-tip");
            if (tip) {
              const prev = tip.textContent;
              tip.textContent = "已复制";
              copyBtn.classList.add("copied");
              setTimeout(() => {
                tip.textContent = prev;
                copyBtn.classList.remove("copied");
              }, 1400);
            }
          } catch (err) {
            console.warn("[FlowUi] Tool copy failed:", err);
          }
        }
      }
    });

    groupEl.appendChild(stepsContainerEl);

    // 5. Agent 回答卡片（永不折叠 Markdown 输出）
    const responseCardEl = document.createElement("div");
    responseCardEl.className = "flow-response-card";
    const responseContentEl = document.createElement("div");
    responseContentEl.className = "response-content";

    let initialHtml = renderMarkdown(responseText);
    if (isAborted || responseText?.includes("刚刚会话已手动终止")) {
      if (!initialHtml.includes("flow-abort-callout") && !initialHtml.includes("刚刚会话已手动终止")) {
        initialHtml += api.renderAbortNoticeHtml();
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
    const failoverTextEl = failoverCapsuleEl.querySelector(".capsule-text");

    const turnRefs = {
      groupEl,
      userTextEl,
      promptAttachmentsEl,
      failoverCapsuleEl,
      failoverTextEl,
      stepsContainerEl,
      thinkingCardEl: firstThinkingRef?.cardEl || null,
      thinkingToggleBtn: firstThinkingRef?.headerEl || null,
      thinkingDurationEl: firstThinkingRef?.durationEl || null,
      thinkingTextStreamEl: firstThinkingRef?.textStreamEl || null,
      thinkingBodyEl: firstThinkingRef?.bodyEl || null,
      toolCallsContainerEl: stepsContainerEl,
      responseCardEl,
      responseContentEl,
    };

    // 若当前为已有成功输出且未处于报错状态，直接挂载保存按钮
    if (responseText && responseText.trim() && !errorMessage) {
      attachResponseSaveButton(turnRefs, {
        query,
        responseText,
        thinkingText,
      });
    }

    return turnRefs;
  };

  /**
   * 将指定轮次内容导出并保存为 Markdown 文件到桌面
   * @param {Object} turnData
   * @param {string} [turnData.query=""]
   * @param {string} [turnData.responseText=""]
   * @param {string} [turnData.thinkingText=""]
   * @param {HTMLButtonElement} [btnEl=null]
   */
  const saveTurnOutputToDesktop = async (turnData = {}, btnEl = null) => {
    const fs = streamData();
    const query = turnData.query || fs.lastUserQuery || "";
    const responseText = turnData.responseText || fs.responseText || "";
    const thinkingText = turnData.thinkingText || fs.thinkingText || "";

    if (!responseText || !responseText.trim()) {
      if (typeof window.sketchAlert === "function") {
        await window.sketchAlert("当前无有效的输出结果可保存", { type: "warning", title: "无法保存" });
      }
      return;
    }

    try {
      if (btnEl) {
        btnEl.classList.add("saving");
        btnEl.innerHTML = `<span class="btn-icon">${ICONS.sparkle}</span><span>保存中...</span>`;
      }

      // 生成文件名：根据提问前缀 + 时间戳
      const cleanTitle = (query || "输出结果")
        .replace(/[\r\n\\/:*?"<>|]+/g, "_")
        .trim()
        .slice(0, 30);
      const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
      const filename = `${cleanTitle || "pi_output"}_${timestamp}.md`;

      // 拼装 Markdown 内容：仅包含“用户提问”与“回答结果”
      let mdContent = "";
      if (query && query.trim()) {
        mdContent += `### 用户提问\n\n${query.trim()}\n\n---\n\n`;
      }
      mdContent += `### 回答结果\n\n${responseText.trim()}\n`;

      const savedPath = await invokeTauri("pi_save_markdown_to_desktop", {
        filename,
        content: mdContent,
      });

      if (btnEl) {
        btnEl.classList.remove("saving");
        btnEl.classList.add("saved");
        btnEl.innerHTML = `<span class="btn-icon">${ICONS.check}</span><span>已保存至桌面</span>`;
        setTimeout(() => {
          btnEl.classList.remove("saved");
          btnEl.innerHTML = `<span class="btn-icon">${ICONS.save}</span><span>保存</span>`;
        }, 2200);
      }

      // 友好提示
      if (typeof window.sketchAlert === "function") {
        await window.sketchAlert(`输出结果已成功保存为 Markdown 文件！\n\n保存路径：\n${savedPath || "桌面"}`, {
          type: "success",
          title: "保存成功",
        });
      }
    } catch (err) {
      console.error("[Flow] Failed to save markdown output to desktop:", err);
      if (btnEl) {
        btnEl.classList.remove("saving");
        btnEl.innerHTML = `<span class="btn-icon">${ICONS.save}</span><span>保存</span>`;
      }
      if (typeof window.sketchAlert === "function") {
        await window.sketchAlert(`保存失败: ${err?.message || err || "未知错误"}`, {
          type: "error",
          title: "保存失败",
        });
      }
    }
  };

  /**
   * 为指定轮次的回答卡片挂载或更新手绘保存按钮
   * @param {Object} turnRefs 包含 responseCardEl / responseContentEl 等引用的对象
   * @param {Object} [turnData={}] 包含 query, responseText, thinkingText 的数据对象
   */
  const attachResponseSaveButton = (turnRefs, turnData = {}) => {
    if (!turnRefs || !turnRefs.responseCardEl) return;
    const responseCardEl = turnRefs.responseCardEl;
    const responseText = turnData.responseText !== undefined ? turnData.responseText : (streamData().responseText || "");

    // 如果没有回答文本，或者存在报错卡片 / errorMessage，则移除保存按钮
    const hasError = Boolean(turnData.errorMessage) || Boolean(responseCardEl.querySelector(".sketch-error-card"));
    if (!responseText || !responseText.trim() || hasError) {
      const existingActions = responseCardEl.querySelector(".flow-response-actions");
      if (existingActions) existingActions.remove();
      return;
    }

    let actionsEl = responseCardEl.querySelector(".flow-response-actions");
    if (!actionsEl) {
      actionsEl = document.createElement("div");
      actionsEl.className = "flow-response-actions";
      responseCardEl.appendChild(actionsEl);
    }

    actionsEl.innerHTML = `
      <button type="button" class="flow-save-btn" title="将输出结果以 Markdown 格式保存到桌面">
        <span class="btn-icon">${ICONS.save}</span>
        <span>保存</span>
      </button>
    `;

    const saveBtn = actionsEl.querySelector(".flow-save-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await saveTurnOutputToDesktop(turnData, saveBtn);
      });
    }
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
        const rawQuestion = qEl?.textContent || streamData().lastUserQuery || "";
        question = rawQuestion.replace(/\r?\n+/g, " ").trim();
      } else {
        const rawQuestion = String(streamData().lastUserQuery || flowView.activeTurnRefs?.userTextEl?.textContent || "");
        question = rawQuestion.replace(/\r?\n+/g, " ").trim();
      }
    }

    flowQuestionTipText.textContent = question;
    const shouldShow = viewStore.mode === VIEW_FLOW && overflowing && Boolean(question);
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
  // 「上」按钮两段式优化：视口顶边距当前轮最终输出顶部 <= 100px（含其上方思考/提问区）→ 回退定位上一轮最终输出顶部；
  //           已深入当前轮最终输出（> 100px 且未越过其底部）→ 先定位当前轮最终输出顶部，避免误跳过当前轮；
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

  // 视口顶边「内容线」：滚动区顶边 + 顶部悬浮提示吸附高度（锚定判定与定位偏移共用同一基准）
  const getViewportTopLine = () => {
    if (!flowScrollArea) return 0;
    return flowScrollArea.getBoundingClientRect().top + getStickyTipOffset();
  };

  // 当前锚定轮次：取「最终输出内容顶部 <= 视口顶边(+提示吸附高度)」的最后一个轮次；
  // 与定位使用同一目标，点击后锚定随之推进，可连续多次向上/向下定位（修复二次点击失效）。
  const getAnchoredTurnIndex = () => {
    if (!flowScrollArea || !flowConversation) return -1;
    const groups = flowConversation.querySelectorAll(".flow-message-group");
    if (groups.length === 0) return -1;
    const threshold = getViewportTopLine();
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

  // 当前所在轮次 N：最后一个「整组对话起点（用户提问卡顶部）<= 视口顶边」的轮次；
  // 用于「上」按钮两段式定位（情形 1 / 情形 2）的基准轮次判定。
  const getCurrentTurnIndex = () => {
    if (!flowScrollArea || !flowConversation) return -1;
    const groups = flowConversation.querySelectorAll(".flow-message-group");
    if (groups.length === 0) return -1;
    const viewTop = getViewportTopLine();
    let n = 0;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].getBoundingClientRect().top <= viewTop) {
        n = i;
      } else {
        break;
      }
    }
    return n;
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

  // 「上」按钮两段式优化定位（基于视口顶边位置相对当前轮次第 N 轮最终输出的判定）：
  //   - 情形 1：视口顶边位于第 N 轮对话开头下方、且距第 N 轮最终输出顶部不超过 100px
  //     （含其上方思考/提问区）→ 定位到第 N-1 轮最终输出顶部；
  //   - 情形 2：视口顶边位于第 N 轮最终输出顶部向下 100px 范围之下、第 N 轮最终输出底部之上
  //     （或已越过其底部）→ 先定位到第 N 轮最终输出顶部，避免误跳过当前轮。
  const OUTPUT_TOP_PROXIMITY_PX = 100;
  const scrollToPreviousTurn = () => {
    if (!flowConversation) return;
    const groups = flowConversation.querySelectorAll(".flow-message-group");
    if (groups.length === 0) return;

    const viewTop = getViewportTopLine();
    const n = getCurrentTurnIndex();
    if (n < 0) return;

    const respTop = getTurnResponseAnchor(groups[n]).getBoundingClientRect().top;
    if (viewTop <= respTop + OUTPUT_TOP_PROXIMITY_PX) {
      // 情形 1：位于第 N 轮最终输出顶部向上 100px 范围内（含其上方思考/提问区）→ 回退到第 N-1 轮最终输出顶部
      if (n <= 0) return; // 已是第一轮（或无可定位轮次）
      scrollToTurnStart(n - 1);
    } else {
      // 情形 2：已深入第 N 轮最终输出（或越过其底部）→ 先定位到第 N 轮最终输出顶部
      scrollToTurnStart(n);
    }
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
    if (!flowTurnNav || !flowStage || !appContainer || viewStore.mode !== VIEW_FLOW) return;
    const appRect = appContainer.getBoundingClientRect();
    const stageRect = flowStage.getBoundingClientRect();
    const navHeight = flowTurnNav.offsetHeight || 0;
    flowTurnNav.style.top = `${Math.round(stageRect.bottom - appRect.top - navHeight - 14)}px`;
  };

  const updateFlowTurnNav = () => {
    if (!flowTurnNav) return;
    const shouldShow = viewStore.mode === VIEW_FLOW && getFlowTurnCount() >= 2;
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


  api.renderMarkdown = renderMarkdown;
  api.collapseAllDoneToolCards = collapseAllDoneToolCards;
  api.collapseAllToolCards = collapseAllToolCards;
  api.collapseThinkingCard = collapseThinkingCard;
  api.autoCollapseThinkingOnNextPhase = autoCollapseThinkingOnNextPhase;
  api.createFlowTurnGroupElement = createFlowTurnGroupElement;
  api.updateFlowQuestionTip = updateFlowQuestionTip;
  api.updateFlowTurnNav = updateFlowTurnNav;
  api.attachResponseSaveButton = attachResponseSaveButton;
}
