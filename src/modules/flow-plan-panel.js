/**
 * flow-plan-panel.js — 「计划执行」可视化面板（模型 todo list 计划的前端直观呈现）
 *
 * 背景：模型执行多步任务时常在输出文本中生成 Markdown 复选框计划清单
 *       （`- [ ]` 待办 / `- [x]` 已完成），随后边执行边回写勾选状态。
 *       本模块把这一「后台计划」收敛为前端可视化：
 *   1. 数据采集（三通道）：①监听 piClient 的 text-delta / text-end 流式文本事件，按 taskId
 *      分仓累积响应文本（纯数据缓冲，不受前台门禁限制——计划属全局 Chrome，非 Flow DOM），
 *      解析正文复选框清单快照；②监听 tool-start 的 scratchpad 工具动作（add/done/undo），
 *      收录本任务内模型经内核 pi-memory 草稿板工具维护的计划条目与勾选态（见「scratchpad
 *      工具通道」）；③散文推进信号解析（applyProseSignals）——模型既不复写复选框也不用
 *      scratchpad、仅以「步骤N完成 / **Edit N：…**」散文宣告进度时按序号补勾（见该函数注解）；
 *   2. 计划解析：从文本中按出现顺序提取全部复选框清单组并逐组对账重放
 *      （模型每完成一步会重写「剩余步骤」增量清单；文本块边界补硬分隔防跨块首尾行熔接，
 *      段内同文去重、完成态跨快照续传、已完成但未再出现的历史条目保留、
 *      全新不相交清单整表替换，杜绝计划累积性增长）；
 *   3. 右上角指示器：置于 mini-task-capsule 左侧，展示「已完成/总数」进度与运行态
 *      （is-running 铅笔同款弧光、all-completed 翠绿对齐任务胶囊语义）；
 *   4. 计划侧边栏：与 task-details-sidebar 同款毛玻璃半透明抽屉（右侧展开 + 背景模糊），
 *      逐条展现计划步骤；已完成条目灰显 + 划线（line-through）。
 *
 * scratchpad 工具通道（BUG 修复：清单显示了但永不灰显划去）：
 *   模型常改用内核 pi-memory 的 `scratchpad` 待办工具推进计划（`add` / `done` / `undo`），
 *   此时勾选态只出现在**工具入参**里，回复正文不再回写 `- [x]`（正文仅剩「第 N 步完成」散文），
 *   纯文本解析会永久停在首次快照 → 表现为「计划清单正常显示、没有一步灰显划去，直至任务结束」。
 *   故计划分为多来源并在此归一：**文本计划**（正文复选框快照对账）、**scratchpad 分仓**
 *   （本任务事件流内观察到的工具动作，绝不读全局草稿板文件，历史遗留条目零污染）与
 *   **散文推进信号**（完成短语 / 粗体阶段头按序号补勾，见 applyProseSignals），
 *   展示层经 isSamePlanItem（剥离 `【…】` 标签前缀 + 去空白后全等 / 互相包含）合并去重，
 *   完成态取两者之或 —— 模型只在其中一处回写勾选同样驱动灰显划去。
 *   匹配必须容忍装饰性差异（正文 `步骤 1：…` ↔ 工具 `【测试计划·定时】步骤1：…`）：
 *   认不出同一条就会把工具条目当成另一批计划追加 —— 表现为「完成第一步后列表翻倍」（BUG 根因）。
 *
 * 展示与消除生命周期（会话归属铁律）：
 *   - 指示器仅在 Flow 会话视图内、且前台活跃任务真有计划时展示当前会话的计划信息；
 *     右键退出会话界面（Step Back 离开 Flow）立即隐藏，绝不残留上一会话的计划缩略框；
 *   - 任务完成后计划信息持续保留，仅两种途径彻底消除该轮次计划：①开启下一轮会话
 *     （startNewTurn 轮次增长检测，静默回填轮次除外）；②在计划侧边栏点击「结束计划」
 *     （该按钮仅在全部条目完成后出现）；消除时烙印轮次裁剪基线，历史重建绝不复活旧计划。
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
import { bus } from "../lib/event-bus.js";
import { viewStore } from "../services/stores/view-store.js";
import { VIEW_FLOW } from "../lib/view-constants.js";
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

/** scratchpad 待办工具名后缀（内核 pi-memory 草稿板工具，容忍扩展命名空间前缀）。 */
const SCRATCHPAD_TOOL_SUFFIX = "scratchpad";

/** 单任务文本缓冲上限（超出仅保留尾部，防长会话内存无界增长）。 */
const MAX_BUFFER_CHARS = 24000;
const BUFFER_TRIM_TO = 16000;
/** 计划状态缓存（taskId → { title, items: [{ text, done }], updatedAt }，按 Task 分仓）。 */
const plans = new Map();
/** 响应文本累积缓冲（taskId → string，计划解析数据源）。 */
const textBuffers = new Map();
/** 计划解析防抖句柄（text-delta 高频触发，text-end 即时解析）。 */
let parseTimer = null;
/**
 * 计划消除基线（taskId → 轮次下标）：「开启下一轮会话 / 结束计划」彻底消除计划时烙印，
 * rebuildPlanFromTurns 历史重建仅扫描该下标之后的轮次，保证已消除的计划绝不复活。
 */
const planClearedFromTurn = new Map();
/** 新轮次检测基线（taskId → 已知轮次数，首次观测仅建立基线不触发消除）。 */
const turnCounts = new Map();
/**
 * scratchpad 工具通道的计划条目（taskId → Map<归一化文本, { text, done }>）。
 * 模型用内核 pi-memory 草稿板工具（add/done/undo/clear_done）维护计划时，勾选态只出现在
 * 工具入参里、回复正文不回写 `- [x]`，本分仓即该通道的进度来源；只收录**本任务事件流内
 * 观察到的**条目（绝不读取全局草稿板文件，故历史遗留待办不会污染当前会话计划）。
 */
const padItems = new Map();

/** 归一化条目文本（同一性判定与勾选态续传的匹配键）。 */
const normalizeItemText = (text) => String(text || "").replace(/\s+/g, " ").trim();

/** 包含关系判定的最短文本长度（短侧不足此长度时不判定包含，防短文本误配）。 */
const MIN_MATCH_CHARS = 3;

/**
 * 计划条目的装饰性前缀（模型常给工具入参里的条目加标签：`【测试计划】` / `【测试计划·定时】` /
 * `【执行计划】`），匹配时剥离；仅剥离行首单个短括号组（≤12 字符），不碰正文语义。
 */
const PLAN_PREFIX_RE = /^[【\[（(][^】\]）)]{0,12}[】\]）)][ \t]*/;

/**
 * 匹配键：剥离装饰性前缀 → 归一化空白 → **去除全部空白**。
 * 同一份计划在正文与工具入参之间常有这些装饰性差异，例如真实会话里正文写
 * `步骤 1：环境预检（确认内核连接、模型配置就绪）`、工具写 `【测试计划·定时】步骤1：…` ——
 * 不做这层归一就认不出是同一条，工具通道的条目会被当成另一批计划追加（列表翻倍，BUG 根因）。
 * @param {string} text 条目文本
 * @returns {string}
 */
const matchKeyOf = (text) =>
  normalizeItemText(String(text || "").replace(PLAN_PREFIX_RE, "")).replace(/\s+/g, "");

/**
 * 计划条目同一性判定（文本计划 ↔ scratchpad 分仓合并去重，及 done/undo 目标定位）：
 *   ① 匹配键全等；② 短侧 ≥ 3 字符的互相包含 —— 容器关系天然容忍模型给条目加 `✅` 后缀，
 *   且 scratchpad 的 done/undo 目标允许截断（pi-memory 本身即按子串匹配，
 *   如 `步骤1：环境预检` 甚至剥掉前缀后的 `步骤1`）。
 * 注：**不做**「步骤序号同键」这类宽松兜底 —— 草稿板常驻大量历史编号待办，
 * 同号即命中会把无关条目的勾选态误传到当前计划；也避免掩盖模型对计划的重新编号修订。
 * @param {string} a 条目文本
 * @param {string} b 条目文本
 * @returns {boolean}
 */
function isSamePlanItem(a, b) {
  const x = matchKeyOf(a);
  const y = matchKeyOf(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= MIN_MATCH_CHARS && (x.includes(y) || y.includes(x));
}

/**
 * 应用一次 scratchpad 工具动作到计划分仓（工具通道的计划进度来源）。
 *   - `add`：新条目入仓（与文本计划条目重名时仍入仓，展示层按同一性合并去重）；
 *   - `done` / `undo`：定位既有条目（分仓 → 文本计划）并翻转完成态；目标未命中任何既有
 *     条目一律忽略（杜绝模型随手文本造出幽灵条目）；
 *   - `clear_done` / `list`：不改动计划 —— 计划的消除生命周期由轮次边界与「结束计划」掌管
 *     （模型清理草稿板已勾选项不等于放弃本轮计划展示）。
 * @param {string} taskId 分仓键
 * @param {string} action 工具动作（已小写）
 * @param {string} text 条目文本（add 为新条目；done/undo 为匹配目标，可被截断）
 * @returns {boolean} 是否改动了计划（调用方据此决定重渲）
 */
function applyPadAction(taskId, action, text) {
  if (!taskId || !text) return false;
  const key = matchKeyOf(text);
  if (!key) return false;
  const store = padItems.get(taskId) || new Map();

  if (action === "add") {
    for (const existing of store.keys()) {
      if (isSamePlanItem(existing, key)) return false;
    }
    store.set(key, { text: String(text).trim(), done: false });
    padItems.set(taskId, store);
    return true;
  }

  if (action !== "done" && action !== "undo") return false;
  const targetDone = action === "done";

  // ① 分仓命中：直接翻转
  for (const entry of store.values()) {
    if (isSamePlanItem(entry.text, key)) {
      if (entry.done === targetDone) return false;
      entry.done = targetDone;
      return true;
    }
  }
  // ② 文本计划命中：入仓一条同义条目，展示层按同一性把完成态续传到文本条目上
  const planItems = plans.get(taskId)?.items;
  if (!Array.isArray(planItems) || !planItems.some((it) => isSamePlanItem(it.text, key))) {
    return false;
  }
  store.set(key, { text: String(text).trim(), done: targetDone });
  padItems.set(taskId, store);
  return true;
}

/**
 * 合并文本计划与 scratchpad 通道进度（展示层唯一入口）。
 * 完成态取两者之或（模型只在其中一处回写勾选同样生效）；未被文本条目覆盖的 scratchpad
 * 条目按入仓顺序追加（模型仅用草稿板维护计划、正文无清单的场景）。
 * @param {Array<{ text: string, done: boolean }>} textItems 文本计划条目
 * @param {Map<string, { text: string, done: boolean }>} [padStore] scratchpad 分仓
 * @returns {Array<{ text: string, done: boolean }>}
 */
function mergePlans(textItems, padStore) {
  const items = (textItems || []).map((it) => ({ text: it.text, done: it.done }));
  if (!padStore || padStore.size === 0) return items;
  for (const entry of padStore.values()) {
    const hit = items.find((it) => isSamePlanItem(it.text, entry.text));
    if (hit) hit.done = hit.done || entry.done;
    else items.push({ text: entry.text, done: entry.done });
  }
  return items;
}

// ==========================================================================
// 散文推进信号通道（第三通道）：真实任务中模型常既不复写复选框清单、也不经
// scratchpad 工具推进，仅以散文叙述进度并在收尾总结里一次性重发全勾清单 ——
// 表现为「计划全程冻结在 0/N，任务完成后所有步骤一瞬间全部划去」。本通道从
// 正文散文中提取两类推进信号并按序号映射到计划条目：
//   ①完成短语：「步骤1完成」「第 2 步已完成」「✅ 第 3 步」「Step 2 done」；
//   ②粗体/标题阶段头：「**Edit 2：…**」「## 阶段 3：…」——宣告开始第 N 阶段 =
//     顺序执行规约下第 1..N-1 步已完成。
// 信号只标完成、绝不新增/删除/改写条目（幂等可重放）；复选框快照仍是勾选态的
// 第一权威来源，散文信号仅做增量补勾。
// ==========================================================================

/** 步骤序号字符集（阿拉伯数字 + 中文数字一~二十）。 */
const STEP_NUM_CHARS = "[0-9一二三四五六七八九十]{1,3}";

/** 中文数字 → 数值（超出可表示范围返回 null）。 */
const CN_DIGIT_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function parseStepNumber(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === "十") return 10;
  if (s.length === 1) return CN_DIGIT_MAP[s] || null;
  if (s.length === 2) {
    if (s[0] === "十") return CN_DIGIT_MAP[s[1]] ? 10 + CN_DIGIT_MAP[s[1]] : null;
    if (s[1] === "十") return CN_DIGIT_MAP[s[0]] ? CN_DIGIT_MAP[s[0]] * 10 : null;
    return null;
  }
  if (s.length === 3 && s[1] === "十") {
    const tens = CN_DIGIT_MAP[s[0]];
    const ones = CN_DIGIT_MAP[s[2]];
    return tens && ones ? tens * 10 + ones : null;
  }
  return null;
}

/**
 * 完成短语信号（序号与完成谓词紧邻）。中间严禁冒号——「步骤N：完成XX」是条目标题式
 * 枚举措辞而非完成宣告，宽松命中会在模型复述计划时把该步骤误标为已完成。
 */
const STEP_DONE_RES = [
  // 步骤N完成 / 第N步已完成 / 步骤N顺利达成（含中文数字）
  new RegExp(
    `(?:步骤|第)\\s*(${STEP_NUM_CHARS})\\s*步?\\s*(?:已经|已|很快|顺利)?\\s*(?:完成|达成|搞定了?|收尾)`,
    "g",
  ),
  // Edit/Phase/Stage N 完成（中英混排）
  new RegExp(
    `\\b(?:edit|phase|stage)\\s*#?(${STEP_NUM_CHARS})\\s*(?:已经|已)?\\s*(?:完成|达成|搞定了?)`,
    "gi",
  ),
  // Step/Edit/Phase N done|completed|finished（英文）
  /\b(?:step|edit|phase|stage)\s*#?(\d{1,3})\s*(?:is\s*)?(?:now\s+)?(?:complete[ds]?|done|finished)/gi,
  // 步骤N ✅ / 第N步 ✓（勾选图元尾缀）
  new RegExp(`(?:步骤|第)\\s*(${STEP_NUM_CHARS})\\s*步?\\s*(?:✅|✔|✓)`, "g"),
  // ✅ N. / ✅ 步骤N：行首清单式打勾（后随列表标点，避免「✅ 3 个测试通过」误命中）
  new RegExp(`(?:✅|✔|✓)\\s*(?:步骤|第)?\\s*(${STEP_NUM_CHARS})\\s*步?\\s*[.、：:)）]`, "g"),
];

/**
 * 阶段头宣告信号：粗体（**…** / __…__）或 Markdown 标题（#…）锚定的
 * 「Edit N：… / Phase N：… / 阶段 N：…」。词表刻意排除「步骤 / step」——那是计划清单
 * 枚举的高频措辞，宽松命中会在模型复述计划时把前序步骤误标为已完成；
 * 无粗体/标题锚定的裸「Edit 1：」行同样忽略（宁可不勾也不误勾）。
 */
const PHASE_HEADER_RE = new RegExp(
  `(?:^|\\n)[ \\t]*(?:#{1,6}[ \\t]*|[*_]{2})\\s*(?:edit|phase|stage|阶段)[ \\t]*#?[ \\t]*(${STEP_NUM_CHARS})[ \\t]*(?:[：:.、)）\\]]|—)`,
  "gi",
);

/**
 * 从正文散文中提取推进信号并按序号映射到文本计划条目（只标完成，幂等可重放）。
 * @param {string} taskId 分仓键
 * @param {string} buffer 累积正文缓冲
 * @returns {boolean} 是否产生了勾选态变化
 */
function applyProseSignals(taskId, buffer) {
  const plan = plans.get(taskId);
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0 || !buffer) return false;
  // 剔除复选框清单行再扫描：计划条目标题本身可能含「完成」字样
  // （如「- [ ] 步骤 4：完成数据库迁移」），不剔除会被完成短语误命中为已完成
  const prose = buffer
    .split(/\r?\n/)
    .filter((line) => !CHECKBOX_LINE_RE.test(line))
    .join("\n");
  let changed = false;
  const markDone = (n) => {
    if (!Number.isInteger(n) || n < 1 || n > plan.items.length) return;
    if (!plan.items[n - 1].done) {
      plan.items[n - 1].done = true;
      changed = true;
    }
  };
  for (const re of STEP_DONE_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(prose))) markDone(parseStepNumber(m[1]));
  }
  PHASE_HEADER_RE.lastIndex = 0;
  let m;
  while ((m = PHASE_HEADER_RE.exec(prose))) {
    const n = parseStepNumber(m[1]);
    if (!Number.isInteger(n)) continue;
    // 宣告开始第 N 阶段：顺序执行规约下其前的第 1..N-1 步已完成（灰显划去推进）
    for (let i = 1; i < n; i++) markDone(i);
  }
  if (changed) plan.updatedAt = Date.now();
  return changed;
}

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

/** 条目行首序号提取（`1.` / `2、` / `3)：` 等；无序号返回 null）。 */
const ITEM_ORDINAL_RE = /^(\d{1,2})\s*[.、)）：:]/;
const ordinalOf = (text) => {
  const m = ITEM_ORDINAL_RE.exec(String(text || "").trim());
  return m ? parseInt(m[1], 10) : null;
};

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
 *     杜绝「每完成一步计划就膨胀一份剩余清单」的累积性增长；
 *   - **措辞漂移兜底（翻倍 BUG 之正文版根因）**：模型在收尾总结里常改写条目措辞
 *     （删括号注解、增补成果描述，如 `1. 修复X（根因：Y）` → `1. 修复X`），全文精确匹配
 *     只剩个别条目命中，未命中条目被当成「新增步骤」追加 → 列表翻倍。故在**已有文本
 *     锚点命中**（证明是同一计划的演进，绝不影响全新计划的整表替换判定）的前提下，
 *     双侧未命中条目按**行首序号相等**配对合并（同号同位 ≈ 同一条的改写）；
 *     与 scratchpad 分仓的「同号异文按独立条目追加」铁律不冲突 —— 那是跨来源合并
 *     （草稿板常驻历史编号待办），此处是同一计划快照演进链内的对账。
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
    // 有交集：按上一快照原顺序稳定重排。先做全文精确命中（文本锚点），
    // 再对双侧未命中条目做行首序号配对兜底（措辞漂移的改写条目），防列表翻倍
    const prevMatched = new Array(prevItems.length).fill(false);
    const snapMatched = new Array(snapshot.items.length).fill(false);
    const pairOf = new Array(snapshot.items.length).fill(-1); // 快照条目 → 上一快照条目下标
    snapshot.items.forEach((snapIt, si) => {
      const key = normalizeItemText(snapIt.text);
      const pi = prevItems.findIndex(
        (pit, idx) => !prevMatched[idx] && normalizeItemText(pit.text) === key
      );
      if (pi >= 0) {
        snapMatched[si] = true;
        prevMatched[pi] = true;
        pairOf[si] = pi;
      }
    });
    snapshot.items.forEach((snapIt, si) => {
      if (snapMatched[si]) return;
      const so = ordinalOf(snapIt.text);
      if (so === null) return;
      const pi = prevItems.findIndex(
        (pit, idx) => !prevMatched[idx] && ordinalOf(pit.text) === so
      );
      if (pi >= 0) {
        snapMatched[si] = true;
        prevMatched[pi] = true;
        pairOf[si] = pi;
      }
    });

    const firstMatchedPrevIdx = prevMatched.indexOf(true);
    // 按上一快照原顺序重排：命中条目（文本或序号配对）继承/合并勾选态，快照措辞胜出
    items = [];
    prevItems.forEach((prevIt, idx) => {
      const si = pairOf.indexOf(idx);
      if (si >= 0) {
        const snapIt = snapshot.items[si];
        items.push({ text: snapIt.text, done: snapIt.done || prevIt.done });
      } else if (prevIt.done && firstMatchedPrevIdx > 0 && idx < firstMatchedPrevIdx) {
        // 剩余清单省略语义：连续完成前缀原位保留（灰显划去）
        items.push({ text: prevIt.text, done: true });
      }
    });
    // 新增步骤（上一快照没有的）按新快照顺序追加到尾部
    snapshot.items.forEach((it, si) => {
      if (!snapMatched[si] && !prevByKey.has(normalizeItemText(it.text))) {
        items.push({ text: it.text, done: it.done });
      }
    });
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
  if (groups.length > 0) {
    // 逐组重放（单条目组的噪声过滤在 applyPlanSnapshot 内按与既有计划的交集判定）
    for (const snapshot of groups) {
      applyPlanSnapshot(taskId, snapshot);
    }
  }
  // 散文推进信号（第三通道）：与复选框组是否存在无关，独立扫描——
  // 本轮文本纯散文（groups 为空）时既有计划保留不回退（语义同原 early-return），
  // 但「步骤N完成 / **Edit N：…**」类推进信号仍需照常生效
  applyProseSignals(taskId, buffer);
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
 * 解析当前指示器应展示的任务计划（会话归属铁律：仅 Flow 会话视图 + 前台活跃任务真有计划）。
 * 右键退出会话界面（非 Flow）或无前台活跃任务/无计划时返回 null，
 * 绝不做「最近更新的计划任务」兜底回退，杜绝退出会话后右上角残留上一会话计划缩略框。
 * 展示条目为「文本计划 + scratchpad 分仓」合并结果（见 mergePlans）；
 * 文本计划缺席时，单条 scratchpad 条目（模型随手记的「回头再处理」备忘）不成计划，按
 * MIN_PLAN_ITEMS 同样门禁隐藏。
 * @returns {{ taskId: string, plan: object, task: object } | null}
 */
function resolveDisplayPlan() {
  if (viewStore.mode !== VIEW_FLOW) return null;
  const activeTask = taskManager.getCurrentActiveTask();
  if (!activeTask) return null;
  const textPlan = plans.get(activeTask.id) || null;
  const items = mergePlans(textPlan?.items, padItems.get(activeTask.id));
  if (items.length === 0 || (!textPlan && items.length < MIN_PLAN_ITEMS)) return null;
  return {
    taskId: activeTask.id,
    plan: { title: textPlan?.title || "任务计划", items },
    task: activeTask,
  };
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
    planProgressTrack: "plan-progress-track",
    planProgressFill: "plan-progress-fill",
    btnClosePlanSidebar: "btn-close-plan-sidebar",
    btnEndPlan: "btn-end-plan",
  });

  /**
   * 彻底消除某任务当前轮次的计划信息（两种触发：①开启下一轮会话；②侧边栏「结束计划」）。
   * 同步清退计划快照与文本缓冲，并烙印轮次裁剪基线（planClearedFromTurn），
   * 保证右键退出后经历史/Task 记录回入 Flow 时 rebuildPlanFromTurns 不复活旧计划。
   * @param {string} taskId 任务 id
   * @param {{ keepLastTurn?: boolean }} [options] keepLastTurn=true 保留最后一个轮次
   *        （新轮次刚开启的消除语义：后续重建仅裁剪该轮之前的轮次）
   */
  const clearPlanForTask = (taskId, options = {}) => {
    if (!taskId) return;
    plans.delete(taskId);
    textBuffers.delete(taskId);
    padItems.delete(taskId);
    const task = taskManager.getTask(taskId);
    const turnCount = Array.isArray(task?.turns) ? task.turns.length : 0;
    const keepLastTurn = Boolean(options.keepLastTurn);
    planClearedFromTurn.set(taskId, keepLastTurn && turnCount > 0 ? turnCount - 1 : turnCount);
    renderPlan();
  };

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

  /** 渲染计划侧边栏内容（逐条计划步骤；已完成条目灰显划去；运行态突出首个未完成执行项）。 */
  const renderPlanSidebar = () => {
    if (!el.planSidebarList || !el.planSidebarSummary) return;
    const display = resolveDisplayPlan();
    el.planSidebarList.textContent = "";

    if (!display || !Array.isArray(display.plan.items) || display.plan.items.length === 0) {
      el.planSidebarSummary.textContent = "暂无任务计划";
      el.planSidebarSummary.classList.remove("all-completed");
      if (el.planProgressFill) {
        el.planProgressFill.style.width = "0%";
        el.planProgressFill.classList.remove("all-completed", "is-running");
      }
      if (el.btnEndPlan) el.btnEndPlan.classList.add("hidden");
      const empty = document.createElement("div");
      empty.className = "empty-plan-placeholder";
      empty.innerHTML = `
        <div class="empty-plan-illustration" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.3"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 7 C11 5.8, 12 5, 13.5 5 L30.5 5 L39 13.5 L39 40.5 C39 41.8, 38 43, 36.5 43 L13.5 43 C12 43, 11 41.8, 11 40.5 Z" />
            <path d="M30.5 5 L30.5 13.5 L39 13.5" />
            <rect x="16.5" y="19.5" width="4.5" height="4.5" rx="1" />
            <line x1="24.5" y1="21.8" x2="33.5" y2="21.8" stroke-dasharray="1.5 1.5" />
            <rect x="16.5" y="27.5" width="4.5" height="4.5" rx="1" />
            <line x1="24.5" y1="29.8" x2="33.5" y2="29.8" stroke-dasharray="1.5 1.5" />
            <path d="M16 36 L18.5 38.5 L22.5 33.5" />
            <line x1="25" y1="36.5" x2="33.5" y2="36.5" />
          </svg>
        </div>
        <div class="empty-plan-primary">暂无任务执行计划</div>
        <div class="empty-plan-secondary">当大模型在多步执行中规划清单时，此处将实时呈现步骤与勾选进度</div>
      `;
      el.planSidebarList.appendChild(empty);
      return;
    }

    const { plan } = display;
    const totalCount = plan.items.length;
    const doneCount = plan.items.filter((it) => it.done).length;
    const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const isAllDone = totalCount > 0 && doneCount === totalCount;
    const isRunning = display.task ? isTaskStatusActive(display.task) : false;

    if (isAllDone) {
      el.planSidebarSummary.textContent = `${doneCount}/${totalCount} 项 · 100% 已达成`;
      el.planSidebarSummary.classList.add("all-completed");
    } else {
      el.planSidebarSummary.textContent = `${doneCount}/${totalCount} 项 · ${percent}%`;
      el.planSidebarSummary.classList.remove("all-completed");
    }

    if (el.planProgressFill) {
      el.planProgressFill.style.width = `${percent}%`;
      el.planProgressFill.classList.toggle("all-completed", isAllDone);
      el.planProgressFill.classList.toggle("is-running", isRunning && !isAllDone);
    }

    // 「结束计划」仅在全部计划完成后出现（消除该轮次计划信息的第二途径）
    if (el.btnEndPlan) {
      el.btnEndPlan.classList.toggle("hidden", !isAllDone);
    }

    if (plan.title && plan.title !== "任务计划") {
      const titleEl = document.createElement("div");
      titleEl.className = "plan-sidebar-title";
      titleEl.textContent = plan.title;
      el.planSidebarList.appendChild(titleEl);
    }

    // 识别当前正在执行的步骤（首个未完成项，仅在任务活跃进行时生效）
    const firstPendingIdx = isRunning ? plan.items.findIndex((it) => !it.done) : -1;

    plan.items.forEach((item, idx) => {
      const isCurrent = idx === firstPendingIdx;
      const row = document.createElement("div");
      row.className = [
        "plan-item",
        item.done ? "is-done" : "",
        isCurrent ? "is-current" : "",
      ].filter(Boolean).join(" ");

      const indexEl = document.createElement("span");
      indexEl.className = "plan-item-index";
      indexEl.textContent = String(idx + 1).padStart(2, "0");

      const box = document.createElement("span");
      box.className = "plan-item-box";
      box.setAttribute("aria-hidden", "true");
      if (item.done) {
        box.innerHTML = ICONS.check; // 静态手绘 SVG 常量，无注入风险
      }

      const contentEl = document.createElement("div");
      contentEl.className = "plan-item-content";

      const text = document.createElement("span");
      text.className = "plan-item-text";
      text.textContent = item.text;
      contentEl.appendChild(text);

      if (isCurrent) {
        const currentTag = document.createElement("span");
        currentTag.className = "plan-item-current-tag";
        currentTag.innerHTML = `<span class="current-tag-dot" aria-hidden="true"></span><span>执行中</span>`;
        contentEl.appendChild(currentTag);
      }

      row.appendChild(indexEl);
      row.appendChild(box);
      row.appendChild(contentEl);
      el.planSidebarList.appendChild(row);
    });
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

  // 「结束计划」：彻底消除该轮次计划信息（仅全部条目完成后可见），并收起侧边栏
  el.btnEndPlan?.addEventListener("click", () => {
    const display = resolveDisplayPlan();
    if (!display) return;
    clearPlanForTask(display.taskId);
    closePlanSidebar();
  });

  // ==========================================================================
  // 跨模块函数槽注册（contracts.js @typedef 已同步登记）
  // ==========================================================================
  api.closePlanSidebar = closePlanSidebar;

  /**
   * 历史 / 回填链重建任务计划（task-panel.renderTurnsIntoFlow 调用点）。
   * 按时间序扫描各轮 steps 文本切片（Point 切片）+ responseText 尾段重建计划快照，
   * 保证任务回入 Flow 时计划与文本一致（仅扫 responseText 会漏掉工具调用前段内的计划清单）。
   * @param {string} taskId 任务 id
   * @param {Array<{ responseText?: string }>} turns 轮次数组
   */
  api.rebuildPlanFromTurns = (taskId, turns) => {
    if (!taskId || !Array.isArray(turns)) return;
    // 历史还原路径的轮次基线种子：restoreConversationToFlow 直接改写 task.turns 不派发
    // task-updated，若不在此处建立基线，紧随其后的追问（startNewTurn）将因无基准而漏触发消除
    const knownCount = turnCounts.get(taskId) || 0;
    if (turns.length > knownCount) turnCounts.set(taskId, turns.length);
    // 计划消除基线裁剪：已被「开启下一轮会话 / 结束计划」消除的轮次计划文本绝不参与重建
    const clearedFrom = planClearedFromTurn.get(taskId) || 0;
    const effectiveTurns = clearedFrom > 0 ? turns.slice(clearedFrom) : turns;
    // 轮次全文重建铁律：turn.responseText 仅是「最后一次工具调用之后」的尾段文本 ——
    // task-manager 在 tool_execution_start 时会把已累积文本封口沉淀为 steps 中 type==="text"
    // 的 Point 切片并清空 responseText，计划清单通常写在首个工具调用之前的段内，
    // 仅扫 responseText 会漏掉全部计划文本 → 回入 Flow 时 rebuild 落空（combined 为空 →
    // plans/textBuffers 被清退，指示器不再展示）。故按时间序拼接：steps 文本切片（按序）+
    // responseText 尾段（封口即清空，两者天然不重叠；重复同文组经 applyPlanSnapshot 幂等对账）。
    const collectTurnText = (t) => {
      const segs = [];
      if (Array.isArray(t?.steps)) {
        for (const step of t.steps) {
          if (step?.type === "text" && typeof step.text === "string" && step.text.trim()) {
            segs.push(step.text);
          }
        }
      }
      if (typeof t?.responseText === "string" && t.responseText.trim()) {
        segs.push(t.responseText);
      }
      return segs.join(TEXT_BLOCK_SEPARATOR);
    };
    const combined = effectiveTurns
      .map(collectTurnText)
      .filter((t) => t.trim().length > 0)
      .join(TEXT_BLOCK_SEPARATOR); // 与实时路径同款块边界，保证重进后快照重放语义一致
    if (!combined.trim()) {
      // 仅当存在显式计划消除基线（开启下一轮会话 / 结束计划）时才清退分仓。
      // 无基线时 combined 为空只代表「轮次文本尚未沉淀」——典型情形是会话进行中转入后台后
      // 事件帧归属缺失，TaskManager 轮次缓冲未累积，但实时采集的计划快照仍在分仓中；
      // 此时破坏性清退会把存活计划一并抹掉，导致回入 Flow 时指示器消失（BUG 根因之二）。
      if ((planClearedFromTurn.get(taskId) || 0) > 0) {
        textBuffers.delete(taskId);
        plans.delete(taskId);
        padItems.delete(taskId);
      }
    } else {
      textBuffers.set(taskId, combined.length > MAX_BUFFER_CHARS ? combined.slice(-BUFFER_TRIM_TO) : combined);
      parsePlanForTask(taskId);
    }
    // scratchpad 工具通道的轮次重建（须在文本解析之后：done/undo 目标可能只存在于文本计划里）：
    // 轮次 toolCalls 已记录本轮的 scratchpad 动作（name + args），按时间序重放即可恢复
    // 与退出前一致的勾选态（padItems 为内存分仓，回入 Flow 时必须重建）。
    // 从磁盘历史还原的会话可能不含完整 toolCalls（持久化预算裁剪），此路径按尽力而为降级。
    for (const turn of effectiveTurns) {
      if (!Array.isArray(turn?.toolCalls)) continue;
      for (const call of turn.toolCalls) {
        if (!String(call?.name || "").toLowerCase().endsWith(SCRATCHPAD_TOOL_SUFFIX)) continue;
        const action = typeof call?.args?.action === "string" ? call.args.action.toLowerCase() : "";
        const text = typeof call?.args?.text === "string" ? call.args.text : "";
        applyPadAction(taskId, action, text);
      }
    }
    renderPlan();
  };

  // ==========================================================================
  // 流式文本采集：text-delta 高频累积（120ms 防抖解析），text-end 即时解析
  // 归属解析三级链：piClient.lastEventTaskId → 前台活跃任务 → 挂起态兜底（见 resolveBufferTaskId）；
  // 纯数据缓冲不受前台门禁限制，DOM（指示器 / 侧边栏）为全局 Chrome，非 Flow 流式 DOM，无串轮频闪风险。
  // ==========================================================================
  const resolveBufferTaskId = () => {
    if (piClient.lastEventTaskId) return piClient.lastEventTaskId;
    const active = taskManager.getCurrentActiveTask();
    if (active) return active.id;
    // 挂起态兜底（修复 BUG：会话进行中转入后台后触发计划，回入 Flow 指示器消失）：
    // 右键挂起时 currentActiveTaskId 置 null，前台无活跃任务；此时若事件帧归属缺失
    // （piClient.lastEventTaskId 为空），唯一运行中的挂起任务即为流式归属；
    // 多挂起任务并行时无法消歧，保持 null 杜绝串任务污染
    const suspended = taskManager.getActiveSuspendedTasks();
    if (suspended.length === 1) return suspended[0].id;
    return null;
  };

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

  // scratchpad 工具通道（BUG 修复：清单显示了但永不灰显划去）：
  // 模型改用内核 pi-memory 的 `scratchpad` 待办工具推进计划时，勾选态只出现在工具入参
  // （add/done/undo），回复正文不再回写 `- [x]` —— 只吃正文的计划会永久停在首次快照。
  // 工具名按后缀容错（扩展命名空间形如 `<pkg>:scratchpad`）；动作即时生效无需防抖。
  piClient.addEventListener("tool-start", (e) => {
    const detail = e.detail;
    const toolName = String(detail?.toolName || "").toLowerCase();
    if (!toolName.endsWith(SCRATCHPAD_TOOL_SUFFIX)) return;
    const action = typeof detail?.args?.action === "string" ? detail.args.action.toLowerCase() : "";
    const text = typeof detail?.args?.text === "string" ? detail.args.text : "";
    const taskId = resolveBufferTaskId();
    if (!taskId) return;
    if (applyPadAction(taskId, action, text)) renderPlan();
  });

  // ==========================================================================
  // 任务生命周期联动：四态视图切换 / 状态变化刷新运行态 / 终态样式；
  // 新轮次消除计划；任务移除清退分仓防泄漏
  // ==========================================================================
  // 展示门禁联动：右键退出会话界面（离开 Flow）立即隐藏指示器，
  // 点进带计划的任务会话（回入 Flow）后恢复展示当前会话计划
  bus.on("view:changed", () => renderPlan());

  // 新轮次消除铁律：startNewTurn 轮次增长即视为「开启下一轮会话」，彻底消除上一轮计划
  // （静默回填轮次 silentPrompt 为生图路由内部轮，不算用户会话轮次，不清除）；
  // 首次观测到的任务仅建立基线 —— 历史恢复的任务自带已完成轮次，不得误清除其计划。
  taskManager.addEventListener("task-updated", (e) => {
    const task = e.detail;
    if (!task || !Array.isArray(task.turns)) return;
    const prevCount = turnCounts.get(task.id);
    if (prevCount !== undefined && task.turns.length > prevCount) {
      const newTurn = task.turns[task.turns.length - 1];
      if (!newTurn?.silentPrompt) {
        clearPlanForTask(task.id, { keepLastTurn: true });
      }
    }
    turnCounts.set(task.id, task.turns.length);
    renderPlan();
  });

  taskManager.addEventListener("tasks-changed", () => {
    // 清退已移除任务的计划分仓与文本缓冲（防泄漏）
    const aliveIds = new Set(taskManager.getAllTasks().map((t) => t.id));
    for (const taskId of plans.keys()) {
      if (!aliveIds.has(taskId)) plans.delete(taskId);
    }
    for (const taskId of textBuffers.keys()) {
      if (!aliveIds.has(taskId)) textBuffers.delete(taskId);
    }
    for (const taskId of turnCounts.keys()) {
      if (!aliveIds.has(taskId)) turnCounts.delete(taskId);
    }
    for (const taskId of padItems.keys()) {
      if (!aliveIds.has(taskId)) padItems.delete(taskId);
    }
    renderPlan();
  });
  taskManager.addEventListener("active-task-changed", renderPlan);
  taskManager.addEventListener("task-removed", (e) => {
    const removedId = e.detail?.taskId || null;
    if (removedId) {
      plans.delete(removedId);
      textBuffers.delete(removedId);
      turnCounts.delete(removedId);
      padItems.delete(removedId);
      // 注意：planClearedFromTurn（计划消除基线）故意不随任务移除清退 —— 终态任务退出会被
      // TaskManager 清理后经历史记录同 id 重建，基线必须跨任务重建存活，杜绝已消除的
      // 旧计划经历史回入复活（条目仅一个数字，无内存风险）
    }
    renderPlan();
  });

  renderPlan();
}

export default initPlanPanel;
