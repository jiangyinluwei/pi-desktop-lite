/**
 * flow-render.js — Flow 流式「纯渲染」层（阶段 3 拆分：从 flow-ui.js 迁出）
 *
 * 职责边界（方案 §4 阶段 3 / §3.1 拆分硬约束）：
 *   本文件只承载「无副作用、无共享状态、无 ctx/api 依赖」的纯 DOM 渲染助手：
 *     - 工具/思维/阶段/伪运行卡片的创建（create*StepCard）
 *     - 工具名/图标/摘要映射（getFriendlyToolName / getToolIcon / getToolShortSummary）
 *     - 入参/结果/正文的 HTML 格式化（format*Html / renderToolBodyInnerHtml / updateToolBadge）
 *     - 卡片折叠/展开（collapseToolCard / expandToolCard）
 *
 * 严禁入本文件：
 *   - 读/写 flow.* 共享状态（currentSteps / active*Step / renderedToolCards / activeTurnRefs 等
 *     属「视图派生缓存」，按方案 §4 铁律⑤ 留在视图层，不属纯渲染）；
 *   - 依赖 ctx / api / settingsStore / viewStore 的横切（如 createFlowTurnGroupElement 需跨模块
 *     的 getFileCategoryIcon / renderAbortNoticeHtml，保留在 flow-ui.js）；
 *   - 任何 DOM 副作用（事件绑定、滚动定位、ResizeObserver）——归 flow-ui.js / flow-dom.js。
 *
 * 唯一依赖：dom-utils（escapeHtml）、icons（ICONS）、markdown-renderer（renderMarkdown）。
 *   —— 三个都是 src/lib 叶子模块，无循环依赖风险。
 *
 * 用法（显式 import，替代旧 ctx.api 字符串槽）：
 *   import { createToolStepCard } from "./flow-render.js";
 *   const card = createToolStepCard({ id, name, status, args, result });
 */
import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { renderMarkdown } from "../lib/markdown-renderer.js";

/**
 * 折叠单张步骤/工具卡片
 * @param {HTMLElement} card
 */
export const collapseToolCard = (card) => {
  if (card && card.classList.contains("open")) {
    card.classList.remove("open");
    card.classList.add("collapsed");
    const header = card.querySelector(".flow-step-header") || card.querySelector(".tool-header");
    if (header) header.setAttribute("aria-expanded", "false");
  }
};

/**
 * 展开单张步骤/工具卡片
 * @param {HTMLElement} card
 */
export const expandToolCard = (card) => {
  if (card && !card.classList.contains("open")) {
    card.classList.add("open");
    card.classList.remove("collapsed");
    const header = card.querySelector(".flow-step-header") || card.querySelector(".tool-header");
    if (header) header.setAttribute("aria-expanded", "true");
  }
};

/**
 * 工具名称友好化映射
 * @param {string} toolName
 * @returns {string}
 */
export const getFriendlyToolName = (toolName) => {
  const raw = String(toolName || "").trim().toLowerCase();
  switch (raw) {
    case "bash":
    case "powershell":
    case "terminal":
    case "cmd":
    case "execute_command":
      return "BASH 调用";
    case "read_file":
    case "view_file":
      return "读取文件";
    case "write_to_file":
      return "写入文件";
    case "edit_file":
    case "replace_file_content":
    case "multi_replace_file_content":
      return "编辑文件";
    case "search_web":
    case "web_search":
    case "read_url_content":
      return "Web 查询";
    case "grep_search":
      return "文本检索";
    case "list_dir":
      return "列出目录";
    case "ask_question":
      return "提问用户";
    case "docparser":
    case "ocr":
    case "deword":
    case "pi-ocr":
    case "pi-docparser":
      return "文档解析";
    case "subagent":
    case "pi-subagents":
    case "spawn_agent":
      return "子 Agent 派发";
    case "memory_retrieve":
    case "memory_store":
    case "pi-memory":
      return "记忆检索";
    case "context_prune":
    case "prune_context":
    case "pai-acp":
      return "上下文修剪";
    case "dynamic_workflows":
    case "execute_workflow":
      return "动态工作流";
    default:
      return `工具调用 (${toolName || "tool"})`;
  }
};

/**
 * 工具手绘矢量图元智能映射
 * @param {string} toolName
 * @returns {string} SVG HTML
 */
export const getToolIcon = (toolName) => {
  const raw = String(toolName || "").trim().toLowerCase();
  switch (raw) {
    case "bash":
    case "powershell":
    case "terminal":
    case "cmd":
    case "execute_command":
      return ICONS.code;
    case "read_file":
    case "view_file":
      return ICONS.document;
    case "write_to_file":
    case "edit_file":
    case "replace_file_content":
    case "multi_replace_file_content":
      return ICONS.edit;
    case "search_web":
    case "web_search":
    case "read_url_content":
    case "grep_search":
      return ICONS.search;
    case "list_dir":
      return ICONS.folder;
    case "docparser":
    case "ocr":
    case "deword":
    case "pi-ocr":
    case "pi-docparser":
      return ICONS.eye;
    case "ask_question":
      return ICONS.chat;
    case "subagent":
    case "pi-subagents":
    case "spawn_agent":
      return ICONS.bolt;
    case "memory_retrieve":
    case "memory_store":
    case "pi-memory":
      return ICONS.sparkle;
    default:
      return ICONS.tool;
  }
};

/**
 * 工具调用入参简短摘要
 * @param {string} toolName
 * @param {any} args
 * @returns {string}
 */
export const getToolShortSummary = (toolName, args = null) => {
  if (!args) return "";
  let argObj = args;
  if (typeof args === "string") {
    try {
      argObj = JSON.parse(args);
    } catch {
      const trimmed = args.trim();
      return trimmed.length > 36 ? trimmed.slice(0, 34) + "..." : trimmed;
    }
  }
  if (typeof argObj !== "object" || !argObj) return "";
  if (argObj.command || argObj.CommandLine) {
    const cmd = String(argObj.command || argObj.CommandLine || "").trim();
    return cmd.length > 38 ? cmd.slice(0, 36) + "..." : cmd;
  }
  if (argObj.path || argObj.TargetPath || argObj.TargetFile || argObj.AbsolutePath) {
    const p = String(argObj.path || argObj.TargetPath || argObj.TargetFile || argObj.AbsolutePath || "").trim();
    const basename = p.split(/[/\\]/).pop() || p;
    return basename;
  }
  if (argObj.query || argObj.Query) {
    const q = String(argObj.query || argObj.Query || "").trim();
    return q.length > 26 ? q.slice(0, 24) + "..." : q;
  }
  return "";
};

/**
 * 剥离终端 ANSI 颜色与控制字符，防止乱码呈现
 * @param {string} str
 * @returns {string}
 */
export const stripAnsiCodes = (str) => {
  if (typeof str !== "string") return str;
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
};

/**
 * 格式化入参代码块 HTML（带手绘复制按钮）
 * @param {any} args
 * @returns {string}
 */
export const formatToolArgumentsHtml = (args) => {
  if (!args) return "";
  let formatted = "";
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (typeof parsed === "object" && parsed !== null) {
        formatted = JSON.stringify(parsed, null, 2);
      } else {
        formatted = args;
      }
    } catch {
      formatted = args;
    }
  } else if (typeof args === "object") {
    formatted = JSON.stringify(args, null, 2);
  } else {
    formatted = String(args);
  }
  formatted = stripAnsiCodes(formatted);
  if (!formatted.trim()) return "";
  return `
      <div class="tool-section tool-args-section">
        <div class="tool-section-bar">
          <span class="tool-section-title">入参 · Parameters</span>
          <button type="button" class="tool-copy-btn" title="复制入参" data-copy-text="${escapeHtml(formatted)}">
            ${ICONS.copy}
            <span class="copy-tip">复制</span>
          </button>
        </div>
        <div class="tool-code-container">
          <pre class="tool-code-pre tool-args-pre"><code>${escapeHtml(formatted)}</code></pre>
        </div>
      </div>
    `;
};

/**
 * 格式化执行结果代码块 HTML（带手绘复制按钮）
 * @param {any} result
 * @returns {string}
 */
export const formatToolResultHtml = (result) => {
  if (result === null || result === undefined || result === "") return "";
  let formatted = "";
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      if (typeof parsed === "object" && parsed !== null) {
        // 若为 content 块结构 [{ type: "text", text: "..." }] 则提取纯文本
        if (Array.isArray(parsed)) {
          const texts = parsed
            .map((item) => (typeof item === "string" ? item : item?.text))
            .filter(Boolean);
          formatted = texts.length > 0 ? texts.join("\n") : JSON.stringify(parsed, null, 2);
        } else if (Array.isArray(parsed.content)) {
          const texts = parsed.content
            .map((item) => (typeof item === "string" ? item : item?.text))
            .filter(Boolean);
          formatted = texts.length > 0 ? texts.join("\n") : JSON.stringify(parsed, null, 2);
        } else if (typeof parsed.text === "string") {
          formatted = parsed.text;
        } else {
          formatted = JSON.stringify(parsed, null, 2);
        }
      } else {
        formatted = result;
      }
    } catch {
      formatted = result;
    }
  } else if (typeof result === "object") {
    if (Array.isArray(result)) {
      const texts = result
        .map((item) => (typeof item === "string" ? item : item?.text))
        .filter(Boolean);
      formatted = texts.length > 0 ? texts.join("\n") : JSON.stringify(result, null, 2);
    } else if (Array.isArray(result.content)) {
      const texts = result.content
        .map((item) => (typeof item === "string" ? item : item?.text))
        .filter(Boolean);
      formatted = texts.length > 0 ? texts.join("\n") : JSON.stringify(result, null, 2);
    } else if (typeof result.text === "string") {
      formatted = result.text;
    } else {
      formatted = JSON.stringify(result, null, 2);
    }
  } else {
    formatted = String(result);
  }
  formatted = stripAnsiCodes(formatted);
  if (!formatted.trim()) return "";
  return `
      <div class="tool-section tool-result-section">
        <div class="tool-section-bar">
          <span class="tool-section-title">执行结果 · Result</span>
          <button type="button" class="tool-copy-btn" title="复制结果" data-copy-text="${escapeHtml(formatted)}">
            ${ICONS.copy}
            <span class="copy-tip">复制</span>
          </button>
        </div>
        <div class="tool-code-container">
          <pre class="tool-code-pre tool-result-pre"><code>${escapeHtml(formatted)}</code></pre>
        </div>
      </div>
    `;
};

/**
 * 渲染工具卡片展开正文的结构化内容
 * @param {any} args
 * @param {any} result
 * @param {string} [rawContent=""]
 * @returns {string}
 */
export const renderToolBodyInnerHtml = (args, result, rawContent = "") => {
  const argsHtml = formatToolArgumentsHtml(args);
  const resultHtml = formatToolResultHtml(result);
  if (argsHtml || resultHtml) {
    return `
        <div class="tool-body-structured">
          ${argsHtml}
          ${resultHtml}
        </div>
      `;
  }
  if (rawContent && rawContent.trim()) {
    return `
        <div class="tool-code-container">
          <pre class="tool-code-pre"><code>${escapeHtml(rawContent)}</code></pre>
        </div>
      `;
  }
  return `<div class="tool-empty-tip">调用已就绪，等待执行回传…</div>`;
};

/**
 * 刷新工具状态徽章
 * @param {HTMLElement} badgeEl
 * @param {string} status
 */
export const updateToolBadge = (badgeEl, status) => {
  if (!badgeEl) return;
  const isErr = status === "error" || status === "failure" || status === "failed";
  const isDone = status === "done";
  const badgeLabel = isErr ? "failed" : (isDone ? "done" : "running");
  badgeEl.className = `tool-status-badge ${badgeLabel}`;
  badgeEl.innerHTML = `<span class="badge-dot" aria-hidden="true"></span><span class="badge-text">${escapeHtml(badgeLabel)}</span>`;
};

/**
 * 创建思维切片卡片（石墨幽兰冷灰质感，单行流式刷新，常态折叠，任何时候不自动展开）
 */
export const createThinkingStepCard = ({
  text = "",
  durationText = "(0.0s)...",
  isOpen = false, // 铁律：默认 false，任何时候不自动展开
} = {}) => {
  const cardEl = document.createElement("div");
  const isRunning = durationText.includes("...");
  cardEl.className = `flow-step-card flow-step-thinking ${isRunning ? "running" : ""} ${isOpen ? "open" : "collapsed"}`;

  const previewText = text ? text.replace(/[\r\n\t]+/g, " ").trim() : "";

  cardEl.innerHTML = `
      <div class="flow-step-header thinking-header" role="button" tabindex="0" aria-expanded="${isOpen ? "true" : "false"}">
        <div class="flow-step-header-left">
          <span class="flow-step-icon thinking-icon" aria-hidden="true">${ICONS.sparkle}</span>
          <span class="flow-step-badge thinking-badge">Thinking</span>
          <span class="flow-step-duration thinking-duration">${escapeHtml(durationText)}</span>
          <span class="flow-step-preview thinking-preview">
            <span class="thinking-preview-static">${escapeHtml(previewText)}</span>
            <span class="thinking-preview-marquee" aria-hidden="true">
              <span class="thinking-preview-track">
                <span class="thinking-preview-text">${escapeHtml(previewText)}</span>
              </span>
            </span>
          </span>
        </div>
        <div class="flow-step-header-right">
          <span class="flow-step-arrow" aria-hidden="true">${ICONS.chevronDown}</span>
        </div>
      </div>
      <div class="flow-step-body thinking-body">
        <div class="thinking-text-stream">${escapeHtml(text)}</div>
      </div>
    `;

  const headerEl = cardEl.querySelector(".flow-step-header");
  const durationEl = cardEl.querySelector(".flow-step-duration");
  const previewEl = cardEl.querySelector(".flow-step-preview");
  const previewStaticEl = cardEl.querySelector(".thinking-preview-static");
  const previewMarqueeEl = cardEl.querySelector(".thinking-preview-marquee");
  const previewTrackEl = cardEl.querySelector(".thinking-preview-track");
  const previewTextEl = cardEl.querySelector(".thinking-preview-text");
  const previewTextEls = previewTextEl ? [previewTextEl] : [];
  const bodyEl = cardEl.querySelector(".flow-step-body");
  const textStreamEl = cardEl.querySelector(".thinking-text-stream");

  if (headerEl) {
    headerEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = cardEl.classList.toggle("open");
      cardEl.classList.toggle("collapsed", !open);
      headerEl.setAttribute("aria-expanded", open ? "true" : "false");
    });
    headerEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const open = cardEl.classList.toggle("open");
        cardEl.classList.toggle("collapsed", !open);
        headerEl.setAttribute("aria-expanded", open ? "true" : "false");
      }
    });
    // 标记工厂卡已绑定（expando 不随 outerHTML 序列化），供历史快照重绑循环去重
    headerEl.__piBound = true;
  }

  return {
    cardEl,
    headerEl,
    durationEl,
    previewEl,
    previewStaticEl,
    previewMarqueeEl,
    previewTrackEl,
    previewTextEl,
    previewTextEls,
    bodyEl,
    textStreamEl,
  };
};

/**
 * 同步 Thinking 卡片收起态预览文本（静态 + 跑马灯单扫掠）
 * 采用固定 14s 线性扫掠避免频繁改 duration 导致动画重启闪烁；
 * 视觉速度随字符长度自然变化，长句稍快、短句稍慢但始终保持可读。
 * 优先直接使用传入的缓存引用，消除高频流式热路径下的 DOM 查询开销。
 * @param {HTMLElement|Object} cardOrRefs Thinking 卡片根节点或包含缓存引用的对象
 * @param {string} text 原始思考文本
 * @param {Object} [stepItem=null] 可选的步骤项缓存对象
 */
export const syncThinkingPreview = (cardOrRefs, text, stepItem = null) => {
  if (!cardOrRefs) return;
  const normalized = String(text || "").replace(/[\r\n\t]+/g, " ").trim();

  let staticEl = stepItem?.previewStaticEl || cardOrRefs.previewStaticEl;
  let textEl = stepItem?.previewTextEl || cardOrRefs.previewTextEl;
  let textEls = stepItem?.previewTextEls || cardOrRefs.previewTextEls;

  if (!staticEl && typeof cardOrRefs.querySelector === "function") {
    staticEl = cardOrRefs.querySelector(".thinking-preview-static");
  }
  if (!textEl && !textEls && typeof cardOrRefs.querySelector === "function") {
    textEl = cardOrRefs.querySelector(".thinking-preview-text");
  }

  if (staticEl) staticEl.textContent = normalized;
  if (textEl) {
    textEl.textContent = normalized;
  } else if (textEls && typeof textEls.forEach === "function") {
    textEls.forEach((el) => { el.textContent = normalized; });
  }
};

/**
 * 创建阶段性输出切片卡片（Point 暖羊皮纸金质感：标题 + 读秒 + 输出内容）
 * 单行流式紧凑呈现，常态折叠，任何时候不自动展开。
 * 流式期间内容在最终输出卡中可见，封口后整体折叠进本卡片正文。
 */
export const createPhaseStepCard = ({
  text = "",
  durationText = "输出中 (0.0s)...",
  isOpen = false, // 铁律：默认 false，任何时候不自动展开
  renderAsMarkdown = true,
} = {}) => {
  const cardEl = document.createElement("div");
  const isRunning = durationText.includes("...");
  cardEl.className = `flow-step-card flow-step-phase ${isRunning ? "running" : ""} ${isOpen ? "open" : "collapsed"}`;

  const previewText = text ? text.replace(/[\r\n\t]+/g, " ").trim() : "";

  cardEl.innerHTML = `
      <div class="flow-step-header phase-header" role="button" tabindex="0" aria-expanded="${isOpen ? "true" : "false"}">
        <div class="flow-step-header-left">
          <span class="flow-step-icon phase-icon" aria-hidden="true">${ICONS.edit}</span>
          <span class="flow-step-badge phase-badge">Point</span>
          <span class="flow-step-duration phase-duration">${escapeHtml(durationText)}</span>
          <span class="flow-step-preview phase-preview">${escapeHtml(previewText)}</span>
        </div>
        <div class="flow-step-header-right">
          <span class="flow-step-arrow" aria-hidden="true">${ICONS.chevronDown}</span>
        </div>
      </div>
      <div class="flow-step-body phase-body">
        <div class="flow-phase-md">${renderAsMarkdown ? renderMarkdown(text) : escapeHtml(text)}</div>
      </div>
    `;

  const headerEl = cardEl.querySelector(".flow-step-header");
  const durationEl = cardEl.querySelector(".flow-step-duration");
  const previewEl = cardEl.querySelector(".flow-step-preview");
  const bodyEl = cardEl.querySelector(".flow-step-body");
  const textStreamEl = cardEl.querySelector(".flow-phase-md");

  if (headerEl) {
    headerEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = cardEl.classList.toggle("open");
      cardEl.classList.toggle("collapsed", !open);
      headerEl.setAttribute("aria-expanded", open ? "true" : "false");
    });
    headerEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const open = cardEl.classList.toggle("open");
        cardEl.classList.toggle("collapsed", !open);
        headerEl.setAttribute("aria-expanded", open ? "true" : "false");
      }
    });
    // 标记工厂卡已绑定（expando 不随 outerHTML 序列化），供历史快照重绑循环去重
    headerEl.__piBound = true;
  }

  return {
    cardEl,
    headerEl,
    durationEl,
    previewEl,
    bodyEl,
    textStreamEl,
  };
};

/**
 * 创建工具调用切片卡片（蓝图工程质感，结构化入参与结果，常态折叠，任何时候不自动展开）
 */
export const createToolStepCard = ({
  id = "",
  name = "tool",
  args = null,
  status = "running",
  result = null,
  durationText = "",
  isOpen = false, // 铁律：默认 false，任何时候不自动展开
} = {}) => {
  const cardEl = document.createElement("div");
  const isErr = status === "error" || status === "failure" || status === "failed";
  const isDone = status === "done";
  const statusClass = isErr ? "error failed" : (isDone ? "done" : "running");
  const badgeLabel = isErr ? "failed" : (isDone ? "done" : "running");

  cardEl.className = `flow-step-card flow-step-tool tool-card ${statusClass} ${isOpen ? "open" : "collapsed"}`;
  if (id) cardEl.id = `tool-${id}`;

  const friendlyName = getFriendlyToolName(name);
  const toolIconSvg = getToolIcon(name);
  const summary = getToolShortSummary(name, args);

  cardEl.innerHTML = `
      <div class="flow-step-header tool-header" role="button" tabindex="0" aria-expanded="${isOpen ? "true" : "false"}">
        <div class="flow-step-header-left">
          <span class="flow-step-icon tool-icon" aria-hidden="true">${toolIconSvg}</span>
          <span class="flow-step-title tool-name">${escapeHtml(friendlyName)}</span>
          ${summary ? `<span class="flow-step-preview tool-preview">${escapeHtml(summary)}</span>` : ""}
        </div>
        <div class="flow-step-header-right tool-header-right">
          ${durationText ? `<span class="flow-step-duration tool-duration">${escapeHtml(durationText)}</span>` : ""}
          <span class="tool-status-badge ${badgeLabel}">
            <span class="badge-dot" aria-hidden="true"></span>
            <span class="badge-text">${escapeHtml(badgeLabel)}</span>
          </span>
          <span class="flow-step-arrow tool-collapse-arrow" aria-hidden="true">${ICONS.chevronDown}</span>
        </div>
      </div>
      <div class="flow-step-body tool-body">
        ${renderToolBodyInnerHtml(args, result)}
      </div>
    `;

  const headerEl = cardEl.querySelector(".flow-step-header");
  const badgeEl = cardEl.querySelector(".tool-status-badge");
  const durationEl = cardEl.querySelector(".tool-duration");
  const previewEl = cardEl.querySelector(".flow-step-preview");
  const bodyEl = cardEl.querySelector(".flow-step-body");

  if (headerEl) {
    headerEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = cardEl.classList.toggle("open");
      cardEl.classList.toggle("collapsed", !open);
      headerEl.setAttribute("aria-expanded", open ? "true" : "false");
    });
    headerEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const open = cardEl.classList.toggle("open");
        cardEl.classList.toggle("collapsed", !open);
        headerEl.setAttribute("aria-expanded", open ? "true" : "false");
      }
    });
    // 标记工厂卡已绑定（expando 不随 outerHTML 序列化），供历史快照重绑循环去重
    headerEl.__piBound = true;
  }

  // 绑定一键复制入参/结果
  cardEl.addEventListener("click", async (e) => {
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

  return {
    cardEl,
    headerEl,
    badgeEl,
    durationEl,
    previewEl,
    bodyEl,
  };
};

/**
 * 创建“伪工具运行框”占位卡片（工具参数流式期空窗辅助显示）
 * 工具名称在参数流式结束 (toolcall_end) 前不可知，先以通用「工具调用...」呈现：
 * 常态折叠单行卡 + running 徽标 + 读秒，待真实工具卡创建 (tool-start) 时移除。
 */
export const createToolPseudoRunningCard = ({
  durationText = "(0.0s)...",
} = {}) => {
  const cardEl = document.createElement("div");
  cardEl.className = "flow-step-card flow-step-tool tool-card collapsed running tool-pseudo-card";

  cardEl.innerHTML = `
      <div class="flow-step-header tool-header" role="button" tabindex="0" aria-expanded="false">
        <div class="flow-step-header-left">
          <span class="flow-step-icon tool-icon" aria-hidden="true">${ICONS.tool}</span>
          <span class="flow-step-title tool-name">工具调用...</span>
          <span class="flow-step-duration tool-duration">${escapeHtml(durationText)}</span>
        </div>
        <div class="flow-step-header-right tool-header-right">
          <span class="tool-status-badge running">
            <span class="badge-dot" aria-hidden="true"></span>
            <span class="badge-text">running</span>
          </span>
          <span class="flow-step-arrow tool-collapse-arrow" aria-hidden="true">${ICONS.chevronDown}</span>
        </div>
      </div>
    `;

  return {
    cardEl,
    titleEl: cardEl.querySelector(".tool-name"),
    durationEl: cardEl.querySelector(".tool-duration"),
  };
};
