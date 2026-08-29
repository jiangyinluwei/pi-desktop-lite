// ==========================================================================
// Windows 系统通知与多任务并行调度服务 (NotificationService)
// 1. 严格失焦判定：仅在软件失去焦点 (Blur / Background) 时才触发通知，聚焦操作时绝不打扰；
// 2. 状态分发铁律：
//    - "需要人工回归": 立即弹出 Windows 原生通知 (带默认提示音)；
//    - "报错终止": 立即弹出 Windows 原生通知；
//    - "输出完成": 并行调度检查，若仍有其他任务运行则暂不通知，当全部任务完成时弹出通知。
// ==========================================================================

import { invokeTauri } from "./tauri-bridge.js";

export class NotificationService {
  constructor() {
    this._isFocused = typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : true;
    this._activeTasks = new Map();
    this._unlistenFocus = null;

    this.initFocusListeners();
  }

  /**
   * 初始化全方位窗口焦点监听器（Web 标准事件 + Tauri 原生窗口焦点事件）
   */
  async initFocusListeners() {
    if (typeof window === "undefined") return;

    // 1. Web 标准焦点事件
    window.addEventListener("focus", () => {
      this._isFocused = true;
    });

    window.addEventListener("blur", () => {
      this._isFocused = false;
    });

    // 2. 页面可见性事件
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this._isFocused = false;
      } else if (typeof document.hasFocus === "function") {
        this._isFocused = document.hasFocus();
      } else {
        this._isFocused = true;
      }
    });

    // 3. Tauri 底层窗口焦点事件双重保障
    if (window.__TAURI__?.event?.listen) {
      try {
        this._unlistenFocus = await window.__TAURI__.event.listen(
          "window-focus-change",
          (event) => {
            this._isFocused = Boolean(event.payload);
          }
        );
      } catch (err) {
        console.warn("[NotificationService] Failed to bind window-focus-change:", err);
      }
    }
  }

  /**
   * 判断当前软件是否处于焦点状态
   * 严格标准：必须页面非隐藏且同时满足焦点状态
   * @returns {boolean}
   */
  isWindowFocused() {
    if (typeof document !== "undefined") {
      if (document.hidden) return false;
      if (typeof document.hasFocus === "function") {
        return Boolean(this._isFocused && document.hasFocus());
      }
    }
    return Boolean(this._isFocused);
  }

  /**
   * 注册正在运行中的异步/后台任务
   * @param {string} taskId 任务唯一标识 (如 'agent', 'package-queue', 'kernel-update')
   * @param {Record<string, any>} [meta={}] 任务元数据
   */
  registerTask(taskId, meta = {}) {
    if (!taskId) return;
    this._activeTasks.set(taskId, {
      id: taskId,
      startedAt: Date.now(),
      ...meta,
    });
  }

  /**
   * 注销已完成或中止的任务
   * @param {string} taskId
   * @returns {boolean} 是否注销成功
   */
  unregisterTask(taskId) {
    if (!taskId) return false;
    return this._activeTasks.delete(taskId);
  }

  /**
   * 检查某个任务是否正在运行
   * @param {string} taskId
   * @returns {boolean}
   */
  isTaskRunning(taskId) {
    return this._activeTasks.has(taskId);
  }

  /**
   * 检查是否仍有其他任务在运行中
   * @param {string} [excludeTaskId=null] 排除指定的任务 ID
   * @returns {boolean}
   */
  hasRunningTasks(excludeTaskId = null) {
    if (!excludeTaskId) {
      return this._activeTasks.size > 0;
    }
    for (const [id] of this._activeTasks) {
      if (id !== excludeTaskId) return true;
    }
    return false;
  }

  /**
   * 获取当前运行中的任务总数
   * @returns {number}
   */
  getRunningTaskCount() {
    return this._activeTasks.size;
  }

  /**
   * 底层发送 Windows 系统 Toast 原生通知 (带默认提示音)
   * 仅在当前软件失去焦点时才会下发
   * @param {string} title 通知标题
   * @param {string} body 通知内容
   * @returns {Promise<boolean>} 是否成功下发通知
   */
  async showSystemToast(title, body) {
    // 铁律：处于焦点状态绝不打扰
    if (this.isWindowFocused()) {
      return false;
    }

    try {
      await invokeTauri("pi_show_notification", {
        title: title || "pi-dl",
        body: body || "",
      });
      return true;
    } catch (err) {
      console.warn("[NotificationService] Failed to show system notification:", err);
      return false;
    }
  }

  /**
   * 触发「需要人工回归/介入」通知 (立即通知，不等待其他任务)
   * @param {{ title?: string, message?: string }} [options={}]
   * @returns {Promise<boolean>}
   */
  async notifyHumanIntervention(options = {}) {
    const title = options.title || "pi-dl";
    const body = options.message || "模型需要人工介入或确认操作，请返回查看。";
    return await this.showSystemToast(title, body);
  }

  /**
   * 触发「报错终止/异常中断」通知 (立即通知，不等待其他任务)
   * @param {{ title?: string, message?: string, taskId?: string }} [options={}]
   * @returns {Promise<boolean>}
   */
  async notifyError(options = {}) {
    if (options.taskId) {
      this.unregisterTask(options.taskId);
    }
    const title = options.title || "pi-dl";
    const body = options.message || "任务执行发生异常已终止，请返回查看详情。";
    return await this.showSystemToast(title, body);
  }

  /**
   * 触发「输出完成」通知 (多任务并行调度：全部完成后才通知)
   * @param {{ title?: string, message?: string, taskId?: string }} [options={}]
   * @returns {Promise<boolean>}
   */
  async notifyAgentCompleted(options = {}) {
    const taskId = options.taskId || "agent";
    this.unregisterTask(taskId);

    // 检查是否仍有其他任务正在并行运行
    if (this.hasRunningTasks()) {
      // 仍有其他任务在运行，保持静默，等待所有任务全部完成
      return false;
    }

    // 所有任务全部完成，且软件失焦，弹出完成通知
    const title = options.title || "pi-dl";
    const body = options.message || "所有任务已全部处理完成。";
    return await this.showSystemToast(title, body);
  }

  /**
   * 当非 Agent 任务（如包管理器队列、内核升级）结束时，检查是否所有任务均已完成并分发通知
   * @param {{ title?: string, message?: string, taskId?: string }} [options={}]
   * @returns {Promise<boolean>}
   */
  async notifyIfAllCompleted(options = {}) {
    if (options.taskId) {
      this.unregisterTask(options.taskId);
    }

    if (this.hasRunningTasks()) {
      return false;
    }

    const title = options.title || "pi-dl";
    const body = options.message || "所有任务已全部处理完成。";
    return await this.showSystemToast(title, body);
  }

  /**
   * 销毁服务并移除监听
   */
  destroy() {
    if (typeof this._unlistenFocus === "function") {
      try {
        this._unlistenFocus();
      } catch (_) {}
      this._unlistenFocus = null;
    }
    this._activeTasks.clear();
  }
}

export const notificationService = new NotificationService();
