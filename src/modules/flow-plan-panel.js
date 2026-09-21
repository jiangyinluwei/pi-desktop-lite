/**
 * flow-plan-panel.js — 「计划执行」可视化面板（模型 todo list 计划的前端直观呈现）
 *
 * 背景：模型执行多步任务时常在输出文本中生成 Markdown 复选框计划清单
 *       （`- [ ]` 待办 / `- [x]` 已完成），随后边执行边回写勾选状态。
 *       本模块把这一「后台计划」收敛为前端可视化：
 *   1. 数据采集：监听 piClient 的 text-delta / text-end 流式文本事件，按 taskId 分仓
 *      累积响应文本（纯数据缓冲，不受前台门禁限制——计划属全局 Chrome，非 Flow DOM）；
 *   2. 计划解析：从文本中按出现顺序提取全部复选框清单组并逐组对账重放
 *      （模型每完成一步会重写「剩余步骤」增量清单；文本块边界补硬分隔防跨块首尾行熔接，
 *      段内同文去重、完成态跨快照续传、已完成但未再出现的历史条目保留、
 *      全新不相交清单整表替换，杜绝计划累积性增长）；
 *   3. 右上角指示器：置于 mini-task-capsule 左侧，展示「已完成/总数」进度与运行态
 *      （is-running 铅笔同款弧光、all-completed 翠绿对齐任务胶囊语义）；
 *   4. 计划侧边栏：与 task-details-sidebar 同款毛玻璃半透明抽屉（右侧展开 + 背景模糊），
 *      逐条展现计划步骤；已完成条目灰显 + 划线（line-through）。
 *
 * 架构对齐（AGENTS.md / flow-interaction-pattern §1）：
 *   - 计划状态按 taskId 分仓缓存于本模块私有 Map（同 flow-file-changes 按 Task 分仓先例），
 *     不入 flowStore（计划是文本派生缓存，非流式纯数据字段）；
 *   - 事件帧归属 taskId 解析复用 contracts.resolveEventTaskId / piClient.lastEventTaskId 唯一源；
 *   - 任务运行态判定复用 contracts.isTaskStatusActive，严禁自维护状态字面量数组；
 *   - 与 task 侧边栏互斥开合（双方经 ctx.api 控制流命令互调，见 contracts 注解）；
 *   - Esc / 右键 Step Back 接入 global-interactions 回退链（计划侧栏与任务侧栏同级最高优先）。
 */
import { piClient } from "../services/pi-client.js";
import { taskManager } from "../services/task-manager.js";
import { isTaskStatusActive } from "../lib/contracts.js";
import { bindAll } from "../lib/el-binder.js";
import { ICONS } from "../lib/icons.js";

/** 复选框清单行：`- [ ]` / `- [x]` / `* [X]` / `1. [x]` 等 Markdown 任务列表语法。 */
const CHECKBOX_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]+(.*)$/;

/** 计划标题候选行：Markdown 标题或加粗行（如 `## 执行计划` / `**执行计划**`）。 */
const PLAN_TITLE_RE = /^(?:#{1,6}\s+(.+?)\s*|\*\*(.+?)\*\*\s*[:：]?)$/;

/** 相邻复选框行间隔超过该行数即视为另一段清单（取最后一段 = 最新计划快照）。 */
const GROUP_GAP_LINES = 2;

/** 文本块边界分隔符：≥4 个换行保证 gap > GROUP_GAP_LINES，切开清单组，逐块快照重放。 */
const TEXT_BLOCK_SEPARATOR = "\n\n\n\n";

/** 视为「计划」的最少条目数（单个复选框不足以构成任务计划）。 */
const MIN_PLAN_ITEMS = 2;

/** 单任务文本缓冲上限（超出仅保留尾部，防长会话内存无界增长）。 */
const MAX_BUFFER_CHARS = 24000;
const BUFFER_TRIM_TO = 16000;
/** 计划状态缓存（taskId → { title, items: [{ text, done }], updatedAt }，按 Task 分仓）。 */
const plans = new Map();
/** 响应文本累积缓冲（taskId → string，计划解析数据源）。 */
const textBuffers = new Map();
/** 计划解析防抖句柄（text-delta 高频触发，text-end 即时解析）。 */
let parseTimer = null;

/** 归一化条目文本（勾选态跨快照续传的匹配键）。 */
const normalizeItemText = (text) => String(text || "").replace(/\s+/g, " ").trim();

/**
 * 从一段响应文本中按出现顺序提取全部复选框清单组（模型会随执行进度反复重写清单，
 * 每组都是一个历史快照，最终状态由最后一个组经对账合并后决定）。
 * @param {string} text 响应文本
 * @returns {Array<{ title: string, items: Array<{ text: string, done: boolean }> }>}
 */
function extractPlanGroups(text) {
  if (!text || text.indexOf("[") === -1) return [];
  const lines = text.split(/\r?\n/);
  const groups = [];
  let current = null;
  let lastLineIdx = -GROUP_GAP_LINES - 1;

  for (let i = 0; i < lines.length; i++) {
    const m = CHECKBOX_LINE_RE.exec(lines[i]);
    if (!m) continue;
    if (!current || i - lastLineIdx > GROUP_GAP_LINES + 1) {
      current = [];
      groups.push(current);
    }
    current.push({ text: m[2].trim(), done: m[1].toLowerCase() === "x", lineIdx: i });
    lastLineIdx = i;
  }

  return groups
    .map((raw) => buildPlanSnapshot(lines, raw))
    .filter((snap) => snap !== null && snap.items.length >= 1);
}

/**
 * 将一组原始复选框行收敛为计划快照：段内同文去重（同一文本多次出现时合并勾选态、
 * 保留首次出现顺序），并提取标题。
 */
function buildPlanSnapshot(lines, rawItems) {
  const byKey = new Map();
  for (const it of rawItems) {
    if (!it.text) continue;
    const key = normalizeItemText(it.text);
    const existing = byKey.get(key);
    if (existing) {
      existing.done = existing.done || it.done;
    } else {
      byKey.set(key, { text: it.text, done: it.done });
    }
  }
  const items = [...byKey.values()];
  if (items.length === 0) return null;

  // 标题：向上回溯最近 4 行内的 Markdown 标题 / 加粗行
  let title = "任务计划";
  const firstIdx = rawItems[0].lineIdx;
  for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 4); i--) {
    const m = PLAN_TITLE_RE.exec(lines[i].trim());
    if (m) {
      title = (m[1] || m[2] || "").replace(/[*_`#:：\s]+$/g, "").trim() || title;
      break;
    }
  }
  return { title, items };
}

/**
 * 将一个计划快照对账合并进任务分仓（顺序重放历史快照的最终状态）：
 *   - 按上一快照原顺序稳定重排：命中条目继承/合并完成态（防模型漏勾）；
 *   - 「剩余清单」对账：模型每完成一步常只重发剩余步骤，已完成且位于首个命中条目之前
 *     （连续完成前缀）的条目原位保留（灰显划去语义）；其余未再出现的条目（被取消的
 *     未完成步骤、被修订移除的步骤）视为模型有意移除，实时从计划中剔除；
 *   - 新增步骤按新快照顺序追加尾部 —— 计划增步/减步/修订均实时反映；
 *   - 少于 MIN_PLAN_ITEMS 条的单条目快照必须与既有计划有交集才生效（末步收尾勾选），
 *     与既有计划零关联的单条目视为噪声忽略；
 *   - 新快照与上一快照完全不相交（零命中）→ 模型开启了全新计划，整表替换绝不追加，
 *     杜绝「每完成一步计划就膨胀一份剩余清单」的累积性增长。
 * @param {string} taskId 分仓键
 * @param {{ title: string, items: Array<{ text: string, done: boolean }> }} snapshot 单组快照
 */
function applyPlanSnapshot(taskId, snapshot) {
  const prev = plans.get(taskId);
  const prevItems = prev?.items || [];
  const prevByKey = new Map(prevItems.map((it) => [normalizeItemText(it.text), it]));
  const snapByKey = new Map(snapshot.items.map((it) => [normalizeItemText(it.text), it]));

  let overlap = 0;
  for (const key of snapByKey.keys()) {
    if (prevByKey.has(key)) overlap += 1;
  }

  // 单条目快照必须与既有计划有交集（末步收尾勾选/单步勾选回写），
  // 零关联的单条目复选框（模型随手清单）视为噪声忽略，防误触发计划替换
  if (snapshot.items.length < MIN_PLAN_ITEMS && overlap === 0) return;

  let items;
  if (snapshot.items.length === 1 && overlap > 0) {
    // 单条目有交集 = 部分更新语义（末步收尾勾选/单步回写）：仅合并勾选态，
    // 绝不触发整表对账（否则未提及的其余步骤会被误删）
    const key = normalizeItemText(snapshot.items[0].text);
    const snapIt = snapshot.items[0];
    items = prevItems.map((it) =>
      normalizeItemText(it.text) === key ? { text: it.text, done: it.done || snapIt.done } : it
    );
  } else if (!prev || prevItems.length === 0 || overlap === 0) {
    // 首个快照，或与上一快照完全不相交（模型开启全新计划）→ 整表替换绝不追加，
    // 杜绝「每完成一步计划就膨胀一份剩余清单」的累积性增长
    items = snapshot.items.map((it) => ({ text: it.text, done: it.done }));
  } else {
    // 有交集：按上一快照原顺序稳定重排，命中条目合并勾选态（防模型漏勾）。
    // 未再出现条目的去留：仅保留「已完成且位于首个命中条目之前」的连续完成前缀
    // （模型报剩余步骤时的省略语义）；其余（被取消的未完成步骤、被修订移除的
    // 已完成步骤）一律视为模型有意移除，实时剔除 —— 计划减步/修订即时生效
    const firstMatchedPrevIdx = prevItems.findIndex((it) => snapByKey.has(normalizeItemText(it.text)));
    items = [];
    prevItems.forEach((prevIt, idx) => {
      const key = normalizeItemText(prevIt.text);
      const snapIt = snapByKey.get(key);
      if (snapIt) {
        items.push({ text: snapIt.text, done: snapIt.done || prevIt.done });
      } else if (prevIt.done && firstMatchedPrevIdx > 0 && idx < firstMatchedPrevIdx) {
        // 剩余清单省略语义：连续完成前缀原位保留（灰显划去）
        items.push({ text: prevIt.text, done: true });
      }
    });
    // 新增步骤（上一快照没有的）按新快照顺序追加到尾部
    for (const it of snapshot.items) {
      if (!prevByKey.has(normalizeItemText(it.text))) {
        items.push({ text: it.text, done: it.done });
      }
    }
  }

  const title =
    snapshot.title && snapshot.title !== "任务计划"
      ? snapshot.title
      : prev?.title || "任务计划";

  const prevSig = prev ? prev.items.map((i) => `${i.done ? "x" : "o"}${normalizeItemText(i.text)}`).join("|") : "";
  const nextSig = items.map((i) => `${i.done ? "x" : "o"}${normalizeItemText(i.text)}`).join("|");
  if (prev && prevSig === nextSig) return; // 无变化跳过

  plans.set(taskId, { title, items, updatedAt: Date.now() });
}

/**
 * 解析某任务的累积文本缓冲并更新计划缓存（按出现顺序重放全部快照组，
 * 勾选态跨快照按文本续传 + 对账合并）。
 * @param {string} taskId 分仓键
 */
function parsePlanForTask(taskId) {
  if (!taskId) return;
  const buffer = textBuffers.get(taskId);
  if (!buffer) return;
  const groups = extractPlanGroups(buffer);
  if (groups.length === 0) {
    // 本轮文本不含计划：保留既有计划不回退（模型可能在输出结论段）
    return;
  }
  // 逐组重放（单条目组的噪声过滤在 applyPlanSnapshot 内按与既有计划的交集判定）
  for (const snapshot of groups) {
    applyPlanSnapshot(taskId, snapshot);
  }
}

/**
 * 累积一段流式文本到任务分仓缓冲。
 * @param {string} taskId 分仓键
 * @param {string} delta 增量文本
 */
function appendBuffer(taskId, delta) {
  if (!taskId || !delta) return;
  let buf = textBuffers.get(taskId) || "";
  buf += delta;
  if (buf.length > MAX_BUFFER_CHARS) {
    buf = buf.slice(-BUFFER_TRIM_TO);
    // 丢弃截断产生的首行残片（残缺复选框行会被解析为幽灵短条目并永久存留）
    const nl = buf.indexOf("\n");
    if (nl >= 0) buf = buf.slice(nl + 1);
  }
  textBuffers.set(taskId, buf);
}

/**
 * 解析当前指示器应展示的任务计划（前台活跃任务优先，回退最近更新的计划任务）。
 * @returns {{ taskId: string, plan: object, task: object | null } | null}
 */
function resolveDisplayPlan() {
  const activeTask = taskManager.getCurrentActiveTask();
  if (activeTask && plans.has(activeTask.id)) {
    return { taskId: activeTask.id, plan: plans.get(activeTask.id), task: activeTask };
  }
  // 回退：最近更新的计划任务（含已终态任务，保持 all-completed 语义可见）
  let latest = null;
  for (const [taskId, plan] of plans) {
    if (!latest || plan.updatedAt > latest.plan.updatedAt) {
      latest = { taskId, plan, task: taskManager.getAllTasks().find((t) => t.id === taskId) || null };
    }
  }
  return latest;
}

/**
 * 初始化「计划执行」面板模块。
 * @param {{ api: Record<string, Function> }} ctx 模块共享上下文（main.js 构建）
 */
export function initPlanPanel(ctx) {
  const api = ctx.api;

  // 模块自绑定（el-binder 统一自取，不进 ctx.el）
  const el = bindAll({
    planIndicator: "plan-indicator",
    planIndicatorText: "plan-indicator-text",
    planSidebar: "plan-details-sidebar",
    planSidebarList: "plan-sidebar-list",
    planSidebarSummary: "plan-sidebar-summary",
    btnClosePlanSidebar: "btn-close-plan-sidebar",
  });

  // ==========================================================================
  // 渲染：右上角指示器 + 计划侧边栏
  // ==========================================================================
  const renderPlan = () => {
    if (!el.planIndicator || !el.planIndicatorText) return;
    const display = resolveDisplayPlan();

    if (!display || !Array.isArray(display.plan.items) || display.plan.items.length === 0) {
      el.planIndicator.classList.add("hidden");
      return;
    }

    const doneCount = display.plan.items.filter((it) => it.done).length;
    el.planIndicator.classList.remove("hidden");
    el.planIndicatorText.textContent = `${doneCount}/${display.plan.items.length}`;

    const isRunning = display.task ? isTaskStatusActive(display.task) : false;
    el.planIndicator.classList.toggle("is-running", isRunning);
    el.planIndicator.classList.toggle("all-completed", !isRunning && doneCount === display.plan.items.length);

    if (el.planSidebar && el.planSidebar.classList.contains("open")) {
      renderPlanSidebar();
    }
  };

  /** 渲染计划侧边栏内容（逐条计划步骤；已完成条目灰显划去）。 */
  const renderPlanSidebar = () => {
    if (!el.planSidebarList || !el.planSidebarSummary) return;
    const display = resolveDisplayPlan();
    el.planSidebarList.textContent = "";

    if (!display || !Array.isArray(display.plan.items) || display.plan.items.length === 0) {
      el.planSidebarSummary.textContent = "暂无任务计划";
      const empty = document.createElement("div");
      empty.className = "empty-plan-placeholder";
      empty.textContent = "模型执行任务时输出的计划清单将在此展示";
      el.planSidebarList.appendChild(empty);
      return;
    }

    const { plan } = display;
    const doneCount = plan.items.filter((it) => it.done).length;
    el.planSidebarSummary.textContent = `已完成 ${doneCount} / 共 ${plan.items.length} 项`;

    if (plan.title && plan.title !== "任务计划") {
      const titleEl = document.createElement("div");
      titleEl.className = "plan-sidebar-title";
      titleEl.textContent = plan.title;
      el.planSidebarList.appendChild(titleEl);
    }

    for (const item of plan.items) {
      const row = document.createElement("div");
      row.className = item.done ? "plan-item is-done" : "plan-item";

      const box = document.createElement("span");
      box.className = "plan-item-box";
      box.setAttribute("aria-hidden", "true");
      if (item.done) {
        box.innerHTML = ICONS.check; // 静态手绘 SVG 常量，无注入风险
      }

      const text = document.createElement("span");
      text.className = "plan-item-text";
      text.textContent = item.text;

      row.appendChild(box);
      row.appendChild(text);
      el.planSidebarList.appendChild(row);
    }
  };

  // ==========================================================================
  // 侧边栏开合（与 task-details-sidebar 互斥开合 + 同款背景模糊 body class）
  // ==========================================================================
  const openPlanSidebar = () => {
    if (!el.planSidebar) return;
    // 互斥开合：任务侧边栏与计划侧边栏同占右侧抽屉位（控制流命令，见 contracts 注解）
    if (typeof api.closeTaskSidebar === "function") api.closeTaskSidebar();
    renderPlanSidebar();
    el.planSidebar.classList.add("open");
    document.body.classList.add("has-plan-sidebar-open");
  };

  // 拦截语义：返回 boolean 参与全局 Esc / 右键 Step Back 回退链（契约同 closeTaskSidebar）
  const closePlanSidebar = () => {
    if (!el.planSidebar) return false;
    const wasOpen = el.planSidebar.classList.contains("open");
    if (wasOpen) {
      el.planSidebar.classList.remove("open");
      document.body.classList.remove("has-plan-sidebar-open");
    }
    return wasOpen;
  };

  el.planIndicator?.addEventListener("click", openPlanSidebar);
  el.btnClosePlanSidebar?.addEventListener("click", closePlanSidebar);

  // ==========================================================================
  // 跨模块函数槽注册（contracts.js @typedef 已同步登记）
  // ==========================================================================
  api.closePlanSidebar = closePlanSidebar;

  /**
   * 历史 / 回填链重建任务计划（task-panel.renderTurnsIntoFlow 调用点）。
   * 扫描各轮 responseText 取最近一段计划清单，保证任务回入 Flow 时计划与文本一致。
   * @param {string} taskId 任务 id
   * @param {Array<{ responseText?: string }>} turns 轮次数组
   */
  api.rebuildPlanFromTurns = (taskId, turns) => {
    if (!taskId || !Array.isArray(turns)) return;
    const combined = turns
      .map((t) => (typeof t?.responseText === "string" ? t.responseText : ""))
      .join(TEXT_BLOCK_SEPARATOR); // 与实时路径同款块边界，保证重进后快照重放语义一致
    textBuffers.set(taskId, combined.length > MAX_BUFFER_CHARS ? combined.slice(-BUFFER_TRIM_TO) : combined);
    parsePlanForTask(taskId);
    renderPlan();
  };

  // ==========================================================================
  // 流式文本采集：text-delta 高频累积（120ms 防抖解析），text-end 即时解析
  // 归属解析复用 piClient.lastEventTaskId 唯一源；纯数据缓冲不受前台门禁限制，
  // DOM（指示器 / 侧边栏）为全局 Chrome，非 Flow 流式 DOM，无串轮频闪风险。
  // ==========================================================================
  const resolveBufferTaskId = () =>
    piClient.lastEventTaskId || taskManager.getCurrentActiveTask()?.id || null;

  const scheduleParse = () => {
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      parseTimer = null;
      const taskId = resolveBufferTaskId();
      if (!taskId) return;
      parsePlanForTask(taskId);
      renderPlan();
    }, 120);
  };

  piClient.addEventListener("text-start", () => {
    const taskId = resolveBufferTaskId();
    if (!taskId) return;
    // 轮次边界分隔铁律：上一文本块常不以换行结尾（模型计划清单习惯直接以末条复选框行收尾），
    // 直接拼接会使下一块首行与上一块末行熔接成一行 —— 行首匹配出「第N步+第1步」幽灵条目
    // （列表膨胀），且下一块首条勾选行被吞（首步永不完成）。补硬分隔切开清单组，逐块快照重放。
    const buf = textBuffers.get(taskId);
    if (buf) appendBuffer(taskId, TEXT_BLOCK_SEPARATOR);
  });

  piClient.addEventListener("text-delta", (e) => {
    const taskId = resolveBufferTaskId();
    if (!taskId) return;
    appendBuffer(taskId, typeof e.detail === "string" ? e.detail : "");
    scheduleParse();
  });

  piClient.addEventListener("text-end", () => {
    if (parseTimer) {
      clearTimeout(parseTimer);
      parseTimer = null;
    }
    const taskId = resolveBufferTaskId();
    if (!taskId) return;
    parsePlanForTask(taskId);
    renderPlan();
  });

  // ==========================================================================
  // 任务生命周期联动：状态变化刷新运行态 / 终态样式；任务移除清退分仓防泄漏
  // ==========================================================================
  taskManager.addEventListener("tasks-changed", () => {
    // 清退已移除任务的计划分仓与文本缓冲（防泄漏）
    const aliveIds = new Set(taskManager.getAllTasks().map((t) => t.id));
    for (const taskId of plans.keys()) {
      if (!aliveIds.has(taskId)) plans.delete(taskId);
    }
    for (const taskId of textBuffers.keys()) {
      if (!aliveIds.has(taskId)) textBuffers.delete(taskId);
    }
    renderPlan();
  });
  taskManager.addEventListener("active-task-changed", renderPlan);
  taskManager.addEventListener("task-removed", (e) => {
    const removedId = e.detail?.taskId || null;
    if (removedId) {
      plans.delete(removedId);
      textBuffers.delete(removedId);
    }
    renderPlan();
  });

  renderPlan();
}

export default initPlanPanel;
