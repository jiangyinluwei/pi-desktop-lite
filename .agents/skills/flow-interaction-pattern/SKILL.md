---
name: flow-interaction-pattern
description: |
  指导 Flow 流式交互界面（界面3）的核心交互逻辑实现规范：①过程框体（思维切片卡片/阶段性输出 Point 切片卡片/工具调用切片卡片）单行流式紧凑呈现，可手动折叠展开，任何时候均不自动展开；②时序步骤流容器（flow-steps-container）按「思维1-Point1-工具1-Point2-工具2...」真实因果链条一段一段拼接；③伪框占位机制（首 token 延迟期「Thinking (0.0s)...」伪思考框；工具参数流式期「工具调用(edit)... + 读秒 + running」伪工具运行框，真实卡就位即移除）；④Flow 界面任意区域滚轮事件委托至最外层滚动容器；⑤多段对话顶部悬浮当前提问提示 (Flow Floating Question Tip)；⑥多段对话右侧上下轮次定位导航 (Flow Turn Navigation，定位到每轮最终输出内容顶部、鼠标弹起触发可连续逐轮定位、长按「下」1.5 秒立即定位到底部，按下伴随由左至右背景填充及轻微抖动动画)；⑦模型自动重连切换自愈流水线 (ModelFailoverEngine)；⑧输出卡底部手绘风格的保存操作栏；⑨会话完成后「文件变更」收纳框（flow-file-changes，收集新增/修改/删除的文件、点击条目在资源管理器中定位其所在文件夹；按 Task 会话流缓存至程序生命周期结束，右键退出再经历史/Task 记录回入 Flow 一致恢复）；⑩用户提问卡右侧一键复制提问按钮（prompt-copy-btn：常态透明无边框、悬浮显手绘边框，点击复制净化后原始提问并短暂变绿反馈，静态初始模板与动态历史轮次均生效）；⑪多任务直切自动挂起、历史记录智能重定向与状态隔离（任务直切原活跃任务无缝转入后台挂起、历史进入智能重定向至 restoreTaskToFlow 杜绝静态快照覆写实时 live turns、Flow DOM 防重入与工具切片引用自愈回填）；⑫会话回退与文件撤回（flow-rollback：轮次提问卡悬浮「回退到此处」→ SketchModal 确认 → 工具执行前快照还原「已修改/已删除」文件（新增文件永不撤回）→ 内核原生 RPC fork 历史节点回退 → 本地剪枝重渲 + 提问回填输入框 + 顶部浮窗 3 秒提醒结果）；⑬前端解耦分层架构（flowStore.for(taskId) 纯数据分仓、flowView 视图密封缓存、flow-render 纯渲染显式依赖、flow-dom 只读 DOM 引用与 el-binder 按需自绑定，严禁解构已废除的 ctx.el）。当用户提出"flow界面交互"、"思维链流式展示"、"阶段性输出"、"Point卡"、"工具调用简略"、"单行思维"、"步骤切片"、"伪思考框"、"伪运行框"、"工具调用读秒"、"滚轮滚动"、"flow滚动条"、"悬浮提问提示"、"上下按钮"、"轮次定位"、"保存输出"、"文件变更"、"修改了哪些文件"、"多任务直切"、"任务切换"、"自动挂起"、"历史记录重定向"、"防重入"、"会话回退"、"对话回退"、"回退到此处"、"文件撤回"、"撤销修改"时使用此技能。
---

# Flow 交互界面规范 (Flow Interaction Pattern)

本技能定义 Flow 流式交互界面（`界面3 / data-view="flow"`）的前端分层架构、步骤切片流水线、滚轮委托、轮次导航、模型自愈、文件收纳、状态隔离与会话回退规范。

---

## 🏛️ 1. 架构分层与核心铁律

```text
#app-container            ← 全局容器 (position: relative; overflow: hidden)
  ├─ flow-stage           ← Flow 主体 (max-width: 760px 居中)
  │    └─ flow-scroll-area ← 唯一可滚动容器 (overflow-y: auto)
  │         ├─ flow-question-tip      ← 顶部悬浮提问提示 (sticky top: 0, pointer-events: none)
  │         └─ flow-conversation
  │              └─ flow-message-group
  │                   ├─ flow-user-prompt-card       用户提问卡（支持多行换行 pre-wrap，右侧 prompt-copy-btn 一键复制提问，事件委托于 flow-conversation）
  │                   ├─ flow-route-capsule          路由目标项目胶囊
  │                   ├─ flow-injection-notice        「注入提示」信息框 (路由胶囊下方；直角简洁风，默认收起显示「注入提示」与注入数量，点击展开全部注入条目清单)
  │                   ├─ flow-failover-capsule       自动重连/切换进度胶囊
  │                   ├─ flow-steps-container        【时序步骤流容器】
  │                   │    ├─ flow-step-thinking     思维切片 (单行刷新，常态折叠，绝不自动展开)
  │                   │    ├─ flow-step-phase        阶段性输出 Point 切片 (读秒+折叠内容，绝不自动展开)
  │                   │    ├─ flow-step-tool         工具切片 (单行状态徽章+读秒，常态折叠，绝不自动展开)
  │                   │    └─ tool-pseudo-card      伪工具运行框 (参数流式期占位，虚线边框，真实卡就位即移除)
  │                   └─ flow-response-card          最终输出正文 (Typedown 质感 Markdown，永不折叠)
  ├─ flow-turn-nav        ← 右侧上下轮次定位导航 (多轮 >= 2 显现，右移至内容区外)
  └─ search-section       ← 底部输入区
```

### 核心铁律
1. **最终输出卡永不折叠**：`flow-response-card` 始终完全展开渲染 Markdown；
2. **过程框体单行紧凑折叠**：思维切片、Point 阶段切片与工具切片在任何阶段（启动、流式、完成）**绝不自动展开**，支持手动点击 Header 展开详情；
3. **真实 ReAct 时序交织**：步骤按 `思维1 ➔ 工具1 ➔ 思维2 ➔ 工具2 ➔ ...` 一段一段流式拼接；
4. **前端解耦分层硬约束**：
   - **流式纯数据归仓**：`responseText`、`thinkingText`、`errorMessage`、`lastUserQuery`、`hasReceivedDelta`、`interruptSendTaskId`、`lastSentPrompt`、`lastSentAttachments`、`lastImagePayloads`、`thinkingStartTime` 等 11 个纯数据字段一律通过 `flowStore.for(taskId)` 分仓读写（分仓键经 `resolveStreamTaskId` 解析），严格禁止 `flow.*` 纯数据裸写（度量断言 = 0）；Store action 一律同步执行，禁止 async/await/微任务挂起；
   - **视图派生缓存密封**：`renderedToolCards`、`currentSteps`、`active*Step`、读秒计时器（`toolPseudoTimerInterval`、`toolRunTimerInterval`）、`activeTurnRefs`、`followBottom` 统一定义于 `src/modules/flow-state-view.js` 的 `flowView` 密封对象（`Object.seal` 封口保护，严禁入 Store）；
   - **纯渲染助手显式 import**：工具/思维/阶段卡创建、工具名/图标/摘要映射、入参/结果 HTML 格式化、ANSI 剥离、徽章刷新等无副作用纯渲染函数统一定义于 `src/modules/flow-render.js`，各模块直接 `import { ... } from './flow-render.js'` 显式依赖，杜绝旧 `ctx.api` 纯渲染槽；
   - **Flow 域 DOM 引用隔离与按需自绑定**：只读 DOM 引用由 `src/modules/flow-dom.js`（`createFlowDom`）产出挂载到 `ctx.flowDom`，flow-* 模块改读 `flowDom.flow*`；各模块通过 `src/lib/el-binder.js` 的 `bindAll` 按需自绑定自己的 DOM id 子集，**严禁解构已废除的 `ctx.el`**；
   - **契约化事件派发**：横切通知经 `event-bus.js` 同步派发（`flow:response` 携带 taskId，`ui:toast` 等），事件通道在 `src/lib/contracts.js` 严格登记；控制流走 Store action 或显式 import。

---

## 📌 2. 步骤切片与流式流水线

| 切片类型 | 视觉语义与展示规范 | 展开正文与交互细节 | 触发与封口时机 |
|---|---|---|---|
| **思维链切片 (`flow-step-thinking`)** | **石墨幽兰冷灰调**（`#f7f6fb` / `#1b1a21`），`Thinking` 手绘胶囊 + 星芒自旋呼吸，动态读秒 `(1.2s)...` ➔ 定格 `(3.2s)`，单行流式预览；默认折叠。 | 细致思考日志流（字号 12px，行高 1.68，石墨淡墨色 `--ink-muted`），柔和内边距与虚线分割。 | `thinking-start` 创建；`tool-start` 或 `text-start` 时封口。 |
| **阶段性输出切片 (`flow-step-phase`)** | **温润羊皮纸金调**（`#fdfbf5` / `#201d17`），`Point` 手绘暖调胶囊 + 铅笔图标 + 读秒 `已输出 1.2s`；默认折叠。 | 阶段 Markdown 完整渲染（富文本、代码块、列表、引用），内嵌暖调微衬边。 | 首个 `text-delta` 创建；文本段之后再次进入 Thinking（`thinking-start`）或进入工具调用（`toolcall-delta-start` / `tool-start`）时封口；新轮 `text-start` 封口上一段；最终段保留在输出卡。 |
| **工具调用切片 (`flow-step-tool`)** | **蓝图终端工程调**（`#f2f6fa` / `#141920`），按工具智能映射矢量图标（CLI/文件/搜索/OCR等）+ 中文友好名 + 参数预览 + 三态状态徽章 (`running` 琥珀黄 / `done` 翡翠绿 / `failure` 朱红) + 运行期递增读秒 `(1.2s)...` ➔ 封口定格 `(3.2s)`；默认折叠。 | 结构化拆分 `入参 · Parameters` 与 `执行结果 · Result`，仿终端代码块包装，右上角提供手绘一键复制与复制成功即时微反馈。 | `tool-start` 创建；`tool-end` 封口并更新状态与定格读秒。 |
| **伪工具运行框 (`tool-pseudo-card`)** | **蓝图虚线占位调**（复用工具卡配色 + 虚线边框 + 降不透明度），通用「工具调用...」标题 + running 徽章 + 100ms 递增读秒，工具图标轻微呼吸摆动；无展开正文。 | 无（纯占位单行卡）。 | `toolcall-delta-start` 创建（覆盖工具参数流式期空窗延迟）；`toolcall-delta-end` 回填真实工具名（如「工具调用(edit)」）；`tool-start` 真实卡创建时移除；`thinking-start` / `text-start` / `finalizeStream` 兜底清理。 |

### 伪框占位机制 (Pseudo Placeholder Cards)

对齐「伪思考框」首 token 延迟显示机制，工具调用同样存在两段空窗延迟，均需即时视觉反馈：

1. **伪思考框**：`thinking-start` 即插入 `Thinking (0.0s)...` 占位思维切片，100ms 读秒；真正捕捉到思维链 delta 后流式刷新首行预览，封口时若从未收到任何思维内容则直接移除；
2. **伪工具运行框**：`toolcall-delta-start`（工具参数流式开始）即插入 `工具调用... + running + (0.0s)...` 占位卡（`flow-pipeline.js` 的 `ensureActiveToolPseudoStep`），100ms 读秒；参数流式结束（`toolcall-delta-end` 携带 `toolCall.name`）回填真实工具名；
3. **真实工具卡读秒与累计延时铁律**：`tool-start` 创建真实卡片时继承伪工具运行框的 `startTime`，将大模型生成工具参数的延时与工具执行耗时累计显示（初始携带 `(${initialElapsed}s)...`），移除占位卡；`startToolRunTimer` 持续以 100ms 刷新累计读秒；`tool-end` 定格为累计总时长 `(Xs)` 并清空 `flowView.toolRunTimerInterval`，杜绝真实工具执行完成后耗时跳回 0.0s/0.1s 导致前期生成延时丢失；
4. **状态清理铁律**：伪框与读秒计时器（`flowView.activeToolPseudoStep` / `flowView.toolPseudoTimerInterval` / `flowView.toolRunTimerInterval`）必须在 `resetStreamState`、`resetCurrentTurnForResend`、`finalizeStream`、`thinking-start`、`text-start` 全部边界兜底清理，杜绝幽灵计时器与残留占位卡；伪卡不写入 `flowView.currentSteps`，不污染历史快照。

### 历史快照卡片重绑铁律 (Snapshot Card Rebinding)

历史/Task 记录回入 Flow 时，轮次卡片有两条渲染路径，监听器绑定策略必须严格区分，否则一次点击 toggle 两次互消（表现为收起状态无法点开）或快照卡彻底死卡：

- **工厂新建路径**：`steps` 快照经 `createThinkingStepCard` / `createPhaseStepCard` / `createToolStepCard` 工厂创建，工厂内部已绑定 Header 点击/键盘折叠监听，并以 expando 标记 `headerEl.__piBound = true`（expando 不随 outerHTML 序列化，不污染归档快照）；
- **outerHTML 快照路径**：`toolCalls[].html` 快照经 `insertAdjacentHTML` 解析插入，解析后节点不带任何监听器（且 Header 上可能残留旧版 `data-bound="1"` 标记，一律忽略）；`createFlowTurnGroupElement` 末尾的重绑循环仅处理无 `__piBound` 标记的快照卡，并补齐点击与键盘两种触发；
- **严禁**在重绑循环中以 `header.dataset.bound` 作为跳过依据：工厂卡未设置过该 dataset、而快照卡却携带旧标记，双重绑定/漏绑双象限全错（历史缺陷根因）。

---

## 📌 3. 滚轮委托与吸底跟随策略

### 3.1 window 捕获阶段滚轮委托
```javascript
// 在 window 捕获阶段拦截，防止子元素消费后无法滚动外层
window.addEventListener("wheel", (e) => {
  if (viewStore.mode !== VIEW_FLOW || !flowDom.flowScrollArea) return;
  const inner = e.target.closest(".thinking-body, .tool-body");
  if (inner) {
    const canUp = e.deltaY < 0 && inner.scrollTop > 0;
    const canDown = e.deltaY > 0 && inner.scrollTop < inner.scrollHeight - inner.clientHeight - 1;
    if (canUp || canDown) return; // 子区域还有滚动空间时放行
  }
  e.preventDefault();
  flowDom.flowScrollArea.scrollTop += e.deltaY;
}, { passive: false, capture: true });
```

### 3.2 吸底跟随 (Sticky Bottom Follow)
- **跟随开启**：滚动到底部（距底 ≤ 32px）置 `flowView.followBottom = true`；
- **跟随终止**：用户主动向上滚动时置 `flowView.followBottom = false`，流式事件不再拉扯视口；
- **单次定位**：提交新提问、流式完成（`finalizeStream`）及终止提示追加后强制定位到底部。

---

## 📌 4. 悬浮提问提示与上下轮次导航

### 4.1 顶部悬浮提问提示 (`Flow Floating Question Tip`)
- **触发条件**：处于 Flow 视图且内容溢出（`scrollHeight > clientHeight + 1`）；
- **形态**：`position: sticky; top: 0; pointer-events: none;`，靠左对齐，未溢出零占位；
- **轮次锚定**：根据滚动位置动态取顶部高于/等于视口顶边的最后一个消息组的提问。

### 4.2 右侧上下轮次定位导航 (`Flow Turn Navigation`)
- **展示**：多轮对话（`groups >= 2`）时在内容区右侧显现，由 JS 动态对齐内容区底部；
- **定位目标**：每轮最终输出内容顶部（`.flow-response-card`），扣除顶部提示吸附高度；
- **「上」两段式优化定位 (`OUTPUT_TOP_PROXIMITY_PX = 100`)**：
  - 视口顶边距当前轮输出顶部 ≤ 100px（含上方思考/提问区）➔ 定位到**第 N-1 轮**输出顶部；
  - 视口顶边深入当前轮输出 > 100px ➔ 先定位到**第 N 轮**输出顶部；
- **「下」与长按 1.5s 立即触底**：
  - 单击弹起定位到下一轮输出顶部；
  - 按住满 1.5 秒立即定位到会话最底部（伴随左至右背景填充与轻微抖动动画），弹起不再重复触发；
- **交互铁律**：定位均在 `mouseup` 触发；`mouseleave` 立即作废按下状态。

---

## 📌 5. 后台任务、双通道解耦与中断发送

### 5.1 挂起与终止双通道与强制终止铁律 (Decoupled Suspend & Force Termination Invariance)
- **通道 1：后台挂起 (Esc / 右键)**：仅在运行态 (`status === "thinking" | "streaming" | "tool_exec"`) 或暂停态 (`paused`) 触发，`isSuspended = true` 转入后台 `TaskManager`，界面回退至 Focus 专注版，绝不调用 `abort`；
- **通道 2：显式强制终止 (⏹ 按钮)**：
  1. **Rust 后端物理强杀**：`SessionHost` 立即设置 `is_aborted = true`，阻断后续未决 prompt 下发并直接强杀子进程 (`child.kill()`)，从底层 100% 杜绝 Token 消耗与后台残留；
  2. **事件流派发拦截**：`PiClient` 登记 `abortedTaskIds`，迟到的流式事件全量过滤，禁止将 `isStreaming` 重置为 true；
  3. **任务状态防复活**：`TaskManager.handleTaskEvent` 严禁任何迟到事件修改已终止任务的状态（禁止复活为 thinking / streaming / completed）；
  4. **已终止任务防后台挂起**：终止后的任务按 Esc / 右键回退时，`handleGlobalStepBack` 判定 `isRunning = false`，绝不走挂起通道，直接归档至历史并调用 `removeTask` 彻底释放内存与胶囊计数；
  5. **追加提示**：追加手绘草图风格「刚刚会话已手动终止」提示（`.flow-abort-callout`）。

### 5.2 手动终止绝对禁止触发重连铁律
用户点击「⏹ 终止」时，系统立即执行 `modelFailoverEngine.markTaskAborted(taskId)` 与 `cancel()`，**全链路严禁触发任何自动重连或模型切换**。

### 5.3 运行中提交拦截与「终止并发送」
- 运行中提交输入时弹出 `sketchConfirm`（“终止并发送” / “等待完成”）；
- 选择“终止并发送”：先注册 `waitForTurnSettled(taskId)`（6s 兜底），再 `piClient.abort(taskId)`，旧轮定格为「已中断」，旧轮结算后才开启新轮，彻底杜绝内容串轮。

### 5.4 后台任务流式串轮过滤铁律 (Foreground Stream Gate)
- **事件帧归属追踪**：`piClient` 在 `handleAgentEvent` / `handleMessageUpdate` 中记录每帧 RPC 的 `task_id` 至 `piClient.lastEventTaskId`（同步派发窗口内可靠）；
- **前台门禁判定**：`taskManager.isForegroundStreamTask(taskId)` —— 事件携 `task_id` 且 ≠ 当前前台活跃任务（含挂起态 `currentActiveTaskId = null`）时视为后台事件；缺失 `task_id` 时视为前台主会话向后兼容；
- **UI 层全量门禁**：`flow-stream.js` 与 `flow-pipeline.js` 的全部流式监听器（thinking/text/toolcall/tool/agent/retry/注入提示框条目）入口处统一执行 `isForegroundStreamEvent()` 过滤——后台挂起任务的增量只入 `TaskManager` 数据缓冲（供侧边栏与恢复展示），**绝不触碰前台 Flow DOM、流式状态、错误卡与收尾归档**；
- **历史会话恢复场景**：从历史记录/会话记录进入 Flow 时，后台旧任务继续输出也绝不拼进历史轮次 DOM；仅当该任务被重新置为前台活跃任务时才恢复流式渲染。

---

## 📌 6. 模型自动重连切换引擎 (ModelFailoverEngine)

```mermaid
flowchart TD
    Err[模型调用报错] --> Classify{错误类型分类}
    Classify -->|瞬态: 429/5xx/网络超时| Reconnect[自动退避重连 2s->4s->8s, 上限24次]
    Classify -->|永久: 401/404/额度不足| Switch[按白名单 MRU 切换下一模型重试]
    Reconnect -- 耗尽且开启升级 --> Switch
    Switch -- 全部失败 --> Fallback[恢复原模型并渲染错误卡]
```

- **进度胶囊**：展示「自动重连中 3/24 · 8s 后重试」或「正在自动切换至 <模型>」；
- **MRU 保护**：重试期间仅临时切换，候选模型成功输出后才持久化置顶 MRU。

---

## 📌 7. Typedown 质感 Markdown 与超链接

- **Markdown 引擎**：流式容错修补未闭合代码围栏/表格；支持多级标题、GFM 表格、任务列表与 GitHub Callouts；
- **代码块**：语言徽标 + 手绘「复制」按钮（1.8s 成功微反馈）+ 轻量语法高亮；
- **外部链接**：全域 HTTP/HTTPS 链接拦截并通过 Rust `pi_open_url` 唤起系统默认浏览器；
- **一键保存**：回答卡底部手绘「保存」按钮，一键将完整对话保存为桌面 `.md` 文件。

---

## 📌 8. 历史会话还原与上下文脱敏

- **Rust 后端原生净化**：`strip_injected_contexts` 与 `clean_user_prompt` 递归剥离 `<runtime_context_rules>`、`<code_area_routing_context>` 与附件绝对路径尾注；
- **前端纵深防御**：历史列表与提问卡 100% 还原用户原始纯净输入；
- **提问卡多行换行与防挤压排版规范**：`.flow-user-prompt-card .prompt-content` 统一采用 `white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;`，完整呈现用户提问文本中的所有换行与段落，杜绝空白合并折叠；左侧图标与操作按钮固定 `flex-shrink: 0` 防挤压，中间内容区 `flex: 1` 自适应伸缩；复制按钮优先取 `card.dataset.copyText` 原汁原味还原原始提问；顶部单行悬浮胶囊 (`flow-question-tip`) 将换行规整为空格单行展示。

---

## 📌 9. 会话文件变更收纳框 (flow-file-changes)

模型执行文件写入/编辑/删除类工具后，会话完成时在会话流末尾以轻盈通透的纯透明框体汇总呈现「新增 / 修改 / 删除」的文件清单：

- **触发工具集合**：写入类 `write / write_file / write_to_file / create_file / save_file / new_file / new_empty_editor`（经 `matchToolSet` 自动剥离命名空间前缀如 `default.write` / `pi:write_file`）；编辑类 `edit / edit_file / replace_file_content / multi_replace_file_content / apply_patch / apply_diff / str_replace_editor / insert_content`；删除类 `delete_file / remove_file / unlink` 等；Shell 类 `bash / powershell / cmd` 等（定义于 `src/modules/flow-file-changes.js`）；
- **新增/修改判定（同步探测铁律）**：`tool-start` 时对写入类工具在当前事件调用栈内**纯同步向 `existenceProbes` 登记 Promise**（严禁任何 `await` 导致微任务挂起，消除写文件瞬时完成后 `tool-end` 抢先到达引发的竞态）；`tool-end` 时 `await` 取回存在性结果，并经 `normalizePathKey` 归一化比对（消除正反斜杠与大小写差异）；工具成功 + 写前不存在 → 新增（工具名含 `create / new` 显式新建语义时兜底识别为新增）；其余 → 修改；探测失败按修改兑底；
- **收集与去重**：`tool-end` 仅收集执行成功的工具调用（`isError` 跳过），路径从工具入参提取（兼容 JSON 字符串与 `edits/files/changes` 多文件入参结构），按规范化路径去重保留最新动作；
- **会话流缓存铁律（程序生命周期级）**：每个 Task 一份独立文件变更缓存仓（`sessionStores: Map<taskId, { items, collapsed, log }>`，定义于 `flow-file-changes.js`；`log` 为逐条变更日志 `{ key, kind, toolCallId, ts, path }`，供会话回退精确剪枝与预览），前后台任务均持续收集（事件按 `piClient.lastEventTaskId || taskManager.currentActiveTaskId` 归入各自缓存仓），直至应用退出才释放；右键退出 Flow（挂起/归档）后经历史记录 / Task 记录回入时，由共享渲染器 `renderTurnsIntoFlow`（`task-panel.js`）调用 `api.restoreFileChangesFor(task.id)` 恢复收纳框，呈现与退出前完全一致；后台任务变更事件仅写入缓存仓，绝不触发前台 DOM 渲染；
- **删除识别与去伪（工作目录感知）**：显式删除类工具执行成功即记为「删除」；Shell 类工具启发式解析命令文本中 `rm / del / Remove-Item` 目标路径，并在命令执行成功后经 `pi_path_exists` 复核（路径确实消失才记为删除，杜绝误报）；**候选路径必须先经工作目录归一化再探测**：内核 Shell 实际 CWD ≠ 桌面端进程 CWD，`cd <dir> && rm <相对路径>`、MSYS 风格 `/c/Users/...`、`~` 与 `[USER_HOME]` 直接探测全部失真 → `existedBefore=false` 被去伪规则误杀（历史缺陷根因：删除示意信息在收纳框中消失）；故 `extractDeletedPathsFromCommand(commandText, baseDirs)` 按 `&&/;/|/换行` 切段顺序扫描并维护 `cd` 链路工作目录，配合 `loadBaseDirs()`（真实主目录 + 路由工作区会话 CWD 兑底）把每个目标归一化为绝对路径，tool-start 探测与 tool-end 复核双侧统一取基准，保证配对一致；解析失败退化为原文，绝不虚报；删除为终态，同一文件多动作合并时永远胜出；
- **展示时机**：`agent-end` 正常收尾后经 `api.showFileChangesBox()` 渲染于会话流末尾（渲染前先 `syncViewToStore` 对齐当前活跃任务缓存仓，跨轮置底累积，整条可折叠展开且折叠态回写缓存仓，平滑贝塞尔旋转过渡）；全新会话由 `api.resetFileChanges()` 清视图态（`flow-stream.js` resetStreamState 非 followUp 分支调用，会话缓存仓保留不释放）；
- **头部统计指示 (Summary Pills)**：头部右侧展示直观的分类统计（`+N 新增` / `~N 修改` / `-N 删除`）以及总数 `N 个文件`，取消胶囊边框+背景色，纯透明背景，折叠态亦可一目了然；
- **打开所在文件夹**：点击条目经 Rust `pi_reveal_path` 在 Windows 资源管理器中高亮定位该文件（`tauri_plugin_opener::reveal_item_in_dir`）；**删除类条目直接定位其原所在文件夹（上级目录）**，避免完整路径因父目录解析异常而退化为打开「我的文档」，并弹全局 Toast 反馈；
- **核心标识外观与高级配色 (Kind Badges)**：
  - **取消胶囊边框+背景色**：采用纯透明背景（`background: transparent; border: none; box-shadow: none;`），无多余药丸状方块或边框，纯净通透；
  - **新增 (kind-add)**：加号 SVG + 文本；浅色采用翠绿色 `#047857`；深色采用碧玉荧绿 `#34d399`；
  - **修改 (kind-modify)**：笔触 SVG + 文本；浅色采用琥珀金色 `#b45309`；深色采用暖阳流金 `#fbbf24`；
  - **删除 (kind-delete)**：垃圾桶 SVG + 文本；浅色采用胭脂朱红 `#be123c`；深色采用珊瑚粉红 `#fb7185`；条目名称带轻微删除线修饰；
- **自适应宽度与路径截断（杜绝横向滚动条）**：
  - 收纳框外层、头部、列表与条目统一采用 `width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden;`，禁止负外边距；
  - 列表强制 `overflow-x: hidden;`，绝不触发横向滚动条；
  - 文件名（`max-width: 45%`）与目录路径（`flex: 1 1 0`）自适应收缩，过长文本统一以 `...` 省略号优雅截断，hover 可见全路径 tooltip；
  - 条目常态背景透明，悬浮/聚焦显手绘微边框与极淡背景，右侧平滑浮现“定位”提示与手绘文件夹图标。

---

## 📌 10. 多任务直切自动挂起、状态隔离与历史重定向 (Auto-Suspend on Switch & Smart Redirection)

当系统存在多个并发或后台任务时，Flow 界面支持在任务之间直接切换，并遵循以下严格的状态隔离铁律：

1. **自动挂起旧任务与解耦归档（杜绝幽灵任务与半死快照）**：
   - 从右上角任务抽屉、会话记录或系统通知中点击直接进入目标 Task 时，原前台活跃任务必须由 `TaskManager.setActiveTask` / `createTask` 自动转入后台挂起（`prevTask.isSuspended = true`）；
   - **终态任务严禁后台挂起（防幽灵已完成胶囊）**：仅当前台原活跃任务处于运行态或待确认态（`thinking / streaming / tool_exec / paused`）时才转入后台挂起（`prevTask.isSuspended = true`）；若原任务已处于终态（`completed / aborted / error`），严禁赋予 `isSuspended = true`，直接从 `TaskManager` 清理，彻底杜绝从历史记录/会话记录切换进入其他会话时右上角瞬间冒出前一会话「已完成 (1/1 Task)」幽灵绿色徽标；
   - **会话延续与多轮归属唯一性**：无论是全新会话、还是从「会话记录」或「历史记录」抽屉还原继续提问，后续追问统一透传底层会话文件路径（`sessionPath`）与会话 ID（`sessionId`）；Rust 后端 `PiHostPool` / `SessionHost` 在拉起内核子进程时，若存在已有会话路径（或经 `SessionIndexCache` 反查命中），严格采用 `pi --mode rpc --session <path>` 续写同一 `.jsonl` 文件，严禁使用盲目生成新 UUID 的 `--session-id` 导致多轮对话在重启或直接退出后被割裂为独立碎片记录；`ConversationHistoryService` 归档时严禁用空字符串覆写已有 `sessionPath`，保证历史记录与磁盘会话 100% 对应且多轮聚合完整；
   - 切换前由 `archiveCurrentFlowToHistory()` 将前台 DOM 当前进度完整同步回原任务内存 `currentActive.turns`；**但若原任务仍在运行中（thinking / streaming / tool_exec / paused），绝对不调用 `conversationHistoryService.recordConversation()` 写入静态历史**，确立“完全终止才归档”铁律；
2. **跨会话状态彻底重置与工具引用自愈回填**：
   - 共享渲染管线 `renderTurnsIntoFlow`（`task-panel.js`）在渲染新任务前，必须执行：
     - `api.resetFileChanges()`：清空文件变更收纳框的 DOM 引用，防止旧任务的节点在清空 DOM 后残留；
     - `flowView.renderedToolCards.clear()`：清空旧任务工具卡片引用；
     - `flowView.activeThinkingStep = null`：重置活跃思考步骤；
     - `flowView.currentSteps = []`：重置步骤快照，杜绝跨会话残留；
   - **末轮工具卡自愈回填**：`renderTurnsIntoFlow` 在创建末轮 DOM 后，遍历其中的 `.flow-step-tool` 节点回填至 `flowView.renderedToolCards`，并在 `flow-pipeline.js` 的 `tool-update` / `tool-end` 中结合 DOM ID 动态检索与读秒更新兜底，保证切回运行中任务后工具卡绝不永久卡死在 `running`；末轮纯数据回填写入当前任务分仓（`flowStore.for(task.id).set(...)`）；
3. **Flow DOM 防重入与历史记录智能重定向**：
   - **防重入铁律**：`restoreTaskToFlow` 与 `restoreConversationToFlow` 在首行校验 `if (viewStore.mode === VIEW_FLOW && taskManager.getCurrentActiveTask()?.id === targetId) return;`，已在 Flow 查看当前任务时绝不重复清空 DOM，防止流式截断与界面闪烁；
   - **历史入口智能重定向**：用户从界面1历史讯息抽屉点击卡片时，优先探测该会话是否在 `TaskManager` 中作为活跃/挂起任务存在。若存在，全链路直接重定向至 `restoreTaskToFlow`，严禁用静态历史旧 turns 覆写实时 live turns，严禁强行覆盖 `task.status = "completed"`；
   - **视觉标识互斥**：历史抽屉卡片探测后台运行态，当会话处于运行中时在 meta 区呈现手绘脉冲「运行中」微动效徽章；
4. **收纳框与 Mini 胶囊自愈更新**：
   - 由 `api.restoreFileChangesFor(task.id)` 恢复目标任务在生命周期内累积的文件变更；
   - 切换完成后即时调用 `updateMiniTaskCapsuleUI()`，确保右上角 Mini 胶囊数字与后台挂起任务数量 100% 精确吻合。

---

## 📌 11. 会话回退与文件撤回 (Flow Rollback: Session Rewind & File Restoration)

Flow 支持回退到任意一次历史对话（配合 pi 内核原生历史节点回退），并在回退时自动撤回「已修改 / 已删除」的文件（已新增的文件永不撤回，防误删铁律），完成后顶部浮窗提醒结果（成功/失败，持续 3 秒）。实现链路横跨三层：内核快照扩展 (`src-tauri/extensions/pi-rollback-guard.ts`) → Rust 还原与 RPC 路由 (`src-tauri/src/rollback.rs` + `src/commands/rollback.rs`) → 前端编排 (`src/modules/flow-rollback.js`)。

### 11.1 内核侧确定性快照（工具执行前，杜绝竞态）
- **启用开关**：桌面端拉起 pi 内核进程时注入环境变量 `PI_DL_ROLLBACK=1`（Supervisor 主进程与 SessionHost 任务进程双侧注入；扩展未检测到该变量时完全静默退出，不影响原生 pi 使用场景）；
- **物化机制**：`rollback::materialize_extension()` 在应用启动时把编译期内嵌源码（`include_str!`）幂等写入 `~/.pi/agent/extensions/pi-rollback-guard.ts`（全局扩展目录，免项目信任门禁）；
- **快照时机铁律**：扩展监听 `tool_call` 事件（pi 扩展体系中先于工具 `execute` 执行、可阻塞），在工具真正落盘前读取目标文件内容 → 保证快照一定是「执行前状态」，彻底消除前端 tool-start 事件与工具执行之间的竞态；
- **路径提取**：与前端收纳框同源的 `PATH_KEYS` / `edits/files/changes` 多文件结构 + Shell `rm / del / Remove-Item` 家族启发式解析（`cd` 链路 + `~` 展开 + MSYS 盘符转换 + `ctx.cwd` 兑底归一化）；
- **落盘格式**：JSONL 追加至 `~/.pi-dl/rollback/<sessionId>/snapshots.jsonl`，每行 `{ ts, sessionId, toolCallId, toolName, path, contentB64, tooLarge? }`；单文件 > 8MB 只记存在标记不落内容；单会话总量 64MB 封顶；文件不存在（新增场景）不写行；
- **会话血缘**：fork/clone 产生新会话文件时，扩展在 `session_start` 将 `{ session, parent }` 追加写入 `~/.pi-dl/rollback/lineage.jsonl`，还原时沿链汇集祖先会话快照，跨 fork 回退依然可用。

### 11.2 Rust 还原与 RPC 路由
- **`src-tauri/src/rollback.rs`**：`rollback_files(session_id, targets, dry_run)` 按 `(path, toolCallId)` 精确匹配**最早**快照（还原内容 = 回退点之后第一次变更前的状态）；采用**两阶段事务性保证（Phase 1 预检与内存解码，存在任何缺失/超限/解码失败立即中止且不触碰磁盘，彻底杜绝半撤回；`dry_run: true` 模式在 Phase 1 后无副作用直接返回；Phase 2 全部就绪后原子落盘写入）**；原生支持 0 字节空文件 base64 解码与空目录恢复；返回 `{ restored, restoredCount, missing, dryRun }`；路径键归一化（`\`→`/` + Windows 小写不敏感）；
- **新 RPC 指令**（`src-tauri/src/commands/rollback.rs`）：`pi_get_fork_messages(task_id?)` / `pi_fork_session(task_id?, entry_id)` / `pi_rollback_files(task_id?, targets, dry_run?)`；task_id 为空路由主会话 Supervisor，否则经 `PiHostPool::send_command_to_task_with_response` 路由该 Task 专属内核进程；
- **响应帧隔离铁律**：`pending_responses` 等待表 + stdout 事件环中 `type=="response"` 帧按 id 唤醒 oneshot 等待者；无论有无等待者（如超时后响应姗姗来迟）统一 `continue` 丢弃，绝不落入前端广播通道产生杂散 IPC 帧。

### 11.3 前端编排 (`src/modules/flow-rollback.js`)
- **入口**：轮次提问卡右侧「回退到此处」按钮（`.flow-rollback-btn`，复用手绘 rewind 图元；常态隐藏、悬浮提问卡显现、常态透明无边框悬浮显手绘边框）；`flowConversation` 事件委托，按 `.flow-message-group` DOM 顺序定位轮次下标（历史轮次与当前轮次统一入口）；
- **守卫**：任务生成中（thinking / streaming / tool_exec）禁止回退；轮次下标越界拦截；
- **预览**：`api.collectRollbackPreview(taskId, fromIndex, turns)`（`flow-file-changes.js`）——汇总回退点之后全部变更日志，按路径取最早动作：`add` → keepAddList（保留不撤回）；`modify/delete` → restoreList（携 toolCallId 供快照精确匹配）；
- **确认与大文件明示提醒**：弹窗前执行 `pi_rollback_files(dry_run: true)` 预检；`SketchModal`（`detailHtml` 富文本详情）列出将恢复的修改/删除文件与保留的新增文件；若检测到超过 8MB 快照上限的大文件，顶部渲染醒目手绘警告横幅（`.rollback-warning-banner`），条目标记朱红 `超限 >8MB` 徽标，弹窗转为只读警示模式，明确告知已被保守阻止且 0 写入磁盘；
- **执行执行链路 (两阶段原子性)**：
  ① **回退点预解析**：`pi_get_fork_messages` 定位内核历史节点；
  ② **快照预检**：`pi_rollback_files(dry_run: true)`，存在任何缺失或超限立即保守中止，磁盘与内核 0 变更；
  ③ **内核 fork 先行**：`pi_fork_session` 创建新分支；若失败，此时磁盘 0 写入，环境完全干净；
  ④ **原子落盘写入**：内核成功后执行 `pi_rollback_files(dry_run: false)` 写回磁盘；
  ⑤ **本地剪枝与重渲**：`api.pruneFileChangesFor` 剪枝变更仓 + `renderTurnsIntoFlow` 重渲（回退至首轮前清空会话流）；
  ⑥ **历史记录同步与防幽灵恢复 (History Synchronization & Anti-Ghost Resurrection)**：
     - **首轮回退（`turnIndex === 0`）**：会话轮次归零退化为草稿，调用 `conversationHistoryService.deleteConversation` 物理删除该历史记录并解绑 `task.conversationId = null`，通知抽屉重渲；打上 `task.__isRolledBack = true` 显式标记，彻底阻断 `restoreTaskToFlow` 从历史中盲目恢复旧轮次；`archiveCurrentFlowToHistory` 与 Step Back 增加 0 轮归档门禁防御；
     - **多轮回退（`turnIndex > 0`）**：调用 `conversationHistoryService.pruneConversationTurns` 将历史快照同步截断至 `turnIndex` 轮并刷新最终回答与耗时快照，保持历史卡片与当前 Flow 100% 同步；
- **回退语义**：fork 至第 k 轮用户消息 = 保留前 k-1 轮完整对话，第 k 轮提问回填输入框供编辑重发，第 k 轮回复及其后全部丢弃；文件状态还原至第 k 轮执行前；
- **结果提醒**：顶部浮窗（`bus.emit("ui:toast")`，事件在 `contracts.js` 契约表登记，`task-panel.js` 为唯一 `bus.on` 渲染属主）持续 3 秒，成功/失败/部分失败文案精确到恢复文件数与原因。
