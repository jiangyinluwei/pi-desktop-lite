import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { VIEW_FLOW } from "../lib/view-constants.js";
import { invokeTauri } from "../services/tauri-bridge.js";

/**
 * Flow 渲染核心：Markdown、轮次 DOM、悬浮提问提示与上下定位导航
 */
export function initFlowUi(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const appContainer = el.appContainer;
  const flowStage = el.flowStage;
  const flowScrollArea = el.flowScrollArea;
  const flowConversation = el.flowConversation;
  const flowQuestionTip = el.flowQuestionTip;
  const flowQuestionTipText = el.flowQuestionTipText;
  const flowTurnNav = el.flowTurnNav;
  const flowTurnNavUp = el.flowTurnNavUp;
  const flowTurnNavDown = el.flowTurnNavDown;
  const thinkingToggleBtn = el.thinkingToggleBtn;
  const agentThinkingCard = el.agentThinkingCard;

  // ==========================================================================
  // 极简安全 Markdown 渲染器
  // ==========================================================================
  const renderMarkdown = (text) => {
    if (!text) return "";
    let html = escapeHtml(text);

    // 1. 代码块 ```lang ... ```
    html = html.replace(/```([a-zA-Z0-9_\-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${code}</code></pre>`;
    });

    // 2. 行内代码 `code`
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // 3. 粗体与斜体
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // 4. 引用块 >
    html = html.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");

    // 5. 列表与换行
    html = html.replace(/^- (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

    // 6. 段落换行
    html = html.replace(/\n\n+/g, "</p><p>");
    html = html.replace(/\n/g, "<br/>");

    return `<p>${html}</p>`;
  };

  // ==========================================================================
  // Flow 流式渲染核心
  // 说明：轮次状态（当前轮次 DOM 引用、流式文本、工具卡注册表、中断发送/自愈缓存）
  // 一律收敛于 ctx.flow，由 flow-ui / flow-stream / flow-pipeline / task-panel 共享。
  // ==========================================================================

  /**
   * 折叠单张工具卡片
   * @param {HTMLElement} card
   */
  const collapseToolCard = (card) => {
    if (card && !card.classList.contains("collapsed")) {
      card.classList.add("collapsed");
      const header = card.querySelector(".tool-header");
      if (header) header.setAttribute("aria-expanded", "false");
    }
  };

  /**
   * 展开单张工具卡片
   * @param {HTMLElement} card
   */
  const expandToolCard = (card) => {
    if (card && card.classList.contains("collapsed")) {
      card.classList.remove("collapsed");
      const header = card.querySelector(".tool-header");
      if (header) header.setAttribute("aria-expanded", "true");
    }
  };

  /** 收起所有工具卡片（不包括 running 状态） */
  const collapseAllDoneToolCards = () => {
    flow.renderedToolCards.forEach((card) => {
      if (!card.classList.contains("running")) {
        collapseToolCard(card);
      }
    });
  };

  /** 收起所有工具卡片（包括 running） */
  const collapseAllToolCards = () => {
    flow.renderedToolCards.forEach((card) => {
      collapseToolCard(card);
    });
  };

  const collapseThinkingCard = (cardEl = null, btnEl = null) => {
    const targetCard = cardEl || flow.activeTurnRefs?.thinkingCardEl || agentThinkingCard;
    const targetBtn = btnEl || flow.activeTurnRefs?.thinkingToggleBtn || thinkingToggleBtn;
    if (targetCard && targetCard.classList.contains("open")) {
      targetCard.classList.remove("open");
      if (targetBtn) targetBtn.setAttribute("aria-expanded", "false");
    }
  };

  const expandThinkingCard = (cardEl = null, btnEl = null) => {
    const targetCard = cardEl || flow.activeTurnRefs?.thinkingCardEl || agentThinkingCard;
    const targetBtn = btnEl || flow.activeTurnRefs?.thinkingToggleBtn || thinkingToggleBtn;
    if (targetCard && !targetCard.classList.contains("open")) {
      targetCard.classList.add("open");
      if (targetBtn) targetBtn.setAttribute("aria-expanded", "true");
    }
  };

  const autoCollapseThinkingOnNextPhase = () => {
    if (!flow.hasAutoCollapsedThinking) {
      flow.hasAutoCollapsedThinking = true;
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
   * @param {boolean} [options.isOpenThinking=true]
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
    injectedSkills = [],
    isOpenThinking = true,
    isAborted = false,
    errorMessage = null,
  } = {}) => {
    const groupEl = document.createElement("div");
    groupEl.className = "flow-message-group";

    // 1. 用户问题卡片
    const userPromptCard = document.createElement("div");
    userPromptCard.className = "flow-user-prompt-card";

    let attachmentsHtml = "";
    if (Array.isArray(attachments) && attachments.length > 0) {
      const chips = attachments
        .map(
          (f) => `
        <span class="flow-attachment-chip" title="${escapeHtml(f.path || f.name)}">
          <span class="chip-icon">${api.getFileCategoryIcon(f.category)}</span>
          <span class="chip-name">${escapeHtml(f.name)}</span>
        </span>
      `
        )
        .join("");
      attachmentsHtml = `<div class="flow-prompt-attachments">${chips}</div>`;
    }

    userPromptCard.innerHTML = `
      <div class="prompt-icon">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M4 10 L16 10 M11 5 L16 10 L11 15" />
        </svg>
      </div>
      <div class="prompt-main-wrap">
        ${attachmentsHtml}
        <p class="prompt-content">${escapeHtml(query || (attachments.length > 0 ? `[附带 ${attachments.length} 个文件/图片]` : ""))}</p>
      </div>
    `;
    groupEl.appendChild(userPromptCard);

    // 2. 运行态上下文/Inner-Skill 注入胶囊
    const activatedSkillsSet = new Set(Array.isArray(injectedSkills) ? injectedSkills : []);
    const hasInjectedSkills = activatedSkillsSet.size > 0;
    const initialSkillText = hasInjectedSkills
      ? (typeof api.formatActivatedSkillsText === "function"
          ? api.formatActivatedSkillsText(activatedSkillsSet)
          : `已激活运行态技能：${Array.from(activatedSkillsSet).join("，")}`)
      : "已激活运行态技能：windows-bash-compatibility";

    const injectionCapsuleEl = document.createElement("div");
    injectionCapsuleEl.className = `flow-injection-capsule ${hasInjectedSkills ? "" : "hidden"}`;
    injectionCapsuleEl.setAttribute("role", "status");
    injectionCapsuleEl.setAttribute("aria-live", "polite");
    injectionCapsuleEl.innerHTML = `
      <span class="capsule-icon" aria-hidden="true">${ICONS.sparkle}</span>
      <span class="capsule-text">${escapeHtml(initialSkillText)}</span>
    `;
    groupEl.appendChild(injectionCapsuleEl);

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

    // 3. AI Agent 思考过程卡片
    const thinkingCardEl = document.createElement("div");
    thinkingCardEl.className = `agent-thinking-card ${isOpenThinking ? "open" : ""}`;
    thinkingCardEl.innerHTML = `
      <div class="thinking-header" role="button" tabindex="0" aria-expanded="${isOpenThinking ? "true" : "false"}">
        <div class="thinking-status-indicator">
          <span class="thinking-dot"></span>
          <span class="thinking-title">思考过程</span>
          <span class="thinking-duration">${escapeHtml(thinkingDurationText || "思考中...")}</span>
        </div>
        <div class="thinking-arrow-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </div>
      </div>
      <div class="thinking-body">
        <div class="thinking-text-stream">${escapeHtml(thinkingText)}</div>
      </div>
    `;

    const thinkingToggleBtn = thinkingCardEl.querySelector(".thinking-header");
    const thinkingDurationEl = thinkingCardEl.querySelector(".thinking-duration");
    const thinkingTextStreamEl = thinkingCardEl.querySelector(".thinking-text-stream");
    const thinkingBodyEl = thinkingCardEl.querySelector(".thinking-body");

    if (thinkingToggleBtn) {
      thinkingToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = thinkingCardEl.classList.toggle("open");
        thinkingToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    }

    groupEl.appendChild(thinkingCardEl);

    // 4. 工具调用卡片容器
    const toolCallsContainerEl = document.createElement("div");
    toolCallsContainerEl.className = "tool-calls-container";
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      toolCalls.forEach((tc) => {
        if (tc.html) {
          toolCallsContainerEl.insertAdjacentHTML("beforeend", tc.html);
        }
      });
      // 重新绑定历史工具卡片的点击折叠
      toolCallsContainerEl.querySelectorAll(".tool-card").forEach((card) => {
        const header = card.querySelector(".tool-header");
        if (header) {
          header.addEventListener("click", () => {
            if (card.classList.contains("collapsed")) {
              expandToolCard(card);
            } else {
              collapseToolCard(card);
            }
          });
        }
      });
    }
    groupEl.appendChild(toolCallsContainerEl);

    // 5. Agent 回答卡片
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
    const injectionTextEl = injectionCapsuleEl.querySelector(".capsule-text");
    const failoverTextEl = failoverCapsuleEl.querySelector(".capsule-text");

    const turnRefs = {
      groupEl,
      userTextEl,
      promptAttachmentsEl,
      injectionCapsuleEl,
      injectionTextEl,
      activatedSkills: activatedSkillsSet,
      failoverCapsuleEl,
      failoverTextEl,
      thinkingCardEl,
      thinkingToggleBtn,
      thinkingDurationEl,
      thinkingTextStreamEl,
      thinkingBodyEl,
      toolCallsContainerEl,
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
    const query = turnData.query || flow.lastUserQuery || "";
    const responseText = turnData.responseText || flow.currentResponseText || "";
    const thinkingText = turnData.thinkingText || flow.currentThinkingText || "";

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
    const responseText = turnData.responseText !== undefined ? turnData.responseText : (flow.currentResponseText || "");

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
        question = qEl?.textContent?.trim() || flow.lastUserQuery?.trim() || "";
      } else {
        question = String(flow.lastUserQuery?.trim() || flow.activeTurnRefs?.userTextEl?.textContent?.trim() || "");
      }
    }

    flowQuestionTipText.textContent = question;
    const shouldShow = view.mode === VIEW_FLOW && overflowing && Boolean(question);
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
    if (!flowTurnNav || !flowStage || !appContainer || view.mode !== VIEW_FLOW) return;
    const appRect = appContainer.getBoundingClientRect();
    const stageRect = flowStage.getBoundingClientRect();
    const navHeight = flowTurnNav.offsetHeight || 0;
    flowTurnNav.style.top = `${Math.round(stageRect.bottom - appRect.top - navHeight - 14)}px`;
  };

  const updateFlowTurnNav = () => {
    if (!flowTurnNav) return;
    const shouldShow = view.mode === VIEW_FLOW && getFlowTurnCount() >= 2;
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
  api.collapseToolCard = collapseToolCard;
  api.expandToolCard = expandToolCard;
  api.collapseAllDoneToolCards = collapseAllDoneToolCards;
  api.collapseAllToolCards = collapseAllToolCards;
  api.collapseThinkingCard = collapseThinkingCard;
  api.expandThinkingCard = expandThinkingCard;
  api.autoCollapseThinkingOnNextPhase = autoCollapseThinkingOnNextPhase;
  api.createFlowTurnGroupElement = createFlowTurnGroupElement;
  api.updateFlowQuestionTip = updateFlowQuestionTip;
  api.updateFlowTurnNav = updateFlowTurnNav;
  api.attachResponseSaveButton = attachResponseSaveButton;
  api.saveTurnOutputToDesktop = saveTurnOutputToDesktop;
}
