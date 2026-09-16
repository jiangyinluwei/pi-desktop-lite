/**
 * token-telemetry.js — 输入框旁「额度」遥测图标与悬浮面板
 *
 * 定位：图标位于对话框外部左侧（与齿轮设置按钮同排），本身即一枚专为 24×24
 * 视口重绘的实时微型遥测仪表（mini 布局，外环 CTX 弧 + 内环 TOK 弧 + 速率闪电随数据着色与步骤弧光高亮）；
 * 鼠标悬浮 / 键盘聚焦时在图标上方展开手绘胶囊面板（capsule 布局），实时呈现三项遥测：
 *   1. 当前上下文消耗（CTX 弧 + 「已用 / 窗口」读数）；
 *   2. 推理速度 token/s（SPD 弧 + 「推理中 / 均值 / 空闲」状态；四档阈值着色
 *      < 50 红 / < 100 橙 / < 200 绿 / ≥ 200 蓝，档位解析唯一源 gauge 的 resolveSpeedLevel）；
 *   3. 已消耗 token（TOK 弧 + 「累计 / 额度」读数；额度为动态量级阶梯分母，从 1M 起
 *      用量满足当前量级后自动 ×10（1M → 10M → 100M → 1B → 10B → …），档位绿/橙/红着色）。
 *
 * 会话数据保留（保留会话数据，下次点开仍展示该历史对话的三项遥测）：
 *   - 内存级：stats 不再在收口 / 任务切换时清空，改为按 taskId 分仓（statsByTask）保留
 *     「最近一次 get_session_stats 结果」；速度仓 samples 本身即按 taskId 保留冻结均值。
 *     会话结束后收起面板、再点开（hover / focus）时，面板与缩略仪表立即回填该会话的
 *     上下文消耗 / 推理均值速度 / 已消耗 token，随后再尝试拉取一次实时数据覆盖。
 *   - 磁盘级：以 sessionPath（会话延续铁律的持久身份）为键把稳定快照节流写入 localStorage
 *     （上下文 / 累计 / 冻结均值速度 / 时间戳），跨应用重启与「历史记录 / 会话记录」还原
 *     会话时回填——历史会话无活跃内核宿主也能展示其遥测。无磁盘可写时静默降级为仅内存保留。
 *
 * 数据来源（双通道，零侵入）：
 *   - 速度 / 实时累计：内核 `message_update` 顶层 `usage`（input / output / cacheRead / cacheWrite / totalTokens）。
 *     pi-client.js 的 handleMessageUpdate 原本把它整个丢弃，现补派 `usage` 事件。
 *   - 上下文窗口 / 累计 / 费用：内核 `get_session_stats` RPC。其响应帧不进广播通道
 *     （host_pool 仅唤醒 pending_responses 等待者），故由后端 `pi_get_session_stats`
 *     以 with_response 语义同步取回；本模块仅在面板可见时低频轮询。
 *
 * 推理速度全局动态均值算法（杜绝「偶尔归零」）：
 *   speed = 当前任务累计推理 output ÷ 当前任务有效生成耗时（agent run 墙钟总时长剔除工具调用窗口）。
 *   与旧的「相邻 usage 帧差分 + EMA + 2.5s 空闲归零」不同，全局均值只随真实产出的 token
 *   与真实非工具耗时单调收敛，帧间停顿、思考静默、工具长耗时均不再把速度打成 0：
 *   - 任务分仓：Map<taskId, sample>，跨任务直切各自保留均值（前台渲染当前任务的仓）；
 *   - run 括号：`agent-start` 开括号记 runStartTs，`agent-end` / `agent-error` 收口把
 *     (now - runStartTs - 工具耗时) 折算入 genElapsedMs；进行中工具窗口经 activeTools 实时剔除；
 *   - 计数入账：provider 上报 usage 为「最近一次累计」，跨消息可能回绕归零，
 *     检测到 output / total 下降即把旧消息产出 / 累计入账（分别并入 tokensBanked /
 *     totalBanked，速度与已耗 token 分仓互不污染）后重新计数，兼容单调累计与逐消息
 *     重置两种语义——会话累计 total 单调不归零，新的工具调用消息起始不再把 TOK 弧打成 0；
 *   - 已知良好值保留（last-known-good）：stats 分仓经 mergeStats 合并新一轮响应，
 *     contextUsage / 累计 token 的单次瞬时空帧（压缩后等待新响应、首消息未上报 usage、
 *     工具执行期间 get_session_stats 4s 超时后的首轮空帧）不把已稳定的读数打回零；
 *     磁盘快照同理，captureSnapshot 已有字段不被新一轮空值降级；
 *   - 括号兜底：错过 agent-start（模块冷启动 / 任务直切入场）时由首个 usage 帧惰性开括号，随帧收敛；
 *   - 预热下限：有效时长 < 250ms 视为预热期暂不出速度，杜绝首帧除零尖峰。
 *
 * 职责边界（AGENTS.md 前端模块化铁律）：
 *   - 本模块只做「呈现 + 遥测采样」；DOM 引用经 el-binder 自绑定 `telemetry-btn`；
 *   - 前台门禁：仅前台活跃任务允许新建采样仓并在面板呈现；既有仓可继续吸收各自任务的
 *     usage / 工具 / run 事件（严格按 taskId 归仓，零串味），挂起任务均值冻结不衰减；
 *   - 无内核 / 无活跃会话时安静降级为「空闲」空读数，不报错、不弹窗、不发通知。
 *
 * 铁律对齐：
 *   - 铁律 4：手绘 SVG 图元 + currentColor 双模主题（仪表图标见 index.html 内联）；
 *   - 铁律 5：按钮常态透明无边框（1px transparent 占位），仅 hover/:focus-visible 显框；
 *   - 铁律 3：右键 / Esc 回退时收起面板（__piRegisterStepBack）；
 *   - 铁律 2：面板悬浮时点击外部空白自动隐藏（与失焦高亮释放链路一致）。
 */

import { bindAll } from "../lib/el-binder.js";
import { bus } from "../lib/event-bus.js";
import { resolveEventTaskId } from "../lib/contracts.js";
import { piClient } from "../services/pi-client.js";
import { taskManager } from "../services/task-manager.js";
import { createTokenTelemetryGauge, resolveTokenQuota } from "../lib/token-telemetry-gauge.js";

/** 面板可见时的 stats 轮询周期（ms）—— 仅悬浮时才跑，零常态负担 */
const STATS_POLL_INTERVAL_MS = 2000;
/** 缩略仪表后台刷新周期（ms）—— 挂起态也跑，保证小图标常驻 live */
const STATS_BACKGROUND_INTERVAL_MS = 15000;
/** 速度刻度上限（gauge 内部会保证最小 10）；档位阈值 <50/<100/<200 归 gauge 唯一源 */
const SPEED_SCALE_MAX = 250;
/** 有效生成时长下限（ms）：低于该值视为预热期暂不出速度，杜绝首帧除零尖峰 */
const SPEED_MIN_EFFECTIVE_MS = 250;
/** 采样仓数量上限（防任务风暴内存膨胀；task-removed / kernel 下线时逐仓清理） */
const MAX_SAMPLES = 32;
/** stats 分仓数量上限（与采样仓同界，防内存膨胀） */
const MAX_STATS_BINS = 32;
/** localStorage 中遥测快照总表的键（按 sessionPath 持久化，跨重启 / 历史会话还原保留） */
const SNAPSHOT_STORE_KEY = "pi_dl_telemetry_snapshots";
/** 磁盘快照条数上限（LRU 淘汰最旧） */
const SNAPSHOT_MAX_ENTRIES = 64;
/** 磁盘快照写入节流间隔（ms）：合并短时间内的多次采集，杜绝高频写盘 */
const SNAPSHOT_SAVE_DEBOUNCE_MS = 1200;
/** 面板相对按钮的水平间距 */
const POPUP_OFFSET_X = 4;
/** 面板与按钮的垂直间距 */
const POPUP_GAP_Y = 8;
/** 面板宽度（与 gauge capsule 布局一致） + 视口安全边距 */
const POPUP_WIDTH = 320;
/** 面板高度回退值（capsule 布局实测约 92） */
const POPUP_HEIGHT_FALLBACK = 96;
const VIEWPORT_MARGIN = 8;

/** 缩略仪表尺寸（按钮内等比例缩小版实时 gauge） */
const MINI_GAUGE_PX = 20;

/**
 * 初始化「额度」遥测图标。
 * @param {object} ctx 共享上下文（viewStore / api 等）
 */
export function initTokenTelemetry(ctx) {
  const el = bindAll({ telemetryBtn: "telemetry-btn" });
  if (!el.telemetryBtn) return;

  // ---- 遥测采样缓存（按任务分仓，跨任务直切保留各自均值）----
  /** Map<taskId, sample>；sample = { tokensBanked, totalBanked, msgBase, output, total, ts,
   *  genElapsedMs, runStartTs, toolElapsedMs, activeTools, isGenerating } */
  const samples = new Map();
  /**
   * Map<taskId, stats>：按任务分仓保留「最近一次 get_session_stats 结果」
   * （上下文窗口 / 累计 token / 费用）。收口与任务切换均不清空，仅 task-removed /
   * kernel 下线时清理——保证会话结束后下次点开仍展示该会话遥测。
   */
  const statsByTask = new Map();
  /**
   * 磁盘快照内存镜像：Map<sessionPath, snapshot>，避免反复解析 localStorage；
   * snapshot = { ctx, usedTotal, speed, savedAt }，跨重启 / 历史会话还原保留。
   */
  const snapshotCache = new Map();
  let snapshotCacheLoaded = false;
  /** 磁盘快照节流写入定时器 */
  let snapshotSaveTimer = null;
  /** stats 轮询定时器（仅面板可见时运行） */
  let pollTimer = null;
  /** 隐藏延迟定时器（鼠标在按钮与面板间移动时不闪烁） */
  let hideTimer = null;

  // ---- 浮层 DOM（惰性创建）----
  let popup = null;
  let gauge = null;

  // ---- 缩略实时仪表（按钮本体，专为 24x24 微型视口重绘，直观展现上下文比值/Token比值/速度）----
  const miniGauge = createTokenTelemetryGauge({
    ...buildGaugeOptions(),
    id: "ttg-mini",
    layout: "mini",
    size: MINI_GAUGE_PX,
  });
  Object.assign(miniGauge.element.style, {
    width: `${MINI_GAUGE_PX}px`,
    height: `${MINI_GAUGE_PX}px`,
    display: "block",
  });
  el.telemetryBtn.appendChild(miniGauge.element);

  /** 同步刷新缩略仪表与（已创建的）面板仪表 */
  function applyGauges() {
    const opts = buildGaugeOptions();
    miniGauge.update(opts);
    if (gauge) gauge.update(opts);
  }

  /** 前台活跃任务 id（无活跃任务时为 null） */
  function currentTaskId() {
    return taskManager.getCurrentActiveTask()?.id || null;
  }

  /** 取（或惰性创建）任务采样仓；仅前台活跃任务允许新建，杜绝后台任务无限建仓 */
  function ensureSample(tid) {
    let s = samples.get(tid);
    if (!s) {
      if (tid !== currentTaskId()) return null;
      s = {
        taskId: tid,
        tokensBanked: 0,
        totalBanked: 0,
        msgBase: 0,
        output: null,
        total: null,
        ts: 0,
        genElapsedMs: 0,
        runStartTs: null,
        toolElapsedMs: 0,
        activeTools: new Map(),
        isGenerating: false,
      };
      samples.set(tid, s);
      if (samples.size > MAX_SAMPLES) {
        for (const key of samples.keys()) {
          if (key !== currentTaskId()) {
            samples.delete(key);
            break;
          }
        }
      }
    }
    return s;
  }

  /**
   * 会话累计已耗 token（采样仓口径）：跨消息回绕入账后的 total，单调不归零。
   * provider 逐消息重置 usage，新消息起始 total 回落时旧消息累计已并入 totalBanked。
   */
  function sampleTotalTokens(s) {
    if (!s) return null;
    if (typeof s.total !== "number") return s.totalBanked > 0 ? s.totalBanked : null;
    return s.totalBanked + s.total;
  }

  /**
   * 任务推理速度（tok/s）：累计推理 output ÷ 有效生成时长（run 墙钟剔除工具调用窗口）。
   * 只随真实产出与真实非工具耗时收敛，帧间停顿 / 工具长耗时不再归零。
   */
  function computeTaskSpeed(s) {
    if (!s || s.output == null) return 0;
    const totalOut = s.tokensBanked + Math.max(0, s.output - s.msgBase);
    if (totalOut <= 0) return 0;
    const now = performance.now();
    let effMs = s.genElapsedMs;
    if (s.runStartTs != null) {
      let toolMs = s.toolElapsedMs;
      for (const t0 of s.activeTools.values()) toolMs += Math.max(0, now - t0);
      effMs += Math.max(0, now - s.runStartTs - toolMs);
    }
    if (effMs < SPEED_MIN_EFFECTIVE_MS) return 0;
    return totalOut / (effMs / 1000);
  }

  /** run 收口：把当前 run 的非工具耗时折算入账并定格均值（幂等，无进行中 run 时空转） */
  function closeRun(s) {
    if (!s) return;
    if (s.runStartTs == null) {
      s.isGenerating = false;
      return;
    }
    const now = performance.now();
    let toolMs = s.toolElapsedMs;
    for (const t0 of s.activeTools.values()) toolMs += Math.max(0, now - t0);
    s.activeTools.clear();
    s.genElapsedMs += Math.max(0, now - s.runStartTs - toolMs);
    s.runStartTs = null;
    s.toolElapsedMs = 0;
    s.isGenerating = false;
  }

  /** agent-start：开 run 括号（同 run 重复帧幂等） */
  function handleAgentStart(detail) {
    const tid = resolveEventTaskId(detail, currentTaskId());
    if (!tid) return;
    const s = ensureSample(tid);
    if (!s) return;
    if (s.runStartTs == null) {
      s.runStartTs = performance.now();
      s.toolElapsedMs = 0;
      s.activeTools.clear();
    }
    s.isGenerating = true;
    applyGauges();
  }

  /** tool-start：登记进行中工具窗口（仅既有 run 内生效，跨任务按仓隔离） */
  function handleToolStart(detail) {
    const s = samples.get(resolveEventTaskId(detail, piClient.lastEventTaskId));
    if (!s || s.runStartTs == null) return;
    if (detail?.toolCallId) s.activeTools.set(detail.toolCallId, performance.now());
  }

  /** tool-end：闭合工具窗口并累计其耗时 */
  function handleToolEnd(detail) {
    const s = samples.get(resolveEventTaskId(detail, piClient.lastEventTaskId));
    const toolCallId = detail?.toolCallId;
    if (!s || !toolCallId) return;
    const t0 = s.activeTools.get(toolCallId);
    if (t0 != null) {
      s.toolElapsedMs += Math.max(0, performance.now() - t0);
      s.activeTools.delete(toolCallId);
    }
  }

  /** agent-end / agent-error：收口 run，定格均值（终态后冻结显示「均值」）并持久化终态快照 */
  function handleAgentEnd(detail) {
    const tid = resolveEventTaskId(detail, piClient.lastEventTaskId);
    const s = samples.get(tid);
    if (s) closeRun(s);
    captureSnapshot(tid);
    applyGauges();
  }

  /**
   * 处理 message_update 顶层 usage：产出入账 + run 括号兜底。
   * 既有仓可继续吸收各自任务帧（含挂起任务，均值后台保温），新建仅限前台任务。
   */
  function handleUsage(detail) {
    const u = detail?.usage || {};
    const tid = resolveEventTaskId(detail, currentTaskId());
    if (!tid) return;
    const s = ensureSample(tid);
    if (!s) return;
    const now = performance.now();
    const output = typeof u.output === "number" ? u.output : null;
    const total =
      typeof u.totalTokens === "number"
        ? u.totalTokens
        : typeof u.input === "number" && typeof u.output === "number"
          ? u.input + u.output
          : null;

    // provider 计数回绕入账：output / total 任一下降即判定跨消息重置，旧消息累计
    // 入账后重新计数（total 并入 totalBanked，与速度专用的 tokensBanked 分仓，互不污染）
    if (output != null) {
      if (s.output != null && output < s.output) {
        s.tokensBanked += s.output;
        s.msgBase = 0;
      }
      s.output = output;
    }
    if (total != null) {
      if (s.total != null && total < s.total) s.totalBanked += s.total;
      s.total = total;
    }
    s.ts = now;

    // run 括号兜底：错过 agent-start（模块冷启动 / 任务直切入场）时从本帧起记时，随帧收敛
    if (s.runStartTs == null) {
      s.runStartTs = now;
      s.toolElapsedMs = 0;
      s.activeTools.clear();
      s.isGenerating = true;
    }
  }

  /**
   * 磁盘快照总表情性装载（仅一次）：解析 localStorage 中的 sessionPath → snapshot 映射，
   * 损坏 / 不可读时静默降级为空表（仅内存保留）。
   */
  function loadSnapshotStore() {
    if (snapshotCacheLoaded) return;
    snapshotCacheLoaded = true;
    try {
      const raw = localStorage.getItem(SNAPSHOT_STORE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        for (const [sp, snap] of Object.entries(obj)) {
          if (sp && snap && typeof snap === "object") snapshotCache.set(sp, snap);
        }
      }
    } catch {
      // 磁盘不可读 / JSON 损坏：静默降级，遥测保留退化为仅会话内内存保留
    }
  }

  /** 按 sessionPath 取持久化快照（历史会话还原 / 重启后回填） */
  function loadSnapshot(sessionPath) {
    if (!sessionPath) return null;
    loadSnapshotStore();
    return snapshotCache.get(sessionPath) || null;
  }

  /**
   * 按 sessionPath 持久化一份遥测快照（LRU 淘汰最旧，节流合并写盘）。
   * @param {string} sessionPath 会话持久身份
   * @param {{ ctx: any|null, usedTotal: number|null, speed: number, savedAt: number }} snap
   */
  function storeSnapshot(sessionPath, snap) {
    if (!sessionPath) return;
    loadSnapshotStore();
    // 已存在键先删后插，把最近使用的会话挪到 LRU 尾部
    snapshotCache.delete(sessionPath);
    snapshotCache.set(sessionPath, snap);
    while (snapshotCache.size > SNAPSHOT_MAX_ENTRIES) {
      const oldest = snapshotCache.keys().next().value;
      snapshotCache.delete(oldest);
    }
    if (snapshotSaveTimer) return;
    snapshotSaveTimer = setTimeout(() => {
      snapshotSaveTimer = null;
      try {
        const obj = {};
        for (const [sp, s] of snapshotCache) obj[sp] = s;
        localStorage.setItem(SNAPSHOT_STORE_KEY, JSON.stringify(obj));
      } catch {
        // 磁盘不可写（隐私模式 / 配额）：静默降级为仅内存保留，不报错不弹窗
      }
    }, SNAPSHOT_SAVE_DEBOUNCE_MS);
  }

  /**
   * 采集前台任务当前遥测快照并按 sessionPath 持久化（收口 / stats 刷新成功时调用）。
   * 三项数据均缺失时跳过；已有快照的字段不被新一轮空值降级（杜绝工具调用消息
   * 收口时把磁盘快照的 ctx 污染成 null，致 CTX 弧归零）。
   */
  function captureSnapshot(tid) {
    if (!tid) return;
    const task = taskManager.getTask?.(tid) || null;
    const sp = task?.sessionPath;
    if (!sp) return;
    const st = statsByTask.get(tid);
    const s = samples.get(tid);
    let ctx = st?.contextUsage || null;
    // stats 仓暂不可用（工具执行期间内核常 4s 内不响应 get_session_stats）时，
    // 退回采样仓的会话累计口径，绝不用「逐消息重置」的 s.total 冒充会话累计
    let usedTotal = st?.tokens?.total ?? sampleTotalTokens(s);
    const speed = Math.max(0, computeTaskSpeed(s));
    // 已持久化的已知良好字段不被本轮空值降级
    const stored = snapshotCache.get(sp) || null;
    if (stored) {
      if (!ctx && stored.ctx) ctx = stored.ctx;
      if (usedTotal == null && stored.usedTotal != null) usedTotal = stored.usedTotal;
    }
    if (!ctx && usedTotal == null && speed <= 0) return;
    storeSnapshot(sp, { ctx, usedTotal, speed, savedAt: Date.now() });
  }

  /**
   * 历史会话还原回填：当前前台任务既无内存 stats、也无磁盘快照时，
   * 经底层会话 JSONL（逐 assistant usage 累加）直接计算遥测并入磁盘快照仓，
   * 进入历史对话立即呈现历史额度状态，无需先发起对话。纯本地文件解析，不依赖内核。
   * 并发去重（in-flight 集合）+ 已有快照去重（snapshotCache），实时 stats 永远优先。
   */
  const backfillInFlight = new Set();
  async function backfillHistoryTelemetry() {
    const tid = currentTaskId();
    const task = tid ? taskManager.getCurrentActiveTask?.() : null;
    const sp = task?.sessionPath;
    if (!sp || !sp.endsWith(".jsonl")) return;
    if (statsByTask.has(tid) || samples.has(tid)) return; // 实时 stats / 采样优先，绝不覆盖
    if (snapshotCache.has(sp)) return; // 已有快照（含已回填），无需重算
    if (backfillInFlight.has(sp)) return;
    backfillInFlight.add(sp);
    try {
      const tele = await piClient.getSessionTelemetry(sp);
      if (!tele || !(tele.total_tokens > 0)) return;
      // 若曾持久化过带 contextWindow 的快照，合成完整 contextUsage
      // （JSONL 中无窗口大小，借已知窗口还原外环比值弧）；否则仅回填 tokens。
      const stored = loadSnapshot(sp);
      const cw = stored?.ctx?.contextWindow;
      let ctx = null;
      if (typeof tele.context_tokens === "number") {
        ctx = typeof cw === "number" && cw > 0
          ? {
              contextWindow: cw,
              tokens: tele.context_tokens,
              percent: Math.min(100, (tele.context_tokens / cw) * 100),
            }
          : { tokens: tele.context_tokens };
      } else if (stored?.ctx) {
        ctx = stored.ctx;
      }
      storeSnapshot(sp, {
        ctx,
        usedTotal: tele.total_tokens,
        speed: stored?.speed ?? 0,
        savedAt: Date.now(),
      });
      applyGauges();
    } catch {
      /* 静默降级：回填失败不阻塞遥测面板 */
    } finally {
      backfillInFlight.delete(sp);
    }
  }

  /** 合并新一轮会话统计：单项字段缺失 / 置空时保留上一轮已知良好值，
   * 杜绝遥测弧因单次瞬时不完整响应（压缩后 contextUsage 暂为 null、
   * 首消息 usage 未上报、工具执行期间响应超时后的首轮空帧）「突然归零」。
   */
  function mergeStats(prev, next) {
    if (!prev || typeof prev !== "object") return next;
    if (!next || typeof next !== "object") return prev;
    const merged = { ...next };
    if (!merged.contextUsage && prev.contextUsage) merged.contextUsage = prev.contextUsage;
    if (prev.tokens) {
      const prevTotal = typeof prev.tokens.total === "number" ? prev.tokens.total : null;
      const nextTotal = merged.tokens && typeof merged.tokens.total === "number" ? merged.tokens.total : null;
      if (nextTotal == null || (prevTotal != null && prevTotal > 0 && nextTotal === 0)) {
        merged.tokens = { ...prev.tokens, ...(merged.tokens || {}) };
      }
    }
    return merged;
  }

  /** 拉取一次内核会话统计（静默降级，不报错）；成功时入前台任务分仓并顺手持久化快照 */
  async function refreshStats() {
    const tid = currentTaskId();
    if (!tid || !piClient.hasKernel()) return;
    const data = await piClient.getSessionStats(tid);
    if (data) {
      // 已知良好值保留：瞬时不完整响应不把已稳定的上下文 / 累计读数打回零
      statsByTask.set(tid, mergeStats(statsByTask.get(tid) || null, data));
      while (statsByTask.size > MAX_STATS_BINS) {
        // 自最旧起淘汰；最旧仓恰为当前前台任务时跳过、继续淘汰次旧，
        // 严禁整循环放弃导致 Map 超上限并随历史任务切换无界漂移增长
        const victim = Array.from(statsByTask.keys()).find((key) => key !== tid);
        if (!victim) break; // 全表仅剩前台任务仓，保守保留
        statsByTask.delete(victim);
      }
      captureSnapshot(tid);
    }
  }

  /** 计算当前 gauge 渲染参数（数据源：前台任务 stats 分仓 → 磁盘快照回填） */
  function buildGaugeOptions() {
    const tid = currentTaskId();
    const task = tid ? taskManager.getCurrentActiveTask() : null;
    const s = tid ? samples.get(tid) : null;

    // 数据源优先级：① 前台任务实时 / 内存保留 stats（收口后不清空）
    //               ② 磁盘快照（历史会话还原 / 重启后回填，按 sessionPath 持久身份）
    const live = tid ? (statsByTask.get(tid) || null) : null;
    const snapshot = !live && task?.sessionPath ? loadSnapshot(task.sessionPath) : null;

    const ctxUsage = live?.contextUsage || snapshot?.ctx || null;
    const ctxUsed = typeof ctxUsage?.tokens === "number" ? ctxUsage.tokens : null;
    const ctxTotal = typeof ctxUsage?.contextWindow === "number" ? ctxUsage.contextWindow : null;

    // 速度优先取实时采样仓（推理中实时均值 / 收口后冻结均值）；
    // 历史会话还原无采样仓时回退磁盘快照的冻结均值（speedText 定格「均值」）。
    const speed = Math.max(0, s ? computeTaskSpeed(s) : (snapshot?.speed ?? 0));
    const speedActive = !!s?.isGenerating;
    const opts = {
      id: "ttg-main",
      layout: "capsule",
      speed: Math.round(speed * 10) / 10,
      speedMax: SPEED_SCALE_MAX,
      speedActive,
      // 推理中 = 活跃生成实时均值；收口后冻结展示任务均值；无数据 = 空闲
      speedText: speedActive ? "推理中" : speed > 0 ? "均值" : "空闲",
    };

    // 当前上下文消耗
    if (ctxUsed != null && ctxTotal) {
      opts.contextUsed = ctxUsed;
      opts.contextTotal = ctxTotal;
    } else if (typeof ctxUsage?.percent === "number") {
      opts.contextRatio = Math.min(1, Math.max(0, ctxUsage.percent / 100));
    }

    // 已消耗 token（累计 total）：配额分母走动态量级阶梯（resolveTokenQuota）——
    // 从 1M 起，用量满足当前量级后分母自动 ×10（1M → 10M → 100M → 1B → 10B → …），
    // 档位 0/1/≥2 分别以绿/橙/红着色（tokensLevel 驱动 gauge 换色）。
    // 回退顺序：stats 仓（会话累计）→ 采样仓累计口径（跨消息回绕入账，单调）
    //          → 磁盘快照（历史会话还原）。绝不直接用逐消息的 s.total，
    //          否则每次新的工具调用消息起始 usage 重置会把 TOK 弧瞬间打成 0。
    const usedTotal =
      live?.tokens?.total ?? sampleTotalTokens(s) ?? snapshot?.usedTotal ?? null;
    if (usedTotal != null) {
      const quota = resolveTokenQuota(usedTotal);
      opts.tokensUsed = usedTotal;
      opts.tokensBudget = quota.budget;
      opts.tokensLevel = quota.level;
    }
    return opts;
  }

  /** 构建浮层 DOM（仅一次） */
  function buildPopup() {
    popup = document.createElement("div");
    popup.className = "telemetry-popup";
    popup.setAttribute("role", "tooltip");
    popup.setAttribute("aria-label", "额度遥测");
    gauge = createTokenTelemetryGauge(buildGaugeOptions());
    popup.appendChild(gauge.element);
    // 鼠标移入面板本身时取消隐藏，移出时隐藏（与按钮共享同一隐藏链路）
    popup.addEventListener("mouseenter", cancelHide);
    popup.addEventListener("mouseleave", scheduleHide);
    document.body.appendChild(popup);
  }

  /** 依据按钮几何定位浮层：优先悬浮在图标上方，顶部空间不足时回落到下方 */
  function positionPopup() {
    if (!popup || !el.telemetryBtn) return;
    const r = el.telemetryBtn.getBoundingClientRect();
    let left = r.left + POPUP_OFFSET_X;
    const maxLeft = window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN;
    if (left > maxLeft) left = Math.max(VIEWPORT_MARGIN, maxLeft);
    popup.style.left = `${Math.round(left)}px`;
    const h = popup.offsetHeight || POPUP_HEIGHT_FALLBACK;
    let top = r.top - POPUP_GAP_Y - h;
    if (top < VIEWPORT_MARGIN) top = r.bottom + POPUP_GAP_Y;
    popup.style.top = `${Math.round(top)}px`;
  }

  function showPopup() {
    cancelHide();
    if (!popup) buildPopup();
    positionPopup();
    popup.classList.add("visible");
    // 立即同步一次最新采样并启动轮询；若为无内存数据的历史会话，顺手触发底层回填
    applyGauges();
    void refreshStats().then(() => applyGauges());
    void backfillHistoryTelemetry();
    startPolling();
  }

  function hidePopup() {
    cancelHide();
    if (popup) popup.classList.remove("visible");
    stopPolling();
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(hidePopup, 160);
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      await refreshStats();
      applyGauges();
    }, STATS_POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /**
   * 后台低频采样：无论面板是否可见，只要存在活跃任务就定时拉取 stats，
   * 让缩略仪表的 CTX / TOK 弧在挂起态也保持实时。
   */
  setInterval(() => {
    if (!currentTaskId() || !piClient.hasKernel()) return;
    void refreshStats().then(() => {
      if (!popup || !popup.classList.contains("visible")) applyGauges();
    });
  }, STATS_BACKGROUND_INTERVAL_MS);

  /** 触发额度图标与悬浮面板（若已创建）的 1 秒弧光高亮 */
  function triggerArcFlash() {
    miniGauge.triggerArcFlash?.();
    if (gauge) gauge.triggerArcFlash?.();
  }

  // 监听新一轮 thinking / point / 工具调用 触发：额度图标弧光高亮 1 秒（仅前台任务生效）
  bus.on("flow:step-start", (detail) => {
    const tid = detail?.taskId || currentTaskId();
    if (tid && !taskManager.isForegroundStreamTask(tid)) return;
    triggerArcFlash();
  });

  // ---- 事件接线 ----
  el.telemetryBtn.addEventListener("mouseenter", showPopup);
  el.telemetryBtn.addEventListener("mouseleave", scheduleHide);
  el.telemetryBtn.addEventListener("focus", showPopup);
  el.telemetryBtn.addEventListener("blur", scheduleHide);

  // 实时 usage 采样（严格按 taskId 归仓，新建仅限前台）；缩略仪表常驻刷新，面板仅可见时随刷
  piClient.addEventListener("usage", (e) => {
    handleUsage(e.detail);
    applyGauges();
  });

  // run 括号与工具窗口采样：agent-start 开括号 / 工具窗口剔除 / agent-end + agent-error 收口
  piClient.addEventListener("agent-start", (e) => handleAgentStart(e.detail));
  piClient.addEventListener("tool-start", (e) => {
    handleToolStart(e.detail);
    applyGauges();
  });
  piClient.addEventListener("tool-end", (e) => {
    handleToolEnd(e.detail);
    applyGauges();
  });
  piClient.addEventListener("agent-end", (e) => handleAgentEnd(e.detail));
  piClient.addEventListener("agent-error", (e) => handleAgentEnd(e.detail));

  // 内核下线：全部采样仓与内存 stats 清空，杜绝幽灵读数复活（磁盘快照保留，供历史会话还原）
  piClient.addEventListener("kernel-status-change", (e) => {
    if (e.detail?.hasKernel === false) {
      samples.clear();
      statsByTask.clear();
      applyGauges();
    }
  });

  // 轮次 / 会话收口时保留遥测数据并落盘快照（上下文窗口在收口后才稳定）；
  // 面板可见时刷新一次实时统计覆盖，不可见时仅持久化 + 刷新缩略仪表（数据保留，下次点开即展示）
  const refreshOnSettle = () => {
    captureSnapshot(currentTaskId());
    if (popup && popup.classList.contains("visible")) {
      void refreshStats().then(() => applyGauges());
    } else {
      applyGauges();
    }
  };
  piClient.addEventListener("message-end", refreshOnSettle);
  piClient.addEventListener("agent-end", refreshOnSettle);
  piClient.addEventListener("agent-settled", refreshOnSettle);

  // 任务被移除 / 归档时清理其采样仓与 stats 分仓并同步缩略仪表，杜绝幽灵读数
  taskManager.addEventListener("task-removed", (e) => {
    const tid = e.detail?.taskId;
    if (tid) {
      samples.delete(tid);
      statsByTask.delete(tid);
    }
    applyGauges();
  });

  // 前台任务切换 / 历史会话还原入 Flow：立即按各自分仓重绘缩略仪表
  // （切换到历史会话时经磁盘快照回填其上下文 / 速度 / 消耗，无需等待内核响应；
  //   快照缺失时进一步经底层会话 JSONL 回填，进入历史对话立即呈现历史额度状态）
  taskManager.addEventListener("active-task-changed", () => {
    applyGauges();
    void backfillHistoryTelemetry();
  });

  // 铁律 3：右键 / Esc 回退时收起面板（返回 true 表示已消费该次回退）
  window.__piRegisterStepBack?.(() => {
    if (popup && popup.classList.contains("visible")) {
      hidePopup();
      return true;
    }
    return false;
  });

  // 界面切换（进入设置页等）时收起面板，避免浮层悬挂
  bus.on("view:changed", () => {
    if (popup && popup.classList.contains("visible")) hidePopup();
  });

  // 可视性变化 / 页面卸载时停止轮询，防泄漏
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hidePopup();
  });
}
