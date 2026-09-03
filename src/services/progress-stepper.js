/**
 * 进度条平滑步进引擎 (ProgressStepper)
 * 
 * 核心机制：
 * 1. 当进入某个阶段百分比（如 15%）时，立即跳至该百分比；
 * 2. 在当前阶段等待期间，每隔 intervalMs（默认 2000ms）自动步进 +1%；
 * 3. 步进上限为 (下一个阶段目标百分比 - 1)%，如阶段为 15%、下个阶段为 35% 时，最多步进至 34% 停止；
 * 4. 触发下个真实阶段后（如 35%），立即跳至 35%，并以该阶段继续平滑步进；
 * 5. 任务到达 100% 或终态 (completed / uninstalled / error / cancelled) 时立即停止定时器并呈现对应终态。
 */
export class ProgressStepper {
  /**
   * @param {Object} options
   * @param {number[]} [options.milestones=[0, 100]] - 预定义的阶段里程碑百分比列表 (升序)
   * @param {number} [options.intervalMs=2000] - 伪百分比增长步进时间间隔 (毫秒)
   * @param {function(number, any): void} options.onUpdate - 每次百分比发生变化时的回调 (currentPercent, payload)
   */
  constructor({ milestones = [0, 100], intervalMs = 2000, onUpdate } = {}) {
    this.milestones = this._cleanMilestones(milestones);
    this.intervalMs = intervalMs;
    this.onUpdate = onUpdate;
    this.currentPercent = 0;
    this.targetNext = 100;
    this.timer = null;
    this.currentPayload = null;
  }

  _cleanMilestones(milestones) {
    const list = Array.isArray(milestones) ? milestones : [0, 100];
    return Array.from(
      new Set(list.map((m) => Math.min(100, Math.max(0, Math.round(Number(m) || 0)))))
    ).sort((a, b) => a - b);
  }

  setMilestones(milestones) {
    this.milestones = this._cleanMilestones(milestones);
  }

  getNextMilestone(pct) {
    for (const m of this.milestones) {
      if (m > pct) return m;
    }
    return 100;
  }

  /**
   * 触发阶段更新
   * @param {number} realPercent - 后端或真实触发的百分比
   * @param {any} [payload=null] - 附加阶段信息（如 stage, message 等）
   * @param {number|null} [customNextMilestone=null] - 可选的自定义下个阶段上限
   */
  step(realPercent, payload = null, customNextMilestone = null) {
    this.stopTimer();

    const cleanPct = Math.min(100, Math.max(0, Math.round(Number(realPercent) || 0)));
    this.currentPercent = cleanPct;
    this.currentPayload = payload;

    // 立即跳至真实阶段百分比
    if (this.onUpdate) {
      try {
        this.onUpdate(this.currentPercent, this.currentPayload);
      } catch (err) {
        console.error("[ProgressStepper] onUpdate error:", err);
      }
    }

    // 若已经达到 100% 或终态，不再启动伪百分比步进
    if (this.currentPercent >= 100) {
      return;
    }

    this.targetNext =
      customNextMilestone !== null && customNextMilestone > this.currentPercent
        ? Math.min(100, Math.round(customNextMilestone))
        : this.getNextMilestone(this.currentPercent);

    // 最大步进伪百分比为 (下一个阶段 - 1)%
    const maxPseudo = Math.max(this.currentPercent, this.targetNext - 1);

    if (this.currentPercent < maxPseudo) {
      this.startTimer(maxPseudo);
    }
  }

  startTimer(maxPseudo) {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.currentPercent < maxPseudo) {
        this.currentPercent += 1;
        if (this.onUpdate) {
          try {
            this.onUpdate(this.currentPercent, this.currentPayload);
          } catch (err) {
            console.error("[ProgressStepper] ticker onUpdate error:", err);
          }
        }
      } else {
        this.stopTimer();
      }
    }, this.intervalMs);
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reset() {
    this.stopTimer();
    this.currentPercent = 0;
    this.targetNext = 100;
    this.currentPayload = null;
  }
}
