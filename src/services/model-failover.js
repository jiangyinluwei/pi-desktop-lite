/**
 * 模型自动重连切换引擎 (ModelFailoverEngine)
 *
 * 在 Flow 流程中模型调用返回错误时，提供全自动自愈流水线：
 *   · 瞬态错误 (429/5xx/网络类) → 按 2/4/8s 退避自动重连，上限 24 次 (同模型重发相同输入)；
 *   · 永久错误 (401/404/额度不足等) → 按白名单 MRU 顺序自动切换模型并重发；
 *   · 临时切换绝不刷新「最新使用时间标识」(MRU)，仅在候选模型成功输出后才转正常切换并置顶持久化；
 *   · 全部失败 → 恢复原模型并渲染既有错误卡 (附自愈摘要)。
 *
 * 引擎为行为主实现 (轨道 B)，覆盖 PI 内核自带 3 次重连上限；
 * 内核参数注入 (pi_apply_model_failover_preset) 为 best-effort 辅助，失效不影响本引擎。
 *
 * 结果协调：引擎不直接监听全局事件，而是由 main.js 的 agent-end / agent-error 监听器
 * 在引擎处于活跃态时调用 resolveTurnSuccess() / handleModelError() 来结算每一轮重发尝试。
 */

import { piClient, classifyModelError, isAbortError } from "./pi-client.js";
import { configService } from "./config-service.js";

class ModelFailoverEngine extends EventTarget {
  constructor() {
    super();
    this._abortedTaskIds = new Set();
    this._lastAbortTimestamp = 0;
    this._resetState();
  }

  _resetState() {
    this.status = "idle"; // idle | reconnecting | switching | succeeded | gave_up | cancelled
    this.kind = null; // "TRANSIENT" | "PERMANENT"
    this.attempt = 0; // 重连计数 (1..24)
    this.taskId = null;
    this.candidates = [];
    this.candidateIndex = -1;
    this.originalModel = null; // { provider, modelId } 自愈前的原模型
    this.currentTemporaryModel = null; // { provider, modelId } 当前临时切换的模型
    this.lastError = null; // 最后一次失败详情 (供兜底渲染)
    this.hooks = null;
    this._resolveAttempt = null; // 当前在途尝试的结算回调
    this._backoffTimer = null;
    this._reconnectCount = 0; // 累计重连次数 (用于摘要)
    this._switchedCandidates = 0; // 累计尝试过的候选模型数 (用于摘要)
    if (!this._abortedTaskIds) {
      this._abortedTaskIds = new Set();
    }
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
   * 清除指定任务的中止标记 (新轮次发送时调用)
   * @param {string} taskId
   */
  clearTaskAborted(taskId) {
    if (taskId && this._abortedTaskIds) {
      this._abortedTaskIds.delete(String(taskId));
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
   * 当前是否存在进行中的自愈流水线 (供 UI / 任务状态判断与全局事件分流)
   */
  isActive() {
    return this.status === "reconnecting" || this.status === "switching";
  }

  /**
   * 是否可接管该错误：自动重连开启 且 错误含模型上下文 (provider + model)
   * 铁律：手动终止/中止错误绝对不接管，绝不触发重连与切换！
   */
  canHandle(detail = {}) {
    if (!configService.getAutoReconnectSwitch()) return false;
    // 铁律 1：明确为中断/手动终止类错误时绝对不接管
    if (isAbortError(detail)) return false;

    // 铁律 2：所属 Task 已被手动中止时绝对不接管
    const tid = detail.taskId || detail.task_id || detail.raw?.task_id || detail.raw?.taskId || this.taskId;
    if (this.isTaskAborted(tid)) return false;

    return Boolean(detail.provider && detail.model);
  }

  /**
   * 引擎入口：agent-error 到达时调用。
   * · 冷启动 (非活跃)：完成分类、保存上下文、启动自愈流水线 (绝不立即渲染错误卡)；
   * · 热结算 (活跃)：该错误为当前在途尝试的结果 → 结算为失败并继续流水线。
   */
  handleModelError(detail, hooks = {}) {
    // 铁律：若到达的错误属于手动中止，立即取消在途自愈并退出，严禁启动重连或切换
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

    // 热结算：当前有在途尝试，此错误即其结果
    if (this.isActive() && this._resolveAttempt) {
      this.lastError = detail;
      this._resolveAttempt({ success: false, error: detail });
      return;
    }

    // 冷启动
    if (this.isActive()) return; // 已在流水线中但无在途尝试 (处于退避等待)，忽略杂散错误

    const kind = classifyModelError(detail);
    if (kind === "ABORTED") {
      // 中止类错误绝对不冷启动自愈
      return;
    }

    this.kind = kind;
    this.taskId = tid || null;
    this.originalModel = {
      provider: detail.provider || configService.getSelectedModel()?.provider,
      modelId: detail.model || configService.getSelectedModel()?.modelId,
    };
    this.lastError = detail;
    this.hooks = hooks;
    this._reconnectCount = 0;
    this._switchedCandidates = 0;

    if (kind === "TRANSIENT") {
      this.status = "reconnecting";
      this._runReconnect();
    } else {
      // PERMANENT (含 UNKNOWN 保守归永久) → 直接切换模型
      this.status = "switching";
      this._runSwitch();
    }
  }

  /**
   * 全局 agent-end 在引擎活跃时调用：结算当前在途尝试为成功。
   */
  resolveTurnSuccess() {
    if (this._resolveAttempt) {
      this._resolveAttempt({ success: true });
    }
  }

  // ==========================================================================
  // 行为分支一：瞬态错误自动重连 (2/4/8s 退避，≤24 次)
  // ==========================================================================

  async _runReconnect() {
    const cfg = configService.getModelFailoverConfig();
    const max = cfg.maxReconnectAttempts;

    while (this.status === "reconnecting" && this.attempt < max) {
      if (this.isTaskAborted(this.taskId)) return; // 响应手动终止门禁
      this.attempt++;
      this._reconnectCount = this.attempt;
      const delay = this._backoffDelay(this.attempt, cfg);
      this._emit({
        status: "reconnecting",
        phase: "waiting",
        attempt: this.attempt,
        maxAttempts: max,
        nextDelayMs: delay,
        kind: "TRANSIENT",
        code: this._errorCode(),
        modelName: this._modelName(),
      });

      await this._sleep(delay);
      if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId)) return; // 已被取消/结算/手动终止

      this._emit({
        status: "reconnecting",
        phase: "sending",
        attempt: this.attempt,
        maxAttempts: max,
        kind: "TRANSIENT",
        modelName: this._modelName(),
      });

      const result = await this._sendAttempt();
      if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId) || result?.cancelled) return; // 已被取消/手动终止

      if (result.success) {
        this._succeed(false, null);
        return;
      }

      if (isAbortError(result.error)) {
        this.cancel("user");
        return;
      }

      this.lastError = result.error || this.lastError;
      const kind = classifyModelError(result.error || this.lastError);
      if (kind === "ABORTED") {
        this.cancel("user");
        return;
      }
      if (kind === "PERMANENT") {
        // 重连过程中转为永久错误 → 升级为切换 (若开启) 或直接放弃
        if (cfg.switchOnPermanentError) {
          this._beginSwitch(this.lastError);
        } else {
          this._giveUp();
        }
        return;
      }
      // 瞬态 → 继续下一轮退避重连
    }

    if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId)) return;

    // 重连次数耗尽
    if (cfg.escalateToSwitchAfterReconnectExhausted) {
      this._beginSwitch(this.lastError);
    } else {
      this._giveUp();
    }
  }

  // ==========================================================================
  // 行为分支二：永久错误自动切换模型 (按白名单 MRU 顺序，单次遍历)
  // ==========================================================================

  _beginSwitch(error = null) {
    if (error) this.lastError = error;
    this.status = "switching";
    this.candidateIndex = -1;
    this._runSwitch();
  }

  async _runSwitch() {
    const cfg = configService.getModelFailoverConfig();
    const whitelist = configService.loadModelWhitelist() || [];

    // 候选 = 白名单 MRU 顺序，跳过当前失败的原模型 (去重防死循环)
    this.candidates = whitelist.filter(
      (m) => !this._sameModel(m, this.originalModel)
    );

    if (this.candidates.length === 0) {
      // 白名单仅 1 个模型：无候选可切，直接放弃
      this._giveUp(true);
      return;
    }

    for (this.candidateIndex = 0; this.candidateIndex < this.candidates.length; this.candidateIndex++) {
      if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return; // 已被取消/手动终止

      const candidate = this.candidates[this.candidateIndex];
      this._switchedCandidates = this.candidateIndex + 1;
      this.currentTemporaryModel = { provider: candidate.provider, modelId: candidate.id };

      // 临时切换 (仅 pi_set_model，绝不刷新 MRU / selectedModel)
      this._emit({
        status: "switching",
        phase: "switching_model",
        candidate,
        candidateIndex: this.candidateIndex,
        candidateTotal: this.candidates.length,
        modelName: candidate.name || candidate.id,
      });

      try {
        const switchedModel = await piClient.setModel(candidate.provider, candidate.id);
        // 防御：内核响应未含模型结构时，显式同步前端当前模型，确保重发命中候选模型
        if (!switchedModel || (!switchedModel.id && !switchedModel.modelId)) {
          piClient.currentModel = {
            id: candidate.id,
            provider: candidate.provider,
            name: candidate.name || candidate.id,
          };
        }
      } catch (e) {
        if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;
        // setModel 失败 → 继续下一候选
        this.lastError = { message: e?.toString?.() || String(e), raw: e, provider: candidate.provider, model: candidate.id };
        continue;
      }

      if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;

      // 重发相同输入
      this._emit({
        status: "switching",
        phase: "sending",
        candidate,
        candidateIndex: this.candidateIndex,
        candidateTotal: this.candidates.length,
        modelName: candidate.name || candidate.id,
      });

      const result = await this._sendAttempt();
      if (this.status !== "switching" || this.isTaskAborted(this.taskId) || result?.cancelled) return;

      if (result.success) {
        this._succeed(true, candidate);
        return;
      }

      if (isAbortError(result.error)) {
        this.cancel("user");
        return;
      }

      this.lastError = result.error || this.lastError;
      const kind = classifyModelError(result.error || this.lastError);
      if (kind === "ABORTED") {
        this.cancel("user");
        return;
      }

      if (kind === "TRANSIENT") {
        // 候选模型瞬态错误 → 小额重连预算，避免单个抖动模型阻塞整条流水线
        const budget = cfg.perCandidateReconnectBudget;
        for (let r = 0; r < budget; r++) {
          if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;
          const rDelay = this._backoffDelay(r + 1, cfg);
          this._emit({
            status: "reconnecting",
            phase: "waiting",
            attempt: r + 1,
            maxAttempts: budget,
            nextDelayMs: rDelay,
            kind: "TRANSIENT",
            candidate,
            candidateIndex: this.candidateIndex,
            candidateTotal: this.candidates.length,
            modelName: candidate.name || candidate.id,
          });
          await this._sleep(rDelay);
          if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;

          const r2 = await this._sendAttempt();
          if (this.status !== "switching" || this.isTaskAborted(this.taskId) || r2?.cancelled) return;
          if (r2.success) {
            this._succeed(true, candidate);
            return;
          }
          if (isAbortError(r2.error)) {
            this.cancel("user");
            return;
          }
          this.lastError = r2.error || this.lastError;
          const rKind = classifyModelError(r2.error || this.lastError);
          if (rKind === "ABORTED") {
            this.cancel("user");
            return;
          }
          if (rKind === "PERMANENT") break; // 永久 → 下一候选
        }
        // 预算耗尽 → 继续下一候选
      }
      // 永久错误 → 继续下一候选
    }

    if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;

    // 全部候选单次遍历仍失败 → 恢复原模型并放弃
    await this._restoreOriginalModel();
    this._giveUp();
  }

  // ==========================================================================
  // 结果结算与终态
  // ==========================================================================

  /**
   * 发送一轮重发尝试并等待结果 (由全局 agent-end/agent-error 结算)
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
      // 触发重发；若分发本身失败则视为本轮尝试失败
      Promise.resolve(this.hooks?.onResendAttempt?.(this.taskId)).catch((err) => {
        settle({
          success: false,
          error: { message: err?.toString?.() || String(err), raw: err, provider: this.currentTemporaryModel?.provider, model: this.currentTemporaryModel?.modelId },
        });
      });
    });
  }

  /**
   * 自愈成功：若为切换成功则临时切换转正常切换 (刷新 MRU 并持久化)
   */
  _succeed(switched, candidate) {
    this.status = "succeeded";
    if (switched && candidate) {
      // 临时切换 ➔ 正常切换：刷新「最新使用时间标识」并持久化 selectedModel
      configService.saveSelectedModel(candidate.provider, candidate.id);
    }
    this._emit({
      status: "succeeded",
      switched,
      modelName: candidate ? candidate.name || candidate.id : this._modelName(),
    });
    this.hooks?.onSuccess?.({
      switched,
      candidate,
      reconnectCount: this._reconnectCount,
    });
    // 终态清理 (保留 lastError/计数以备后续归档摘要，但释放活跃状态)
    this._clearTimer();
  }

  /**
   * 全部失败兜底：恢复原模型并交由 main.js 渲染既有错误卡 (附自愈摘要)
   */
  _giveUp(singleModelOnly = false) {
    this.status = "gave_up";
    this._clearTimer();
    const summary = {
      reconnectCount: this._reconnectCount,
      triedCandidates: this._switchedCandidates,
      singleModelOnly,
    };
    this._emit({ status: "gave_up", summary });
    this.hooks?.onGiveUp?.(this.lastError, summary);
    // 终态后重置 (下一次错误重新冷启动)
    const keepLastError = this.lastError;
    this._resetState();
    this.lastError = keepLastError;
  }

  /**
   * 立即终止一切待执行的退避定时器与切换流水线 (用户点击「⏹ 终止」或应用退出时调用)
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
   * 退避延迟：2s → 4s → 8s → 8s… (恒封顶 maxBackoffMs)
   * delay(attempt) = min(reconnectBackoffMs[attempt-1] ?? maxBackoffMs, maxBackoffMs)
   */
  _backoffDelay(attempt, cfg) {
    const seq = Array.isArray(cfg.reconnectBackoffMs) ? cfg.reconnectBackoffMs : [2000, 4000, 8000];
    const cap = cfg.maxBackoffMs || 8000;
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

  _sameModel(m, ref) {
    if (!m || !ref) return false;
    return (
      String(m.provider || "").toLowerCase() === String(ref.provider || "").toLowerCase() &&
      String(m.id || "").toLowerCase() === String(ref.modelId || "").toLowerCase()
    );
  }

  /**
   * 恢复原选中模型 (内核状态)：MRU 与 selectedModel 本就未变，无需回写
   */
  async _restoreOriginalModel() {
    try {
      if (this.originalModel?.provider && this.originalModel?.modelId) {
        await piClient.setModel(this.originalModel.provider, this.originalModel.modelId);
      }
    } catch (_) {
      // 静默：恢复失败不影响错误卡渲染
    }
    this.currentTemporaryModel = null;
  }

  _emit(payload) {
    this.dispatchEvent(new CustomEvent("failover-status", { detail: payload }));
  }

  _errorCode() {
    const raw = this.lastError?.raw;
    const str = String(raw?.errorMessage || raw?.error?.message || raw?.error || this.lastError?.message || "").toLowerCase();
    const digits = str.match(/\b(4\d\d|5\d\d)\b/);
    return digits ? digits[1] : "";
  }

  _modelName() {
    return this.lastError?.model || piClient.currentModel?.id || "当前模型";
  }
}

export const modelFailoverEngine = new ModelFailoverEngine();
