/**
 * flow-human-input.js — Flow「中途提问人工回归选择」交互层（Human-in-the-Loop Mid-Run Ask-Back）
 *
 * 定位：把 TaskManager 中登记的「未决人工交互请求」（`task.pendingUiRequests`，来自内核
 * Extension UI 子协议 `extension_ui_request`，见 docs/rpc.md §Extension UI Protocol）
 * 变成 Flow 中可作答的手绘交互卡，用户作答后回写 `extension_ui_response` 解除内核阻塞。
 *
 * 呈现形态（设计文档 §3.5）：
 *   - 轮次步骤流内追加「高亮待答横条」（待答 / 已作答 / 已失效 三态定格）；
 *   - 点击横条（或窗口聚焦时自动）呼出 `SketchModal` 作答容器：
 *     select → `SketchSelect`；confirm → 双按钮；input/editor → 单行/多行输入框；
 *   - 带 `timeout` 的请求在横条与弹窗头部展示读秒胶囊（超时由内核按默认值自动解析）。
 *
 * 职责边界：
 *   - 本模块只做「呈现 + 作答回写 + 卡片生命周期」；
 *   - 请求的登记/清除属主是 `src/services/task-manager.js`（Task 状态属主）；
 *   - IPC 转发属主是 `src/services/pi-client.js`（服务层，禁碰 DOM）；
 *   - 横条 DOM 引用归本模块内部缓存（不入 flowView：flowView 已 Object.seal，
 *     且交互卡不属于流式时序步骤切片），未决请求本体始终以 TaskManager 为唯一真源。
 *
 * 铁律对齐（AGENTS.md）：
 *   - 铁律 4/5/7：手绘 SVG 图元（ICONS）、按钮常态透明无边框、SketchModal/SketchSelect 组件套件；
 *   - 铁律 3：未决请求随 Task 挂起保留（`isSuspended`），回入 Flow 由 restoreHumanInputCards
 *     重建；终止时 best-effort 回写 cancelled 并失效卡片；交互未决 = 生成进行中，回退门禁天然覆盖；
 *   - 铁律 9：失焦 Toast 仍由 flow-pipeline 既有逻辑负责，本模块不重复通知；
 *   - 铁律 18：`paused`（UI 阻塞）与「模型异常」严格区分，本模块绝不触碰重连引擎；
 *   - 前台门禁：仅当前台活跃任务渲染卡片，后台任务只保留 TaskManager 数据与抽屉徽标。
 */

import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { bus } from "../lib/event-bus.js";
import { piClient } from "../services/pi-client.js";
import { taskManager } from "../services/task-manager.js";
import { SketchModal } from "../services/sketch-modal.js";
import { SketchSelect } from "../services/sketch-select.js";

/** 已渲染的交互横条（taskId → Map<requestId, barEl>），仅本模块可见。 */
const barRegistry = new Map();

/** 读秒计时器（requestId → intervalId）。 */
const countdownTimers = new Map();

/** 已打开作答弹窗（requestId → SketchModal），供失效通道联动关闭。 */
const openModals = new Map();

/** 各方法的中文友好名与图标。 */
const METHOD_META = {
  select: { label: "请选择一项", icon: ICONS.chat },
  confirm: { label: "请确认是否继续", icon: ICONS.warning },
  input: { label: "请输入内容", icon: ICONS.edit },
  editor: { label: "请编辑文本", icon: ICONS.edit },
};

const methodMeta = (method) => METHOD_META[method] || { label: "请作答", icon: ICONS.chat };

/** 取某 Task 的横条注册表（惰性创建）。 */
function barsFor(taskId) {
  if (!barRegistry.has(taskId)) barRegistry.set(taskId, new Map());
  return barRegistry.get(taskId);
}

/** 清除某请求的读秒计时器。 */
function clearCountdown(requestId) {
  const timer = countdownTimers.get(requestId);
  if (timer) {
    clearInterval(timer);
    countdownTimers.delete(requestId);
  }
}

/** 关闭并清除某请求的作答弹窗引用。 */
function closeModal(requestId) {
  const modal = openModals.get(requestId);
  if (modal) {
    openModals.delete(requestId);
    try {
      modal.dismiss(null);
    } catch (_) {}
  }
}

/**
 * 初始化人工交互作答层。
 * @param {{ api: Record<string, any>, flowView: object, flowDom: object }} ctx
 */
export function initHumanInput(ctx) {
  const api = ctx.api;

  /**
   * 把横条定格为终态（已作答 / 已跳过 / 已自动跳过 / 已失效）。
   * @param {HTMLElement} barEl
   * @param {string} text
   * @param {"done"|"failed"} [state="done"]
   */
  const freezeBar = (barEl, text, state = "done") => {
    if (!barEl || barEl.dataset.frozen === "1") return;
    barEl.dataset.frozen = "1";
    barEl.classList.add("frozen", state === "failed" ? "failed" : "done");
    barEl.classList.remove("pending");
    const actions = barEl.querySelector(".human-input-bar-actions");
    if (actions) actions.remove();
    const countdownEl = barEl.querySelector(".human-input-countdown");
    if (countdownEl) countdownEl.remove();
    const statusEl = barEl.querySelector(".human-input-bar-status");
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = `human-input-bar-status ${state === "failed" ? "failed" : "done"}`;
    }
  };

  /**
   * 提交作答：先同步摘除未决请求并定格横条（杜绝双击双答竞态），再异步回写内核。
   * @param {string} taskId
   * @param {object} request
   * @param {HTMLElement|null} barEl
   * @param {{value?: string, confirmed?: boolean, cancelled?: boolean}} payload
   * @param {string} frozenText
   */
  const submitAnswer = async (taskId, request, barEl, payload, frozenText) => {
    if (barEl?.dataset.frozen === "1") return;
    // 1. 同步摘除 + 定格
    taskManager.takePendingUiRequest(taskId, request.id);
    clearCountdown(request.id);
    closeModal(request.id);
    if (barEl) freezeBar(barEl, frozenText);
    // 2. 异步回写（失败不重试轰炸，仅提示失效）
    try {
      await piClient.sendExtensionUiResponse(taskId, request.id, payload);
    } catch (err) {
      console.warn("[FlowHumanInput] 作答回写失败:", err);
      if (barEl) freezeBar(barEl, "作答未能送达 · 任务已终止", "failed");
      bus.emit("ui:toast", { text: "作答未能送达：该任务已终止或内核已退出", duration: 3200 });
    }
  };

  /**
   * 打开作答弹窗（SketchModal 容器 + 方法专属控件）。
   * @param {string} taskId
   * @param {object} request
   * @param {HTMLElement|null} barEl
   */
  const openAnswerModal = (taskId, request, barEl) => {
    // 已定格 / 已失效的请求不再应答
    if (barEl?.dataset.frozen === "1") return;
    if (!taskManager.getPendingUiRequests(taskId).some((r) => r.id === request.id)) return;
    // 同一请求只保留一个弹窗
    if (openModals.has(request.id)) return;

    const meta = methodMeta(request.method);
    let controlHtml = "";
    if (request.method === "select" && request.options.length > 0) {
      controlHtml = `
        <label class="human-input-field-label" for="human-input-ctl-${escapeHtml(request.id)}">可选方案</label>
        <select id="human-input-ctl-${escapeHtml(request.id)}" class="human-input-select flat-select">
          ${request.options
            .map((opt) => `<option value="${escapeHtml(String(opt))}">${escapeHtml(String(opt))}</option>`)
            .join("")}
        </select>`;
    } else if (request.method === "confirm") {
      controlHtml = `
        <div class="human-input-confirm-row">
          <button type="button" class="human-input-choice" data-answer="yes">确认</button>
          <button type="button" class="human-input-choice" data-answer="no">拒绝</button>
        </div>`;
    } else if (request.method === "editor") {
      controlHtml = `
        <label class="human-input-field-label" for="human-input-ctl-${escapeHtml(request.id)}">文本内容</label>
        <textarea id="human-input-ctl-${escapeHtml(request.id)}" class="human-input-textarea" rows="6"
          placeholder="${escapeHtml(request.placeholder || "")}" spellcheck="false">${escapeHtml(String(request.prefill || ""))}</textarea>`;
    } else {
      controlHtml = `
        <label class="human-input-field-label" for="human-input-ctl-${escapeHtml(request.id)}">输入内容</label>
        <input id="human-input-ctl-${escapeHtml(request.id)}" type="text" class="human-input-text"
          value="${escapeHtml(String(request.prefill || ""))}"
          placeholder="${escapeHtml(request.placeholder || "")}"
          autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />`;
    }

    const modal = new SketchModal({
      type: "confirm",
      title: request.title || meta.label,
      message: request.message || "",
      detailHtml: `<div class="human-input-modal-body">${controlHtml}</div>`,
      confirmText: "提交",
      cancelText: "稍后作答",
      showCancel: true,
      closeOnBackdrop: false,
      closeOnStepBack: true,
      onConfirm: (m) => {
        const root = m.card;
        if (request.method === "select") {
          const sel = root.querySelector(".human-input-select");
          if (!sel) return false;
          return { value: sel.value };
        }
        if (request.method === "confirm") {
          const selected = root.querySelector(".human-input-choice.selected");
          if (!selected) return false;
          return { confirmed: selected.dataset.answer === "yes" };
        }
        const field = root.querySelector(".human-input-text, .human-input-textarea");
        if (!field) return false;
        return { value: field.value };
      },
    });

    openModals.set(request.id, modal);

    // SketchModal.open() 在 Promise 执行器内同步完成 _buildDOM/_bindEvents/appendChild，
    // 故返回时 this.card 已就绪，可直接对控件做二次接线（无需改私有方法）
    const settled = modal.open();
    const root = modal.card;
    if (root) {
      if (request.method === "select") {
        const sel = root.querySelector(".human-input-select");
        if (sel) new SketchSelect(sel);
      } else if (request.method === "confirm") {
        const choices = root.querySelectorAll(".human-input-choice");
        choices.forEach((btn) => {
          btn.addEventListener("click", () => {
            choices.forEach((b) => b.classList.toggle("selected", b === btn));
          });
        });
        const defaultBtn = root.querySelector(
          request.defaultYes ? '[data-answer="yes"]' : '[data-answer="no"]'
        );
        if (defaultBtn) defaultBtn.classList.add("selected");
      } else {
        // input / editor：SketchModal.open() 在自身 requestAnimationFrame 内聚焦「提交」按钮，
        // 故文本控件聚焦必须再延后一帧（注册在其后），否则会被按钮抢回焦点，
        // 用户敲键落到按钮上导致提交空值
        const field = root.querySelector(".human-input-text, .human-input-textarea");
        if (field) {
          requestAnimationFrame(() => {
            field.focus();
            if (typeof field.select === "function" && field.value) field.select();
          });
        }
      }
    }

    settled.then((result) => {
      openModals.delete(request.id);
      // 用户关闭弹窗（稍后作答 / Esc / 右键）→ 请求保持未决，横条仍可点击作答
      if (!result || typeof result !== "object") return;
      const text = result.confirmed === undefined
        ? `已作答：${String(result.value ?? "").slice(0, 24) || "(空)"}`
        : (result.confirmed ? "已作答：确认" : "已作答：拒绝");
      submitAnswer(taskId, request, barEl, result, text);
    });
  };

  /**
   * 前台渲染一条未决交互横条（幂等：同 requestId 不重复建卡）。
   * @param {string} taskId
   * @param {object} request
   */
  const showHumanInputCard = (taskId, request) => {
    if (!taskId || !request?.id) return;
    const registry = barsFor(taskId);
    if (registry.has(request.id)) return;

    const meta = methodMeta(request.method);
    const hasTimeout = typeof request.timeout === "number" && request.timeout > 0;

    const barEl = document.createElement("div");
    barEl.className = "flow-human-input-bar pending";
    barEl.dataset.requestId = request.id;
    barEl.dataset.taskId = taskId;
    barEl.setAttribute("role", "group");
    barEl.setAttribute("aria-label", "模型请求人工介入");
    barEl.innerHTML = `
      <div class="human-input-bar-main" role="button" tabindex="0">
        <span class="human-input-icon" aria-hidden="true">${meta.icon}</span>
        <span class="human-input-bar-title">${escapeHtml(request.title || meta.label)}</span>
        ${hasTimeout ? `<span class="human-input-countdown" role="status" aria-live="polite"></span>` : ""}
        <span class="human-input-bar-status pending">待作答</span>
      </div>
      <div class="human-input-bar-actions">
        <button type="button" class="human-input-btn ghost btn-skip-answer">跳过作答</button>
        <button type="button" class="human-input-btn primary btn-open-answer">作答</button>
      </div>
    `;

    const mainEl = barEl.querySelector(".human-input-bar-main");
    const openBtn = barEl.querySelector(".btn-open-answer");
    const skipBtn = barEl.querySelector(".btn-skip-answer");

    const open = () => openAnswerModal(taskId, request, barEl);
    mainEl.addEventListener("click", open);
    mainEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      open();
    });
    skipBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      submitAnswer(taskId, request, barEl, { cancelled: true }, "已跳过作答");
    });

    // 读秒胶囊（纯状态示意，超时由内核自动按默认值解析，客户端不代答）
    if (hasTimeout) {
      const countdownEl = barEl.querySelector(".human-input-countdown");
      const deadline = request.receivedAt + request.timeout;
      const tick = () => {
        const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        if (countdownEl) countdownEl.textContent = `${remain} 秒后自动跳过`;
        if (remain <= 0) {
          clearCountdown(request.id);
          closeModal(request.id);
          taskManager.takePendingUiRequest(taskId, request.id);
          freezeBar(barEl, "已自动跳过");
          bus.emit("ui:toast", { text: "该提问已超时，内核按默认值继续", duration: 2200 });
        }
      };
      tick();
      countdownTimers.set(request.id, setInterval(tick, 500));
    }

    // 挂载：紧接当前前台轮次的步骤流之后（保持「思维/工具 → 待答横条 → 回答正文」因果时序），
    // 无活跃轮次容器时退化为会话流末尾
    const stepsContainerEl = ctx.flowView?.activeTurnRefs?.stepsContainerEl;
    if (stepsContainerEl) {
      stepsContainerEl.insertAdjacentElement("afterend", barEl);
    } else if (ctx.flowDom?.flowConversation) {
      ctx.flowDom.flowConversation.appendChild(barEl);
    }

    registry.set(request.id, barEl);

    // 窗口处于焦点时自动呼出作答弹窗（用户在场，直接作答；失焦则仅留横条 + 既有 Toast）
    if (typeof document.hasFocus === "function" && document.hasFocus()) {
      open();
    }
  };

  /**
   * 挂起任务回入 Flow 时重建全部未决横条（请求不丢失）。
   * @param {string} taskId
   */
  const restoreHumanInputCards = (taskId) => {
    if (!taskId) return;
    // 先清理该任务残留的旧横条与计时器（renderTurnsIntoFlow 已清空 DOM 时同步复位注册表）
    const registry = barRegistry.get(taskId);
    if (registry) {
      for (const [requestId, el] of registry) {
        clearCountdown(requestId);
        closeModal(requestId);
        el.remove();
      }
      registry.clear();
    }
    if (!taskManager.isForegroundStreamTask(taskId)) return;
    taskManager.getPendingUiRequests(taskId).forEach((req) => showHumanInputCard(taskId, req));
  };

  /**
   * 标记某 Task 全部未决横条失效（终止 / 内核重启 / 轮次收口）。
   * @param {string} taskId
   * @param {string} [reason]
   */
  const invalidateHumanInputCards = (taskId, reason = "该提问已失效") => {
    const registry = barRegistry.get(taskId);
    if (!registry) return;
    for (const [requestId, el] of registry) {
      clearCountdown(requestId);
      closeModal(requestId);
      freezeBar(el, reason, "failed");
    }
  };

  // --------------------------------------------------------------------------
  // 事件接线
  // --------------------------------------------------------------------------

  // 内核发出人工交互请求：仅前台活跃任务渲染横条（后台任务只保留数据 + 抽屉徽标）
  piClient.addEventListener("extension-ui", (e) => {
    const data = e?.detail || {};
    const taskId = data.task_id || data.taskId || taskManager.currentActiveTaskId;
    if (!taskId || !taskManager.isForegroundStreamTask(taskId)) return;
    const match = taskManager.getPendingUiRequests(taskId).find((r) => r.id === data.id);
    if (match) showHumanInputCard(taskId, match);
  });

  // 任务被终止：横条转失效态（未决请求回写 cancelled 已由 TaskManager.abortTask 负责）
  taskManager.addEventListener("task-aborted", (e) => {
    const taskId = e.detail?.id;
    if (taskId) invalidateHumanInputCards(taskId, "任务已终止");
  });

  // 轮次收口 / 任务终态：清理该任务全部横条与计时器
  taskManager.addEventListener("task-updated", (e) => {
    const task = e.detail;
    if (!task?.id) return;
    if (task.status === "completed" || task.status === "error" || task.status === "aborted") {
      invalidateHumanInputCards(task.id, "本轮已结束");
    }
  });

  // 任务销毁：彻底清除横条与缓存
  taskManager.addEventListener("task-removed", (e) => {
    const taskId = e.detail?.taskId;
    if (!taskId) return;
    const registry = barRegistry.get(taskId);
    if (registry) {
      for (const [requestId, el] of registry) {
        clearCountdown(requestId);
        closeModal(requestId);
        el.remove();
      }
      barRegistry.delete(taskId);
    }
  });

  // 内核崩溃 / 重启：全部未决横条失效（内核侧阻塞等待已不复存在）
  piClient.addEventListener("kernel-status-change", (e) => {
    if (e.detail?.hasKernel === false) {
      for (const taskId of barRegistry.keys()) {
        invalidateHumanInputCards(taskId, "内核已退出");
      }
    }
  });

  // --------------------------------------------------------------------------
  // ctx.api 槽位注册（契约登记见 src/lib/contracts.js）
  // --------------------------------------------------------------------------
  api.showHumanInputCard = showHumanInputCard;
  api.restoreHumanInputCards = restoreHumanInputCards;
  api.invalidateHumanInputCards = invalidateHumanInputCards;
}

export default initHumanInput;
