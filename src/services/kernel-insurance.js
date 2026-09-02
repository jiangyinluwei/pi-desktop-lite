/**
 * Pi 内核保险服务 (Kernel Insurance Service)
 * 
 * 全局后台检测 Pi 内核健康状态：
 * 1. 实时监听与周期性监控 Pi 内核状态；
 * 2. 捕获 "crashed" 崩溃状态后自动激活 5 次重连机制 (1/5 ~ 5/5)；
 * 3. 自愈成功 (ready) 自动清零计数并恢复正常展示；
 * 4. 若 5 次重连均失败，进入熔断状态并在左上角触发红色抖动小闪电与提醒文本。
 */

export class KernelInsuranceService extends EventTarget {
  constructor() {
    super();
    this.maxRetries = 5;
    this.retryDelayMs = 1500;
    this.retryCount = 0;
    this.state = "idle"; // "idle" | "reconnecting" | "failed"
    this.isReconnecting = false;
    this.lastError = "";
    this._piClient = null;
    this._watchdogTimer = null;
    this._isInitialized = false;
  }

  /**
   * 初始化并绑定 PiClient 与后台检测
   * @param {import("./pi-client.js").PiClient} piClient
   */
  init(piClient) {
    if (this._isInitialized) return;
    this._isInitialized = true;
    this._piClient = piClient;

    // 1. 监听状态变更事件
    this._piClient.addEventListener("status-change", (e) => {
      this.handleStatusChange(e.detail);
    });

    this._piClient.addEventListener("kernel-status-change", (e) => {
      if (!e.detail?.hasKernel) {
        this.reset();
      }
    });

    // 2. 启动后台周期性心跳探测 Watchdog (每 4 秒自检一次)
    this.startWatchdog();
  }

  /**
   * 启动后台心跳自检
   */
  startWatchdog() {
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    this._watchdogTimer = setInterval(async () => {
      if (!this._piClient || !this._piClient.hasKernel()) return;
      if (this.isReconnecting || this.state === "failed") return;

      try {
        const currentStatus = await this._piClient.getHostStatus();
        const statusStr = typeof currentStatus === "string" ? currentStatus : currentStatus?.status;
        if (statusStr === "crashed") {
          this.handleStatusChange(currentStatus);
        }
      } catch {
        // 静默探测
      }
    }, 4000);
  }

  /**
   * 处理内核状态流转
   * @param {Record<string, any>|string} payload
   */
  handleStatusChange(payload) {
    const status = typeof payload === "string" ? payload : payload?.status || "unknown";
    const errorMsg = payload?.error || "";
    if (errorMsg) this.lastError = errorMsg;

    // 若内核恢复为 ready，且此前处于重连中或失败态，自动重置自愈
    if (status === "ready") {
      if (this.state !== "idle" || this.retryCount > 0) {
        this.reset();
      }
      return;
    }

    // 若检测到 crashed，且未处于正在重连中且未被锁定在失败态
    if (status === "crashed") {
      if (!this._piClient || !this._piClient.hasKernel()) return;
      if (this.isReconnecting) return;
      if (this.state === "failed") return;

      // 启动 5 次自动重连流水线
      this.startAutoReconnect();
    }
  }

  /**
   * 启动 5 次自动重连流水线
   */
  async startAutoReconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    this.state = "reconnecting";
    this.retryCount = 0;

    console.warn("[KernelInsurance] Pi kernel crashed! Activating auto-reconnect insurance pipeline (max 5 retries)...");

    while (this.retryCount < this.maxRetries) {
      // 检查是否已被外部主动重置
      if (!this.isReconnecting) break;

      this.retryCount++;
      console.log(`[KernelInsurance] Attempting auto-reconnect (${this.retryCount}/${this.maxRetries})...`);

      this.dispatchEvent(
        new CustomEvent("state-change", {
          detail: {
            state: "reconnecting",
            retryCount: this.retryCount,
            maxRetries: this.maxRetries,
            error: this.lastError,
          },
        })
      );

      try {
        await this._piClient.restartHost();
      } catch (err) {
        console.warn(`[KernelInsurance] Reconnect attempt ${this.retryCount} failed:`, err);
        this.lastError = err?.message || String(err);
      }

      // 等待状态平稳或下一次重试保护间隔
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));

      // 检查重连后是否已就绪
      if (this._piClient.hostStatus === "ready") {
        console.log(`[KernelInsurance] Auto-reconnect succeeded on attempt ${this.retryCount}!`);
        this.reset();
        return true;
      }
    }

    // 5 次重试均失败，进入熔断状态并在左上角触发红色抖动小闪电与提示
    this.isReconnecting = false;
    this.state = "failed";
    console.error("[KernelInsurance] All 5 auto-reconnect attempts failed. Locking in crashed state.");

    this.dispatchEvent(
      new CustomEvent("state-change", {
        detail: {
          state: "failed",
          retryCount: this.retryCount,
          maxRetries: this.maxRetries,
          error: this.lastError || "内核崩溃，5次自动重连失败",
        },
      })
    );

    return false;
  }

  /**
   * 重置内核保险状态机
   */
  reset() {
    const wasNotIdle = this.state !== "idle" || this.retryCount > 0;
    this.state = "idle";
    this.retryCount = 0;
    this.isReconnecting = false;
    this.lastError = "";

    if (wasNotIdle) {
      this.dispatchEvent(
        new CustomEvent("state-change", {
          detail: {
            state: "idle",
            retryCount: 0,
            maxRetries: this.maxRetries,
          },
        })
      );
    }
  }

  /**
   * 用户或模块主动请求手动重试
   */
  async triggerManualRetry() {
    this.reset();
    return await this.startAutoReconnect();
  }

  /**
   * 销毁定时器
   */
  destroy() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
    this.reset();
  }
}

export const kernelInsurance = new KernelInsuranceService();
