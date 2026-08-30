import { escapeHtml } from "../lib/dom-utils.js";
import { VIEW_DETAILED, VIEW_FLOW } from "../lib/view-constants.js";
import { sessionService } from "../services/session-service.js";

/**
 * 会话记录列表渲染与新建会话
 */
export function initSessionsPanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const btnNewSession = el.btnNewSession;
  const sessionsList = el.sessionsList;
  const sessionCount = el.sessionCount;

  // ==========================================================================
  // 7. 会话列表渲染与操作
  // ==========================================================================
  const loadSessions = async () => {
    if (!sessionsList) return;
    const list = await sessionService.listSessions();
    if (sessionCount) sessionCount.textContent = list.length.toString();

    if (list.length === 0) {
      sessionsList.innerHTML = `<div class="empty-sessions">暂无历史会话</div>`;
      return;
    }

    sessionsList.innerHTML = "";
    list.forEach((s) => {
      const item = document.createElement("div");
      item.className = "session-item";

      const formattedDate = s.modified_at
        ? new Date(s.modified_at).toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      item.innerHTML = `
        <div class="session-title-line">
          <span class="session-name" title="${escapeHtml(s.session_id)}">${escapeHtml(s.session_id.substring(0, 16))}...</span>
          <span class="session-date">${formattedDate}</span>
        </div>
        <div class="session-snippet">${escapeHtml(s.first_message || `(${s.message_count} 条消息)`)}</div>
      `;

      item.addEventListener("click", async () => {
        try {
          await sessionService.switchSession(s.file_path);
          api.closeSettingsView();
          api.setViewMode(VIEW_FLOW, true);
        } catch (err) {
          console.error("Failed to switch session:", err);
        }
      });

      sessionsList.appendChild(item);
    });
  };

  sessionService.addEventListener("sessions-change", () => {
    loadSessions();
  });

  if (btnNewSession) {
    btnNewSession.addEventListener("click", async () => {
      try {
        await sessionService.newSession();
        api.closeSettingsView();
        api.setViewMode(VIEW_DETAILED, false);
      } catch (err) {
        console.error("Failed to create new session:", err);
      }
    });
  }

  api.loadSessions = loadSessions;
}
