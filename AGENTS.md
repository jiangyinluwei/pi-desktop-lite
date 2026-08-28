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

## 📌 核心准则二：任务完成自动编译与循环修复

每次在完成任何代码修改、功能新增、重构或配置调整后，**必须遵循自动编译闭环流程**：

1. **自动触发编译**：在结束任务前，主动运行构建/编译校验命令（如 `npm run build -- --no-bundle --debug` 或 `cargo check`）。
2. **失败自愈与循环修复**：若编译遇到错误，不得直接交付或向用户报停，必须分析错误日志、定位根因并自动修复，然后重新尝试编译，**直至编译成功（Exit Code 0）**。
3. **交付标准**：只有在编译完全通过后，方可向用户交付并输出最终回复。

---

## 📌 核心准则三：桌面端交互铁律与手势约束

本项目前端作为轻量桌面应用，**必须严格遵守以下交互铁律**：

1. **拖拽区域限制**：全窗口仅顶部约 **30px** 标题栏区域支持窗口拖拽（`-webkit-app-region: drag` / `data-tauri-drag-region`），内容主体、背景与品牌区严禁开启拖拽；
2. **焦点释放与消除高亮**：输入框高亮（focus）在点击外部空白区、非输入元素或右键点击时，必须立即失焦（`blur()`）并消除高亮；
3. **右键永远是“返回上一步/回退”与多态界面流**：
   - 全域彻底禁用浏览器默认右键菜单（`contextmenu` 拦截）；
   - 右键行为统一作为“返回上一步 (Step Back)”：
     - **四态界面层级流**：`设置全页面 (界面4: settings)` ➔ 右键立即返回进入前的原界面；`Flow 交互版 (界面3)` ➔ 右键回退至 `专注版 (界面2)` ➔ 右键回退至 `详细版 (界面1)` 并失焦；
     - **基础层回退**：详细版下优先失焦高亮组件 ➔ 清空当前输入 ➔ 触发业务回退分发。所有新功能模块必须接入 `window.__piRegisterStepBack`；
4. **AI-Agent 四大基础界面规范与独立设置页面标准**：
   - **界面1：初始界面-详细版 (`detailed`)**：包含沉浸式标题栏、居中品牌 Logo 组（徽标+标题+副标题）、手绘齿轮设置按钮、输入框内部功能按钮（导入图标、清空按钮、Enter 引导）及底部草图标签；输入框内置灵感格言跑马灯引擎，当格言文本长度超过输入框宽度时，自适应启动从右向左无缝循环滚动，用户输入时瞬时隐去；
   - **界面2：初始界面-专注版 (`focus`)**：单击输入框自动进入，仅保留居中手绘 $\pi$ Logo 徽标与纯净输入框（保留格言跑马灯与自适应滚动能力），隐藏所有按钮与副标题；右键回退至界面1；
   - **界面3：Flow 流式交互版 (`flow`)**：回车触发真实 Pi RPC 下发与流式通信，手绘 Logo 移至最左上方；在用户提问卡片下方与思考过程卡片上方，在成功注入运行态技能时展示一行手绘草图“胶囊（Capsule）”标签（如 `已注入运行态技能: windows-bash-compatibility`）；主体区域展示思考过程卡片（最新一轮默认展开、限高滚动、随输出触发自动收起、可手动折叠、含步骤与实时耗时）、工具调用卡片（可折叠日志）与 Agent 回答卡片（Markdown 排版，无冗余头部胶囊），输入框移至最下方并自适应拉长；右键中止当前 Agent 并回退至界面2；
   - **界面4：项目设置独立全屏页面 (`settings`)**：
     - **非浮窗独立视图**：作为与详细版/专注版/Flow版平级的独立全屏视图，右上角操作指引提示条（“**提示：在任意位置点击鼠标右键或按 Esc 即可快速回退**”）在进入设置视图后 3 秒自动平滑渐隐；
     - **应用全局配置持久化 (`~/.pi-dl/config.json`)**：主题色（跟随系统/浅色/暗色）、默认思考推理深度（Thinking Level）、默认选中模型及模型顺序等统一持久化保存至用户目录下的 `~/.pi-dl/config.json`（若目录不存在则自动递归新建）；
     - **几何工程与纯净配色**：**配色与主界面统一，全面避免鲜艳饱和色，统一使用低饱和度功能色；严格减少层叠 Panel 卡片与胶囊 Tips，外层采用标准边框（`var(--sketch-border-subtle)`）包裹，内部使用透明背景**；
     - **当前模型列表 (MRU 自动排序与激活锁定)**：模型列表自动按“最近选用顺序（MRU）”排序（新的在前，旧的在后），选用任一模型即自动移至首位生效；**当前正在使用中的激活模型严格锁定、禁止删除**；
     - **官方通道配置**：API Key 自动映射写入 `~/.pi/agent/auth.json`，并可拉取官方目录一键添加；
     - **两步式自定义通道配置与规范吸附**：
       - 第一步：新增/配置运营商（Provider ID、接口协议[含 `openai-completions`、`openai-responses` 等]、Base URL、API Key 及 developer role / reasoning 兼容参数）；
       - 第二步：在运营商卡片内**支持一键修改运营商配置**、新增/编辑挂载模型（Model ID、显示名称、Context Window、Max Tokens、Reasoning），自动映射写入 `~/.pi/agent/models.json` 并添加至“当前模型列表”。**新增模型时思考推理选项默认勾选；输出上限输入任意数字在按回车、失焦或保存时自动吸附匹配最接近的标准 Token 规范值**。
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
9. **系统托盘与后台生命周期铁律**：
   - **右上角关闭为后台休眠**：点击右上角关闭按钮或触发系统关闭请求（如 `CloseRequested`）时，统一通过 `window.hide()` 隐藏窗口，保持后台进程与右下角系统托盘图标驻留；
   - **系统托盘交互与菜单**：
     - **左键单击 / 双击**：唤醒、取消最小化并置顶聚焦主窗口；
     - **右键菜单**：提供 `打开`（唤醒并聚焦窗口）、`设置`（唤醒窗口并派发设置事件）、`退出`（调用 `app.exit(0)` 彻底杀死后台完全退出应用）。
10. **Pi 进程与数据交互五大子系统规范**：
   - **`pi_runner` (进程监督与生命周期)**：集成 Win32 Job Object 孤儿进程自动收割、严格 LF (`\n`) 字节流分帧器、滑动窗口崩溃抑制（30s 内超 2 次熔断告警）；
   - **`config_manager` (配置管理与目录映射)**：负责 `~/.pi/agent/` 目录下 `auth.json`、`models.json`、`settings.json` 的双向读写映射、官方可用模型目录拉取与模型白名单持久化；
   - **`security` (安全与脱敏中间件)**：全量上行下行数据经过正则脱敏过滤器（API Key、Token 与本地私有目录自动掩码）；
   - **`version_watcher` (抗抖动版本监测引擎)**：启动延迟 30s 自检，6h 轮询带 ±8% Jitter 随机抖动与 15s Watchdog 超时熔断；
   - **`session` (并发内存会话索引与监听)**：基于 `DashMap` 并发内存缓存与 `notify` 文件监听提供毫秒级会话列表与分支树检索；
   - **`model_management & error_handling` (模型切换与异常自愈)**：支持通过 `pi_get_state`、`pi_get_available_models`、`pi_set_model`、`pi_set_thinking_level` 进行运行时模型感知与切换，捕获全链路 RPC 报错并渲染手绘异常诊断卡片提供一键重试与模型切换。

---

## 🧭 Skills 架构体系与分层规范（严格界定）

本项目严格区分并定义了两类不同生命周期的 Skill，严禁混淆：

### 1. 项目开发级 Skills (`.agents/skills/`)
> **作用对象**：协助本项目进行源码开发、迭代、重构与调试的 AI 编码助手（如 Antigravity / Pair-Programming Agent）。指导项目开发全生命周期的工程化标准。

| Skill 名称 | 路径 | 触发与使用场景 |
| :--- | :--- | :--- |
| **`auto-compile-and-fix`** | [`.agents/skills/auto-compile-and-fix/SKILL.md`](file:///.agents/skills/auto-compile-and-fix/SKILL.md) | 任何任务或代码编写完成后触发，指导编译验证与错误自愈流程。 |
| **`sketch-drafting-ui`** | [`.agents/skills/sketch-drafting-ui/SKILL.md`](file:///.agents/skills/sketch-drafting-ui/SKILL.md) | 参考 Anthropic Research 与 Pi.dev 设计美学，指导前端 UI 简约线条、手绘/工程绘图草图风格、大范围微渐变纸质背景及系统自适应明暗双色方案。 |
| **`craft-web`** | [`.agents/skills/craft-web/SKILL.md`](file:///.agents/skills/craft-web/SKILL.md) | Web 前端界面与代码精细化打磨、去 AI 模板味、排版色彩动效设计与交付前规范核查。 |
| **`ai-export-to-production`** | [`.agents/skills/ai-export-to-production/SKILL.md`](file:///.agents/skills/ai-export-to-production/SKILL.md) | AI 原型平台（v0/bolt/lovable/AI Studio）导出代码的生产工程化重构与规范化。 |
| **`api-integration`** | [`.agents/skills/api-integration/SKILL.md`](file:///.agents/skills/api-integration/SKILL.md) | 基于 API 接口文档规范化接入后端接口，实现类型化模块封装与三态处理。 |
| **`critical-path-debug-test`** | [`.agents/skills/critical-path-debug-test/SKILL.md`](file:///.agents/skills/critical-path-debug-test/SKILL.md) | 前端关键路径深度代码分析、状态与竞态/内存泄漏审计及标准测试报告输出。 |
| **`react-mobile-responsive`** | [`.agents/skills/react-mobile-responsive/SKILL.md`](file:///.agents/skills/react-mobile-responsive/SKILL.md) | 前端与 React 项目全站移动端/响应式适配（断点、表格、抽屉、触控防缩放）。 |
| **`svg-asset-workflow`** | [`.agents/skills/svg-asset-workflow/SKILL.md`](file:///.agents/skills/svg-asset-workflow/SKILL.md) | 指导 SVG 矢量资产存放组织、currentColor 双模主题自适应、内联使用与无障碍交互规范。 |
| **`desktop-rendering-optimization`** | [`.agents/skills/desktop-rendering-optimization/SKILL.md`](file:///.agents/skills/desktop-rendering-optimization/SKILL.md) | 桌面端与 Webview 渲染性能调优、窗口缩放白闪/黑屏排查、动画帧掉帧卡顿与重绘风暴根治规范。 |
| **`clean-code-refactoring`** | [`.agents/skills/clean-code-refactoring/SKILL.md`](file:///.agents/skills/clean-code-refactoring/SKILL.md) | 指导在桌面端（Tauri/Rust）与 Web 前端混合项目中进行逻辑去重、结构精简、样板代码消除与架构轻量化重构。 |
| **`inner-skills-injection`** | [`.agents/skills/inner-skills-injection/SKILL.md`](file:///.agents/skills/inner-skills-injection/SKILL.md) | 指导桌面端作为 Pi Agent 宿主代理时，运行态内置约束（Inner-Skills / RULES.md）的上下文强行注入架构、三态决策流水线、拓扑结构与前端反馈规范。 |
| **`settings-view-pattern`** | [`.agents/skills/settings-view-pattern/SKILL.md`](file:///.agents/skills/settings-view-pattern/SKILL.md) | 指导桌面端 (Tauri 2 + Web 前端) 中项目设置独立全屏页面（Settings View - 第 4 态独立视图）的工程化实现与交互设计。涵盖非浮窗全屏视图状态机、3 秒定时平滑渐隐指引、~/.pi-dl/config.json 应用全局配置持久化与 ~/.pi/agent/ 双层映射、当前模型列表 MRU 最近选用自动排序与锁定保护、自定义模型 Token 规范智能吸附、手绘草图表单几何工程美学及全域右键/Esc 回退流水线规范。当用户提出"设置界面"、"配置页面"、"设置页写法"、"settings view"、"模型配置界面"、"持久化配置"、"设置规范"时使用此技能。 |


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

## ⚙️ 常用命令速查

- **桌面端开发运行**：`npm run dev`
- **构建测试（无需安装包打包）**：`npm run build:check`
- **正式发布构建**：`npm run build`
- **Rust 后端快速语法/类型检查**：`cargo check`（位于 `src-tauri` 目录）

