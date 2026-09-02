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
    - **对话流上下文注入**：发起 Prompt / FollowUp 时透明注入 `<code_area_routing_context>`（目标绝对路径、免污染铁律与 Hub 技能清单），自动读取并注入目标路由工作区的 `AGENTS.md` / `README.md`，若命中技能映射则注入完整指令块（`<routed_project_skills>`），并在 Flow 呈现路由目标胶囊。

> 📖 **完整功能矩阵与系统特性总览**：详见项目架构总览技能 [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md)。

---

## 🧭 Skills 架构体系与分层规范（严格界定）

本项目严格区分并定义了两类不同生命周期的 Skill：

### 1. 项目开发级 Skills (`.agents/skills/`)
> **作用对象**：协助本项目源码开发、迭代、重构与调试的 AI 编码助手。

| Skill 名称 | 路径 | 核心作用与触发场景 |
| :--- | :--- | :--- |
| **`pi-desktop-overview`** | [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md) | 产品定位、四态界面体系、前端/后端核心特性与交互流水线总览。涉及"项目概述"、"核心特性"、"架构总览"、"四态界面"时调用。 |
| **`auto-compile-and-fix`** | [`.agents/skills/auto-compile-and-fix/SKILL.md`](file:///.agents/skills/auto-compile-and-fix/SKILL.md) | 任务完成后自动编译验证与错误自愈闭环。 |
| **`sketch-drafting-ui`** | [`.agents/skills/sketch-drafting-ui/SKILL.md`](file:///.agents/skills/sketch-drafting-ui/SKILL.md) | 手绘/工程绘图草图风格（Sketch & Drafting）、简约线条、纸质背景及自适应双模主题设计规范。 |
| **`sketch-modal-pattern`** | [`.agents/skills/sketch-modal-pattern/SKILL.md`](file:///.agents/skills/sketch-modal-pattern/SKILL.md) | 手绘素描质感居中固定模态弹窗系统规范（毛玻璃遮罩、微抖动、右键/Esc优先拦截、焦点陷阱）。 |
| **`craft-web`** | [`.agents/skills/craft-web/SKILL.md`](file:///.agents/skills/craft-web/SKILL.md) | Web 前端界面精细化打磨、去 AI 模板味、排版色彩动效与规范核查。 |
| **`ai-export-to-production`** | [`.agents/skills/ai-export-to-production/SKILL.md`](file:///.agents/skills/ai-export-to-production/SKILL.md) | AI 原型平台（v0/bolt/lovable/AI Studio）导出代码的生产工程化重构与规范化。 |
| **`api-integration`** | [`.agents/skills/api-integration/SKILL.md`](file:///.agents/skills/api-integration/SKILL.md) | 规范化接入后端接口，实现类型化模块封装与三态处理。 |
| **`critical-path-debug-test`** | [`.agents/skills/critical-path-debug-test/SKILL.md`](file:///.agents/skills/critical-path-debug-test/SKILL.md) | 前端关键路径深度分析、状态/竞态/内存审计与标准测试报告输出。 |
| **`react-mobile-responsive`** | [`.agents/skills/react-mobile-responsive/SKILL.md`](file:///.agents/skills/react-mobile-responsive/SKILL.md) | 前端与 React 项目全站移动端/响应式适配。 |
| **`svg-asset-workflow`** | [`.agents/skills/svg-asset-workflow/SKILL.md`](file:///.agents/skills/svg-asset-workflow/SKILL.md) | SVG 矢量资产组织、`currentColor` 双模主题自适应与内联无障碍规范。 |
| **`desktop-rendering-optimization`** | [`.agents/skills/desktop-rendering-optimization/SKILL.md`](file:///.agents/skills/desktop-rendering-optimization/SKILL.md) | Webview 渲染调优、缩放白闪/黑屏排查、动画掉帧与重绘风暴治理规范。 |
| **`clean-code-refactoring`** | [`.agents/skills/clean-code-refactoring/SKILL.md`](file:///.agents/skills/clean-code-refactoring/SKILL.md) | 桌面端与 Web 前端混合项目逻辑去重、结构精简与架构轻量化重构。 |
| **`inner-skills-injection`** | [`.agents/skills/inner-skills-injection/SKILL.md`](file:///.agents/skills/inner-skills-injection/SKILL.md) | 运行态内置约束（Inner-Skills / RULES.md）基于映射按需注入架构与流水线规范。 |
| **`settings-view-pattern`** | [`.agents/skills/settings-view-pattern/SKILL.md`](file:///.agents/skills/settings-view-pattern/SKILL.md) | 设置全屏页面（第 4 态）架构、5 大 Tab 导航、MRU 模型排序、自动重连参数持久化与回退流水线规范。 |
| **`desktop-kernel-lifecycle`** | [`.agents/skills/desktop-kernel-lifecycle/SKILL.md`](file:///.agents/skills/desktop-kernel-lifecycle/SKILL.md) | 桌面端内核进程管控、多环境寻址、Release 打包规范与 Windows 运行时排查治理。 |
| **`flow-interaction-pattern`** | [`.agents/skills/flow-interaction-pattern/SKILL.md`](file:///.agents/skills/flow-interaction-pattern/SKILL.md) | Flow 流式交互规范：单行紧凑过程卡、时序步骤因果拼接、多轮导航与定位、模型自动重连自愈流水线 (`ModelFailoverEngine`)。 |
| **`sketch-form-autofill-pattern`** | [`.agents/skills/sketch-form-autofill-pattern/SKILL.md`](file:///.agents/skills/sketch-form-autofill-pattern/SKILL.md) | 手绘草图表单与智能联想推荐浮窗 (`SketchAutoFill`) 标准用法与预设联动规范。 |
| **`custom-workspace-pattern`** | [`.agents/skills/custom-workspace-pattern/SKILL.md`](file:///.agents/skills/custom-workspace-pattern/SKILL.md) | 私人定制工作区设计规范、目录拓扑、防泄密物理隔离与线下交付流水线。 |
| **`code-hazards-remediation`** | [`.doc/code-hazards-remediation/SKILL.md`](file:///.doc/code-hazards-remediation/SKILL.md) | 全量代码健康度隐患矩阵（H1~H24）故障排查与核销自愈指南。 |

---

### 2. 应用内置运行态约束级 Inner-Skills (`src-tauri/inner-skills/`)
> **作用对象**：桌面应用运行时作为 Pi Agent 宿主代理，由 Rust 监督器在工具调用启动时进行智能 Hook 嗅探与按需动态强行注入。

- **核心原则：RULES 映射索引化，Skill 独立模块化，Tool Call Hook 按需精准注入**：
  - `RULES.md` 作为**轻量映射事实来源**（极简纯英文，< 100 Tokens），定义工具到 Skill 的映射矩阵；常规对话零规则注入，零多余 Token 消耗；
  - 具体领域规则独立封装于 `src-tauri/inner-skills/<skill-name>/SKILL.md`，命中后动态激活。
- **Tool Call Pre-Processing Hook 与动态 Steering 注入体系**：
  1. **Hook 命中与当轮去重**：底层 Agent 发送 `tool_execution_start` 时，Rust 监督器触发 `InnerSkillInjector::hook_tool_call(tool_name)`；若命中映射且当轮首次激活，触发注入；
  2. **主通道（动态 Steering 即时注入）**：优先通过 `steer` 命令动态向内核注入专用 XML 约束块（`<runtime_inner_skill name="...">`），注入成功后出队；
  3. **兜底通道（出站 Prompt 队列注入）**：若 steer 失败，激活项留存 `pending_skills` 队列，随下次出站 Prompt 一次性注入；
  4. **生命周期清空**：`turn_start` / `agent_start` 边界清空当轮去重集合；新会话/重置时调用 `reset_session()` 彻底清空；
  5. **前端即时反馈**：Hook 命中时广播 `pi:inner-skill-activated` 事件，Flow 思考卡片上方手绘胶囊动态显示已激活技能；
  6. **上下文信封脱敏与会话净化**：解析会话、加载历史、搜索回溯或从设置页恢复进入 Flow 时，全域自动剥离运行态注入信封（`<runtime_context_rules>`、`<code_area_routing_context>` 等）与附件绝对路径尾注，确保展示 100% 还原用户原始输入。

| 文件 / Skill 名称 | 路径 | 运行态注入机制与作用 |
| :--- | :--- | :--- |
| **`RULES.md`** | [`src-tauri/inner-skills/RULES.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/RULES.md) | 纯英文运行态 Skill 映射矩阵与基线总纲（工具到 Skill 动态映射唯一事实来源）。 |
| **`windows-bash-compatibility`** | [`src-tauri/inner-skills/windows-bash-compatibility/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/windows-bash-compatibility/SKILL.md) | 调度终端/Shell 工具（`bash`, `powershell`, `cmd`）时注入，约束统一正斜杠 `/`、强制 `-y`、禁用 Pager 翻页及 UTF-8 编码。 |
| **`document-multimodal-inspection`** | [`src-tauri/inner-skills/document-multimodal-inspection/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/document-multimodal-inspection/SKILL.md) | 涉及目录分析或多格式文档/图像（`read_file`, `docparser`, `ocr`, `pi-ocr`）时注入，约束主动深度遍历与专用解析器提取。 |
| **`multi-agent-orchestration`** | [`src-tauri/inner-skills/multi-agent-orchestration/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/multi-agent-orchestration/SKILL.md) | 调度多智能体或并发子任务（`subagent`, `pi-subagents`, `spawn_agent`）时注入，约束明确任务边界、非阻塞派发与超时控制。 |
| **`web-search-silent-access`** | [`src-tauri/inner-skills/web-search-silent-access/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/web-search-silent-access/SKILL.md) | 涉及联网搜索或网页抓取（`web_search`, `pi-web-access`, `search_web`）时注入，约束静默执行、禁止前台弹窗与多源交叉求证。 |
| **`persistent-memory-retrieval`** | [`src-tauri/inner-skills/persistent-memory-retrieval/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/persistent-memory-retrieval/SKILL.md) | 涉及跨会话长期记忆工具（`memory_retrieve`, `memory_store`, `pi-memory`）时注入，约束模糊指代查阅、增量写入与敏感隔离。 |
| **`dynamic-workflows-orchestration`** | [`src-tauri/inner-skills/dynamic-workflows-orchestration/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/dynamic-workflows-orchestration/SKILL.md) | 涉及动态工作流或自动化编排（`dynamic_workflows`, `execute_workflow`）时注入，约束分阶段校验、单步自愈熔断与进度追踪。 |
| **`active-context-pruning`** | [`src-tauri/inner-skills/active-context-pruning/SKILL.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/active-context-pruning/SKILL.md) | 涉及长会话上下文修剪工具（`context_prune`, `prune_context`, `pai-acp`）时注入，约束渐进修剪冗余、保护核心意图与最新代码锚点。 |

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
