---
name: pi-desktop-overview
description: |
  Pi Desktop Lite (pi-dl) 桌面应用的完整产品定位、系统架构、四态界面体系、前端/后端核心特性与交互流水线总览。当涉及"项目概述"、"核心特性"、"功能总览"、"架构总览"、"四态界面"、"pi-desktop-lite特性"、"功能介绍"、"系统架构"、"项目设计理念"、"功能矩阵"、"桌面端特性"时按需调用此技能。
---

# Pi Desktop Lite (pi-dl) 核心架构与特性总览

本项目为基于 **Tauri 2 + 原生 Web 前端（HTML / CSS / JS）** 构建的极简手绘与工程绘图线条风格桌面研究与编码应用，深度复用 Pi 原生内核生态。

---

## 🏛️ 核心设计哲学

- **原生生态复用**：完全兼容 Pi CLI 会话规范（`~/.pi/agent/sessions/*.jsonl`）、配置标准（`auth.json`、`models.json`、`settings.json`）与组件市场（`pi.dev/packages`）；
- **手绘工程线条美学 (Sketch & Drafting)**：借鉴 Anthropic Research 与 Pi.dev 设计语言，采用 1.2~1.4px 实墨草图线框、微不对称有机圆角、柔和纸质双模背景，全域杜绝系统默认 Emoji；
- **高性能桌面底层**：Rust 作为进程监督器，提供 Win32 Job Object 孤儿收割、多进程隔离监管池、单实例互斥与零提权热更新。

---

## ✨ 四态界面体系

```text
[详细版 (界面1: detailed)]  ➔ 多行自适应输入、格言跑马灯、历史翻阅与草稿暂存、文件夹拖入概述胶囊、讯息抽屉
       ↓ (聚焦输入框)
[专注版 (界面2: focus)]     ➔ 居中手绘 Logo + 纯净输入框 + Mini 任务胶囊（右键回退界面1）
       ↓ (回车发送)
[Flow 交互版 (界面3: flow)] ➔ ReAct 时序步骤流（单行紧凑折叠）、Typedown Markdown 预览、轮次导航、无痕内置重连
       ↕ (齿轮设置)
[设置全页面 (界面4: settings)] ➔ 5 大 Tab 导航（常规/模型配置/内核/会话记录/工作区），3 秒指引渐隐，右键/Esc 回退
```

### 1. 详细版 (`detailed`)
- **拖拽区**：顶部约 30px 标题栏响应拖拽；
- **输入与附件**：输入框支持方向键上下翻阅历史提问与草稿暂存；支持将文件、图片、文件夹直接拖拽入输入框或窗口，并支持直接粘贴（`Ctrl+V`）截图图片、Windows 资源管理器复制的文件/目录（经 Rust `CF_HDROP` 提取）及本地路径文本生成手绘概述胶囊（`category: "folder" / "image" / "code" / "document"`），发送时注入系统绝对路径；普通自然语言文本放行原生粘贴；
- **历史抽屉**：MRU 排序，悬浮延迟级联展开，双击恢复 Flow 对话。

### 2. 专注版 (`focus`)
- 聚焦输入框即进入，居中纯净排布，右上角展示 Mini 任务胶囊；右键平滑回退。

### 3. Flow 交互版 (`flow`)
- **时序步骤流**：思维切片、Point 阶段切片与工具切片常态单行折叠，**绝不自动展开**，因果交织拼接；
- **Typedown Markdown**：支持多级标题、代码块语言徽标 + 一键复制（1.8s 微反馈）、GFM 表格、任务列表与 Callout 警示框；回答卡底部手绘一键保存 Markdown 至桌面；
- **超链接拦截**：全域 HTTP/HTTPS 链接拦截并通过 Rust `pi_open_url` 唤起外部浏览器；
- **图片直观展示与一键存桌面**：模型输出与生成的图片（Markdown `![]()`、HTML `<img>`、图片链接与独立路径行）直接渲染为手绘卡片；本地物理磁盘图片通过 Rust IPC 异步转码 Base64 Data URL 突破 Webview2 同源安全隔离，前端 Map 缓存防重复 IPC；支持点击呼出手绘全屏灯箱放大预览；图片卡片集成手绘操作栏，支持「一键保存到桌面」（时间戳防覆盖 + 2.2 秒翠绿对勾反馈）与「打开所在目录」资源管理器定位；纯生图任务若模型漏发图片 Markdown 语法，收口阶段自动比对会话新增文件并动态自愈补齐图片预览框；
- **悬浮提问提示**：滚动溢出时顶部悬浮吸附当前轮提问；
- **上下轮次导航**：多轮对话时右侧显现，定位到每轮输出内容顶部；「上」两段式优化定位（≤100px 范围回退上一轮，深入输出则定位当前轮顶部）；「下」单击定位下一轮，长按 1.5 秒立即定位到底部；
- **中断发送流水线**：运行态提交时拦截确认（“终止并发送”），旧轮结算后下发新轮，杜绝串轮；
- **无痕内置重连流水线 (`ModelFailoverEngine`)**：**总开关绝对一票否决**（未勾选时全链路严禁重连/重试，瞬态与速率限制错误直接弹出错误卡，并同步清退内核 `settings.json` 的 `retry` 块杜绝底层自行重试）；开启时模型调用报错隐藏「模型XXX异常」窗体，后台静默续发「继续」文本（不生成提问卡、不显示）；**前台活跃任务与后台挂起任务全域覆盖**（后台任务重连仅做数据层静默续发，耗尽经 `failTask` 落定 error）；全部 60 秒延迟重连并在续发后再延迟 60 秒，写死 10 次单次 120 秒（即 120s * 10 = 1200 秒；旧引擎残留的持久化 `modelFailover` 块在读取时幂等迁移归一）；提醒文本框作为纯状态示意条恒定置于会话流最下方（回答卡下方）并随内容吸底跟随，展示「自动内置重连 N/10 ...」实时倒数；等待延迟全周期支持胶囊内手绘「⏹ 中断」或全局终止直接彻底中断一切；10 次全部耗尽才渲染错误卡并附摘要，弹卡同时锁定「耗尽终态」——后续重复错误帧绝不再次自动冷启动，仅手动「重试当前提问」（自动续发「继续」）/新提问可重新发起。已彻底取消自动切换模型逻辑（候选池、MRU 巡检、多轮轮转、临时 `pi_set_model` 均已移除）。手动终止绝对禁止触发重连（终止后对无归属错误帧另行 15 秒保守静默窗口）。
- **会话回退与文件撤回**：轮次提问卡悬浮「回退到此处」，可回退到任意一次历史对话（配合 pi 内核原生 RPC fork）：基于工具执行前确定性快照自动还原「已修改/已删除」文件（新增文件永不撤回），SketchModal 确认清单 + 顶部浮窗 3 秒提醒结果，提问回填输入框供编辑重发；
- **中途提问人工回归选择**：内核 Extension UI 子协议（`extension_ui_request`）的 `select` / `confirm` / `input` / `editor` 在 Flow 中呈现手绘待答横条 + `SketchModal` 作答弹窗（`SketchSelect` / 双按钮 / 单行与多行输入框），作答回写 `extension_ui_response` 解除内核阻塞续跑；`timeout` 由内核自动按默认值解析（卡片读秒示意）、fire-and-forget 方法（notify/setStatus/setWidget 等）不建卡；未决请求随任务挂起保留、回入 Flow 100% 重建、终止 best-effort 回写取消；

### 4. 设置全页面 (`settings`)
- **独立全屏视图**：`data-view="settings"`，右上角操作指引 3 秒自动平滑渐隐；
- **5 大 Tab 导航**：常规、模型配置（MRU 自动排序，首位锁定保护）、内核（状态监控、一键热更新、推荐插件安装）、会话记录（内存过滤搜索、一键进入 Flow、绝不删除内核底层文件）、工作区。

---

## ⚡ 后台任务与多进程监管体系

- **挂起与中止解耦**：Flow 模式下按 Esc / 右键转入后台挂起（`isSuspended = true`，进入 `TaskManager`，不调用 abort）；显式「⏹ 终止」按钮彻底中止 Agent 并追加手动终止提示；
- **后台流式串轮过滤**：挂起任务的流式增量经 `isForegroundStreamTask` 前台门禁过滤，绝不串入前台 Flow DOM；历史讯息抽屉采用签名比对 + 节流渲染抗事件风暴；
- **右上角 Mini 任务胶囊**：常态展示 `[ ✏️ 1/3 Task ]`，运行中微旋转呼吸动画；
- **320px 毛玻璃侧边栏**：点击胶囊滑出侧边栏，主背景高斯模糊，支持多任务查看与管理；
- **底层 `PiHostPool`**：最大并发限制（`MAX_CONCURRENT_TASKS = 3`），`task_id` 分帧隔离。

---

## 🧭 预设工作区与 `code-area` 路由调度中枢

- **双轨模型**：内置模板为只读资源，首次选中复制到 `~/.pi-dl/workspaces/<id>/` 作为用户可写副本；
- **`code-area` 路由中枢**：
  - 物理 CWD 驻留于 `code-area`（感知内置技能），绑定路由目标项目绝对路径；
  - 基于 Rust `rfd` 实现原生 Windows 文件夹选择器；
  - 严格遵守免污染铁律，所有代码读写作用于路由目标项目；
  - 对话透明注入 `<code_area_routing_context>`、目标项目 `AGENTS.md` / `README.md`（`.agents/` 下技能规约遵循 `AGENTS.md` 映射按需查阅，不进行全量强制前置注入）。

---

## 🧩 前端模块化与降耦合架构 (Modular & Decoupled Architecture)

- **功能域模块化编排**：`src/modules/` 按功能域拆分（24 个模块），`src/main.js` 作为轻量唯一编排入口（约 90 行），仅构建共享上下文并按依赖顺序初始化各模块；
- **共享可变状态唯一属主 (`src/services/stores/`)**：
  - `viewStore`：四态界面状态机（`morph`/`set`），控制流命令禁上总线；
  - `settingsStore`：通道抽屉、官方目录、认证缓存与工作区状态；
  - `attachmentsStore`：输入框附件胶囊与多模态载荷；
  - `flowStore`：Flow 流式 11 项纯数据唯一属主，**按 `flowStore.for(taskId)` 分仓**；严格遵循 **Store action 一律同步、严禁 async/await/微任务调度**，裸写完全清零（断言 = 0）；
- **Flow 视图三层解耦与自绑定**：
  - **纯渲染层 (`src/modules/flow-render.js`)**：无副作用、不读共享状态、不碰视图缓存的纯函数（卡片创建、映射、HTML 格式化等），调用方显式 `import`，彻底清退旧 `ctx.api` 纯渲染槽；
  - **只读 DOM 引用层 (`src/modules/flow-dom.js`)**：`createFlowDom()` 产出挂载于 `ctx.flowDom`，flow 模块统一只读此引用；
  - **视图派生缓存唯一属主 (`src/modules/flow-state-view.js`)**：`flowView` 密封对象（`renderedToolCards`、`currentSteps`、读秒计时器、`activeTurnRefs`、`followBottom`），严禁入 store；
  - **DOM 按需自绑定 (`src/lib/el-binder.js`)**：各业务模块通过 `bindAll` 按需自绑定自己的 DOM id 子集，**`ctx.el` 已彻底废除**；
- **契约化通信与事件通道 (`src/lib/contracts.js`)**：
  - 横切通知（fire-and-forget，如 `ui:toast`、`ui:workspace-changed`、`flow:response`）统一由 `src/lib/event-bus.js` 同步分发；
  - 控制流与状态迁移走 Store action 或显式 import；
  - `ctx.api` 函数槽以 JSDoc `@typedef` 全量契约定型（按属主分组登记 + 三类保留原因注解），杜绝幽灵槽与兼容壳复发；
- **构建与质量度量门禁**：
  - `npm run check:fe`：前端静态校验门禁（全量 .js 模块语法 + import 图可解析 + 循环依赖检测）；
  - `npm run check`：Rust 极速语法与类型校验（~1s）；
  - `npm run measure:coupling`：耦合度量基线监控（确保共享状态裸写为 0、无超额重复注册）。

---

## 🛡️ Rust 后端子系统矩阵

| 子系统模块 | 核心职责 |
|---|---|
| **`pi_runner`** | Win32 Job Object 孤儿收割（`job_object.rs`），`\n` 分帧（`framer.rs`），内核 RPC 基建与内核保险平滑重连（最多 5 次，失败触发闪电提醒）；内含 `supervisor.rs`（主宿主监督器）、`host_pool.rs`（多任务进程池，`MAX_CONCURRENT_TASKS = 3`）、`rpc.rs`（请求 id/pending 登记/stdin 写循环/PATH 补全单一实现）、`inner_skills.rs`（运行态技能注入）、`protocol.rs` |
| **`pi_runner/inner_skills`** | 基于 `RULES.md` 极简映射（<100 Tokens）在工具调用时动态 Steer 注入 9 大运行态技能 |
| **`package_manager`** | 连通 pi.dev/packages，15min TTL 缓存，FIFO 安装队列与 ProgressStepper 步进；含 `presets.rs`（推荐配置预设）与 `patches.rs`（组件缺陷补丁） |
| **`session`** | `DashMap` 并发缓存 + `notify` 递归监听 `~/.pi/agent/sessions/`，原生上下文脱敏净化，精确毫秒时间戳排序与 LIFO 最新提问去重历史栈 |
| **`config_manager`** | 双层持久化：`~/.pi-dl/config.json` 与 `~/.pi/agent/` 下的 `auth.json` / `models.json` / `settings.json`；已由单文件神对象拆为 `config_manager/{io,schema,migrate,validate}.rs` |
| **`workspace`** | 多预设工作区模板发现（`default-area` 根目录 + `workspaces/<id>/` + 根级含 `workspace.json` 目录）、整目录物化复制至 `~/.pi-dl/workspaces/<id>/`、`code-area` 路由中枢绑定与 CWD 重锚 |
| **`version_watcher`** | 内核版本检查（`checker.rs`）、VersionScheduler 更新调度（`scheduler.rs`）、流式下载热更新与原子取消（`updater.rs`） |
| **`security`** | 上下文脱敏净化（`redaction.rs`），历史会话与遥测的敏感信息剥离 |
| **`rollback.rs`** | 会话回退文件还原：按 `(path, toolCallId)` 精确匹配最早快照，两阶段事务性预检与原子落盘 |
| **`commands`** | Tauri IPC 命令层：`commands/{file,window,agent,session,rollback,workspace_cmd,skills,version}.rs`，`lib.rs` 仅保留 `invoke_handler!` 汇总与 `app.manage(...)`/`run()` 启动 |

---

## 🔄 全域右键 Step Back 回退层级

```text
[半透明侧边栏 (最高优先级)] ➔ 平滑收起并解除主背景高斯模糊
      ↓
[设置全页面 (界面4: settings)] ➔ 返回进入前的原界面
      ↓
[Flow 交互版 (界面3: flow)]    ➔ 运行态挂起 (Suspend)，已完成归档，回退至界面2 (设置页直入特例定向回设置页)
      ↓
[专注版 (界面2: focus)]        ➔ 回退至详细版 (界面1) 并失焦
      ↓
[详细版 (界面1: detailed)]     ➔ 优先失焦高亮组件 ➔ 清空当前输入 (输入框右键静默屏蔽防抖)
```
