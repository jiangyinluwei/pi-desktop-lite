/**
 * contracts.js — 跨模块公开契约（阶段 1 前置：事件通道契约表）
 *
 * 用途（方案 §4 阶段 1.0）：
 *   盘点既有 dispatchEvent/CustomEvent 与 window.__piRegisterStepBack 注册点，
 *   逐条归入三类，形成《事件通道契约表》，杜绝「CustomEvent + window 注册器 + 新 bus」三轨并存。
 *
 * 本文件当前承载：
 *   1. 事件通道契约表（见下方注释块，新增事件务必在此登记）；
 *   2. 预留的跨模块 JSDoc 类型契约区（阶段 6 填充 @typedef）。
 *
 * =====================================================================
 * 【事件通道契约表】
 * =====================================================================
 *
 * 一、分类判据（方案 §4 阶段 1.2）
 *   - 通知（fire-and-forget）：调用方不关心结果、无拦截语义、无顺序依赖 → 走 bus；
 *   - 控制流命令（状态迁移）：有返回值/拦截语义/严格同步顺序 → 走 Store action 或显式 import；
 *   - 内核桥接（Rust→前端）：Tauri listen 原生通道 → 保留原通道（pi:* 专管）。
 *
 * 二、归口说明
 *   | 事件 | 方向 | 分类 | 归宿 | 承载方 |
 *   | :--- | :--- | :--- | :--- | :--- |
 *   | ui:toast | 任意模块 → toast 渲染 | 通知 | bus | task-panel.js (bus.on) |
 *   | ui:sidebar-close | 任意模块 → 侧栏 | 通知 | bus | task-panel.js (bus.on) [待迁移] |
 *   | pi:view-change | view-mode → window | UI 内部横切(见注解) | window CustomEvent | view-mode.js [保留] |
 *   | pi:step-back | global-interactions → window | UI 内部横切(见注解) | window CustomEvent | global-interactions.js [保留] |
 *   | workspace-changed | workspace/search → window | UI 内部横切 | window CustomEvent | workspace-panel.js [待迁 bus] |
 *   | pi:kernel-reconnect-failed | pi-client → window | 内核桥接 | Tauri listen | pi-client.js [保留] |
 *   | pi:inner-skill-activated | pi-client → window | 内核桥接 | Tauri listen | pi-client.js [保留] |
 *   | pi:context-injected | pi-client → window | 内核桥接 | Tauri listen | pi-client.js [保留] |
 *   | task-* / tasks-changed / active-task-changed | task-manager → window | 服务域事件 | 服务 EventEmitter | task-manager.js [保留] |
 *   | agent-* / turn-* / message-* / tool-* / text-* / thinking-* / state-update | pi-client → window | 服务域事件 | 服务 EventEmitter | pi-client.js [保留] |
 *   | config-service / conversation-history / version-service / session-service / model-failover | 各自 this.dispatchEvent | 服务域事件 | 服务 EventEmitter | 各服务 [保留] |
 *
 *   [注解] pi:view-change / pi:step-back 命名带 pi: 前缀，但实际由 UI 自身在 window 上派发，
 *          并非 Rust→前端桥接。鉴于它们深度耦合 AGENTS.md 铁律 3（四态回退链）与
 *          window.__piRegisterStepBack 注册器，本阶段**保留原 channel**，仅登记契约；
 *          后续在阶段 6 视回退链重构情况再决定是否并入 bus / Store。
 *
 * 三、window.__piRegisterStepBack（全局回退栈契约，AGENTS.md 铁律 3）
 *   所有新模块需接入。非本总线管辖，登记于 register.js 使用处；本文件仅声明其契约存在。
 *
 * 四、命名空间划分
 *   ui:*   —— UI 内部横切通知（bus 管辖）
 *   flow:* —— Flow 通知，必带 taskId（bus 管辖）
 *   pi:*   —— 内核桥接 CustomEvent（Tauri 原生通道，bus 概不接管）
 *   其余（agent-*, turn-*, task-* 等）—— 服务域事件（服务 EventEmitter，bus 概不接管）
 * =====================================================================
 */

// 阶段 1 已登记的唯一 UI 通知契约：ui:toast
// 发射方：任意模块        bus.emit("ui:toast", { text, duration })
// 唯一监听方：task-panel  bus.on("ui:toast", ({ text, duration }) => renderToast(...))

export const EVENT_CHANNEL_TABLE_VERSION = 1;

// 跨模块公开契约区（阶段 6 用 @typedef 填充，当前为空）
// 例如：export const __contracts = {};  // 预留

// =====================================================================
// 【跨模块显式 import 契约 · Flow 渲染层（阶段 3 落地）】
// =====================================================================
// 自阶段 3 起，flow 簇的「纯渲染助手」不再经由 ctx 的 api 函数槽跨模块调用，
// 改为直接 `import { ... } from "../modules/flow-render.js"`。见方案 §4 阶段 3。
//
// flow-render.js 导出的纯渲染函数（唯一依赖 src/lib 叶子模块，无循环依赖）：
//   collapseToolCard(card)            —— 折叠单张步骤/工具卡
//   expandToolCard(card)              —— 展开单张步骤/工具卡
//   getFriendlyToolName(toolName)     —— 工具名友好化
//   getToolIcon(toolName)             —— 工具 SVG 图标映射
//   getToolShortSummary(toolName,args)—— 工具入参短视频摘要
//   stripAnsiCodes(str)               —— 剥离 ANSI 控制字符
//   formatToolArgumentsHtml(args)     —— 入参代码块 HTML
//   formatToolResultHtml(result)      —— 结果代码块 HTML
//   renderToolBodyInnerHtml(args,result,rawContent) —— 工具卡正文结构化 HTML
//   updateToolBadge(badgeEl,status)   —— 工具状态徽章刷新
//   createThinkingStepCard(opts)      —— 思维切片卡
//   createPhaseStepCard(opts)         —— 阶段性输出(Point)卡
//   createToolStepCard(opts)          —— 工具调用卡
//   createToolPseudoRunningCard(opts) —— 伪工具运行框占位卡
//
// ⚠️ 已清退槽（原由 flow-ui 注册，现无外部消费者，见阶段 3 报告 §8）：
//   getFriendlyToolName / getToolIcon / getToolShortSummary / formatToolArgumentsHtml /
//   formatToolResultHtml / renderToolBodyInnerHtml / updateToolBadge /
//   createThinkingStepCard / createPhaseStepCard / createToolStepCard /
//   createToolPseudoRunningCard / collapseToolCard / expandToolCard
//   以上均为纯渲染，已在阶段 3 迁移为 flow-render 显式 import。
//
// 仍在 ctx 的 api 函数槽（非纯渲染，涉及 flow 视图缓存/跨模块契约，阶段 6 再评估清退）：
//   collapseAllDoneToolCards / collapseAllToolCards / collapseThinkingCard /
//   expandThinkingCard / autoCollapseThinkingOnNextPhase / createFlowTurnGroupElement /
//   updateFlowQuestionTip / updateFlowTurnNav / attachResponseSaveButton /
//   saveTurnOutputToDesktop / renderMarkdown
