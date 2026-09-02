---
name: pi-desktop-overview
description: |
  Pi Desktop Lite (pi-dl) 桌面应用的完整产品定位、系统架构、四态界面体系、前端/后端核心特性与交互流水线总览。当涉及"项目概述"、"核心特性"、"功能总览"、"架构总览"、"四态界面"、"pi-desktop-lite特性"、"功能介绍"、"系统架构"、"项目设计理念"、"功能矩阵"、"桌面端特性"时按需调用此技能。
---

# Pi Desktop Lite (pi-dl) 核心特性与架构总览

本项目为基于 **Tauri 2 + 原生 Web 前端（HTML / CSS / JS）** 构建的极简手绘与工程绘图线条风格的桌面端研究与搜索应用，完全忠于 Pi 原生内核生态。

---

## 🏛️ 核心架构与设计哲学

- **忠于 Pi 原生生态**：完全复用 Pi CLI 底层会话规范（`~/.pi/agent/sessions/*.jsonl`）、配置标准（`auth.json`、`models.json`、`settings.json`）与包生态（`pi.dev/packages`）；
- **极简手绘与工程线条美学 (Sketch & Drafting)**：借鉴 Anthropic Research 与 Pi.dev 设计语言，采用 1.2~1.4px 实墨草图线框、微不对称有机圆角、柔和素描纸/炭黑黑板微质感背景，彻底消除系统原生 Emoji 与鲜艳高饱和度 AI 模板风格；
- **高性能桌面底层**：Rust (Tauri 2) 作为内核宿主与进程监督器，提供 Win32 Job Object 孤儿收割、多进程隔离监管池、单实例互斥与零提权无感热更新。

---

## ✨ 核心特性矩阵

### 1. 🤖 AI-Agent 四态核心界面系统

- **界面 1：初始界面-详细版 (`detailed`)**
  - **沉浸标题栏**：顶部 30px 拖拽区域，集成品牌徽标、手绘齿轮设置按钮；
  - **输入系统**：多行高度自适应（最高 16 行，左侧导入按钮换行保持首行缩进视觉）、跑马灯格言引擎、手绘发送按钮与快捷键动态提示（`Enter` 或 `Ctrl+Enter` 可配置切换）；
  - **方向键历史翻阅与草稿暂存 (`ArrowUp / ArrowDown Navigation & Draft Preservation`)**：聚焦输入框按方向键上下智能切换历史提问，首次翻阅自动暂存未提交草稿，翻回底部无缝恢复草稿；直通 Pi 原生会话目录提取全量历史提问并与本地去重同步；
  - **文件与文件夹拖入自动链路与手绘概述胶囊 (`Overview Capsule & Folder Auto-Linking`)**：支持各类图片、代码、文本、文档单文件拖入，或直接拖入整个代码/项目文件夹；拖入文件夹时直接生成单个文件夹概述胶囊（`category: "folder"` 与手绘文件夹 SVG 图标，不展开炸裂为逐个子文件）；所有胶囊自然排列在输入框内部上方（支持多行换行与极简滚动条，杜绝横向单行超界溢出，下方保留 100% 全宽文本输入区域）；发送时自动将解析出的全部文件/目录系统绝对路径结构化注入提示词供 Pi 原生读取与遍历；多模态反馈智能分流（支持多模态正常输出；不支持且未安装扩展时展示手绘草图建议条并提供一键直达安装）；
  - **动态历史对话讯息方框抽屉**：首行常态展示 3 个方框，鼠标悬浮绝对定位向下平滑展开（消除整体上移），下方每行 4 个依次延迟 1 秒级联渐出（每行耗时 1 秒从透明至完全显示），鼠标移出触发 2 秒平滑渐隐；自适应视口高度，MRU 最近浏览排序；条目需左键双击或同一框体内左键连续两次单击（首击呈现手绘草图动态圈中特效，移出框体自动重置消失）触发恢复 Flow 对话，悬浮「×」支持局部隐藏。

- **界面 2：初始界面-专注版 (`focus`)**
  - 单击/聚焦输入框即可自动进入，界面极简纯粹，仅保留居中手绘 $\pi$ Logo 徽标与纯净手绘输入框（保留格言自适应滚动与按键示意），彻底隐藏所有多余按钮；
  - 右上角展示 Mini 任务胶囊；右键平滑回退至界面 1。

- **界面 3：Flow 流式交互版 (`flow`)**
  - 回车触发真实 Pi RPC 下发与流式通信，手绘 Logo 优雅移至左上角；
  - 提问卡片展示手绘附件微徽章，下方在成功命中时展示运行态技能注入胶囊；
  - 主体区展示手绘时序步骤流容器（`flow-steps-container`，将思维切片与工具调用切片按「思维1-工具1-思维2-工具2...」一段一段交织拼接，单行流式刷新且常态紧凑折叠绝不自动展开，支持手动展开折叠）、工具调用切片（友好中文工具名 + running/done/failure 状态徽章）与 **Typedown 质感 Markdown 预览流式回答**；
  - **Typedown 质感 Markdown 预览渲染引擎 (`Markdown Preview & Code Copy`)**：参考 Windows 平台开源 Markdown 编辑器 Typedown 与 Typora 风格，融合手绘绘图纸与黑板双模主题，支持多级标题排版、围栏代码块（手绘语言徽标 + 一键复制代码 + 1.8s 复制成功微反馈 + 内置 JS/TS/Python/Rust/Bash/JSON/HTML/CSS/SQL 等分词语法高亮）、GFM 规范表格（对齐与横向滚动）、任务清单（Checkbox）、GitHub Callout 警示框（Note/Tip/Important/Warning/Caution）、流式未闭合标记自动容错自愈；
  - **全域 HTTP/HTTPS 超链接外部浏览器跳转 (`External Link Opening`)**：Markdown 显式链接与独立 URL 自动识别为超链接并附带手绘外部跳转微图标；全域链接点击通过 `global-interactions` 拦截与 Rust 后端 `pi_open_url`（`tauri_plugin_opener`）唤起操作系统默认外部浏览器打开，严禁在 Webview 内部跳转；
  - **模型输出结果一键保存为 Markdown (`Save Output to Desktop as Markdown`)**：在模型“正确”输出且生成完成（`agent-end` 或历史恢复且无报错）后，在回答卡片底部呈现手绘素描质感的「保存」按钮（手绘 `ICONS.save` 矢量图标）；点击一键将提问、思考折叠链与 Markdown 回答内容组装并调用 Rust 后端指令（`pi_save_markdown_to_desktop`）保存至用户桌面（自动按提问前缀与时间戳命名，如 `提问内容_20260831_131500.md`），附带打勾微动效与轻量保存成功反馈；流式进行中与报错中断时严格隐藏；
  - **多段对话顶部悬浮当前提问提示 (`Flow Floating Question Tip`)**：当思考/输出内容超出屏幕高度触发滚动条后，顶部以手绘胶囊样式始终悬浮吸附于对话区域上方、靠左对齐，纯提醒无任何鼠标行为（`pointer-events: none`，内容未溢出时自动隐藏）；
  - **多段对话按滚动位置锚定切换 (`Turn Anchoring`)**：视口顶边定位于第 N 段至第 N+1 段对话之间时，顶部提示自动切换显示第 N 段对话的提问文本；
  - **多段对话右侧上下轮次定位导航 (`Flow Turn Navigation`)**：当对话轮次 ≥ 2 时，在 Flow 内容区**右侧外部**（窗体内右边距处，垂直方向由 JS 动态对齐 Flow 内容区底部）纵向显现手绘「上 / 下」按钮——每轮定位到「该轮最终输出内容」的顶部并对齐显示窗体顶部；「上」在鼠标弹起时按两段式优化定位（视口顶边距当前轮最终输出顶部 ≤ 100px 或处于其上方思考/提问区时，回退定位到上一个对话的最终输出顶部；已深入当前轮最终输出内部时，先定位到当前轮最终输出顶部，再逐级向上回退），「下」在鼠标弹起时定位到下一个对话；锚定与定位同源，可连续多次点击逐轮定位；长按「下」满 1.5 秒**立即**定位到会话最底部（无需弹起，按下伴随由左至右背景填充及轻微抖动动画）；所有定位效果仅在鼠标弹起时响应（按下后移出按钮再弹起不生效）；
  - **原生支持同一工作流多轮连续对话 (`Multi-turn Continuous Workflow`)**：在 Flow 模式下后续提问均保留在同一会话工作流与底层 SessionHost 进程，历史各轮提问、思考折叠链、工具日志与回答在上方按序保留，最新一轮动态追加在下方，多轮对话完整沉淀；
  - **运行中提交拦截与「终止并发送」流水线 (`Mid-stream Submit Intercept & Interrupt-Send`)**：当前轮处于运行态或待确认时提交输入，弹出手绘确认弹窗（「终止并发送」/「等待完成」）——等待则原样保留输入；终止并发送则先取消在途自愈、下发 `abort` 并等待旧轮结算（agent-end/agent-error，6s 超时兜底）后才开启新轮下发新提问，结算期双守卫抑制提前归档、错误卡与 Task 提前置终态，旧轮仅标记「已中断」，彻底杜绝旧轮流式残留混入新轮；
  - **模型自动重连切换自愈流水线 (`ModelFailoverEngine`)**：勾选「自动重连切换」后，模型调用返回瞬态错误（429/5xx/网络类）自动按 2/4/8s 退避重连（上限 24 次），永久错误（401/404/额度不足等）自动按白名单 MRU 顺序切换模型并重发，全程不渲染错误卡、不提前归档历史、临时切换不污染 MRU，候选成功输出才转正常切换并持久化；过程展示手绘「自动重连中 n/24 · Xs 后重试 / 正在自动切换至 X」进度胶囊，成功淡出「已恢复连接」或「已自动切换至 X · 已记入最近使用」，全部失败恢复原模型并渲染错误卡附自愈摘要；「⏹ 终止」与侧边栏任务终止可随时取消，右键后台挂起后自愈继续运行。

- **界面 4：项目设置独立全屏页面 (`settings`)**
  - 作为与详细版/专注版/Flow版平级的独立全屏视图，整合「常规」、「模型配置」（集成当前模型列表与折叠式官方/自定义通道配置）、「内核」、「会话记录」、「工作区」5 大 Tab 导航；
  - 右上角操作指引（“**提示：在任意位置点击鼠标右键或按 Esc 即可快速回退**”）进入后 3 秒自动平滑渐隐；
  - 主界面统一配色与非嵌套线框设计（低饱和度功能色、细边框 `var(--sketch-border-subtle)`、透明底色）；
  - **会话记录 Tab (`pane-sessions`)**：基于 `pi_list_sessions` 全量内核会话元数据的前端内存过滤——硬过滤仅保留 `has_complete_turn` 会话（至少一轮「真实用户提问 → 完整回答」）+ 关键字搜索（防抖 200ms，命中 `first_message`/`session_id`/`cwd`）与 SketchSelect 时间档位筛选（全部/24h/7d/30d，按 `modified_at`），计数显示过滤后数量（如 `66/208`）；每个会话条目提供「进入 Flow」按钮，走统一 `enterKernelSessionFlow` 管线（Rust `pi_get_session_detail` 原生深度剥离 `<runtime_context_rules>` 与 `<code_area_routing_context>` 等注入信封及附件绝对路径尾注，完整解析纯净轮次 → `recordConversation` 以 `kernel_` 前缀沉淀界面1 讯息卡片 → 绑定 TaskManager → 共享渲染器 `renderTurnsIntoFlow` 还原 Flow 多轮 → 切内核会话）；「清空界面会话」按钮经 sketchConfirm 二次确认后仅清 UI 展示层（`conversationHistoryService.clearAllConversations()`），绝不删除 `~/.pi` 内核会话 JSONL 文件；程序不提供任何直接删除内核会话的能力。

---

### 2. ⚡ Flow 后台任务与多进程监管体系 (`Background Task Pool`)

- **双通道解耦与状态感知设计**：
  - **通道 1：后台挂起与状态收纳 (Background & Paused / Waiting)**：在 Flow 运行态或暂停待确认态下按鼠标右键或按 Esc，当前任务无感转入后台 `TaskManager`（`isSuspended = true`），界面回退至 Focus 专注版，顶部弹出提示条 `已转入后台运行 (Task #1)`（若为暂停待确认态附带 `[待确认]` 标识）；
  - **通道 2：显式中止 (Abort) 与手动终止提示**：在 Flow 输入框右侧显式提供手绘「⏹ 中止」按钮及侧边栏单任务中止操作，负责彻底杀死 Agent 生成；该按钮受严格视图隔离保护，仅在 Flow 运行态显现；用户主动终止时，Flow 会在对话输出结尾即时追加手绘草图风格「刚刚会话已手动终止」提示字段，并同步沉淀至业务历史会话快照中；
  - **通道 3：中断与结束归档**：在 Flow 发生模型调用错误等“中断”状态时，判定为当前轮次已结束，右键回退自动将对话沉淀快照至历史讯息抽屉（`conversationHistoryService`）并清理 Task 记录；后台 Task 发生中断时标注为「异常终止」（暗黄色徽章），发生暂停时标注为「待确认」；
- **右上角 Mini 任务胶囊 (`Mini Task Capsule`)**：常态显现 `[ ✏️ 1/3 Task ]`（分子为已完成任务数[含正常完成、异常终止、已终止]，分母为总任务数）；运行或待确认中呈现小铅笔微旋转呼吸动画（`spin-pulse`），全部完成转为实线手绘绿墨色；
- **半透明毛玻璃侧边栏 (`Task Details Sidebar & Backdrop Blur`)**：点击 Mini 胶囊滑出 320px 半透明手绘侧边栏（`backdrop-filter: blur(14px)`），主界面区域自动触发高斯模糊（`blur(4px)`）；侧边栏展示每个 Task 的模型、运行状态（「思考中」、「流式生成中」、「执行工具」、「待确认」、「异常终止」、「已终止」、「已完成」）、提问摘要与操作区（「进入 Flow」、「⏹ 中止」）；全域右键或按 Esc 优先平滑收起侧边栏并复原主背景；
- **系统托盘与单实例多态唤醒路由调度**：
  - 活跃 Task = 1：直通进入该 Task 的 Flow 交互流；
  - 活跃 Task >= 2：进入 Focus 专注版 + 右上角显现 Mini 任务胶囊；
  - 活跃 Task = 0：精准记忆恢复（恢复至关闭/最小化前的原界面）；
- **底层 `PiHostPool` 多进程监管池**：Rust 端实现多子进程生命周期管理（支持 `MAX_CONCURRENT_TASKS = 3` 最大并发保护与 `--session-id <taskId>` 独立子进程隔离，并在事件中注入 `task_id` 实现多任务并发与事件精准路由）。

---

### 3. 🧠 历史对话沉淀与业务记忆系统 (`Conversation History & Memory Interface`)

- **完整多轮快照持久化**：自动捕获 Flow 流式对话快照（完整多轮提问、思考折叠链、工具调用日志、回答与元数据），在每轮生成结束、右键回退及软件关闭生命周期时即时持久化沉淀至输入框下方讯息方框与本地存储；
- **MRU 智能排序与即时恢复**：严格按 MRU 浏览时间自动排序，条目需左键双击或同一框体内左键连续两次单击（首击呈现手绘草图动态圈中特效，鼠标移出框体自动重置消失）进入并跃升至首位，并在软件随时关闭重启后均能 100% 完整无损还原全部多轮对话到 Flow 模式；
- **独立局部隐藏**：支持悬浮「×」按钮局部隐藏（保留底层会话文件与持久化记录）；
- **扩展插件接口**：提供标准业务级记忆接口层，预留随时挂载 Pi 官方/社区 Memory 扩展（如 `pi-memory` / NPM 组件）的标准插件钩子。

---

### 4. ⚙️ 项目设置与模型配置体系 (Settings View)

- **应用全局配置持久化 (`~/.pi-dl/config.json`)**：界面主题色、默认思考推理深度（Thinking Level）、对话框发送快捷键逻辑（`sendShortcut`: `enter` 与 `ctrlEnter`）、默认选中模型及模型顺序、**自动重连切换开关（`autoReconnectSwitch`，默认开启）与模型自愈推荐参数块（`modelFailover`：重连上限 24 次 / 2-4-8s 退避 / 单候选重连预算 2 次 / 重连耗尽升级切换 / 永久错误自动切换）**等统一持久化至 `~/.pi-dl/config.json`；
- **多预设工作区「模板 → 运行时副本」双轨模型与 `code-area` 路由调度中枢 (`Multi-Workspace Presets & code-area Hub`)**：
  - 随安装包内置多套工作区模板（`default-area` 默认区、`code-area` 全局编码技能调度中枢、`research-area` 深度调研区），打包进资源目录并与 `default-area` 同级；
  - **`code-area` 路由调度中枢专享机制**：Pi 内核物理 CWD 驻留在 `code-area` 运行时目录（原生感知内置技能集），同时内设绑定「路由目标项目」绝对路径；基于 Rust `rfd` (IFileOpenDialog) 实现 Windows 原生 OpenFolder 文件夹选择器（右下角为标准的「选择文件夹」/「打开」，无网页上传提示）；支持先平滑切换再择时添加路由；未绑定时主界面输入框禁止输入（只读提示），点击输入框可直接弹出模态窗/对话框绑定路由；**存在性自动校验与失效清除**（每次切换或启动应用时，后端自动校验当前路由工作区与历史记录是否存在，不存在则自动清除）；对话流透明注入 `<code_area_routing_context>` 目标路径、免污染铁律与可用技能集清单；
  - 在设置页「工作区」Tab 可查看当前工作区（名称 + ID 徽章 + 运行时绝对路径）、路由配置卡片与全部预设列表并一键切换；
  - 首次选中时整目录复制模板到 `~/.pi-dl/workspaces/<id>/`（已存在绝不覆盖，升级不影响用户副本），`default-area` 沿用旧路径零迁移零覆盖；
  - 底层 `PiSupervisor::resolve_workspace()` 解析优先级为 `PI_WORKSPACE` 环境变量 > 运行时覆盖 > 配置 `workspace.activeId` > 兜底 `default-area`，`SessionHost` 创建任务时锁定当前生效工作区 CWD；
- **模型配置 (MRU 自动排序、首位选中固定、激活锁定与折叠式通道抽屉)**：
  - 标题右侧内置手绘草图质感「自动重连切换」Checkbox（默认勾选）；
  - 模型列表第一行始终固定为当前激活选中的模型（锁定且禁止删除）；新增模型自动插入在当前选中模型之后（index 1），绝不挤占首位；点击选用立即生效并移至首位；
  - 列表下方内置「官方通道配置 - 展开」与「自定义通道配置 - 展开」操作栏，展开时模型列表自动折叠仅显示选中项，抽屉平滑滚动到底部；
- **官方通道配置与动态模型拉取**：支持 Anthropic Claude, OpenAI, DeepSeek, Google Gemini, OpenCode Zen, OpenCode Go, OpenRouter, 通义千问 Qwen, 月之暗面 Kimi, MiniMax, Groq, xAI Grok 等官方通道，配置 API Key **自动写入 `~/.pi/agent/auth.json`**；支持点击「从官网拉取最新模型」实时拉取并持久化缓存至 `~/.pi-dl/official_models_cache.json`；
- **两步式自定义通道配置与规范吸附**：
  - 步骤 1：配置 Provider ID、接口类型（`openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`、`ollama`）、Base URL、API Key 及 developer role / reasoning 兼容参数；
  - 步骤 2：卡片内支持一键修改运营商配置、新增与编辑挂载模型。新增模型表单内置手绘「获取模型列表」按钮实时连通端点拉取模型；输出上限输入任意数字自动吸附匹配最接近的标准 Token 规范值，自动映射写入 `~/.pi/agent/models.json`；
- **内核与扩展组件管理 (`Package Catalog & Kernel Runtime`)**：
  - 顶部集成底层 Pi 内核状态监控、软件版本、一键重启内核、检查更新与**一键内核热更新**（支持流式下载进度条与 Changelog 折叠预览）；
  - 连通 Pi 官方 Package Catalog，提供已安装组件折叠面板、手绘草图质感安装/更新/卸载多阶段进度条与 `ProgressStepper` 引擎；
  - 支持一键安装、批量检查更新、单包更新、卸载、**未配置项「推荐配置」一键应用**（基于 `presets.json` 自动写入推荐配置）及**「安装推荐插件」一键队列安装**（基于 `recommended-plugins.json` 自动跳过已有插件）。

---

### 5. 🎨 手绘工程草图 UI/UX 体系

- **全域手绘工程草图 SVG 矢量图元体系**：全项目彻底清除系统默认 Emoji，统一内联 20+ 款手绘草图风格 SVG 矢量图元（`src/assets/svg/`），配合 `currentColor` 严格实现浅色（素描绘图纸）与深色（炭黑素描黑板）双模自适应；
- **按钮设计铁律**：主界面所有新增按钮常态背景透明（`background: transparent`），常态采用 `border: 1px solid transparent;` 保持 1px 几何占位防抖动，仅在 hover / focus-visible 时显现手绘边框与微背景；
- **隐藏式极简滚动条体系**：消除上下箭头与滚动槽，常态为 4px 半透明极窄竖条，悬浮内容主体不高亮，仅移入滚动条自身时展开至 6px 并高亮加深；
- **手绘草图质感自定义下拉框 (`SketchSelect`)**：封装 `SketchSelect`，展开触发 180ms 快速回弹弹出微抖动动效（Pop & Micro-Shake），双向同步原生 `<select>`；
- **手绘草图质感自定义填表与智能联想引擎 (`SketchAutoFill`)**：消灭原生填表变色（覆盖 WebKit `:-webkit-autofill`），内置 15+ 主流运营商海量预设，全表智能联动填充，沉淀用户填表历史池并以 `[历史]` 徽章置顶；
- **手绘草图质感居中模态弹窗系统 (`SketchModal`)**：彻底消除系统原生 alert/confirm/prompt，居中毛玻璃遮罩，1.4px 实墨草图线框与不对称圆角，180ms 弹出微抖动动效，全域右键 (Step Back) 与 Esc 优先拦截，无障碍焦点陷阱。

---

### 6. 🔔 桌面原生系统集成与通知调度

- **失焦 Windows 系统通知与原生双重锁**：
  - 仅在软件处于**失去焦点 (Blurred / Background)** 状态时才会触发通知，窗口聚焦操作时保持绝对静默，前端多维焦点与后端原生窗口 `window.is_focused()` 句柄双重锁防护；
  - 启动时自动设置进程 AUMID 为 `com.pidl.desktop` 并在注册表绑定应用名称 `pi-dl` 与手绘 Logo 图标；
  - 交互过滤：仅当模型/插件发出真正需要人工交互确认的请求（`confirm`/`prompt`/`select` 等）或报错终止时立即通知；常规完成等待所有并发任务全部完成后统一弹出；
  - 点击通知唤醒：点击 Windows 原生 Toast 自动唤醒窗口并无缝切换定位至 Flow 交互视图。
- **系统托盘与生命周期**：单实例互斥（重复启动自动唤醒置顶已有窗口），关闭按钮最小化到托盘常驻，托盘提供 打开 / 设置 / 退出 菜单。

---

### 7. 🛡️ 纯 Rust (Tauri 2) 后端子系统

- **`pi_runner` (进程监督与孤儿收割)**：Win32 Job Object 内核级级联收割，严格 `\n` (LF) 字节流分帧器，内核保险自动重连（全局后台检测 crashed，自动平滑重连最多 5 次、间隔 2s；5 次均失败广播 `pi:kernel-reconnect-failed` 并触发左上角红色抖动小闪电提醒），多预设工作区运行时解析；
- **`inner_skills` (运行态约束动态注入引擎)**：基于 `RULES.md` 极简映射总纲（< 100 Tokens）在每轮 Prompt 下发时透明注入 `<runtime_context_rules>` 信封；动态解析工具到 7 大独立 Inner-Skills（`windows-bash-compatibility`、`document-multimodal-inspection`、`multi-agent-orchestration`、`web-search-silent-access`、`persistent-memory-retrieval`、`dynamic-workflows-orchestration`、`active-context-pruning`），在命中工具调用时触发 Flow 界面手绘草图胶囊即时显现；
- **`package_manager` (官方组件市场与队列)**：连通 pi.dev/packages，15min TTL 缓存提取，全局单任务互斥锁与 FIFO 异步队列，ProgressStepper 平滑步进；
- **`security` (数据脱敏中间件)**：全量上行下行数据经过正则脱敏过滤器（API Key、Token 与本地私有目录自动掩码）；
- **`version_watcher & kernel_updater` (无感热更新引擎)**：启动 2s 延迟自检 + 6h Jitter 轮询，支持不再提醒持久化，流式下载 + ProgressStepper，Staging 暂存、`--version` 预检、原子备份替换与热重启；
- **`session` (并发内存索引与监听)**：基于 `DashMap` 并发内存缓存与 `notify` **递归**监听 Pi 内核真实会话根目录 `~/.pi/agent/sessions/`（内含按 CWD 命名的子目录；不存在时回退旧路径 `~/.pi/sessions`），实现毫秒级全量会话检索与分支树导航；
- **`config_manager` (配置管理与目录映射)**：双向管理 `~/.pi-dl/config.json` 及 `~/.pi/agent/` 下的 `auth.json`、`models.json`、`settings.json`。

---

### 8. 🔄 全域右键“返回上一步 (Step Back)”层级流水线

在任意位置点击右键或按 Esc 时，统一按以下层级执行单步回退：
```text
[半透明侧边栏 (最高优先级)] ➔ 平滑收起并解除主背景高斯模糊
      ↓
[设置全页面 (界面4: settings)] ➔ 返回进入前的原界面
      ↓
[Flow 交互版 (界面3)] ➔ 运行态/暂停态转入后台挂起 (Suspend)，已完成/中断态归档至历史记录，回退至界面2；特例：从设置页会话记录 Tab 进入的 Flow（`view.flowFromSettings` 标志）在空闲/已结束态右键/Esc 定向回设置页会话记录 Tab（不挂起、不归档、Flow 现场保留，且 `view.previous` 钉为界面1，再右键照常回界面1），运行/暂停态仍清标志后走正常挂起通道
      ↓
[专注版 (界面2)] ➔ 回退至详细版 (界面1) 并失焦
      ↓
[详细版 (界面1)] ➔ 优先失焦高亮组件 ➔ 清空当前输入（对输入框点击右键静默屏蔽防抖动）
```

---

## 🗂️ 前端模块化代码布局

```
src/
├── main.js                 # 唯一编排入口（收集 DOM、构建 ctx、按依赖初始化模块）
├── lib/                    # 跨模块共享基础件
│   ├── dom-utils.js        # DOM 辅助与转义
│   ├── icons.js            # currentColor 手绘 SVG 图元库
│   └── view-constants.js   # 视图常量与枚举
├── modules/                # 按功能域拆分的 UI 业务模块
│   ├── view-mode.js        # 四态视图切换状态机
│   ├── settings-navigation.js # 设置 Tab 导航
│   ├── model-panel.js      # 模型列表与 MRU 管理
│   ├── custom-provider-panel.js # 自定义运营商与模型表单
│   ├── kernel-panel.js     # 内核状态与更新
│   ├── flow-ui.js          # Flow 界面 DOM 渲染与折叠交互
│   ├── flow-stream.js      # 流式通信与事件处理
│   ├── flow-pipeline.js    # 对话流水线与中断发送
│   ├── task-panel.js       # 后台任务管理与侧边栏
│   ├── packages-panel.js   # 扩展包市场与安装队列
│   ├── workspace-panel.js  # 多工作区预设与切换
│   └── global-interactions.js # 全局右键 Step Back 与按键监听
├── styles/                 # 按功能域拆分的 CSS 样式
│   ├── tokens.css          # 色彩与手绘设计 Token
│   ├── base.css            # 基础手绘重置与滚动条
│   ├── layout.css          # 四态布局骨架
│   ├── flow.css            # Flow 对话流与卡片样式
│   ├── settings.css        # 设置页线框样式
│   ├── packages.css        # 包管理器与进度条
│   └── overlays.css        # 模态弹窗与毛玻璃侧边栏
└── services/               # 与 UI 解耦的前端服务层
    ├── ipc-client.js       # Tauri IPC 桥接
    ├── config-service.js   # 应用与内核配置读写
    ├── session-service.js  # 会话历史与快照
    ├── task-tracker.js     # 并发任务跟踪
    ├── workspace-service.js # 工作区解析与切换
    └── model-failover.js   # 自动重连与模型切换自愈引擎
```
