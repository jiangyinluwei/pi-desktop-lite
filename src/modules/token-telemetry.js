/**
 * token-telemetry.js — 输入框旁「额度」遥测图标与悬浮面板
 *
 * 定位：图标位于对话框外部左侧（与齿轮设置按钮同排），本身即一枚专为 24×24
 * 视口重绘的实时微型遥测仪表（mini 布局，外环 CTX 弧 + 内环 TOK 弧 + 速率闪电随数据着色与流光呼吸）；
 * 鼠标悬浮 / 键盘聚焦时在图标上方展开手绘胶囊面板（capsule 布局），实时呈现三项遥测：
 *   1. 当前上下文消耗（CTX 弧 + 「已用 / 窗口」读数）；
 *   2. 推理速度 token/s（SPD 弧 + 「推理中 / 均值 / 空闲」状态；四档阈值着色
 *      < 50 红 / < 100 橙 / < 200 绿 / ≥ 200 蓝，档位解析唯一源 gauge 的 resolveSpeedLevel）；
 *   3. 已消耗 token（TOK 弧 + 「累计 / 额度」读数；额度为动态量级阶梯分母，从 1M 起
 *      用量满足当前量级后自动 ×10（1M → 10M → 100M → 1B → 10B → …），档位绿/橙/红着色）。
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
 *     检测到 output 下降即把旧消息产出入账 tokensBanked 后重新计数，兼容单调累计与逐消息重置两种语义；
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
  /** Map<taskId, sample>；sample = { tokensBanked, msgBase, output, total, ts,
   *  genElapsedMs, runStartTs, toolElapsedMs, activeTools, isGenerating } */
  const samples = new Map();
  /** 最近一次 get_session_stats 结果（归属 statsTaskId，仅前台任务） */
  let stats = null;
  let statsTaskId = null;
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

  /** 事件帧任务归属解析（与 flow-pipeline 同源回退链） */
  function resolveEventTaskId(detail) {
    return detail?.task_id || detail?.taskId || piClient.lastEventTaskId || null;
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
    const tid = detail?.task_id || detail?.taskId || currentTaskId();
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
    const s = samples.get(resolveEventTaskId(detail));
    if (!s || s.runStartTs == null) return;
    if (detail?.toolCallId) s.activeTools.set(detail.toolCallId, performance.now());
  }

  /** tool-end：闭合工具窗口并累计其耗时 */
  function handleToolEnd(detail) {
    const s = samples.get(resolveEventTaskId(detail));
    const toolCallId = detail?.toolCallId;
    if (!s || !toolCallId) return;
    const t0 = s.activeTools.get(toolCallId);
    if (t0 != null) {
      s.toolElapsedMs += Math.max(0, performance.now() - t0);
      s.activeTools.delete(toolCallId);
    }
  }

  /** agent-end / agent-error：收口 run，定格均值（终态后冻结显示「均值」） */
  function handleAgentEnd(detail) {
    const s = samples.get(resolveEventTaskId(detail));
    if (!s) return;
    closeRun(s);
    applyGauges();
  }

  /**
   * 处理 message_update 顶层 usage：产出入账 + run 括号兜底。
   * 既有仓可继续吸收各自任务帧（含挂起任务，均值后台保温），新建仅限前台任务。
   */
  function handleUsage(detail) {
    const u = detail?.usage || {};
    const tid = detail?.taskId || currentTaskId();
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

    // provider 计数回绕入账：检测到 output 下降即判定跨消息重置，旧消息产出入账后重新计数
    if (output != null) {
      if (s.output != null && output < s.output) {
        s.tokensBanked += s.output;
        s.msgBase = 0;
      }
      s.output = output;
    }
    if (total != null) s.total = total;
    s.ts = now;

    // run 括号兜底：错过 agent-start（模块冷启动 / 任务直切入场）时从本帧起记时，随帧收敛
    if (s.runStartTs == null) {
      s.runStartTs = now;
      s.toolElapsedMs = 0;
      s.activeTools.clear();
      s.isGenerating = true;
    }
  }

  /** stats 只服务前台任务：任务切换时清空旧缓存，杜绝跨任务串味 */
  function resetStatsIfTaskChanged() {
    const tid = currentTaskId();
    if (statsTaskId && statsTaskId !== tid) {
      stats = null;
      statsTaskId = null;
    }
  }

  /** 拉取一次内核会话统计（静默降级，不报错） */
  async function refreshStats() {
    const tid = currentTaskId();
    if (!tid || !piClient.hasKernel()) return;
    const data = await piClient.getSessionStats(tid);
    if (data) {
      stats = data;
      statsTaskId = tid;
    }
  }

  /** 计算当前 gauge 渲染参数 */
  function buildGaugeOptions() {
    resetStatsIfTaskChanged();
    const tid = currentTaskId();
    const s = tid ? samples.get(tid) : null;
    const ctxUsage = stats?.contextUsage || null;
    const ctxUsed = typeof ctxUsage?.tokens === "number" ? ctxUsage.tokens : null;
    const ctxTotal = typeof ctxUsage?.contextWindow === "number" ? ctxUsage.contextWindow : null;

    const speed = Math.max(0, computeTaskSpeed(s));
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
    const usedTotal = stats?.tokens?.total ?? s?.total ?? null;
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
    // 立即同步一次最新采样并启动轮询
    applyGauges();
    void refreshStats().then(() => applyGauges());
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

  // 内核下线：全部采样仓清空，杜绝幽灵读数复活
  piClient.addEventListener("kernel-status-change", (e) => {
    if (e.detail?.hasKernel === false) {
      samples.clear();
      stats = null;
      statsTaskId = null;
      applyGauges();
    }
  });

  // 轮次 / 会话收口时刷新一次终态统计（上下文窗口在收口后才稳定）
  const refreshOnSettle = () => {
    if (popup && popup.classList.contains("visible")) {
      void refreshStats().then(() => applyGauges());
    } else {
      stats = null;
      statsTaskId = null;
      applyGauges();
    }
  };
  piClient.addEventListener("message-end", refreshOnSettle);
  piClient.addEventListener("agent-end", refreshOnSettle);
  piClient.addEventListener("agent-settled", refreshOnSettle);

  // 任务被移除 / 归档时清理其采样仓并同步缩略仪表，杜绝幽灵读数
  taskManager.addEventListener("task-removed", (e) => {
    const tid = e.detail?.taskId;
    if (tid) samples.delete(tid);
    resetStatsIfTaskChanged();
    applyGauges();
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
