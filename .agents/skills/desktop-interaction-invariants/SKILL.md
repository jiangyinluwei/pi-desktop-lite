---
name: desktop-interaction-invariants
description: Pi Desktop Lite 桌面端交互 23 项核心铁律的完整机制规范（唯一全文事实来源）。涵盖四态界面流与 Step Back、挂起/终止双通道、任务直切自动挂起、会话延续唯一性、历史记录持久化预算与 30 天归档、会话回退撤回、模型无痕内置重连、流中断 300 秒宽容期、中途提问人工回归、工具入参自愈、组件预设与补丁闸门、生图与多模态路由及无缝回归等。当涉及"交互铁律/铁律N/UI修改/界面行为/挂起/终止/重连/宽容期/人工回归/组件预设/组件补丁/会话历史/回退撤回/生图路由/多模态路由"等任何 UI 与交互修改时，必须先读本技能再动手。
---

# 桌面端交互 23 项核心铁律（完整规范 · 唯一全文事实来源）

> **与 `AGENTS.md` 的关系**：`AGENTS.md` 仅保留每条铁律的一句话不变量速查表；**本文件承载全部实现细节、历史根因与缺陷防范链路，是唯一全文事实来源**。任何 UI 与交互修改前必须先读本文件对应条目；修改铁律内容时，必须同步更新本文件与 `AGENTS.md` 速查表（核心准则一）。

本项目前端作为轻量桌面应用，所有 UI 与交互修改必须严格遵守以下 23 项核心铁律。

---

## 铁律 1：拖拽区域限制

全窗口仅顶部约 **30px** 标题栏支持拖拽（`-webkit-app-region: drag` / `data-tauri-drag-region`），内容主体、背景与品牌区严禁开启拖拽。

## 铁律 2：焦点释放与消除高亮

输入框高亮在点击外部空白区、非输入元素或右键点击时，必须立即失焦（`blur()`）并消除高亮。

## 铁律 3：全域右键“返回上一步 (Step Back)”与四态界面流

- 全域禁用浏览器默认右键菜单（`contextmenu` 拦截）；
- **四态界面层级流**：`半透明侧边栏 (最高优先级)` ➔ `设置全页面 (界面4: settings)` ➔ `Flow 交互版 (界面3: 运行/暂停态转入后台挂起，已结束/中断态归档至历史)` ➔ `专注版 (界面2)` ➔ `详细版 (界面1)` ➔ 输入框失焦/清空；
- **设置页 → Flow 定向回退 (`flowFromSettings`)**：从设置页会话记录 Tab「进入 Flow」时置 `viewStore.set({ flowFromSettings: true })`；Flow 中右键/Esc 时若空闲/已结束，直接回退至设置页会话记录 Tab（`previousMode: VIEW_DETAILED` 钉住 `viewStore.previous`，再右键照常回界面1）；若运行/暂停，走正常挂起通道；
- **挂起与终止双通道解耦与强制终止铁律 (Decoupled Suspend & Force Termination Invariance)**：右键/Esc 转入后台挂起（`isSuspended = true`，进入 `TaskManager`，不调用 abort）；显式「⏹ 终止」按钮强制彻底终止 Agent 生成（Rust `SessionHost` 强杀子进程并阻断未决 prompt，前端 `PiClient` 拦截流式事件派发，`TaskManager` 门禁严禁任何迟到事件复活任务为 running/thinking/streaming/completed）。**手动点击终止时，全链路绝对禁止触发任何模型内置重连**；**人工交互未决请求随 Task 挂起保留**（`task.pendingUiRequests` 不随挂起丢失，回入 Flow 由 `restoreHumanInputCards` 重建作答横条），终止时先 best-effort 回写 `extension_ui_response{cancelled:true}` 再走强杀链路（详见铁律19）；已终止任务（`isAborted === true` 或 `status === "aborted"`）右键/Esc 严禁转入后台挂起（`suspendCurrentFlow` 返回 `null`，`handleGlobalStepBack` 判定 `isRunning = false` 直接归档并物理清除该 Task，回退至 Focus 界面）；**终止按钮双向同步铁律 (Abort Button Visibility Invariance)**：非 Flow 模式下显式隐藏 `#flow-btn-abort`（`.hidden`），从右上角任务抽屉、通知、会话记录或历史重定向进入 Flow、或前台活跃任务切换时，由单一职责函数 `syncFlowAbortButtonVisibility()` 联动 `view:changed`、`TaskManager` 活跃任务事件与防重入首行校验活跃任务运行态（`taskManager.isTaskRunning()`），运行中 100% 同步移除 `.hidden` 显现终止按钮，终态与非 Flow 视图绝对隐藏，彻底杜绝挂起后重新回入会话导致终止按钮消失、只能退出抽屉终止的缺陷；
- **任务直切自动挂起铁律 (Auto-Suspend on Active Task Switch)**：从右上角任务抽屉、历史会话或通知点击直接切换活跃 Task 时，原前台活跃任务必须在 TaskManager 中自动无缝转入后台挂起（`prevTask.isSuspended = true`），绝不允许产生既不在前台又未挂起的幽灵任务；切换进入新 Task 时统一在 `renderTurnsIntoFlow` 中重置收纳框引用 (`api.resetFileChanges`) 与流式步骤/工具卡片缓存，并对齐最新轮次步骤，保证多任务间任意来回直切均 100% 保持会话完整、互相隔离且不丢失；
- **终态任务严禁后台挂起与幽灵已完成胶囊防范 (Completed Task Non-Suspension Invariance)**：在任务直接切换 (`setActiveTask` / `createTask`) 时，仅当前台原活跃任务处于运行态或待确认态（`thinking / streaming / tool_exec / paused`）时才转入后台挂起（`prevTask.isSuspended = true`）；若原任务已处于终态（`completed / aborted / error`），严禁赋予 `isSuspended = true`，直接从 `TaskManager` 清理，彻底杜绝从历史记录/会话记录切换进入其他会话时右上角瞬间冒出前一会话「已完成 (1/1 Task)」幽灵绿色徽标的缺陷；
- **会话延续与多轮归属唯一性铁律 (Session Continuity & Consolidation Invariance)**：无论是全新会话、还是从「会话记录」或「历史记录」抽屉还原继续提问，后续追问统一透传底层会话文件路径（`sessionPath`）与会话 ID（`sessionId`）；Rust 后端 `PiHostPool` / `SessionHost` 在拉起内核子进程时，若存在已有会话路径（或经 `SessionIndexCache` 反查命中），严格采用 `pi --mode rpc --session <path>` 续写同一 `.jsonl` 文件，严禁使用盲目生成新 UUID 的 `--session-id` 导致多轮对话在重启或直接退出后被割裂为独立碎片记录；`ConversationHistoryService` 归档时严禁用空字符串覆写已有 `sessionPath`，保证历史记录与磁盘会话 100% 对应且多轮聚合完整；
- **历史记录智能重定向与解耦归档铁律 (History-to-Task Smart Redirection & Decoupled Archive)**：从历史讯息抽屉点击卡片时，优先探测该会话是否在 TaskManager 中作为活跃/挂起任务存在；若存在直接重定向至 `restoreTaskToFlow`，严禁用静态旧 turns 覆写 live turns 或强制置 `completed`；`archiveCurrentFlowToHistory` 仅在终态（`completed / aborted / error`）时写入持久化历史，运行中仅同步内存 `turns`；历史抽屉对后台运行中任务展示脉冲「运行中」微动效徽章；**持久化尺寸预算与优雅降级 (Persistence Budget & Graceful Degradation)**：Chromium localStorage 每源硬配额约 10MiB（值以 UTF-16 落盘），历史记录含工具卡片 HTML 快照（`toolCalls[].html`）与步骤快照（`steps[]`），工具密集会话可达数 MB，一旦总序列化体积超配额 `setItem` 会抛 QuotaExceededError 且被 try/catch 吞掉，表现为「新会话界面内可见、重启后永久消失」（即“会话完成后直接关闭软件再打开，界面1 下方历史记录不出现该会话”）；因此 `ConversationHistoryService` 写入前必须执行预算瘦身（全列表 `MAX_STORAGE_BUDGET_CHARS`/单条 `MAX_CONVERSATION_CHARS`/逐轮回答 `MAX_RESPONSE_TEXT_CHARS` 三级上限），自最旧会话起剥离重载荷快照、仍超则物理丢弃最旧会话，`setItem` 仍失败再逐级降级重试，**最新一条记录在任何降级层级均豁免、永远优先完整落盘**，内存与磁盘同步裁剪保证 restore 行为一致；**30 天未打开自动归档清除 (Stale Conversation Auto-Archive)**：最后一次打开时间（`lastViewedAt`，缺省回退 `createdAt`）距今超过 30 天的会话快照，在启动加载（`loadFromStorage`）与每次持久化（`saveToStorage`）时由 `purgeArchivedConversations()` 自动从内存与 localStorage 归档清除并立即回写磁盘，同步清除对应幽灵隐藏标记（仅清理 UI 层快照，绝不触碰 `~/.pi` 底层会话 JSONL 文件）；无任何时间戳的损坏记录不予清除（无法判定）；用户还原/点开历史会话时经 `touchConversation` 刷新 `lastViewedAt` 继续保活；
- **会话回退与文件撤回铁律 (Flow Rollback & File Restoration)**：Flow 支持回退到任意一次历史对话（配合 pi 内核原生 RPC fork 历史节点回退），回退时自动撤回「已修改/已删除」的文件，**已新增的文件绝不撤回**（防误删）；快照由内置扩展在 `tool_call` 阶段（工具执行前、可阻塞）确定性落盘至 `~/.pi-dl/rollback/<sessionId>/`（桌面端注入 `PI_DL_ROLLBACK=1` 启用）；单文件 >8MB 超限明示警告横幅与专属徽标，弹窗转为只读警示阻止盲目回退；执行链路 = 回退点预解析（`pi_get_fork_messages`）→ 快照预检（`pi_rollback_files(dry_run: true)`，存在缺失/超限保守中止，磁盘与内核 0 变更）→ 内核 fork 先行（`pi_fork_session`，失败则磁盘 0 写入环境完全干净）→ 原子落盘（`pi_rollback_files(dry_run: false)`）→ 本地变更仓剪枝重渲 + 提问回填输入框 + 历史服务双向同步（首轮回退物理清除历史记录并解除绑定，多轮同步剪枝历史轮次；标记 `__isRolledBack` 阻断旧历史幽灵复活；0 轮草稿态任务严禁归档）；完成后顶部浮窗提醒成功/失败持续 3 秒；生成进行中禁止回退；响应帧无论有无等待者统一丢弃不落入广播通道（详见 `.agents/skills/flow-interaction-pattern/SKILL.md` §11）；
- **Flow DOM 防重入铁律 (Flow Re-entrance Guard)**：已处于 Flow 模式且当前活跃任务匹配时，`restoreTaskToFlow` 与 `restoreConversationToFlow` 直接退出，严禁清空 DOM 导致流式截断与界面闪烁；
- **运行中工具切片 DOM 自愈 (Running Tool DOM Self-Healing)**：切入运行中任务时由 `renderTurnsIntoFlow` 回填 `flow.renderedToolCards`，并在 `flow-pipeline.js` 的 `tool-update`/`tool-end` 中增加基于 DOM ID 的动态检索兜底与读秒自愈刷新，防止卡片永久卡在 running；
- **后台流式串轮过滤铁律**：挂起任务的流式事件经前台门禁 (`taskManager.isForegroundStreamTask` + `piClient.lastEventTaskId`) 在 Flow UI 层全量过滤，只入 Task 数据缓冲，绝不写入前台 Flow DOM/历史轮次；历史讯息抽屉 (`task-panel.js`) 采用签名比对 + 180ms 节流调度渲染，杜绝后台任务事件风暴导致的悬浮频闪与双击选中失效；**会话流缓存铁律**：每个 Task 一份文件变更缓存仓（`flow-file-changes.js` `sessionStores`），前后台事件按 task_id 归仓收集、直至程序生命周期结束；右键退出（挂起/归档）后经历史记录/Task 记录回入 Flow 时由 `renderTurnsIntoFlow` → `restoreFileChangesFor` 一致恢复收纳框，历史快照卡片重绑以 `__piBound` expando 去重（严禁 `dataset.bound` 判定，杜绝双绑互消与快照死卡）；**删除识别工作目录铁律**：Shell 删除目标（`rm / del / Remove-Item`）须经 `cd` 链路 + MSYS 盘符转换 + `~`/`[USER_HOME]` 展开 + 会话 CWD 兑底归一化为绝对路径后再经 `pi_path_exists` 探测/复核，杜绝相对路径因桌面端进程 CWD 失真被去伪规则误杀（表现：删除示意信息在收纳框中消失）；**新增文件同步探测铁律 (Synchronous Pre-Execution Probe Invariance)**：写文件工具（`write` / `write_file` / `create_file` 等）启动时，`tool-start` 必须纯同步执行并在当前事件调用栈内立即向 `existenceProbes` 登记存在性探测 Promise，严禁引入任何 `await` 导致微任务挂起，杜绝写文件瞬时完成后 `tool-end` 抢先到达引发探测竞态将新增文件误判为修改；`tool-end` 比对统一使用 `normalizePathKey` 消除正反斜杠与大小写差异；
- **思维切片生命周期与无显式文本完成机制 (Thinking Step Lifecycle & Retention Invariance)**：提问后首 token 延迟期呈现「Thinking (0.0s)...」伪思维框并 100ms 读秒；若模型未输出显式思考文本直接跃迁至工具调用（`toolcall-delta-start` / `tool-start`），或显式派发 `thinking-start`，切片封口时必须定格保留为「Thinking (X.Xs) 已完成思考」，绝严禁将其作为空占位符从 DOM 中物理移除导致界面闪烁与思维状态丢失；仅当模型首 token 为纯正文输出（`text-start` / `text-delta` 且无显式思考与工具边界）时，初始伪思考框才作为加载占位符静默移除；收起态实时展示从右向左的流动输出流，跟踪最新输出内容（输出速度越快流动越快），封口与折叠时右对齐定格，增量同步直达缓存引用消除热路径 DOM 查询；无显式思考输出展示“已完成思考”时自动消除左侧渐隐遮罩并左对齐呈现，保持字迹清晰纯粹；
- **输入框防抖**：详细版下对着输入框点击右键时静默屏蔽，杜绝界面瞬切抖动；新模块均需接入 `window.__piRegisterStepBack`。

## 铁律 4：手绘 SVG 矢量图元规范（消除系统 Emoji）

- 禁止使用系统默认 Emoji，所有功能与提示图标统一在 `src/assets/svg/` 归档并以内联手绘 SVG 呈现；
- 统一采用 `currentColor`，深度适配浅色（素描绘图纸）与深色（炭黑素描黑板）双模主题。

## 铁律 5：按钮设计与交互铁律（常态透明、常态无边框、悬浮显框）

- 主界面新增按钮常态背景必须透明（`background: transparent`）；
- 常态严禁显示可见边框，必须采用 `border: 1px solid transparent;` 保持 1px 几何占位，杜绝悬停时因边框显现导致布局抖动（Layout Shift）；
- 仅在鼠标悬浮（`:hover`）或键盘聚焦（`:focus-visible`）时显现手绘边框与微背景。

## 铁律 6：隐藏式极简滚动条规范 (Minimal Slim Hidden Scrollbar)

- 全局消除浏览器默认上下箭头按钮与滚动槽；
- 常态为 4px 极窄竖条（隐匿且不遮挡内容），采用半透明 `var(--sketch-border-subtle)`（透明度 0.45）；
- **内容区 hover 不高亮**：鼠标悬浮内容区时保持静默；仅当鼠标移入滚动条轨道/滑块本身范围时，滑块展开至 6px 并高亮加深。

## 铁律 7：手绘草图组件套件 (Sketch Components)

- 下拉框统一采用 `SketchSelect`（180ms Pop & Micro-Shake 微抖动，双向同步原生 `<select>`）；
- 表单填表统一采用 `SketchAutoFill`（消灭原生填表变色伪类，预设联动与历史记忆沉淀）；
- 模态弹窗统一采用 `SketchModal`（居中定位、毛玻璃遮罩、全域右键/Esc 优先拦截与焦点陷阱）。

## 铁律 8：系统托盘与单实例互斥

- 单实例互斥运行，重复启动自动唤醒置顶已有主窗口；
- 点击右上角关闭按钮隐藏至系统托盘常驻（`window.hide()`），托盘支持打开、设置与彻底退出。

## 铁律 9：失焦 Windows 系统通知铁律

仅在软件处于**失去焦点 (Blurred / Background)** 状态且全部输出完成、需人工确认或发生中断报错时触发 Windows 原生 Toast 通知，聚焦时绝对静默。

## 铁律 10：无内核运行与交互降级规范 (Kernel-less Operation & Degradation)

- **平稳启动**：未检测到内核时平稳启动进入待机态，禁止死循环重启；
- **顶部状态展示**：界面1/2/3 顶部模型标签常驻显示「未检测到pi内核」，点击直达设置页内核下载面板；
- **发送入口屏蔽**：发送按钮置灰禁用（`disabled`），输入框按键拦截并弹出友好指引；
- **内核面板降级**：内核页状态显示「未检测到内核 / 未安装」，「重启内核」与「不再提醒更新」禁用，内核组件区域完全隐藏；
- **一键下载自愈**：启动自动检测官方最新版本，支持「一键下载并安装」，安装就绪后自动拉起内核并恢复 UI；
- **内核保险自动重连 (Kernel Insurance Auto-Reconnect)**：后台检测内核 `crashed` 状态由 Rust 监督器自动平滑重连最多 5 次（间隔 2 秒，重连前二次校验 `is_stopping` 防止竞态）；成功即恢复 Ready；5 次均失败落入终态 Crashed 并广播 `pi:kernel-reconnect-failed`，前端左上角触发红色抖动小闪电胶囊提醒（点击可手动重启内核），内核恢复后自动隐藏；
- **模型缺失防重启风暴**：`set_model` 返回 Model not found 时，Rust 监督器（`supervisor.rs`）先经 `get_available_models` 探测目标模型是否仍存在于配置目录——不存在（配置已被删除）则拒绝重启内核并直接返回可读错误，杜绝「重启 → 仍找不到 → 前端 `kernel-status-change` 重放自动选用 → 再重启」死循环；前端 `model-panel.js` 选用持久化模型前同步校验目录存在性，且 `loadModelsAndState` 带防重入闸门；自定义运营商/模型删除入口（`custom-provider-panel.js`）对正在使用的模型及其所属运营商实施删除守卫（与白名单锁定行为对齐）。

## 铁律 11：多模态文件与文件夹拖拽与剪贴板智能粘贴链路规范

- 支持直接拖入单/多文件或整个文件夹到输入框与主窗口；
- 支持在对话框直接按 `Ctrl+V`（或右键粘贴）粘贴图片（QQ/微信/系统截图等内存位图由后端原子落盘至 `~/.pi-dl/attachments/`）、文档与文件夹（Windows 资源管理器复制的文件与目录通过 Rust 原生 `CF_HDROP` 提取绝对路径）以及本地绝对路径文本，识别后作为多模态输入（等同于鼠标拖入）；普通文本与代码放行原生粘贴，不误伤自然语言输入；
- 文件夹拖入或粘贴时由 Rust 后端（`pi_inspect_paths`）直接生成单个文件夹概述胶囊（`category: "folder"` + 手绘文件夹 SVG），不展开炸裂为零散子文件；
- 附件胶囊在输入框内部上方自然换行排列（支持极简滚动条与无缝换行，杜绝横向溢出），下方保留 100% 全宽文本输入区；发起对话时自动注入系统绝对路径供内核原生遍历。

## 铁律 12：Markdown 预览渲染、全域外链跳转与图片展示/存桌面规范

- **引擎与质感**：模型输出全面采用 Typedown 质感 Markdown 预览渲染引擎（`src/lib/markdown-renderer.js` + `src/styles/markdown.css`）；
- **核心语法支持**：支持多级标题、围栏代码块（手绘语言徽标 + 一键复制 + 复制反馈 + 多语言轻量高亮）、GFM 表格、任务清单（Checkbox）、GitHub Callout 警示框（Note/Tip/Important/Warning/Caution）与流式未闭合标记自愈；
- **全域外链拦截**：全域 HTTP/HTTPS/Mailto 超链接自动解析并拦截点击，通过 Tauri 后端（`tauri_plugin_opener` / `pi_open_url`）唤起操作系统默认外部浏览器打开，严禁在 Webview 内部跳转；
- **图片直观渲染与 Data URL 异步映射**：
  - 支持标准 Markdown 图片 `![alt](url)`、HTML `<img src="..." />`、以及纯图片路径独占行/链接；
  - 针对 Windows 桌面端 Webview2 同源安全隔离策略（禁止直接加载 `C:\` 或 `file:///` 物理盘路径），统一通过 Rust IPC `pi_read_image_as_data_url` 异步读取为 `data:<mime>;base64,<data>`，前端维护 `imageCache` Map 消除重复读取损耗；
  - 图片以手绘风格 `.md-image-card` 呈现，带微妙阴影与半透明线框，避免 Layout Shift；
- **手绘操作栏与一键保存到桌面**：
  - 每张图片卡片下方集成极简手绘操作栏（`.md-image-bar`）：
    - 「一键保存到桌面」：调用 Rust `pi_save_image_to_desktop`，支持 Base64、网络图片下载与本地文件拷贝，自动采用 `yyyyMMdd_HHmmss` 与递增后缀防重名覆盖；点击后按钮变换为翠绿对勾（`✓ 已保存到桌面`）并保持 2.2 秒微反馈，同时触发手绘提示；
    - 「打开所在目录」：本地文件支持点击通过 `pi_reveal_path` 在 Windows 资源管理器中高亮定位；
- **手绘全屏灯箱放大预览 (Lightbox)**：
  - 点击图片卡片主体可弹出全屏极简毛玻璃灯箱预览（`.md-image-lightbox`），支持滚轮/缩放与原始高清比例，支持点击外部空白、按下 Esc 键或全域右键 (Step Back) 快速平滑关闭；
- **生图任务兜底自愈机制 (Pure Image Generation Self-Healing Invariance)**：
  - 若模型在纯生图任务中仅输出了工具调用或文字说明（例如仅描述“图片已生成并保存在 xx.png”），但未以 Markdown 图片语法主动输出 `![img](...)`：
  - 流式终态收口阶段（`finalizeStream`）自动通过 `api.getNewlyAddedImageFiles` 比对会话生命周期内新增或修改的图片文件；
  - 若检测到新增图片文件未在回答卡 DOM 中完成渲染，系统自动在其输出卡末尾动态注入手绘风格的自愈图片预览框（`.flow-auto-image-notice`），确保用户在生图任务中无需手动寻址、100% 默认直接可见并可一键保存到桌面；
  - 内置运行态约束（`document-multimodal-inspection/SKILL.md` 指令 6 与 `RULES.md` 指令 10）要求模型在生图工具调用成功后，必须在回答中以 Markdown 语法直接输出图片。

## 铁律 13：预设工作区 "code-area" 路由工作区与技能调度中枢规范 (Hub & Routed Workspace)

- **定位**：`code-area` 作为全局编码技能集与调度中枢，在 `code-area/.agents/skills/` 维护专业技能；
- **物理 CWD vs 路由目标**：Pi 内核物理 CWD 驻留在 `code-area` 运行时目录（原生感知内置技能），同时内设绑定「路由工作区（目标项目根路径）」；
- **原生 Windows 文件夹选择器**：基于 Rust `rfd` (IFileOpenDialog) 实现 Windows 原生 OpenFolder 文件夹选择器（右下角为标准的「选择文件夹」/「打开」，杜绝网页上传字样与弹窗）；
- **平滑切换与择时绑定**：允许先切换至 `code-area`，再在设置面板或主界面择时添加路由；处于 `code-area` 且未绑定路由时，输入框禁止输入（只读提示），点击输入框快速呼出路由绑定对话框；
- **免污染铁律**：`code-area` 自身绝对不创建或修改业务文件，所有代码读写、补丁与命令执行严格作用于目标路由项目；
- **运行时命令与文件路径自动锚定**：由于 `code-area` 物理 CWD 驻留在其自身 Hub 目录（`~/.pi-dl/workspaces/code-area`），为彻底杜绝模型因执行相对路径或未提前 `cd` 目标目录导致 `No such file or directory`（Exit Code 2），内核扩展 `pi-tool-sanitizer.ts` 在 `tool_call` 拦截阶段自动检测当前工作区。若处于 `code-area` 且已绑定目标项目路径：
  - 对命令行工具（`bash`, `powershell`, `cmd`, `sh`, `terminal`, `run_command`），自动在其 `command` 前注入 `cd "${routedTarget}" && `（已显式 `cd` 目标路径时不重复注入）；
  - 对文件工具（`read`, `write`, `edit`, `grep`, `find`, `ls`），自动将相对路径基于目标项目绝对路径解析（`path.resolve(routedTarget, rawPath)`），确保所有命令与文件读写 100% 作用于目标路由工程，免去模型手动切换目录失误引发的中断；
- **存在性自动校验与失效清除**：切换至 `code-area` 或启动时，自动校验路由工作区与「最近使用项目」是否在本地磁盘真实存在；失效时自动清除选项并过滤失效历史；
- 对话流上下文注入：发起 Prompt / FollowUp 时透明注入 `<code_area_routing_context>`（目标绝对路径、免污染铁律与 Hub 技能清单），自动读取并注入目标路由工作区的 `AGENTS.md`（及 `README.md`）。`.agents/skills/` 下的技能规约无需全量强制前置注入，由 Agent 遵循 `AGENTS.md` 中的 Skills 映射矩阵按需查阅并调用；并在 Flow 呈现路由目标胶囊；所有注入条目（Inner-Skill / AGENTS.md / README.md / 路由信封）在 Flow 会话流「路由目标项目」胶囊（或提问卡）下方的「注入提示」信息框中集中呈现（直角简洁风格，默认收起显示「注入提示」与注入数量，点击展开完整清单；动态累积、去重；事件广播必须携带 `task_id`，前端建立按 Task 隔离的注入缓存分仓，多任务直切、设置页历史查看及会话回退时由 `restoreInjectionNoticeFor` 完整自愈复原）。

## 铁律 14：子代理模型自动钉住与防跃升机制 (Subagents Model Pinning & Escalation Prevention)

- 当启用 `pi-subagents` 扩展组件时，在软件初次启动加载、用户切换模型、或安装/更新组件时，自动将当前主模型同步写入 `~/.pi/agent/settings.json` 的 `subagents.defaultModel` 与各常用角色（`oracle`, `worker`, `reviewer`, `researcher`, `planner`, `scout`, `advisor`, `context-builder`, `delegate` 等全部内置角色及 `agentOverrides` 中已配置的全部动态角色）的 `agentOverrides`；
- 采用非破坏性读-合并-写回语义，完整保留其余已有配置；未启用 `pi-subagents` 时绝不产生冗余字段污染，彻底杜绝子代理角色因 high-thinking 能力画像擅自升配调用未授权或更昂贵模型（如 `claude-opus-4-8`、`deepseek-v4-pro`）造成的 401 鉴权崩溃与额外 Token 消耗。

## 铁律 15：Node.js 运行环境预设检测与安装拦截引导规范 (Node.js Environment Preflight & Degradation)

- **底层依赖与自适应探测**：Pi 扩展组件安装/更新与内核生态依赖 Node.js/npm 运行环境。Rust 后端通过 `pi_check_node_environment` 具备 Windows 全域 PATH 与多默认安装路径自适应极速探测能力（`node -v` / `npm -v`），无控制台黑框且带超时与非破坏性借用保护；
- **友好拦截与一键直达**：用户在扩展组件市场安装单个组件、一键安装推荐插件、更新组件或更新/下载内核时，前端自动执行 Node.js 环境预检。未检测到环境时优雅拦截并弹出手绘风格 `SketchModal` 提示框，支持一键通过外部浏览器（`pi_open_url` / `tauri_plugin_opener`）唤起 Node.js 官方下载页面（`https://nodejs.org/`），杜绝生硬崩溃与晦涩错误；
- **无感缓存与动态重试**：已成功检测到环境时无感缓存，未安装时每次操作自动重新探测，允许用户安装好 Node.js 后无需重启即刻继续。

## 铁律 16：输入历史记录导航与严格时间序规范 (Prompt History Navigation & Chronological Invariance)

- **严格时间序与最新优先 (LIFO / MRU)**：输入框方向键“↑ / ↓”翻阅历史严格遵循真实时间戳排序与最新项优先。Rust 后端从底层会话中提取每条用户消息真实毫秒时间戳全局排序，采用 LIFO 去重保留最新出现；
- **数据合并顺序对齐**：前端合并底层原生会话与本地输入历史时，以底层历史为时间线基座，本地当前会话最新输入置于末尾，严禁旧会话数据覆盖或倒挂；
- **重复发送自动晋升**：用户重复发送提问时，自动从旧位置移除并晋升至历史栈末端，保证发送完成后按“↑”100% 稳稳命中上一条发送的消息；
- **输入框单行/多行光标敏感感知**：单行文本光标在任意位置按“↑”直接翻阅历史（彻底消除“按一次跳行首、按第二次才出历史”的缺陷）；多行文本仅首行按“↑”、末行按“↓”触发；
- **二次编辑草稿保护**：翻阅过程中手动编辑内容时，动态同步更新草稿并适时重置导航态，杜绝用户修改后的文字被上下键冲掉覆盖。

## 铁律 17：会话监听与实时记录铁律 (Session Watcher & Real-time Record Invariance)

- **常驻生命周期托管**：`SessionWatcher` 必须在 Rust 后端 setup 阶段通过 `app.manage(session_watcher)` 注入全局生命周期托管，内部封装 `Arc<Mutex<Option<RecommendedWatcher>>>` 确保线程安全与常驻存活，严禁作为局部变量在 setup 闭包结束时被 RAII Drop 释放导致文件监听器销毁；
- **目录精准锁定与递归监听**：默认监听目录严格锁定为 Pi 内核真实会话根目录 `~/.pi/agent/sessions`（二级子目录按 CWD 隔离），初始化时自动 `create_dir_all` 确保存在；
- **三重同步与自愈机制**：提供 `pi_refresh_sessions` 主动扫描广播指令；前端切换至设置页「会话记录」Tab 时强制拉取最新数据（`api.loadSessions(true)`）；会话任务终态（`agent_end` / `agent_settled`）时自动延迟触发增量会话同步，形成「实时文件监听 + 终态主动同步 + Tab 切换强刷」三重保证，杜绝会话完成后无法实时进入记录的缺陷。

## 铁律 18：模型无痕内置重连铁律 (Model Silent Built-in Reconnect & Invariance)

- **无痕内置重连 (Silent Reconnect)**：仅在「模型XXX异常」错误窗体本应弹出时触发（设置-模型配置-右上角「自动强制重连」勾选启用）；**总开关绝对一票否决铁律 (Hard Gate & Kernel Synchronization)**：未勾选/关闭「自动强制重连」时，全链路严禁触发任何内置重连或自动重试，包括速率限制（TPM/RPM/429）等任何瞬态错误一律一票否决、严禁进入 ModelFailoverEngine 且直接弹出错误诊断卡；同时关闭开关时同步调用 `pi_clear_model_failover_preset` 物理清退 Pi 内核 `~/.pi/agent/settings.json` 中的 `retry` 注入块，杜绝内核在底层子进程自行重试并刷屏“自动重试中”；勾选启用时引擎隐藏错误窗体，自动在后台向模型续发「继续」文本（不生成提问卡、不重复压入 prompt history、不新建 Task，全程不显示），用户无感知；
- **写死 10 次与全部 60 秒延迟 + 续发后再延迟 60 秒 (Fixed 10 Attempts, 60s Pre & Post Backoff, 120s * 10)**：每次续发计作一次「内置重连」，上限写死 10 次（`maxReconnectAttempts: 10`）；重试延迟全部为 60 秒延迟（`reconnectBackoffMs: [60000]`，`maxBackoffMs: 60000`），并且发送“继续”提示词重连后再延迟 60 秒（`postReconnectDelayMs: 60000`），单次自愈尝试周期恒定为 120 秒（60s + 60s），一共内置 10 次（即 120 秒 * 10 = 1200 秒）；会话流最下方进度胶囊恒定以「自动内置重连 N/10 ...」开头（重试等待与续发后延迟均动态倒数读秒「Xs 后重试」，续发中追加「正在重发请求 …」）；**持久化配置迁移**：旧引擎残留在 `~/.pi-dl/config.json` 的 `modelFailover` 块与内核 `settings.json` 的 `retry` 注入块，在 `pi_get_app_config` 读取时由 `migrate.rs` 幂等归一化为写死预设（检测旧字段或与预设不一致即整块重写为 10 次 / 60s + 60s 预设，内核注入块允许完整三键形态覆盖刷新）；
- **取消自动切换模型 (No Auto Model Switch)**：引擎不再承担任何自动切换模型职责（候选池解析、MRU 巡检、多轮轮转、临时切换与恢复原模型逻辑已彻底移除）；错误卡上的「切换其他模型」为纯手动入口；
- **耗尽才弹窗与耗尽终态锁定 (Give Up After Exhaustion & Terminal Lock)**：仅当 10 次内置重连全部耗尽仍失败时，才渲染既有「模型调用失败 [模型]」错误卡并附摘要「已尝试自动内置重连 N/10 次后仍失败」；弹卡同时引擎立即记录该任务「耗尽终态」（`_exhaustedTaskIds` / 无归属路径 `_unattributedExhausted`）：一次失败的内核 run 会经 `message_end` / `turn_end` / `agent_end` / `agent_settled` 多次重复派发 `agent-error`，耗尽后这些重复错误帧**绝不再次自动冷启动、也不重复渲染错误卡**（TaskManager 侧同步落定 error 终态且 `failTask` 幂等防重复通知），仅用户手动点击「重试当前提问」（自动向模型下发「继续」文本续发生成，而非完全复用上一轮长提问）或发送新提问（`clearTaskAborted` 同步清除耗尽标记）后方可重新发起内置重连；
- **过程记录保留铁律**：重发尝试（`resetCurrentTurnForResend`）时**严禁清空步骤容器（`stepsContainerEl.innerHTML`）与工具卡片缓存（`renderedToolCards`）**，必须 100% 完整保留本轮之前已真实执行完毕的 Thinking 切片（已封口/含实质内容）、工具调用卡片与 Point 阶段性输出切片，恢复后增量无缝追加后续因果链条；
- **首 token 延迟伪框重建铁律 (First-Token Pseudo Box Rebuild)**：`resetCurrentTurnForResend` 内部必须**先执行 `sealActiveThinkingStep()` 再执行缓冲清理**（`clearStreamTimersAndBuffers` 仅置空 `activeThinkingStep` 引用而不移除 DOM 卡片，顺序颠倒将导致 seal 空转、孤儿伪框残留、步骤容器非空而无法重建读秒伪框）：真实思考切片定格保留，纯首字等待伪框静默移除，随后若步骤容器为空则重建「Thinking (0.0s)...」首 token 延迟读秒伪框，确保重连续发等待期始终有首字延迟状态呈现；
- **前后台任务全域覆盖与失败轮收口拦截铁律 (Foreground & Background Coverage & Failure agent-end Interception)**：重连引擎的冷启动、在途热结算与 agent-end 收口结算对**前台活跃任务与后台挂起任务一视同仁**（后台任务错误原被前台门禁拦截导致引擎永不启动，随后被 `agent_end` 误标 completed 且历史归档链路断裂）；引擎判定（`engineOwnsTask`）按 `taskId` 收敛严禁跨任务误结算；**残余收口帧拦截**：当自愈引擎处于活跃接管状态时（无论是 60s 等待、续发中、还是续发后 60s 延迟），到达的 `agent-end` 无论前台后台均**必须立即 return 拦截**（无在途尝试时属失败轮残余帧，有在途尝试时仅结算引擎），**绝对不能流向 `api.finalizeStream`、`api.collapseAllToolCards` 与历史归档**，彻底根治前台流式被失败轮收口帧瞬间终结导致会话流直接中断的致命缺陷；`TaskManager.agent_end` 在引擎为本任务退避等待期间（`hasInflightAttempt() === false`）**严禁提前落地 completed**；后台任务 10 次耗尽经 `TaskManager.failTask` 统一落定 error 终态（通知 + 末轮错误标记）；
- **isAbortError 精准判定铁律 (Precise Abortion Invariance)**：`isAbortError` 严格排除包含 `rate limit`、`429`、`500`、`502`、`503`、`504`、`timeout`、`timed out`、`connection`、`socket`、`econnreset`、`etimedout`、`fetch failed` 等网络/服务端瞬态错误，仅匹配明确的用户手动取消关键字（如 `user cancelled`、`手动终止`、`用户终止` 等）或纯短词短语，彻底杜绝远端连接断开或超时被误判为手动中止而直接静默丢弃；
- **纯状态示意条置底与系统弹窗静默铁律 (Bottom Status-Capsule & Notification Silence)**：内置重连期间**严禁触发任何 Windows 原生系统弹窗提醒 (Toast / Notification)**，也**严禁在正文回答区域插入不可撤回的红色错误卡片 (`.sketch-error-card`)**；统一由 Flow 会话流最下方（`flow-response-card` 回答卡下方）的手绘进度胶囊作为**纯状态示意条**，并随内容吸底跟随；胶囊内集成手绘「⏹ 中断」按钮（`.failover-abort-btn`），同时主界面输入栏 `#flow-btn-abort` 在重连与等待全周期保持可见可用；
- **首响应即时结算与等待期拿到输出立即自愈铁律 (Delay Output Self-Healing & Direct Abort Invariance)**：无论自愈引擎当前正处于 60 秒等待退避（`phase: "waiting"`）、续发中（`phase: "sending"`）、还是续发后 60 秒延迟期（`phase: "post_waiting"`），只要模型恢复正常产生任何响应输出（Thinking/Text/Toolcall 产生首事件），`resolveTurnSuccess` 立即唤醒并清退 `_backoffTimer` 休眠，直接结算为成功（`_succeed`）并提前安全退出重连流水线，**彻底杜绝在等待重连倒计时跑完后再次盲目向模型补发「继续」提示词或进入二次循环**；胶囊即时显示「自动内置重连成功 · 已恢复正常，继续执行」并于 1.2 秒内快速淡出隐藏，同时调用 `clearTurnErrorState` 原子化清除错误状态；真正的工具卡收起、流式收口与会话归档交由后续 `agent-end` 自然触发；允许用户在 60 秒等待退避与续发后延迟过程中直接中断会话，点击胶囊内「中断」或点击 `#flow-btn-abort` 将**直接中断一切**（统一调用 `api.abortCurrentSession`）：立即清退 `_backoffTimer` 定时器并强制解除 `await this._sleep` 挂起，切断重连循环（杜绝触发 `_giveUp` 弹错误卡），物理强杀 Rust 内核子进程（`SessionHost.abort()`），定格轮次为已中断，回答区追加「刚刚会话已手动终止」，隐藏胶囊并清除倒数，归档历史快照，全链路杜绝任何后续复活与再次尝试；手动终止后引擎对**无任务归属的错误帧**（消息对象不携带 task_id 的旧主会话路径）实施 15 秒保守静默窗口（`hasRecentGlobalAbortion`），杜绝终止后经杂散帧静默复活重连；
- **会话重启与追问时错误卡彻底清理铁律 (Error Card Cleanup on Continuation)**：当界面出现模型调用失败诊断卡（`.sketch-error-card`）后，无论用户发送新提问、还是点击错误卡「重试当前提问」按钮重新发起会话（自动向模型下发「继续」），系统在启动新轮次前必须彻底物理移除 `flowConversation` 与轮次容器中残留的所有 `.sketch-error-card`，重置重连胶囊，并将 `task.turns` 中上一轮次的错误标记（`errorMessage: null`）与合成占位文本清理归位，确保后续流式生成与历史重渲 0 残留；
- **流中断宽容期与黄色倒计时等待铁律 (Stream Interruption Grace Period)**：当 agent-error 命中瞬态可恢复错误（判定唯一源为 `src/lib/contracts.js` 的两条互补谓词：`isGracePeriodError` 命中内核回显 `Stream ended without finish_reason` 的流截断、服务商回显 `Inference request failed.` 的推理请求瞬时失败、网关回显 `upstream failure` 的上游瞬时不可用；**`isTransientServiceError` 覆盖全部「连接异常 / 服务异常」瞬态错误全集**——超时/断连/Socket/ECONNRESET/ETIMEDOUT/ECONNREFUSED/DNS、500/502/503/504 网关与服务端瞬时、`fetch failed`/`load failed`/`network error`/`status code`、TPM/RPM/429 速率限制、`overload`（子串同时覆盖 `overloaded_error` 与服务商回显 "server overload"）·`unable to handle`/`capacity`/`temporarily unavailable` 等；两谓词均收集 `errDetail.message` + `raw.errorMessage/.message` + `errDetail.error` 全部候选字段，且**不可恢复错误一票否决**——401/403/unauthorized/forbidden/invalid api key/authentication/model not found/multimodal 不支持/`context length`·`too long`·`payload too large` 等上下文超限即使正文同时含瞬态关键词（如 `status code 401`）也立即弹出红色错误卡，300 秒等待毫无意义）且自动内置重连引擎未接管时，**严禁立即弹出红色错误提醒卡、严禁发系统通知**，改在 Flow 会话流最下方（复用 `flowView.activeTurnRefs.failoverCapsuleEl`）呈现「黄色倒计时等待消息框」（`.flow-failover-capsule.waiting`：实线琥珀边 + 手绘沙漏图标 `ICONS.hourglass`、隐藏胶囊内中断按钮、主界面 `#flow-btn-abort` 全周期保持可用）；写死 **300 秒**（`STREAM_INTERRUPT_GRACE_MS = 300000`）倒计时，逐秒刷新「等待模型响应中 · Ns」；**恢复即撤销**：期间模型恢复任何输出（`thinking-*` / `text-*` / `toolcall-delta-start` / `tool-start`，经 `api.resolveStreamInterruption` 热路径零负担 guarded 清除错误态）或会话已正常收口（`agent-end` 且本轮已产出 `responseText` / `hasReceivedDelta`）→ 立即静默撤销等待并走正常收尾归档，绝不空等；**撤销路径全覆盖**：手动终止（`abortCurrentSession`）、任务挂起（`flow-suspended`）、任务移除（`task-removed`）、重发与新提问（`clearTurnErrorState`）一律经 `api.cancelStreamInterruption` 清退定时器；**超时才弹红框**：仅当 300 秒倒计时走完仍未恢复才调用 `api.renderErrorCard` 渲染红色错误卡，且超时触发前校验该任务仍为前台活跃任务，杜绝跨会话误弹；重复错误帧（一次失败 run 经 `message_end`/`turn_end`/`agent_end` 多次派发）对同任务幂等、不重置倒计时；**错误卡重复帧幂等铁律 (Error Card Idempotence)**：`renderErrorCard` 以 `${bucketId}::${errorMessage}` 签名烙印卡片（`dataset.errSig`），同任务同正文的重复错误帧一律短路返回——绝不重复 `innerHTML` 重建卡片（按钮监听随 DOM 反复销毁，用户点击落空 → 红框「卡死」、「重试当前提问」与「切换其他模型」均点不了）、不重复 `finalizeStream` / Windows 通知 / 历史归档；`clearTurnErrorState` 物理移除卡片即自然重置签名；**宽容期启动失败回退**：`handleStreamInterruption` 返回布尔值，轮次 DOM 尚未建立（胶囊未挂载）时调用方回退 `api.renderErrorCard` 直接弹红框，杜绝错误被静默吞掉；**TaskManager 终态结算延迟对齐**：`task-manager.js` 的 `agent-error` 监听器先于 flow-pipeline 注册，前台任务命中瞬态谓词时同样在 `pendingInterruptSend` 分支之后、`failTask` 之前短路返回（后台任务无宽容期胶囊，仍走 `failTask` 原生结算），彻底杜绝 Task 被提前置 error 致内核恢复的输出事件被前台门禁拦截、会话流中断。**等待期中断按钮全周期铁律（graceWaiting 守卫）**：宽容期启动时 Task 烙印 `task.graceWaiting = true`，`task-manager.js handleTaskEvent` 在该标记下**严禁被残余收口帧提前终态化**——`turn_end/message_end/extension_error` 错误分支、`agent_end/agent_settled` 的 errMessage 与空收口完成结算路径一律先守卫 `if (task.graceWaiting) break;`；否则 Task 置 error/completed 终态会经 `task-updated` → `syncFlowAbortButtonVisibility()` → `isTaskRunning()=false` 隐藏主界面 `#flow-btn-abort`，且 `finalizeStream` 也会隐藏它，致 300 秒等待期完全失去中断手段；同时 `handleStreamInterruption` 强制恢复显现 `#flow-btn-abort`、`finalizeStream` 以 `!streamPauseTimer` 例外豁免等待期隐藏；期间内核恢复任何真实输出（thinking/text/toolcall/tool_execution_start）即清除 graceWaiting，后续真实收口帧可正常落定终态；`failTask`/`abortTask`/`renderErrorCard` 置终态时同步清标记。

## 铁律 19：中途提问人工回归选择铁律 (Human-in-the-Loop Mid-Run Ask-Back)

- **协议覆盖范围**：内核 Extension UI 子协议（`docs/rpc.md` §Extension UI Protocol）的**可回写四类方法** `select` / `confirm` / `input` / `editor`（stdout `extension_ui_request` 阻塞等待 stdin `extension_ui_response`）；`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text` 属 fire-and-forget，**绝不建作答卡、绝不置 Task 为 `paused`**；带 `timeout` 的请求由**内核侧**自动按默认值解析，客户端仅呈现读秒示意、**严禁代答**；
- **三层属主划分**：未决请求真源归 `TaskManager` 的 `task.pendingUiRequests`（Map<id, request>，随 Task 挂起保留，**不新增 store**）；IPC 转发归 `pi-client.js` 的 `sendExtensionUiResponse(taskId, requestId, payload)`（服务层禁碰 DOM）；呈现与作答归新模块 `src/modules/flow-human-input.js`（横条 / 弹窗 / 读秒 / 失效态，DOM 引用归模块内部缓存，**不入 `flowView`**）；交互判定唯一源归 `src/lib/contracts.js` 的 `isInteractiveExtensionUiRequest`（消除 task-manager 与 flow-pipeline 双份 `INTERACTIVE_METHODS` 常量）；
- **新增 IPC `pi_send_command_to_task(task_id, command)`**：`commands/agent.rs` + `PiHostPool::send_command_to_task`（复用 `SessionHost::send_command` 的 fire-and-forget 语义与 aborted 门禁，终止后迟到作答被 Rust 层物理拒绝）；
- **作答时序（严格同步判定 + 异步回写）**：① 用户提交 → **先同步** `takePendingUiRequest` 摘除未决请求并定格横条（杜绝双击双答竞态）；② **再异步** `sendExtensionUiResponse`；③ 回写失败（Task 已终止 / 进程已亡）→ 横条转「作答未能送达 · 任务已终止」失效态 + Toast 提示，**不重试轰炸**；
- **卡片形态与自动呼出**：待答横条紧接轮次步骤流之后（保持「思维/工具 → 待答横条 → 回答正文」因果时序），三态 `pending`（手绘脉冲）/ `done` / `failed`；`select` → `SketchSelect`、`confirm` → 双按钮互斥、`input`/`editor` → 单行/多行手绘输入框，统一由 `SketchModal` 承载（居中、毛玻璃、焦点陷阱、Esc/右键关闭）；窗口聚焦（`document.hasFocus()`）时收到请求直接呼出作答弹窗，失焦则仅留横条 + 既有失焦 Toast（铁律9）；
- **挂起 / 直切 / 终止 / 回退 / 重连对齐**：交互未决时直切 → 原 Task 照常 `isSuspended = true`（`paused` 属待确认态），回入 Flow 由 `renderTurnsIntoFlow → api.restoreHumanInputCards(task.id)` 重建未决横条（请求不丢失）；后台任务只入 TaskManager 数据与抽屉徽标「待确认 (N)」，**绝不渲染前台横条**（前台门禁 `isForegroundStreamTask`）；「⏹ 终止」先 `clearPendingUiRequests` → `Promise.all` best-effort 回写 `{cancelled:true}` → 再走既有强杀链路（`invalidateHumanInputCards` 转失效态，**严禁**触发内置重连）；交互未决 = 生成进行中，`flow-rollback` 的 `isTaskRunning` 已显式纳入 `paused` 阻断回退；`paused`（UI 阻塞）与「模型异常」严格区分，重连引擎仅由错误帧驱动；`input` / `editor` 弹窗文本控件聚焦必须延后一帧（`SketchModal.open()` 的 rAF 会聚焦「提交」按钮抢走焦点）；
- **清理时机**：作答回写 / 读秒归零 / `agent_end` / `agent_settled`（`{resume:false}` 防终态前状态抖动）/ abort / `task-removed` / 内核 `kernel-status-change`（`hasKernel === false` 全部失效）；`pendingUiRequests` 清空且 Task 仍 `paused`、`piClient.isStreaming` 为真时回落 `streaming`。

## 铁律 20：内核工具调用全链路自愈铁律 (Tool Call Full-Chain Sanitizer Invariance)

- **痛点与背景**：
  1. **入参冗余外壳**：特定模型（如 DeepSeek-V4 系列在 OpenAI Completions 协议或部分反代渠道中）高频将实际工具入参包裹在冗余外壳（如 `{"arguments": {"command": "..."}}`、`{"parameters": {"path": "..."}}`、`{"args": {...}}` 或同名属性嵌套 `path: { path: "..." }`），导致内核 TypeBox / AJV 参数校验报错 `Validation failed: must have required properties`；错误文本回显给模型后极易诱发模型误判并逐轮叠加嵌套外壳（最高达 5 层深），陷入严重自激死循环；
  2. **畸形工具名与私有协议标签正文泄漏**：部分预览/推理模型会将 XML 结构（`<invoke name="bash"><parameter name="command">...</parameter></invoke>`）、换行指令（`bash\n\ncd ...`）、单行空格参数泄漏（`read path="..."</arg_value>`）直接输出至 `toolCall.name` 中且将 `arguments` 留空，导致内核报 `Tool ... not found` 并误判为错误；部分模型甚至将 `<｜｜DSML｜｜ calls>` 原生调用、标准 XML `<invoke>` 或 `<bash>` 私有协议标签直接输出在正文文本中而未被平台结构化，导致无法执行工具直接停止会话；
  3. **0.86.0 工具锚定丢失（"会话一到工具调用就自己结束"的根因）**：Pi 内核 0.86.0 起（transcript-aware tool changes）provider 请求的工具列表改由会话 system 消息上的 `toolsAdded`/`toolsRemoved` 锚定声明经 `getCurrentTools()` 解析；第三方上下文扩展 **`pai-acp@0.1.22`** 的 `context` 钩子每轮以自身剪枝模型重建消息并**整体丢弃 system 消息**（其剪枝模型不含 system 条目），导致适配器解析结果为空、provider 请求**整体缺失 `tools` 字段**——模型无法发起结构化工具调用，只能以正文模拟命令、空响应收场且 `stopReason=stop`，agent 循环随即终止，表现为"会话一到工具调用就自己结束"；书生/火山等全部 openai-completions 渠道均受影响（0.85.1 时代工具经 `context.tools` 独立通道传递，pai-acp 重建无害，故该回归随内核升级爆发）；
  4. **空 tools 数组 400 与 strict 采样防御**：当会话确无工具时底层适配器会写入 `"tools": []`，在严格校验的服务商处（如 Atria / InternLM / Groq 等）直接被 400 拦截；0.86.0 又对内置工具默认启用 strict-prefer JSON-schema 采样（`compat.supportsStrictMode` 为 false 的 provider 内核本身不发送 strict，但第三方兼容层/反代仍可能注入），需防御性剥离。
- **三层防御自愈流水线**：系统通过内置内核扩展 `src-tauri/extensions/pi-tool-sanitizer.ts`（应用启动时由 `rollback::materialize_extension()` 幂等物化至全局扩展目录 `~/.pi/agent/extensions/`）与前端流式/持久化多层净化：
  - ① **请求发送前防线 (before_provider_request)**：在请求发送给 Provider 前拦截 Payload，按序执行三步：
    - **工具锚定修复（第一优先，0.86.0 回归自愈）**：当 `payload.tools` 缺失或为空时，从 `ctx.sessionManager`（`buildContextEntries()` 优先，回退 `getBranch()`/`getEntries()`）按内核 `getCurrentTools()` 同语义（逐条目先 `toolsRemoved` 删除后 `toolsAdded` 写入）恢复当前上下文的锚定工具声明，并按 provider 协议形状回注（Anthropic 类 payload 顶层含 `system` → `{name, description, input_schema}`；OpenAI 兼容 → `{type:"function", function:{name, description, parameters}}`），每请求自愈，模型恢复结构化工具调用；会话确无锚定声明（纯聊天上下文）时才回退为剔除空数组与孤立 `tool_choice` 消除 400；
    - **strict 防御性剥离**：工具本就存在时仅防御性剔除工具定义上的 `strict` 字段（顶层与 `function.strict` 双位置），保持宽松容错采样；
    - **零干预原则**：`tools` 正常携带时不做任何结构改动，不干预 subagent 按角色收窄后的工具集（恢复源即该上下文自身的锚定声明，天然保真）。
  - ② **模型输出净化 (message_end 主防线)**：在 `message_end` 阶段（模型输出完成、内核参数校验执行之前）拦截助手消息：若正文包含 DSML、标准 XML `<invoke>` 或 `<bash>` **私有协议标签**，自动抽取重构为标准 `toolCall` 块并清洗对应标签残留，确保收纳进单行工具卡顺畅执行；若 `toolCall.name` 包含畸形内容（含空白/尖括号等非法字符）精准提取规范工具名并注入入参；同时无损剥离多层嵌套的 arguments/parameters/args 外壳。**红线：严禁对正文普通 Markdown 命令代码块做工具化提取**——那可能是模型展示给用户的合法示例（如"重命名分支可以这样写"），提取即劫持真实执行、篡改回答语义；私有协议标签才是可靠的泄漏信号；**红线：严禁把净化逻辑做成对回答正文的大范围改写**；
  - ③ **底层执行清洗 (tool_call 第二防线)**：在 `tool_call` 阶段二次兜底清洗入参嵌套与畸形工具名。**红线：严禁对命令行/文件路径做静默改写注入**（如强制前置 `cd "${target}" &&`、相对路径强改绝对路径）——那会静默篡改模型意图（用户明确要求在 Hub 目录执行的命令会被劫持到路由目标）；工作区路由归位由铁律 13 的「透明注入路由上下文」承载（模型自行锚定），净化层只做无损修复；
  - ④ **前端阶段性输出 (Point) 流式免卡、text-end 即时打包与多层防泄漏**：
    - `src/lib/dom-utils.js` 统一收敛 `cleanPhaseOutputText(text)`，严格剥离所有代码块（含 `-exec` 尾缀）、模拟调用标签与虚假执行废话；
    - 流式阶段（`flow-stream.js` 的 `text-delta`）：**严禁创建 Point 卡与任何读秒占位卡**——内容仅在最终输出卡实时可见，仅登记 `flowView.pendingTextSegment` 起始时刻；提前建卡会导致 Point 卡带着「输出中」读秒空转到下一阶段真正启动（含跨消息 Provider 请求往返延迟），且与输出内容同屏双现；
    - 打包封口（首选内核 `text-end` 事件 → `sealTextSegmentAsPointCard`）：文本段输出完毕即刻打包为 Point 卡并定格「已输出 X.Xs」，同时自动聚合收起该次 Point 之前直至上一次 Point 的全部 Thinking 与工具调用框（极简手绘虚线框体，展示步骤统计与「展开」按钮；展开态保持原生 FLOW 垂直排版绝不放入新 panel，并在顶部与右下方均设「收起」按钮）；内核未派发 `text-end` 时由阶段边界（thinking-start / text-start / toolcall-delta-start / tool-start → `sealActivePhaseOutput`）兜底封口；净化后文本若变为空（说明该段原本只有泄漏工具命令），则不建卡并同步清空输出卡正文；text-end 打包后直到本轮收尾无新阶段开启即为最终段，finalizeStream 移除 Point 候选卡并解包还原聚合步骤（`unwrapStepGroup`）、回填输出卡（净化前原文，保留代码块）；
    - 任务管理器沉淀（`task-manager.js` 的 `tool_execution_start`）：在工具开始执行将已累积的中间段文本压入 `currentTurn.steps` 时，先执行 `cleanPhaseOutputText`，净化后有实质内容才推入，纯泄漏工具段直接丢弃，从数据源头杜绝污染；
    - 历史与重新渲染（`flow-ui.js` / `flow-render.js`）：`restoreTurnsIntoFlow` 与 `createPhaseStepCard` 双重防线拦截，保证无论是实时生成、挂起恢复、任务直切还是历史回看，泄漏的命令代码块与模拟文本 0% 暴露在 Point 卡片中，且历史还原时同步触发前序步骤自动聚合收起。
- **非侵入与零负担**：纯内存对象剥离与清洗，无冗余外壳、工具名正常且工具列表正常时 100% 原样直通，全流程安全降级保护，绝不阻塞会话或篡改模型原本正确的工具参数。

## 铁律 21：组件推荐配置预设与路径迁移自愈铁律 (Package Preset & Config Path Migration Invariance)

- **预设映射表唯一源**：`src-tauri/presets/package-presets.json`（打包时 `include_str!` 内嵌）定义各组件的「后台静默」推荐配置；`presets.rs` 的 `apply_preset` 以**非破坏性读-合并-写回**语义合并入目标配置文件（保留用户其余字段），写入后 `is_preset_applied` **严格回读校验**全部预设键值；
- **多路径双写覆盖组件升级迁移**：预设表支持 `configFiles` 数组（为空时回退单个 `configFile`），`resolve_preset_config_paths` 去重展开后 `apply_preset` **逐一写入全部路径**、`is_preset_applied` 要求**全部路径均生效**（任一缺失即视为未生效）。典型范例 `pi-web-access`：`workflow: "auto-summary"` + `autoOpenBrowser: false` 同时写入 `~/.pi/agent/web-search.json`（≥0.29.0 默认路径）与 `~/.pi/web-search.json`（旧版 / XDG 回退路径），杜绝组件升级更改默认配置路径后「静默配置写过但被忽略」导致联网搜索重新弹出网页端人工确认；
- **三时机自动应用**：组件安装（`installer.rs` 安装完成钩子）、组件更新（`installer.rs` 更新完成钩子，`is_preset_applied` 为假时补写）、**应用启动自愈**（`lib.rs` setup 阶段 `package_manager::presets::self_heal_installed_package_presets()` 异步遍历已安装组件补齐未生效预设，应对已装组件静默升级后路径迁移、无需用户重装）；前端组件面板「应用推荐配置」按钮经 `pi_apply_package_preset` 手动触发同一链路；
- **配置变更生效时机**：扩展在进程加载时缓存配置路径常量（如 `pi-web-access` 的 `const WEB_SEARCH_CONFIG_PATH`），配置写入后需**新开一会话或重启内核**才对后续工具调用生效。

## 铁律 22：组件缺陷补丁预设与版本闸门铁律 (Package Patch Preset & Version Gate Invariance)

- **定位与分工**：铁律 21 的「推荐配置预设」只能向组件配置文件合并键值；当第三方组件的缺陷在**源码层面**（如 Windows 兼容 bug）时，配置救不了，必须走本条。清单唯一源 `src-tauri/presets/package-patches.json`，修复后的完整源码文件收纳于 `src-tauri/presets/patches/<组件>/`，两者均以 `include_str!` 编译期内嵌进 exe；
- **三道安全闸门（缺一不可）**：① **版本闸门**——仅当已安装组件版本匹配清单 `versionPrefixes`（`major.minor` 精确匹配，如 `["1.4"]` 命中 1.4.0/1.4.7；`["*"]` 表示任意）时才应用，组件升级换版后**绝不盲目覆盖**可能已重排或上游已修复的文件；② **存在性闸门**——`create: false` 条目仅在目标文件已存在时覆盖，版本闸门已放行却找不到目标文件说明上游改了布局，直接 `Err` 暴露漂移（严禁静默跳过），`create: true` 才允许新增文件；③ **幂等 + 回读校验**——内容与内嵌源一致时跳过写入，写入后 `is_patch_set_applied` 严格回读比对全部文件；
- **三时机自动应用**（与铁律 21 完全对齐）：组件安装完成（`installer.rs` 安装钩子）、组件更新完成（`installer.rs` 更新钩子——npm 会整体覆盖 `node_modules`，补丁必须重打）、**应用启动自愈**（`lib.rs` setup 步骤 2c 与 `self_heal_installed_package_presets()` 并联调用 `self_heal_installed_package_patches()`）；前端组件面板在 `hasPatches && !isPatchesApplied` 时显示「修复补丁」按钮，经 `pi_apply_package_patches` 触发同一链路；
- **状态透出**：`InstalledPackage` 增 `hasPatches` / `isPatchesApplies` / `patchTitle` 三字段，与 preset 三字段同源同构（`get_installed_packages` 统一计算）；
- **典型范例 `pi-ocr` 1.4.x**：Windows 上 `mineru.ts`/`pix2text.ts`/`ollama.ts` 三处硬编码 `spawn("python3")` 命中 Microsoft Store 占位 stub（退出码 49 + Store 推销语，真正的解释器是 `python`），且 `getPdfPageCount` 无 win32 分支恒返回 1 导致 >20 页 PDF 整包直发 MinerU 免费档被拒。补丁 = 新增 `extensions/python.ts`（候选命令探测 + 实跑验活 + 进程级缓存，跳过 Store stub）+ 三处改用 `getPythonCmd()` + `getPdfPageCount` 补 win32 分支（pypdfium2 数页数，失败保守回落 1）；
- **新增组件补丁流程**：把修复后的完整文件放入 `src-tauri/presets/patches/<包>/` → 在 `package-patches.json` 追加条目（`source` 相对 `presets/patches/`，`target` 相对组件根）→ 在 `patches.rs` 的 `patch_source_by_name` 追加 `include_str!` 映射 → `npm run check` + `npm run check:fe` 验证。**严禁**为未验证的版本放宽 `versionPrefixes`。

## 铁律 23：生图与多模态路由及会话模型无缝回归铁律 (Image Generation & Multimodal Routing with Seamless Model Regression Invariance)

- **定位与背景**：纯文本大模型（如 DeepSeek-Chat、DeepSeek-Reasoner 及代码专用模型）具备强大的推理与代码能力，但直接接收图像附件或面临用户绘图需求时受限于自身模态输入输出能力；
- **模型配置内部并列 Sub-Tab 界面与持久化**：在设置页「模型配置」Page（`pane-current-models`）内部顶部以并列 Sub-Tab 翻页方式呈现（`data-subtab="subpane-image-routing"` 与 `subpane-models-list` 顶部并列切换），具备独立启用开关（`image-routing-switch`）、原则公示条、专用生图模型选择（`image-routing-model-select`）与独立多模态识图模型选择（`vision-routing-model-select`），配置全局持久化于 `~/.pi-dl/config.json`（`imageRouting`）；
- **生图模型配置原则与协议硬性约束**：常规的 `/v1/chat/completions`、`/v1/responses` 与 `Anthropic` 协议属于聊天补全对话接口，**均不支持直接输出图像文件**；生图模型必须在「模型配置 ➔ 自定义通道」中配置为 **「OpenAI 兼容 /images/generations 类型」**（`openai-images`）或 **「DashScope 原生异步接口」**（`dashscope-async-image`）；
- **生图下拉框严格过滤**：生图模型下拉框对运营商 API 协议实施严格硬性过滤，**仅当模型所属运营商使用上述两种专用生图协议时才在下拉框可选**，聊天补全类模型绝不可选，杜绝混淆与调用报错；识图下拉框汇聚具备多模态视觉能力的大模型，且**严禁混入专用生图协议模型**（生图接口不具备对话补全能力）；
- **动态探测三原则**：
  1. **多模态能力动态探测**：通过 `multimodal-detector.js` 自动检测当前会话模型是否具备多模态能力（黑名单短路 + 白名单及已知多模态特征识别）；若当前模型自身已具备多模态能力（如 GPT-4o、Claude 3.5 Sonnet、Gemini 等），100% 直通原生执行，不触发额外路由；
  2. **识图任务精准判定**：附带图片文件（`.png`、`.jpg`、`.jpeg`、`.webp` 等）或 prompt 显式查看本地图片时，判定为识图任务；
  3. **生图任务精准判定**：匹配中文文生图/绘图/出图意图或英文 image generation 关键词时，判定为生图任务；
- **两阶段路由与无缝回归流水线 (Two-Phase Routing & Handover Pipeline)**：
  - **Phase 1 (路由执行阶段)**：在同一个会话 Task 下：
    - 若是生图任务，调度专用生图模型，由 Rust 后端原生指令 `pi_generate_image` 向 `/images/generations` 或 DashScope 原生异步接口发送生图请求，接收图片字节流落盘至 `~/.pi-dl/attachments/`，生成 Markdown 图片卡片直接展示（支持 Flow 原生灯箱放大与一键保存到系统桌面）；
    - 若是识图任务，前端调用 `piClient.sendPrompt` 透传独立识图路由模型并注入图片 Payload，引导路由模型输出深度的视觉解析与结构化提取；调度指令以用户原始提问裸文本在前 + `<image_routing_handover>` 注入信封包裹内部指令构造，杜绝调度文本在输入历史与会话记录中外显；**识图任务必须显式配置独立识图模型，未配置时 `getEffectiveRoutingModel("vision")` 返回 null 直接回落常规会话链路**——专用生图模型不具备对话补全能力，严禁作为识图回退；
  - **Phase 2 (无缝回归与产物回填阶段 · 静默回填铁律)**：Phase 1 执行完毕后，收集路由模型的额外输出文本（包含解析内容或生成的图片 Markdown 产物），系统**无缝切回原本的会话模型**，将常规链路的完整发送 Prompt（`promptToSend`，含附件绝对路径块与指引，杜绝路由路径丢失非图片附件上下文）与路由回填说明/产物（包入 `<image_routing_handover>` 信封——前后端净化层 `clean_user_prompt` / `cleanUserPrompt` 统一剥离）构造为回填 Prompt 输入原会话模型继续深度交互；
    - **回填 Prompt 属路由模型向会话模型传递的内部会话信息，绝不在会话流展示**：回填轮次经 `TaskManager.startNewTurn(..., { silentPrompt: true })` 烙印 `turn.silentPrompt`，`createFlowTurnGroupElement` 对静默轮次跳过提问卡与路由胶囊渲染，`renderTurnsIntoFlow` 历史/挂起恢复路径同样传递 `silentPrompt` 保证任何渲染路径 0 外显；`resetStreamState(..., { silentPrompt: true })` 严禁改写 `lastUserQuery`（悬浮提问提示、保存按钮与「重试当前提问」必须继续对应用户原始提问）；完成通知文案同样回退 `task.query`；
    - **回填期收口守卫**：路由引擎在 `executeRoutedTask` 入口烙印 `task.routingHandoverActive = true`（Phase 2 内核运行接管后、路由失败 catch 与手动终止时解除），TaskManager `agent_end/agent_settled` 在该标记下严禁提前落地 completed / 触发完成通知 / 预归档半截会话——Phase 1（识图路由模型执行）的收口帧到达时任务尚有 Phase 2 静默续跑，由其结束后的真实收口帧统一结算；
  - **会话模型稳定性**：整个过程中，顶部状态栏、设置面板与底层会话的主模型始终保持为用户所选的原模型不变，由原模型基于丰富的图像解析或绘图上下文给出最终深入分析，实现“多模态辅助、原本模型主导”的无缝融合。
