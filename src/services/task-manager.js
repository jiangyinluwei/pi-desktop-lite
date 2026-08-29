/**
 * 前端任务管理器 (task-manager.js)
 * 负责多任务（Task）生命周期状态机、事件增量缓冲队列、前后台任务切换与增量重放 (Batch Delta Catch-up)
 */

import { piClient, parseErrorMessage } from "./pi-client.js";
import { notificationService } from "./notification-service.js";

/**
 * @typedef {Object} TaskItem
 * @property {string} id 任务唯一 ID (如 task_1700000000000)
 * @property {string} title 提问文本截断摘要 (最多 24 字符)
 * @property {string} query 完整提问内容
 * @property {Array<any>} attachments 附带的文件概述胶囊
 * @property {string} model 使用的模型 ID 或显示名称
 * @property {string} provider 服务商 (如 anthropic, openai)
 * @property {'thinking' | 'streaming' | 'tool_exec' | 'completed' | 'error' | 'aborted'} status 运行状态
 * @property {number} startedAt 开始时间戳
 * @property {number | null} completedAt 完成时间戳
 * @property {string} thinkingText 累积的思考过程文本
 * @property {string} responseText 累积的回答 Markdown 文本
 * @property {Array<{ id: string, name: string, args: any, status: string, html?: string }>} toolCalls 工具调用记录
 * @property {string | null} activeToolName 当前正在执行的工具名称
 * @property {string} thinkingDurationText 思考耗时描述
 * @property {Array<any>} events 增量事件缓冲队列 (用于无感重播与还原)
 * @property {boolean} hasUnread 是否包含未读完结状态
 * @property {string | null} errorMessage 报错信息
 */

export class TaskManager extends EventTarget {
  constructor() {
    super();
    /** @type {Map<string, TaskItem>} */
    this.tasks = new Map();
    /** @type {string | null} */
    this.currentActiveTaskId = null;
    this.maxConcurrent = 3;

    this.initClientListeners();
  }

  /**
   * 生成简洁的标题摘要 (<= 24 字符)
   * @param {string} text
   * @returns {string}
   */
  _generateTitle(text) {
    if (!text || typeof text !== "string") return "未命名任务";
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= 24) return clean;
    return clean.slice(0, 22) + "...";
  }

  /**
   * 创建并注册新 Task 实例（默认为前台正常 Flow，isSuspended 为 false）
   * @param {Object} options
   * @param {string} [options.id]
   * @param {string} options.query
   * @param {Array<any>} [options.attachments=[]]
   * @param {string} [options.model=""]
   * @param {string} [options.provider=""]
   * @param {boolean} [options.isSuspended=false]
   * @returns {TaskItem}
   */
  createTask({ id, query, attachments = [], model = "", provider = "", isSuspended = false }) {
    const taskId = id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const title = this._generateTitle(query) || (attachments.length > 0 ? `[附带 ${attachments.length} 个文件]` : "新对话任务");

    /** @type {TaskItem} */
    const task = {
      id: taskId,
      title,
      query: query || "",
      attachments: [...attachments],
      model: model || piClient.currentModel?.name || piClient.currentModel?.id || "default",
      provider: provider || piClient.currentModel?.provider || "anthropic",
      status: "thinking",
      isSuspended: Boolean(isSuspended),
      startedAt: Date.now(),
      completedAt: null,
      thinkingText: "",
      responseText: "",
      toolCalls: [],
      activeToolName: null,
      thinkingDurationText: "思考中...",
      events: [],
      hasUnread: false,
      errorMessage: null,
    };

    this.tasks.set(taskId, task);
    this.currentActiveTaskId = taskId;

    // 注册到系统通知服务
    notificationService.registerTask(taskId, {
      title: task.title,
      query: task.query,
      type: "agent",
    });

    this.dispatchEvent(new CustomEvent("task-created", { detail: task }));
    this.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: this.getAllTasks() } }));

    return task;
  }

  /**
   * 获取指定 Task
   * @param {string} taskId
   * @returns {TaskItem | undefined}
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  /**
   * 获取当前前台活跃的 Task
   * @returns {TaskItem | null}
   */
  getCurrentActiveTask() {
    if (!this.currentActiveTaskId) return null;
    return this.tasks.get(this.currentActiveTaskId) || null;
  }

  /**
   * 设置当前前台活跃 Task
   * @param {string | null} taskId
   */
  setActiveTask(taskId) {
    this.currentActiveTaskId = taskId;
    if (taskId && this.tasks.has(taskId)) {
      const task = this.tasks.get(taskId);
      task.hasUnread = false;
      task.isSuspended = false; // 进入前台 Flow
    }
    this.dispatchEvent(new CustomEvent("active-task-changed", { detail: { taskId } }));
    this.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: this.getAllTasks() } }));
  }

  /**
   * 获取所有活跃中（思考、流式、工具执行）的任务
   * @returns {Array<TaskItem>}
   */
  getActiveTasks() {
    const active = [];
    for (const task of this.tasks.values()) {
      if (task.status === "thinking" || task.status === "streaming" || task.status === "tool_exec") {
        active.push(task);
      }
    }
    return active.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * 获取所有被转入后台挂起的任务（仅挂起任务展示在 Mini 胶囊与侧边栏）
   * @returns {Array<TaskItem>}
   */
  getSuspendedTasks() {
    return Array.from(this.tasks.values())
      .filter((t) => t.isSuspended)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * 获取正在后台活跃运行的挂起任务
   * @returns {Array<TaskItem>}
   */
  getActiveSuspendedTasks() {
    return this.getSuspendedTasks().filter(
      (t) => t.status === "thinking" || t.status === "streaming" || t.status === "tool_exec"
    );
  }

  /**
   * 获取所有任务列表 (按创建时间逆序)
   * @returns {Array<TaskItem>}
   */
  getAllTasks() {
    return Array.from(this.tasks.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * 获取挂起任务中的已完成数量
   * @returns {number}
   */
  getCompletedSuspendedCount() {
    let count = 0;
    for (const task of this.getSuspendedTasks()) {
      if (task.status === "completed" || task.status === "aborted" || task.status === "error") {
        count += 1;
      }
    }
    return count;
  }

  /**
   * 获取挂起任务总数
   * @returns {number}
   */
  getTotalSuspendedCount() {
    return this.getSuspendedTasks().length;
  }

  /**
   * 将当前 Flow 转入后台挂起 (isSuspended = true)
   * @returns {TaskItem | null}
   */
  suspendCurrentFlow() {
    const current = this.getCurrentActiveTask();
    if (current) {
      current.isSuspended = true;
    }
    this.currentActiveTaskId = null;
    this.dispatchEvent(new CustomEvent("flow-suspended", { detail: current }));
    this.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: this.getAllTasks() } }));
    return current;
  }

  /**
   * 中止指定 Task
   * @param {string} taskId
   */
  async abortTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "aborted";
    task.completedAt = Date.now();
    notificationService.unregisterTask(taskId);

    try {
      await piClient.abort(taskId);
    } catch (err) {
      console.warn(`[TaskManager] Failed to abort task ${taskId}:`, err);
    }

    this.dispatchEvent(new CustomEvent("task-aborted", { detail: task }));
    this.dispatchEvent(new CustomEvent("task-updated", { detail: task }));
    this.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: this.getAllTasks() } }));
  }

  /**
   * 移除/删除任务记录并释放子进程资源
   * @param {string} taskId
   */
  async removeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.status === "thinking" || task.status === "streaming" || task.status === "tool_exec") {
      try {
        await piClient.abort(taskId);
        await piClient.destroyTask(taskId);
      } catch (_) {}
    } else {
      try {
        await piClient.destroyTask(taskId);
      } catch (_) {}
    }

    notificationService.unregisterTask(taskId);
    this.tasks.delete(taskId);

    if (this.currentActiveTaskId === taskId) {
      this.currentActiveTaskId = null;
    }

    this.dispatchEvent(new CustomEvent("task-removed", { detail: { taskId } }));
    this.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: this.getAllTasks() } }));
  }

  /**
   * 初始化与 PiClient 事件流的双向绑定
   */
  initClientListeners() {
    piClient.addEventListener("raw-event", (e) => {
      const data = e.detail;
      if (!data) return;

      const taskId = data.task_id || data.taskId || this.currentActiveTaskId;
      if (!taskId || !this.tasks.has(taskId)) return;

      this.handleTaskEvent(taskId, data);
    });

    piClient.addEventListener("agent-error", (e) => {
      const detail = e.detail || {};
      const taskId = detail.task_id || detail.taskId || this.currentActiveTaskId;
      if (!taskId || !this.tasks.has(taskId)) return;

      const task = this.tasks.get(taskId);
      task.status = "error";
      task.completedAt = Date.now();
      task.errorMessage = detail.message || "模型调用发生异常";

      notificationService.notifyError({
        title: "pi-dl",
        message: `[${task.title}] 任务异常终止：${task.errorMessage}`,
        taskId,
      });

      this.dispatchEvent(new CustomEvent("task-updated", { detail: task }));
      this.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: this.getAllTasks() } }));
    });
  }

  /**
   * 处理并增量更新指定 Task 的状态与事件
   * @param {string} taskId
   * @param {Record<string, any>} data
   */
  handleTaskEvent(taskId, data) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // 压入事件缓冲区
    task.events.push(data);

    const isForeground = this.currentActiveTaskId === taskId;

    switch (data.type) {
      case "agent_start":
        task.status = "thinking";
        break;

      case "message_update":
        if (data.assistantMessageEvent) {
          const evt = data.assistantMessageEvent;
          if (evt.type === "thinking_delta") {
            task.status = "thinking";
            task.thinkingText += evt.delta || "";
          } else if (evt.type === "thinking_end") {
            const elapsed = ((Date.now() - task.startedAt) / 1000).toFixed(1);
            task.thinkingDurationText = `已思考 ${elapsed} 秒`;
          } else if (evt.type === "text_start" || evt.type === "text_delta") {
            task.status = "streaming";
            task.responseText += evt.delta || "";
          }
        }
        break;

      case "tool_execution_start":
        task.status = "tool_exec";
        task.activeToolName = data.toolName || "tool";
        task.toolCalls.push({
          id: data.toolCallId,
          name: data.toolName || "tool",
          args: data.args || {},
          status: "running",
        });
        break;

      case "tool_execution_end":
        task.status = "streaming";
        task.activeToolName = null;
        const targetTool = task.toolCalls.find((t) => t.id === data.toolCallId);
        if (targetTool) {
          targetTool.status = "done";
        }
        break;

      case "agent_end":
      case "agent_settled":
        if (task.status === "completed") {
          break; // 防止同一轮生成中 agent_end 与 agent_settled 重复触发
        }
        task.status = "completed";
        task.completedAt = Date.now();
        if (!isForeground) {
          task.hasUnread = true;
        }

        // 仅在任务处于后台挂起状态且软件失焦时触发系统通知
        if (task.isSuspended) {
          notificationService.notifyAgentCompleted({
            taskId,
            taskTitle: task.title,
          });
        }
        break;

      default:
        break;
    }

    this.dispatchEvent(new CustomEvent("task-updated", { detail: task }));
    this.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: this.getAllTasks() } }));
  }
}

export const taskManager = new TaskManager();
