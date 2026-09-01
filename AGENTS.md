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

本项目前端作为轻量桌面应用，**所有涉及 UI/交互的代码修改必须严格遵守以下核心铁律**：

1. **拖拽区域限制**：全窗口仅顶部约 **30px** 标题栏区域支持窗口拖拽（`-webkit-app-region: drag` / `data-tauri-drag-region`），内容主体、背景与品牌区严禁开启拖拽；
2. **焦点释放与消除高亮**：输入框高亮（focus）在点击外部空白区、非输入元素或右键点击时，必须立即失焦（`blur()`）并消除高亮；
3. **全域右键“返回上一步 (Step Back)”与四态界面流**：
   - 全域彻底禁用浏览器默认右键菜单（`contextmenu` 拦截）；
   - **四态界面层级流**：`半透明侧边栏 (最高优先级)` ➔ `设置全页面 (界面4: settings)` ➔ `Flow 交互版 (界面3: 运行态/暂停态转入后台挂起，已结束/中断态归档至历史记录)` ➔ `专注版 (界面2)` ➔ `详细版 (界面1)` ➔ 输入框失焦/清空；
   - **设置页 → Flow 定向回退特例 (`flowFromSettings`)**：从设置页会话记录 Tab「进入 Flow」时置 `view.flowFromSettings = true`；Flow 中右键/Esc 时若空闲/已结束 → 清标志、不挂起不归档，直接回设置页会话记录 Tab（`previousMode: VIEW_DETAILED` 钉住 `view.previous`，再右键照常回界面1）；若运行/暂停 → 清标志后走正常挂起通道；`setViewMode` 对任何离开 Flow 的路径兜底清标志；
   - **Flow 挂起与终止双通道解耦**：右键/Esc 转入后台挂起（`isSuspended = true`，进入 `TaskManager`，绝不调用 abort） vs 显式「⏹ 终止」按钮彻底终止 Agent 生成并追加手动终止提示；
   - **输入框防抖**：在详细版下对着输入框点击右键时静默屏蔽，杜绝界面瞬切抖动；所有新模块均需接入 `window.__piRegisterStepBack`；
4. **手绘 SVG 矢量图元规范（全域消除默认 Emoji）**：
   - 全项目禁止使用系统默认 Emoji 表情符号，所有功能图标与提示图标统一在 `src/assets/svg/` 归档并以内联手绘 SVG 形式呈现；
   - 所有 SVG 矢量图标统一采用 `currentColor`，深度适配浅色（素描绘图纸）与深色（炭黑素描黑板）双模主题；
5. **按钮设计与交互铁律（常态透明、常态无边框、悬浮显框）**：
   - 主界面所有新增按钮常态下背景必须透明（`background: transparent`）；
   - 常态下严禁显示可见边框，必须采用 `border: 1px solid transparent;` 保持 1px 几何占位，彻底杜绝悬停时因 border 显现引起界面抖动与重排（Layout Shift）；
   - 仅在鼠标悬浮（`:hover`）或键盘聚焦（`:focus-visible`）时显现手绘边框（`border-color: var(--sketch-border-subtle)` / `var(--sketch-border)`）与微背景；
6. **隐藏式极简滚动条规范 (Minimal Slim Hidden Scrollbar)**：
   - 全局消除浏览器默认上下箭头按钮与滚动槽（`::-webkit-scrollbar-button { display: none; }`、`::-webkit-scrollbar-track { background: transparent; }`）；
   - 常态下为 4px 极窄竖条（隐匿且不遮挡内容），采用半透明 `var(--sketch-border-subtle)`（透明度 0.45）；
   - **内容区 hover 不高亮**：鼠标悬浮于可滚动内容主体区域时保持静默不高亮；仅当鼠标真正移入滚动条轨道/滑块本身范围时（`::-webkit-scrollbar:hover` / `::-webkit-scrollbar-thumb:hover`），滑块才展开至 6px 并高亮加深；
7. **手绘草图组件规范 (Sketch Components)**：
   - 统一下拉框采用 `SketchSelect`（180ms Pop & Micro-Shake 微抖动，双向同步原生 `<select>`）；
   - 表单填表统一采用 `SketchAutoFill`（消灭原生填表黄色/蓝色背景伪类变色，海量预设联动与历史记忆沉淀）；
   - 模态弹窗统一采用 `SketchModal`（居中定位、毛玻璃遮罩、全域右键/Esc 优先拦截与焦点陷阱）；
8. **系统托盘、后台生命周期与单实例互斥**：
   - 软件同时只能启动一个实例，重复启动自动唤醒置顶已有主窗口；
   - 点击右上角关闭按钮通过 `window.hide()` 隐藏至系统托盘常驻，托盘提供打开、设置与彻底退出；
9. **失焦 Windows 系统通知铁律**：
   - 仅在软件处于**失去焦点 (Blurred / Background)** 状态且需人工确认或发生中断报错时触发 Windows 原生 Toast 通知，聚焦时绝对静默；
10. **无内核运行与交互降级规范 (Kernel-less Operation & Degradation)**：
    - **无内核平稳运行**：未检测到本地或内置 Pi 内核时，程序平稳启动进入无内核待机态，禁止死循环重启；
    - **顶部状态展示**：在界面1（详细版）、界面2（专注版）与界面3（Flow 流式交互版）顶部模型标签均显现并永远显示「未检测到pi内核」，点击直达设置页内核下载面板；
    - **发送入口屏蔽**：对话框发送按钮置灰禁用（`disabled`）、输入框按键拦截并弹出友好指引；
    - **内核面板降级**：内核页状态显示「未检测到内核 / 未安装」，「重启内核」与「不再提醒更新」按钮置灰禁用，内核组件区域（已安装组件、搜索筛选与市场目录）完全隐藏；
    - **一键下载自愈**：启动时自动检测最新官方内核版本，提供「一键下载并安装」能力，安装就绪后自动拉起内核并恢复全套正常 UI。
11. **多模态文件与文件夹拖拽自动链路规范 (Folder & File Drag-and-Drop Auto-Linking)**：
    - 支持直接拖入单个/多个文件或整个文件夹到输入框与主窗口；
    - 文件夹拖入时，由 Rust 后端（`pi_inspect_paths`）直接生成单个文件夹概述胶囊（`category: "folder"` 与手绘文件夹 SVG 图标），不展开炸裂为逐个子文件；
    - 所有附件胶囊自然换行排列在输入框内部上方（支持极简滚动条与无缝换行），杜绝横向单行超界溢出，下方保留 100% 全宽文本输入区域；发起对话时自动注入系统绝对路径供 Pi 内核原生遍历读取。

> 📖 **完整功能矩阵与系统特性总览**：详见项目架构总览技能 [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md)。

---

## 🧭 Skills 架构体系与分层规范（严格界定）

本项目严格区分并定义了两类不同生命周期的 Skill，严禁混淆：

### 1. 项目开发级 Skills (`.agents/skills/`)
> **作用对象**：协助本项目进行源码开发、迭代、重构与调试的 AI 编码助手（如 Antigravity / Pair-Programming Agent）。指导项目开发全生命周期的工程化标准。

| Skill 名称 | 路径 | 触发与使用场景 |
| :--- | :--- | :--- |
| **`pi-desktop-overview`** | [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md) | Pi Desktop Lite 桌面应用的完整产品定位、四态界面体系、前端/后端核心特性与交互流水线总览。当涉及"项目概述"、"核心特性"、"功能总览"、"架构总览"、"四态界面"、"功能矩阵"、"桌面端特性"时按需调用。 |
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
| **`custom-workspace-pattern`** | [`.agents/skills/custom-workspace-pattern/SKILL.md`](file:///.agents/skills/custom-workspace-pattern/SKILL.md) | 指导面向企业客户、甲方或特定垂直领域开发与交付“私人定制工作区 (Custom / Private Workspace)”的设计规范、目录拓扑、防泄密物理隔离（`custom-workspaces/` + `.gitignore` + 严禁写入 `bundle.resources`）、5 大资产标准件、多能力组合编排与私有化线下交付流水线。当涉及"定制工作区"、"私有工作区"、"交付工作区"、"工作区模板设计"、"私有化部署"、"防泄密"时使用此技能。 |
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
- **`src/modules/`**：按功能域拆分的 UI 业务模块（`view-mode.js`、`settings-navigation.js`、`model-panel.js`、`custom-provider-panel.js`、`kernel-panel.js`、`flow-ui.js`、`flow-stream.js`、`flow-pipeline.js`、`task-panel.js`、`packages-panel.js`、`workspace-panel.js`、`sessions-panel.js`（会话记录列表、搜索筛选、进入 Flow 管线与界面会话清空）、`global-interactions.js` 等）。跨模块调用一律通过 `ctx.api.<fn>()`，共享状态一律收敛至 `ctx.*`；
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
- **公共预设 vs 私人定制工作区分层原则**：
  - **公共内置预设 (`workspaces/`)**：`default-area`、`code-area`、`research-area`，随安装包公开发布，注册于 `tauri.conf.json` 的 `bundle.resources`；
  - **私人定制工作区 (`custom-workspaces/`)**：如 `enterprise-consulting-area` 等专有 Agent 解决方案，作为私有资产物理隔离，由 `.gitignore` 保护，严禁随安装包打包，由开发者线下加密定向分发交付给客户/乙方。


