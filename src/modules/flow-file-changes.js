import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { taskManager } from "../services/task-manager.js";
import { invokeTauri } from "../services/tauri-bridge.js";

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

// 区分显示的矢量图元：新增 ➔ 加号，修改 ➔ 铅笔，删除 ➔ 垃圾桶
const KIND_ICONS = {
  add: ICONS.plus,
  modify: ICONS.edit,
  delete: ICONS.trash,
};

// 串轮过滤铁律：仅收集前台活跃任务的流式事件，后台挂起任务绝不进入前台收纳框
const isForegroundStreamEvent = () =>
  taskManager.isForegroundStreamTask(piClient.lastEventTaskId || null);

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
 * 从 Shell 命令中启发式提取删除目标路径
 * 覆盖 rm / rm -rf a b、del /f a b、Remove-Item 三大族谱，支持多目标与引号路径；
 * 仅返回目标片段，由调用方在命令执行后经存在性复核去伪
 */
const extractDeletedPathsFromCommand = (commandText) => {
  const text = String(commandText || "");
  if (!text) return [];
  const found = [];
  const pushTarget = (raw) => {
    const target = String(raw || "").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    // 过滤选项、通配裸用与过短片段，避免误报
    if (!target || target.length < 2 || target.startsWith("-") || target === "." || target === "..") return;
    if (/^\/[a-z]$/i.test(target)) return; // Windows 开关如 /f /q /s
    found.push(target);
  };
  // 逐 token 解析参数列表：跳过 -x / --xx 选项与 /f 开关，支持引号路径与多目标
  const parseTargets = (argText) => {
    const tokens = String(argText || "").match(/"[^"]*"|'[^']*'|\S+/g) || [];
    for (const token of tokens) {
      // 跳过 -x / --xx 选项；-Path / -LiteralPath 的值按普通目标正常提取
      if (/^-{1,2}[A-Za-z][A-Za-z-]*$/.test(token)) continue;
      pushTarget(token);
    }
  };
  for (const m of text.matchAll(/\brm\s+([^\n;&|]+)/g)) parseTargets(m[1]);
  for (const m of text.matchAll(/Remove-Item\s+([^\n;&|]+)/gi)) parseTargets(m[1]);
  for (const m of text.matchAll(/\bdel\s+([^\n;&|]+)/gi)) parseTargets(m[1]);
  return [...new Set(found)].map(restoreHomePath);
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
    chevronEl: null,
    collapsed: false,
    items: new Map(), // normalized path -> { path, name, dir, kind }
    // toolCallId -> 路径在工具执行前的存在性 (true=已存在, false=新文件, null=探测失败)
    existenceProbes: new Map(),
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

  /** 记录一条文件变更（按路径去重；同一文件保留最新动作，删除为终态优先） */
  const recordFileChange = (toolName, path, existedBefore, forcedKind) => {
    const restored = restoreHomePath(path);
    const key = normalizePathKey(restored);
    if (!key) return;
    const { name, dir } = splitPath(restored);
    const kind = forcedKind || classifyKind(toolName, existedBefore);
    const prev = fileChanges.items.get(key);
    // 合并策略：删除为终态永远胜出；已录入「新增」则保持新增（后续覆盖/编辑不降级）；否则取最新动作
    let mergedKind;
    if (kind === "delete" || (prev && prev.kind === "delete")) {
      mergedKind = "delete";
    } else if ((prev && prev.kind === "add") || kind === "add") {
      mergedKind = "add";
    } else {
      mergedKind = kind;
    }
    fileChanges.items.set(key, {
      path: restored,
      name: name || restored,
      dir,
      kind: mergedKind,
    });
  };

  /* ---------- 框体渲染（复用「注入提示」直角简洁框语汇） ---------- */

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
          <span class="file-changes-icon" aria-hidden="true">${ICONS.edit}</span>
          <span class="file-changes-title">文件变更</span>
          <span class="file-changes-count"></span>
        </button>
        <ul class="file-changes-list"></ul>
      `;
      fileChanges.listEl = fileChanges.boxEl.querySelector(".file-changes-list");
      fileChanges.countEl = fileChanges.boxEl.querySelector(".file-changes-count");
      fileChanges.chevronEl = fileChanges.boxEl.querySelector(".file-changes-chevron");
      fileChanges.boxEl
        .querySelector(".file-changes-header")
        .addEventListener("click", () => {
          fileChanges.collapsed = !fileChanges.collapsed;
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

    fileChanges.countEl.textContent = `${fileChanges.items.size} 个文件`;
    fileChanges.listEl.innerHTML = "";
    for (const item of fileChanges.items.values()) {
      const li = document.createElement("li");
      li.className = "file-change-item";
      li.dataset.path = item.path;
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.title = `点击打开所在文件夹\n${item.path}`;
      const kindClass = item.kind === "add" ? "kind-add" : item.kind === "delete" ? "kind-delete" : "kind-modify";
      li.innerHTML = `
        <span class="file-change-kind ${kindClass}">
          <span class="file-change-kind-icon" aria-hidden="true">${KIND_ICONS[item.kind] || ""}</span>
          ${KIND_LABELS[item.kind] || "修改"}
        </span>
        <span class="file-change-name">${escapeHtml(item.name)}</span>
        ${item.dir ? `<span class="file-change-dir">${escapeHtml(item.dir)}</span>` : ""}
        <span class="file-change-folder" aria-hidden="true">${ICONS.folder}</span>
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
  // 删除目标候选并探测执行前存在性，与执行后复核配对去伪
  piClient.addEventListener("tool-start", (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail || {};
    const toolName = String(data.toolName || "").trim().toLowerCase();
    const isWriteTool = FILE_WRITE_TOOLS.has(toolName);
    const isShellTool = SHELL_TOOLS.has(toolName);
    if (!isWriteTool && !isShellTool) return;

    const candidates = isShellTool
      ? extractDeletedPathsFromCommand(extractCommandText(data.args))
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

  // 工具结束：仅在执行成功时收集文件变更（失败的工具调用视为未发生）
  piClient.addEventListener("tool-end", async (e) => {
    if (!isForegroundStreamEvent()) return;
    const data = e.detail || {};
    if (data.isError) return;
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
        recordFileChange(toolName, path, null, "delete");
      }
      return;
    }

    // Shell 类工具：启发式解析 rm / del / Remove-Item 删除目标，
    // 仅当「执行前已存在且执行后消失」（或执行前探测失败但执行后消失）
    // 才记为删除，杜绝从未存在路径与未实际执行删除的误报
    if (isShellTool) {
      const candidates = extractDeletedPathsFromCommand(extractCommandText(data.args));
      if (candidates.length === 0) return;
      for (const path of candidates) {
        const existedBefore = Array.isArray(probeEntries)
          ? (probeEntries.find((entry) => entry?.path === path)?.existed ?? null)
          : null;
        invokeTauri("pi_path_exists", { path })
          .then((existsAfter) => {
            if (existsAfter || !isForegroundStreamEvent()) return;
            if (existedBefore === false) return; // 执行前就不存在，非本次删除
            recordFileChange(toolName, path, null, "delete");
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
      recordFileChange(toolName, path, existedBefore);
    }
  });

  /* ---------- 对外 API ---------- */

  /** 会话完成（agent-end 正常收尾）后展示文件变更收纳框 */
  api.showFileChangesBox = () => {
    if (fileChanges.items.size === 0) return;
    renderFileChangesBox();
  };

  /** 全新会话时重置文件变更收纳框（DOM 随 flowConversation 清空一并移除） */
  api.resetFileChanges = () => {
    fileChanges.boxEl = null;
    fileChanges.listEl = null;
    fileChanges.countEl = null;
    fileChanges.chevronEl = null;
    fileChanges.collapsed = false;
    fileChanges.items.clear();
    fileChanges.existenceProbes.clear();
  };
}
