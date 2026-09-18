# 项目规则与代理行为准则 (AGENTS.md)

本项目为基于 **Tauri 2 + 原生 Web 前端（HTML / CSS / JS）** 的桌面应用（pi-dl / Pi Desktop Lite）。所有参与本项目的 AI Agent 必须严格遵守以下规则。

## 📚 分层加载规范（强制）

- 本 `AGENTS.md` 仅保留**强制生效的浓缩不变量**与**技能映射路由表**，是唯一的前置注入源；
- 各铁律与机制的**完整实现细节、历史根因与验收标准**统一封装在 [`.agents/skills/`](.agents/skills/) 下；任务命中哪个领域，**必须先读对应 `SKILL.md` 再动手**，严禁凭记忆或臆测修改。

---

## 📌 核心准则一：文档、规范与代码必须同步更新（严格约束）

**在进行任何代码逻辑变更、重构、架构调整或配置升级时，必须在同一任务中同步对齐以下全部文档与技能，严禁滞后：**

1. **同步更新 `AGENTS.md`**：架构、命令、模块划分、铁律或代理工作流变化时，立即更新对应规则（铁律变更须同步速查表与 `desktop-interaction-invariants` 技能全文）；
2. **同步更新 `README.md` / `README_en.md`**：功能特性、技术栈、目录结构或运行命令变化时，更新使用说明；
3. **同步更新 Skill 内容**：构建命令、操作流程或技术规范变化时，同步更新 [`.agents/skills/`](.agents/skills/) 下对应技能。

> ⚠️ **交付标准**：任何任务交付时，代码、文档（`README.md` / `README_en.md` / `AGENTS.md`）与技能（`SKILL.md`）三者必须保持 **100% 严格一致**。

---

## 📌 核心准则二：任务完成自动编译、代码卫生与循环自愈

每次完成代码修改、功能新增或重构后，必须执行以下闭环校验（细节见技能 `auto-compile-and-fix` 与 `iterative-modification-hygiene`）：

1. **代码卫生**：严禁凭记忆修改，替换前先对齐真实代码切片与行号；替换必须原子化覆盖旧逻辑，杜绝幽灵函数签名（Dangling Snippets）与重复声明；**开发过程中添加的临时单元测试（如 `#[cfg(test)]`、`#[test]`）在交付前必须彻底清除**；Web 前端修改后立即 `node -c <filePath>` 静态验证 AST；
2. **极速编译校验**：优先 `npm run check`（~1s）；涉及 Tauri 配置或底层 ABI 修改时用 `npm run build:check`；
3. **失败自愈**：校验报错必须分析日志根因并自动修复，循环直至 **Exit Code 0**；
4. **交付门禁**：冗余与临时测试清理完毕、前端 AST 校验与后端编译均通过后方可交付。

---

## 📌 核心准则三：桌面端交互 22 项铁律（速查索引）

> 📖 **完整机制全文（唯一事实来源）**：[`.agents/skills/desktop-interaction-invariants/SKILL.md`](.agents/skills/desktop-interaction-invariants/SKILL.md)。**任何 UI 与交互修改前必须先读该技能中对应条目的完整规范**；下表仅为速查不变量。

| # | 铁律 | 一句话不变量 |
| :-- | :--- | :--- |
| 1 | 拖拽区域限制 | 仅顶部约 30px 标题栏可拖拽，内容主体/背景/品牌区严禁。 |
| 2 | 焦点释放 | 点击外部空白、非输入元素或右键时输入框立即 `blur()` 消除高亮。 |
| 3 | 全域右键 Step Back 与四态界面流 | 拦截默认右键；回退层级 = 侧边栏 ➔ 设置页 ➔ Flow（挂起）➔ 专注版 ➔ 详细版；含 13 个子铁律：`flowFromSettings` 定向回退、挂起/终止双通道解耦与终止按钮同步（`syncFlowAbortButtonVisibility`）、任务直切自动挂起、终态任务防幽灵挂起、会话延续唯一性（`--session <path>` 续写）、历史智能重定向与持久化预算/30 天归档清除、会话回退文件撤回（新增文件绝不撤回）、Flow DOM 防重入、工具卡 DOM 自愈、后台流式串轮过滤与会话流缓存（`__piBound` 去重、写文件同步探测）、思维切片生命周期（无显式文本定格「已完成思考」）、输入框右键防抖。 |
| 4 | 手绘 SVG 图元 | 禁系统 Emoji，图标归档 `src/assets/svg/`，统一 `currentColor` 适配双模主题。 |
| 5 | 按钮设计 | 常态 `background: transparent` + `border: 1px solid transparent` 几何占位，仅 `:hover` / `:focus-visible` 显框，杜绝 Layout Shift。 |
| 6 | 极简滚动条 | 常态 4px 半透明竖条；内容区 hover 不高亮；入轨展开 6px 高亮加深。 |
| 7 | 草图组件套件 | 下拉 `SketchSelect` / 填表 `SketchAutoFill` / 弹窗 `SketchModal` 统一承载，严禁原生控件直用。 |
| 8 | 系统托盘与单实例 | 单实例互斥唤醒置顶；关闭隐藏至托盘常驻，支持彻底退出。 |
| 9 | 失焦系统通知 | 仅失焦且（完成/需确认/报错）时触发 Windows Toast，聚焦绝对静默。 |
| 10 | 无内核运行降级 | 平稳待机不死循环重启、发送入口屏蔽、内核面板降级、一键下载自愈、崩溃监督器最多 5 次平滑重连（间隔 2s）。 |
| 11 | 多模态拖拽与智能粘贴 | 文件/文件夹拖入与 `Ctrl+V` 粘贴（位图落盘 `~/.pi-dl/attachments/`、`CF_HDROP` 提取路径、文件夹生成单个概述胶囊不炸裂）。 |
| 12 | Markdown 渲染与外链 | Typedown 质感渲染引擎；全域超链接拦截经 `pi_open_url` 唤起外部浏览器，严禁 Webview 内跳转。 |
| 13 | code-area 路由中枢 | 物理 CWD 驻留 Hub、`rfd` 原生选夹器、免污染铁律、存在性自动校验、透明注入路由上下文与「注入提示」框。 |
| 14 | 子代理模型钉住 | `pi-subagents` 启用时同步主模型至 `subagents.defaultModel` 与各角色 `agentOverrides`（读-合并-写回），未启用零污染，杜绝模型跃升。 |
| 15 | Node.js 环境预检 | 组件安装/更新/内核下载前 `pi_check_node_environment` 探测；缺失时 `SketchModal` 拦截 + 一键跳官方下载，装好即续无需重启。 |
| 16 | 输入历史导航 | 真实时间戳排序 LIFO 最新优先、重复发送晋升末尾、单/多行光标敏感触发、二次编辑草稿保护。 |
| 17 | 会话监听 | `SessionWatcher` 经 `app.manage` 常驻托管监听 `~/.pi/agent/sessions`；实时监听 + 终态主动同步 + Tab 强刷三重保证。 |
| 18 | 模型无痕内置重连 | 总开关一票否决（关闭时同步清退内核 `retry` 注入块）；开启时后台续发「继续」写死 10 次、60s + 60s 周期（120s × 10）；耗尽才弹错误卡并锁终态（重复错误帧绝不复发）；瞬态错误先走 300s 黄色宽容期倒计时（恢复即撤销、超时才弹红框、不可恢复错误一票否决）；错误卡按 `${bucketId}::${errorMessage}` 签名幂等防「卡死」；重连/等待期严禁 Toast 与正文红卡，中断按钮全周期可用；重发保留全部过程记录（先 `sealActiveThinkingStep` 再清缓冲）。 |
| 19 | 中途提问人工回归 | Extension UI 可回写四类方法 `select/confirm/input/editor`；未决请求真源 `task.pendingUiRequests` 随挂起保留；作答先同步摘除再异步回写；后台任务绝不渲染前台横条；终止先 best-effort 回写取消再强杀。 |
| 20 | 工具入参自愈解包 | `pi-tool-sanitizer.ts` 双层防御（`message_end` 前置剥离外壳 + `tool_call` 二次清洗），治愈模型嵌套外壳引发的 AJV 校验自激死循环，无外壳 100% 直通。 |
| 21 | 组件推荐配置预设 | `package-presets.json` 唯一源，读-合并-写回 + 严格回读校验；`configFiles` 多路径双写；安装/更新/启动三时机自愈。 |
| 22 | 组件缺陷补丁预设 | `package-patches.json` + `patches/<组件>/` 源码内嵌；版本闸门 / 存在性闸门 / 幂等回读三道闸门缺一不可；安装/更新/启动三时机重打；严禁为未验证版本放宽 `versionPrefixes`。 |

---

## 🧭 Skills 架构体系与映射路由（严格界定）

本项目严格区分两类不同生命周期的 Skill。**Agent 按下表路由按需查阅，严禁跳过映射直接臆测。**

### 1. 项目开发级 Skills (`.agents/skills/`)
> **作用对象**：协助本项目源码开发、迭代、重构与调试的 AI 编码助手。

| 领域分类 | Skill 名称 | 路径 | 核心能力与触发场景 |
| :--- | :--- | :--- | :--- |
| **架构与规范** | **`pi-desktop-overview`** | [`.agents/skills/pi-desktop-overview/SKILL.md`](.agents/skills/pi-desktop-overview/SKILL.md) | 产品定位、四态体系、核心特性与交互流水线总览（触发：项目概述/架构总览/四态界面）。 |
| | **`desktop-interaction-invariants`** | [`.agents/skills/desktop-interaction-invariants/SKILL.md`](.agents/skills/desktop-interaction-invariants/SKILL.md) | 桌面端交互 22 项铁律完整全文（唯一事实来源；触发：任何 UI 与交互修改，见核心准则三速查表）。 |
| | **`pi-ecosystem-configuration`** | [`.agents/skills/pi-ecosystem-configuration/SKILL.md`](.agents/skills/pi-ecosystem-configuration/SKILL.md) | Pi API 鉴权、大模型接入、Packages 扩展包、Skills 规范、TypeScript 扩展与子代理钉住配置全指南（触发：pi配置/模型配置/组件安装/auth.json/models.json/subagents配置/Ollama配置）。 |
| | **`inner-skills-injection`** | [`.agents/skills/inner-skills-injection/SKILL.md`](.agents/skills/inner-skills-injection/SKILL.md) | 运行态内置约束（RULES.md）按需注入架构、目录拓扑与新增 SOP（触发：运行态技能/上下文注入/RULES/新增inner-skill）。 |
| **手绘 UI 与交互** | **`sketch-drafting-ui`** | [`.agents/skills/sketch-drafting-ui/SKILL.md`](.agents/skills/sketch-drafting-ui/SKILL.md) | Anthropic/Pi.dev 手绘草图美学、简约线条与纸质双模主题（触发：手绘风格/工程绘图风/草图UI）。 |
| | **`sketch-modal-pattern`** | [`.agents/skills/sketch-modal-pattern/SKILL.md`](.agents/skills/sketch-modal-pattern/SKILL.md) | 手绘素描居中模态弹窗（Pop & Shake、Step Back 优先拦截、焦点陷阱）（触发：模态窗/弹窗/alert替换）。 |
| | **`sketch-form-autofill-pattern`** | [`.agents/skills/sketch-form-autofill-pattern/SKILL.md`](.agents/skills/sketch-form-autofill-pattern/SKILL.md) | 手绘表单规范、消灭原生变色与 `SketchAutoFill` 智能联想（触发：新增表单/自定义填表/autofill）。 |
| | **`svg-asset-workflow`** | [`.agents/skills/svg-asset-workflow/SKILL.md`](.agents/skills/svg-asset-workflow/SKILL.md) | 手绘 SVG 图元规范、`currentColor` 主题自适应与内联管理（触发：SVG图标/替换图标/图标规范）。 |
| | **`flow-interaction-pattern`** | [`.agents/skills/flow-interaction-pattern/SKILL.md`](.agents/skills/flow-interaction-pattern/SKILL.md) | Flow 流式交互全规范（架构分层铁律、单行紧凑过程卡、因果时序拼接、多轮定位、无痕内置重连引擎、宽容期胶囊、文件变更收纳框、会话回退撤回、多任务直切、人工回归作答、额度遥测弧光）（触发：flow交互/思维链/轮次定位/文件变更/修改了哪些文件/会话回退/撤回文件/流式渲染）。 |
| | **`settings-view-pattern`** | [`.agents/skills/settings-view-pattern/SKILL.md`](.agents/skills/settings-view-pattern/SKILL.md) | 设置全屏独立视图（第4态）、5 大 Tab、MRU 模型排序与回退流（触发：设置界面/配置页面/settings）。 |
| **工程与治理** | **`desktop-kernel-lifecycle`** | [`.agents/skills/desktop-kernel-lifecycle/SKILL.md`](.agents/skills/desktop-kernel-lifecycle/SKILL.md) | Tauri 2 + Rust 内核生命周期管控、多环境寻址与 Release 打包避坑（触发：内核崩溃/进程重启/打包）。 |
| | **`auto-compile-and-fix`** | [`.agents/skills/auto-compile-and-fix/SKILL.md`](.agents/skills/auto-compile-and-fix/SKILL.md) | 任务完成后自动极速编译与失败自愈闭环、前端门禁与度量（触发：编译校验/自动修复/构建验证/门禁）。 |
| | **`clean-code-refactoring`** | [`.agents/skills/clean-code-refactoring/SKILL.md`](.agents/skills/clean-code-refactoring/SKILL.md) | 桌面端与 Web 混合架构逻辑去重、结构精简与样板消除（触发：代码精简/去冗余/重构优化）。 |
| | **`iterative-modification-hygiene`** | [`.agents/skills/iterative-modification-hygiene/SKILL.md`](.agents/skills/iterative-modification-hygiene/SKILL.md) | 连续迭代代码卫生、AST 语法静态校验与防幽灵残余（触发：多次修改代码/清理冗余/代码卫生）。 |

### 2. 应用内置运行态约束级 Inner-Skills (`src-tauri/inner-skills/`)
> **作用对象**：桌面端作为 Pi Agent 宿主时，由 Rust 监督器在底层工具调用时 Hook 嗅探、按需动态注入（映射驱动，无工具调用时零消耗）。

- **映射总纲唯一源**：[`src-tauri/inner-skills/RULES.md`](src-tauri/inner-skills/RULES.md)（<100 Tokens，纯英文工具到 Skill 动态映射矩阵）；
- **机制全貌、目录拓扑、steering 注入流水线与新增 SOP**：统一详见技能 [`.agents/skills/inner-skills-injection/SKILL.md`](.agents/skills/inner-skills-injection/SKILL.md)，本文件不再重复展开；
- **现有 9 个运行态技能**：`windows-bash-compatibility`（bash/powershell/cmd 兼容）、`document-multimodal-inspection`（读文件/文档/OCR）、`multi-agent-orchestration`（子代理）、`web-search-silent-access`（联网搜索）、`persistent-memory-retrieval`（持久记忆）、`dynamic-workflows-orchestration`（动态工作流）、`active-context-pruning`（上下文修剪）、`temp-file-hygiene`（临时文件沙盒 `~/.pi-dl/temp/`）、`tool-failure-logging`（工具失败落盘 `~/.pi-dl/workspaces/log/`）；各自触发工具与核心约束以 `RULES.md` 为准。

---

## 🗂️ 前端模块化结构速查 (Frontend Module Layout)

前端按功能域模块化解耦，严禁向入口文件堆砌业务代码：

- **`src/main.js`**：唯一编排入口。**不收集 DOM 引用（`ctx.el` 已彻底废除，各模块经 `src/lib/el-binder.js` 的 `bindAll` 按需自绑定）**，仅构建共享上下文（`ctx.flowDom` + 4 个 store 引用 + `ctx.flowView` 视图派生缓存 + `ctx.api`）并按依赖顺序初始化各模块；
- **`src/lib/`**：跨模块共享基础件（`dom-utils` / `icons` / `markdown-renderer` / `view-constants` / `event-bus` / `el-binder` / `token-telemetry-gauge` / `contracts`）。**`contracts.js` 是唯一契约归口**：事件通道契约表（bus / Store action / `pi:*` 内核桥接，新事件必须登记）、`ctx.api` 函数槽契约 @typedef 定型（新增槽位必须同步登记，严禁幽灵槽）、任务运行态/终态/终止判定唯一源（`TASK_ACTIVE_STATUSES` / `TASK_TERMINAL_STATUSES` / `isTaskAborted`，严禁模块自维护状态字面量数组或 `isAborted || aborted` 习语）、内核事件帧 taskId 解析唯一源（`resolveEventTaskId`，严禁内联回退链）；
- **`src/modules/`**：按功能域拆分的 UI 业务模块（全量清单见 README 目录拓扑；`flow-render.js` 纯渲染层、`flow-dom.js` 只读 DOM 引用层、`flow-state-view.js` 视图派生缓存属主）。跨模块调用经 `ctx.api.<fn>()` 与显式 import；**Flow 视图分层铁律**（流式纯数据归 `flowStore` 按 taskId 分仓、视图派生缓存归 `flowView` 密封对象、纯渲染归 `flow-render.js`、只读 DOM 引用归 `ctx.flowDom`）的完整细节见 [`flow-interaction-pattern` 技能 §1](.agents/skills/flow-interaction-pattern/SKILL.md)；
- **`src/services/stores/`**：共享可变状态唯一属主（`viewStore` 四态状态机 / `settingsStore` / `attachmentsStore` / `flowStore` 流式纯数据分仓）。**Store action 一律同步、禁 async/await、禁微任务**；严禁跨模块直改 `view.x` / `settings.x` / `attachments.x` / `flow.<纯数据>`（`measure:coupling` 度量断言 = 0）；
- **`src/styles/`**：按功能域拆分的样式文件，`src/styles.css` 仅为 `@import` 聚合入口；
- **`src/services/`**：与 UI 解耦的前端服务层（IPC 桥接、配置、流式客户端、任务/会话/工作区），**严禁**直接操作 UI DOM。

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

> 🛡️ **后端命令层规范**：Tauri IPC 命令按领域拆至 `src-tauri/src/commands/`（`file` / `window` / `agent` / `session` / `rollback` / `workspace_cmd` / `skills` / `version`）；`lib.rs` 仅保留 `invoke_handler!` 汇总与 `run()` 启动；内核 RPC 基建（请求 id/pending 登记/三态等待响应/stdin 写循环/PATH 补全）收敛于 `pi_runner/rpc.rs` 单一实现，supervisor 与 host_pool 仅保留各自门禁差异；`config_manager.rs` 拆为 `config_manager/{io,schema,migrate,validate}.rs`。新增/修改 IPC 命令时，应落在对应领域子模块，而非 `lib.rs`。

### 多预设工作区与路由调度中枢
- **IPC 指令**：`pi_list_workspaces` / `pi_get_active_workspace` / `pi_set_active_workspace(id)`（物化副本 ➔ 持久化 ➔ 切换 ➔ 空闲重启重锚 CWD）；
- **公共预设**：根目录 `default-area/`（默认工作区）、`workspaces/code-area`（**全局编码技能集与路由调度中枢**，物理 CWD 驻留 Hub、免污染路由外部目标项目）、`workspaces/research-area`（深度研究）；模板发现同时兼容根级含 `workspace.json` 的自定义预设目录（`src-tauri/src/workspace/mod.rs` 三段扫描）；
- **随安装包分发**：注册于 `tauri.conf.json` 的 `bundle.resources`，首次选中整目录物化复制至 `~/.pi-dl/workspaces/<id>/` 作为运行时副本。
