import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { taskManager } from "../services/task-manager.js";
import { invokeTauri } from "../services/tauri-bridge.js";
import { workspaceService } from "../services/workspace-service.js";

/**
 * Flow 会话文件变更收纳框
 * 模型执行文件写入/编辑类工具时静默收集被「新增 / 修改」的文件，
 * 会话完成后在会话流末尾以独立框体汇总呈现，点击条目可在系统文件管理器
 * 中定位其所在文件夹（Windows 资源管理器高亮选中该文件）。
 */

/** 文件写入类工具（新增 / 覆盖写入） */
const FILE_WRITE_TOOLS = new Set([
  "write",
  "write_file",
  "write_to_file",
  "create_file",
  "save_file",
]);

/** 文件编辑类工具（原地修改） */
const FILE_EDIT_TOOLS = new Set([
  "edit",
  "edit_file",
  "replace_file_content",
  "multi_replace_file_content",
  "apply_patch",
  "apply_diff",
  "str_replace_editor",
  "insert_content",
]);

/** 文件删除类工具（显式删除） */
const FILE_DELETE_TOOLS = new Set([
  "delete_file",
  "remove_file",
  "delete",
  "remove",
  "unlink",
  "trash_file",
  "move_to_trash",
]);

/** Shell 类工具（删除操作通常内嵌在 rm / del / Remove-Item 命令中，需启发式解析） */
const SHELL_TOOLS = new Set(["bash", "powershell", "cmd", "shell", "terminal", "run_command", "execute_command"]);

const KIND_LABELS = {
  add: "新增",
  modify: "修改",
  delete: "删除",
};

// 区分显示的矢量图元：新增 ➔ 加号，修改 ➔ 笔触/铅笔，删除 ➔ 垃圾桶
const KIND_ICONS = {
  add: `<svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="2.5" x2="8" y2="13.5" /><line x1="2.5" y1="8" x2="13.5" y2="8" /></svg>`,
  modify: `<svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5 L13.5 5 L4.5 14 L2 14 L2 11.5 Z" /><path d="M9.5 4 L12 6.5" /></svg>`,
  delete: `<svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 H13.5" /><path d="M5.5 4.5 V3 A1 1 0 0 1 6.5 2 H9.5 A1 1 0 0 1 10.5 3 V4.5" /><path d="M4.5 4.5 L5.2 13.5 H10.8 L11.5 4.5" /><line x1="6.5" y1="7" x2="6.8" y2="11" /><line x1="9.5" y1="7" x2="9.2" y2="11" /></svg>`,
};

// 文件变更专属折角手绘图元（头部展示）
const FILE_CHANGES_HEADER_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5 H9.5 L13 6 V13.5 H3 Z" /><path d="M9.5 2.5 V6 H13" /><line x1="5.5" y1="9" x2="10.5" y2="9" /><line x1="5.5" y1="11.5" x2="8.5" y2="11.5" /></svg>`;


// 事件收集无前台门禁：前后台任务均按 task_id 归入各自会话缓存仓（纯数据，不触碰前台 DOM），
// 前台渲染时机仅限于 agent-end 收尾 (showFileChangesBox) 与回入恢复 (restoreFileChangesFor)
const normalizePathKey = (p) => String(p || "").replace(/\//g, "\\").toLowerCase();

/* ---------- [USER_HOME] 脱敏占位符还原 ---------- */
// 内核事件流在 Rust 侧（src-tauri/src/security/redaction.rs）统一脱敏，
// 真实主目录被替换为字面量 [USER_HOME]，直接用于存在性探测与资源管理器定位全部失效；
// 本模块在路径入桩前统一还原为真实绝对路径（脱敏层本身保持不变）
const REDACTED_HOME_TOKEN = "[USER_HOME]";
let realHomeDir = "";
try {
  invokeTauri("pi_get_home_dir", {})
    .then((home) => {
      realHomeDir = String(home || "");
    })
    .catch(() => {});
} catch {
  // invokeTauri 未就绪时静默降级：保持原样，后续点击仍可重试还原
}

const restoreHomePath = (p) => {
  const raw = String(p || "");
  if (!raw || !realHomeDir || !raw.includes(REDACTED_HOME_TOKEN)) return raw;
  return raw.split(REDACTED_HOME_TOKEN).join(realHomeDir);
};

/** 从工具入参中提取文件绝对路径（兼容对象 / JSON 字符串与多文件入参结构） */
const extractFilePaths = (args) => {
  if (!args) return [];
  let argObj = args;
  if (typeof args === "string") {
    try {
      argObj = JSON.parse(args);
    } catch {
      return [];
    }
  }
  if (typeof argObj !== "object" || !argObj) return [];

  const PATH_KEYS = ["path", "file_path", "filePath", "TargetPath", "TargetFile", "AbsolutePath", "filename", "file"];
  const collectFrom = (obj) => {
    const found = [];
    if (!obj || typeof obj !== "object") return found;
    for (const key of PATH_KEYS) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) found.push(value.trim());
    }
    return found;
  };

  const paths = collectFrom(argObj);
  // multi_replace_file_content / apply_patch 等多文件入参结构
  for (const subKey of ["edits", "files", "changes"]) {
    if (Array.isArray(argObj[subKey])) {
      for (const sub of argObj[subKey]) {
        paths.push(...collectFrom(sub));
      }
    }
  }
  return [...new Set(paths)].map(restoreHomePath);
};

/** 从 Shell 类工具入参中提取命令文本（command / cmd / script） */
const extractCommandText = (args) => {
  if (!args) return "";
  let argObj = args;
  if (typeof args === "string") {
    try {
      argObj = JSON.parse(args);
    } catch {
      return args;
    }
  }
  if (typeof argObj !== "object" || !argObj) return "";
  for (const key of ["command", "cmd", "script"]) {
    if (typeof argObj[key] === "string") return argObj[key];
  }
  return "";
};
/**
 * 从 Shell 类工具入参中启发式提取删除目标路径（工作目录感知版）
 * 覆盖 rm / rm -rf a b、del /f a b、Remove-Item 三大族谱，支持多目标与引号路径；
 * 仅返回归一化后的目标候选，由调用方在命令执行后经存在性复核去伪。
 *
 * ⚠️ 工作目录铁律：内核 Shell 的实际 CWD 与桌面端进程 CWD 完全不同（模型常写
 * `cd <dir> && rm <相对路径>` 或 MSYS 风格 `/c/Users/...`），直接送 Rust
 * `pi_path_exists` 会全部解析失败 → existedBefore=false → 删除被去伪规则误杀。
 * 故此处按命令文本内的 `cd` 链路 + `~` 展开 + MSYS 盘符转换 + 会话 CWD（路由工作区）
 * 兜底，把每个删除目标归一化为绝对路径后再返回。
 *
 * @param {string} commandText Shell 命令文本
 * @param {{ home: string, sessionCwd: string }} [baseDirs] 基准目录（home = 真实主目录，sessionCwd = 内核会话 CWD）
 * @returns {string[]} 归一化后的删除目标候选路径（尽力而为，解析失败退化为原文）
 */
const extractDeletedPathsFromCommand = (commandText, baseDirs = { home: realHomeDir, sessionCwd: sessionCwdDir }) => {
  const text = String(commandText || "");
  if (!text) return [];
  const found = [];

  // —— 路径归一化工具 ——
  /** 展开 ~ 与 [USER_HOME] 占位符 */
  const expandHome = (p) => {
    let s = restoreHomePath(String(p || "").trim());
    if (!s) return s;
    const home = baseDirs.home || "";
    if (home && (s === "~" || s.startsWith("~/") || s.startsWith("~\\"))) {
      s = home + s.slice(1);
    }
    return s;
  };
  /** MSYS / Git-Bash 风格路径转换：/c/Users/x → C:/Users/x（/mnt/c/ 同理） */
  const normalizeMsys = (p) => {
    const m = String(p || "").match(/^\/(?:mnt\/)?([a-z])\/(.+)$/i);
    if (!m) return p;
    return `${m[1].toUpperCase()}:/${m[2]}`;
  };
  /** 是否类 Windows 绝对路径（盘符 / UNC） */
  const isAbsoluteLike = (p) => /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\");
  /** 以 base 为基准拼接相对路径（消化 ./ 与 ../） */
  const joinWithBase = (base, rel) => {
    const parts = `${base.replace(/\\/g, "/")}/${rel.replace(/\\/g, "/")}`.split("/");
    const out = [];
    for (const seg of parts) {
      if (!seg || seg === ".") continue;
      if (seg === "..") { out.pop(); continue; }
      out.push(seg);
    }
    return out.join("/");
  };
  /** 单个删除目标归一化：绝对路径原样归一；相对路径按 base（cd 链或会话 CWD）拼接；
   *  无法定基时返回原文（存在性探测自然失败，退化为既有行为，绝不虚报） */
  const resolveTarget = (raw, base) => {
    let s = expandHome(raw);
    if (!s) return "";
    s = normalizeMsys(s);
    if (isAbsoluteLike(s)) return s;
    const effBase = base || baseDirs.sessionCwd || "";
    if (!effBase) return s;
    return joinWithBase(normalizeMsys(expandHome(effBase)), s);
  };
  /** cd 目标归一化（供链路继承）：支持绝对 / 相对 / ~；空 cd 视为回主目录 */
  const resolveCdTarget = (raw, prevBase) => {
    let s = String(raw || "").trim();
    // cmd 风格 `cd /d X` 开关
    s = s.replace(/^\/d\s+/i, "");
    if (!s || s === "~") return expandHome("~");
    s = normalizeMsys(expandHome(s));
    if (isAbsoluteLike(s)) return s;
    const effBase = prevBase || baseDirs.sessionCwd || "";
    return effBase ? joinWithBase(effBase, s) : s;
  };

  const pushTarget = (raw, base) => {
    const target = String(raw || "").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    // 过滤选项、通配裸用与过短片段，避免误报
    if (!target || target.length < 2 || target.startsWith("-") || target === "." || target === "..") return;
    if (/^\/[a-z]$/i.test(target)) return; // Windows 开关如 /f /q /s
    const resolved = resolveTarget(target, base);
    if (resolved) found.push(resolved);
  };
  // 逐 token 解析参数列表：跳过 -x / --xx 选项与 /f 开关，支持引号路径与多目标
  const parseTargets = (argText, base) => {
    const tokens = String(argText || "").match(/"[^"]*"|'[^']*'|\S+/g) || [];
    for (const token of tokens) {
      // 跳过 -x / --xx 选项；-Path / -LiteralPath 的值按普通目标正常提取
      if (/^-{1,2}[A-Za-z][A-Za-z-]*$/.test(token)) continue;
      pushTarget(token, base);
    }
  };

  // —— 按 && / || / ; / | / 换行切段顺序扫描，维护 cd 链路工作目录 ——
  // `cd /c/x && rm f.md`、`cd a; cd b; rm f`、多行脚本 `cd x\nrm f` 全部命中
  const segments = text.split(/&&|\|\||[;|\n]/);
  let currentBase = "";
  for (const segRaw of segments) {
    const seg = String(segRaw || "").trim();
    if (!seg) continue;
    const cdMatch = seg.match(/^(?:cd|chdir|set-location)(?:\s+|$)(.*)$/i);
    if (cdMatch) {
      currentBase = resolveCdTarget(cdMatch[1], currentBase);
      continue;
    }
    for (const m of seg.matchAll(/\brm\s+(.+)$/gi)) parseTargets(m[1], currentBase);
    for (const m of seg.matchAll(/Remove-Item\s+(.+)$/gi)) parseTargets(m[1], currentBase);
    for (const m of seg.matchAll(/\bdel\s+(.+)$/gi)) parseTargets(m[1], currentBase);
  }
  return [...new Set(found)];
};

// 内核会话 CWD（路由工作区物理路径）缓存：Shell 相对路径兜底基准。
// 与 realHomeDir 一致采用惰性加载 + 空值重试；tool-start / tool-end 双侧
// 统一经 loadBaseDirs() 等待取值，保证两侧候选解析结果完全一致（杜绝探测配对错位）
let sessionCwdDir = "";
let sessionCwdLoading = null;
const loadBaseDirs = async () => {
  if (!realHomeDir) {
    try {
      const home = await invokeTauri("pi_get_home_dir", {});
      realHomeDir = String(home || "");
    } catch { /* 保持空，restoreHomePath 退化为原样 */ }
  }
  if (!sessionCwdDir) {
    if (!sessionCwdLoading) {
      sessionCwdLoading = workspaceService.getActiveWorkspace()
        .then((ws) => {
          sessionCwdDir = String(ws?.path || "");
        })
        .catch(() => {
          sessionCwdDir = "";
        })
        .finally(() => {
          sessionCwdLoading = null;
        });
    }
    await sessionCwdLoading;
  }
  return { home: realHomeDir, sessionCwd: sessionCwdDir };
};
const splitPath = (p) => {
  const normalized = String(p || "").replace(/\//g, "\\");
  const index = normalized.lastIndexOf("\\");
  if (index <= 0) return { name: normalized, dir: "" };
  return { name: normalized.slice(index + 1), dir: normalized.slice(0, index) };
};

export function initFileChanges(ctx) {
  const api = ctx.api;
  const el = ctx.el;
  const flow = ctx.flow;

  const flowConversation = el.flowConversation;
  const flowScrollArea = el.flowScrollArea;

  const fileChanges = {
    boxEl: null,
    listEl: null,
    countEl: null,
    pillsEl: null,
    chevronEl: null,
    collapsed: false,
    items: new Map(), // normalized path -> { path, name, dir, kind } (视图态，指向当前活跃会话的缓存仓)
    // toolCallId -> 路径在工具执行前的存在性 (true=已存在, false=新文件, null=探测失败)
    existenceProbes: new Map(),
  };

  // ==========================================================================
  // 会话流缓存（程序生命周期级）：每个 Task 一份独立文件变更仓，直至应用退出才释放。
  // 右键退出 Flow（挂起/归档）后经历史记录 / Task 记录回入时，从对应缓存仓恢复收纳框，
  // 保证呈现与退出前完全一致；后台挂起任务同样持续收集（仅数据，绝不触碰前台 DOM）。
  // ==========================================================================
  const LEGACY_SESSION_KEY = "__current__";
  /** @type {Map<string, { items: Map, collapsed: boolean }>} */
  const sessionStores = new Map();
  let viewKey = null; // 当前视图所指向的会话缓存键

  const ensureStore = (key) => {
    if (!sessionStores.has(key)) {
      sessionStores.set(key, { items: new Map(), collapsed: false });
    }
    return sessionStores.get(key);
  };

  // 事件归属会话键：优先事件帧携带的 task_id，缺省回落当前前台任务（兼容无任务主会话）
  const resolveEventKey = () =>
    piClient.lastEventTaskId || taskManager.currentActiveTaskId || LEGACY_SESSION_KEY;

  // 将视图态对齐到指定会话缓存仓（渲染前必须同步，杜绝跨会话串档）
  const syncViewToStore = (key) => {
    const store = ensureStore(key);
    fileChanges.items = store.items;
    fileChanges.collapsed = store.collapsed;
    viewKey = key;
  };

  const classifyKind = (toolName, existedBefore) => {
    const raw = String(toolName || "").trim().toLowerCase();
    if (FILE_EDIT_TOOLS.has(raw)) return "modify";
    if (FILE_WRITE_TOOLS.has(raw)) {
      if (existedBefore === true) return "modify";
      if (existedBefore === false) return "add";
      return "modify"; // 探测失败时按修改兜底，不虚报新增
    }
    return "modify";
  };

  /** 记录一条文件变更至指定会话缓存仓（按路径去重；同一文件保留最新动作，删除为终态优先） */
  const recordFileChange = (sessionKey, toolName, path, existedBefore, forcedKind) => {
    const restored = restoreHomePath(path);
    const key = normalizePathKey(restored);
    if (!key) return;
    const store = ensureStore(sessionKey);
    const { name, dir } = splitPath(restored);
    const kind = forcedKind || classifyKind(toolName, existedBefore);
    const prev = store.items.get(key);
    // 合并策略：删除为终态永远胜出；已录入「新增」则保持新增（后续覆盖/编辑不降级）；否则取最新动作
    let mergedKind;
    if (kind === "delete" || (prev && prev.kind === "delete")) {
      mergedKind = "delete";
    } else if ((prev && prev.kind === "add") || kind === "add") {
      mergedKind = "add";
    } else {
      mergedKind = kind;
    }
    store.items.set(key, {
      path: restored,
      name: name || restored,
      dir,
      kind: mergedKind,
    });
  };

  /* ---------- 框体渲染（优雅手绘素描质感收纳框） ---------- */

  const ensureBoxEl = () => {
    if (!flowConversation) return null;
    if (!fileChanges.boxEl || !fileChanges.boxEl.isConnected) {
      fileChanges.boxEl = document.createElement("div");
      fileChanges.boxEl.className = "flow-file-changes";
      fileChanges.boxEl.setAttribute("role", "status");
      fileChanges.boxEl.setAttribute("aria-live", "polite");
      fileChanges.boxEl.innerHTML = `
        <button type="button" class="file-changes-header" aria-expanded="true">
          <span class="file-changes-chevron" aria-hidden="true">${ICONS.chevronDown}</span>
          <span class="file-changes-icon" aria-hidden="true">${FILE_CHANGES_HEADER_ICON}</span>
          <span class="file-changes-title">文件变更</span>
          <div class="file-changes-summary">
            <span class="file-changes-summary-pills"></span>
            <span class="file-changes-count"></span>
          </div>
        </button>
        <ul class="file-changes-list"></ul>
      `;
      fileChanges.listEl = fileChanges.boxEl.querySelector(".file-changes-list");
      fileChanges.countEl = fileChanges.boxEl.querySelector(".file-changes-count");
      fileChanges.pillsEl = fileChanges.boxEl.querySelector(".file-changes-summary-pills");
      fileChanges.chevronEl = fileChanges.boxEl.querySelector(".file-changes-chevron");
      fileChanges.boxEl
        .querySelector(".file-changes-header")
        .addEventListener("click", () => {
          fileChanges.collapsed = !fileChanges.collapsed;
          // 折叠态回写会话缓存仓，退出再回入时保持一致
          if (viewKey) ensureStore(viewKey).collapsed = fileChanges.collapsed;
          applyCollapsedState();
        });
      // 事件委托：点击条目在系统文件管理器中打开所在文件夹（定位该文件）
      fileChanges.listEl.addEventListener("click", async (e) => {
        const itemEl = e.target.closest(".file-change-item");
        if (!itemEl) return;
        // 定位目标：删除类文件已不在磁盘，直接打开其原所在文件夹（上级目录），
        // 避免完整路径因父目录解析异常而退化为打开「我的文档」；其余类型高亮定位文件
        const key = normalizePathKey(restoreHomePath(itemEl.dataset.path || ""));
        const item = fileChanges.items.get(key);
        let targetPath = restoreHomePath(itemEl.dataset.path || "");
        if (item && item.kind === "delete" && item.dir) {
          targetPath = item.dir;
        }
        if (!targetPath) return;
        try {
          await invokeTauri("pi_reveal_path", { path: targetPath });
          if (typeof api.showGlobalToast === "function") {
            api.showGlobalToast("已在资源管理器中打开所在文件夹", 1600);
          }
        } catch (err) {
          console.warn("[FileChanges] Reveal path failed:", err);
          if (typeof api.showGlobalToast === "function") {
            api.showGlobalToast(`打开所在文件夹失败: ${err}`, 2200);
          }
        }
      });
      fileChanges.listEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const itemEl = e.target.closest(".file-change-item");
        if (itemEl) itemEl.click();
      });
    }
    return fileChanges.boxEl;
  };

  const applyCollapsedState = () => {
    if (!fileChanges.boxEl) return;
    fileChanges.boxEl.classList.toggle("collapsed", fileChanges.collapsed);
    fileChanges.boxEl
      ?.querySelector(".file-changes-header")
      ?.setAttribute("aria-expanded", fileChanges.collapsed ? "false" : "true");
    if (fileChanges.chevronEl) {
      fileChanges.chevronEl.style.transform = fileChanges.collapsed ? "" : "rotate(180deg)";
    }
  };

  const renderFileChangesBox = () => {
    if (fileChanges.items.size === 0) return;
    const boxEl = ensureBoxEl();
    if (!boxEl) return;

    // 统计各类型变更数量，用于头部紧凑胶囊摘要呈现
    let addCount = 0;
    let modifyCount = 0;
    let deleteCount = 0;
    for (const item of fileChanges.items.values()) {
      if (item.kind === "add") addCount++;
      else if (item.kind === "delete") deleteCount++;
      else modifyCount++;
    }

    if (fileChanges.pillsEl) {
      const pills = [];
      if (addCount > 0) {
        pills.push(`<span class="file-changes-pill pill-add" title="${addCount} 个新增文件">+${addCount} 新增</span>`);
      }
      if (modifyCount > 0) {
        pills.push(`<span class="file-changes-pill pill-modify" title="${modifyCount} 个修改文件">~${modifyCount} 修改</span>`);
      }
      if (deleteCount > 0) {
        pills.push(`<span class="file-changes-pill pill-delete" title="${deleteCount} 个删除文件">-${deleteCount} 删除</span>`);
      }
      fileChanges.pillsEl.innerHTML = pills.join("");
    }

    fileChanges.countEl.textContent = `${fileChanges.items.size} 个文件`;
    fileChanges.listEl.innerHTML = "";
    for (const item of fileChanges.items.values()) {
      const li = document.createElement("li");
      li.className = `file-change-item kind-${item.kind}`;
      li.dataset.path = item.path;
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.title = `点击在系统资源管理器中定位\n${item.path}`;
      const kindClass = item.kind === "add" ? "kind-add" : item.kind === "delete" ? "kind-delete" : "kind-modify";
      li.innerHTML = `
        <div class="file-change-main">
          <span class="file-change-kind ${kindClass}">
            <span class="file-change-kind-icon" aria-hidden="true">${KIND_ICONS[item.kind] || ""}</span>
            <span class="file-change-kind-text">${KIND_LABELS[item.kind] || "修改"}</span>
          </span>
          <span class="file-change-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
          ${item.dir ? `<span class="file-change-dir" title="${escapeHtml(item.dir)}">${escapeHtml(item.dir)}</span>` : ""}
        </div>
        <div class="file-change-action">
          <span class="file-change-action-hint">定位</span>
          <span class="file-change-folder" aria-hidden="true">${ICONS.folder}</span>
        </div>
      `;
      fileChanges.listEl.appendChild(li);
    }
    applyCollapsedState();

    // 框体收纳于会话流末尾（追加即移动到末尾，跨轮次保持置底）
    flowConversation.appendChild(boxEl);
    // 仅吸底跟随开启时随内容定位到底部
    if (flowScrollArea && flow.followBottom !== false) {
      flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
    }
  };

  /* ---------- 事件接入 ---------- */

  // 工具启动：①对文件写入类工具即刻探测路径是否已存在（此时写入尚未发生），
  // 用于在会话完成时精确区分「新增」与「修改」；②对 Shell 类工具预解析
  // 删除目标候选并探测执行前存在性，与执行后复核配对去伪。
  // 前后台任务均收集（纯 IPC 探测，不触碰前台 DOM），后台事件按 task_id 归入各自缓存仓
  piClient.addEventListener("tool-start", async (e) => {
    const data = e.detail || {};
    const toolName = String(data.toolName || "").trim().toLowerCase();
    const isWriteTool = FILE_WRITE_TOOLS.has(toolName);
    const isShellTool = SHELL_TOOLS.has(toolName);
    if (!isWriteTool && !isShellTool) return;

    // 统一等待基准目录（真实主目录 + 内核会话 CWD）就绪后再解析候选，
    // 保证 tool-start 探测与 tool-end 复核的路径归一化结果完全一致
    const baseDirs = await loadBaseDirs();
    const candidates = isShellTool
      ? extractDeletedPathsFromCommand(extractCommandText(data.args), baseDirs)
      : extractFilePaths(data.args);
    if (candidates.length === 0) return;
    // 存储为 Promise：tool-end 时 await 取回「执行前存在性」结果，
    // 消除「探测 IPC 尚未返回而 tool-end 已到」导致的竞态（否则新增文件被误判为修改）
    fileChanges.existenceProbes.set(
      data.toolCallId,
      Promise.all(
        candidates.map(async (p) => {
          try {
            return await invokeTauri("pi_path_exists", { path: p });
          } catch {
            return null;
          }
        })
      ).then((results) => candidates.map((p, i) => ({ path: p, existed: results[i] })))
    );
  });

  // 工具结束：仅在执行成功时收集文件变更（失败的工具调用视为未发生）。
  // 串轮过滤铁律适配：后台挂起任务的变更事件仅写入其会话缓存仓，
  // 绝不触发任何前台 Flow DOM 渲染；回入该会话时由 restoreFileChangesFor 恢复呈现
  piClient.addEventListener("tool-end", async (e) => {
    const data = e.detail || {};
    if (data.isError) return;
    const sessionKey = resolveEventKey();
    const toolName = String(data.toolName || "").trim().toLowerCase();
    const isWriteTool = FILE_WRITE_TOOLS.has(toolName);
    const isEditTool = FILE_EDIT_TOOLS.has(toolName);
    const isDeleteTool = FILE_DELETE_TOOLS.has(toolName);
    const isShellTool = SHELL_TOOLS.has(toolName);
    if (!isWriteTool && !isEditTool && !isDeleteTool && !isShellTool) return;

    // 等待「执行前存在性」探测结果（Promise），避免竞态导致新增被误判为修改
    const probePromise = fileChanges.existenceProbes.get(data.toolCallId);
    fileChanges.existenceProbes.delete(data.toolCallId);
    let probeEntries = null;
    try {
      probeEntries = await Promise.resolve(probePromise);
    } catch {
      probeEntries = null;
    }

    // 显式删除类工具：执行成功即记为删除
    if (isDeleteTool) {
      for (const path of extractFilePaths(data.args)) {
        recordFileChange(sessionKey, toolName, path, null, "delete");
      }
      return;
    }

    // Shell 类工具：启发式解析 rm / del / Remove-Item 删除目标，
    // 仅当「执行前已存在且执行后消失」（或执行前探测失败但执行后消失）
    // 才记为删除，杜绝从未存在路径与未实际执行删除的误报
    if (isShellTool) {
      // 与 tool-start 探测同一基准目录解析，保证两侧候选路径一一配对
      const baseDirs = await loadBaseDirs();
      const candidates = extractDeletedPathsFromCommand(extractCommandText(data.args), baseDirs);
      if (candidates.length === 0) return;
      for (const path of candidates) {
        const existedBefore = Array.isArray(probeEntries)
          ? (probeEntries.find((entry) => entry?.path === path)?.existed ?? null)
          : null;
        invokeTauri("pi_path_exists", { path })
          .then((existsAfter) => {
            if (existsAfter) return;
            if (existedBefore === false) return; // 执行前就不存在，非本次删除
            recordFileChange(sessionKey, toolName, path, null, "delete");
          })
          .catch(() => {});
      }
      return;
    }

    const paths = extractFilePaths(data.args);
    if (paths.length === 0) return;
    for (const path of paths) {
      const existedBefore = Array.isArray(probeEntries)
        ? (probeEntries.find((entry) => entry?.path === path)?.existed ?? null)
        : null;
      recordFileChange(sessionKey, toolName, path, existedBefore);
    }
  });

  /* ---------- 对外 API ---------- */

  /** 会话完成（agent-end 正常收尾）后展示文件变更收纳框 */
  api.showFileChangesBox = () => {
    syncViewToStore(taskManager.currentActiveTaskId || LEGACY_SESSION_KEY);
    if (fileChanges.items.size === 0) return;
    renderFileChangesBox();
  };

  /** 全新会话时重置文件变更收纳框（DOM 随 flowConversation 清空一并移除；会话缓存仓保留） */
  api.resetFileChanges = () => {
    fileChanges.boxEl = null;
    fileChanges.listEl = null;
    fileChanges.countEl = null;
    fileChanges.pillsEl = null;
    fileChanges.chevronEl = null;
    fileChanges.collapsed = false;
    fileChanges.items = new Map();
    fileChanges.existenceProbes.clear();
    viewKey = null;
  };

  /**
   * 会话流缓存铁律：返回 Flow 时恢复指定会话生命周期内收集的文件变更收纳框。
   * 右键退出（挂起/归档）后经历史记录 / Task 记录回入时调用，保证与退出前呈现一致。
   * @param {string} key 会话键（Task ID / conv.taskId）
   * @returns {boolean} 是否成功恢复并渲染
   */
  api.restoreFileChangesFor = (key) => {
    if (!key || !sessionStores.has(key)) return false;
    syncViewToStore(key);
    if (fileChanges.items.size === 0) return false;
    renderFileChangesBox();
    return true;
  };
}
