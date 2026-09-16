/**
 * token-telemetry.js — 输入框旁「额度」遥测图标与悬浮面板
 *
 * 定位：图标位于对话框外部左侧（与齿轮设置按钮同排），本身即一枚专为 24×24
 * 视口重绘的实时微型遥测仪表（mini 布局，外环 CTX 弧 + 内环 TOK 弧 + 速率闪电随数据着色与流光呼吸）；
 * 鼠标悬浮 / 键盘聚焦时在图标上方展开手绘胶囊面板（capsule 布局），实时呈现三项遥测：
 *   1. 当前上下文消耗（CTX 弧 + 「已用 / 窗口」读数）；
 *   2. 推理速度 token/s（SPD 弧 + 「推理中 / 空闲」状态）；
 *   3. 已消耗 token（TOK 弧 + 「累计 / 窗口」读数）。
 *
 * 数据来源（双通道，零侵入）：
 *   - 速度 / 实时累计：内核 `message_update` 顶层 `usage`（input / output / cacheRead / cacheWrite / totalTokens）。
 *     pi-client.js 的 handleMessageUpdate 原本把它整个丢弃，现补派 `usage` 事件；
 *     本模块对累积 output 做时间差分 + EMA 平滑得到 token/s。
 *   - 上下文窗口 / 累计 / 费用：内核 `get_session_stats` RPC。其响应帧不进广播通道
 *     （host_pool 仅唤醒 pending_responses 等待者），故由后端 `pi_get_session_stats`
 *     以 with_response 语义同步取回；本模块仅在面板可见时低频轮询。
 *
 * 职责边界（AGENTS.md 前端模块化铁律）：
 *   - 本模块只做「呈现 + 遥测采样」；DOM 引用经 el-binder 自绑定 `telemetry-btn`；
 *   - 前台门禁：只采纳前台活跃任务的 usage 与 stats，后台任务事件一律忽略，
 *     杜绝跨任务串味（任务切换时自动重置采样缓存）；
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
import { createTokenTelemetryGauge } from "../lib/token-telemetry-gauge.js";

/** 面板可见时的 stats 轮询周期（ms）—— 仅悬浮时才跑，零常态负担 */
const STATS_POLL_INTERVAL_MS = 2000;
/** 缩略仪表后台刷新周期（ms）—— 挂起态也跑，保证小图标常驻 live */
const STATS_BACKGROUND_INTERVAL_MS = 15000;
/** 速度采样：超过该时长没有新 usage 帧即判定推理已停顿，速度回落为 0 */
const SPEED_IDLE_THRESHOLD_MS = 2500;
/** 速度 EMA 平滑系数（越接近 1 越平滑） */
const SPEED_EMA_ALPHA = 0.6;
/** 速度刻度上限（gauge 内部会保证最小 10） */
const SPEED_SCALE_MAX = 120;
/** 已耗 token 的参考预算刻度（无上下文窗口时的保守回退刻度） */
const TOKEN_BUDGET_FALLBACK = 64000;
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

  // ---- 遥测采样缓存（按前台任务隔离）----
  /** 最近一次 usage 采样点 {taskId, output, total, ts} */
  let lastSample = null;
  /** EMA 平滑后的 token/s */
  let emaSpeed = 0;
  /** 最近一次 get_session_stats 结果（归属 statsTaskId） */
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

  /**
   * 处理 message_update 顶层 usage：累积 output 差分 → token/s（EMA）。
   * 前台门禁：仅采纳前台活跃任务帧。
   */
  function handleUsage(detail) {
    // 前台门禁：仅采纳前台活跃任务帧（detail 无归属时回落到前台任务）
    const active = currentTaskId();
    const tid = detail.taskId || active;
    if (tid !== active) return;
    const u = detail.usage || {};
    const now = performance.now();
    const output = typeof u.output === "number" ? u.output : null;
    const total =
      typeof u.totalTokens === "number"
        ? u.totalTokens
        : typeof u.input === "number" && typeof u.output === "number"
          ? u.input + u.output
          : null;

    // 停顿回落：长时间无新帧时速度归零（EMA 本身会缓慢衰减，这里直接判定空闲）
    if (lastSample && now - lastSample.ts > SPEED_IDLE_THRESHOLD_MS) {
      emaSpeed = 0;
      lastSample = null;
    }

    if (output != null) {
      if (lastSample && lastSample.taskId === tid && now > lastSample.ts) {
        const dt = (now - lastSample.ts) / 1000;
        const dTokens = output - lastSample.output;
        if (dt > 0 && dTokens >= 0) {
          const inst = dTokens / dt;
          emaSpeed = emaSpeed === 0 ? inst : SPEED_EMA_ALPHA * emaSpeed + (1 - SPEED_EMA_ALPHA) * inst;
        }
      }
      lastSample = { taskId: tid, output, total, ts: now };
    }
  }

  /** 任务切换 / 新建时重置采样缓存，杜绝跨任务串味 */
  function resetSamplesIfTaskChanged() {
    const tid = currentTaskId();
    if (statsTaskId && statsTaskId !== tid) {
      stats = null;
      statsTaskId = null;
      lastSample = null;
      emaSpeed = 0;
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
    resetSamplesIfTaskChanged();
    const ctxUsage = stats?.contextUsage || null;
    const ctxUsed = typeof ctxUsage?.tokens === "number" ? ctxUsage.tokens : null;
    const ctxTotal = typeof ctxUsage?.contextWindow === "number" ? ctxUsage.contextWindow : null;
    const budget = ctxTotal || TOKEN_BUDGET_FALLBACK;

    const opts = {
      id: "ttg-main",
      layout: "capsule",
      speed: Math.max(0, Math.round(emaSpeed)),
      speedMax: SPEED_SCALE_MAX,
    };

    // 当前上下文消耗
    if (ctxUsed != null && ctxTotal) {
      opts.contextUsed = ctxUsed;
      opts.contextTotal = ctxTotal;
    } else if (typeof ctxUsage?.percent === "number") {
      opts.contextRatio = Math.min(1, Math.max(0, ctxUsage.percent / 100));
    }

    // 已消耗 token（累计 total；参考刻度取上下文窗口，直观反映「还能说多久」）
    const usedTotal = stats?.tokens?.total ?? lastSample?.total ?? null;
    if (usedTotal != null) {
      opts.tokensUsed = usedTotal;
      opts.tokensBudget = budget;
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

  // 实时 usage 采样（前台门禁在 handleUsage 内生效）；缩略仪表常驻刷新，面板仅可见时随刷
  piClient.addEventListener("usage", (e) => {
    handleUsage(e.detail);
    applyGauges();
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

  // 任务被移除 / 归档时清空遥测并同步缩略仪表，杜绝幽灵读数
  taskManager.addEventListener("task-removed", () => {
    resetSamplesIfTaskChanged();
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
