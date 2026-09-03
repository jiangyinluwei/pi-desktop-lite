/**
 * 手绘草图质感自定义下拉框组件 (Sketch Select Dropdown)
 * 特性：
 * 1. 迅速触发的弹出微抖动动效（Pop & Micro-Shake，约 180ms 快速回弹）；
 * 2. 边框、底色、字色自适应 Warm Oatmeal Paper（浅色）与 Charcoal Blackboard（深色）双模主题；
 * 3. 极简隐藏式细窄滚动条；
 * 4. 与原生 <select> 保持 100% 双向数据同步、MutationObserver 动态选项感知及事件派发；
 * 5. 支持键盘方向键导航、Enter 选中、Esc / 点击外部 / 右键 (Step Back) 快速收起。
 */

const CHEVRON_DOWN_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6 L8 10 L12 6" /></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" /></svg>`;

// 全局已打开的下拉框引用
let activeDropdown = null;

// 点击外部关闭全局监听
document.addEventListener("pointerdown", (e) => {
  if (activeDropdown && !activeDropdown.wrapper.contains(e.target)) {
    activeDropdown.close();
  }
});

// 监听 Esc 键关闭
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeDropdown) {
    activeDropdown.close();
    e.stopPropagation();
  }
});

// 全局注册右键回退拦截
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    if (typeof window.__piRegisterStepBack === "function") {
      window.__piRegisterStepBack(() => {
        if (activeDropdown) {
          activeDropdown.close();
          return true; // 拦截并消耗当前回退
        }
        return false;
      });
    }
  });

  window.addEventListener("pi:step-back", (e) => {
    if (activeDropdown) {
      activeDropdown.close();
      e.preventDefault();
    }
  });
}

export class SketchSelect {
  /**
   * @param {HTMLSelectElement} nativeSelect
   */
  constructor(nativeSelect) {
    if (!nativeSelect || nativeSelect.__sketchSelect) {
      return nativeSelect?.__sketchSelect;
    }

    this.nativeSelect = nativeSelect;
    this.nativeSelect.__sketchSelect = this;

    this.isOpen = false;
    this.highlightedIndex = -1;

    this._buildUI();
    this._bindEvents();
    this._observeMutations();
  }

  _buildUI() {
    // 隐藏原生 select
    this.nativeSelect.classList.add("sketch-native-hidden");
    this.nativeSelect.setAttribute("tabindex", "-1");
    this.nativeSelect.setAttribute("aria-hidden", "true");

    // 创建外层包装
    this.wrapper = document.createElement("div");
    this.wrapper.className = "sketch-select-wrapper";
    if (this.nativeSelect.id) {
      this.wrapper.setAttribute("data-for-id", this.nativeSelect.id);
    }
    if (this.nativeSelect.className) {
      const extraClasses = this.nativeSelect.className
        .replace("flat-select", "")
        .replace("sketch-native-hidden", "")
        .trim();
      if (extraClasses) {
        this.wrapper.classList.add(extraClasses);
      }
    }

    // 代理 value 属性到原生 select，防止外部 querySelector 选中 wrapper 时 .value 丢失
    Object.defineProperty(this.wrapper, "value", {
      get: () => this.nativeSelect.value,
      set: (val) => {
        this.nativeSelect.value = val;
        this.syncValueFromNative();
      },
      configurable: true,
      enumerable: true
    });

    // 触发器按钮
    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "sketch-select-trigger";
    this.trigger.setAttribute("role", "combobox");
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.disabled = this.nativeSelect.disabled;

    this.valueSpan = document.createElement("span");
    this.valueSpan.className = "sketch-select-value";

    this.arrowSpan = document.createElement("span");
    this.arrowSpan.className = "sketch-select-arrow";
    this.arrowSpan.innerHTML = CHEVRON_DOWN_SVG;

    this.trigger.appendChild(this.valueSpan);
    this.trigger.appendChild(this.arrowSpan);

    // 下拉菜单面板
    this.dropdown = document.createElement("div");
    this.dropdown.className = "sketch-select-dropdown";
    this.dropdown.setAttribute("role", "listbox");
    this.dropdown.setAttribute("tabindex", "-1");

    this.wrapper.appendChild(this.trigger);
    this.wrapper.appendChild(this.dropdown);

    // 插入 DOM：替换或插入到原生 select 前面，并将原生 select 放入 wrapper
    const parent = this.nativeSelect.parentNode;
    if (parent) {
      parent.insertBefore(this.wrapper, this.nativeSelect);
      this.wrapper.appendChild(this.nativeSelect);
    }

    // 拦截 value 与 selectedIndex 的 setter，确保代码直接赋值时自动同步 UI
    const self = this;
    const proto = HTMLSelectElement.prototype;
    const origValueDesc = Object.getOwnPropertyDescriptor(proto, "value");
    const origIndexDesc = Object.getOwnPropertyDescriptor(proto, "selectedIndex");

    if (origValueDesc && origValueDesc.set) {
      Object.defineProperty(this.nativeSelect, "value", {
        get() {
          return origValueDesc.get.call(this);
        },
        set(v) {
          origValueDesc.set.call(this, v);
          self._updateSelectedFromNative();
        },
        configurable: true,
      });
    }

    if (origIndexDesc && origIndexDesc.set) {
      Object.defineProperty(this.nativeSelect, "selectedIndex", {
        get() {
          return origIndexDesc.get.call(this);
        },
        set(i) {
          origIndexDesc.set.call(this, i);
          self._updateSelectedFromNative();
        },
        configurable: true,
      });
    }

    this.syncOptions();
  }

  _bindEvents() {
    // 触发器点击展开/收起
    this.trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });

    // 触发器键盘交互
    this.trigger.addEventListener("keydown", (e) => {
      if (this.trigger.disabled) return;

      if (e.key === "ArrowDown" || e.key === "Down") {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          this._navigateHighlight(1);
        }
      } else if (e.key === "ArrowUp" || e.key === "Up") {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          this._navigateHighlight(-1);
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (this.isOpen) {
          if (this.highlightedIndex >= 0 && this.optionsElements[this.highlightedIndex]) {
            this.selectOption(this.optionsElements[this.highlightedIndex].dataset.value);
          } else {
            this.close();
          }
        } else {
          this.open();
        }
      } else if (e.key === "Escape" || e.key === "Tab") {
        if (this.isOpen) {
          this.close();
          if (e.key === "Escape") e.stopPropagation();
        }
      }
    });

    // 原生 select 变化监听（比如外部代码触发 select.value = 'xxx' 并 dispatch change）
    this.nativeSelect.addEventListener("change", () => {
      this._updateSelectedFromNative();
    });
  }

  _observeMutations() {
    // 监听原生 select 子元素（options）变更
    this.mutationObserver = new MutationObserver(() => {
      this.syncOptions();
    });

    this.mutationObserver.observe(this.nativeSelect, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    // 关联外部 label 点击聚焦
    if (this.nativeSelect.id) {
      const labels = document.querySelectorAll(`label[for="${this.nativeSelect.id}"]`);
      labels.forEach((label) => {
        label.addEventListener("click", (e) => {
          e.preventDefault();
          this.toggle();
          this.trigger.focus();
        });
      });
    }
  }

  /**
   * 同步选项与当前选中值
   */
  syncOptions() {
    this.dropdown.innerHTML = "";
    this.optionsElements = [];

    this.trigger.disabled = this.nativeSelect.disabled;
    const options = Array.from(this.nativeSelect.options);

    if (options.length > 0 && this.nativeSelect.selectedIndex < 0) {
      this.nativeSelect.selectedIndex = 0;
    }

    let selIdx = this.nativeSelect.selectedIndex;
    if (selIdx < 0 && options.length > 0) {
      selIdx = 0;
    }
    const currentSelectedOpt = options[selIdx];

    this.valueSpan.textContent = currentSelectedOpt ? currentSelectedOpt.text : "请选择...";

    options.forEach((opt, idx) => {
      const isSelected = idx === selIdx || opt.selected;
      const item = document.createElement("div");
      item.className = "sketch-select-option" + (isSelected ? " selected" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", isSelected ? "true" : "false");
      item.setAttribute("data-value", opt.value);
      item.setAttribute("data-index", idx);

      const textSpan = document.createElement("span");
      textSpan.className = "sketch-option-text";
      textSpan.textContent = opt.text;

      const checkSpan = document.createElement("span");
      checkSpan.className = "sketch-option-check";
      checkSpan.innerHTML = CHECK_SVG;

      item.appendChild(textSpan);
      item.appendChild(checkSpan);

      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectOption(opt.value);
      });

      item.addEventListener("mouseenter", () => {
        this._setHighlightedIndex(idx, false);
      });

      this.dropdown.appendChild(item);
      this.optionsElements.push(item);
    });

    this._updateSelectedFromNative();
  }

  _updateSelectedFromNative() {
    const options = Array.from(this.nativeSelect.options);
    if (!options.length) {
      this.valueSpan.textContent = "请选择...";
      return;
    }

    let selIdx = this.nativeSelect.selectedIndex;
    const currentVal = this.nativeSelect.value;

    if (selIdx < 0 || selIdx >= options.length) {
      if (currentVal) {
        selIdx = options.findIndex((o) => o.value === currentVal);
      }
      if (selIdx < 0) selIdx = 0;
      this.nativeSelect.selectedIndex = selIdx;
    }

    const selectedOpt = options[selIdx];
    this.valueSpan.textContent = selectedOpt ? selectedOpt.text : (options[0]?.text || "请选择...");

    const effectiveVal = selectedOpt ? selectedOpt.value : (currentVal || options[0]?.value || "");

    this.optionsElements.forEach((el, idx) => {
      const isSelected = el.dataset.value === effectiveVal || idx === selIdx;
      el.classList.toggle("selected", isSelected);
      el.setAttribute("aria-selected", isSelected ? "true" : "false");
      if (isSelected) {
        this.highlightedIndex = idx;
      }
    });
  }

  _navigateHighlight(direction) {
    if (!this.optionsElements.length) return;
    let next = this.highlightedIndex + direction;
    if (next < 0) next = this.optionsElements.length - 1;
    if (next >= this.optionsElements.length) next = 0;
    this._setHighlightedIndex(next, true);
  }

  _setHighlightedIndex(index, shouldScroll = false) {
    this.highlightedIndex = index;
    this.optionsElements.forEach((el, idx) => {
      el.classList.toggle("highlighted", idx === index);
    });
    if (shouldScroll && this.optionsElements[index]) {
      this.optionsElements[index].scrollIntoView({ block: "nearest" });
    }
  }

  selectOption(val) {
    if (this.nativeSelect.value !== val) {
      this.nativeSelect.value = val;
      this.nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      this.nativeSelect.dispatchEvent(new Event("input", { bubbles: true }));
    }
    this._updateSelectedFromNative();
    this.close();
    this.trigger.focus();
  }

  open() {
    if (this.isOpen || this.trigger.disabled) return;

    if (activeDropdown && activeDropdown !== this) {
      activeDropdown.close();
    }

    this.isOpen = true;
    activeDropdown = this;

    this.wrapper.classList.add("open");
    this.trigger.setAttribute("aria-expanded", "true");

    // 默认高亮当前选中项并滚动进入视野
    const currentVal = this.nativeSelect.value;
    const activeIdx = this.optionsElements.findIndex((el) => el.dataset.value === currentVal);
    this._setHighlightedIndex(activeIdx >= 0 ? activeIdx : 0, true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (activeDropdown === this) {
      activeDropdown = null;
    }

    this.wrapper.classList.remove("open");
    this.trigger.setAttribute("aria-expanded", "false");
    this.optionsElements.forEach((el) => el.classList.remove("highlighted"));
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  destroy() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
    if (activeDropdown === this) {
      activeDropdown = null;
    }
    if (this.wrapper && this.wrapper.parentNode) {
      this.nativeSelect.classList.remove("sketch-native-hidden");
      this.nativeSelect.removeAttribute("tabindex");
      this.nativeSelect.removeAttribute("aria-hidden");
      this.wrapper.parentNode.insertBefore(this.nativeSelect, this.wrapper);
      this.wrapper.remove();
    }
    delete this.nativeSelect.__sketchSelect;
  }
}

/**
 * 为指定 select 元素启用手绘草图下拉组件
 * @param {HTMLSelectElement|string} target
 * @returns {SketchSelect|null}
 */
export const enhanceSelect = (target) => {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el || !(el instanceof HTMLSelectElement)) return null;
  return new SketchSelect(el);
};

/**
 * 为容器内所有 .flat-select 启用手绘草图下拉组件
 * @param {HTMLElement|Document} [root=document]
 */
export const enhanceAllSelects = (root = document) => {
  const selects = root.querySelectorAll("select.flat-select");
  selects.forEach((sel) => {
    enhanceSelect(sel);
  });
};
