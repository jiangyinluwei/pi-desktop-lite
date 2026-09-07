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

import { piClient, classifyModelError, isAbortError, isFatalCandidateError, extractErrorFingerprint, isSameModelError } from "./pi-client.js";
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
    this._heartbeatTimer = null;
    this._currentPhase = "";
    this._reconnectCount = 0; // 累计重连次数 (用于摘要)
    this._switchedCandidates = 0; // 累计尝试过的候选模型数 (用于摘要)
    this.firstErrorTimestamp = 0; // 首次同类错误时间戳 (120秒容忍判定基准)
    this.firstErrorFingerprint = ""; // 首次错误归一化指纹
    this.sameErrorCount = 0; // 连续相同错误累计计数
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

    const effProvider =
      detail?.provider ||
      configService.getSelectedModel()?.provider ||
      piClient.currentModel?.provider ||
      "";
    const effModel =
      detail?.model ||
      configService.getSelectedModel()?.modelId ||
      piClient.currentModel?.id ||
      "";

    this.kind = kind;
    this.taskId = tid || null;
    this.originalModel = {
      provider: effProvider,
      modelId: effModel,
    };
    this.lastError = detail;
    this.hooks = hooks;
    this._reconnectCount = 0;
    this._switchedCandidates = 0;
    this.firstErrorTimestamp = Date.now();
    this.firstErrorFingerprint = extractErrorFingerprint(detail);
    this.sameErrorCount = 1;

    if (kind === "TRANSIENT") {
      this.status = "reconnecting";
      this._runReconnect();
    } else {
      // PERMANENT (含 UNKNOWN 保守归永久) → 若为致命候选错误或存在备选则切换，否则若非致命单模型转重连
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
  // 行为分支一：瞬态错误自动重连 (2/4/8s 退避，持续 120s 同错超时判定)
  // ==========================================================================

  async _runReconnect() {
    const cfg = configService.getModelFailoverConfig();
    const sameErrorTimeoutMs = Number(cfg.sameErrorTimeoutMs) || 120000;
    const maxAttempts = Math.max(Number(cfg.maxReconnectAttempts) || 24, 30);

    // 确保首错指纹与时间戳已初始化
    if (!this.firstErrorTimestamp) {
      this.firstErrorTimestamp = Date.now();
    }
    if (!this.firstErrorFingerprint) {
      this.firstErrorFingerprint = extractErrorFingerprint(this.lastError);
    }
    if (!this.sameErrorCount) {
      this.sameErrorCount = 1;
    }

    // 启动每秒自愈心跳时钟（驱动已持续时间动态递增刷新，并提供 120s 硬性超时熔断防护）
    this._startHeartbeat(cfg);

    while (this.status === "reconnecting") {
      if (this.isTaskAborted(this.taskId)) {
        this._stopHeartbeat();
        return;
      }

      // 检查当前持续同一错误是否已超过 120 秒判定窗口
      const elapsedSinceFirstError = Date.now() - this.firstErrorTimestamp;
      if (this.sameErrorCount > 1 && elapsedSinceFirstError >= sameErrorTimeoutMs) {
        console.warn(
          `[ModelFailover] 同一错误已持续 ${Math.round(elapsedSinceFirstError / 1000)}s (超过 ${Math.round(sameErrorTimeoutMs / 1000)}s 判定时间)，终止任务并弹出报错`
        );
        this._stopHeartbeat();
        this._giveUp();
        return;
      }

      this.attempt++;
      this._reconnectCount = this.attempt;
      const delay = this._backoffDelay(this.attempt, cfg);
      const isRateLimit =
        isSameModelError(this.lastError, "tpm") ||
        isSameModelError(this.lastError, "rpm") ||
        isSameModelError(this.lastError, "rate_limit");

      this._currentPhase = "waiting";
      this._emit({
        status: "reconnecting",
        phase: "waiting",
        attempt: this.attempt,
        maxAttempts: maxAttempts,
        nextDelayMs: delay,
        kind: "TRANSIENT",
        code: this._errorCode(),
        modelName: this._modelName(),
        elapsedSecs: Math.floor(elapsedSinceFirstError / 1000),
        timeoutSecs: Math.round(sameErrorTimeoutMs / 1000),
        isRateLimit,
        isSameError: true,
      });

      await this._sleep(delay);
      if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId)) {
        this._stopHeartbeat();
        return;
      }

      this._currentPhase = "sending";
      this._emit({
        status: "reconnecting",
        phase: "sending",
        attempt: this.attempt,
        maxAttempts: maxAttempts,
        kind: "TRANSIENT",
        modelName: this._modelName(),
        elapsedSecs: Math.floor((Date.now() - this.firstErrorTimestamp) / 1000),
        timeoutSecs: Math.round(sameErrorTimeoutMs / 1000),
        isRateLimit,
        isSameError: true,
      });

      const result = await this._sendAttempt();
      if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId) || result?.cancelled) {
        this._stopHeartbeat();
        return;
      }

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

      // 核心判定：比对当前错误与首次错误是否为「同样的错」
      const isSame = isSameModelError(result.error || this.lastError, this.firstErrorFingerprint);
      const currentElapsed = Date.now() - this.firstErrorTimestamp;

      if (isSame) {
        this.sameErrorCount++;
        // 若持续报同样的错，且已达到 120 秒判定时间：真正弹出报错并终止任务
        if (currentElapsed >= sameErrorTimeoutMs) {
          console.warn(
            `[ModelFailover] 模型持续报相同错误达到 ${Math.round(currentElapsed / 1000)}s (≥ ${Math.round(sameErrorTimeoutMs / 1000)}s)，终止任务并弹出报错`
          );
          this._giveUp();
          return;
        }
        // 持续时间未满 120 秒：继续重连，绝不提前报错失败！
        continue;
      } else {
        // 模型报出了不同的错误：
        // 判定新错误是否为不可自愈的致命候选错误 (如 401 密钥失效)
        if (isFatalCandidateError(result.error || this.lastError)) {
          if (cfg.switchOnPermanentError) {
            this._beginSwitch(this.lastError);
          } else {
            this._giveUp();
          }
          return;
        }
        // 若为非致命错误，重置判定基准为新错误，重新计算 120 秒判定容忍窗口
        this.firstErrorTimestamp = Date.now();
        this.firstErrorFingerprint = extractErrorFingerprint(result.error || this.lastError);
        this.sameErrorCount = 1;
        continue;
      }
    }

    if (this.status !== "reconnecting" || this.isTaskAborted(this.taskId)) return;

    this._giveUp();
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

  /**
   * 智能汇总与排重候选模型：优先白名单 MRU 顺序，必要时从内核可用模型补齐
   * @returns {Promise<Array<any>>}
   */
  async _resolveCandidates() {
    const whitelist = configService.loadModelWhitelist() || [];

    // 第一优先级：白名单 MRU 顺序，跳过当前失败的原模型 (彻底去重)
    let candidates = whitelist.filter((m) => !this._sameModel(m, this.originalModel));

    // 第二优先级（智能补齐）：若白名单候选不足 3 个，尝试从内核已配置模型中补充可用候选
    if (candidates.length < 3) {
      try {
        const available = await piClient.getAvailableModels();
        if (Array.isArray(available) && available.length > 0) {
          for (const m of available) {
            if (!m || (!m.id && !m.modelId)) continue;
            const isOriginal = this._sameModel(m, this.originalModel);
            const alreadyInList = candidates.some((c) => this._sameModel(c, m));
            if (!isOriginal && !alreadyInList) {
              candidates.push({
                id: m.id || m.modelId,
                name: m.name || m.id || m.modelId,
                provider: m.provider || "",
                contextWindow: m.contextWindow || 64000,
                maxTokens: m.maxTokens || 4096,
                reasoning: !!m.reasoning,
                isCustom: !!m.isCustom,
              });
              if (candidates.length >= 6) break;
            }
          }
        }
      } catch (_) {}
    }

    return candidates;
  }

  async _runSwitch() {
    const cfg = configService.getModelFailoverConfig();
    const maxCycles = Math.max(1, Number(cfg.maxSwitchCycles) || 3);
    const maxTotalAttempts = Math.max(1, Number(cfg.maxTotalSwitchAttempts) || 12);
    const switchBackoffSeq = Array.isArray(cfg.switchBackoffMs)
      ? cfg.switchBackoffMs
      : [1500, 3000, 6000];

    // 启动每秒自愈心跳时钟
    this._startHeartbeat(cfg);

    // 解析候选列表（白名单优先 + 智能补齐）
    this.candidates = await this._resolveCandidates();

    if (this.candidates.length === 0) {
      // 若无备选模型可切，但当前错误并非不可自愈的致命候选错误（例如 401 密钥失效），
      // 则降级转入同模型重连自愈通道，给予 120 秒同错容忍判定窗口，绝不 0 秒草率放弃！
      if (!isFatalCandidateError(this.lastError)) {
        this.status = "reconnecting";
        this._runReconnect();
        return;
      }
      // 白名单或可用模型中无有效候选可切，且为致命错误，直接放弃
      this._giveUp(true);
      return;
    }

    let totalAttempts = 0;
    const unusableCandidates = new Set(); // 记录已确认致命且不可恢复的候选（如 401 密钥失效）

    // 多轮巡检轮换：支持最多 maxCycles 轮，候选与轮次间带平滑退避延时
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;

      // 剔除已被证实致命不可用的候选
      const activeCandidates = this.candidates.filter(
        (c) => !unusableCandidates.has(this._modelKey(c))
      );

      if (activeCandidates.length === 0) {
        // 所有候选均已证实致命不可用，提前结束轮巡
        break;
      }

      for (let i = 0; i < activeCandidates.length; i++) {
        if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;
        if (totalAttempts >= maxTotalAttempts) break;

        const candidate = activeCandidates[i];
        this.candidateIndex = i;
        totalAttempts++;
        this._switchedCandidates = totalAttempts;
        this.currentTemporaryModel = { provider: candidate.provider, modelId: candidate.id };

        // 临时切换模型 (仅 pi_set_model，绝不刷新 MRU / selectedModel)
        this._emit({
          status: "switching",
          phase: "switching_model",
          candidate,
          cycle,
          maxCycles,
          candidateIndex: i,
          candidateTotal: activeCandidates.length,
          totalAttempt: totalAttempts,
          maxTotalAttempts,
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
          this.lastError = { message: e?.toString?.() || String(e), raw: e, provider: candidate.provider, model: candidate.id };
          if (isFatalCandidateError(this.lastError)) {
            unusableCandidates.add(this._modelKey(candidate));
          }
          continue;
        }

        if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;

        // 重发相同输入
        this._emit({
          status: "switching",
          phase: "sending",
          candidate,
          cycle,
          maxCycles,
          candidateIndex: i,
          candidateTotal: activeCandidates.length,
          totalAttempt: totalAttempts,
          maxTotalAttempts,
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

        // 判定是否记录为致命不可恢复模型（401/404/invalid_key 等）
        if (isFatalCandidateError(result.error || this.lastError)) {
          unusableCandidates.add(this._modelKey(candidate));
        }

        if (kind === "TRANSIENT") {
          // 候选模型瞬态错误 → 小额重连预算，避免单个抖动模型阻塞整条流水线
          const budget = cfg.perCandidateReconnectBudget || 2;
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
              cycle,
              maxCycles,
              candidateIndex: i,
              candidateTotal: activeCandidates.length,
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
            if (isFatalCandidateError(r2.error || this.lastError)) {
              unusableCandidates.add(this._modelKey(candidate));
              break;
            }
            if (rKind === "PERMANENT") break; // 永久错误 → 结束当前候选的小额瞬态重试
          }
        }

        // 候选切换间施加平滑退避，避免并发雪崩并给予服务端缓冲
        if (totalAttempts < maxTotalAttempts && (i < activeCandidates.length - 1 || cycle < maxCycles)) {
          const delayIndex = Math.min(cycle - 1, switchBackoffSeq.length - 1);
          const switchDelay = switchBackoffSeq[delayIndex] || 1500;
          this._emit({
            status: "switching",
            phase: "waiting",
            nextDelayMs: switchDelay,
            cycle,
            maxCycles,
            candidateIndex: i,
            candidateTotal: activeCandidates.length,
            totalAttempt: totalAttempts,
            maxTotalAttempts,
            modelName: candidate.name || candidate.id,
          });
          await this._sleep(switchDelay);
        }
      }

      if (totalAttempts >= maxTotalAttempts) break;
    }

    if (this.status !== "switching" || this.isTaskAborted(this.taskId)) return;

    // 全部候选轮次遍历仍失败 → 恢复原模型并放弃
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
   * 启动每秒自愈心跳定时器（驱动已持续时间动态递增刷新，并在持续同错达到 120s 时主动超时熔断）
   * @param {Record<string, any>} [cfg]
   */
  _startHeartbeat(cfg = null) {
    this._stopHeartbeat();
    const config = cfg || configService.getModelFailoverConfig();
    const sameErrorTimeoutMs = Number(config?.sameErrorTimeoutMs) || 120000;
    const sameErrorTimeoutSecs = Math.round(sameErrorTimeoutMs / 1000);

    this._heartbeatTimer = setInterval(() => {
      if (!this.isActive() || this.isTaskAborted(this.taskId)) {
        this._stopHeartbeat();
        return;
      }

      const elapsedMs = this.firstErrorTimestamp ? Date.now() - this.firstErrorTimestamp : 0;
      const elapsedSecs = Math.floor(elapsedMs / 1000);

      // 120 秒硬性超时熔断判定 (独立于在途 await _sendAttempt 请求，杜绝假死挂起)
      if (this.firstErrorTimestamp && elapsedMs >= sameErrorTimeoutMs) {
        console.warn(
          `[ModelFailover] 持续同类错误已达到 ${elapsedSecs}s (超过 ${sameErrorTimeoutSecs}s 判定阈值)，超时熔断并弹出报错`
        );
        this._stopHeartbeat();
        if (this._resolveAttempt) {
          this._resolveAttempt({
            success: false,
            error: this.lastError || { message: "模型调用持续发生异常已达到 120 秒超时判定阈值" },
          });
        }
        this._giveUp();
        return;
      }

      // 动态向前端派发心跳事件，确保已持续秒数每秒实时递增刷新
      const isRateLimit =
        isSameModelError(this.lastError, "tpm") ||
        isSameModelError(this.lastError, "rpm") ||
        isSameModelError(this.lastError, "rate_limit");

      this._emit({
        status: this.status,
        phase: this._currentPhase || "sending",
        attempt: this.attempt,
        maxAttempts: Math.max(Number(config?.maxReconnectAttempts) || 24, 30),
        kind: "TRANSIENT",
        modelName: this._modelName(),
        elapsedSecs,
        timeoutSecs: sameErrorTimeoutSecs,
        isRateLimit,
        isSameError: true,
      });
    }, 1000);
  }

  /**
   * 停止每秒自愈心跳时钟
   */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * 重置引擎全部状态与时间累计（在成功自愈、终态放弃、取消或新轮次发起时调用）
   */
  _resetState() {
    this._clearTimer();
    this._stopHeartbeat();
    this._currentPhase = "";
    this.status = "idle";
    this.attempt = 0;
    this._reconnectCount = 0;
    this._switchedCandidates = 0;
    this.candidates = [];
    this.currentCandidateIndex = -1;
    this.currentTemporaryModel = null;
    this.originalModel = null;
    this.lastError = null;
    this.hooks = null;
    this.firstErrorTimestamp = 0;
    this.firstErrorFingerprint = "";
    this.sameErrorCount = 0;
    this._resolveAttempt = null;
  }

  /**
   * 外部显式重置接口 (新轮次发起时安全重置)
   */
  reset() {
    this._resetState();
  }

  /**
   * 自愈成功：若为切换成功则临时切换转正常切换 (刷新 MRU 并持久化)
   */
  _succeed(switched, candidate) {
    const isRateLimit =
      isSameModelError(this.lastError, "tpm") ||
      isSameModelError(this.lastError, "rpm") ||
      isSameModelError(this.lastError, "rate_limit");

    this.status = "succeeded";
    if (switched && candidate) {
      // 临时切换 ➔ 正常切换：刷新「最新使用时间标识」并持久化 selectedModel
      configService.saveSelectedModel(candidate.provider, candidate.id);
    }
    this._emit({
      status: "succeeded",
      switched,
      isRateLimit,
      modelName: candidate ? candidate.name || candidate.id : this._modelName(),
    });
    this.hooks?.onSuccess?.({
      switched,
      candidate,
      isRateLimit,
      reconnectCount: this._reconnectCount,
    });
    // 成功后彻底清空原本的时间累计与错误状态，确保下次限流从 0s 重新累计
    this._resetState();
  }

  /**
   * 全部失败兜底：恢复原模型并交由 main.js 渲染既有错误卡 (附自愈摘要)
   */
  _giveUp(singleModelOnly = false) {
    this.status = "gave_up";
    this._clearTimer();
    const sameErrorDurationSecs = this.firstErrorTimestamp
      ? Math.round((Date.now() - this.firstErrorTimestamp) / 1000)
      : 0;
    const summary = {
      reconnectCount: this._reconnectCount,
      triedCandidates: this._switchedCandidates,
      sameErrorDurationSecs,
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

  _modelKey(c) {
    if (!c) return "";
    return `${String(c.provider || "").toLowerCase().trim()}:${String(c.id || c.modelId || "").toLowerCase().trim()}`;
  }

  _sameModel(m, ref) {
    if (!m || !ref) return false;
    const mProvider = String(m.provider || "").toLowerCase().trim();
    const refProvider = String(ref.provider || "").toLowerCase().trim();
    const mId = String(m.id || m.modelId || "").toLowerCase().trim();
    const refId = String(ref.modelId || ref.id || "").toLowerCase().trim();

    if (!mId || !refId) return false;

    // 1. 若双方都有明确的 provider 且不同，则非同一模型
    if (mProvider && refProvider && mProvider !== refProvider) {
      return false;
    }

    // 2. 直接完全相等
    if (mId === refId) {
      return true;
    }

    // 3. 剥离可能内含的 provider/ 前缀比对（例如 "openai/gpt-4o" vs "gpt-4o"）
    const strip = (str, prov) => {
      if (!str) return "";
      if (prov && str.startsWith(`${prov}/`)) return str.slice(prov.length + 1);
      const slash = str.indexOf("/");
      return slash !== -1 ? str.slice(slash + 1) : str;
    };

    const cleanM = strip(mId, mProvider);
    const cleanRef = strip(refId, refProvider);

    return Boolean(cleanM && cleanRef && cleanM === cleanRef);
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
