/**
 * Pi Agent Tauri IPC 流式通信客户端 (pi-client.js)
 * 负责与 Rust 后端 supervisor 保持事件同步、分发流式消息与工具调用
 */

class PiClient extends EventTarget {
  constructor() {
    super();
    this.hostStatus = "stopped";
    this.piVersion = "unknown";
    this.isStreaming = false;
    this.activeTools = new Map();
    this.unlistenCallbacks = [];

    this.initTauriListeners();
  }

  /**
   * 安全调用 Tauri Invoke 指令
   * @param {string} command
   * @param {Record<string, any>} args
   */
  async invoke(command, args = {}) {
    if (window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke(command, args);
      } catch (err) {
        console.error(`[PiClient] Invoke ${command} error:`, err);
        throw err;
      }
    } else {
      console.warn(`[PiClient] Tauri invoke not available for ${command}`);
      return null;
    }
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

      // 初始化获取当前状态
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

    switch (data.type) {
      case "agent_start":
        this.isStreaming = true;
        this.dispatchEvent(new CustomEvent("agent-start", { detail: data }));
        break;

      case "agent_end":
      case "agent_settled":
        this.isStreaming = false;
        this.dispatchEvent(new CustomEvent("agent-end", { detail: data }));
        break;

      case "turn_start":
        this.dispatchEvent(new CustomEvent("turn-start", { detail: data }));
        break;

      case "turn_end":
        this.dispatchEvent(new CustomEvent("turn-end", { detail: data }));
        break;

      case "message_start":
        this.dispatchEvent(new CustomEvent("message-start", { detail: data }));
        break;

      case "message_update":
        this.handleMessageUpdate(data);
        break;

      case "message_end":
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
   * 获取当前 Pi 版本
   */
  async getVersion() {
    return await this.invoke("pi_get_version");
  }
}

export const piClient = new PiClient();
