import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { bus } from "../lib/event-bus.js";
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
  "new_file",
  "new_empty_editor",
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

/** Shell 类工具（删除操作通常内嵌在 rm / del / Remove-Item 命令中，需启发式解析） — 兼容 default.bash 等命名空间 */
const SHELL_TOOLS = new Set(["bash", "powershell", "cmd", "shell", "terminal", "run_command", "execute_command"]);
const stripQuotes = (s) => String(s || "").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "").trim();

/** 兼容命名空间前缀的工具集匹配（如 default.write / pi:write_file） */
const matchToolSet = (toolSet, name) => {
  const n = String(name || "").trim().toLowerCase();
  if (toolSet.has(n)) return true;
  const base = n.split(".").pop() || n;
  if (toolSet.has(base)) return true;
  const colonBase = base.split(":").pop() || base;
  return toolSet.has(colonBase);
};
const isShellToolName = (name) => matchToolSet(SHELL_TOOLS, name);

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

/** 展开 ~ 与 [USER_HOME] 占位符 */
const expandHome = (p, homeDir = realHomeDir) => {
  let s = restoreHomePath(String(p || "").trim());
  if (!s) return s;
  if (homeDir && (s === "~" || s.startsWith("~/") || s.startsWith("~\\"))) {
    s = homeDir + s.slice(1);
  }
  return s;
};

/** MSYS / Git-Bash 风格路径转换：/c/Users/x → C:/Users/x（/mnt/c/ 同理） */
const normalizeMsys = (p) => {
  const m = String(p || "").match(/^\/(?:mnt\/)?([a-z])\/(.+)$/i);
  if (!m) return p;
  return `${m[1].toUpperCase()}:/${m[2]}`;
};

/** 是否类 Windows 绝对路径（盘符 / UNC / Unix 根路径） */
const isAbsoluteLike = (p) => /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\") || p.startsWith("/");

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

// 内核会话 CWD（路由工作区物理路径）内存同步缓存
let sessionCwdDir = "";
const refreshSessionCwd = () => {
  try {
    workspaceService.getActiveWorkspace()
      .then((ws) => {
        if (ws?.path) sessionCwdDir = String(ws.path);
      })
      .catch(() => {});
  } catch {}
};
refreshSessionCwd();

const getBaseDirsSync = () => {
  if (!sessionCwdDir) refreshSessionCwd();
  return { home: realHomeDir, sessionCwd: sessionCwdDir };
};

/** 将任意相对/绝对/MSYS/Home 路径统一转换为绝对路径 */
const resolveFileToAbs = (raw, sessionCwd = sessionCwdDir) => {
  let s = expandHome(raw);
  if (!s) return "";
  s = normalizeMsys(s);
  if (isAbsoluteLike(s)) return s;
  const effCwd = sessionCwd || sessionCwdDir || "";
  if (!effCwd) return s;
  return joinWithBase(normalizeMsys(expandHome(effCwd)), s);
};

/** 从工具入参中提取文件绝对路径（兼容对象 / JSON 字符串与多文件入参结构，支持相对路径自动定基） */
const extractFilePaths = (args, baseDirs = getBaseDirsSync()) => {
  if (!args) return [];
  let argObj = args;
  if (typeof args === "string") {
    try {
      argObj = JSON.parse(args);
    } catch {
      return [];
    }
  }
  if (!argObj || typeof argObj !== "object") return [];

  const PATH_KEYS = [
    "path",
    "file_path",
    "filePath",
    "TargetPath",
    "TargetFile",
    "target_path",
    "target_file",
    "AbsolutePath",
    "filename",
    "file",
    "destination",
    "dest",
  ];
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
  // multi_replace_file_content / apply_patch 等多文件入参结构（兼容字符串数组与对象数组）
  for (const subKey of ["edits", "files", "changes"]) {
    if (Array.isArray(argObj[subKey])) {
      for (const sub of argObj[subKey]) {
        if (typeof sub === "string" && sub.trim()) {
          paths.push(sub.trim());
        } else {
          paths.push(...collectFrom(sub));
        }
      }
    }
  }
  const effCwd = baseDirs?.sessionCwd || sessionCwdDir || "";
  return [...new Set(paths)].map((p) => resolveFileToAbs(p, effCwd)).filter(Boolean);
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
const extractDeletedPathsFromCommand = (commandText, baseDirs = getBaseDirsSync()) => {
  const text = String(commandText || "");
  if (!text) return [];
  const found = [];

  /** 单个删除目标归一化：绝对路径原样归一；相对路径按 base（cd 链或会话 CWD）拼接 */
  const resolveTarget = (raw, base) => {
    let s = expandHome(raw, baseDirs?.home || realHomeDir);
    if (!s) return "";
    s = normalizeMsys(s);
    if (isAbsoluteLike(s)) return s;
    const effBase = base || baseDirs?.sessionCwd || sessionCwdDir || "";
    if (!effBase) return s;
    return joinWithBase(normalizeMsys(expandHome(effBase, baseDirs?.home || realHomeDir)), s);
  };
  /** cd 目标归一化（供链路继承）：支持绝对 / 相对 / ~；空 cd 视为回主目录 */
  const resolveCdTarget = (raw, prevBase) => {
    let s = String(raw || "").trim();
    // cmd 风格 `cd /d X` 开关
    s = s.replace(/^\/d\s+/i, "");
    s = stripQuotes(s);
    if (!s || s === "~") return expandHome("~", baseDirs?.home || realHomeDir);
    s = normalizeMsys(expandHome(s, baseDirs?.home || realHomeDir));
    if (isAbsoluteLike(s)) return s;
    const effBase = prevBase || baseDirs?.sessionCwd || sessionCwdDir || "";
    return effBase ? joinWithBase(effBase, s) : s;
  };

  const pushTarget = (raw, base) => {
    const target = String(raw || "").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "").replace(/^,+|,+$/g, "").trim();
    // 过滤选项、通配裸用与过短片段，避免误报（单字符文件名如 `a` 需保留，阈值降至 1）
    if (!target || target.length < 1 || target.startsWith("-") || target === "." || target === "..") return;
    if (/^\/[a-z]$/i.test(target)) return; // Windows 开关如 /f /q /s
    if (/^[<>|]+$/.test(target)) return; // 重定向符号残片
    const resolved = resolveTarget(target, base);
    if (resolved) found.push(resolved);
  };
  // 逐 token 解析参数列表：跳过 -x / --xx 选项与 /f 开关，支持引号路径与多目标（逗号分隔兼容 PowerShell）
  const parseTargets = (argText, base) => {
    const sanitized = String(argText || "").replace(/,/g, " ");
    const tokens = sanitized.match(/"[^"]*"|'[^']*'|\S+/g) || [];
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
    for (const m of seg.matchAll(/\brmdir\s+(.+)$/gi)) parseTargets(m[1], currentBase);
    for (const m of seg.matchAll(/\bunlink\s+(.+)$/gi)) parseTargets(m[1], currentBase);
    for (const m of seg.matchAll(/\berase\s+(.+)$/gi)) parseTargets(m[1], currentBase);
    for (const m of seg.matchAll(/\brd\s+(.+)$/gi)) parseTargets(m[1], currentBase);
    for (const m of seg.matchAll(/Remove-Item\s+(.+)$/gi)) parseTargets(m[1], currentBase);
    for (const m of seg.matchAll(/\bdel\s+(.+)$/gi)) parseTargets(m[1], currentBase);
  }
  return [...new Set(found)];
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
      sessionStores.set(key, { items: new Map(), collapsed: false, log: [] });
    }
    return sessionStores.get(key);
  };

  /** 变更类型合并策略（与 recordFileChange 一致，供回退剪枝后重放重建复用）：删除为终态永远胜出；已录入「新增」不降级；否则取最新动作 */
  const mergeKinds = (prevKind, newKind) => {
    if (newKind === "delete" || prevKind === "delete") return "delete";
    if (prevKind === "add" || newKind === "add") return "add";
    return newKind;
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
    if (matchToolSet(FILE_EDIT_TOOLS, raw)) return "modify";
    if (matchToolSet(FILE_WRITE_TOOLS, raw)) {
      if (existedBefore === true) return "modify";
      if (existedBefore === false) return "add";
      // 显式新建语义工具（create_file / new_file）兜底识别为新增
      const base = raw.split(".").pop() || raw;
      if (base.includes("create") || base.includes("new")) return "add";
      return "modify"; // 其余探测失败时按修改兜底，不虚报新增
    }
    return "modify";
  };

  /**
   * 记录一条文件变更至指定会话缓存仓（按路径去重；同一文件保留最新动作，删除为终态优先）。
   * 同步追加逐条变更日志 (store.log, 含 toolCallId / ts)，供「会话回退」精确剪枝与预览。
   */
  const recordFileChange = (sessionKey, toolName, path, existedBefore, forcedKind, toolCallId) => {
    const restored = restoreHomePath(path);
    const key = normalizePathKey(restored);
    if (!key) return;
    const store = ensureStore(sessionKey);
    const { name, dir } = splitPath(restored);
    const kind = forcedKind || classifyKind(toolName, existedBefore);
    // 逐条变更日志（回退预览与剪枝依据，永不合并）
    if (!Array.isArray(store.log)) store.log = [];
    store.log.push({
      key,
      kind,
      toolCallId: toolCallId || "",
      ts: Date.now(),
      path: restored,
    });
    const prev = store.items.get(key);
    const mergedKind = mergeKinds(prev?.kind, kind);
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
          bus.emit("ui:toast", { text: "已在资源管理器中打开所在文件夹", duration: 1600 });
        } catch (err) {
          console.warn("[FileChanges] Reveal path failed:", err);
          bus.emit("ui:toast", { text: `打开所在文件夹失败: ${err}`, duration: 2200 });
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
  piClient.addEventListener("tool-start", (e) => {
    const data = e.detail || {};
    const toolName = String(data.toolName || "").trim().toLowerCase();
    const isWriteTool = matchToolSet(FILE_WRITE_TOOLS, toolName);
    const isShellTool = isShellToolName(toolName);
    if (!isWriteTool && !isShellTool) return;
    if (!data.toolCallId) return;

    // 核心铁律：tool-start 必须纯同步执行并立即向 existenceProbes 登记 Promise，
    // 严禁在此处引入任何 await 导致微任务挂起，杜绝写文件瞬时完成后 tool-end 抢先到达引发竞态！
    const baseDirs = getBaseDirsSync();
    const candidates = isShellTool
      ? extractDeletedPathsFromCommand(extractCommandText(data.args), baseDirs)
      : extractFilePaths(data.args, baseDirs);
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
    const isWriteTool = matchToolSet(FILE_WRITE_TOOLS, toolName);
    const isEditTool = matchToolSet(FILE_EDIT_TOOLS, toolName);
    const isDeleteTool = matchToolSet(FILE_DELETE_TOOLS, toolName);
    const isShellTool = isShellToolName(toolName);
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

    const baseDirs = getBaseDirsSync();

    // 显式删除类工具：执行成功即记为删除
    if (isDeleteTool) {
      for (const path of extractFilePaths(data.args, baseDirs)) {
        recordFileChange(sessionKey, toolName, path, null, "delete", data.toolCallId);
      }
      return;
    }

    // Shell 类工具：启发式解析 rm / del / Remove-Item 删除目标，
    // 仅当「执行前已存在且执行后消失」（或执行前探测失败但执行后消失）
    // 才记为删除，杜绝从未存在路径与未实际执行删除的误报
    if (isShellTool) {
      const candidates = extractDeletedPathsFromCommand(extractCommandText(data.args), baseDirs);
      if (candidates.length === 0) return;
      for (const path of candidates) {
        const normKey = normalizePathKey(path);
        const existedBefore = Array.isArray(probeEntries)
          ? (probeEntries.find((entry) => normalizePathKey(entry?.path) === normKey)?.existed ?? null)
          : null;
        const isGlob = /[*?\[\]]/.test(path);
        invokeTauri("pi_path_exists", { path })
          .then((existsAfter) => {
            if (existsAfter) return;
            // glob 模式字面路径本身不存在属正常，跳过 existedBefore 误杀（由 Rust 侧按通配匹配恢复）
            if (existedBefore === false && !isGlob) return; // 执行前就不存在，非本次删除
            recordFileChange(sessionKey, toolName, path, null, "delete", data.toolCallId);
          })
          .catch(() => {});
      }
      return;
    }

    const paths = extractFilePaths(data.args, baseDirs);
    if (paths.length === 0) return;
    for (const path of paths) {
      const normKey = normalizePathKey(path);
      const existedBefore = Array.isArray(probeEntries)
        ? (probeEntries.find((entry) => normalizePathKey(entry?.path) === normKey)?.existed ?? null)
        : null;
      recordFileChange(sessionKey, toolName, path, existedBefore, null, data.toolCallId);
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

  // ==========================================================================
  // 会话回退：文件撤回预览与剪枝 (与 flow-rollback.js 配套)
  // ==========================================================================

  /**
   * 回退预览：汇总自第 fromIndex 轮（含）之后的全部文件变更，按路径取最早动作分类。
   * 修改/删除 → 待撤回 (携 toolCallId 供快照精确匹配)；新增 → 不可撤回 (防误删铁律)。
   * @param {string} sessionKey 会话键 (Task ID)
   * @param {number} fromIndex 回退目标轮次 (0-based，含该轮)
   * @param {Array<Object>} turns 该会话完整轮次数组
   * @returns {{ restoreList: Array<{path,kind,toolCallId}>, keepAddList: string[] }}
   */
  api.collectRollbackPreview = (sessionKey, fromIndex, turns) => {
    const store = sessionStores.get(sessionKey);
    const restoreList = [];
    const keepAddList = [];
    if (!store || !Array.isArray(store.log) || !Array.isArray(turns)) {
      return { restoreList, keepAddList };
    }
    // 自第 fromIndex 轮（含）起涉及的全部 toolCallId 集合（轮次与事件同源，可精确映射）
    const affectedCallIds = new Set();
    for (let i = Math.max(0, fromIndex); i < turns.length; i++) {
      for (const tool of turns[i]?.toolCalls || []) {
        if (tool?.id) affectedCallIds.add(tool.id);
      }
    }
    // 按路径取最早一条日志（还原内容 = 回退点之后第一次变更前的状态）
    const earliestByKey = new Map();
    for (const entry of store.log) {
      const inRange =
        (entry.toolCallId && affectedCallIds.has(entry.toolCallId)) ||
        (fromIndex >= turns.length) ||
        (turns[fromIndex]?.startedAt != null && entry.ts >= turns[fromIndex].startedAt);
      if (!inRange) continue;
      const prev = earliestByKey.get(entry.key);
      if (!prev || entry.ts < prev.ts) earliestByKey.set(entry.key, entry);
    }
    for (const entry of earliestByKey.values()) {
      if (entry.kind === "add") {
        keepAddList.push(entry.path);
      } else {
        restoreList.push({ path: entry.path, kind: entry.kind, toolCallId: entry.toolCallId });
      }
    }
    restoreList.sort((a, b) => a.path.localeCompare(b.path));
    keepAddList.sort((a, b) => a.localeCompare(b));
    return { restoreList, keepAddList };
  };

  /**
   * 回退剪枝：丢弃指定轮次（含）之后的变更日志，并用剩余日志重放重建合并视图仓。
   * @param {string} sessionKey 会话键
   * @param {number} fromIndex 回退目标轮次 (0-based)
   * @param {Array<Object>} turns 原完整轮次数组 (剪枝前)
   * @returns {boolean} 是否发生剪枝
   */
  api.pruneFileChangesFor = (sessionKey, fromIndex, turns) => {
    const store = sessionStores.get(sessionKey);
    if (!store || !Array.isArray(store.log) || !Array.isArray(turns)) return false;
    const cutoffTs = turns[fromIndex]?.startedAt ?? Date.now() + 1;
    const keptLog = store.log.filter((entry) => entry.ts < cutoffTs);
    if (keptLog.length === store.log.length) return false;
    store.log = keptLog;
    // 重放重建合并视图 (与 recordFileChange 合并策略一致)
    const rebuilt = new Map();
    for (const entry of keptLog) {
      const { name, dir } = splitPath(entry.path);
      const prev = rebuilt.get(entry.key);
      rebuilt.set(entry.key, {
        path: entry.path,
        name: name || entry.path,
        dir,
        kind: mergeKinds(prev?.kind, entry.kind),
      });
    }
    store.items = rebuilt;
    // 当前视图正指向该仓时同步刷新视图态引用
    if (viewKey === sessionKey) {
      fileChanges.items = rebuilt;
    }
    return true;
  };
}
