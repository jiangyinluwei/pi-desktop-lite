/**
 * 模型自动强制重连引擎 (ModelFailoverEngine)
 *
 * 在 Flow 流程中模型调用返回错误时，提供「无痕内置重连」自愈流水线：
 *   · 隐藏「模型XXX异常」错误窗体，后台静默向模型续发「继续」文本，用户无感知；
 *   · 每次续发计作一次「内置重连」，写死上限 10 次；
 *   · 退避序列 2s → 4s → 8s → 16s → 16s…（恒封顶 16s）；
 *   · 重连期间仅在轮次顶部展示进度胶囊「自动内置重连 N/10 ...」；
 *   · 10 次重连全部耗尽仍失败 → 才渲染既有错误卡（「模型调用失败 [模型]」窗体）。
 *
 * 说明：本引擎不再承担任何「自动切换模型」职责（自动切换逻辑已彻底移除）；
 * 错误卡中的「切换其他模型」为纯手动入口。
 *
 * 结果协调：引擎不直接监听全局事件，而是由 flow-pipeline.js 的 agent-end / agent-error
 * 监听器在引擎处于活跃态时调用 resolveTurnSuccess() / handleModelError() 来结算每一轮重发尝试。
 */

import { piClient, isAbortError } from "./pi-client.js";
import { configService } from "./config-service.js";

class ModelFailoverEngine extends EventTarget {
  constructor() {
    super();
    this._abortedTaskIds = new Set();
    this._exhaustedTaskIds = new Set(); // 内置重连 10 次耗尽终态 (仅手动重试/新提问可解除)
    this._unattributedExhausted = false; // 无任务归属路径 (旧主会话) 的耗尽终态标记
    this._lastAbortTimestamp = 0;
    this._resetState();
  }

  _resetState() {
    this._clearTimer();
    this.status = "idle"; // idle | reconnecting | succeeded | gave_up | cancelled
    this.attempt = 0; // 已执行的内置重连次数 (1..maxAttempts)
    this.maxAttempts = 0; // 本次流水线的重连上限
    this.taskId = null;
    this.lastError = null; // 最后一次失败详情 (供兜底渲染)
    this.hooks = null;
    this._resolveAttempt = null; // 当前在途尝试的结算回调
    this._backoffTimer = null;
    this._currentPhase = "";
  }

  /**
   * 显式标记指定任务为手动中止状态 (绝不触发自愈)
   * @param {string} taskId
   */
  markTaskAborted(taskId) {
    if (taskId) {
      if (!this._abortedTaskIds) this._abortedTaskIds = new Set();
      this._abortedTaskIds.add(String(taskId));
    }
    this._lastAbortTimestamp = Date.now();
  }

  /**
   * 清除指定任务的中止与耗尽标记 (新轮次发送/用户手动重试时调用，重新允许内置重连)
   * @param {string} taskId
   */
  clearTaskAborted(taskId) {
    if (taskId && this._abortedTaskIds) {
      this._abortedTaskIds.delete(String(taskId));
    }
    if (taskId && this._exhaustedTaskIds) {
      this._exhaustedTaskIds.delete(String(taskId));
    }
  }

  /**
   * 判定指定任务是否已被手动中止
   * @param {string | null} [taskId]
   * @returns {boolean}
   */
  isTaskAborted(taskId = null) {
    if (taskId && this._abortedTaskIds?.has(String(taskId))) {
      return true;
    }
    // 若未指定 taskId 且刚刚（1.5秒内）发生过全局终止，处于保护窗口
    if (!taskId && this._lastAbortTimestamp && Date.now() - this._lastAbortTimestamp < 1500) {
      return true;
    }
    return false;
  }

  /**
   * 判定指定任务是否已进入「内置重连耗尽」终态 (10 次全部失败、错误卡已弹出)。
   * 铁律：耗尽后同任务后续重复错误帧绝不再次自动冷启动，仅用户手动干预可解除。
   * @param {string | null | undefined} [taskId]
   * @returns {boolean}
   */
  isTaskExhausted(taskId = null) {
    if (taskId) return this._exhaustedTaskIds?.has(String(taskId)) || false;
    return this._unattributedExhausted || false;
  }

  /**
   * 近期是否发生过手动终止 (供无归属错误帧的保守静默判定：手动终止全链路禁止触发内置重连)
   * @param {number} [ms=15000] 保护窗口毫秒数
   * @returns {boolean}
   */
  hasRecentGlobalAbortion(ms = 15000) {
    return Boolean(this._lastAbortTimestamp && Date.now() - this._lastAbortTimestamp < ms);
  }

  /**
   * 当前是否存在进行中的内置重连流水线 (供 UI / 任务状态判断与全局事件分流)
   */
  isActive() {
    return this.status === "reconnecting";
  }

  /**
   * 是否可接管该错误：自动强制重连开启 且 错误含模型上下文 (provider + model)
   * 铁律：手动终止/中止错误绝对不接管，绝不触发重连！
   */
  canHandle(detail = {}) {
    if (!configService.getAutoReconnectSwitch()) return false;
    // 铁律 1：明确为中断/手动终止类错误时绝对不接管
    if (isAbortError(detail)) return false;

    // 铁律 2：所属 Task 已被手动中止时绝对不接管
    const tid = detail.taskId || detail.task_id || detail.raw?.task_id || detail.raw?.taskId || this.taskId;
    if (this.isTaskAborted(tid)) return false;

    // 铁律 3：所属 Task 已进入「重连耗尽」终态时绝不接管 (错误卡已弹出，等待用户手动干预)
    if (this.isTaskExhausted(tid)) return false;

    // 铁律 4：无归属错误帧 + 近期发生过手动终止 → 保守拒绝接管 (杜绝终止后经杂散帧静默复活重连)
    if (!tid && this.hasRecentGlobalAbortion()) return false;

    const effProvider =
      detail.provider ||
      configService.getSelectedModel()?.provider ||
      piClient.currentModel?.provider;
    const effModel =
      detail.model ||
      configService.getSelectedModel()?.modelId ||
      piClient.currentModel?.id;
    return Boolean(effProvider && effModel);
  }

  /**
   * 引擎入口：agent-error 到达时调用。
   * · 冷启动 (非活跃)：保存上下文并启动内置重连流水线 (绝不立即渲染错误卡)；
   * · 热结算 (活跃)：该错误为当前在途尝试的结果 → 结算为失败并继续流水线。
   */
  handleModelError(detail, hooks = {}) {
    // 铁律：若到达的错误属于手动中止，立即取消在途自愈并退出，严禁启动重连
    if (isAbortError(detail)) {
      if (this.isActive()) {
        this.cancel("user");
      }
      return;
    }

    const tid = detail?.taskId || detail?.task_id || detail?.raw?.task_id || detail?.raw?.taskId || this.taskId;
    if (this.isTaskAborted(tid)) {
      if (this.isActive()) {
        this.cancel("abort");
      }
      return;
    }

    // 热结算：当前有在途尝试，此错误即其结果。
    // 铁律：仅当错误属于引擎当前服务任务时才结算，严禁跨任务误结算在途尝试
    if (this.isActive() && this._resolveAttempt) {
      if (!this.taskId || !tid || String(tid) === String(this.taskId)) {
        this.lastError = detail;
        this._resolveAttempt({ success: false, error: detail });
      }
      return;
    }

    // 已在流水线中但无在途尝试 (处于退避等待)，忽略杂散错误
    if (this.isActive()) return;

    // 铁律：耗尽终态 / 近期手动终止的无归属错误帧，绝不自动冷启动 (仅用户手动重试/新提问后重置)
    if (this.isTaskExhausted(tid)) return;
    if (!tid && this.hasRecentGlobalAbortion()) return;

    // 冷启动：任何非中止类模型错误统一进入内置重连通道
    this.taskId = tid || null;
    this.lastError = detail;
    this.hooks = hooks;
    this.attempt = 0;
    this.status = "reconnecting";
    this._runReconnect();
  }

  /**
   * 全局 agent-end 在引擎活跃时调用：结算当前在途尝试为成功。
   */
  resolveTurnSuccess() {
    if (this._resolveAttempt) {
      this._resolveAttempt({ success: true });
    }
  }

  /**
   * 当前是否存在在途重发尝试等待结算（引擎活跃且正在等 agent-end/agent-error 收口）。
   * 供 TaskManager 区分「重发中收口帧」与「退避期失败轮收口帧」，防止误标 completed。
   */
  hasInflightAttempt() {
    return this.isActive() && Boolean(this._resolveAttempt);
  }

  // ==========================================================================
  // 内置重连流水线：2/4/8/16s 退避，写死上限 10 次
  // ==========================================================================

  async _runReconnect() {
    const cfg = configService.getModelFailoverConfig();
    const maxAttempts = Math.max(1, Number(cfg.maxReconnectAttempts) || 10);
    this.maxAttempts = maxAttempts;

    while (this.status === "reconnecting") {
      if (this.isTaskAborted(this.taskId)) return;
      if (this.attempt >= maxAttempts) break;

      this.attempt++;
      const delay = this._backoffDelay(this.attempt, cfg);

      // 等待退避：轮次顶部胶囊提示「自动内置重连 N/10 · Xs 后重试」
      this._currentPhase = "waiting";
      this._emit({
        status: "reconnecting",
        phase: "waiting",
        attempt: this.attempt,
        maxAttempts,
        nextDelayMs: delay,
        modelName: this._modelName(),
      });

      await this._sleep(delay);
      if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId)) return;

      // 后台静默续发「继续」文本（不生成提问卡、不显示）
      this._currentPhase = "sending";
      this._emit({
        status: "reconnecting",
        phase: "sending",
        attempt: this.attempt,
        maxAttempts,
        modelName: this._modelName(),
      });

      const result = await this._sendAttempt();
      if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId) || result?.cancelled) return;

      if (result.success) {
        this._succeed();
        return;
      }

      if (isAbortError(result.error)) {
        this.cancel("user");
        return;
      }

      this.lastError = result.error || this.lastError;
    }

    if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId)) return;

    // 10 次内置重连全部耗尽仍失败 → 弹回「模型XXX异常」窗体文本
    this._giveUp();
  }

  // ==========================================================================
  // 结果结算与终态
  // ==========================================================================

  /**
   * 发送一轮续发尝试并等待结果 (由全局 agent-end/agent-error 结算)
   */
  _sendAttempt() {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        this._resolveAttempt = null;
        resolve(result);
      };
      this._resolveAttempt = settle;
      // 触发续发；若分发本身失败则视为本轮尝试失败
      Promise.resolve(this.hooks?.onResendAttempt?.(this.taskId)).catch((err) => {
        settle({
          success: false,
          error: { message: err?.toString?.() || String(err), raw: err },
        });
      });
    });
  }

  /**
   * 外部显式重置接口 (错误状态清理/新轮次发起时安全重置，同步解除无归属耗尽标记)
   */
  reset() {
    this._unattributedExhausted = false;
    this._resetState();
  }

  /**
   * 内置重连成功：结算胶囊并清除错误状态
   */
  _succeed() {
    const reconnectCount = this.attempt;
    this._unattributedExhausted = false; // 重连成功即解除无归属耗尽标记，后续新错误可正常冷启动
    this.status = "succeeded";
    this._emit({
      status: "succeeded",
      reconnectCount,
      modelName: this._modelName(),
    });
    this.hooks?.onSuccess?.({ reconnectCount, taskId: this.taskId });
    this._resetState();
  }

  /**
   * 全部失败兜底：交由 flow-pipeline.js 渲染既有错误卡 (附内置重连摘要)
   */
  _giveUp() {
    this.status = "gave_up";
    this._clearTimer();
    // 铁律：10 次内置重连全部耗尽 → 记录耗尽终态。一次失败的内核 run 会经
    // message_end / turn_end / agent_end / agent_settled 多次派发 agent-error，
    // 首帧结算失败并弹出错误卡后，后续重复错误帧绝不允许再次自动冷启动；
    // 仅用户手动「重试当前提问」/发送新提问 (clearTaskAborted 同步清除) 后方可重新发起
    if (this.taskId) {
      this._exhaustedTaskIds.add(String(this.taskId));
    } else {
      this._unattributedExhausted = true;
    }
    const summary = {
      reconnectCount: this.attempt,
      maxAttempts: this.maxAttempts,
    };
    this._emit({ status: "gave_up", summary });
    this.hooks?.onGiveUp?.(this.lastError, summary);
    // 终态后重置 (下一次错误重新冷启动)，保留 lastError 供错误卡渲染
    const keepLastError = this.lastError;
    this._resetState();
    this.lastError = keepLastError;
  }

  /**
   * 立即终止一切待执行的退避定时器与重连流水线 (用户点击「⏹ 终止」或应用退出时调用)
   */
  cancel(reason = "user") {
    if (this.taskId) {
      this.markTaskAborted(this.taskId);
    }
    this._lastAbortTimestamp = Date.now();

    if (!this.isActive() && this.status !== "succeeded" && this.status !== "gave_up") {
      this._resetState();
      return;
    }
    this.status = "cancelled";
    this._clearTimer();
    // 结算在途尝试为已取消，解除 await 阻塞
    if (this._resolveAttempt) {
      this._resolveAttempt({ success: false, cancelled: true });
    }
    this._emit({ status: "cancelled", reason });
    this._resetState();
  }

  // ==========================================================================
  // 内部工具
  // ==========================================================================

  /**
   * 退避延迟：2s → 4s → 8s → 16s → 16s… (恒封顶 maxBackoffMs)
   * delay(attempt) = min(reconnectBackoffMs[attempt-1] ?? maxBackoffMs, maxBackoffMs)
   */
  _backoffDelay(attempt, cfg) {
    const seq = Array.isArray(cfg.reconnectBackoffMs) ? cfg.reconnectBackoffMs : [2000, 4000, 8000, 16000];
    const cap = cfg.maxBackoffMs || 16000;
    const v = seq[attempt - 1];
    return Math.min(v === undefined ? cap : v, cap);
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      this._backoffTimer = setTimeout(() => {
        this._backoffTimer = null;
        resolve();
      }, ms);
    });
  }

  _clearTimer() {
    if (this._backoffTimer) {
      clearTimeout(this._backoffTimer);
      this._backoffTimer = null;
    }
  }

  _emit(payload) {
    this.dispatchEvent(new CustomEvent("failover-status", { detail: payload }));
  }

  _modelName() {
    return this.lastError?.model || piClient.currentModel?.id || "当前模型";
  }
}

export const modelFailoverEngine = new ModelFailoverEngine();
