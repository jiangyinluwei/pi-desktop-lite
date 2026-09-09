/**
 * pi-rollback-guard — Pi Desktop Lite 会话回退文件快照守卫
 *
 * 作用机制（与桌面端「Flow 会话回退」功能配合）：
 * - 桌面端 (Rust) 启动 Pi 内核时注入环境变量 PI_DL_ROLLBACK=1；
 * - 本扩展在 `tool_call` 事件（工具真正执行前、可阻塞阶段）确定性快照
 *   目标文件的「执行前内容」，先于任何写入/删除落盘，杜绝竞态；
 * - 快照以 JSONL 追加写入 `~/.pi-dl/rollback/<sessionId>/snapshots.jsonl`，
 *   每行 { ts, sessionId, toolCallId, toolName, path, contentB64 }；
 * - 桌面端回退时按 (path, toolCallId) 精确匹配最早快照，将被撤回轮次的
 *   「修改 / 删除」文件还原到变更前内容（新增文件不撤回）。
 *
 * 安全边界：
 * - 未检测到 PI_DL_ROLLBACK=1 时完全静默退出，不影响任何原生 pi 使用场景；
 * - 单文件 > 8MB 不快照（防止大文件撑爆磁盘）；单会话快照总量 64MB 封顶；
 * - 快照只读文件内容，绝不修改模型入参，绝不阻塞/拦截工具执行。
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const ENABLED = process.env.PI_DL_ROLLBACK === "1";
const ROLLBACK_ROOT = path.join(os.homedir(), ".pi-dl", "rollback");
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 单文件快照上限 8MB
const MAX_SESSION_BYTES = 64 * 1024 * 1024; // 单会话快照总量上限 64MB
const MAX_DIR_FILES = 500; // 单目录递归快照文件数上限（防炸）
const MAX_DIR_DEPTH = 8; // 递归深度上限

/** 与桌面端前端 extractFilePaths 保持一致的路径键集合 */
const PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "TargetPath",
  "TargetFile",
  "AbsolutePath",
  "filename",
  "file",
];
/** 多文件入参子结构键（multi_replace_file_content / apply_patch 等） */
const SUBFILE_KEYS = ["edits", "files", "changes"];
/** Shell 类工具名（删除目标内嵌于命令文本） — 兼容 default.bash 等命名空间前缀 */
const SHELL_TOOLS = new Set([
  "bash",
  "powershell",
  "cmd",
  "shell",
  "terminal",
  "run_command",
  "execute_command",
  "run_in_terminal",
  "execute_bash",
]);

const REDACTED_HOME_TOKEN = "[USER_HOME]";

/** 去除首尾引号（" / '）—— cd 带引号路径的核心修复，杜绝 "C:/path" 解析为畸形 base */
const stripQuotes = (s: string) => String(s || "").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "").trim();
/** 兼容命名空间前缀的 Shell 工具判定（如 default.bash → bash） */
const isShellToolName = (name: string) => {
  const n = String(name || "").toLowerCase();
  if (SHELL_TOOLS.has(n)) return true;
  const base = n.split(".").pop() || n;
  if (SHELL_TOOLS.has(base)) return true;
  const colonBase = base.split(":").pop() || base;
  return SHELL_TOOLS.has(colonBase);
};

const expandHomeToken = (p: string) => {
  const raw = String(p || "");
  if (!raw.includes(REDACTED_HOME_TOKEN)) return raw;
  return raw.split(REDACTED_HOME_TOKEN).join(os.homedir());
};

/** 单进程内存态：会话快照量计数 + 会话血缘已记录标记 */
let sessionBytes = 0;
let recordedLineage = false;

const normalizeAbs = (p: string, cwd: string) => {
  let s = String(p || "").trim();
  if (!s) return "";
  s = s.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
  if (!s) return "";
  s = expandHomeToken(s);
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    s = path.join(os.homedir(), s.slice(1));
  }
  if (!s) return "";
  if (!path.isAbsolute(s) && cwd) {
    s = path.resolve(cwd, s);
  }
  return path.resolve(s);
};

/** 从工具入参提取候选文件路径（对象 / JSON 字符串兼容，含字符串数组子结构） */
const extractInputPaths = (input: any): string[] => {
  let obj: any = input;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return [];
    }
  }
  if (!obj || typeof obj !== "object") return [];
  const found: string[] = [];
  for (const key of PATH_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) found.push(v.trim());
  }
  for (const subKey of SUBFILE_KEYS) {
    if (Array.isArray(obj[subKey])) {
      for (const sub of obj[subKey]) {
        if (typeof sub === "string" && sub.trim()) {
          found.push(sub.trim());
        } else if (sub && typeof sub === "object") {
          for (const key of PATH_KEYS) {
            const v = sub[key];
            if (typeof v === "string" && v.trim()) found.push(v.trim());
          }
        }
      }
    }
  }
  return found;
};

/** 判断是否为 glob 模式 */
const isGlobPattern = (p: string) => /[*?\[\]]/.test(p);

/** 简易 glob 转 RegExp（* -> .*, ? -> ., 保留字符类 []） */
const globToRegExp = (glob: string) => {
  let re = "";
  let inBracket = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "[" ) { inBracket = true; re += c; }
    else if (c === "]") { inBracket = false; re += c; }
    else if (inBracket) { re += c; }
    else if (c === "*") { re += ".*"; }
    else if (c === "?") { re += "."; }
    else if ("+.^$|(){}".includes(c)) { re += "\\" + c; }
    else if (c === "\\") { re += "\\\\"; }
    else { re += c; }
  }
  return new RegExp("^" + re + "$", "i");
};

/** 展开单层 glob：仅处理同目录下通配（** 递归除外，退化为目录递归快照） */
const expandGlob = async (absPattern: string): Promise<string[]> => {
  try {
    // 递归通配 **：退化为递归目录快照
    if (absPattern.includes("**")) {
      const base = absPattern.split("**")[0].replace(/[/\\]+$/, "") || path.dirname(absPattern);
      const files = await collectFilesRecursive(base, MAX_DIR_FILES, MAX_DIR_DEPTH);
      return files;
    }
    const dir = path.dirname(absPattern);
    const baseName = path.basename(absPattern);
    if (!isGlobPattern(baseName)) return [];
    const re = globToRegExp(baseName);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const matched: string[] = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (re.test(ent.name)) matched.push(path.join(dir, ent.name));
    }
    return matched;
  } catch {
    return [];
  }
};

/** 递归收集目录下所有文件（广度优先，带文件数/深度上限） */
const collectFilesRecursive = async (
  dir: string,
  maxFiles = MAX_DIR_FILES,
  maxDepth = MAX_DIR_DEPTH
): Promise<string[]> => {
  const out: string[] = [];
  const queue: Array<{ p: string; depth: number }> = [{ p: dir, depth: 0 }];
  const seen = new Set<string>();
  while (queue.length > 0 && out.length < maxFiles) {
    const { p, depth } = queue.shift()!;
    if (depth > maxDepth) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(p, ent.name);
      const key = full.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (ent.isDirectory()) {
          queue.push({ p: full, depth: depth + 1 });
        } else if (ent.isFile()) {
          out.push(full);
          if (out.length >= maxFiles) break;
        }
      } catch {
        // ignore
      }
    }
  }
  return out;
};

/** 从 Shell 命令文本启发式提取删除目标（rm / del / Remove-Item 家族 + cd 链路 + 扩展家族） */
const extractShellDeleteTargets = (commandText: string, cwd: string): string[] => {
  const text = String(commandText || "");
  if (!text) return [];
  const found: string[] = [];
  const isAbsoluteLike = (p: string) => /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\");
  const normalizeMsys = (p: string) => {
    const m = String(p || "").match(/^\/(?:mnt\/)?([a-z])\/(.+)$/i);
    if (!m) return p;
    return `${m[1].toUpperCase()}:/${m[2]}`;
  };
  const resolveTarget = (raw: string, base: string) => {
    let s = String(raw || "").trim();
    if (!s) return "";
    s = expandHomeToken(s);
    if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
      s = path.join(os.homedir(), s.slice(1));
    }
    s = normalizeMsys(s);
    if (isAbsoluteLike(s)) return s;
    const effBase = base || cwd || "";
    return effBase ? path.resolve(effBase, s) : "";
  };
  const parseTargets = (argText: string, base: string) => {
    // PowerShell Remove-Item 支持逗号分隔多目标："a","b" → 空格化后再 tokenize
    const sanitized = String(argText || "").replace(/,/g, " ");
    const tokens = sanitized.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    for (const token of tokens) {
      if (/^-{1,2}[A-Za-z][A-Za-z-]*$/.test(token)) continue;
      const target = token.replace(/^"|"$/g, "").replace(/^'|'$/g, "").replace(/^,+|,+$/g, "");
      if (!target || target.length < 1 || target.startsWith("-") || target === "." || target === "..") continue;
      if (/^\/[a-z]$/i.test(target)) continue;
      // 过滤重定向符号与管道残片
      if (/^[<>|]+$/.test(target)) continue;
      const resolved = resolveTarget(target, base);
      if (resolved) found.push(resolved);
    }
  };
  // 覆盖 rm / rmdir / unlink / del / rd / erase / Remove-Item 全族
  const patterns: Array<{ re: RegExp; strip?: RegExp }> = [
    { re: /\brm\s+(.+)$/gi },
    { re: /\brmdir\s+(.+)$/gi },
    { re: /\bunlink\s+(.+)$/gi },
    { re: /\bRemove-Item\s+(.+)$/gi },
    { re: /\bdel\s+(.+)$/gi },
    { re: /\berase\s+(.+)$/gi },
    { re: /\brd\s+(.+)$/gi },
  ];
  const segments = text.split(/&&|\|\||[;|\n]/);
  let currentBase = "";
  for (const segRaw of segments) {
    const seg = String(segRaw || "").trim();
    if (!seg) continue;
    const cdMatch = seg.match(/^(?:cd|chdir|set-location)(?:\s+|$)(.*)$/i);
    if (cdMatch) {
      let s = String(cdMatch[1] || "").trim().replace(/^\/d\s+/i, "");
      s = stripQuotes(s);
      s = expandHomeToken(s);
      if (!s || s === "~") {
        currentBase = os.homedir();
      } else if (isAbsoluteLike(normalizeMsys(s))) {
        currentBase = normalizeMsys(s);
      } else if (currentBase) {
        currentBase = path.resolve(currentBase, normalizeMsys(s));
      } else if (s.startsWith("~/") || s.startsWith("~\\")) {
        currentBase = path.join(os.homedir(), s.slice(1));
      } else {
        currentBase = cwd ? path.resolve(cwd, normalizeMsys(s)) : "";
      }
      continue;
    }
    for (const { re } of patterns) {
      // Reset lastIndex for global regex reuse per segment
      re.lastIndex = 0;
      for (const m of seg.matchAll(re)) parseTargets(m[1], currentBase);
    }
  }
  return [...new Set(found)];
};

/** 追加一行快照（会话总量封顶保护） */
const appendSnapshot = async (sessionDir: string, record: Record<string, any>) => {
  try {
    await fsp.mkdir(sessionDir, { recursive: true });
    const line = JSON.stringify(record) + "\n";
    if (sessionBytes + Buffer.byteLength(line) > MAX_SESSION_BYTES) return;
    await fsp.appendFile(path.join(sessionDir, "snapshots.jsonl"), line, "utf8");
    sessionBytes += Buffer.byteLength(line);
  } catch {
    // 快照失败不阻塞工具执行
  }
};

export default function (pi: any) {
  if (!ENABLED) return;

  // 会话启动：记录血缘（fork/clone 产生新会话文件时保持快照链可追溯）
  pi.on("session_start", async (event: any, ctx: any) => {
    try {
      sessionBytes = 0;
      recordedLineage = false;
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (!sessionId) return;
      const parentFile =
        event?.previousSessionFile ||
        (() => {
          try {
            const first = fs.readFileSync(ctx.sessionManager.getSessionFile(), "utf8").split("\n")[0];
            const header = JSON.parse(first);
            return header?.parentSession || "";
          } catch {
            return "";
          }
        })();
      if (parentFile && !recordedLineage) {
        const parentSessionId = path.basename(String(parentFile)).replace(/\.jsonl$/i, "");
        if (parentSessionId && parentSessionId !== sessionId) {
          await fsp.mkdir(ROLLBACK_ROOT, { recursive: true });
          await fsp.appendFile(
            path.join(ROLLBACK_ROOT, "lineage.jsonl"),
            JSON.stringify({ session: sessionId, parent: parentSessionId }) + "\n",
            "utf8"
          );
          recordedLineage = true;
        }
      }
    } catch {
      // 血缘记录失败不影响运行
    }
  });

  // 工具调用前确定性快照（tool_call 可阻塞、先于 execute 执行）
  pi.on("tool_call", async (event: any, ctx: any) => {
    try {
      const toolName = String(event?.toolName || "").toLowerCase();
      const toolCallId = String(event?.toolCallId || "");
      if (!toolCallId) return;
      const cwd = ctx.cwd || process.cwd();
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (!sessionId) return;

      let candidates = extractInputPaths(event?.input)
        .map((p) => normalizeAbs(p, cwd))
        .filter(Boolean);

      if (isShellToolName(toolName)) {
        let rawInput: any = event?.input;
        if (typeof rawInput === "string") {
          try { rawInput = JSON.parse(rawInput); } catch { rawInput = {}; }
        }
        const commandText =
          rawInput?.command ?? rawInput?.cmd ?? rawInput?.script ?? "";
        candidates.push(
          ...extractShellDeleteTargets(String(commandText), cwd)
        );
      }

      candidates = [...new Set(candidates)];
      if (candidates.length === 0) return;

      const sessionDir = path.join(ROLLBACK_ROOT, sessionId);
      const ts = Date.now();

      const snapshotSingleFile = async (abs: string) => {
        try {
          const stat = await fsp.stat(abs);
          if (!stat.isFile()) return;
          if (stat.size > MAX_FILE_BYTES) {
            await appendSnapshot(sessionDir, {
              ts,
              sessionId,
              toolCallId,
              toolName,
              path: abs,
              contentB64: "",
              tooLarge: true,
            });
            return;
          }
          const buf = await fsp.readFile(abs);
          await appendSnapshot(sessionDir, {
            ts,
            sessionId,
            toolCallId,
            toolName,
            path: abs,
            contentB64: buf.toString("base64"),
            tooLarge: false,
          });
        } catch {
          // ignore missing/unreadable
        }
      };

      for (const abs of candidates) {
        try {
          // 1) glob 模式：展开后逐文件快照
          if (isGlobPattern(abs)) {
            // abs 此时已经是 resolve 后的绝对路径 pattern（如 C:/.../*.log）
            const expanded = await expandGlob(abs);
            if (expanded.length > 0) {
              for (const file of expanded) {
                await snapshotSingleFile(file);
              }
              continue;
            }
            // 若展开为空，回落按普通路径尝试（可能 pattern 本身就是字面路径）
          }

          // 2) 判断是否为目录：递归快照内部全部文件
          let stat: fs.Stats | null = null;
          try {
            stat = await fsp.stat(abs);
          } catch {
            stat = null;
          }
          if (stat && stat.isDirectory()) {
            const files = await collectFilesRecursive(abs, MAX_DIR_FILES, MAX_DIR_DEPTH);
            for (const file of files) {
              // 每个文件单独 snapshotSingleFile 已含 size 校验
              await snapshotSingleFile(file);
            }
            // 同时记录目录存在标记，便于 Rust 侧按前缀恢复
            if (files.length === 0) {
              // 空目录：仍记录一条空内容标记，避免误删后无法感知
              await appendSnapshot(sessionDir, {
                ts,
                sessionId,
                toolCallId,
                toolName,
                path: abs,
                contentB64: "",
                tooLarge: false,
                isDir: true,
              });
            }
            continue;
          }

          // 3) 普通文件快照
          await snapshotSingleFile(abs);
        } catch {
          // 单个候选失败不影响其他
        }
      }
    } catch {
      // 快照总失败兜底：绝不阻塞工具执行
    }
  });
}
