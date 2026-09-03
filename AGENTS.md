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
   - Web 前端修改后立即运行 `node -c <filePath>` 静态验证 AST，杜绝语法错误导致冷启动卡死与白屏。
2. **极速编译校验**：优先运行极速校验命令（如 `npm run check` 或 `cargo check`，~1 秒；涉及 Tauri 配置或底层 ABI 修改时使用 `npm run build:check`）。
3. **失败自愈与循环修复**：若校验报错，必须分析日志根因并自动修复，重新编译直至 **Exit Code 0**。
4. **交付门禁**：仅在代码冗余清理完毕、前端 AST 校验与后端编译均通过后，方可向用户交付。

---

## 📌 核心准则三：桌面端交互铁律与手势约束

本项目前端作为轻量桌面应用，**所有 UI 与交互修改必须严格遵守以下 13 项核心铁律**：

1. **拖拽区域限制**：全窗口仅顶部约 **30px** 标题栏支持拖拽（`-webkit-app-region: drag` / `data-tauri-drag-region`），内容主体、背景与品牌区严禁开启拖拽；
2. **焦点释放与消除高亮**：输入框高亮在点击外部空白区、非输入元素或右键点击时，必须立即失焦（`blur()`）并消除高亮；
3. **全域右键“返回上一步 (Step Back)”与四态界面流**：
   - 全域禁用浏览器默认右键菜单（`contextmenu` 拦截）；
   - **四态界面层级流**：`半透明侧边栏 (最高优先级)` ➔ `设置全页面 (界面4: settings)` ➔ `Flow 交互版 (界面3: 运行/暂停态转入后台挂起，已结束/中断态归档至历史)` ➔ `专注版 (界面2)` ➔ `详细版 (界面1)` ➔ 输入框失焦/清空；
   - **设置页 → Flow 定向回退 (`flowFromSettings`)**：从设置页会话记录 Tab「进入 Flow」时置 `view.flowFromSettings = true`；Flow 中右键/Esc 时若空闲/已结束，直接回退至设置页会话记录 Tab（`previousMode: VIEW_DETAILED` 钉住 `view.previous`，再右键照常回界面1）；若运行/暂停，走正常挂起通道；
   - **挂起与终止双通道解耦与终止防重连铁律**：右键/Esc 转入后台挂起（`isSuspended = true`，进入 `TaskManager`，不调用 abort）；显式「⏹ 终止」按钮彻底终止 Agent 生成并追加手动终止提示。**手动点击终止时，全链路绝对禁止触发任何模型自动重连或模型切换**；
   - **后台流式串轮过滤铁律**：挂起任务的流式事件经前台门禁 (`taskManager.isForegroundStreamTask` + `piClient.lastEventTaskId`) 在 Flow UI 层全量过滤，只入 Task 数据缓冲，绝不写入前台 Flow DOM/历史轮次；历史讯息抽屉 (`task-panel.js`) 采用签名比对 + 180ms 节流调度渲染，杜绝后台任务事件风暴导致的悬浮频闪与双击选中失效；
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
    - 对话流上下文注入：发起 Prompt / FollowUp 时透明注入 `<code_area_routing_context>`（目标绝对路径、免污染铁律与 Hub 技能清单），自动读取并注入目标路由工作区的 `AGENTS.md` / `README.md`，若命中技能映射则注入完整指令块（`<routed_project_skills>`），并在 Flow 呈现路由目标胶囊；所有注入条目（Inner-Skill / AGENTS.md / README.md / 命中技能 / 路由信封）在 Flow 会话流「路由目标项目」胶囊下方的「注入提示」信息框中集中呈现（直角简洁风格，默认收起显示「注入提示」与注入数量，点击展开完整清单；动态累积、去重）；
14. **子代理模型自动钉住与防跃升机制 (Subagents Model Pinning & Escalation Prevention)**：
    - 当启用 `pi-subagents` 扩展组件时，在软件初次启动加载、用户切换模型、或安装/更新组件时，自动将当前主模型同步写入 `~/.pi/agent/settings.json` 的 `subagents.defaultModel` 与各常用角色（`oracle`, `worker`, `reviewer`, `researcher`, `planner`, `scout` 等）的 `agentOverrides`；
    - 采用非破坏性读-合并-写回语义，完整保留其余已有配置；未启用 `pi-subagents` 时绝不产生冗余字段污染，彻底杜绝子代理角色因 high-thinking 能力画像擅自升配调用更昂贵模型（如 `deepseek-v4-pro`）造成的额外 Token 消耗；
15. **Node.js 运行环境预设检测与安装拦截引导规范 (Node.js Environment Preflight & Degradation)**：
    - **底层依赖与自适应探测**：Pi 扩展组件安装/更新与内核生态依赖 Node.js/npm 运行环境。Rust 后端通过 `pi_check_node_environment` 具备 Windows 全域 PATH 与多默认安装路径自适应极速探测能力（`node -v` / `npm -v`），无控制台黑框且带超时与非破坏性借用保护；
    - **友好拦截与一键直达**：用户在扩展组件市场安装单个组件、一键安装推荐插件、更新组件或更新/下载内核时，前端自动执行 Node.js 环境预检。未检测到环境时优雅拦截并弹出手绘风格 `SketchModal` 提示框，支持一键通过外部浏览器（`pi_open_url` / `tauri_plugin_opener`）唤起 Node.js 官方下载页面（`https://nodejs.org/`），杜绝生硬崩溃与晦涩错误；
    - **无感缓存与动态重试**：已成功检测到环境时无感缓存，未安装时每次操作自动重新探测，允许用户安装好 Node.js 后无需重启即刻继续。

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
| | **`custom-workspace-pattern`** | [`.agents/skills/custom-workspace-pattern/SKILL.md`](file:///.agents/skills/custom-workspace-pattern/SKILL.md) | 私人定制工作区拓扑、防泄密物理隔离与交付规范（触发：定制工作区/企业交付/隔离）。 |
| | **`inner-skills-injection`** | [`.agents/skills/inner-skills-injection/SKILL.md`](file:///.agents/skills/inner-skills-injection/SKILL.md) | 运行态内置约束（RULES.md）按需注入架构与流水线（触发：运行态技能/上下文注入/RULES）。 |
| **手绘 UI 与交互** | **`sketch-drafting-ui`** | [`.agents/skills/sketch-drafting-ui/SKILL.md`](file:///.agents/skills/sketch-drafting-ui/SKILL.md) | Anthropic/Pi.dev 手绘草图美学、简约线条与纸质双模主题（触发：手绘风格/工程绘图风/草图UI）。 |
| | **`sketch-modal-pattern`** | [`.agents/skills/sketch-modal-pattern/SKILL.md`](file:///.agents/skills/sketch-modal-pattern/SKILL.md) | 手绘素描居中模态弹窗（Pop & Shake、Step Back 优先拦截、焦点陷阱）（触发：模态窗/弹窗/alert替换）。 |
| | **`sketch-form-autofill-pattern`** | [`.agents/skills/sketch-form-autofill-pattern/SKILL.md`](file:///.agents/skills/sketch-form-autofill-pattern/SKILL.md) | 手绘表单规范、消灭原生变色与 `SketchAutoFill` 智能联想（触发：新增表单/自定义填表/autofill）。 |
| | **`svg-asset-workflow`** | [`.agents/skills/svg-asset-workflow/SKILL.md`](file:///.agents/skills/svg-asset-workflow/SKILL.md) | 手绘 SVG 图元规范、`currentColor` 主题自适应与内联管理（触发：SVG图标/替换图标/图标规范）。 |
| | **`flow-interaction-pattern`** | [`.agents/skills/flow-interaction-pattern/SKILL.md`](file:///.agents/skills/flow-interaction-pattern/SKILL.md) | Flow 流式交互（单行紧凑过程卡、因果时序拼接、多轮定位、模型自动重连）（触发：flow交互/思维链/轮次定位）。 |
| | **`settings-view-pattern`** | [`.agents/skills/settings-view-pattern/SKILL.md`](file:///.agents/skills/settings-view-pattern/SKILL.md) | 设置全屏独立视图（第4态）、5 大 Tab、MRU 模型排序与回退流（触发：设置界面/配置页面/settings）。 |
| **工程与治理** | **`desktop-kernel-lifecycle`** | [`.agents/skills/desktop-kernel-lifecycle/SKILL.md`](file:///.agents/skills/desktop-kernel-lifecycle/SKILL.md) | Tauri 2 + Rust 内核生命周期管控、多环境寻址与 Release 打包避坑（触发：内核崩溃/进程重启/打包）。 |
| | **`desktop-rendering-optimization`** | [`.agents/skills/desktop-rendering-optimization/SKILL.md`](file:///.agents/skills/desktop-rendering-optimization/SKILL.md) | Webview 渲染调优、缩放白闪/黑屏排查、动画掉帧与重绘治理（触发：动画卡顿/缩放闪白/掉帧/渲染优化）。 |
| | **`auto-compile-and-fix`** | [`.agents/skills/auto-compile-and-fix/SKILL.md`](file:///.agents/skills/auto-compile-and-fix/SKILL.md) | 任务完成后自动极速编译与失败自愈闭环（触发：编译校验/自动修复/构建验证）。 |
| | **`clean-code-refactoring`** | [`.agents/skills/clean-code-refactoring/SKILL.md`](file:///.agents/skills/clean-code-refactoring/SKILL.md) | 桌面端与 Web 混合架构逻辑去重、结构精简与样板消除（触发：代码精简/去冗余/重构优化）。 |
| | **`iterative-modification-hygiene`** | [`.agents/skills/iterative-modification-hygiene/SKILL.md`](file:///.agents/skills/iterative-modification-hygiene/SKILL.md) | 连续迭代代码卫生、AST 语法静态校验与防幽灵残余（触发：多次修改代码/清理冗余/代码卫生）。 |
| | **`code-hazards-remediation`** | [`.doc/code-hazards-remediation/SKILL.md`](file:///.doc/code-hazards-remediation/SKILL.md) | 全量代码健康度隐患矩阵（H1~H24）故障排查与自愈核销清零（触发：排查异常/代码隐患/健康度）。 |
| **通用前端开发** | **`craft-web`** | [`.agents/skills/craft-web/SKILL.md`](file:///.agents/skills/craft-web/SKILL.md) | Web 前端精细化打磨、去 AI 模板味、现代排版动效与规范核查（触发：优化界面/AI味太重/前端打磨）。 |
| | **`api-integration`** | [`.agents/skills/api-integration/SKILL.md`](file:///.agents/skills/api-integration/SKILL.md) | 规范化后端接口对接、类型化模块封装与加载/异常三态处理（触发：接接口/对接API/接口联调）。 |
| | **`critical-path-debug-test`** | [`.agents/skills/critical-path-debug-test/SKILL.md`](file:///.agents/skills/critical-path-debug-test/SKILL.md) | 前端关键路径深度分析、状态/竞态/内存审计与测试报告（触发：关键路径测试/debug测试/系统测试）。 |
| | **`react-mobile-responsive`** | [`.agents/skills/react-mobile-responsive/SKILL.md`](file:///.agents/skills/react-mobile-responsive/SKILL.md) | Web 与 React 全站移动端/响应式适配与触控优化（触发：移动端适配/响应式布局/手机端兼容）。 |
| | **`ai-export-to-production`** | [`.agents/skills/ai-export-to-production/SKILL.md`](file:///.agents/skills/ai-export-to-production/SKILL.md) | AI 原型平台（v0/bolt/lovable/AI Studio）导出代码生产工程化改造（触发：原型转生产/代码改造/原型上线）。 |

---

### 2. 应用内置运行态约束级 Inner-Skills (`src-tauri/inner-skills/`)
> **作用对象**：桌面端作为 Pi Agent 宿主时，由 Rust 监督器在底层工具调用时进行 Hook 嗅探并按需动态注入。

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

---

## 🗂️ 前端模块化结构速查 (Frontend Module Layout)

前端按功能域模块化解耦，严禁向入口文件堆砌业务代码：

- **`src/main.js`**：唯一编排入口。负责收集 DOM 引用（`ctx.el`）、构建共享上下文（`ctx.*`）并按依赖顺序初始化各模块；
- **`src/lib/`**：跨模块共享基础件（`dom-utils.js` 文本转义、`icons.js` 手绘 SVG 图元、`markdown-renderer.js` Markdown 渲染引擎、`view-constants.js` 四态常量）；
- **`src/modules/`**：按功能域拆分的 UI 业务模块（`view-mode.js`、`settings-navigation.js`、`model-panel.js`、`custom-provider-panel.js`、`kernel-panel.js`、`flow-ui.js`、`flow-stream.js`、`flow-pipeline.js`、`task-panel.js`、`packages-panel.js`、`workspace-panel.js`、`sessions-panel.js`、`global-interactions.js` 等）。跨模块调用一律通过 `ctx.api.<fn>()`，共享状态收敛至 `ctx.*`；
- **`src/styles/`**：按功能域拆分的样式文件（`tokens.css`、`base.css`、`layout.css`、`flow.css`、`markdown.css`、`settings.css`、`packages.css`、`overlays.css` 等），`src/styles.css` 仅为 `@import` 聚合入口；
- **`src/services/`**：与 UI 解耦的前端服务层（IPC 桥接、配置、流式客户端、任务/会话/工作区等），**严禁**在 service 中直接操作 UI DOM。

---

## ⚙️ 常用命令与工作区规范

### 常用命令
- **极速编译检查（首选，~1s）**：`npm run check`
- **桌面端开发调试**：`npm run dev`
- **构建测试（生成二进制，不打包）**：`npm run build:check`
- **正式发布构建（生成安装包）**：`npm run build`
- **Rust 后端语法检查**：`cargo check`（位于 `src-tauri` 目录）

### 多预设工作区与分层原则
- **IPC 指令**：`pi_list_workspaces`（列出预设与运行时状态）、`pi_get_active_workspace`（获取当前生效工作区）、`pi_set_active_workspace(id)`（物化副本 ➔ 持久化 ➔ 切换 ➔ 空闲重启重锚 CWD）；
- **公共预设 (`workspaces/`)**：`default-area`、`code-area`、`research-area`，随安装包公开发布，注册于 `tauri.conf.json` 的 `bundle.resources`；
- **私人定制工作区 (`custom-workspaces/`)**：专有 Agent 解决方案，作为私有资产物理隔离（`.gitignore` 保护），严禁随安装包打包，由开发者线下加密定向分发交付。
