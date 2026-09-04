#!/usr/bin/env node
/**
 * measure-coupling.js - 耦合度量基线（阶段 0 第二交付物）
 *
 * 自动化 §1 的耦合指标，作为降耦合基线。每阶段跑一次对比，验证「在降」而非「在升」。
 *
 * 指标：
 *   A. 模块全量 ctx 拉取数（el/api/view/settings/flow/attachments 六项全拿）
 *   B. ctx.api 函数槽：唯一函数槽数、注册点数、调用点数
 *   C. 同一 api 函数被多模块重复注册数（>1 个模块注册同一槽）
 *   D. 跨模块 api.* 调用点数（调用方模块 ≠ 注册方模块）
 *   E. 共享状态裸写数（flow./view./settings./attachments. 赋值，含解构后裸名）
 *   F. 存量事件通道：pi:* CustomEvent 同步 dispatchEvent/监听数、window.__piRegisterStepBack 注册数
 *
 * 用法：node scripts/measure-coupling.js [--json]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MODULES_DIR = path.resolve(process.cwd(), "src", "modules");
const SRC_DIR = path.resolve(process.cwd(), "src");
const FIELDS = ["el", "api", "view", "settings", "flow", "attachments"];

function readJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => path.join(dir, e.name));
}

/** 递归收集某个目录下所有 .js 文件（供 src 全量统计）。 */
function collectJs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith(".")) continue;
      collectJs(full, acc);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      acc.push(full);
    }
  }
  return acc;
}

const moduleFiles = readJsFiles(MODULES_DIR);

// A. 全量 ctx 拉取：模块内同时出现 "const X = ctx.X" 六项
const fullPull = [];
for (const file of moduleFiles) {
  const src = fs.readFileSync(file, "utf-8");
  const count = FIELDS.filter((f) =>
    new RegExp(`const\\s+${f}\\s*=\\s*ctx\\.${f}\\s*;`).test(src),
  ).length;
  if (count === FIELDS.length) fullPull.push(path.basename(file));
}

// B/C/D. api 槽注册与调用
const registerMap = new Map(); // slot -> Set(module)
const callMap = new Map(); // module -> Map(slot -> count)
const regRe = /\bapi\.([A-Za-z0-9_$]+)\s*=(?!=)/g; // 排除 == 与 ===
const callRe = /\bapi\.([A-Za-z0-9_$]+)\s*\(/g;

let totalRegistrations = 0;
let totalCalls = 0;

for (const file of moduleFiles) {
  const base = path.basename(file);
  const src = fs.readFileSync(file, "utf-8");
  let m;
  regRe.lastIndex = 0;
  while ((m = regRe.exec(src)) !== null) {
    const slot = m[1];
    if (!registerMap.has(slot)) registerMap.set(slot, new Set());
    registerMap.get(slot).add(base);
    totalRegistrations += 1;
  }
  const moduleCalls = new Map();
  callRe.lastIndex = 0;
  while ((m = callRe.exec(src)) !== null) {
    const slot = m[1];
    moduleCalls.set(slot, (moduleCalls.get(slot) || 0) + 1);
    totalCalls += 1;
  }
  callMap.set(base, moduleCalls);
}

const uniqueSlots = registerMap.size;

// C. 重复注册：同一槽被 >1 个模块注册
const dupSlots = [];
let dupExcess = 0;
for (const [slot, mods] of registerMap) {
  if (mods.size > 1) {
    dupSlots.push({ slot, mods: [...mods] });
    dupExcess += mods.size - 1;
  }
}

// D. 跨模块调用：调用方调用某槽，而该槽的注册方不含调用方
let crossModuleCalls = 0;
const crossDetails = [];
for (const [module, calls] of callMap) {
  for (const [slot, cnt] of calls) {
    const registrars = registerMap.get(slot);
    // 槽未被任何模块注册（或仅被自己注册）——从「跨模块」视角：
    // 若注册方不包含调用方，则视为跨模块调用
    if (!registrars || !registrars.has(module)) {
      crossModuleCalls += cnt;
      crossDetails.push(`${module} -> api.${slot}(x${cnt >= 1 ? "" : ""})`);
    }
  }
}

// E. 共享状态裸写（解构后裸名访问赋值）
const bareWriteRe = /\b(flow|view|settings|attachments)\.([A-Za-z0-9_$]+)\s*=[^=]/g;
let bareWrites = 0;
const bareByField = { flow: 0, view: 0, settings: 0, attachments: 0 };
for (const file of moduleFiles) {
  const src = fs.readFileSync(file, "utf-8");
  let m;
  bareWriteRe.lastIndex = 0;
  while ((m = bareWriteRe.exec(src)) !== null) {
    bareWrites += 1;
    bareByField[m[1]] = (bareByField[m[1]] || 0) + 1;
  }
}

// 跨整个 src 的 api 引用度量（对齐方案 §1 口径）
let srcApiReferences = 0;
let srcApiCalls = 0;
const srcSlotNames = new Set();
for (const file of collectJs(SRC_DIR)) {
  const src = fs.readFileSync(file, "utf-8");
  const refRe = /\bapi\.[A-Za-z0-9_$]+/g;
  let m;
  while ((m = refRe.exec(src)) !== null) {
    srcApiReferences += 1;
    srcSlotNames.add(m[0].slice(4));
  }
  const callRe2 = /\bapi\.[A-Za-z0-9_$]+\s*\(/g;
  while ((m = callRe2.exec(src)) !== null) srcApiCalls += 1;
}

// F. 存量事件通道
let piDispatch = 0; // dispatchEvent(new CustomEvent('pi:...'))
let piAddListener = 0; // addEventListener('pi:...')
let stepBackRegister = 0; // window.__piRegisterStepBack
const piEventNames = new Set();
for (const file of moduleFiles) {
  const src = fs.readFileSync(file, "utf-8");
  const dem = /dispatchEvent\(\s*new\s+CustomEvent\(\s*['"]pi:([^'"]+)['"]/g;
  let m;
  while ((m = dem.exec(src)) !== null) {
    piDispatch += 1;
    piEventNames.add("pi:" + m[1]);
  }
  const lem = /addEventListener\(\s*['"]pi:([^'"]+)['"]/g;
  while ((m = lem.exec(src)) !== null) {
    piAddListener += 1;
    piEventNames.add("pi:" + m[1]);
  }
  const sbr = /__piRegisterStepBack\b/g;
  while ((m = sbr.exec(src)) !== null) stepBackRegister += 1;
}

// 跨整个 src 的事件通道全量统计（供阶段 1 盘点与后续对比）
let allDispatchEvent = 0;
let allCustomEvent = 0;
let allEventListener = 0;
const customEventNames = new Set();
for (const file of collectJs(SRC_DIR)) {
  const src = fs.readFileSync(file, "utf-8");
  let m;
  const de = /dispatchEvent\s*\(/g;
  while ((m = de.exec(src)) !== null) allDispatchEvent += 1;
  const ce = /new\s+CustomEvent\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = ce.exec(src)) !== null) {
    allCustomEvent += 1;
    customEventNames.add(m[1]);
  }
  const el = /addEventListener\s*\(/g;
  while ((m = el.exec(src)) !== null) allEventListener += 1;
}

const report = {
  modules: moduleFiles.length,
  fullPullModules: fullPull.length,
  fullPullList: fullPull,
  srcApiReferences: srcApiReferences,
  srcApiUniqueSlots: srcSlotNames.size,
  srcApiCalls: srcApiCalls,
  apiUniqueSlots: uniqueSlots,
  apiRegistrations: totalRegistrations,
  apiCalls: totalCalls,
  dupSlots: dupSlots.length,
  dupExcess: dupExcess,
  dupSlotList: dupSlots,
  crossModuleCalls: crossModuleCalls,
  bareStateWrites: bareWrites,
  bareStateByField: bareByField,
  piDispatch: piDispatch,
  piAddListener: piAddListener,
  allDispatchEvent: allDispatchEvent,
  allCustomEvent: allCustomEvent,
  allEventListener: allEventListener,
  customEventNames: [...customEventNames],
  stepBackRegister: stepBackRegister,
  piEventNames: [...piEventNames],
};

if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  const L = [];
  L.push("耦合度量基线");
  L.push(`  模块总数: ${report.modules}`);
  L.push(`  全量 ctx 拉取模块 (el/api/view/settings/flow/attachments 六项): ${report.fullPullModules}`);
  L.push(`  [src 全量] api.<slot> 引用点: ${report.srcApiReferences}`);
  L.push(`  [src 全量] api.<slot> 唯一函数槽: ${report.srcApiUniqueSlots}`);
  L.push(`  [src 全量] api.<slot>( 调用点: ${report.srcApiCalls}`);
  L.push(`  [modules 内] ctx.api 唯一函数槽(模块级): ${report.apiUniqueSlots}`);
  L.push(`  [modules 内] ctx.api 注册点数: ${report.apiRegistrations}`);
  L.push(`  [modules 内] ctx.api 调用点数: ${report.apiCalls}`);
  L.push(`  重复注册槽（同一槽 >1 模块）: ${report.dupSlots}，超额注册 ${report.dupExcess}`);
  for (const d of report.dupSlotList) L.push(`      ${d.slot}: ${d.mods.join(", ")}`);
  L.push(`  跨模块 api.* 调用点: ${report.crossModuleCalls}`);
  L.push(`  共享状态裸写（flow/view/settings/attachments 赋值）: ${report.bareStateWrites}`);
  L.push(`      按字段: ${JSON.stringify(report.bareStateByField)}`);
  L.push(`  存量 pi:* CustomEvent 派发: ${report.piDispatch}，监听: ${report.piAddListener}`);
  L.push(`    事件名: ${report.piEventNames.join(", ")}`);
  L.push(`  全量 dispatchEvent(/new CustomEvent(/addEventListener(: ${report.allDispatchEvent} / ${report.allCustomEvent} / ${report.allEventListener}`);
  L.push(`  全量 CustomEvent 名(去重): ${report.customEventNames.length}`);
  L.push(`  window.__piRegisterStepBack 注册: ${report.stepBackRegister}`);
  const details = crossDetails.slice(0, 40);
  if (details.length) {
    L.push("  跨模块调用示例（前 40）:");
    for (const d of details) L.push(`      ${d}`);
  }
  process.stdout.write(L.join("\n") + "\n");
}
