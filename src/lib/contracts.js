/**
 * contracts.js — 跨模块公开契约（阶段 1 前置：事件通道契约表 / 阶段 6：函数槽契约定型）
 *
 * 用途（方案 §4 阶段 1.0 / 阶段 6）：
 *   1. 事件通道契约表：盘点既有 dispatchEvent/CustomEvent 与 window.__piRegisterStepBack 注册点，
 *      逐条归入三类，杜绝「CustomEvent + window 注册器 + 新 bus」三轨并存；
 *   2. ctx.api 函数槽契约（阶段 6 定型）：以 JSDoc @typedef 登记仍保留在 ctx 的 api 函数槽上的
 *      全部函数槽 —— 按属主模块分组、标注保留原因（流式热区 / 拦截语义 / 初始化顺序依赖），
 *      新增槽位必须在此同步登记，杜绝「幽灵槽」（注册无调用）与「兼容壳」复发。
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
 *   | ui:workspace-changed | workspace/search → 全局 | 通知 | bus | search-input.js (bus.on) [阶段 6 收编，原 window CustomEvent] |
 *   | pi:view-change | view-mode → window | UI 内部横切(见注解) | window CustomEvent | view-mode.js [保留] |
 *   | pi:step-back | global-interactions → window | UI 内部横切(见注解) | window CustomEvent | global-interactions.js [保留] |
 *   | pi:kernel-reconnect-failed | pi-client → window | 内核桥接 | Tauri listen | pi-client.js [保留] |
 *   | pi:inner-skill-activated | pi-client → window | 内核桥接 | Tauri listen | pi-client.js [保留] |
 *   | pi:context-injected | pi-client → window | 内核桥接 | Tauri listen | pi-client.js [保留] |
 *   | task-* / tasks-changed / active-task-changed | task-manager → window | 服务域事件 | 服务 EventEmitter | task-manager.js [保留] |
 *   | agent-* / turn-* / message-* / tool-* / text-* / thinking-* / state-update | pi-client → window | 服务域事件 | 服务 EventEmitter | pi-client.js [保留] |
 *   | config-service / conversation-history / version-service / session-service / model-failover | 各自 this.dispatchEvent | 服务域事件 | 服务 EventEmitter | 各服务 [保留] |
 *
 *   [注解] pi:view-change / pi:step-back 命名带 pi: 前缀，但实际由 UI 自身在 window 上派发，
 *          并非 Rust→前端桥接。它们深度耦合 AGENTS.md 铁律 3（四态回退链）与
 *          window.__piRegisterStepBack 注册器，属运行态交互热区 —— 保留原 channel，
 *          收编评估归入「降耦合 GUI 回归专项」（.doc/pi-desktop-lite-降耦合-GUI回归专项.md §5）。
 *
 *   [注解] closeTaskSidebar（task-panel → global-interactions）**不上总线**：
 *          返回 boolean（wasOpen）参与右键 step-back 拦截链（global-interactions.js 依据真值
 *          决定链是否继续），属「控制流命令」，保留 ctx.api 显式槽（阶段 6 重定性）。
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

// 已登记的 UI 通知契约（阶段 6 现状）：
//   ui:toast              发射方：任意模块          监听方：task-panel.js (bus.on)
//   ui:workspace-changed  发射方：workspace-panel / search-input
//                         监听方：search-input.js (bus.on → syncWorkspaceInputState)

export const EVENT_CHANNEL_TABLE_VERSION = 2;

// =====================================================================
// 【ctx.api 函数槽契约 · 阶段 6 定型】
// =====================================================================
// 仍保留在 ctx 的 api 函数槽上的函数槽全量登记（按属主模块分组）。阶段 6 已清退
// 「幽灵槽 / 兼容壳」（见文末清退清单），剩余槽位均有真实跨模块调用方或
// 明确的保留原因。新增槽位前先自问：能否改为显式 import / Store action？
//
// /**
//  * 跨模块函数槽契约（由 main.js 注入 ctx.api，各模块 init 时注册）。
//  * @typedef {Object} PiApiContracts
//  * @property {() => void} loadCustomProvidersConfig            custom-provider-panel → 设置页刷新自定义 Provider
//  * @property {(item: object) => string} getFileCategoryIcon    file-attachments → 附件类别 SVG 图标
//  * @property {() => void} clearAttachedFiles                   file-attachments → 清空输入框附件胶囊
//  * @property {() => void} showFileChangesBox                   flow-file-changes → 展示文件变更收纳框
//  * @property {() => void} resetFileChanges                     flow-file-changes → 重置收纳框（任务直切铁律）
//  * @property {(taskId: string) => void} restoreFileChangesFor  flow-file-changes → 按 Task 恢复会话流缓存仓
//  * @property {() => object[]} collectRollbackPreview           flow-file-changes → 回退预览逐条变更
//  * @property {(taskId: string) => void} pruneFileChangesFor    flow-file-changes → 回退后剪枝重渲
//  * @property {() => void} resetInjectionNotice                 flow-pipeline → 重置「注入提示」信息框
//  * @property {(text: string) => Promise<void>} handleFlowQuery         flow-pipeline → Flow 提问下发（发送链热区）
//  * @property {() => void} submitCurrentPrompt                  flow-pipeline → 发送入口
//  * @property {(toolCallId: string) => void} removeActiveToolPseudoStep flow-pipeline → 伪运行卡移除
//  * @property {() => void} resetStreamState                     flow-stream → 流式状态机复位（流式热区）
//  * @property {() => void} finalizeStream                       flow-stream → 流式收尾
//  * @property {() => object|undefined} sealActiveThinkingStep  flow-stream → 封口思维切片
//  * @property {() => object} ensureActiveThinkingStep           flow-stream → 确保思维切片存在
//  * @property {(text: string) => void} sealActivePhaseOutput    flow-stream → 封口阶段性输出
//  * @property {() => void} resetCurrentTurnForResend            flow-stream → 重发前轮次复位
//  * @property {(text: string) => string} renderAbortNoticeHtml  flow-stream → 中断提示 HTML
//  * @property {(html: string) => void} appendFlowAbortNotice    flow-stream → 追加中断提示卡
//  * @property {(err: object) => object} renderErrorCard         flow-stream → 错误卡渲染
//  * @property {(md: string) => string} renderMarkdown           flow-ui → Markdown 渲染引擎
//  * @property {() => void} collapseAllDoneToolCards             flow-ui → 折叠全部已完成工具卡
//  * @property {() => void} collapseAllToolCards                 flow-ui → 折叠全部工具卡
//  * @property {(cardEl?: HTMLElement) => void} collapseThinkingCard flow-ui → 折叠思维卡
//  * @property {() => void} autoCollapseThinkingOnNextPhase      flow-ui → 下阶段自动折叠思维
//  * @property {() => HTMLElement|undefined} createFlowTurnGroupElement flow-ui → 创建轮次分组 DOM
//  * @property {() => void} updateFlowQuestionTip                flow-ui → 悬浮提问提示刷新
//  * @property {() => void} updateFlowTurnNav                    flow-ui → 轮次定位导航刷新
//  * @property {(saveBtn: HTMLElement) => void} attachResponseSaveButton flow-ui → 绑定轮次保存按钮
//  * @property {() => Promise<void>} renderWhitelistModels       model-panel → 白名单模型渲染
//  * @property {() => Promise<void>} loadModelsAndState          model-panel → 模型与状态加载
//  * @property {(providerId: string) => Promise<void>} renderOfficialProviderDetails model-panel → 官方 Provider 详情
//  * @property {() => Promise<void>} loadOfficialProvidersConfig model-panel → 官方目录加载
//  * @property {() => Promise<void>} loadInstalledPackages       packages-panel → 已装组件渲染
//  * @property {() => Promise<void>} loadRecommendedPlugins      packages-panel → 推荐插件渲染
//  * @property {() => Promise<void>} loadCatalogPackages         packages-panel → 组件目录渲染
//  * @property {() => boolean} hasCatalogLoadedOnce              packages-panel → 目录是否已加载（守卫）
//  * @property {() => void} snapToClosestStandardTokens          preferences → Token 档位吸附
//  * @property {() => void} setupOutputTokensAutoSnap            preferences → Token 输入自动吸附
//  * @property {() => void} updateInputState                     search-input → 输入态刷新（内核降级/路由门禁）
//  * @property {() => void} autoResizeSearchInput                search-input → 输入框自适应高度
//  * @property {() => Promise<void>} syncWorkspaceInputState     search-input → 工作区路由态同步
//  * @property {() => Promise<void>} loadSessions                sessions-panel → 会话记录加载
//  * @property {(tabId: string) => void} switchSettingsTab       settings-navigation → 设置大 Tab 切换
//  * @property {() => void} scrollSettingsToBottom               settings-navigation → 设置页滚底
//  * @property {(elm: HTMLElement) => void} scrollElementIntoViewBottom settings-navigation → 元素滚至可视底部
//  * @property {(tabId: string) => void} switchInnerTab          settings-navigation → 设置内层 Tab 切换
//  * @property {() => void} updateMiniTaskCapsuleUI              task-panel → Mini 任务胶囊刷新
//  * @property {() => boolean} closeTaskSidebar                  task-panel → 侧栏关闭（拦截语义，见契约表注解）
//  * @property {() => void} renderTaskSidebarList                task-panel → 任务抽屉渲染
//  * @property {(taskId: string) => void} restoreTaskToFlow      task-panel → 任务回入 Flow（防重入铁律）
//  * @property {(task: object) => void} renderTurnsIntoFlow      task-panel → 轮次回填（切换铁律热区）
//  * @property {() => void} archiveCurrentFlowToHistory          task-panel → 终态归档历史
//  * @property {() => void} renderConversationMessages           task-panel → 历史讯息渲染
//  * @property {() => void} openSettingsView                     view-mode → 进入设置页（第 4 态）
//  * @property {() => void} closeSettingsView                    view-mode → 退出设置页
//  * @property {() => Promise<void>} loadWorkspaces              workspace-panel → 预设工作区列表
//  * @property {() => Promise<string|null>} promptCodeAreaRouteModal workspace-panel → 路由绑定弹窗
//  */
// 保留原因三类：①流式/切换热区（flow-stream、renderTurnsIntoFlow 等，动则需 GUI 回归）；
//               ②拦截语义（closeTaskSidebar 等有返回值参与控制流）；
//               ③初始化顺序依赖（settings-navigation 对 loadInstalledPackages 的 typeof 守卫等）。
// 后续批次按「降耦合方案」继续显式化（显式 import / Store action），迁移后同步删减本清单。

// =====================================================================
// 【阶段 6 已清退槽（幽灵槽 / 兼容壳）】
// =====================================================================
//   兼容壳槽 setViewMode（view-mode）        —— 兼容壳，零外部调用方；唯一入口收敛为 viewStore.morph
//                                         （本地 setViewMode + window.__piSetViewMode 保留）
//   槽 ensureActiveTextStep（flow-stream）—— 注册零调用（函数仅模块内使用）
//   槽 expandThinkingCard（flow-ui）   —— 注册零调用，函数体彻底死代码（函数+注册全删）
//   槽 getSkillDisplayName（flow-pipeline）—— 注册零调用（函数仅模块内使用）
//   槽 saveTurnOutputToDesktop（flow-ui）—— 注册零调用（函数仅模块内使用）

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

// =====================================================================
// 【跨模块显式 import 契约 · Flow 域只读 DOM 引用（阶段 3b 落地）】
// =====================================================================
// 自阶段 3b 起，flow 簇的「只读 DOM 引用」不再直接解构全量 ctx.el，
// 改为由 main.js `createFlowDom(el)` 产出 flow 子集后挂到 ctx.flowDom，
// flow 模块 `const flowDom = ctx.flowDom` 取用。见方案 §4 阶段 3b / 阶段 4 el-binder。
//
// flow-dom.js 导出：
//   createFlowDom(el) —— 从 ctx.el 抽出 flow 子集（只读，无副作用，无 DOM 查询）
//   FLOW_EL_IDS       —— flow 域元素 id 集中登记表
//
// ⚠️ 指定负责方：仅 main.js 调用 createFlowDom；其余模块一律只读 ctx.flowDom，严禁再自造 flow 引用。
//
// 未落地（仍留 ctx.flow）—— 阶段 3b 部分完成，下列按方案 §4 铁律⑤ 继续留在视图层：
//   1. flow-state-view.js（renderedToolCards / currentSteps / active*Step / activeTurnRefs /
//      跟随标记 / 计时器）视图缓存归位 —— 因涉流式热路径（lastEventTaskId 与 currentActiveTaskId
//      不一致、resetStreamState 时 taskId 未定、数据字段与 DOM 绑定视图对象混排），且需运行态回归验证；
//   2. flow.* 纯数据字段迁 flowStore.for(taskId) —— 同上，需 taskId 穿透流式热路径。
//   二者列入「降耦合 GUI 回归专项」（需带运行 App 的流式回归验证后落地）。
