# 项目规则与代理行为准则 (AGENTS.md)

本项目为基于 **Tauri 2 + 原生 Web 前端（HTML / CSS / JS）** 的桌面应用。所有参与本项目的 AI Agent 必须严格遵守以下行为规则与流程规范。

---

## 📌 核心准则一：文档、规范与代码必须同步更新（严格约束）

**在进行任何代码逻辑变更、重构、架构调整或配置升级时，必须在同一任务中同步对齐以下全部文档与技能，严禁滞后：**

1. **同步更新 `AGENTS.md`**：架构、命令、模块划分或代理工作流变化时，立即更新对应规则；
2. **同步更新 `README.md`**：功能特性、技术栈、目录结构或运行命令变化时，更新使用说明；
3. **同步更新 Skill 内容**：构建命令、操作流程或技术规范变化时，同步更新 [`.agents/skills/`](file:///.agents/skills/) 下对应技能。

> ⚠️ **交付标准**：任何任务交付时，代码、文档（`README.md` / `AGENTS.md`）与技能（`SKILL.md`）三者必须保持 **100% 严格一致**。

---

## 📌 核心准则二：任务完成自动编译、代码卫生与循环自愈

每次完成代码修改、功能新增或重构后，**必须执行以下闭环校验**：

1. **代码卫生与冗余清理 (`iterative-modification-hygiene`)**：
   - 严禁凭记忆修改，替换前先 `view_file` 对齐真实代码切片与行号；
   - 替换必须原子化覆盖旧逻辑与变量，杜绝未闭合括号、幽灵函数签名（Dangling Snippets）或重复声明；
   - **添加单元测试代码后必须清除**：任何在开发、重构或自愈验证过程中添加的临时单元测试（如 `#[cfg(test)] mod tests`、`#[test]` 或临时测试断言），在逻辑验证完成及任务交付前**必须彻底清除**，保持生产源码纯粹精炼，严禁滞留生产库；
   - Web 前端修改后立即运行 `node -c <filePath>` 静态验证 AST，杜绝语法错误导致冷启动卡死与白屏。
2. **极速编译校验**：优先运行极速校验命令（如 `npm run check` 或 `cargo check`，~1 秒；涉及 Tauri 配置或底层 ABI 修改时使用 `npm run build:check`）。
3. **失败自愈与循环修复**：若校验报错，必须分析日志根因并自动修复，重新编译直至 **Exit Code 0**。
4. **交付门禁**：仅在代码冗余与临时测试代码清理完毕、前端 AST 校验与后端编译均通过后，方可向用户交付。

---

## 📌 核心准则三：桌面端交互铁律与手势约束

本项目前端作为轻量桌面应用，**所有 UI 与交互修改必须严格遵守以下 16 项核心铁律**：

1. **拖拽区域限制**：全窗口仅顶部约 **30px** 标题栏支持拖拽（`-webkit-app-region: drag` / `data-tauri-drag-region`），内容主体、背景与品牌区严禁开启拖拽；
2. **焦点释放与消除高亮**：输入框高亮在点击外部空白区、非输入元素或右键点击时，必须立即失焦（`blur()`）并消除高亮；
3. **全域右键“返回上一步 (Step Back)”与四态界面流**：
   - 全域禁用浏览器默认右键菜单（`contextmenu` 拦截）；
   - **四态界面层级流**：`半透明侧边栏 (最高优先级)` ➔ `设置全页面 (界面4: settings)` ➔ `Flow 交互版 (界面3: 运行/暂停态转入后台挂起，已结束/中断态归档至历史)` ➔ `专注版 (界面2)` ➔ `详细版 (界面1)` ➔ 输入框失焦/清空；
   - **设置页 → Flow 定向回退 (`flowFromSettings`)**：从设置页会话记录 Tab「进入 Flow」时置 `viewStore.set({ flowFromSettings: true })`；Flow 中右键/Esc 时若空闲/已结束，直接回退至设置页会话记录 Tab（`previousMode: VIEW_DETAILED` 钉住 `viewStore.previous`，再右键照常回界面1）；若运行/暂停，走正常挂起通道；
   - **挂起与终止双通道解耦与强制终止铁律 (Decoupled Suspend & Force Termination Invariance)**：右键/Esc 转入后台挂起（`isSuspended = true`，进入 `TaskManager`，不调用 abort）；显式「⏹ 终止」按钮强制彻底终止 Agent 生成（Rust `SessionHost` 强杀子进程并阻断未决 prompt，前端 `PiClient` 拦截流式事件派发，`TaskManager` 门禁严禁任何迟到事件复活任务为 running/thinking/streaming/completed）。**手动点击终止时，全链路绝对禁止触发任何模型自动重连或模型切换**；已终止任务（`isAborted === true` 或 `status === "aborted"`）右键/Esc 严禁转入后台挂起（`suspendCurrentFlow` 返回 `null`，`handleGlobalStepBack` 判定 `isRunning = false` 直接归档并物理清除该 Task，回退至 Focus 界面）；
   - **任务直切自动挂起铁律 (Auto-Suspend on Active Task Switch)**：从右上角任务抽屉、历史会话或通知点击直接切换活跃 Task 时，原前台活跃任务必须在 TaskManager 中自动无缝转入后台挂起（`prevTask.isSuspended = true`），绝不允许产生既不在前台又未挂起的幽灵任务；切换进入新 Task 时统一在 `renderTurnsIntoFlow` 中重置收纳框引用 (`api.resetFileChanges`) 与流式步骤/工具卡片缓存，并对齐最新轮次步骤，保证多任务间任意来回直切均 100% 保持会话完整、互相隔离且不丢失；
   - **终态任务严禁后台挂起与幽灵已完成胶囊防范 (Completed Task Non-Suspension Invariance)**：在任务直接切换 (`setActiveTask` / `createTask`) 时，仅当前台原活跃任务处于运行态或待确认态（`thinking / streaming / tool_exec / paused`）时才转入后台挂起（`prevTask.isSuspended = true`）；若原任务已处于终态（`completed / aborted / error`），严禁赋予 `isSuspended = true`，直接从 `TaskManager` 清理，彻底杜绝从历史记录/会话记录切换进入其他会话时右上角瞬间冒出前一会话「已完成 (1/1 Task)」幽灵绿色徽标的缺陷；
   - **会话延续与多轮归属唯一性铁律 (Session Continuity & Consolidation Invariance)**：无论是全新会话、还是从「会话记录」或「历史记录」抽屉还原继续提问，后续追问统一透传底层会话文件路径（`sessionPath`）与会话 ID（`sessionId`）；Rust 后端 `PiHostPool` / `SessionHost` 在拉起内核子进程时，若存在已有会话路径（或经 `SessionIndexCache` 反查命中），严格采用 `pi --mode rpc --session <path>` 续写同一 `.jsonl` 文件，严禁使用盲目生成新 UUID 的 `--session-id` 导致多轮对话在重启或直接退出后被割裂为独立碎片记录；`ConversationHistoryService` 归档时严禁用空字符串覆写已有 `sessionPath`，保证历史记录与磁盘会话 100% 对应且多轮聚合完整；
   - **历史记录智能重定向与解耦归档铁律 (History-to-Task Smart Redirection & Decoupled Archive)**：从历史讯息抽屉点击卡片时，优先探测该会话是否在 TaskManager 中作为活跃/挂起任务存在；若存在直接重定向至 `restoreTaskToFlow`，严禁用静态旧 turns 覆写 live turns 或强制置 `completed`；`archiveCurrentFlowToHistory` 仅在终态（`completed / aborted / error`）时写入持久化历史，运行中仅同步内存 `turns`；历史抽屉对后台运行中任务展示脉冲「运行中」微动效徽章；
   - **会话回退与文件撤回铁律 (Flow Rollback & File Restoration)**：Flow 支持回退到任意一次历史对话（配合 pi 内核原生 RPC fork 历史节点回退），回退时自动撤回「已修改/已删除」的文件，**已新增的文件绝不撤回**（防误删）；快照由内置扩展在 `tool_call` 阶段（工具执行前、可阻塞）确定性落盘至 `~/.pi-dl/rollback/<sessionId>/`（桌面端注入 `PI_DL_ROLLBACK=1` 启用）；单文件 >8MB 超限明示警告横幅与专属徽标，弹窗转为只读警示阻止盲目回退；执行链路 = 回退点预解析（`pi_get_fork_messages`）→ 快照预检（`pi_rollback_files(dry_run: true)`，存在缺失/超限保守中止，磁盘与内核 0 变更）→ 内核 fork 先行（`pi_fork_session`，失败则磁盘 0 写入环境完全干净）→ 原子落盘（`pi_rollback_files(dry_run: false)`）→ 本地变更仓剪枝重渲 + 提问回填输入框 + 历史服务双向同步（首轮回退物理清除历史记录并解除绑定，多轮同步剪枝历史轮次；标记 `__isRolledBack` 阻断旧历史幽灵复活；0 轮草稿态任务严禁归档）；完成后顶部浮窗提醒成功/失败持续 3 秒；生成进行中禁止回退；响应帧无论有无等待者统一丢弃不落入广播通道（详见 `.agents/skills/flow-interaction-pattern/SKILL.md` §11）；
   - **Flow DOM 防重入铁律 (Flow Re-entrance Guard)**：已处于 Flow 模式且当前活跃任务匹配时，`restoreTaskToFlow` 与 `restoreConversationToFlow` 直接退出，严禁清空 DOM 导致流式截断与界面闪烁；
   - **运行中工具切片 DOM 自愈 (Running Tool DOM Self-Healing)**：切入运行中任务时由 `renderTurnsIntoFlow` 回填 `flow.renderedToolCards`，并在 `flow-pipeline.js` 的 `tool-update`/`tool-end` 中增加基于 DOM ID 的动态检索兜底与读秒自愈刷新，防止卡片永久卡在 running；
   - **后台流式串轮过滤铁律**：挂起任务的流式事件经前台门禁 (`taskManager.isForegroundStreamTask` + `piClient.lastEventTaskId`) 在 Flow UI 层全量过滤，只入 Task 数据缓冲，绝不写入前台 Flow DOM/历史轮次；历史讯息抽屉 (`task-panel.js`) 采用签名比对 + 180ms 节流调度渲染，杜绝后台任务事件风暴导致的悬浮频闪与双击选中失效；**会话流缓存铁律**：每个 Task 一份文件变更缓存仓（`flow-file-changes.js` `sessionStores`），前后台事件按 task_id 归仓收集、直至程序生命周期结束；右键退出（挂起/归档）后经历史记录/Task 记录回入 Flow 时由 `renderTurnsIntoFlow` → `restoreFileChangesFor` 一致恢复收纳框，历史快照卡片重绑以 `__piBound` expando 去重（严禁 `dataset.bound` 判定，杜绝双绑互消与快照死卡）；**删除识别工作目录铁律**：Shell 删除目标（`rm / del / Remove-Item`）须经 `cd` 链路 + MSYS 盘符转换 + `~`/`[USER_HOME]` 展开 + 会话 CWD 兑底归一化为绝对路径后再经 `pi_path_exists` 探测/复核，杜绝相对路径因桌面端进程 CWD 失真被去伪规则误杀（表现：删除示意信息在收纳框中消失）；**新增文件同步探测铁律 (Synchronous Pre-Execution Probe Invariance)**：写文件工具（`write` / `write_file` / `create_file` 等）启动时，`tool-start` 必须纯同步执行并在当前事件调用栈内立即向 `existenceProbes` 登记存在性探测 Promise，严禁引入任何 `await` 导致微任务挂起，杜绝写文件瞬时完成后 `tool-end` 抢先到达引发探测竞态将新增文件误判为修改；`tool-end` 比对统一使用 `normalizePathKey` 消除正反斜杠与大小写差异；
   - **输入框防抖**：详细版下对着输入框点击右键时静默屏蔽，杜绝界面瞬切抖动；新模块均需接入 `window.__piRegisterStepBack`；
4. **手绘 SVG 矢量图元规范（消除系统 Emoji）**：
   - 禁止使用系统默认 Emoji，所有功能与提示图标统一在 `src/assets/svg/` 归档并以内联手绘 SVG 呈现；
   - 统一采用 `currentColor`，深度适配浅色（素描绘图纸）与深色（炭黑素描黑板）双模主题；
5. **按钮设计与交互铁律（常态透明、常态无边框、悬浮显框）**：
   - 主界面新增按钮常态背景必须透明（`background: transparent`）；
   - 常态严禁显示可见边框，必须采用 `border: 1px solid transparent;` 保持 1px 几何占位，杜绝悬停时因边框显现导致布局抖动（Layout Shift）；
   - 仅在鼠标悬浮（`:hover`）或键盘聚焦（`:focus-visible`）时显现手绘边框与微背景；
6. **隐藏式极简滚动条规范 (Minimal Slim Hidden Scrollbar)**：
   - 全局消除浏览器默认上下箭头按钮与滚动槽；
   - 常态为 4px 极窄竖条（隐匿且不遮挡内容），采用半透明 `var(--sketch-border-subtle)`（透明度 0.45）；
   - **内容区 hover 不高亮**：鼠标悬浮内容区时保持静默；仅当鼠标移入滚动条轨道/滑块本身范围时，滑块展开至 6px 并高亮加深；
7. **手绘草图组件套件 (Sketch Components)**：
   - 下拉框统一采用 `SketchSelect`（180ms Pop & Micro-Shake 微抖动，双向同步原生 `<select>`）；
   - 表单填表统一采用 `SketchAutoFill`（消灭原生填表变色伪类，预设联动与历史记忆沉淀）；
   - 模态弹窗统一采用 `SketchModal`（居中定位、毛玻璃遮罩、全域右键/Esc 优先拦截与焦点陷阱）；
8. **系统托盘与单实例互斥**：
   - 单实例互斥运行，重复启动自动唤醒置顶已有主窗口；
   - 点击右上角关闭按钮隐藏至系统托盘常驻（`window.hide()`），托盘支持打开、设置与彻底退出；
9. **失焦 Windows 系统通知铁律**：
   - 仅在软件处于**失去焦点 (Blurred / Background)** 状态且全部输出完成、需人工确认或发生中断报错时触发 Windows 原生 Toast 通知，聚焦时绝对静默；
10. **无内核运行与交互降级规范 (Kernel-less Operation & Degradation)**：
    - **平稳启动**：未检测到内核时平稳启动进入待机态，禁止死循环重启；
    - **顶部状态展示**：界面1/2/3 顶部模型标签常驻显示「未检测到pi内核」，点击直达设置页内核下载面板；
    - **发送入口屏蔽**：发送按钮置灰禁用（`disabled`），输入框按键拦截并弹出友好指引；
    - **内核面板降级**：内核页状态显示「未检测到内核 / 未安装」，「重启内核」与「不再提醒更新」禁用，内核组件区域完全隐藏；
    - **一键下载自愈**：启动自动检测官方最新版本，支持「一键下载并安装」，安装就绪后自动拉起内核并恢复 UI；
    - **内核保险自动重连 (Kernel Insurance Auto-Reconnect)**：后台检测内核 `crashed` 状态由 Rust 监督器自动平滑重连最多 5 次（间隔 2 秒，重连前二次校验 `is_stopping` 防止竞态）；成功即恢复 Ready；5 次均失败落入终态 Crashed 并广播 `pi:kernel-reconnect-failed`，前端左上角触发红色抖动小闪电胶囊提醒（点击可手动重启内核），内核恢复后自动隐藏；
11. **多模态文件与文件夹拖拽自动链路规范**：
    - 支持直接拖入单/多文件或整个文件夹到输入框与主窗口；
    - 文件夹拖入时由 Rust 后端（`pi_inspect_paths`）直接生成单个文件夹概述胶囊（`category: "folder"` + 手绘文件夹 SVG），不展开炸裂为零散子文件；
    - 附件胶囊在输入框内部上方自然换行排列（支持极简滚动条与无缝换行，杜绝横向溢出），下方保留 100% 全宽文本输入区；发起对话时自动注入系统绝对路径供内核原生遍历；
12. **Markdown 预览渲染与全域超链接跳转规范**：
    - 模型输出全面采用 Typedown 质感 Markdown 预览渲染引擎（`src/lib/markdown-renderer.js` + `src/styles/markdown.css`）；
    - 支持多级标题、围栏代码块（手绘语言徽标 + 一键复制 + 复制反馈 + 多语言轻量高亮）、GFM 表格、任务清单（Checkbox）、GitHub Callout 警示框（Note/Tip/Important/Warning/Caution）与流式未闭合标记自愈；
    - 全域 HTTP/HTTPS/Mailto 超链接自动解析并拦截点击，通过 Tauri 后端（`tauri_plugin_opener` / `pi_open_url`）唤起操作系统默认外部浏览器打开，严禁在 Webview 内部跳转；
13. **预设工作区 "code-area" 路由工作区与技能调度中枢规范 (Hub & Routed Workspace)**：
    - **定位**：`code-area` 作为全局编码技能集与调度中枢，在 `code-area/.agents/skills/` 维护专业技能；
    - **物理 CWD vs 路由目标**：Pi 内核物理 CWD 驻留在 `code-area` 运行时目录（原生感知内置技能），同时内设绑定「路由工作区（目标项目根路径）」；
    - **原生 Windows 文件夹选择器**：基于 Rust `rfd` (IFileOpenDialog) 实现 Windows 原生 OpenFolder 文件夹选择器（右下角为标准的「选择文件夹」/「打开」，杜绝网页上传字样与弹窗）；
    - **平滑切换与择时绑定**：允许先切换至 `code-area`，再在设置面板或主界面择时添加路由；处于 `code-area` 且未绑定路由时，输入框禁止输入（只读提示），点击输入框快速呼出路由绑定对话框；
    - **免污染铁律**：`code-area` 自身绝对不创建或修改业务文件，所有代码读写、补丁与命令执行严格作用于目标路由项目；
    - **存在性自动校验与失效清除**：切换至 `code-area` 或启动时，自动校验路由工作区与「最近使用项目」是否在本地磁盘真实存在；失效时自动清除选项并过滤失效历史；
    - 对话流上下文注入：发起 Prompt / FollowUp 时透明注入 `<code_area_routing_context>`（目标绝对路径、免污染铁律与 Hub 技能清单），自动读取并注入目标路由工作区的 `AGENTS.md`（及 `README.md`）。`.agents/skills/` 下的技能规约无需全量强制前置注入，由 Agent 遵循 `AGENTS.md` 中的 Skills 映射矩阵按需查阅并调用；并在 Flow 呈现路由目标胶囊；所有注入条目（Inner-Skill / AGENTS.md / README.md / 路由信封）在 Flow 会话流「路由目标项目」胶囊下方的「注入提示」信息框中集中呈现（直角简洁风格，默认收起显示「注入提示」与注入数量，点击展开完整清单；动态累积、去重）；
14. **子代理模型自动钉住与防跃升机制 (Subagents Model Pinning & Escalation Prevention)**：
    - 当启用 `pi-subagents` 扩展组件时，在软件初次启动加载、用户切换模型、或安装/更新组件时，自动将当前主模型同步写入 `~/.pi/agent/settings.json` 的 `subagents.defaultModel` 与各常用角色（`oracle`, `worker`, `reviewer`, `researcher`, `planner`, `scout` 等）的 `agentOverrides`；
    - 采用非破坏性读-合并-写回语义，完整保留其余已有配置；未启用 `pi-subagents` 时绝不产生冗余字段污染，彻底杜绝子代理角色因 high-thinking 能力画像擅自升配调用更昂贵模型（如 `deepseek-v4-pro`）造成的额外 Token 消耗；
15. **Node.js 运行环境预设检测与安装拦截引导规范 (Node.js Environment Preflight & Degradation)**：
    - **底层依赖与自适应探测**：Pi 扩展组件安装/更新与内核生态依赖 Node.js/npm 运行环境。Rust 后端通过 `pi_check_node_environment` 具备 Windows 全域 PATH 与多默认安装路径自适应极速探测能力（`node -v` / `npm -v`），无控制台黑框且带超时与非破坏性借用保护；
    - **友好拦截与一键直达**：用户在扩展组件市场安装单个组件、一键安装推荐插件、更新组件或更新/下载内核时，前端自动执行 Node.js 环境预检。未检测到环境时优雅拦截并弹出手绘风格 `SketchModal` 提示框，支持一键通过外部浏览器（`pi_open_url` / `tauri_plugin_opener`）唤起 Node.js 官方下载页面（`https://nodejs.org/`），杜绝生硬崩溃与晦涩错误；
    - **无感缓存与动态重试**：已成功检测到环境时无感缓存，未安装时每次操作自动重新探测，允许用户安装好 Node.js 后无需重启即刻继续；
16. **输入历史记录导航与严格时间序规范 (Prompt History Navigation & Chronological Invariance)**：
    - **严格时间序与最新优先 (LIFO / MRU)**：输入框方向键“↑ / ↓”翻阅历史严格遵循真实时间戳排序与最新项优先。Rust 后端从底层会话中提取每条用户消息真实毫秒时间戳全局排序，采用 LIFO 去重保留最新出现；
    - **数据合并顺序对齐**：前端合并底层原生会话与本地输入历史时，以底层历史为时间线基座，本地当前会话最新输入置于末尾，严禁旧会话数据覆盖或倒挂；
    - **重复发送自动晋升**：用户重复发送提问时，自动从旧位置移除并晋升至历史栈末端，保证发送完成后按“↑”100% 稳稳命中上一条发送的消息；
    - **输入框单行/多行光标敏感感知**：单行文本光标在任意位置按“↑”直接翻阅历史（彻底消除“按一次跳行首、按第二次才出历史”的缺陷）；多行文本仅首行按“↑”、末行按“↓”触发；
    - **二次编辑草稿保护**：翻阅过程中手动编辑内容时，动态同步更新草稿并适时重置导航态，杜绝用户修改后的文字被上下键冲掉覆盖；
17. **会话监听与实时记录铁律 (Session Watcher & Real-time Record Invariance)**：
    - **常驻生命周期托管**：`SessionWatcher` 必须在 Rust 后端 setup 阶段通过 `app.manage(session_watcher)` 注入全局生命周期托管，内部封装 `Arc<Mutex<Option<RecommendedWatcher>>>` 确保线程安全与常驻存活，严禁作为局部变量在 setup 闭包结束时被 RAII Drop 释放导致文件监听器销毁；
    - **目录精准锁定与递归监听**：默认监听目录严格锁定为 Pi 内核真实会话根目录 `~/.pi/agent/sessions`（二级子目录按 CWD 隔离），初始化时自动 `create_dir_all` 确保存在；
    - **三重同步与自愈机制**：提供 `pi_refresh_sessions` 主动扫描广播指令；前端切换至设置页「会话记录」Tab 时强制拉取最新数据（`api.loadSessions(true)`）；会话任务终态（`agent_end` / `agent_settled`）时自动延迟触发增量会话同步，形成「实时文件监听 + 终态主动同步 + Tab 切换强刷」三重保证，杜绝会话完成后无法实时进入记录的缺陷。

> 📖 **完整功能矩阵与系统特性总览**：详见项目架构总览技能 [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md)。

---

## 🧭 Skills 架构体系与分层规范（严格界定）

本项目严格区分并定义了两类不同生命周期的 Skill：

### 1. 项目开发级 Skills (`.agents/skills/`)
> **作用对象**：协助本项目源码开发、迭代、重构与调试的 AI 编码助手。

| 领域分类 | Skill 名称 | 路径 | 核心能力与触发场景 |
| :--- | :--- | :--- | :--- |
| **架构与规范** | **`pi-desktop-overview`** | [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md) | 产品定位、四态体系、核心特性与交互流水线总览（触发：项目概述/架构总览/四态界面）。 |
| | **`pi-ecosystem-configuration`** | [`.agents/skills/pi-ecosystem-configuration/SKILL.md`](file:///.agents/skills/pi-ecosystem-configuration/SKILL.md) | Pi API 鉴权、大模型接入、Packages 扩展包、Skills 规范、TypeScript 扩展与子代理钉住配置全指南（触发：pi配置/模型配置/组件安装/auth.json/models.json/subagents配置/Ollama配置）。 |
| | **`inner-skills-injection`** | [`.agents/skills/inner-skills-injection/SKILL.md`](file:///.agents/skills/inner-skills-injection/SKILL.md) | 运行态内置约束（RULES.md）按需注入架构与流水线（触发：运行态技能/上下文注入/RULES）。 |
| **手绘 UI 与交互** | **`sketch-drafting-ui`** | [`.agents/skills/sketch-drafting-ui/SKILL.md`](file:///.agents/skills/sketch-drafting-ui/SKILL.md) | Anthropic/Pi.dev 手绘草图美学、简约线条与纸质双模主题（触发：手绘风格/工程绘图风/草图UI）。 |
| | **`sketch-modal-pattern`** | [`.agents/skills/sketch-modal-pattern/SKILL.md`](file:///.agents/skills/sketch-modal-pattern/SKILL.md) | 手绘素描居中模态弹窗（Pop & Shake、Step Back 优先拦截、焦点陷阱）（触发：模态窗/弹窗/alert替换）。 |
| | **`sketch-form-autofill-pattern`** | [`.agents/skills/sketch-form-autofill-pattern/SKILL.md`](file:///.agents/skills/sketch-form-autofill-pattern/SKILL.md) | 手绘表单规范、消灭原生变色与 `SketchAutoFill` 智能联想（触发：新增表单/自定义填表/autofill）。 |
| | **`svg-asset-workflow`** | [`.agents/skills/svg-asset-workflow/SKILL.md`](file:///.agents/skills/svg-asset-workflow/SKILL.md) | 手绘 SVG 图元规范、`currentColor` 主题自适应与内联管理（触发：SVG图标/替换图标/图标规范）。 |
| | **`flow-interaction-pattern`** | [`.agents/skills/flow-interaction-pattern/SKILL.md`](file:///.agents/skills/flow-interaction-pattern/SKILL.md) | Flow 流式交互（单行紧凑过程卡、因果时序拼接、多轮定位、模型自动重连、文件变更收纳框、会话回退撤回、状态分仓与自绑定）（触发：flow交互/思维链/轮次定位/文件变更/修改了哪些文件/会话回退/撤回文件）。 |
| | **`settings-view-pattern`** | [`.agents/skills/settings-view-pattern/SKILL.md`](file:///.agents/skills/settings-view-pattern/SKILL.md) | 设置全屏独立视图（第4态）、5 大 Tab、MRU 模型排序与回退流（触发：设置界面/配置页面/settings）。 |
| **工程与治理** | **`desktop-kernel-lifecycle`** | [`.agents/skills/desktop-kernel-lifecycle/SKILL.md`](file:///.agents/skills/desktop-kernel-lifecycle/SKILL.md) | Tauri 2 + Rust 内核生命周期管控、多环境寻址与 Release 打包避坑（触发：内核崩溃/进程重启/打包）。 |
| | **`auto-compile-and-fix`** | [`.agents/skills/auto-compile-and-fix/SKILL.md`](file:///.agents/skills/auto-compile-and-fix/SKILL.md) | 任务完成后自动极速编译与失败自愈闭环、前端门禁与度量（触发：编译校验/自动修复/构建验证/门禁）。 |
| | **`clean-code-refactoring`** | [`.agents/skills/clean-code-refactoring/SKILL.md`](file:///.agents/skills/clean-code-refactoring/SKILL.md) | 桌面端与 Web 混合架构逻辑去重、结构精简与样板消除（触发：代码精简/去冗余/重构优化）。 |
| | **`iterative-modification-hygiene`** | [`.agents/skills/iterative-modification-hygiene/SKILL.md`](file:///.agents/skills/iterative-modification-hygiene/SKILL.md) | 连续迭代代码卫生、AST 语法静态校验与防幽灵残余（触发：多次修改代码/清理冗余/代码卫生）。 |

---

### 2. 应用内置运行态约束级 Inner-Skills (`src-tauri/inner-skills/`)
> **作用对象**：桌面端作为 Pi Agent 宿主时，由 Rust 监督器在底层工具调用时进行 Hook 嗅探并按需动态注入。全套规则采用纯英文精炼书写，杜绝系统 Emoji 与冗余 Token 损耗。

- **核心机制**：
  1. **RULES 索引映射**：`RULES.md` 为极简映射唯一源（<100 Tokens），无工具调用时零规则零消耗；
  2. **Tool Call Hook**：工具启动时触发 `hook_tool_call`，命中且当轮首次激活则按需注入；
  3. **动态 Steering 注入**：优先通过 `steer` 命令即时注入 `<runtime_inner_skill>`，失败则进出站队列；
  4. **周期重置与前端反馈**：Turn 边界重置去重集合；Hook 命中时广播 `pi:inner-skill-activated`，在 Flow「路由目标项目」胶囊下方的「注入提示」信息框中动态累积呈现（默认收起显示「注入提示」与注入数量，同时 `pi:context_injected` 事件上报路由上下文等全部注入条目）；
  5. **上下文脱敏净化**：加载历史或回溯搜索时自动剥离运行态注入信封，100% 还原用户原始输入。

| Inner-Skill 名称 | 路径 | 触发工具 / 场景 | 核心约束 |
| :--- | :--- | :--- | :--- |
| **`RULES.md`** | [`src-tauri/inner-skills/RULES.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/RULES.md) | 工具映射总纲 | 纯英文工具到 Skill 动态映射矩阵与基线总纲。 |
| **`windows-bash-compatibility`** | [`src-tauri/inner-skills/windows-bash-compatibility/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/windows-bash-compatibility/SKILL.md) | `bash`, `powershell`, `cmd` | 统一正斜杠 `/`、强制 `-y`、禁用 Pager、UTF-8 编码。 |
| **`document-multimodal-inspection`** | [`src-tauri/inner-skills/document-multimodal-inspection/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/document-multimodal-inspection/SKILL.md) | `read_file`, `docparser`, `ocr`, `pi-ocr` | 主动深度遍历目录、专用解析器提取真实文本、批量汇总。 |
| **`multi-agent-orchestration`** | [`src-tauri/inner-skills/multi-agent-orchestration/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/multi-agent-orchestration/SKILL.md) | `subagent`, `pi-subagents`, `spawn_agent` | 明确任务边界、非阻塞并发派发、超时控制与结果去重。 |
| **`web-search-silent-access`** | [`src-tauri/inner-skills/web-search-silent-access/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/web-search-silent-access/SKILL.md) | `web_search`, `pi-web-access`, `search_web` | 静默后台执行、禁止弹窗、多源交叉求证与垃圾过滤。 |
| **`persistent-memory-retrieval`** | [`src-tauri/inner-skills/persistent-memory-retrieval/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/persistent-memory-retrieval/SKILL.md) | `memory_retrieve`, `memory_store`, `pi-memory` | 模糊跨会话查阅、语义相关性匹配、增量安全存储与敏感隔离。 |
| **`dynamic-workflows-orchestration`** | [`src-tauri/inner-skills/dynamic-workflows-orchestration/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/dynamic-workflows-orchestration/SKILL.md) | `dynamic_workflows`, `execute_workflow` | 分阶段前置校验、单步自愈熔断、执行进度与里程碑追踪。 |
| **`active-context-pruning`** | [`src-tauri/inner-skills/active-context-pruning/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/active-context-pruning/SKILL.md) | `context_prune`, `prune_context`, `pai-acp` | 渐进修剪冗余工具载荷、保护核心意图与最新代码锚点。 |
| **`temp-file-hygiene`** | [`src-tauri/inner-skills/temp-file-hygiene/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/temp-file-hygiene/SKILL.md) | `write`, `create_file`, `bash`, `cmd` | 临时文件强制沙盒隔离至 `~/.pi-dl/temp/`，零污染项目与工作区，用后即删。 |

---

## 🗂️ 前端模块化结构速查 (Frontend Module Layout)

前端按功能域模块化解耦，严禁向入口文件堆砌业务代码：

- **`src/main.js`**：唯一编排入口。**不收集 DOM 引用（`ctx.el` 已彻底废除，各模块经 `src/lib/el-binder.js` 的 `bindAll` 按需自绑定）**，仅构建共享上下文（`ctx.*`：`flowDom` + `viewStore` / `settingsStore` / `attachmentsStore` / `flowStore` store 引用 + `ctx.flowView` 视图派生缓存 + `ctx.api`）并按依赖顺序初始化各模块；
- **`src/lib/`**：跨模块共享基础件（`dom-utils.js` 文本转义、`icons.js` 手绘 SVG 图元、`markdown-renderer.js` Markdown 渲染引擎、`view-constants.js` 四态常量、`event-bus.js` 极简同步事件总线、`el-binder.js` DOM 按需绑定（`bindAll` 全局按 id / `bindEl` 容器内按 id）、`contracts.js` 事件通道契约表（bus / Store action / `pi:*` 内核桥接三类归口，含 `ui:workspace-changed` 与 `flow:response`（payload 必带 taskId））+ 跨模块显式 import 契约（flow-render 纯渲染接口、flow-state-view 视图层分层、el-binder）+ `ctx.api` 函数槽契约 @typedef 定型（全量槽位按属主模块分组登记 + 三类保留原因注解，新增槽位必须同步登记，严禁幽灵槽/兼容壳复发）。
- **`src/modules/`**：按功能域拆分的 UI 业务模块（`view-mode.js`、`settings-navigation.js`、`model-panel.js`、`custom-provider-panel.js`、`kernel-panel.js`、`flow-ui.js`、`flow-stream.js`、`flow-pipeline.js`、`flow-file-changes.js`、`flow-rollback.js`、`task-panel.js`、`packages-panel.js`、`workspace-panel.js`、`sessions-panel.js`、`global-interactions.js`、`search-input.js`、`file-attachments.js`、`preferences.js`、`window-controls.js` 等；`flow-render.js` 纯渲染层、`flow-dom.js` Flow 域只读 DOM 引用层、`flow-state-view.js` Flow 视图派生缓存唯一属主）。跨模块调用通过 `ctx.api.<fn>()` 与显式 import；**纯渲染助手已迁至 `flow-render.js`（无副作用、无共享状态），其它模块直接 `import { ... } from './flow-render.js'`**；**Flow 视图分层铁律：流式「纯数据」（responseText / thinkingText / errorMessage / lastUserQuery / hasReceivedDelta / interruptSendTaskId / lastSentPrompt / lastSentAttachments / lastImagePayloads / thinkingStartTime 等 11 字段）一律经 `flowStore.for(taskId)` 分仓读写（分仓键经 `resolveStreamTaskId` 解析：显式 id 优先→前台活跃任务→事件帧 task_id→哨兵分仓），严禁 `flow.<纯数据>` 裸写（度量断言 = 0）；视图派生缓存（renderedToolCards / currentSteps / active*Step / 计时器 / activeTurnRefs / followBottom）一律归 `flow-state-view.js` 的 `flowView`（Object.seal 封口，严禁入 store）**；**Flow 域只读 DOM 引用由 `createFlowDom()` 产出挂到 `ctx.flowDom`（内部经 el-binder 自取），flow-* 模块改读 `flowDom.flow*`；其余模块 DOM 引用一律模块内 `bindAll({...})` 自绑定自己的 id 子集，严禁解构 `ctx.el`（已废除）**；横切通知（fire-and-forget，如 `ui:toast`）走 `event-bus.js` 的 `bus.on` / `bus.emit`（事件须在 `contracts.js` 契约表登记）；控制流 / 状态迁移走 Store action（如 `viewStore.morph(mode, opts)`）或显式 import；**共享可变状态一律归 `src/services/stores/` 的唯一属主（`viewStore` / `settingsStore` / `attachmentsStore` / `flowStore`），严禁跨模块直改 `view.x` / `settings.x` / `attachments.x`（含解构后裸名）**；
- **`src/services/stores/`**：共享可变状态唯一属主（无 DOM、有状态、有行为）。`view-store.js`（四态界面状态机 `morph`/`set`，控制流命令禁上总线）、`settings-store.js`（通道抽屉/官方目录/认证缓存/激活工作区）、`attachments-store.js`（输入框附件胶囊）、`flow-store.js`（Flow 流式纯数据唯一属主，**按 taskId 分仓** `flowStore.for(taskId)`：作用域实例记忆化 + 白名单 `set` + `appendResponse`（同步 + bus.emit `flow:response` 必带 taskId）+ 空键哨兵归一；接管全部 11 个纯数据字段，`flow.*` 裸写度量断言 = 0）。**Store action 一律同步、禁 async/await、禁微任务调度**（同步探测不变量 / 前台门禁 taskId / Task 分仓）；
- **`src/styles/`**：按功能域拆分的样式文件（`tokens.css`、`base.css`、`layout.css`、`flow.css`、`markdown.css`、`settings.css`、`packages.css`、`overlays.css` 等），`src/styles.css` 仅为 `@import` 聚合入口；
- **`src/services/`**：与 UI 解耦的前端服务层（IPC 桥接、配置、流式客户端、任务/会话/工作区等），**严禁**在 service 中直接操作 UI DOM；其中 `src/services/stores/` 为共享可变状态唯一属主（见上）。

---

## ⚙️ 常用命令与工作区规范

### 常用命令
- **极速编译检查（首选，~1s）**：`npm run check`
- **前端静态校验门禁（语法 + import 图 + 循环依赖，重构必做）**：`npm run check:fe`
- **耦合度量基线检查（裸写断言 = 0 / 契约槽位监控）**：`npm run measure:coupling`
- **桌面端开发调试**：`npm run dev`
- **构建测试（生成二进制，不打包）**：`npm run build:check`
- **正式发布构建（生成安装包）**：`npm run build`
- **Rust 后端语法检查**：`cargo check`（位于 `src-tauri` 目录）

> 🛡️ **后端命令层规范**：Tauri IPC 命令按领域拆至 `src-tauri/src/commands/`（`file` ↔ 前端文件操作、`window` ↔ 窗口/通知、`agent` ↔ Agent RPC/任务/模型/工作区、`session` ↔ 会话索引、`rollback` ↔ 回退/fork/文件撤回、`workspace_cmd` ↔ 多预设工作区与 code-area 路由、`skills` ↔ 运行态技能规则、`version` ↔ 内核版本检测）；`lib.rs` 仅保留 `invoke_handler!` 汇总与 `run()` 启动；`config_manager.rs` 拆为 `config_manager/{io,schema,migrate,validate}.rs`（`mod.rs` `pub use` 再导出，调用方 `use` 路径不变）。新增/修改 IPC 命令时，应落在对应领域子模块，而非 `lib.rs`。

### 多预设工作区与路由调度中枢
- **IPC 指令**：`pi_list_workspaces`（列出预设与运行时状态）、`pi_get_active_workspace`（获取当前生效工作区）、`pi_set_active_workspace(id)`（物化副本 ➔ 持久化 ➔ 切换 ➔ 空闲重启重锚 CWD）；
- **公共预设 (`workspaces/`)**：
  - `default-area`：默认工作区；
  - `code-area`：**全局编码技能集与路由调度中枢**（物理 CWD 驻留 `code-area`，经 `rfd` 原生选择器路由外部目标项目，透明注入目标项目 `AGENTS.md` / `README.md`，免污染目标项目）；
  - `research-area`：深度研究与探索预设；
- **随安装包分发**：注册于 `tauri.conf.json` 的 `bundle.resources`，首次选中整目录物化复制至 `~/.pi-dl/workspaces/<id>/` 作为运行时副本。
