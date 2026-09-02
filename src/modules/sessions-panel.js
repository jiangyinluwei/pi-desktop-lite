import { escapeHtml, cleanUserPrompt } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { sessionService } from "../services/session-service.js";
import { conversationHistoryService } from "../services/conversation-history.js";
import { taskManager } from "../services/task-manager.js";
import { piClient } from "../services/pi-client.js";
import { sketchConfirm, sketchAlert } from "../services/sketch-modal.js";
import { enhanceSelect } from "../services/sketch-select.js";

/**
 * 会话记录面板：内核全量会话列表、搜索 / 时间筛选、进入 Flow 与界面会话清空
 * 硬约束：绝不提供删除 Pi 内核会话文件的能力，清空操作仅作用于 UI 展示层。
 */
export function initSessionsPanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;

  const btnClearUiSessions = el.btnClearUiSessions;
  const sessionsSearchInput = el.sessionsSearchInput;
  const sessionsTimeFilter = el.sessionsTimeFilter;
  const sessionsList = el.sessionsList;
  const sessionCount = el.sessionCount;

  // ==========================================================================
  // 过滤状态：持久于模块级，pi:sessions-updated 重渲染时保留
  // ==========================================================================
  let allSessions = [];
  let filterKeyword = "";
  let filterTimeRange = "all";
  const TIME_RANGE_MS = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };

  // ==========================================================================
  // 内核会话轮次 → Flow 渲染数据适配
  // ==========================================================================
  const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"];
  const CODE_EXTS = [
    "js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
    "css", "html", "json", "md", "toml", "yaml", "yml", "sh", "sql", "rb",
    "php", "swift", "kt", "vue", "svelte",
  ];

  const toAttachmentChip = (path) => {
    const clean = String(path || "").replace(/\\/g, "/");
    const name = clean.split("/").pop() || clean;
    const ext = (name.split(".").pop() || "").toLowerCase();
    let category = "document";
    if (IMAGE_EXTS.includes(ext)) {
      category = "image";
    } else if (CODE_EXTS.includes(ext)) {
      category = "code";
    }
    return { path: clean, name, category };
  };

  // 历史工具卡片默认收起（与运行态"新卡出现旧卡自动收起"后的稳态一致）
  const buildToolCardHtml = (tc) => {
    const statusText = tc.is_error ? "failed" : "done";
    const bodyText = tc.result_text || tc.arguments_text || "";
    return `
      <div class="tool-card collapsed ${tc.is_error ? "error" : "done"}">
        <div class="tool-header" role="button" tabindex="0" aria-expanded="false">
          <div class="tool-title-group">
            <span class="tool-icon" aria-hidden="true">${ICONS.tool}</span>
            <span class="tool-name">${escapeHtml(tc.name || "tool")}</span>
          </div>
          <div class="tool-header-right">
            <span class="tool-status-badge">${statusText}</span>
            <span class="tool-collapse-arrow" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <polyline points="4 6 8 10 12 6" />
              </svg>
            </span>
          </div>
        </div>
        <div class="tool-body">${escapeHtml(bodyText)}</div>
      </div>
    `;
  };

  const mapSessionTurns = (detail) => {
    return (Array.isArray(detail) ? detail : []).map((t) => ({
      query: cleanUserPrompt(t.query || ""),
      attachments: (t.attachments || []).map(toAttachmentChip),
      thinkingText: t.thinking_text || "",
      thinkingDurationText: "已完成思考",
      responseText: t.response_text || "",
      toolCalls: (t.tool_calls || []).map((tc) => ({
        id: tc.id || "",
        html: buildToolCardHtml(tc),
      })),
      isAborted: Boolean(t.is_aborted),
      status: "completed",
    }));
  };

  // ==========================================================================
  // 统一进入管线：解析会话 → 沉淀界面1 → 绑定 Task → 渲染 Flow 轮次 → 切内核会话 → 进 Flow
  // ==========================================================================
  const enterKernelSessionFlow = async (s, btn = null) => {
    if (!s?.file_path) return;
    if (btn) {
      if (btn.dataset.loading === "true") return;
      btn.dataset.loading = "true";
      btn.classList.add("is-loading");
      btn.textContent = "加载中...";
    }

    try {
      // 已有活跃任务时先归档当前 Flow 现场，防覆盖（沿用 restoreConversationToFlow 语义）
      const currentActive = taskManager.getCurrentActiveTask();
      if (currentActive) {
        api.archiveCurrentFlowToHistory();
      }

      const convId = `kernel_${s.session_id}`;
      let turns;
      try {
        const detail = await sessionService.getSessionDetail(s.file_path);
        turns = mapSessionTurns(detail);
      } catch (err) {
        console.error("[SessionsPanel] Failed to parse session detail:", err);
        turns = [];
      }

      // 降级路径：解析失败或空会话时仅渲染首条提问空轮次
      if (turns.length === 0) {
        await sketchAlert("未能解析该会话的完整轮次，将仅展示首条提问。");
        turns = [
          {
            query: cleanUserPrompt(s.first_message || s.session_id || "(空会话)"),
            attachments: [],
            thinkingText: "",
            thinkingDurationText: "已完成思考",
            responseText: "",
            toolCalls: [],
            isAborted: false,
            status: "completed",
          },
        ];
      }

      const firstQuery = cleanUserPrompt(turns[0].query || s.first_message || s.session_id);
      const lastTurn = turns[turns.length - 1];

      // 沉淀至界面1 讯息卡片：kernel_ 前缀隔离，recordConversation 自带 MRU 刷新与反隐藏
      conversationHistoryService.recordConversation({
        id: convId,
        title: conversationHistoryService.generateSummaryTitle(firstQuery),
        query: firstQuery,
        turns,
        thinkingText: lastTurn.thinkingText || "",
        responseText: lastTurn.responseText || "",
        toolCalls: lastTurn.toolCalls || [],
        sessionPath: s.file_path,
      });

      // 绑定 TaskManager 活跃 Task，后续追问接入同一 Pi 会话
      let task = taskManager.getTask(convId);
      if (!task) {
        task = taskManager.createTask({
          id: convId,
          conversationId: convId,
          query: firstQuery,
          model: piClient.currentModel?.id || "default",
          isSuspended: false,
        });
      }
      task.turns = JSON.parse(JSON.stringify(turns));
      task.conversationId = convId;
      task.status = "completed";
      task.thinkingText = lastTurn.thinkingText || "";
      task.responseText = lastTurn.responseText || "";
      task.toolCalls = lastTurn.toolCalls || [];
      task.thinkingDurationText = lastTurn.thinkingDurationText || "已完成思考";

      // 直接切 Flow，不调用 closeSettingsView（避免先跳回 previous 的中间态抖动）
      api.renderTurnsIntoFlow(task, turns, { sessionPath: s.file_path });
      view.flowFromSettings = true;

      api.renderConversationMessages();
      api.updateMiniTaskCapsuleUI();
    } finally {
      if (btn) {
        delete btn.dataset.loading;
        btn.classList.remove("is-loading");
        btn.textContent = "进入 Flow";
      }
    }
  };

  // ==========================================================================
  // 列表渲染：内存过滤（关键字 + 时间档位），排序维持后端 modified_at 倒序
  // ==========================================================================
  const applySessionFilters = () => {
    const keyword = filterKeyword.trim().toLowerCase();
    const now = Date.now();
    return allSessions.filter((s) => {
      // 硬过滤：仅保留至少一轮「真实用户提问 → 完整回答」的会话
      if (!s.has_complete_turn) return false;
      if (keyword) {
        const haystack = `${s.first_message || ""} ${s.session_id || ""} ${s.cwd || ""}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      if (filterTimeRange !== "all") {
        const ts = s.modified_at ? new Date(s.modified_at).getTime() : NaN;
        if (Number.isNaN(ts) || now - ts > TIME_RANGE_MS[filterTimeRange]) {
          return false;
        }
      }
      return true;
    });
  };

  const renderSessions = () => {
    if (!sessionsList) return;

    const list = applySessionFilters();

    if (sessionCount) {
      sessionCount.textContent =
        list.length === allSessions.length
          ? allSessions.length.toString()
          : `${list.length}/${allSessions.length}`;
    }

    if (list.length === 0) {
      const pureCompletenessEmpty =
        allSessions.length > 0 && !filterKeyword.trim() && filterTimeRange === "all";
      const emptyHintText = allSessions.length === 0
        ? "暂无历史会话"
        : pureCompletenessEmpty
          ? "暂无含完整对话的会话"
          : "未找到匹配的历史会话";
      sessionsList.innerHTML = `
        <div class="empty-sessions">
          <span class="empty-sessions-icon" aria-hidden="true">${ICONS.chat}</span>
          <span class="empty-sessions-text">${escapeHtml(emptyHintText)}</span>
        </div>
      `;
      return;
    }

    sessionsList.innerHTML = "";
    list.forEach((s) => {
      const item = document.createElement("div");
      item.className = "session-item";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      const formattedDate = s.modified_at
        ? new Date(s.modified_at).toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      const rawFirst = cleanUserPrompt(s.first_message || "").trim();
      const cleanFirst = rawFirst.replace(/\r?\n+/g, " ");
      const hasFirstMessage = cleanFirst.length > 0;
      const displayTitle = hasFirstMessage
        ? (cleanFirst.length > 42 ? `${cleanFirst.slice(0, 42)}...` : cleanFirst)
        : `会话 #${s.session_id.substring(0, 10)}`;
      const fullTooltip = hasFirstMessage ? rawFirst : s.session_id;

      // 解析工作区末级文件夹名
      let workspaceTagHtml = "";
      if (s.cwd) {
        const parts = s.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
        const folderName = parts.pop() || "";
        if (folderName) {
          workspaceTagHtml = `
            <span class="session-meta-pill session-workspace-pill" title="工作区路径: ${escapeHtml(s.cwd)}">
              <span class="pill-icon" aria-hidden="true">${ICONS.folder}</span>
              <span class="pill-text">${escapeHtml(folderName)}</span>
            </span>
          `;
        }
      }

      // 消息条数徽标
      const messageCountText = s.message_count > 0 ? `${s.message_count} 条消息` : "";
      const messageCountHtml = messageCountText
        ? `<span class="session-meta-pill session-count-pill">${escapeHtml(messageCountText)}</span>`
        : "";

      item.innerHTML = `
        <div class="session-item-header">
          <div class="session-item-title-wrap">
            <span class="session-type-icon" aria-hidden="true">${ICONS.chat}</span>
            <span class="session-name" title="${escapeHtml(fullTooltip)}">${escapeHtml(displayTitle)}</span>
          </div>
          <div class="session-item-meta-top">
            ${messageCountHtml}
            <span class="session-date">${formattedDate}</span>
          </div>
        </div>
        ${
          hasFirstMessage && cleanFirst.length > 42
            ? `<div class="session-snippet">${escapeHtml(cleanFirst)}</div>`
            : ""
        }
        <div class="session-item-footer">
          <div class="session-tags-group">
            ${workspaceTagHtml}
            <span class="session-id-tag" title="完整会话 ID: ${escapeHtml(s.session_id)}">#${escapeHtml(s.session_id.substring(0, 8))}</span>
          </div>
          <div class="session-hover-prompt" aria-hidden="true">
            <span class="prompt-text">进入 Flow</span>
            <span class="hover-arrow">→</span>
          </div>
        </div>
      `;

      item.addEventListener("click", () => {
        enterKernelSessionFlow(s);
      });

      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enterKernelSessionFlow(s);
        }
      });

      sessionsList.appendChild(item);
    });
  };

  const loadSessions = async () => {
    const list = await sessionService.listSessions();
    allSessions = Array.isArray(list) ? list : [];
    renderSessions();
  };

  sessionService.addEventListener("sessions-change", () => {
    loadSessions();
  });

  // ==========================================================================
  // 工具栏：搜索（200ms 防抖）+ 时间筛选（SketchSelect）+ 清空界面会话
  // ==========================================================================
  let searchDebounceTimer = null;
  if (sessionsSearchInput) {
    sessionsSearchInput.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        filterKeyword = sessionsSearchInput.value || "";
        renderSessions();
      }, 200);
    });
  }

  if (sessionsTimeFilter) {
    enhanceSelect(sessionsTimeFilter);
    sessionsTimeFilter.addEventListener("change", () => {
      filterTimeRange = sessionsTimeFilter.value || "all";
      renderSessions();
    });
  }

  if (btnClearUiSessions) {
    btnClearUiSessions.addEventListener("click", async () => {
      const confirmed = await sketchConfirm(
        "确定清空界面上的全部历史会话记录？仅影响界面展示，不会删除 Pi 内核会话文件。",
        { isDanger: true }
      );
      if (!confirmed) return;
      conversationHistoryService.clearAllConversations();
      api.showGlobalToast("已清空界面会话记录");
      api.renderConversationMessages();
    });
  }

  api.loadSessions = loadSessions;
}
