#!/usr/bin/env node
/**
 * check-frontend.js - 前端静态校验门禁（阶段 0 第一交付物）
 *
 * 背景：`npm run check` 只是 `cargo check`，对前端 JS 零校验。本项目无打包器，
 * ESM import 图错误只在运行时白屏才暴露。
 *
 * 本脚本做三件事：
 *   1. 语法校验：对 src 下所有 *.js 逐个执行 `node --check`；
 *   2. import 图解析：校验每个 ESM import 的模块说明符可解析（文件存在）；
 *   3. 循环依赖检测：对 import 图做 DFS 三色染色，发现 back-edge 即报告。
 *
 * 用法：node scripts/check-frontend.js
 * 接入 package.json： "check:fe": "node scripts/check-frontend.js"
 * 退出码：0 = 全部通过；非 0 = 存在语法/引用/循环依赖错误。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(process.cwd(), "src");

/** 递归收集 src 下所有 .js 文件（绝对路径）。排除隐藏目录。 */
function collectJsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      collectJsFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      acc.push(full);
    }
  }
  return acc;
}

const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c);
const isSpace = (c) => /\s/.test(c);

/** 读取一个字符串字面量（从起始引号处开始），返回 { value, end }。 */
function readString(src, start) {
  const q = src[start];
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      value += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === q) return { value, end: i + 1 };
    value += c;
    i += 1;
  }
  return { value, end: i };
}

/** 从 start 处向前扫描，跳过字符串与注释，寻找指定关键字（词边界），返回其索引，找不到返回 -1。 */
function findKeyword(src, start, keyword) {
  const n = src.length;
  let i = start;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = readString(src, i).end;
      continue;
    }
    if (src.startsWith(keyword, i)) {
      const beforeOK = i === 0 || !isWordChar(src[i - 1]);
      const afterOK = i + keyword.length >= n || !isWordChar(src[i + keyword.length]);
      if (beforeOK && afterOK) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * 提取文件的 import 模块说明符数组（相对路径字符串）。
 * 逐字符扫描、感知字符串与注释，仅识别代码层级真正的 import 语句。
 */
function extractImportSpecifiers(src) {
  const specs = new Set();
  const n = src.length;
  let i = 0;
  const keyword = "import";
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = readString(src, i).end;
      continue;
    }
    if (src.startsWith(keyword, i)) {
      const beforeOK = i === 0 || !isWordChar(src[i - 1]);
      const afterOK = i + keyword.length >= n || !isWordChar(src[i + keyword.length]);
      if (beforeOK && afterOK) {
        let j = i + keyword.length;
        while (j < n && isSpace(src[j])) j += 1;
        // 动态 import("x")
        if (src[j] === "(") {
          j += 1;
          while (j < n && isSpace(src[j])) j += 1;
          if (src[j] === '"' || src[j] === "'" || src[j] === "`") {
            const s = readString(src, j);
            specs.add(s.value);
            i = s.end;
            continue;
          }
        }
        // 副作用 import "x"
        if (src[j] === '"' || src[j] === "'") {
          const s = readString(src, j);
          specs.add(s.value);
          i = s.end;
          continue;
        }
        // import ... from "x"
        const fromIdx = findKeyword(src, i, "from");
        if (fromIdx >= 0) {
          let k = fromIdx + "from".length;
          while (k < n && isSpace(src[k])) k += 1;
          if (src[k] === '"' || src[k] === "'") {
            const s = readString(src, k);
            specs.add(s.value);
            i = s.end;
            continue;
          }
        }
      }
    }
    i += 1;
  }
  return [...specs];
}

/** 把相对模块说明符解析为绝对文件路径；返回 null 表示无法解析（非相对或裸标识符）。 */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null; // 裸标识符/绝对包名（本项目应无）
  let target = path.resolve(path.dirname(fromFile), specifier);
  if (!path.extname(target)) target += ".js";
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  if (!path.extname(target)) {
    const idx = path.join(target, "index.js");
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

// ---------- 1. 语法校验 ----------
const files = collectJsFiles(ROOT);
const syntaxFailures = [];
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf-8" });
  if (r.status !== 0) {
    syntaxFailures.push({ file, stderr: r.stderr || r.stdout || "unknown" });
  }
}

// ---------- 2 & 3. import 图解析 + 循环依赖 ----------
const adj = new Map(); // file(绝对路径) -> [依赖绝对路径]
const resolveErrors = [];

for (const file of files) {
  const specifiers = extractImportSpecifiers(fs.readFileSync(file, "utf-8"));
  const deps = [];
  for (const spec of specifiers) {
    const resolved = resolveSpecifier(file, spec);
    if (resolved === null) {
      resolveErrors.push({ from: path.relative(process.cwd(), file), spec });
      continue;
    }
    if (!adj.has(resolved)) adj.set(resolved, []);
    deps.push(resolved);
  }
  if (!adj.has(file)) adj.set(file, []);
  adj.get(file).push(...deps);
}

// DFS 三色染色：0=白(未访问) 1=灰(在栈) 2=黑(完成)
const color = new Map();
const cycles = [];
const stack = [];

function dfs(node) {
  color.set(node, 1);
  stack.push(path.relative(process.cwd(), node));
  for (const dep of adj.get(node) || []) {
    if (!adj.has(dep)) continue;
    const c = color.get(dep) || 0;
    if (c === 1) {
      const idx = stack.indexOf(path.relative(process.cwd(), dep));
      cycles.push([...stack.slice(idx), path.relative(process.cwd(), dep)]);
    } else if (c === 0) {
      dfs(dep);
    }
  }
  stack.pop();
  color.set(node, 2);
}

for (const node of [...adj.keys()]) {
  if (!(color.get(node) || 0)) dfs(node);
}

// ---------- 汇总 ----------
let ok = true;
const lines = [];
lines.push(`前端静态校验门禁，共扫描 ${files.length} 个 .js 文件（src/）`);

if (syntaxFailures.length) {
  ok = false;
  lines.push(`\n[语法错误] ${syntaxFailures.length} 个文件：`);
  for (const f of syntaxFailures) {
    lines.push(`  ✗ ${path.relative(process.cwd(), f.file)}`);
    lines.push(`    ${(f.stderr || "").split("\n").slice(0, 8).join("\n")}`);
  }
}

if (resolveErrors.length) {
  ok = false;
  lines.push(`\n[import 无法解析] ${resolveErrors.length} 处：`);
  for (const e of resolveErrors) {
    lines.push(`  ✗ ${e.from} - "${e.spec}"`);
  }
}

if (cycles.length) {
  ok = false;
  const seen = new Set();
  const dedupCycles = [];
  for (const c of cycles) {
    const norm = [...c].sort().join(" -> ");
    if (!seen.has(norm)) {
      seen.add(norm);
      dedupCycles.push(c);
    }
  }
  lines.push(`\n[循环依赖] ${dedupCycles.length} 个环：`);
  for (const c of dedupCycles) {
    lines.push(`  ✗ ${c.join(" -> ")}`);
  }
}

// ---------- 4. 命名导出与导入有效性校验 ----------
// 启发式正则校验（非完整 AST）：stripComments 会误伤字符串字面量中的 "//"（如 URL），
// 故仅用于导出匹配辅助；误报时以运行时实际表现为准
const missingExports = [];
const stripCommentsCache = new Map();
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}
function getStrippedCode(file) {
  if (!stripCommentsCache.has(file)) {
    stripCommentsCache.set(file, stripComments(fs.readFileSync(file, "utf-8")));
  }
  return stripCommentsCache.get(file);
}

for (const file of files) {
  const code = getStrippedCode(file);
  const importNamedRegex = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importNamedRegex.exec(code)) !== null) {
    const rawNames = m[1];
    const spec = m[2];
    const resolved = resolveSpecifier(file, spec);
    if (!resolved) continue;
    const targetCode = getStrippedCode(resolved);
    const names = rawNames
      .split(",")
      .map((s) => {
        const trimmed = s.trim();
        if (!trimmed) return null;
        return trimmed.split(/\s+as\s+/)[0].trim();
      })
      .filter(Boolean);

    for (const name of names) {
      const exportDeclRegex = new RegExp(
        `export\\s+(?:async\\s+)?(?:function\\*?|const|let|class|var)\\s+${name}\\b`
      );
      // 导出列表要求 name 位于导出项末尾（后随逗号/收尾花括号）：
      // `export { a as x }` 中 a 是本地名而非导出名，不得因 \ba\b 误判为已导出
      const exportListRegex = new RegExp(`export\\s*\\{[^}]*\\b${name}\\s*(?:,[^}]*)?\\}`);
      if (!exportDeclRegex.test(targetCode) && !exportListRegex.test(targetCode)) {
        missingExports.push({
          from: path.relative(process.cwd(), file),
          name,
          spec,
          target: path.relative(process.cwd(), resolved),
        });
      }
    }
  }
}

if (missingExports.length) {
  ok = false;
  lines.push(`\n[命名导出缺失] ${missingExports.length} 处：`);
  for (const item of missingExports) {
    lines.push(`  ✗ ${item.from} 导入了 '${item.name}'，但目标模块 ${item.target} 未导出该标识符`);
  }
}

if (ok) {
  lines.push("\n前端静态校验通过：语法 / import 图可解析 / 命名导出匹配 / 无循环依赖");
} else {
  lines.push("\n前端静态校验未通过，见上方错误。");
}

process.stdout.write(lines.join("\n") + "\n");
process.exit(ok ? 0 : 1);
