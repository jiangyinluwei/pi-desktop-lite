import { invokeTauri } from "./tauri-bridge.js";

/**
 * 会话历史与分支导航服务 (session-service.js)
 */
class SessionService extends EventTarget {
  constructor() {
    super();
    this.sessions = [];
    this.currentSessionId = null;
    this.initListeners();
  }

  async initListeners() {
    if (!window.__TAURI__?.event?.listen) return;

    try {
      await window.__TAURI__.event.listen("pi:sessions-updated", (event) => {
        this.sessions = event.payload || [];
        this.dispatchEvent(new CustomEvent("sessions-change", { detail: this.sessions }));
      });
    } catch (e) {
      console.warn("[SessionService] Failed to listen to session events:", e);
    }
  }

  /**
   * 拉取所有可用会话列表
   */
  async listSessions() {
    try {
      const list = await invokeTauri("pi_list_sessions");
      this.sessions = list || [];
      return this.sessions;
    } catch (err) {
      console.error("[SessionService] Failed to list sessions:", err);
      return [];
    }
  }

  /**
   * 获取指定会话的分支条目树
   * @param {string} sessionPath
   */
  async getSessionTree(sessionPath) {
    try {
      return (await invokeTauri("pi_get_session_tree", { sessionPath })) || [];
    } catch (err) {
      console.error("[SessionService] Failed to get session tree:", err);
      return [];
    }
  }

  /**
   * 切换到目标会话
   * @param {string} sessionPath
   */
  async switchSession(sessionPath) {
    return await invokeTauri("pi_switch_session", { sessionPath });
  }

  /**
   * 开启一个新会话
   * @param {string} [parentSession]
   */
  async newSession(parentSession = null) {
    return await invokeTauri("pi_new_session", { parentSession });
  }
}

export const sessionService = new SessionService();

