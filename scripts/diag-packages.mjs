/**
 * 临时诊断：对比重构前（git HEAD:src/main.js）与重构后（src/main.js）
 * 打开设置页时的 pi_get_installed_packages 调用与已安装列表渲染结果。
 * 运行: node scripts/diag-packages.mjs old|new
 */
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] || "new";
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

// ---------------------------------------------------------------------------
// DOM / window 桩
// ---------------------------------------------------------------------------
const windowListeners = new Map();
const ipcCalls = [];
const errors = [];

function makeClassList(el) {
  const set = new Set();
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (name, force) => {
      const want = force === undefined ? !set.has(name) : !!force;
      want ? set.add(name) : set.delete(name);
      return want;
    },
    contains: (name) => set.has(name),
    _set: set,
  };
}

function makeEl(id = "stub") {
  const el = {
    id,
    value: "",
    checked: false,
    disabled: false,
    files: [],
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    innerHTML: "",
    textContent: "",
    title: "",
    href: "",
    placeholder: "",
    className: "",
    parentNode: null,
    children: [],
    listeners: {},
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: makeClassList(),
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] ?? null; },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
    },
    remove() {},
    insertAdjacentHTML() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setSelectionRange() {},
    focus() {},
    blur() {},
    click() {
      for (const fn of this.listeners.click || []) fn({ preventDefault() {}, stopPropagation() {}, target: this });
    },
    scrollTo() {},
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
    getContext() { return { font: "", measureText() { return { width: 0 }; } }; },
    syncOptions() {},
    updatePresets() {},
    open() {},
    close() {},
    dismiss() {},
    setMilestones() {},
    step() {},
    stopTimer() {},
    reset() {},
  };
  return el;
}

const elById = new Map();
const getEl = (id) => {
  if (!elById.has(id)) elById.set(id, makeEl(id));
  return elById.get(id);
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
for (const name of ["HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLDivElement", "HTMLButtonElement", "HTMLOptionElement"]) {
  if (!globalThis[name]) globalThis[name] = class {};
}

globalThis.window = globalThis;
globalThis.window.addEventListener = (type, fn) => {
  if (!windowListeners.has(type)) windowListeners.set(type, []);
  windowListeners.get(type).push(fn);
};
globalThis.window.removeEventListener = () => {};
globalThis.window.dispatchEvent = (e) => {
  for (const fn of windowListeners.get(e.type) || []) {
    try { fn(e); } catch (err) { errors.push(`window:${e.type}: ${err?.stack || err}`); }
  }
  return true;
};
globalThis.window.getComputedStyle = () => ({ fontStyle: "normal", fontWeight: "400", fontSize: "15.5px", fontFamily: "inherit" });
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window.__TAURI__ = {
  core: {
    invoke: async (command, args) => {
      ipcCalls.push(command);
      switch (command) {
        case "pi_get_installed_packages":
          return [{ name: "pi-web-access", version: "1.2.3", description: "网络访问组件", hasPreset: true, isPresetApplied: true }];
        case "pi_get_recommended_plugins":
          return [];
        case "pi_search_packages":
          return { packages: [], page: 1, totalCount: 0, totalPages: 0, hasMore: false };
        case "pi_list_sessions":
          return [];
        case "pi_get_state":
          return { model: { provider: "anthropic", id: "claude" }, thinkingLevel: null };
        case "pi_get_official_models_catalog":
          return [];
        case "pi_get_auth_config":
          return {};
        case "pi_get_skill_mappings":
          return [];
        case "pi_get_prompt_history":
          return [];
        case "pi_inspect_file":
          return null;
        default:
          return null;
      }
    },
  },
  event: { listen: async () => Promise.resolve(() => {}) },
};

globalThis.document = {
  body: makeEl("body"),
  documentElement: makeEl("html"),
  activeElement: null,
  visibilityState: "visible",
  hasFocus: () => true,
  addEventListener() {},
  removeEventListener() {},
  createElement: (tag) => makeEl(tag),
  getElementById: (id) => getEl(id),
  querySelector: (sel) => {
    if (sel.includes("settings-tab-content")) return getEl("settings-tab-content");
    if (sel.includes("settings-tab-btn")) return getEl("settings-tab-btn-packages");
    return null;
  },
  querySelectorAll: () => [],
};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};
globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.fetch = async () => { throw new Error("no network in diag"); };

const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 载入目标入口
// ---------------------------------------------------------------------------
let entry = path.join(SRC, "main.js");
if (mode === "old") {
  entry = path.join(SRC, ".tmp-original-main.js");
  if (!fs.existsSync(entry)) throw new Error("missing .tmp-original-main.js (generate from git first)");
}

process.on("unhandledRejection", (err) => errors.push(`unhandledRejection: ${err?.stack || err}`));
process.on("uncaughtException", (err) => errors.push(`uncaughtException: ${err?.stack || err}`));

await import(pathToFileURL(entry));
window.dispatchEvent(new CustomEvent("DOMContentLoaded"));

// 模拟点击设置按钮 -> openSettingsView()
const settingsBtn = getEl("settings-btn");
if (settingsBtn.listeners.click?.length) {
  settingsBtn.click();
} else {
  errors.push("settings-btn has no click listener");
}

await tick(800);

// 再显式触发一次“已安装组件”加载（等价于切换到组件 Tab 时的行为）
if (mode === "new") {
  // 无法直接取 ctx；settings 按钮已触发 openSettingsView，包含 loadInstalledPackages
}

const listEl = getEl("installed-packages-list");
const countEl = getEl("installed-packages-count");

console.log(JSON.stringify({
  mode,
  ipcCalls,
  hasGetInstalledCall: ipcCalls.includes("pi_get_installed_packages"),
  getInstalledCallCount: ipcCalls.filter((c) => c === "pi_get_installed_packages").length,
  installedCountText: countEl.textContent,
  listChildren: listEl.children.length,
  listHtmlSnapshot: String(listEl.innerHTML).slice(0, 200),
  errors,
}, null, 2));

process.exit(0);

function pathToFileURL(p) {
  return "file://" + p.replace(/\\/g, "/");
}
