/**
 * 手绘草图质感模态弹窗系统 (SketchModal)
 * 特性：
 * 1. 严格居中固定于软件框体正中心（Fixed Center Layout）；
 * 2. 具备手绘草图美学（1.4px 实墨描边、自然有机不对称圆角、纸质微投影）；
 * 3. 弹出微抖动动效（Pop & Micro-Shake，约 180ms 灵动回弹）；
 * 4. 半透明毛玻璃微模糊背景遮罩（Backdrop Filter Blur）；
 * 5. 全域右键 (Step Back)、Esc、点击外部与 Enter 快捷键全面支持；
 * 6. 内置焦点管理与键盘 Tab 循环陷阱（Focus Trap）；
 * 7. 支持 info, success, warning, error, confirm 多种语义化类型与手绘 SVG 图标；
 * 8. 适配 Warm Oatmeal Paper（浅色）与 Charcoal Blackboard（深色）双模主题。
 */

// 内联手绘矢量 SVG 图标定义（全量 currentColor 适配双模）
const ICONS = {
  info: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 C4.4 1.5, 1.5 4.4, 1.5 8 C1.5 11.6, 4.4 14.5, 8 14.5 C11.6 14.5, 14.5 11.6, 14.5 8 C14.5 4.4, 11.6 1.5, 8 1.5 Z" /><circle cx="8" cy="5.2" r="0.65" fill="currentColor" stroke="none" /><line x1="8" y1="7.6" x2="8" y2="11.4" /></svg>`,
  success: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 C4.4 1.5, 1.5 4.4, 1.5 8 C1.5 11.6, 4.4 14.5, 8 14.5 C11.6 14.5, 14.5 11.6, 14.5 8 C14.5 4.4, 11.6 1.5, 8 1.5 Z" /><path d="M4.8 8.2 L7 10.4 L11.2 5.8" /></svg>`,
  warning: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 L1.5 13.5 L14.5 13.5 Z" /><line x1="8" y1="6" x2="8" y2="9.5" /><circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" /></svg>`,
  error: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 C4.4 1.5, 1.5 4.4, 1.5 8 C1.5 11.6, 4.4 14.5, 8 14.5 C11.6 14.5, 14.5 11.6, 14.5 8 C14.5 4.4, 11.6 1.5, 8 1.5 Z" /><line x1="5.5" y1="5.5" x2="10.5" y2="10.5" /><line x1="10.5" y1="5.5" x2="5.5" y2="10.5" /></svg>`,
  confirm: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 C4.4 1.5, 1.5 4.4, 1.5 8 C1.5 11.6, 4.4 14.5, 8 14.5 C11.6 14.5, 14.5 11.6, 14.5 8 C14.5 4.4, 11.6 1.5, 8 1.5 Z" /><path d="M6.2 5.8 C6.4 4.5, 7.5 3.8, 8.5 4 C9.5 4.2, 10.1 5.1, 9.8 6.1 C9.5 7.1, 8.2 7.6, 8 8.6" /><circle cx="8" cy="11.2" r="0.65" fill="currentColor" stroke="none" /></svg>`,
  close: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5" /><line x1="12.5" y1="3.5" x2="3.5" y2="12.5" /></svg>`
};

const DEFAULT_TITLES = {
  info: "操作提示",
  success: "操作成功",
  warning: "温馨提示",
  error: "错误提示",
  confirm: "操作确认"
};

// 存储当前活跃的模态弹窗实例栈
const activeModals = [];

// 全局注册 Step-Back 优先拦截
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    if (typeof window.__piRegisterStepBack === "function") {
      window.__piRegisterStepBack(() => {
        if (activeModals.length > 0) {
          const topModal = activeModals[activeModals.length - 1];
          topModal.dismiss(topModal.options.type === "confirm" ? false : null);
          return true; // 拦截并消耗该回退事件
        }
        return false;
      });
    }
  });

  window.addEventListener("pi:step-back", (e) => {
    if (activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      topModal.dismiss(topModal.options.type === "confirm" ? false : null);
      e.preventDefault();
    }
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export class SketchModal {
  constructor(options = {}) {
    this.options = {
      title: options.title || DEFAULT_TITLES[options.type || "info"] || "提示",
      message: options.message || "",
      detail: options.detail || null,
      type: options.type || "info", // info | success | warning | error | confirm
      okText: options.okText || "确定",
      confirmText: options.confirmText || options.okText || "确定",
      cancelText: options.cancelText || "取消",
      showCancel: options.showCancel || false,
      isDanger: options.isDanger || false,
      isPrompt: options.isPrompt || false,
      defaultValue: options.defaultValue || "",
      placeholder: options.placeholder || "",
      closeOnBackdrop: options.closeOnBackdrop !== false,
      closeOnStepBack: options.closeOnStepBack !== false,
      ...options
    };

    this.overlay = null;
    this.card = null;
    this.inputEl = null;
    this.confirmBtn = null;
    this.cancelBtn = null;
    this.closeBtn = null;
    this.previousActiveElement = null;
    this._resolve = null;
    this._isClosing = false;
  }

  /**
   * 弹出模态窗口并返回 Promise
   */
  open() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this.previousActiveElement = document.activeElement;

      this._buildDOM();
      this._bindEvents();

      document.body.appendChild(this.overlay);
      activeModals.push(this);

      // 请求下一帧激活显示以触发过渡动效
      requestAnimationFrame(() => {
        if (this.overlay) {
          this.overlay.classList.add("visible");
        }
        // 自动聚焦操作项
        if (this.options.isPrompt && this.inputEl) {
          this.inputEl.focus();
          this.inputEl.select();
        } else if (this.options.isDanger && this.cancelBtn) {
          // 危险操作优先聚焦取消按钮以防误按
          this.cancelBtn.focus();
        } else if (this.confirmBtn) {
          this.confirmBtn.focus();
        }
      });
    });
  }

  _buildDOM() {
    const {
      title,
      message,
      detail,
      type,
      confirmText,
      cancelText,
      showCancel,
      isDanger,
      isPrompt,
      defaultValue,
      placeholder
    } = this.options;

    // 外层居中遮罩
    const overlay = document.createElement("div");
    overlay.className = "sketch-modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "sketch-modal-title");

    const iconSvg = ICONS[type] || ICONS.info;

    // 手绘卡片框体
    const card = document.createElement("div");
    card.className = `sketch-modal-card type-${type}`;

    // 头部区域
    const header = document.createElement("div");
    header.className = "sketch-modal-header";
    header.innerHTML = `
      <div class="sketch-modal-title-group">
        <span class="sketch-modal-icon ${type}">${iconSvg}</span>
        <h3 class="sketch-modal-title" id="sketch-modal-title">${escapeHtml(title)}</h3>
      </div>
      <button type="button" class="sketch-modal-close-btn" aria-label="关闭" title="关闭 (Esc / 右键)">
        ${ICONS.close}
      </button>
    `;

    // 内容主体区域
    const body = document.createElement("div");
    body.className = "sketch-modal-body";

    const msgEl = document.createElement("div");
    msgEl.className = "sketch-modal-message";
    msgEl.textContent = message; // 纯文本，自动处理换行
    body.appendChild(msgEl);

    if (detail) {
      const detailEl = document.createElement("pre");
      detailEl.className = "sketch-modal-detail";
      detailEl.textContent = typeof detail === "object" ? JSON.stringify(detail, null, 2) : String(detail);
      body.appendChild(detailEl);
    }

    if (isPrompt) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "sketch-modal-input";
      input.value = defaultValue || "";
      input.placeholder = placeholder || "";
      input.autocomplete = "off";
      input.autocorrect = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      body.appendChild(input);
      this.inputEl = input;
    }

    // 底部操作栏
    const footer = document.createElement("div");
    footer.className = "sketch-modal-footer";

    if (showCancel || isPrompt) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "sketch-modal-btn cancel";
      cancelBtn.textContent = cancelText;
      footer.appendChild(cancelBtn);
      this.cancelBtn = cancelBtn;
    }

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = `sketch-modal-btn confirm ${isDanger ? "danger" : "primary"}`;
    confirmBtn.textContent = confirmText;
    footer.appendChild(confirmBtn);
    this.confirmBtn = confirmBtn;

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);

    overlay.appendChild(card);

    this.overlay = overlay;
    this.card = card;
    this.closeBtn = header.querySelector(".sketch-modal-close-btn");
  }

  _bindEvents() {
    let isConfirming = false;
    const handleConfirm = async () => {
      if (this._isClosing || isConfirming) return;
      if (typeof this.options.onConfirm === "function") {
        try {
          isConfirming = true;
          if (this.confirmBtn) this.confirmBtn.disabled = true;
          const result = await this.options.onConfirm(this);
          if (result === false) {
            isConfirming = false;
            if (this.confirmBtn) this.confirmBtn.disabled = false;
            return;
          }
          this.dismiss(result !== undefined ? result : true);
        } catch (err) {
          console.warn("[SketchModal] onConfirm error:", err);
          isConfirming = false;
          if (this.confirmBtn) this.confirmBtn.disabled = false;
          return;
        }
        return;
      }
      if (this.options.isPrompt) {
        this.dismiss(this.inputEl ? this.inputEl.value : "");
      } else if (this.options.type === "confirm") {
        this.dismiss(true);
      } else {
        this.dismiss(true);
      }
    };

    // 确认按钮
    if (this.confirmBtn) {
      this.confirmBtn.addEventListener("click", () => {
        handleConfirm();
      });
    }

    // 取消按钮
    if (this.cancelBtn) {
      this.cancelBtn.addEventListener("click", () => {
        this.dismiss(this.options.type === "confirm" ? false : null);
      });
    }

    // 头部关闭按钮
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", () => {
        this.dismiss(this.options.type === "confirm" ? false : null);
      });
    }

    // 遮罩点击关闭
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && this.options.closeOnBackdrop) {
        this.dismiss(this.options.type === "confirm" ? false : null);
      }
    });

    // 模态内全域右键 -> 拦截并关闭当前弹窗
    this.overlay.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dismiss(this.options.type === "confirm" ? false : null);
    });

    // 键盘事件处理 (Esc / Enter / Tab 焦点循环)
    this._keydownHandler = (e) => {
      if (activeModals[activeModals.length - 1] !== this) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss(this.options.type === "confirm" ? false : null);
      } else if (e.key === "Enter") {
        // 如果焦点在取消按钮上，回车触发取消；否则触发确认
        if (document.activeElement === this.cancelBtn) {
          e.preventDefault();
          this.dismiss(this.options.type === "confirm" ? false : null);
        } else {
          e.preventDefault();
          handleConfirm();
        }
      } else if (e.key === "Tab") {
        this._trapFocus(e);
      }
    };

    window.addEventListener("keydown", this._keydownHandler, true);
  }

  _trapFocus(e) {
    const focusableElements = this.card.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex="0"]'
    );
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        lastElement.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    }
  }

  /**
   * 关闭并移除模态窗口
   */
  dismiss(result) {
    if (this._isClosing) return;
    this._isClosing = true;

    // 从栈中移除
    const idx = activeModals.indexOf(this);
    if (idx !== -1) {
      activeModals.splice(idx, 1);
    }

    if (this._keydownHandler) {
      window.removeEventListener("keydown", this._keydownHandler, true);
    }

    if (this.overlay) {
      this.overlay.classList.remove("visible");
      this.overlay.classList.add("closing");

      setTimeout(() => {
        if (this.overlay && this.overlay.parentNode) {
          this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.card = null;

        // 恢复之前的聚焦元素
        if (
          this.previousActiveElement &&
          typeof this.previousActiveElement.focus === "function" &&
          document.body.contains(this.previousActiveElement)
        ) {
          try {
            this.previousActiveElement.focus();
          } catch (_) {}
        }

        if (this._resolve) {
          this._resolve(result);
          this._resolve = null;
        }
      }, 140);
    } else if (this._resolve) {
      this._resolve(result);
      this._resolve = null;
    }
  }
}

/**
 * 便捷方法：弹出手绘提示弹窗 (Alert)
 * @param {string} message 提示文案
 * @param {object} [options] 配置项（如 title, type, detail, okText）
 * @returns {Promise<void>}
 */
export function sketchAlert(message, options = {}) {
  const modal = new SketchModal({
    message: String(message || ""),
    type: options.type || "info",
    title: options.title || DEFAULT_TITLES[options.type || "info"] || "操作提示",
    showCancel: false,
    okText: options.okText || "确定",
    confirmText: options.okText || "确定",
    ...options
  });
  return modal.open().then(() => {});
}

/**
 * 便捷方法：弹出手绘确认弹窗 (Confirm)
 * @param {string} message 确认文案
 * @param {object} [options] 配置项（如 title, type, confirmText, cancelText, isDanger）
 * @returns {Promise<boolean>} 返回 true (确认) 或 false (取消/关闭)
 */
export function sketchConfirm(message, options = {}) {
  const modal = new SketchModal({
    message: String(message || ""),
    type: options.type || "confirm",
    title: options.title || DEFAULT_TITLES.confirm,
    showCancel: true,
    confirmText: options.confirmText || "确定",
    cancelText: options.cancelText || "取消",
    isDanger: options.isDanger !== undefined ? options.isDanger : false,
    ...options
  });
  return modal.open();
}

/**
 * 便捷方法：弹出手绘输入提示弹窗 (Prompt)
 * @param {string} message 提示文案
 * @param {string} [defaultValue=""] 默认值
 * @param {object} [options] 配置项
 * @returns {Promise<string|null>} 返回输入内容字符串或 null (取消)
 */
export function sketchPrompt(message, defaultValue = "", options = {}) {
  const modal = new SketchModal({
    message: String(message || ""),
    type: options.type || "info",
    title: options.title || "请输入",
    showCancel: true,
    isPrompt: true,
    defaultValue: String(defaultValue || ""),
    placeholder: options.placeholder || "",
    confirmText: options.confirmText || "确定",
    cancelText: options.cancelText || "取消",
    ...options
  });
  return modal.open();
}

// 自动挂载至全局 window 对象，并优雅增强原生方法
if (typeof window !== "undefined") {
  window.sketchAlert = sketchAlert;
  window.sketchConfirm = sketchConfirm;
  window.sketchPrompt = sketchPrompt;
  window.SketchModal = SketchModal;

  // 优雅代理原生 alert 与 confirm，防止未捕获的原生弹窗出现
  const _rawAlert = window.alert;
  window.alert = function (msg) {
    console.warn("[SketchModal] Native alert() intercepted, delegating to sketchAlert:", msg);
    sketchAlert(msg);
  };

  const _rawConfirm = window.confirm;
  window.confirm = function (msg) {
    console.warn("[SketchModal] Native confirm() is synchronous but SketchModal is async. Please use await sketchConfirm(). Returning sketchConfirm promise proxy.");
    return sketchConfirm(msg);
  };
}
