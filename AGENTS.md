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
   - **界面3：Flow 流式交互版 (`flow`)**：回车触发真实 Pi RPC 下发与流式通信，手绘 Logo 移至最左上方，主体区域展示思考过程卡片（可折叠、含步骤与实时耗时）、工具调用卡片（可折叠日志）与 Agent 回答卡片（Markdown 排版），输入框移至最下方并自适应拉长；右键中止当前 Agent 并回退至界面2；
   - **界面4：项目设置独立全屏页面 (`settings`)**：
     - **非浮窗独立视图**：作为与详细版/专注版/Flow版平级的独立全屏视图，顶部常驻醒目导航条与操作指引：“**💡 提示：在任意位置点击鼠标右键或按 Esc 即可快速回退**”；
     - **几何工程设计**：**严格采用横平竖直、现代工程几何直角/微圆角（4px-8px）设计**，去除手绘草图不规则边框与抖动效果；
     - **当前模型列表 (白名单与拖拽排序)**：支持鼠标按住拖拽自由排序并持久化存储，**当前正在使用中的激活模型严格锁定、禁止删除**；
     - **官方通道配置**：API Key 自动映射写入 `~/.pi/agent/auth.json`，并可拉取官方目录一键添加；
     - **两步式自定义通道配置与运营商修改**：
       - 第一步：新增/配置运营商（Provider ID、接口协议[含 `openai-completions`、`openai-responses` 等]、Base URL、API Key 及 developer role / reasoning 兼容参数）；
       - 第二步：在运营商卡片内**支持一键修改运营商配置**、新增/编辑挂载模型（Model ID、显示名称、Context Window、Max Tokens、Reasoning），自动映射写入 `~/.pi/agent/models.json` 并添加至“当前模型列表”。
5. **按钮设计与交互铁律（常态透明、常态无边框、悬浮显框）**：
   - 严禁违背轻量纸质美学，主界面所有新增按钮常态下背景必须透明（`background: transparent`）；
   - 常态下严禁显示可见边框，必须采用 `border: 1px solid transparent;` 保持 1px 几何占位，彻底杜绝悬停时因 border 显现引起界面抖动与重排（Layout Shift）；
   - 仅在鼠标悬浮（`:hover`）或键盘聚焦（`:focus-visible`）时显现手绘边框（`border-color: var(--sketch-border-subtle)` / `var(--sketch-border)`）与微背景；
6. **系统托盘与后台生命周期铁律**：
   - **右上角关闭为后台休眠**：点击右上角关闭按钮或触发系统关闭请求（如 `CloseRequested`）时，统一通过 `window.hide()` 隐藏窗口，保持后台进程与右下角系统托盘图标驻留；
   - **系统托盘交互与菜单**：
     - **左键单击 / 双击**：唤醒、取消最小化并置顶聚焦主窗口；
     - **右键菜单**：提供 `打开`（唤醒并聚焦窗口）、`设置`（唤醒窗口并派发设置事件）、`退出`（调用 `app.exit(0)` 彻底杀死后台完全退出应用）。
7. **Pi 进程与数据交互五大子系统规范**：
   - **`pi_runner` (进程监督与生命周期)**：集成 Win32 Job Object 孤儿进程自动收割、严格 LF (`\n`) 字节流分帧器、滑动窗口崩溃抑制（30s 内超 2 次熔断告警）；
   - **`config_manager` (配置管理与目录映射)**：负责 `~/.pi/agent/` 目录下 `auth.json`、`models.json`、`settings.json` 的双向读写映射、官方可用模型目录拉取与模型白名单持久化；
   - **`security` (安全与脱敏中间件)**：全量上行下行数据经过正则脱敏过滤器（API Key、Token 与本地私有目录自动掩码）；
   - **`version_watcher` (抗抖动版本监测引擎)**：启动延迟 30s 自检，6h 轮询带 ±8% Jitter 随机抖动与 15s Watchdog 超时熔断；
   - **`session` (并发内存会话索引与监听)**：基于 `DashMap` 并发内存缓存与 `notify` 文件监听提供毫秒级会话列表与分支树检索；
   - **`model_management & error_handling` (模型切换与异常自愈)**：支持通过 `pi_get_state`、`pi_get_available_models`、`pi_set_model`、`pi_set_thinking_level` 进行运行时模型感知与切换，捕获全链路 RPC 报错并渲染手绘异常诊断卡片提供一键重试与模型切换。

---

## 🧭 Skills 映射

本项目定义了以下技能规范，Agent 在执行对应操作时需参考执行：

| Skill 名称 | 路径 | 触发场景 |
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

---

## ⚙️ 常用命令速查

- **桌面端开发运行**：`npm run dev`
- **构建测试（无需安装包打包）**：`npm run build:check`
- **正式发布构建**：`npm run build`
- **Rust 后端快速语法/类型检查**：`cargo check`（位于 `src-tauri` 目录）
