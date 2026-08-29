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

class PiClient extends EventTarget {
  constructor() {
    super();
    this.hostStatus = "stopped";
    this.piVersion = "unknown";
    this.isStreaming = false;
    this.activeTools = new Map();
    this.currentModel = null;
    this.currentThinkingLevel = "medium";
    this.unlistenCallbacks = [];

    this.initTauriListeners();
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
      const errMsg = parseErrorMessage(msgObj.errorMessage || fallback);
      this.dispatchEvent(
        new CustomEvent("agent-error", {
          detail: {
            message: errMsg,
            model: msgObj.model || this.currentModel?.id,
            provider: msgObj.provider || this.currentModel?.provider,
            raw: msgObj,
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
      // 1. 监听宿主状态变更
      const unlistenStatus = await window.__TAURI__.event.listen("pi:status", (event) => {
        const payload = event.payload;
        this.hostStatus = typeof payload === "string" ? payload : payload?.status || "unknown";
        if (payload?.pi_version) {
          this.piVersion = payload.pi_version;
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
      const errMsg = parseErrorMessage(data.error || "指令执行失败");
      this.dispatchEvent(
        new CustomEvent("agent-error", {
          detail: { message: errMsg, raw: data },
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
        this.dispatchEvent(
          new CustomEvent("agent-error", {
            detail: {
              message: parseErrorMessage(data.error || "扩展插件运行异常"),
              raw: data,
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
   * 向 Pi 发送用户提示词
   * @param {string} message
   * @param {Array<any>} [images]
   * @param {string} [streamingBehavior]
   */
  async sendPrompt(message, images = null, streamingBehavior = null) {
    return await this.invoke("pi_send_prompt", {
      request: {
        message,
        images,
        streamingBehavior,
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
   * 中止当前正在进行的 Agent 运行
   */
  async abort() {
    return await this.invoke("pi_abort");
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
