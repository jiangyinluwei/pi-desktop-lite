import { escapeHtml } from "../lib/dom-utils.js";
import { bus } from "../lib/event-bus.js";
import { SketchModal } from "../services/sketch-modal.js";
import { invokeTauri } from "../services/tauri-bridge.js";
import { taskManager } from "../services/task-manager.js";
import { conversationHistoryService } from "../services/conversation-history.js";

/**
 * Flow 会话回退 (历史节点回退 + 文件撤回)
 *
 * 交互流：轮次提问卡片悬浮「回退到此处」→ Preflight 快照预检 → SketchModal 确认
 * （列出待恢复/保留文件，并针对 >8MB 大文件超限明示警告横幅与专属徽标）→ 执行链路：
 *   1) pi_get_fork_messages 预解析内核回退点（无副作用校验先行，定位失败不触碰文件与内核）；
 *   2) pi_rollback_files(dryRun: true) 快照无副作用预检（若有 missing/too-large 直接保守中止，磁盘 0 写入）；
 *   3) pi_fork_session (Fork 先行) —— 配合 pi 内核原生历史节点回退创建分支；若失败，磁盘 0 写入，环境 100% 原始干净；
 *   4) pi_rollback_files(dryRun: false) (原子落盘) —— 还原已修改/已删除文件（新增文件永不撤回，防误删铁律）；
 *   5) 剪枝本地文件变更仓 + 重渲 Flow 至回退点 + 提问回填输入框 + 顶部浮窗提示结果（持续 3 秒）。
 */

/** 任务是否处于生成中（回退前置守卫：生成进行中禁止回退） */
const isTaskRunning = (task) => {
  if (!task) return false;
  return ["thinking", "streaming", "tool_exec"].includes(task.status);
};

/** 内核 fork 消息文本与本地轮次提问的匹配（严格文本优先，前缀次之） */
const matchForkEntry = (messages, query) => {
  const q = String(query || "").trim();
  if (!q || !Array.isArray(messages) || messages.length === 0) return null;
  // 1) 全文精确匹配
  let entry = messages.find((m) => String(m.text || "").trim() === q);
  if (entry) return entry;
  // 2) 首行 / 前 80 字符前缀匹配（附带文件路径尾注时内核文本更长）
  const head = q.split("\n")[0].trim();
  const probe = (head.length >= 8 ? head : q).slice(0, 80);
  if (probe.length >= 8) {
    entry = messages.find((m) => String(m.text || "").trim().startsWith(probe));
    if (entry) return entry;
  }
  return null;
};

export function initFlowRollback(ctx) {
  const api = ctx.api;
  const el = ctx.el;
  const flow = ctx.flow;
  const flowDom = ctx.flowDom;
  const flowConversation = flowDom.flowConversation;
  if (!flowConversation) return;

  const toast = (message, duration = 3000) => {
    bus.emit("ui:toast", { text: message, duration });
  };

  /** 由 DOM 定位轮次下标（渲染顺序即轮次顺序，注入信封等非 .flow-message-group 元素天然排除） */
  const resolveTurnIndex = (btnEl) => {
    const groupEl = btnEl.closest(".flow-message-group");
    if (!groupEl) return -1;
    const groups = Array.from(flowConversation.querySelectorAll(".flow-message-group"));
    return groups.indexOf(groupEl);
  };

  /** 确认弹窗内容（手绘草图清单：待恢复 / 保留 / 无快照，含大文件超限明示提醒） */
  const buildDetailHtml = (preview, preflightResult) => {
    const { restoreList, keepAddList } = preview;
    const modifyCount = restoreList.filter((r) => r.kind === "modify").length;
    const deleteCount = restoreList.filter((r) => r.kind === "delete").length;
    const missing = preflightResult?.missing || [];
    const tooLargeMap = new Map();
    const missingReasonMap = new Map();
    for (const m of missing) {
      const p = String(m?.path || "").toLowerCase();
      if (m?.reason === "too-large") {
        tooLargeMap.set(p, true);
      } else {
        missingReasonMap.set(p, m?.reason || "no-snapshot");
      }
    }
    const hasTooLarge = tooLargeMap.size > 0;
    const hasMissing = missing.length > 0;

    const rows = [];

    // P3-1 明示提醒：若预检测到超过 8MB 快照上限的大文件，顶部渲染醒目警告横幅
    if (hasTooLarge) {
      rows.push(
        `<div class="rollback-warning-banner">` +
          `<div><strong>⚠️ 大文件超限保守中止提醒：</strong>` +
          `检测到 ${tooLargeMap.size} 个文件超过单文件 8MB 快照大小上限，快照未保存原始内容。` +
          `按照安全铁律，<strong>本次回退已被保守阻止且不会做任何还原</strong>，以防产生部分文件被撤回的代码不一致。</div>` +
        `</div>`
      );
    } else if (hasMissing) {
      rows.push(
        `<div class="rollback-warning-banner">` +
          `<div><strong>⚠️ 缺失历史快照提醒：</strong>` +
          `检测到 ${missing.length} 个文件无法定位执行前快照。按照保守中止安全铁律，本次回退无法执行。</div>` +
        `</div>`
      );
    }

    if (restoreList.length > 0) {
      rows.push(
        `<div class="rollback-section"><div class="rollback-section-title">将撤回并恢复 ${restoreList.length} 个文件（修改 ${modifyCount} / 删除 ${deleteCount}）：</div>` +
          `<ul class="rollback-file-list">` +
          restoreList
            .map((r) => {
              const pLower = String(r.path || "").toLowerCase();
              const isTooLarge = tooLargeMap.has(pLower);
              const missReason = missingReasonMap.get(pLower);
              let tagHtml = "";
              if (isTooLarge) {
                tagHtml = `<span class="rollback-kind kind-too-large">超限 &gt;8MB</span>`;
              } else if (missReason) {
                tagHtml = `<span class="rollback-kind kind-delete">无快照</span>`;
              } else {
                tagHtml = `<span class="rollback-kind kind-${r.kind}">${r.kind === "delete" ? "删除" : "修改"}</span>`;
              }
              return `<li>${tagHtml}<span class="rollback-path" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</span></li>`;
            })
            .join("") +
          `</ul>` +
          `<div class="rollback-note"><strong>安全铁律：</strong>单文件超过 8MB 时不保存内容快照。执行回退时若发现此类文件将<strong>整体保守中止且 0 写入磁盘</strong>，确保绝对安全。</div>` +
          `</div>`
      );
    }
    if (keepAddList.length > 0) {
      rows.push(
        `<div class="rollback-section"><div class="rollback-section-title">已新增的 ${keepAddList.length} 个文件将保留（不可撤回）：</div>` +
          `<ul class="rollback-file-list">` +
          keepAddList
            .map(
              (p) =>
                `<li><span class="rollback-kind kind-add">新增</span><span class="rollback-path" title="${escapeHtml(p)}">${escapeHtml(p)}</span></li>`
            )
            .join("") +
          `</ul></div>`
      );
    }
    if (rows.length === 0) {
      rows.push(`<div class="rollback-section"><div class="rollback-section-title">该轮次之后没有文件变更记录。</div></div>`);
    }
    return rows.join("");
  };

  /** 执行回退主链路：内核回退点预解析 → 快照预检 → 内核 fork 先行 → 文件原子落盘 → 本地剪枝重渲 */
  const performRollback = async (task, turnIndex, preview) => {
    // 1. 内核回退点预解析（无副作用校验先行）：定位失败时在触碰任何文件前中止
    let messages = [];
    try {
      const resp = await invokeTauri("pi_get_fork_messages", { taskId: task.id });
      messages = resp?.messages || [];
    } catch (err) {
      toast(`回退失败：无法获取内核回退点 (${err})`, 3000);
      return;
    }
    const targetTurn = task.turns[turnIndex];
    let forkEntry = matchForkEntry(messages, targetTurn?.query);
    if (!forkEntry && messages.length === task.turns.length) {
      forkEntry = messages[turnIndex]; // 位置兜底（轮次与内核用户消息一一对应时）
    }
    if (!forkEntry?.entryId) {
      toast("回退失败：无法在当前内核会话中定位回退点", 3000);
      return;
    }

    // 2. 文件快照无副作用预检 (Preflight Dry-Run)：
    //    在真正动内核会话与写磁盘前，必须 100% 确认所有待撤回文件快照均就绪可用
    if (preview.restoreList.length > 0) {
      let preflight;
      try {
        preflight = await invokeTauri("pi_rollback_files", {
          taskId: task.id,
          targets: preview.restoreList.map((r) => ({
            path: r.path,
            toolCallId: r.toolCallId,
          })),
          dryRun: true,
        });
      } catch (err) {
        toast(`回退失败：快照预检出错 (${err})`, 3000);
        return;
      }
      if (preflight?.missing?.length > 0) {
        const tooLarge = preflight.missing.filter((m) => m?.reason === "too-large");
        const firstMiss = preflight.missing[0];
        const detail =
          tooLarge.length > 0
            ? `其中 ${tooLarge.length} 个文件超过快照大小上限（8MB），快照未保存内容、无法自动还原`
            : `首个失败：${firstMiss?.path || "?"} (${firstMiss?.reason || "no-snapshot"})`;
        toast(
          `回退已保守中止：${preflight.missing.length} 个文件无有效快照。${detail}。未做任何修改。`,
          5000
        );
        return;
      }
    }

    // 3. 内核原生历史节点回退 (fork 先行 - 解决 P2-1 跨步骤原子性)：
    //    先创建内核回退分支。若内核 fork 失败，此时磁盘 0 写入，环境完全干净无污染！
    try {
      await invokeTauri("pi_fork_session", { taskId: task.id, entryId: forkEntry.entryId });
    } catch (err) {
      toast(`回退失败：内核回退分支创建失败 (${err})。未修改任何文件，会话保持原样。`, 5000);
      return;
    }

    // 4. 文件原子落盘写入 (Phase 2 Commit)：
    //    内核 fork 成功后，立即将预检就绪的文件原子写回磁盘
    if (preview.restoreList.length > 0) {
      let restoreResult;
      try {
        restoreResult = await invokeTauri("pi_rollback_files", {
          taskId: task.id,
          targets: preview.restoreList.map((r) => ({
            path: r.path,
            toolCallId: r.toolCallId,
          })),
          dryRun: false,
        });
      } catch (err) {
        toast(`内核会话已回退，但文件写入出错 (${err})`, 4000);
      }
      if (restoreResult?.missing?.length > 0) {
        toast(`内核会话已回退，但 ${restoreResult.missing.length} 个文件写回失败（请检查磁盘权限）`, 4000);
      }
    }

    // 5. 本地状态剪枝与重渲
    const draftQuery = targetTurn?.query || "";
    const originalTurns = task.turns;
    const convIdToSync = task.conversationId || task.id;

    task.turns = task.turns.slice(0, turnIndex);
    task.toolCalls = task.turns.flatMap((t) => t.toolCalls || []);
    task.activeToolName = null;
    task.errorMessage = null;
    task.responseText = task.turns.length > 0 ? task.turns[task.turns.length - 1].responseText || "" : "";
    task.thinkingText = task.turns.length > 0 ? task.turns[task.turns.length - 1].thinkingText || "" : "";
    task.status = "completed";
    task.completedAt = Date.now();
    task.__isRolledBack = true; // 显式标记已回退，防止 restoreTaskToFlow 误从历史记录中幽灵复活旧轮次

    // 核心治理：历史记录服务 (conversationHistoryService) 双向同步
    if (convIdToSync) {
      if (task.turns.length === 0) {
        // 首轮提问回退（会话轮次被剪枝为 0，退化为输入框未发送草稿）：
        // 彻底从历史记录中移除该残留项并解绑，杜绝历史讯息抽屉展示已被撤回的死会话
        conversationHistoryService.deleteConversation(convIdToSync);
        task.conversationId = null;
      } else {
        // 多轮提问回退：同步剪枝历史记录中的轮次与最后回复快照
        conversationHistoryService.pruneConversationTurns(convIdToSync, turnIndex);
      }
    }

    // 文件变更仓剪枝（丢弃回退点之后的日志并重放重建），随后重渲 Flow
    if (typeof api.pruneFileChangesFor === "function") {
      api.pruneFileChangesFor(task.id, turnIndex, originalTurns);
    }

    if (task.turns.length > 0 && typeof api.renderTurnsIntoFlow === "function") {
      api.renderTurnsIntoFlow(task, task.turns, { syncModelName: true });
    } else {
      // 回退至第一轮之前：清空会话流呈现并彻底复位流式状态与导航组件
      if (typeof api.resetFileChanges === "function") api.resetFileChanges();
      if (flow) {
        flow.renderedToolCards?.clear();
        flow.currentSteps = [];
        flow.activeTurnRefs = null;
        flow.currentThinkingText = "";
        flow.currentResponseText = "";
        flow.currentErrorMessage = null;
      }
      flowConversation.innerHTML = "";
      if (typeof api.updateFlowTurnNav === "function") api.updateFlowTurnNav();
      if (typeof api.updateFlowQuestionTip === "function") api.updateFlowQuestionTip();
      taskManager.dispatchEvent(new CustomEvent("tasks-changed", { detail: { tasks: taskManager.getAllTasks() } }));
    }

    // 回退目标轮次的提问回填输入框（fork 语义：该轮回复已丢弃，可编辑后重新发送）
    if (el.searchInput) {
      el.searchInput.value = draftQuery;
      if (typeof api.autoResizeSearchInput === "function") api.autoResizeSearchInput();
      if (typeof api.updateInputState === "function") api.updateInputState();
      el.searchInput.focus();
    }

    const restoredCount = preview.restoreList.length;
    toast(
      restoredCount > 0
        ? `回退成功：已恢复 ${restoredCount} 个文件，会话已回退至第 ${turnIndex + 1} 轮提问处`
        : `回退成功：会话已回退至第 ${turnIndex + 1} 轮提问处`,
      3000
    );
  };

  /** 回退入口：守卫 → 预览 → Preflight 快照预检 → SketchModal 确认 → 执行 */
  const requestFlowRollback = async (turnIndex) => {
    const task = taskManager.getTask(taskManager.currentActiveTaskId);
    if (!task || !Array.isArray(task.turns)) {
      toast("当前没有可回退的活跃会话", 3000);
      return;
    }
    if (isTaskRunning(task)) {
      toast("生成进行中，请等待完成或手动终止后再回退", 3000);
      return;
    }
    if (turnIndex < 0 || turnIndex >= task.turns.length) {
      toast("回退目标轮次无效", 3000);
      return;
    }

    const preview =
      typeof api.collectRollbackPreview === "function"
        ? api.collectRollbackPreview(task.id, turnIndex, task.turns)
        : { restoreList: [], keepAddList: [] };

    // 弹窗前置 Preflight 预检（无副作用校验快照状态与大文件超限）
    let preflightResult = null;
    if (preview.restoreList.length > 0) {
      try {
        preflightResult = await invokeTauri("pi_rollback_files", {
          taskId: task.id,
          targets: preview.restoreList.map((r) => ({
            path: r.path,
            toolCallId: r.toolCallId,
          })),
          dryRun: true,
        });
      } catch (err) {
        console.warn("[Rollback] Preflight check error:", err);
      }
    }

    const missing = preflightResult?.missing || [];
    const tooLargeFiles = missing.filter((m) => m?.reason === "too-large");
    const hasBlocker = missing.length > 0;

    let confirmText = "回退";
    let showCancel = true;
    let messageText = `会话将回退至第 ${turnIndex + 1} 轮提问处：此轮回复与其后的全部对话将被丢弃，提问内容将回填输入框供编辑重发。`;

    if (tooLargeFiles.length > 0) {
      confirmText = "知道了 (无法回退)";
      showCancel = false;
      messageText = `会话无法回退至第 ${turnIndex + 1} 轮提问处：检测到 ${tooLargeFiles.length} 个已修改/已删除文件超过 8MB 快照大小上限，按照安全规范已保守阻止，未做任何修改。`;
    } else if (hasBlocker) {
      confirmText = "知道了 (无法回退)";
      showCancel = false;
      messageText = `会话无法回退至第 ${turnIndex + 1} 轮提问处：存在 ${missing.length} 个无法定位历史快照的文件，按照保守中止规范已阻止。`;
    }

    const modal = new SketchModal({
      type: hasBlocker ? "alert" : "confirm",
      title: hasBlocker ? "无法执行回退 (安全保守阻止)" : "回退到此处？",
      message: messageText,
      detailHtml: buildDetailHtml(preview, preflightResult),
      showCancel: showCancel,
      confirmText: confirmText,
      cancelText: "取消",
      isDanger: !hasBlocker && preview.restoreList.length > 0,
    });
    const confirmed = await modal.open();
    if (!confirmed || hasBlocker) return;

    await performRollback(task, turnIndex, preview);
  };

  // 事件委托：轮次提问卡「回退到此处」按钮（历史轮次与当前轮次统一入口）
  flowConversation.addEventListener("click", (e) => {
    const btn = e.target.closest(".flow-rollback-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const turnIndex = resolveTurnIndex(btn);
    if (turnIndex >= 0) {
      requestFlowRollback(turnIndex);
    }
  });
}
