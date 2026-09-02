/**
 * Pi Agent Tauri IPC 流式通信客户端 (pi-client.js)
 * 负责与 Rust 后端 supervisor 保持事件同步、分发流式消息、工具调用、模型状态与全链路错误捕获
 */

import { invokeTauri } from "./tauri-bridge.js";

/**
 * 递归解析并提炼复杂的错误信息（支持 JSON 字符串嵌套解析）
 * @param {any} err
 * @returns {string}
 */
export function parseErrorMessage(err) {
  if (!err) return "发生未知错误";
  if (typeof err === "object") {
    if (err.message) return parseErrorMessage(err.message);
    if (err.error?.message) return parseErrorMessage(err.error.message);
    if (err.error && typeof err.error === "string") return parseErrorMessage(err.error);
    return JSON.stringify(err);
  }

  let str = String(err).trim();

  // 处理 401/429 等包含内嵌 JSON 的错误字符串
  try {
    const jsonMatch = str.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error?.message) return parseErrorMessage(parsed.error.message);
      if (parsed.error?.type && parsed.error?.message) {
        return `[${parsed.error.type}] ${parsed.error.message}`;
      }
      if (parsed.message) return parseErrorMessage(parsed.message);
    }
  } catch (_) {
    // 忽略嵌套 JSON 解析失败
  }

  // 常见错误中文友善提示
  if (str.includes("Invalid bearer token") || str.includes("authentication_error") || str.includes("Unauthorized")) {
    return "API 鉴权失败 (401)：未配置有效 API Key 或 Token 无效，请在 Pi CLI 或设置中配置 API Key。";
  }
  if (str.includes("CreditsError") || str.includes("No payment method") || str.includes("insufficient_quota")) {
    return "账户额度不足或未绑定有效支付方式，请检查对应服务商账户账单。";
  }
  if (str.includes("rate_limit") || str.includes("429")) {
    return "触发服务商请求速率限制 (429 Rate Limit)，请稍候重试。";
  }
  if (str.includes("Model not found") || str.includes("invalid_model")) {
    return "当前模型不存在或未开通权限，请在设置中选择其他可用模型。";
  }

  return str;
}

/**
 * 瞬态错误码判定信号 (可自动重连)：HTTP 状态码 / 错误 token / 网络层关键字
 */
const TRANSIENT_CODES = [
  "408", "429", "500", "502", "503", "504",
  "rate_limit", "server_error", "overloaded", "temporarily_unavailable",
  "timeout", "timed_out", "upstream_error", "gateway_timeout", "bad_gateway",
  "econnreset", "econnrefused", "etimedout", "enotfound", "eai_again",
  "socket hang up", "fetch failed", "connection refused", "connection reset",
  "read econnreset", "network", "请求超时",
];

/**
 * 永久错误码判定信号 (需自动切换模型)：HTTP 状态码 / 错误 token / 中文信号
 */
const PERMANENT_CODES = [
  "400", "401", "403", "404", "405", "406", "409", "415", "422",
  "authentication_error", "invalid_api_key", "invalid_request_error",
  "insufficient_quota", "quota_exceeded", "credits", "model_not_found",
  "invalid_model", "content_policy", "context_length_exceeded", "bad_request",
  "forbidden", "unauthorized",
  "鉴权失败", "api key", "额度不足", "模型不存在", "未开通权限", "不支持",
];

/**
 * 从模型调用错误中提取原始错误码 (HTTP 数字 / 错误 token / 网络层关键字)
 * 必须运行于 parseErrorMessage 友好化之前，优先使用原始 RPC 数据 (detail.raw)
 * @param {any} err agent-error detail 或原始错误对象
 * @returns {string}
 */
export function extractErrorCode(err) {
  if (!err) return "";
  const raw = err?.raw;
  const candidate =
    raw?.errorMessage ||
    raw?.error?.message ||
    (raw?.error && typeof raw.error === "string" ? raw.error : "") ||
    raw?.message ||
    (typeof raw === "string" ? raw : "") ||
    err?.message ||
    (typeof err === "string" ? err : "") ||
    "";
  let str = String(candidate).toLowerCase();

  // 尝试解析嵌套 JSON 中的 error.code / error.type
  try {
    const jsonMatch = str.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error?.code) return String(parsed.error.code).toLowerCase();
      if (parsed?.error?.type) return String(parsed.error.type).toLowerCase();
      if (parsed?.code) return String(parsed.code).toLowerCase();
      if (parsed?.type) return String(parsed.type).toLowerCase();
    }
  } catch (_) {
    // 嵌套 JSON 解析失败则继续关键字匹配
  }

  // 提取首个 3 位 HTTP 状态码
  const digits = str.match(/\b(4\d\d|5\d\d)\b/);
  if (digits) return digits[1];

  return str;
}

/**
 * 判定错误或消息对象是否属于用户主动中止/中断/取消
 * @param {any} err agent-error detail、RPC 消息或原始错误对象
 * @returns {boolean}
 */
export function isAbortError(err) {
  if (!err) return false;
  if (err.cancelled === true || err.isAborted === true || err.aborted === true) return true;
  const raw = err?.raw;
  if (raw?.cancelled === true || raw?.isAborted === true || raw?.aborted === true || raw?.interrupted === true) return true;
  if (raw?.stopReason === "abort" || raw?.stopReason === "interrupted" || raw?.stopReason === "cancelled" || raw?.stopReason === "canceled") return true;

  const candidate =
    raw?.errorMessage ||
    raw?.error?.message ||
    (raw?.error && typeof raw.error === "string" ? raw.error : "") ||
    raw?.message ||
    (typeof raw === "string" ? raw : "") ||
    err?.message ||
    (typeof err === "string" ? err : "") ||
    "";
  const str = String(candidate).toLowerCase();

  // 匹配常见中断/手动终止关键字
  const ABORT_PATTERNS = [
    "abort",
    "aborted",
    "aborterror",
    "interrupted",
    "cancelled",
    "canceled",
    "user_abort",
    "manual_abort",
    "terminated",
    "user cancelled",
    "user aborted",
    "request was aborted",
    "the user aborted a request",
    "session aborted",
    "process terminated",
    "请求已被中止",
    "手动终止",
    "已取消",
    "用户终止",
    "操作已取消",
    "刚刚会话已手动终止",
  ];

  return ABORT_PATTERNS.some((kw) => str.includes(kw));
}

/**
 * 判定模型调用错误类别 ("TRANSIENT" | "PERMANENT" | "ABORTED")
 * 铁律：手动终止/中止一律返回 "ABORTED"，绝不归入瞬态重连或永久切换；
 * UNKNOWN 一律保守归永久 (进入切换兜底，切换也失败则输出错误信息)
 * @param {any} err agent-error detail 或原始错误对象
 * @returns {"TRANSIENT" | "PERMANENT" | "ABORTED"}
 */
export function classifyModelError(err) {
  if (isAbortError(err)) return "ABORTED";
  const code = extractErrorCode(err);
  const s = String(code || "").toLowerCase();
  if (TRANSIENT_CODES.some((c) => s === c || s.includes(c))) return "TRANSIENT";
  if (PERMANENT_CODES.some((c) => s === c || s.includes(c))) return "PERMANENT";
  return "PERMANENT"; // UNKNOWN 保守归永久
}

class PiClient extends EventTarget {
  constructor() {
    super();
    this.hostStatus = "stopped";
    this.piVersion = "unknown";
    this._hasKernel = false;
    this.isStreaming = false;
    this.activeTools = new Map();
    this.currentModel = null;
    this.currentThinkingLevel = "medium";
    this.unlistenCallbacks = [];

    this.initTauriListeners();
  }

  /**
   * 查询底层是否存在可用的 Pi 内核
   * @returns {boolean}
   */
  hasKernel() {
    return this._hasKernel;
  }

  /**
   * 手动设置内核状态并广播变更事件
   * @param {boolean} val
   */
  setHasKernel(val) {
    this._hasKernel = Boolean(val);
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.toggle("kernel-missing", !this._hasKernel);
      const tag = document.getElementById("flow-model-tag");
      if (tag) tag.classList.toggle("kernel-missing", !this._hasKernel);
    }
    this.dispatchEvent(
      new CustomEvent("kernel-status-change", { detail: { hasKernel: this._hasKernel } })
    );
  }

  /**
   * 安全调用 Tauri Invoke 指令
   */
  async invoke(command, args = {}) {
    return invokeTauri(command, args);
  }

  /**
   * 辅助检查并广播消息对象中的错误
   * @param {Record<string, any>} msgObj
   * @param {string} [fallback="模型执行出错"]
   * @returns {boolean}
   */
  _dispatchErrorFromMessage(msgObj, fallback = "模型执行出错") {
    if (!msgObj) return false;
    if (msgObj.stopReason === "error" || msgObj.errorMessage) {
      this.isStreaming = false;
      const isAborted = isAbortError(msgObj);
      const errMsg = parseErrorMessage(msgObj.errorMessage || fallback);
      this.dispatchEvent(
        new CustomEvent("agent-error", {
          detail: {
            message: errMsg,
            model: msgObj.model || this.currentModel?.id,
            provider: msgObj.provider || this.currentModel?.provider,
            raw: msgObj,
            taskId: msgObj.task_id || msgObj.taskId,
            isAborted,
            cancelled: isAborted,
          },
        })
      );
      return true;
    }
    return false;
  }

  /**
   * 监听来自 Rust 后端的事件广播
   */
  async initTauriListeners() {
    if (!window.__TAURI__?.event?.listen) return;

    try {
      // 0. 初始化探测内核可用性
      const hasKernel = await this.invoke("pi_has_kernel");
      if (typeof hasKernel === "boolean") {
        this._hasKernel = hasKernel;
        if (typeof document !== "undefined" && document.body) {
          document.body.classList.toggle("kernel-missing", !this._hasKernel);
          const tag = document.getElementById("flow-model-tag");
          if (tag) tag.classList.toggle("kernel-missing", !this._hasKernel);
        }
        this.dispatchEvent(
          new CustomEvent("kernel-status-change", { detail: { hasKernel: this._hasKernel } })
        );
      }

      // 1. 监听宿主状态变更
      const unlistenStatus = await window.__TAURI__.event.listen("pi:status", async (event) => {
        const payload = event.payload;
        this.hostStatus = typeof payload === "string" ? payload : payload?.status || "unknown";
        if (payload?.pi_version) {
          this.piVersion = payload.pi_version;
        }
        const currentHasKernel = await this.invoke("pi_has_kernel");
        if (typeof currentHasKernel === "boolean") {
          this._hasKernel = currentHasKernel;
          if (typeof document !== "undefined" && document.body) {
            document.body.classList.toggle("kernel-missing", !this._hasKernel);
            const tag = document.getElementById("flow-model-tag");
            if (tag) tag.classList.toggle("kernel-missing", !this._hasKernel);
          }
        }
        this.dispatchEvent(new CustomEvent("status-change", { detail: payload }));
      });
      this.unlistenCallbacks.push(unlistenStatus);

      // 2. 监听核心 RPC 数据事件
      const unlistenEvent = await window.__TAURI__.event.listen("pi:event", (event) => {
        const data = event.payload;
        this.handleAgentEvent(data);
      });
      this.unlistenCallbacks.push(unlistenEvent);

      // 3. 监听运行态上下文/Inner-Skill 强行注入事件
      const unlistenInjected = await window.__TAURI__.event.listen("pi:context_injected", (event) => {
        this.dispatchEvent(new CustomEvent("context-injected", { detail: event.payload }));
      });
      this.unlistenCallbacks.push(unlistenInjected);

      // 4. 监听内核保险自动重连失败事件（5 次重连均失败后触发，驱动左上角红色抖动小闪电提醒）
      const unlistenReconnectFailed = await window.__TAURI__.event.listen(
        "pi:kernel-reconnect-failed",
        (event) => {
          this.dispatchEvent(new CustomEvent("kernel-reconnect-failed", { detail: event.payload }));
        }
      );
      this.unlistenCallbacks.push(unlistenReconnectFailed);

      // 初始化获取当前状态与模型
      const initialStatus = await this.invoke("pi_get_host_status");
      if (initialStatus) {
        this.hostStatus = initialStatus.status || "ready";
        if (initialStatus.pi_version) this.piVersion = initialStatus.pi_version;
        this.dispatchEvent(new CustomEvent("status-change", { detail: initialStatus }));
      }
    } catch (e) {
      console.warn("[PiClient] Failed to bind Tauri listeners:", e);
    }
  }

  /**
   * 解析并分发底层 Pi RPC 事件流
   * @param {Record<string, any>} data
   */
  handleAgentEvent(data) {
    if (!data || !data.type) return;

    // 广播原始事件
    this.dispatchEvent(new CustomEvent("raw-event", { detail: data }));

    // 检查通用 RPC 失败响应
    if (data.type === "response" && data.success === false) {
      this.isStreaming = false;
      const isAborted = isAbortError(data);
      const errMsg = parseErrorMessage(data.error || "指令执行失败");
      this.dispatchEvent(
        new CustomEvent("agent-error", {
          detail: {
            message: errMsg,
            raw: data,
            taskId: data.task_id || data.taskId,
            isAborted,
            cancelled: isAborted,
          },
        })
      );
      return;
    }

    switch (data.type) {
      case "agent_start":
        this.isStreaming = true;
        this.dispatchEvent(new CustomEvent("agent-start", { detail: data }));
        break;

      case "agent_end":
      case "agent_settled":
        this.isStreaming = false;
        if (Array.isArray(data.messages)) {
          const errMessage = data.messages.find(
            (m) => m.stopReason === "error" || m.errorMessage
          );
          if (errMessage) {
            this._dispatchErrorFromMessage(errMessage, "模型调用发生异常");
          }
        }
        this.dispatchEvent(new CustomEvent("agent-end", { detail: data }));
        break;

      case "turn_start":
        this.dispatchEvent(new CustomEvent("turn-start", { detail: data }));
        break;

      case "turn_end":
        this._dispatchErrorFromMessage(data.message, "模型执行出错");
        this.dispatchEvent(new CustomEvent("turn-end", { detail: data }));
        break;

      case "message_start":
        this._dispatchErrorFromMessage(data.message, "模型调用失败");
        this.dispatchEvent(new CustomEvent("message-start", { detail: data }));
        break;

      case "message_update":
        this.handleMessageUpdate(data);
        break;

      case "message_end":
        this._dispatchErrorFromMessage(data.message, "模型执行失败");
        this.dispatchEvent(new CustomEvent("message-end", { detail: data }));
        break;

      case "tool_execution_start":
        this.activeTools.set(data.toolCallId, data);
        this.dispatchEvent(new CustomEvent("tool-start", { detail: data }));
        break;

      case "tool_execution_update":
        if (this.activeTools.has(data.toolCallId)) {
          this.activeTools.set(data.toolCallId, { ...this.activeTools.get(data.toolCallId), ...data });
        }
        this.dispatchEvent(new CustomEvent("tool-update", { detail: data }));
        break;

      case "tool_execution_end":
        this.activeTools.delete(data.toolCallId);
        this.dispatchEvent(new CustomEvent("tool-end", { detail: data }));
        break;

      case "bash_execution_update":
        this.dispatchEvent(new CustomEvent("bash-update", { detail: data }));
        break;

      case "auto_retry_start":
      case "auto_retry_end":
        this.dispatchEvent(new CustomEvent("retry-status", { detail: data }));
        break;

      case "extension_error":
        this.isStreaming = false;
        this.dispatchEvent(
          new CustomEvent("agent-error", {
            detail: {
              message: parseErrorMessage(data.error || "扩展插件运行异常"),
              raw: data,
              taskId: data.task_id || data.taskId,
            },
          })
        );
        break;

      case "extension_ui_request":
        this.dispatchEvent(new CustomEvent("extension-ui", { detail: data }));
        break;

      default:
        break;
    }
  }

  /**
   * 处理增量流式消息更新 (Thinking / Text / ToolCall Deltas)
   * @param {Record<string, any>} data
   */
  handleMessageUpdate(data) {
    const evt = data.assistantMessageEvent;
    if (!evt) return;

    switch (evt.type) {
      case "thinking_start":
        this.dispatchEvent(new CustomEvent("thinking-start", { detail: evt }));
        break;
      case "thinking_delta":
        this.dispatchEvent(new CustomEvent("thinking-delta", { detail: evt.delta || "" }));
        break;
      case "thinking_end":
        this.dispatchEvent(new CustomEvent("thinking-end", { detail: evt }));
        break;
      case "text_start":
        this.dispatchEvent(new CustomEvent("text-start", { detail: evt }));
        break;
      case "text_delta":
        this.dispatchEvent(new CustomEvent("text-delta", { detail: evt.delta || "" }));
        break;
      case "text_end":
        this.dispatchEvent(new CustomEvent("text-end", { detail: evt }));
        break;
      case "toolcall_start":
        this.dispatchEvent(new CustomEvent("toolcall-delta-start", { detail: evt }));
        break;
      case "toolcall_delta":
        this.dispatchEvent(new CustomEvent("toolcall-delta", { detail: evt.delta || "" }));
        break;
      case "toolcall_end":
        this.dispatchEvent(new CustomEvent("toolcall-delta-end", { detail: evt.toolCall }));
        break;
      default:
        break;
    }
  }

  /**
   * 向 Pi 发送用户提示词（支持指定 taskId 绑定多进程独立会话）
   * @param {string} message
   * @param {Array<any>} [images]
   * @param {string} [streamingBehavior]
   * @param {string} [taskId]
   */
  async sendPrompt(message, images = null, streamingBehavior = null, taskId = null) {
    const activeModel = this.currentModel;
    const provider = activeModel?.provider;
    const modelId = activeModel?.id || activeModel?.modelId || activeModel?.name;
    const thinkingLevel = this.currentThinkingLevel;

    return await this.invoke("pi_send_prompt", {
      request: {
        message,
        taskId: taskId || undefined,
        images,
        streamingBehavior,
        provider: provider || undefined,
        modelId: modelId || undefined,
        thinkingLevel: thinkingLevel || undefined,
      },
    });
  }

  /**
   * 获取当前会话状态（包括当前激活的模型与思考等级）
   */
  async getState() {
    try {
      const state = await this.invoke("pi_get_state");
      if (state) {
        if (state.model) this.currentModel = state.model;
        if (state.thinkingLevel) this.currentThinkingLevel = state.thinkingLevel;
        this.dispatchEvent(new CustomEvent("state-update", { detail: state }));
      }
      return state;
    } catch (err) {
      console.warn("[PiClient] Failed to get session state:", err);
      return null;
    }
  }

  /**
   * 获取所有可用与已配置模型列表
   * @returns {Promise<Array<any>>}
   */
  async getAvailableModels() {
    try {
      const res = await this.invoke("pi_get_available_models");
      return res?.models || [];
    } catch (err) {
      console.warn("[PiClient] Failed to get available models:", err);
      return [];
    }
  }

  /**
   * 切换当前激活使用的模型
   * @param {string} provider
   * @param {string} modelId
   */
  async setModel(provider, modelId) {
    try {
      const newModel = await this.invoke("pi_set_model", {
        provider,
        modelId,
      });
      if (newModel) {
        this.currentModel = newModel;
        this.dispatchEvent(new CustomEvent("model-change", { detail: newModel }));
      }
      return newModel;
    } catch (err) {
      console.error("[PiClient] Failed to switch model:", err);
      throw err;
    }
  }

  /**
   * 切换当前思考推理深度等级
   * @param {"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"} level
   */
  async setThinkingLevel(level) {
    try {
      await this.invoke("pi_set_thinking_level", { level });
      this.currentThinkingLevel = level;
      this.dispatchEvent(new CustomEvent("thinking-level-change", { detail: level }));
    } catch (err) {
      console.error("[PiClient] Failed to set thinking level:", err);
      throw err;
    }
  }

  /**
   * 中止正在进行的 Agent 运行（支持指定 taskId）
   * @param {string} [taskId]
   */
  async abort(taskId = null) {
    return await this.invoke("pi_abort", {
      taskId: taskId || undefined,
    });
  }

  /**
   * 销毁并清理指定 Task 进程
   * @param {string} taskId
   */
  async destroyTask(taskId) {
    return await this.invoke("pi_destroy_task", { taskId });
  }

  /**
   * 获取底层正在运行的 Task 列表
   * @returns {Promise<Array<string>>}
   */
  async getActiveTasks() {
    try {
      return await this.invoke("pi_get_active_tasks");
    } catch (_) {
      return [];
    }
  }

  /**
   * 重启 Pi 宿主进程
   */
  async restartHost() {
    return await this.invoke("pi_restart_host");
  }

  /**
   * 获取当前宿主状态
   */
  async getHostStatus() {
    return await this.invoke("pi_get_host_status");
  }

  /**
   * 销毁客户端并注销所有事件监听
   */
  destroy() {
    for (const unlisten of this.unlistenCallbacks) {
      if (typeof unlisten === "function") {
        try {
          unlisten();
        } catch (_) {}
      }
    }
    this.unlistenCallbacks = [];
  }
}

export const piClient = new PiClient();
