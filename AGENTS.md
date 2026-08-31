# 项目规则与代理行为准则 (AGENTS.md)

本项目为基于 **Tauri 2 + 原生 Web 前端** 的桌面应用。所有参与本项目的 AI Agent 必须遵守以下行为规则与流程规范。

---

## 📌 核心准则一：文档、规范与代码必须同步更新（严格约束）

**在进行任何代码逻辑变更、逻辑结构重构、架构调整或配置升级时，必须在同一任务中同步修改并对齐以下全部文档与技能定义，严禁滞后：**

1. **同步更新 `AGENTS.md`**：若架构、命令、模块划分或代理工作流程发生变化，必须立即更新本文件中的对应描述与规则；
2. **同步更新 `README.md`**：若项目功能、特性、技术栈、目录结构或运行命令发生变化，必须更新 README 中的项目介绍与使用说明；
3. **同步更新 Skill 内容**：若操作流程、构建命令、诊断策略或技术细节发生变化，必须同步更新 [`.agents/skills/`](file:///.agents/skills/) 目录下的对应技能文件。

> ⚠️ **强制约束标准**：任何功能提交或任务交付时，代码、文档（`README.md`/`AGENTS.md`）与技能（`SKILL.md`）三者必须保持 **100% 严格一致**，不得交付任何文档或规范过时的代码。

---

## 📌 核心准则二：任务完成自动编译、代码冗余清理与循环修复

每次在完成任何代码修改、功能新增、重构或配置调整后，**必须遵循代码卫生与自动编译闭环流程**：

1. **多次连续修改必须防范并清理代码冗余 (`iterative-modification-hygiene`)**：
   - 严禁凭记忆盲目修改，多次局部替换前必须先 `view_file` 对齐真实代码切片与行号；
   - 替换必须原子化覆盖旧逻辑与旧变量，严禁残留未闭合大括号、幽灵函数签名（Dangling Snippets）或重复声明；
   - Web 前端修改后必须立即运行 `node -c <filePath>` 静态验证抽象语法树（AST），秒级杜绝未闭合语法导致的冷启动卡死与白屏。
2. **自动触发极速编译校验**：在结束任务前，优先运行快速编译校验命令（如 `npm run check` 或 `cargo check`，通常仅需 ~1 秒；若涉及 Tauri 配置或底层 ABI 修改，可选用 `npm run build:check`）。
3. **失败自愈与循环修复**：若编译或语法校验遇到错误，不得直接交付或向用户报停，必须分析错误日志、定位根因并自动修复，然后重新尝试编译，**直至编译成功（Exit Code 0）**。
4. **交付标准**：只有在代码冗余彻底清理、前端 AST 校验与后端编译完全通过后，方可向用户交付并输出最终回复。

---

## 📌 核心准则三：桌面端交互铁律与手势约束

本项目前端作为轻量桌面应用，**必须严格遵守以下交互铁律**：

1. **拖拽区域限制**：全窗口仅顶部约 **30px** 标题栏区域支持窗口拖拽（`-webkit-app-region: drag` / `data-tauri-drag-region`），内容主体、背景与品牌区严禁开启拖拽；
2. **焦点释放与消除高亮**：输入框高亮（focus）在点击外部空白区、非输入元素或右键点击时，必须立即失焦（`blur()`）并消除高亮；
3. **右键永远是“返回上一步/回退”与多态界面流**：
   - 全域彻底禁用浏览器默认右键菜单（`contextmenu` 拦截）；
   - 右键行为统一作为“返回上一步 (Step Back)”：
     - **四态界面层级流**：`半透明侧边栏 (最高优先级)` ➔ 右键立即平滑收起并解除主背景高斯模糊；`设置全页面 (界面4: settings)` ➔ 右键立即返回进入前的原界面；`Flow 交互版 (界面3)` ➔ 右键**转入后台持续运行 (Suspend to Background，绝不调用 abort)** 并回退至 `专注版 (界面2)`，顶部弹出 1.5s 手绘提示条 `已转入后台运行 (Task #1)`；`专注版 (界面2)` ➔ 右键回退至 `详细版 (界面1)` 并失焦；
     - **基础层回退**：详细版下优先失焦高亮组件 ➔ 清空当前输入 ➔ 触发业务回退分发。所有新功能模块必须接入 `window.__piRegisterStepBack`；在详细版下对着输入框点击右键时静默屏蔽（阻止 mousedown 获焦与右键冒泡，杜绝界面瞬切抖动）；
   - **Flow 界面「后台挂起」与「彻底终止」双通道解耦设计**：
     - **通道 1：后台挂起与状态收纳 (Background & Paused / Waiting)**：在 Flow 处于运行态（`thinking` / `streaming` / `tool_exec`）或暂停待确认态（`paused` / 请求人工交互确认）时按鼠标右键或按 Esc，当前对话无感转入后台 `TaskManager`（`isSuspended = true`），界面回退至 Focus 界面，右上角 Mini 任务胶囊计数同步更新（暂停待确认任务在侧边栏明确标注「待确认」徽章）；前台正常完成或中断的 Flow 绝不计入挂起任务；
     - **通道 2：彻底终止 (Abort) 与手动终止提示 (Manual Abort Notice)**：在 Flow 界面输入框右侧显式提供手绘「⏹ 终止」按钮及侧边栏单任务终止操作，负责彻底终止 Agent 生成；该方块中止按钮受严格视图隔离保护，仅在 Flow 运行态显现，在详细版（界面1）、专注版（界面2）及设置全页面（界面4）下绝对禁止出现；用户主动终止时，Flow 会在对话输出结尾即时追加手绘草图风格「刚刚会话已手动终止」提示字段，并同步沉淀至业务历史会话快照中；
     - **Flow 结束/中断右键归档与 Task 清除**：当 Flow 正常完成或处于“中断”状态（模型调用失败/报错/异常终止）时，逻辑判定为当前一段 Flow 已结束；此时用户按鼠标右键或按 Esc，自动将对话（含提问、思考、工具调用与报错诊断快照）沉淀至业务记忆服务（`conversationHistoryService`）并清理 Task 记录，回退至 Focus 界面；若已收纳为后台 Task 的任务发生中断，其状态展示为「异常终止」（暗黄色徽章）；
   - **多任务监控 Mini 胶囊、半透明侧边栏与背景高斯模糊 (`Mini Task Capsule & Details Sidebar`)**：
     - **右上角 Mini 任务胶囊**：仅在存在后台挂起任务时显现，展示 `[ ✏️ 1/3 Task ]`（分子为已完成任务数[含正常完成、异常终止、已终止]，分母为总挂起任务数）；运行中呈现小铅笔微旋转呼吸动画（`spin-pulse`），全部完成转为实线手绘绿墨色；无挂起任务时保持隐藏；
     - **半透明毛玻璃侧边栏**：点击 Mini 胶囊滑出 320px 半透明手绘侧边栏（`backdrop-filter: blur(14px)`），主界面区域自动触发 `filter: blur(4px); opacity: 0.6;` 高斯模糊；侧边栏展示每个挂起 Task 的模型、状态徽章（「思考中」、「流式生成中」、「执行工具」、「待确认」、「异常终止」、「已终止」、「已完成」）、提问摘要与操作区（「进入 Flow」、「⏹ 终止」）；全域右键或按 Esc 优先平滑收起侧边栏并复原主背景；
   - **系统托盘与单实例多态唤醒路由调度**：
     - **活跃挂起 Task = 1**：直通进入该 Task 的 Flow 交互流；
     - **活跃挂起 Task >= 2**：进入 Focus 专注版 + 右上角显现 Mini 任务胶囊；
     - **活跃挂起 Task = 0**：精准记忆恢复（恢复至关闭/最小化前的原界面）；
   - **界面1：初始界面-详细版 (`detailed`)**：包含沉浸式标题栏、居中品牌 Logo 组（徽标+标题+副标题）、手绘齿轮设置按钮、输入框内部功能按钮（导入图标、清空按钮、手绘发送图标与快捷键动态示意框）及底部动态手绘历史讯息方框抽屉（纯净展示已沉淀的历史对话，点击无缝滑入 Flow 恢复查看）；输入框内置灵感格言跑马灯引擎，当格言文本长度超过输入框宽度时，自适应启动从右向左无缝循环滚动，用户输入或存在附件胶囊时瞬时隐去；支持多行换行与高度自适应（换行自动增加高度，最大容纳 16 行，超出高度自动出现极简滚动条；左侧「导入文件」按钮换行后始终位于第一行，起到首行缩进视觉效果），右侧展示手绘发送图标与当前模式按键示意框（`[发送图标] Enter` 或 `[发送图标] Ctrl+Enter`，点击示意框亦可直接发送）；
   - **输入框文件拖入、手绘概述胶囊与多模态智能反馈 (`File Drag & Drop, Overview Capsules & Multimodal Adaptation`)**：
     - **文件拖入与选择**：全窗口仅标题栏拖拽移动窗口；支持直接将图片（png/jpg/webp/svg 等）与文档（docx/pdf/txt/md/代码等）拖入输入框，或点击输入框左侧手绘「导入」图标选择文件；拖入时输入框呈现手绘草图虚线微呼吸发光；
     - **概述胶囊呈现 (Overview Capsule)**：在输入框内以手绘微边框胶囊展示（区分图片/文档/代码内联手绘矢量图标、文件名省略截断、悬浮绝对路径 Tooltip、手绘「×」移除按钮）；多个胶囊横向平滑排列，支持 Esc / 清空按钮一键清空；
     - **上下文绝对路径注入**：发送提问时将文件的本地系统绝对路径注入至上下文（结构化附件标注），并在 Flow 提问卡片中展示手绘附件徽章；
     - **方向键上下翻阅历史输入记录 (`Prompt History Navigation & Draft Preservation`)**：聚焦输入框时，按 `ArrowUp` 向上回溯更早的历史提问，按 `ArrowDown` 向下回溯较新的历史或恢复草稿；首次向上翻阅前自动暂存当前未提交的输入内容为草稿（`draft`），翻回底部无缝还原；切换历史记录后光标自动定位至文本末尾，并同步联动跑马灯与清空按钮显隐；每次发送提问自动压栈，并在冷启动与运行态下直通 Pi 原生底层目录（`~/.pi/agent/sessions/*.jsonl`）自动提取全部真实历史提问与 `conversationHistoryService` 双向去重同步（即使在终端 CLI 产生的提问也能在桌面端无缝上下翻阅）；
     - **多模态反馈自适应处理**：
       - 情况 1（正常输出）：模型支持多模态，正常流式输出与思考；
       - 情况 2（不支持多模态且有插件）：自动通过本地插件或文本解析提取为结构化字符串并重新输入模型；
       - 情况 2（不支持且未安装插件）：正常输出模型报错信息，并在手绘卡片中追加「💡 建议：当前模型不支持多模态，可前往安装推荐 Pi 扩展组件」手绘提示框与一键直达按钮。
   - **历史对话沉淀与讯息方框交互 (`Sketch Messages Drawer & MRU Flow Recovery`)**：
      - Flow 界面完成的对话在生成结束（agent-end / agent-error / abort）、右键退出及窗口关闭生命周期（beforeunload / pagehide）时即时自动沉淀完整多轮快照（`turns` 数组）至业务记忆服务（`conversationHistoryService`），与后台 Task 解耦并双向绑定 Conversation ID，确保多轮对话实时持久化，随时关闭重启软件后点击历史记录均能 100% 完整无损还原所有多轮提问、思考折叠链、工具日志与回答；
     - 详细界面输入框下方常态展示第 1 行（最多 3 个讯息方框，根据实际标题文本长度动态分配框体宽度比例，并添加补正使最大比例不超过 1:2，内部标题与时间自适应省略号收缩）；鼠标悬浮时绝对定位向下平滑展开（消除界面整体上移），下方每行（4个，按标题文本长度动态比例自适应平铺对齐，单行内比例不超过 1:2，严格 minmax(0, wfr) 杜绝最右侧框体越出边界）延迟 1 秒依次级联渐出（每行耗时 1 秒从透明至完全显示，第 2 行 0s~1s, 第 3 行 1s~2s, 第 4 行 2s~3s...）；鼠标移出范围时触发 2 秒平滑渐隐（耗时 2 秒从完全显示平滑淡出至完全透明，随后收起），高度自适应当前软件框体裁剪，逐行动态检测若当前行显示后高度会超过界面底部则到此为止、不再显示后续行，超出高度自动隐藏不溢出；并在窗口尺寸发生变化时自适应重算行数；
     - 讯息按最近“浏览/点开”时间（MRU `lastViewedAt`）降序排列，条目需“左键双击”或“同一框体内左键连续两次单击”（第一次点击呈现手绘草图动态“圈中”特效，鼠标移出框体自动消失并重置计数，移回需重新点两次）触发恢复提问、思考折叠链、工具调用与回答至 Flow 模式，并即刻刷新时间戳重排至首位；
     - 讯息方框悬浮在右上角显现手绘「×」关闭按钮，点击仅在 UI 中隐藏该条目（保留底层会话文件与持久化数据）；
     - 提供标准业务记忆接口层，预留随时挂载 Pi 官方/社区 Memory 扩展（`pi-memory` / NPM 组件）的插件钩子。
   - **界面2：初始界面-专注版 (`focus`)**：单击输入框自动进入，仅保留居中手绘 $\pi$ Logo 徽标与纯净输入框（保留格言跑马灯、多行换行自适应与按键示意框能力），隐藏所有按钮与副标题；右上角展示 Mini 任务胶囊；右键回退至界面1；
   - **界面3：Flow 流式交互版 (`flow`)**：回车触发真实 Pi RPC 下发与流式通信，手绘 Logo 移至最左上方；在用户提问卡片下方与思考过程卡片上方，在成功注入运行态技能时展示一行手绘草图“胶囊（Capsule）”标签（如 `已注入运行态技能: windows-bash-compatibility`）；主体区域展示思考过程卡片（最新一轮默认展开、限高滚动、随输出触发自动收起、可手动折叠、含步骤与实时耗时）、工具调用卡片（可折叠日志）与 Agent 回答卡片（Markdown 排版，无冗余头部胶囊），输入框移至最下方并自适应拉长，输入框右侧提供显式手绘「⏹ 中止」按钮；**模型自动重连切换自愈流水线 (`ModelFailoverEngine`)**：当勾选「自动重连切换」且模型调用返回瞬态错误（429/5xx/网络类）时自动按 2/4/8s 退避重连（上限 24 次），返回永久错误（401/404/额度不足等）时按白名单 MRU 顺序自动切换模型并重发——全程不渲染错误卡、不提前归档历史、临时切换不刷新 MRU，仅候选成功输出后转正常切换并持久化；过程中在用户提问卡与思考卡之间展示手绘「自动重连中 n/24 · Xs 后重试 / 正在自动切换至 X」进度胶囊，成功时淡出「已恢复连接」或「已自动切换至 X · 已记入最近使用」，全部失败恢复原模型并渲染错误卡附自愈摘要；「⏹ 终止」与侧边栏任务终止可随时取消流水线；**多段对话顶部悬浮当前提问提示 (Flow Floating Question Tip)**：当思考/输出内容超长溢出屏幕高度触发滚动条后，当前轮次提问以手绘窗体样式始终悬浮吸附于对话区域顶部、靠左对齐，纯提醒无任何鼠标行为（`pointer-events: none`，未溢出时自动隐藏，流式增长/折叠/多轮追加/窗口缩放时自动刷新）；**多段对话按滚动位置锚定切换 (Turn Anchoring)**：视口顶边定位于第 N 段至第 N+1 段对话之间时，顶部提示自动切换显示第 N 段对话的提问文本；**多段对话右侧上下轮次定位导航 (Flow Turn Navigation)**：当对话轮次 ≥ 2 时，在 Flow 内容区**右侧外部**（窗体内右边距处，垂直方向由 JS 动态对齐 Flow 内容区底部）纵向显现手绘「上 / 下」按钮——每轮定位到「该轮最终输出内容」的顶部并对齐显示窗体顶部；「上」在鼠标弹起时按两段式优化定位（视口顶边距当前轮最终输出顶部 ≤ 100px 或处于其上方思考/提问区时，回退定位到上一个对话的最终输出顶部；已深入当前轮最终输出内部时，先定位到当前轮最终输出顶部，再逐级向上回退），「下」在鼠标弹起时定位到下一个对话；锚定与定位同源，可连续多次点击逐轮定位；长按「下」满 1.5 秒**立即**定位到会话最底部（无需弹起，伴随由左至右背景填充及轻微抖动动画）；所有定位效果仅在鼠标弹起时响应（按下后移出按钮再弹起不生效），并联动顶部悬浮提问提示锚定段刷新；**支持同一工作流多轮连续对话 (Multi-turn Continuous Workflow)**：在 Flow 交互界面内的后续提问均保留在同一工作流（同一个 Flow 会话与底层 SessionHost 进程），历史各轮提问、思考折叠链、工具卡与回答卡依次在上方按顺序固化保留，最新轮次动态追加在最下方并联动滚动；**运行中提交拦截与「终止并发送」流水线 (Mid-stream Submit Intercept & Interrupt-Send)**：当当前轮处于运行态（思考/流式输出/工具执行）或待确认（paused）时用户提交输入，一律弹出手绘确认弹窗（「终止并发送」危险操作 /「等待完成」）——选择「等待完成」原样保留输入不发起请求；选择「终止并发送」先取消在途自愈流水线、注册结算监听（`waitForTurnSettled`，agent-end/agent-error 按 taskId 过滤 + 6s 超时兜底）、向后端同一 SessionHost 下发 `abort`，等待旧轮真正结算（agent-end / agent-error / 超时）后才开启新轮次 DOM 并下发新 prompt（abort 指令先行入 stdin FIFO）；结算期 `interruptSendTaskId` 与 `task.pendingInterruptSend` 双守卫抑制 agent-end/agent-error 的收尾、归档、错误卡渲染与 Task 提前置终态，旧轮仅标记为 aborted（头部耗时位定格「已中断」）——彻底杜绝旧轮流式残留混入新轮、状态错乱与历史脏快照；结算期间任务被挂起/切换则丢弃本次发送并回填输入；右键无感后台挂起并回退至界面2；
   - **界面4：项目设置独立全屏页面 (`settings`)**：
     - **非浮窗独立视图与 5 大 Tab 导航**：包含「常规」、「模型配置」（整合当前模型列表与折叠式官方/自定义通道配置）、「内核」、「会话记录」及「工作区」（多预设工作区模板→运行时副本切换，含当前工作区卡片与预设列表、运行时路径、切换确认）；右上角操作指引提示条（“提示：在任意位置点击鼠标右键或按 Esc 即可快速回退”）在进入设置视图后 3 秒自动平滑渐隐；
     - **应用全局配置持久化 (`~/.pi-dl/config.json`)**：主题色（跟随系统/浅色/暗色）、默认思考推理深度（Thinking Level）、发送与换行逻辑（`sendShortcut`: `enter` [Enter发送/Ctrl+Enter换行] 与 `ctrlEnter` [Ctrl+Enter发送/Enter换行]）、默认选中模型及模型顺序、**自动重连切换开关（`autoReconnectSwitch`，默认开启）与模型自愈推荐参数块（`modelFailover`：`maxReconnectAttempts: 24` / `reconnectBackoffMs: [2000,4000,8000]` / `maxBackoffMs: 8000` / `perCandidateReconnectBudget: 2` / `escalateToSwitchAfterReconnectExhausted: true` / `switchOnPermanentError: true`）**等统一持久化保存至用户目录下的 `~/.pi-dl/config.json`（若目录不存在则自动递归新建）；
     - **几何工程与纯净配色**：**配色与主界面统一，全面避免鲜艳饱和色，统一使用低饱和度功能色；严格减少层叠 Panel 卡片与胶囊 Tips，外层采用标准边框（`var(--sketch-border-subtle)`）包裹，内部使用透明背景**；
     - **模型配置 (MRU 自动排序、首位选中固定、激活锁定与折叠式通道抽屉)**：
       - **「模型配置」标题右侧内置手绘草图质感「自动重连切换」Checkbox（默认勾选，持久化于 `~/.pi-dl/config.json`）**：勾选后 Flow 流程中的模型调用错误进入全自动自愈流水线——瞬态错误（429/5xx/网络类）按 2/4/8s 退避自动重连（上限 24 次，同 Turn 复用重发相同输入、绝不提前渲染错误卡与归档历史）；永久错误（401/404/额度不足等）按白名单 MRU 顺序自动切换模型并重发，临时切换仅 `pi_set_model` 绝不刷新「最新使用时间标识」，候选成功输出后才转正常切换（`saveSelectedModel` + MRU 置顶持久化）并展示「已自动切换至 X · 已记入最近使用」成功胶囊；全部失败则恢复原模型并复用既有错误卡（附自愈摘要「已尝试重连 N 次 / 已依次尝试 N 个模型后仍失败」）；
       - 模型列表限制最大高度（240px）与极简滚动条，**第一行始终固定为当前激活选中的模型（锁定且禁止删除）**；新增模型自动插入在当前选中模型之后（index 1），绝不挤占首位；选用任一模型即自动移至首位生效；从当前模型列表移除模型、新增模型或展开对应通道抽屉时，自动联动刷新官方通道与自定义通道中已挂载模型的按钮状态（无缝恢复「+ 添加到当前列表」）；
       - 列表下方集成「官方通道配置 - 展开」与「自定义通道配置 - 展开」（统一复用下拉框手绘 `ic_chevron_down.svg` 矢量微箭头）操作栏，默认处于隐藏状态；
       - 点击展开任一通道配置后，模型列表自动折叠仅显示当前生效的选中项，按钮动态切换为「收起」（微箭头平滑旋转 180° 朝上）与通道切换按钮，支持自由切换通道与一键收起恢复；大通道抽屉展开时自动平滑滚动到底部，内部卡片操作（新增模型、修改运营商配置、编辑模型等折叠表单展开及在线拉取列表）时通过 `scrollElementIntoViewBottom` 智能平滑定位至当前聚焦框体的底部，彻底杜绝内容越出画面；
     - **官方通道配置与动态模型拉取**：支持 Anthropic, OpenAI, DeepSeek, Google Gemini, OpenCode Zen, OpenCode Go, OpenRouter 等官方通道，API Key 自动映射写入 `~/.pi/agent/auth.json`，并支持点击「从官网拉取最新模型」实时连通官方 API / Pi 内核自省拉取最新模型，并持久化缓存至 `~/.pi-dl/official_models_cache.json`，支持一键添加至当前模型列表；
     - **两步式自定义通道配置与规范吸附**：
        - 第一步：新增/配置运营商（Provider ID、接口协议[含 `openai-completions`、`openai-responses` 等]、Base URL、API Key 及 developer role / reasoning 兼容参数），保存成功后自动切换至「步骤 2」并平滑滚动到底部；
        - 第二步：在运营商卡片内**支持一键修改运营商配置**、新增/编辑挂载模型（Model ID、显示名称、Context Window、Max Tokens、Reasoning），自动映射写入 `~/.pi/agent/models.json` 并添加至“当前模型列表”。**新增模型表单内置手绘「获取模型列表」按钮，点击实时连通该运营商端点（如 `/models`、`/v1/models`、`/api/tags`）拉取在线可用模型，并将 Model ID 智能推荐列表更新覆盖为该运营商在线模型列表并即刻弹出手绘浮层供一键选择填入（覆盖原表单全部字段）；不同运营商的表单预设与填表记忆严格跟随运营商（`model:<provider_id>` 独立作用域隔离）；输出上限输入任意数字在按回车、失焦或保存时自动吸附匹配最接近的标准 Token 规范值**；
     - **内核与扩展组件管理 (`Package Catalog & Kernel Runtime`)**：顶部展示底层 Pi 内核生命周期状态、软件版本与一键重启/更新检查；下方连通 Pi 官方组件目录，支持按名称、类型（extension/skill/theme/prompt）与热度排序检索，提供已安装组件折叠面板、手绘草图质感安装/更新/卸载实时多阶段进度条反馈、一键安装、更新比对与卸载管理。
5. **手绘 SVG 矢量图元规范（全域消除默认 Emoji）**：
   - 全项目禁止使用系统默认 Emoji 表情符号，所有功能图标与提示图标统一在 `src/assets/svg/` 归档并以内联手绘 SVG 形式呈现；
   - 所有 SVG 矢量图标统一采用 `currentColor`，深度适配浅色（Warm Oatmeal Paper）与深色（Charcoal Blackboard）双模主题；
6. **按钮设计与交互铁律（常态透明、常态无边框、悬浮显框）**：
   - 严禁违背轻量纸质美学，主界面所有新增按钮常态下背景必须透明（`background: transparent`）；
   - 常态下严禁显示可见边框，必须采用 `border: 1px solid transparent;` 保持 1px 几何占位，彻底杜绝悬停时因 border 显现引起界面抖动与重排（Layout Shift）；
   - 仅在鼠标悬浮（`:hover`）或键盘聚焦（`:focus-visible`）时显现手绘边框（`border-color: var(--sketch-border-subtle)` / `var(--sketch-border)`）与微背景；
7. **隐藏式极简滚动条规范 (Minimal Slim Hidden Scrollbar)**：
   - 全局消除浏览器默认上下箭头按钮与滚动槽（`::-webkit-scrollbar-button { display: none; }`、`::-webkit-scrollbar-track { background: transparent; }`）；
   - 常态下为 4px 极窄竖条（隐匿且不遮挡内容），采用半透明 `var(--sketch-border-subtle)`（透明度 0.45）；
   - **内容区 hover 不高亮**：鼠标悬浮于可滚动内容主体区域时保持静默不高亮；仅当鼠标真正移入滚动条轨道/滑块本身范围时（`::-webkit-scrollbar:hover` / `::-webkit-scrollbar-thumb:hover`），滑块才展开至 6px 并高亮至深墨/粉笔白（`var(--ink-primary)`）；
8. **手绘草图质感自定义下拉框规范 (Sketch Select Pop & Shake)**：
   - 封装 `SketchSelect` 统一增强原生 `<select>`，彻底消除系统原生 Native Popup 的破相与无动画问题；
   - **弹出微抖动动效（Pop & Micro-Shake）**：展开时在 180ms 内轻快弹出并伴随极微小自然回弹倾角过冲（`-0.6deg` ➔ `+0.35deg` ➔ `0deg`），迅速触发且绝不油腻；
   - 边框、底色、字色与手绘微箭头深度适配暖纸墨水与炭黑粉笔双模主题，并在底层双向 100% 保持与原生 `<select>` 数据与事件同步；
9. **手绘草图质感自定义填表与智能联想引擎规范 (Sketch AutoFill & Smart Suggestions Engine)**：
   - **全域消灭浏览器原生填表与变色破相**：全量表单输入框严格声明 `autocomplete="off"`、`autocorrect="off"`、`autocapitalize="off"`、`spellcheck="false"`；在 CSS 中覆盖 WebKit `:-webkit-autofill` 伪类，使用 `box-shadow` 内阴影阻断黄色/浅蓝变色，深度自适应 Warm Oatmeal Paper（浅色）与 Charcoal Blackboard（深色）双模主题；
   - **手绘浮层与 180ms 快速回弹动效**：继承 `SketchSelect` 设计规范，边框采用 `1.2px solid var(--sketch-border)`，微阴影 `var(--sketch-shadow-hover)`，180ms 快速回弹弹出微抖动动效（`sketchDropdownPopShake`）；
   - **运营商与模型海量预设与全表智能联动**：内置 SiliconFlow、DeepSeek、Ollama、OneAPI、VolcEngine、OpenRouter、Groq、DashScope、Zhipu、Moonshot、MiniMax、StepFun、vLLM、LM Studio、Together AI 等丰富预设；选择任一运营商自动联动预填 Provider ID、协议（同步联动 `SketchSelect`）、Base URL、Dev-Role 及 Reasoning 推荐开关；在运营商卡片内新增模型时智能推荐适配模型并一键预填显示名称、上下文、最大输出 Tokens 及推理开关；
   - **填表历史记忆沉淀与快速模糊检索**：自动将用户成功保存的运营商、模型及 URL 沉淀至 LocalStorage 历史池，以 `[历史]` 徽章优先置顶，支持键盘 ↑/↓ 切换、Enter 选中填入及 Esc / 全域右键 (Step Back) 收起；
10. **手绘草图质感模态弹窗系统规范 (SketchModal Center Dialog Pattern)**：
    - **全域彻底消除 Web 原生弹窗与 Emoji**：全面禁止使用浏览器原生 `window.alert()` / `window.confirm()` / `window.prompt()` 与系统 Emoji；
    - **软件框体绝对中心定位与毛玻璃遮罩**：模态弹窗严格固定在软件视口正中央（`position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;`），背景使用半透明暗化与毛玻璃高斯模糊遮罩（`backdrop-filter: blur(4px)`）；
    - **手绘草图框线与 180ms 微抖动动效 (Pop & Micro-Shake)**：卡片框体采用 `1.4px solid var(--sketch-border)` 与不对称有机圆角（`border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;`），弹出时在 180ms 内快速展开并伴随自然轻微倾斜过冲回弹（`sketchModalPopShake`）；
    - **全域右键 (Step Back) 优先拦截与无障碍键盘流**：弹窗激活时，鼠标右键点击任意位置或按 Esc 立即取消/关闭弹窗并消耗拦截回退事件（绝不穿透至下层视图或触发视图切换）；Enter 键快速确认，内置焦点管理与键盘 Tab 循环陷阱（Focus Trap）；
    - **语义化类型与双模主题自适应**：封装 `sketchAlert`、`sketchConfirm`、`sketchPrompt`，支持 `info`、`success`、`warning`、`error`、`confirm` 手绘矢量 SVG 图标（`currentColor` 与低饱和度语义颜色），确认按钮遵循常态透明无边框、悬浮显框及危险操作（删除/卸载）红色预警微交互；
11. **系统托盘、后台生命周期与单实例互斥铁律**：
    - **单实例运行与防重复启动**：集成 `tauri-plugin-single-instance` 单实例互斥机制，软件同时只能启动一个实例。检测到重复启动时新实例直接退出返回，并自动唤醒、取消最小化并置顶聚焦已存在的应用主窗口；
    - **右上角关闭为后台休眠**：点击右上角关闭按钮或触发系统关闭请求（如 `CloseRequested`）时，统一通过 `window.hide()` 隐藏窗口，保持后台进程与右下角系统托盘图标驻留；
    - **系统托盘交互与菜单**：
      - **左键单击 / 双击**：唤醒、取消最小化并置顶聚焦主窗口；
      - **右键菜单**：提供 `打开`（唤醒并聚焦窗口）、`设置`（唤醒窗口并派发设置事件）、`退出`（调用 `app.exit(0)` 彻底杀死后台完全退出应用）。
12. **Pi 进程与数据交互六大子系统规范**：
    - **`pi_runner & host_pool` (进程监督、生命周期与多任务监管池)**：集成 Win32 Job Object 孤儿进程自动收割、多进程监管池（`PiHostPool` / `SessionHost` 支持 `MAX_CONCURRENT_TASKS = 3` 最大并发保护与 `--session-id <taskId>` 独立子进程隔离，并在事件中注入 `task_id` 实现多任务并发与事件精准路由）、严格 LF (`\n`) 字节流分帧器、滑动窗口崩溃抑制（30s 内超 2 次熔断告警）、内核多层自适应寻址管道（`PI_BINARY_PATH` > 用户一键更新内核目录 `~/.pi-dl/kernel/pi-windows-x64/` > 源码工作区 `.mytools` > Release 目录 `exe_dir` > 安装包资源 `resource_dir` > 系统 `PATH`）、Release 安装包内置内核资源自适应寻址（`bundle.resources` / `resource_dir`）、**多预设工作区「模板 → 运行时副本」双轨模型**（内置预设为只读模板，打包进资源目录并与 `default-area` 同级；运行时为可写用户副本 `~/.pi-dl/workspaces/<id>/`，首次选中整目录复制、已存在绝不覆盖；`default-area` 保持 `~/.pi-dl/default-area` 旧路径零迁移零覆盖；`workspace` 模块负责预设发现/运行时物化/`config.json` 的 `workspace.activeId` 读写；`PiSupervisor::resolve_workspace()` 解析优先级为 `PI_WORKSPACE` 环境变量 > `custom_workspace` 运行时覆盖 > 配置文件 `workspace.activeId` > 兜底 `~/.pi-dl/default-area`；`SessionHost::start()` 在创建时传入当前生效工作区路径并锁定 CWD，修复切换后新任务仍锁 default-area 的缺口）；
    - **`config_manager` (配置管理与目录映射)**：负责 `~/.pi/agent/` 目录下 `auth.json`、`models.json`、`settings.json` 的双向读写映射、官方可用模型目录拉取与模型白名单持久化；并支持 `pi_apply_model_failover_preset` 探测式向内核 `settings.json` 注入自动重连推荐配置（`retry.maxAttempts: 24` / `backoff: [2,4,8]` / `maxBackoffSeconds: 8`，best-effort 失败静默，绝不覆盖用户已自定义的 `retry` 配置，也不阻断桌面引擎）；
    - **`package_manager` (组件目录检索、一键安装/卸载与版本更新、插件默认配置预设与推荐插件一键安装/一键全部更新)**：连通 Pi 官方 Package Catalog (pi.dev/packages)，基于轻量正则 HTML 解析与 15min TTL 缓存提取结构化组件信息；读取 `~/.pi/agent/settings.json` 与 `node_modules` 精确探测本地已安装组件及版本；调用 `pi install/remove npm:<pkg> -a` 执行非阻塞安装与卸载；内置全局单任务互斥锁（Mutex）与前端 FIFO 异步任务队列，支持连续点击加入队列并自动按序出队执行，杜绝并发冲突；支持排队状态精准感知（更新任务显示绿墨色「更新排队中」、卸载任务显示红色「卸载排队中」并支持点击取消排队）；检测到待更新组件 >= 2 时在「检查组件更新」左侧动态显现手绘「一键全部更新」按钮；接入 `ProgressStepper` 平滑步进引擎（阶段等待期间每 2s 自动 +1% 直到下个阶段 - 1%，新阶段触发立即跳变响应）；并发查询 npm registry API 进行 SemVer 版本比对与一键更新；内置 **插件默认配置预设映射系统 (`presets.json` 编译内嵌)**：支持包名别名匹配与目标配置文件智能写入校验；当软件触发组件安装时，自动检测并应用命中的推荐配置（如 `pi-web-access` 自动写入后台静默搜索与自动摘要模式 `workflow: auto-summary, autoOpenBrowser: false` 至 `~/.pi/web-search.json` 并回读校验）；在设置页已安装组件列表中，对存在映射但未生效的组件在「卸载」按钮左侧动态显现「推荐配置」手绘线框按钮，支持手动一键应用与校验；**内置推荐 Pi 插件列表 (`recommended-plugins.json` 编译内嵌至二进制)**，在「检查组件更新」按钮左侧集成「安装推荐插件」按钮，支持一键队列安装所有未安装的推荐插件（自动跳过已有插件，当全部推荐插件均已安装时动态自动隐藏）；
    - **`security` (安全与脱敏中间件)**：全量上行下行数据经过正则脱敏过滤器（API Key、Token 与本地私有目录自动掩码）；
    - **`version_watcher & kernel_updater` (抗抖动版本监测与一键内核更新引擎)**：启动延迟 2s 自检，6h 轮询带 ±8% Jitter 随机抖动与 15s Watchdog 超时熔断；支持“不再提醒更新”持久化（写入 `~/.pi-dl/config.json`，生效后直接跳过启动自检与后台自动轮询，不发网络请求；在设置页主动点击“检查更新”时自动重置恢复）；支持在设置页一键获取官方最新版本、折叠预览 Changelog 更新日志与提示框 8 秒自动平滑渐隐；支持流式 HTTP 管道下载与 `ProgressStepper` 平滑步进引擎（仅保留最右侧百分比，阶段等待期间每 2s 自动 +1% 直到下个阶段 - 1%，新阶段触发立即跳变响应）、支持一键取消更新（`pi_cancel_kernel_update` 安全终止下载流与清理临时文件），在 `~/.pi-dl/` 执行 staging 暂存、`--version` 预检校验、原子备份替换旧内核并热重启 `PiSupervisor`，实现零提权免安装无感热升级；
    - **`session` (并发内存会话索引与监听)**：基于 `DashMap` 并发内存缓存与 `notify` 文件监听提供毫秒级会话列表与分支树检索；
    - **`model_management & error_handling` (模型切换与异常自愈)**：支持通过 `pi_get_state`、`pi_get_available_models`、`pi_set_model`、`pi_set_thinking_level` 进行运行时模型感知与切换，`pi_set_model` 底层内置动态重载自愈管道（当因运行态新增自定义模型导致 Pi 内核报错 `Model not found` 时，自动重启 `PiSupervisor` 重新加载 `~/.pi/agent/models.json` 并无感重试切换），捕获全链路 RPC 报错并渲染手绘异常诊断卡片提供一键重试与模型切换；**内置前端 `ModelFailoverEngine`（`src/services/model-failover.js`）全自动自愈流水线**——先于友好化文案提取原始错误码分类（`extractErrorCode` / `classifyModelError`，瞬态 vs 永久），瞬态按 2/4/8s 退避同 Turn 重连 ≤24 次（`resendSameTurn` 复用缓存 Prompt 与图片 Payload、不重建提问卡、不重复压入历史），永久按白名单 MRU 顺序临时切换模型（不刷 MRU）并带单候选小额重连预算（`perCandidateReconnectBudget: 2`），候选成功才转正常切换持久化（`saveSelectedModel` + `touchModelAsRecentlyUsed`），全部失败恢复原模型并兜底 `renderErrorCard` 附自愈摘要；引擎按 `taskId` 多任务隔离、支持「⏹ 终止」取消（`cancel`）、右键后台挂起继续运行、侧边栏挂起任务展示「自动重连中/切换模型中」徽章，且自愈期间全局 `agent-error` / `agent-end` 由引擎接管结算，绝不提前渲染错误卡、归档历史或置 Task 为 error。
13. **Windows 系统通知与失焦调度铁律 (`Windows Native Toast Notification & Blur-Trigger Pipeline`)**：
    - **失焦触发铁律与原生双重锁**：仅在软件处于**失去焦点 (Blurred / Background)** 状态时才会触发通知；前端基于 `document.hasFocus()`、`window.onfocus / onblur`、`visibilitychange` 与 Tauri `window-focus-change` 进行多维校验，后端 `pi_show_notification` 叠加原生窗口句柄 `window.is_focused()` 双重锁防护，当软件处于焦点状态 (Focused) 时绝对拦截丢弃，绝不打扰用户；
    - **身份与 Logo 绑定**：启动时自动设置进程 AUMID 为 `com.pidl.desktop`，并在用户注册表（`HKCU\Software\Classes\AppUserModelId\com.pidl.desktop`）写入应用名称 `pi-dl` 与持久化手绘 Logo 图标路径（`~/.pi-dl/icons/app-logo.png`），彻底杜绝开发态（`npm run dev`）Toast 顶部被系统误显示为 `Windows PowerShell`；仅在通知左上角保留精致手绘小 Logo 标识与 `pi-dl` 应用名，文本下方保持纯净无冗余大图；
    - **人工回归立即通知与交互事件精确过滤**：仅当模型或扩展插件发出真正需要人工介入与交互确认的请求（如 `confirm`/`prompt`/`select`/`input`/`form` 等）时才在失焦时弹出 Windows 原生 Toast 通知与系统默认提示音，被动的小部件注册（`setWidget`）、状态栏更新（`setStatus`）与启动通知（`notify`）一律静默过滤，彻底杜绝冷启动与初始化阶段误弹通知；
    - **报错终止立即通知**：当模型执行异常中断、RPC 报错或发生致命错误终止时，立即弹出通知；
    - **输出完成与多任务并行调度**：若模型输出完成时仍有其他任务在并行运行（如包管理器安装/更新队列、内核升级等），暂不弹出通知；当**所有任务全部完成**后，统一弹出“所有任务已完成”通知；
    - **通知点击唤醒与 Flow 自动定位**：当用户在 Windows 桌面或通知中心点击通知时，后端通过 `on_activated` 自动唤醒、取消最小化并置顶聚焦主窗口，前端捕获 `notification-clicked` 自动退出设置全屏页、切换至该段对话的 Flow 流式交互模式并滚动定位到底部；
    - **底层架构实现**：后端基于 `tauri-winrt-notification` / `tauri-plugin-notification = "2"`（Windows 原生 WinRT Toast 通知，自带默认通知音），前端通过 `NotificationService` 结合 `document.hasFocus()`、`window.onfocus / onblur`、`visibilitychange` 与 Tauri `window-focus-change` 进行全方位交叉验证，配合并发任务池 `TaskTracker` 进行精确的任务生命周期管理。

---

## 🧭 Skills 架构体系与分层规范（严格界定）

本项目严格区分并定义了两类不同生命周期的 Skill，严禁混淆：

### 1. 项目开发级 Skills (`.agents/skills/`)
> **作用对象**：协助本项目进行源码开发、迭代、重构与调试的 AI 编码助手（如 Antigravity / Pair-Programming Agent）。指导项目开发全生命周期的工程化标准。

| Skill 名称 | 路径 | 触发与使用场景 |
| :--- | :--- | :--- |
| **`auto-compile-and-fix`** | [`.agents/skills/auto-compile-and-fix/SKILL.md`](file:///.agents/skills/auto-compile-and-fix/SKILL.md) | 任何任务或代码编写完成后触发，指导编译验证与错误自愈流程。 |
| **`sketch-drafting-ui`** | [`.agents/skills/sketch-drafting-ui/SKILL.md`](file:///.agents/skills/sketch-drafting-ui/SKILL.md) | 参考 Anthropic Research 与 Pi.dev 设计美学，指导前端 UI 简约线条、手绘/工程绘图草图风格、大范围微渐变纸质背景及系统自适应明暗双色方案。 |
| **`sketch-modal-pattern`** | [`.agents/skills/sketch-modal-pattern/SKILL.md`](file:///.agents/skills/sketch-modal-pattern/SKILL.md) | 指导手绘素描质感居中固定模态弹窗系统 (SketchModal) 的设计与交互规范（毛玻璃遮罩、Pop-Shake 微抖动、全域右键/Esc优先拦截、焦点陷阱与双模自适应）。 |
| **`craft-web`** | [`.agents/skills/craft-web/SKILL.md`](file:///.agents/skills/craft-web/SKILL.md) | Web 前端界面与代码精细化打磨、去 AI 模板味、排版色彩动效设计与交付前规范核查。 |
| **`ai-export-to-production`** | [`.agents/skills/ai-export-to-production/SKILL.md`](file:///.agents/skills/ai-export-to-production/SKILL.md) | AI 原型平台（v0/bolt/lovable/AI Studio）导出代码的生产工程化重构与规范化。 |
| **`api-integration`** | [`.agents/skills/api-integration/SKILL.md`](file:///.agents/skills/api-integration/SKILL.md) | 基于 API 接口文档规范化接入后端接口，实现类型化模块封装与三态处理。 |
| **`critical-path-debug-test`** | [`.agents/skills/critical-path-debug-test/SKILL.md`](file:///.agents/skills/critical-path-debug-test/SKILL.md) | 前端关键路径深度代码分析、状态与竞态/内存泄漏审计及标准测试报告输出。 |
| **`react-mobile-responsive`** | [`.agents/skills/react-mobile-responsive/SKILL.md`](file:///.agents/skills/react-mobile-responsive/SKILL.md) | 前端与 React 项目全站移动端/响应式适配（断点、表格、抽屉、触控防缩放）。 |
| **`svg-asset-workflow`** | [`.agents/skills/svg-asset-workflow/SKILL.md`](file:///.agents/skills/svg-asset-workflow/SKILL.md) | 指导 SVG 矢量资产存放组织、currentColor 双模主题自适应、内联使用与无障碍交互规范。 |
| **`desktop-rendering-optimization`** | [`.agents/skills/desktop-rendering-optimization/SKILL.md`](file:///.agents/skills/desktop-rendering-optimization/SKILL.md) | 桌面端与 Webview 渲染性能调优、窗口缩放白闪/黑屏排查、动画帧掉帧卡顿与重绘风暴根治规范。 |
| **`clean-code-refactoring`** | [`.agents/skills/clean-code-refactoring/SKILL.md`](file:///.agents/skills/clean-code-refactoring/SKILL.md) | 指导在桌面端（Tauri/Rust）与 Web 前端混合项目中进行逻辑去重、结构精简、样板代码消除与架构轻量化重构。 |
| **`inner-skills-injection`** | [`.agents/skills/inner-skills-injection/SKILL.md`](file:///.agents/skills/inner-skills-injection/SKILL.md) | 指导桌面端作为 Pi Agent 宿主代理时，运行态内置约束（Inner-Skills / RULES.md）的上下文强行注入架构、三态决策流水线、拓扑结构与前端反馈规范。 |
| **`settings-view-pattern`** | [`.agents/skills/settings-view-pattern/SKILL.md`](file:///.agents/skills/settings-view-pattern/SKILL.md) | 指导桌面端 (Tauri 2 + Web 前端) 中项目设置独立全屏页面（Settings View - 第 4 态独立视图）的工程化实现与交互设计。涵盖非浮窗全屏视图状态机、3 秒定时平滑渐隐指引、~/.pi-dl/config.json 应用全局配置持久化与 ~/.pi/agent/ 双层映射、当前模型列表 MRU 最近选用自动排序与锁定保护、模型配置「自动重连切换」Checkbox 与 `modelFailover` 推荐参数块持久化及内核 `pi_apply_model_failover_preset` 探测式注入、自定义模型 Token 规范智能吸附、手绘草图表单几何工程美学及全域右键/Esc 回退流水线规范。当用户提出"设置界面"、"配置页面"、"设置页写法"、"settings view"、"模型配置界面"、"持久化配置"、"设置规范"、"自动重连切换"时使用此技能。 |
| **`desktop-kernel-lifecycle`** | [`.agents/skills/desktop-kernel-lifecycle/SKILL.md`](file:///.agents/skills/desktop-kernel-lifecycle/SKILL.md) | 指导桌面端 (Tauri 2 + Rust) 作为 CLI/Agent 内核宿主时的进程生命周期管控、多环境自适应寻址、Release 安装包资源打包规范与 Windows 运行时六大踩坑归因与排查治理。当涉及"内核崩溃"、"进程反复重启"、"resource_dir"、"打包后无法运行"、"子进程黑框"、"CWD权限"、"环境变量丢失"、"JobObject"时使用此技能。 |
| **`flow-interaction-pattern`** | [`.agents/skills/flow-interaction-pattern/SKILL.md`](file:///.agents/skills/flow-interaction-pattern/SKILL.md) | 指导 Flow 流式交互界面（界面3）的核心交互逻辑实现规范：①过程框体（思考卡片/工具调用卡片）可手动折叠展开；②"当前最下方框体展开、出现下一框时自动收起"的级联自动收起流水线；③Flow 界面任意区域滚轮事件委托至最外层滚动容器；④多段对话顶部悬浮当前提问提示（含按滚动位置锚定切换）；⑤多段对话右侧上下轮次定位导航（Flow Turn Navigation，多轮 ≥ 2 显现于 flow 内容区右侧外部，定位到每轮最终输出内容顶部，鼠标弹起触发且可连续逐轮定位，长按「下」1.5 秒立即定位到底部，按下伴随背景填充与轻微抖动动效）；⑥模型自动重连切换自愈流水线（ModelFailoverEngine：瞬态错误 2/4/8s 退避重连 ≤24 次、永久错误按 MRU 自动切换模型、临时切换不刷 MRU、成功转正常切换、全部失败恢复原模型并渲染错误卡附自愈摘要、进度胶囊与事件结算时序）。当用户提出"flow界面交互"、"思考卡片折叠"、"工具调用卡折叠"、"自动收起"、"滚轮滚动"、"flow滚动条"、"卡片收起"、"悬浮提问提示"、"顶部悬浮tips"、"当前提问提示"、"上下按钮"、"轮次定位"、"多段对话优化"、"自动重连"、"自动切换模型"、"模型调用失败自愈"时使用此技能。 |
| **`sketch-form-autofill-pattern`** | [`.agents/skills/sketch-form-autofill-pattern/SKILL.md`](file:///.agents/skills/sketch-form-autofill-pattern/SKILL.md) | 指导桌面端中新增表单的规范写法、手绘草图质感自定义填表与智能联想推荐浮窗 (SketchAutoFill) 的标准用法。涵盖消灭原生填表变色、表单DOM布局、预设库挂载、全表智能联动填充、历史记忆沉淀及全域键盘与右键回退规范。当涉及"新增表单"、"表单写法"、"自定义填表"、"输入框建议"、"填表浮层"、"autofill"、"联想输入"时使用此技能。 |
| **`code-hazards-remediation`** | [`.doc/code-hazards-remediation/SKILL.md`](file:///.doc/code-hazards-remediation/SKILL.md) | 针对项目全量代码健康度检查中定位的已知隐患矩阵（H1~H24）进行故障排查与自愈。当系统出现异常、挂死、数据丢失或性能瓶颈时，参照此隐患列表快速定位根因；一旦命中了某条隐患并完成修复，即从列表中剔除核销，直至所有已知隐患清零。 |


### 2. 应用内置运行态约束级 Inner-Skills (`src-tauri/inner-skills/`)
> **作用对象**：桌面应用被用户运行（Runtime）时，作为 Pi Agent 的可视化宿主/代理，由 Rust 后端监督器（`PiSupervisor` & `InnerSkillInjector`）在每次下发 Prompt/FollowUp 时进行智能嗅探与动态强行注入。

- **`RULES.md` 映射总纲**：位于 [`src-tauri/inner-skills/RULES.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/RULES.md)，作为工具到运行态 Skill 映射关系的**唯一事实来源（Single Source of Truth）**，采用极简纯英文（< 80 Tokens）定义映射矩阵与 5 大执行铁律；
- **两阶段动态映射与即时触发体系**：
  1. **阶段一：背景持续静默注入 (`RULES.md` Silent Baseline)**：每轮提问透明封入精炼纯英文 `<runtime_context_rules>`（`RULES.md` 原文），静默无扰，常规问答不显现 UI 胶囊；
  2. **阶段二：动态映射解析与即时激活呈现 (Just-In-Time Skill Feedback)**：Rust 引擎动态解析 `RULES.md` 矩阵生成映射表；当且仅当底层 Agent 触发调用命中映射的工具（如 `bash` 命中 `windows-bash-compatibility`）时，即时在思考卡片上方呈现手绘草图胶囊；未在 `RULES.md` 映射的工具（如 `read_file`）绝不误触；
  3. **`<runtime_context_rules>` 信封隔离**：明确声明约束仅在触发工具调用时生效，保障正常对话生成的自然性。

| 文件 / Skill 名称 | 路径 | 运行态注入机制与作用 |
| :--- | :--- | :--- |
| **`RULES.md`** | [`src-tauri/inner-skills/RULES.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/RULES.md) | 纯英文运行态 Skill 映射矩阵与 5 大基础约束总览（低 Token 消耗）。 |
| **`windows-bash-compatibility`** | [`src-tauri/inner-skills/windows-bash-compatibility/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/windows-bash-compatibility/SKILL.md) | 在 Windows 环境下调用终端/Shell 工具时强行注入，约束统一采用正斜杠 `/`、强制非交互 `-y`、禁用 Pager 翻页防卡死、语法跨平台替换及 UTF-8 编码声明。 |


---

## 🗂️ 前端模块化结构速查 (Frontend Module Layout)

前端不再使用单文件 `src/main.js` / `src/styles.css` 大闭包，已按功能域拆分：

- **`src/main.js`**：唯一编排入口。只负责收集 DOM 引用（`ctx.el`）、构建共享上下文（`ctx.view` / `ctx.settings` / `ctx.flow` / `ctx.attachments` / `ctx.api`）并按依赖顺序初始化各模块；
- **`src/lib/`**：跨模块共享基础件（`dom-utils.js` HTML/CSS 转义、`icons.js` currentColor 手绘 SVG 图元、`view-constants.js` 四态常量）；
- **`src/modules/`**：按功能域拆分的 UI 业务模块（`view-mode.js`、`settings-navigation.js`、`model-panel.js`、`custom-provider-panel.js`、`kernel-panel.js`、`flow-ui.js`、`flow-stream.js`、`flow-pipeline.js`、`task-panel.js`、`packages-panel.js`、`workspace-panel.js`、`global-interactions.js` 等）。跨模块调用一律通过 `ctx.api.<fn>()`，共享状态一律收敛至 `ctx.*`；
- **`src/styles/`**：按功能域拆分的样式（`tokens.css` / `base.css` / `layout.css` / `flow.css` / `settings.css` / `packages.css` / `overlays.css` 等），`src/styles.css` 仅为 `@import` 聚合入口，新增样式必须写入对应功能域子文件；
- **`src/services/`**：与 UI 解耦的前端服务层（IPC 桥接、配置、流式客户端、任务/会话/历史/工作区等，含 `workspace-service.js`），**禁止**在 service 中直接操作 UI DOM。

> ⚠️ 修改前端时必须遵守：业务代码进 `src/modules/`，共享工具进 `src/lib/`，样式进 `src/styles/` 对应子文件；禁止把逻辑重新堆回 `src/main.js` 或 `src/styles.css`。

---

## ⚙️ 常用命令速查

- **极速编译检查（推荐首选，~1s）**：`npm run check`
- **桌面端开发运行**：`npm run dev`
- **构建测试（生成二进制，无需打包）**：`npm run build:check`
- **正式发布构建（生成安装包）**：`npm run build`
- **Rust 后端快速语法/类型检查**：`cargo check`（位于 `src-tauri` 目录）
- **多预设工作区指令**：`pi_list_workspaces`（列出预设与运行时状态）、`pi_get_active_workspace`（解析当前生效工作区）、`pi_set_active_workspace(id)`（物化副本→持久化→切换→空闲重启重锚 CWD）；保留 `pi_get_workspace` / `pi_set_workspace`（高级自定义绝对路径入口）

