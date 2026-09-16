# pi-dl (Tauri Desktop App)

<p align="center">
  <a href="README_en.md">English</a> | <b>简体中文</b>
</p>

一个极简手绘与工程绘图线条风格的桌面端研究与搜索应用，完全忠于 Pi 内核生态，基于 **Tauri 2 + 原生 Web 前端（HTML / CSS / JS）** 构建。

<p align="center">
  <img src="src/assets/111.png" alt="pi-dl 初始主界面" width="49%" />
  <img src="src/assets/222.png" alt="pi-dl Flow 流式交互界面" width="49%" />
</p>

---

## 🌐 官方资源与生态

- 🔗 **Pi 官方网站**：[https://pi.dev/](https://pi.dev/)
- 📦 **Pi 组件与扩展市场 (Package Gallery)**：[https://pi.dev/packages](https://pi.dev/packages)
- 🐙 **Pi 开源仓库**：[earendil-works/pi (GitHub)](https://github.com/earendil-works/pi)
- 📚 **官方技能库精选**：[Anthropic Skills](https://github.com/anthropics/skills) ｜ [Pi Skills](https://github.com/badlogic/pi-skills)

---

## ✨ 核心特性

- **四态界面与 Flow 流式交互**：涵盖详细版、专注版、Flow 流式交互版及设置页，支持单行紧凑思维链（伪思维框读秒、收起态实时从右向左流动输出流跟踪最新输出、无显式文本跃迁工具定格保留为“已完成思考”并消除渐隐清晰呈现）与 Typedown 质感 Markdown 预览；
- **额度遥测**：仅在 Flow 对话流界面对话框外部左侧出现的实时仪表小图标（其他界面由齿轮按钮当家，遥测盘不占位），本身即纯粹的两个同心缺口圆弧 + 小闪电标识组合（无刻度表，外环上下文消耗比值弧 / 内环已耗 token 配额弧适当加粗 / 中心推理速率闪电随状态变色），鼠标悬浮即在图标上方展开手绘胶囊面板，实时呈现当前上下文消耗（已用 / 窗口）、推理速度 token/s（推理中 / 均值 / 空闲）与已消耗 token（累计 / 额度）；已耗 token 的额度分母走动态量级阶梯（`resolveTokenQuota`）：从 1M 起，累计用量满足当前量级后分母自动增长十倍（1M → 10M → 100M → 1B → 10B → …），量级档位分别以绿色（1M 档）/ 橙色（10M 档）/ 红色（100M 及以后全部）着色；推理速度走全局动态均值（`当前任务累计推理 output ÷ 有效生成耗时`，`agent-start`/`agent-end` 括号折算墙钟并剔除工具调用窗口与产出停摆期，provider usage 跨消息回绕自动入账兼容），帧间停顿与工具长耗时不再归零；产出停摆冻结（`SPEED_STALL_FREEZE_MS` 3s 宽限）：thinking 静默 / point 与 toolcall 参数流式生成 / 工具结束后首 token 延迟等触发动作延迟期内，累计 output 未增长即把速度计时定格（呈现层冻结不再随墙钟衰减），usage 恢复增长时残差全额入账保持均值诚实（仅呈现冻结、不做会计豁免），收口后定格「均值」；速度四档阈值着色（< 50 红 / < 100 橙 / < 200 绿 / ≥ 200 蓝，`resolveSpeedLevel` 唯一源），取消中间小闪电图标常态模糊光晕，改为每次触发新一轮 thinking / point / 工具调用时触发 1 秒电弧高亮脉冲；上下文窗口与累计用量经内核 `get_session_stats`（后端 `with_response` 同步取回，响应帧不进广播通道）低频轮询（悬浮时 2s / 挂起态 15s），任务分仓隔离（跨任务直切保留各自均值）+ 会话数据保留（stats 按 taskId 分仓、收口后不清空，会话结束后再次悬浮点开仍展示该会话的上下文 / 均值速度 / 累计消耗；并以 sessionPath 为键把稳定快照节流写入 localStorage，跨应用重启与从「历史记录 / 会话记录」还原历史会话时自动回填其遥测，快照缺失时进入历史对话即经底层会话 JSONL（IPC `pi_get_session_telemetry`，逐 assistant usage 累加还原累计消耗与上下文占用，纯本地文件解析不依赖内核）直接回填历史额度状态，无需先发起对话，磁盘不可读写时静默降级为仅内存保留）+ 无内核安静降级；
- **多模态文件/文件夹拖拽与剪贴板智能粘贴**：支持将文件、图片、文件夹直接拖拽入对话框或主窗口，并全面支持直接按 `Ctrl+V`（或右键粘贴）粘贴截图图片（微信/QQ/系统截图位图自动落盘为临时文件）、Windows 资源管理器复制的文件与文件夹（Rust 原生 `CF_HDROP` 句柄解析绝对路径）及本地路径文本，自动识别转化为手绘概述胶囊（文件夹不炸裂展开，发起对话时自动注入系统绝对路径）；普通自然语言文本与代码放行原生粘贴；
- **会话回退与文件撤回**：Flow 支持回退到任意一次历史对话（配合 pi内核原生 fork 历史节点回退），基于工具执行前确定性快照自动还原「已修改/已删除」的文件（新增文件永不撤回），并实现历史记录双向同步与草稿态解耦（首轮回退物理清理历史、多轮回退同步剪枝、防幽灵反向覆写），完成后顶部浮窗提醒成功/失败（持续 3 秒）；
- **中途提问人工回归选择**：模型/扩展在运行中途发起的人工交互请求（内核 Extension UI 子协议 `select` / `confirm` / `input` / `editor`）在 Flow 中呈现手绘待答横条与作答弹窗，用户作答后回写 `extension_ui_response` 解除内核阻塞并续跑；带 `timeout` 的请求由内核自动按默认值解析（卡片读秒示意）；未决请求随任务挂起保留、回入 Flow 100% 重建，终止时 best-effort 回写取消；
- **后台多任务管理与状态无缝挂起**：支持多任务并发、前后台活跃任务直接切换无感自动挂起（防幽灵任务丢失）、显式「⏹ 终止」强制彻底杀灭子进程与防后台泄漏（杜绝 Token 消耗与迟到事件复活）、终态任务与活跃任务挂起彻底解耦（杜绝幽灵已完成徽标）、会话延续透传与多轮归属唯一性保证（`--session <path>` 续写同一底层文件，彻底杜绝历史被割裂为新记录）、会话流与文件变更收纳框隔离恢复，右上角 Mini 任务胶囊与半透明抽屉实时联动、历史记录持久化尺寸预算与优雅降级（`ConversationHistoryService` 针对工具卡片 HTML 快照等重载荷设三级体积上限：全列表 / 单条会话 / 逐轮回答，写入前自最旧会话剥离重载荷快照、仍超则物理丢弃最旧会话，localStorage 写入失败再逐级降级重试，最新一条记录任何情况下永远优先完整落盘，彻底杜绝「新会话界面内可见、重启后从历史记录消失」的静默丢失，另设 30 天未打开自动归档清除：`lastViewedAt` 距今超过 30 天的历史会话快照在启动加载与每次持久化时自动从内存与 localStorage 清除（仅清 UI 层快照，底层 Pi 会话文件不受影响，还原/点开时自动刷新时间保活））；
- **工作区路由调度中枢**：提供 `code-area` 免污染路由调度中枢、Windows 原生文件夹选择器与多预设工作区平滑切换；
- **组件推荐配置自动自愈**：联网搜索等组件的「后台静默执行」推荐配置在组件安装 / 更新 / 应用启动三个时机自动合并写入并严格回读校验；预设有多个配置路径时全部双写覆盖（如 `pi-web-access` 同时写入 `~/.pi/agent/web-search.json` 与 `~/.pi/web-search.json`），杜绝组件升级更改默认配置路径后静默配置被忽略、联网搜索重新弹出网页端人工确认；
- **组件缺陷补丁自愈**：第三方组件的源码级缺陷（如 `pi-ocr` 1.4.x 在 Windows 上硬编码 `python3` 命中 Microsoft Store 占位 stub 导致 OCR 必失败、PDF 页数统计缺 win32 分支）由应用层修复后内嵌进软件，在组件安装 / 更新 / 应用启动三个时机自动物化到已安装组件目录，带**版本闸门**（仅匹配验证过的 major.minor，组件升级换版绝不盲目覆盖）、**存在性闸门**与**幂等回读校验**，面板亦提供「修复补丁」手动入口；
- **手绘草图美学与组件套件**：全域手绘 SVG 图元、明暗纸质双模自适应，配套 `SketchSelect` / `SketchAutoFill` / `SketchModal` 原生草图组件；
- **Rust 高性能核心与自愈保障**：底层孤儿进程级监管、内核崩溃平滑自动重连、模型调用无痕内置重连（总开关绝对一票否决：未勾选时全链路严禁触发重连且同步清退内核 `settings.json` 的 `retry` 块杜绝底层自行重连；勾选开启时后台静默续发「继续」文本、全部 60 秒延迟重连并在续发后再延迟 60 秒、写死 10 次单次 120 秒即 120s * 10、提醒胶囊恒定置于会话流最下方并展示「自动内置重连 N/10 ...」实时倒数、等待延迟全周期支持手绘中断按钮或全局终止直接彻底中断一切、已有步骤记录完好保留、前台与后台挂起任务全域覆盖、拦截失败轮次残余 `agent-end` 彻底根治会话流异常中断、精准排除网络瞬态错误防止误判手动终止，10 次耗尽才弹出错误窗体且耗尽即锁定终态——后续重复错误帧绝不自动重连，仅手动「重试当前提问」（自动续发「继续」）/新提问可重新发起；手动终止后全链路绝不复活重连，已彻底取消自动切换模型逻辑）、**流中断宽容期黄色倒计时等待**（内核回显 `Stream ended without finish_reason` 流截断、服务商回显 `Inference request failed.` 推理请求瞬时失败或网关回显 `upstream failure` 上游瞬时不可用等瞬态错误时绝不立即弹出红色错误卡，改在会话流最下方呈现手绘黄色等待消息框，写死 300 秒逐秒倒数「等待模型响应中 · Ns」，期间模型恢复输出或会话正常收口即静默撤销、仅超时未恢复才弹出红色提醒卡，等待全周期支持随时彻底终止）、Node.js 运行环境极速预检与 Windows 桌面级系统集成。

> 📖 **完整特性与架构规范**：详见项目内置开发技能 [`.agents/skills/pi-desktop-overview/SKILL.md`](.agents/skills/pi-desktop-overview/SKILL.md)。

---

## 🚀 快速开始与桌面端开发运行

> ⚠️ **重要前置准备**：项目启动之前，请自行将 [`.mytools/pi-body/pi-windows-x64.7z`](.mytools/pi-body/pi-windows-x64.7z) 解压（解压后完整路径为 `.mytools/pi-body/pi-windows-x64/`，包含 `pi.exe` 等核心二进制）。

### 常用命令
```bash
# 1. 安装依赖
npm install

# 2. 极速编译检查（推荐日常修改后验证，~1s）
npm run check

# 3. 启动桌面端开发调试
npm run dev

# 4. 前端静态校验门禁（语法 + import 图解析 + 循环依赖检测，~复合重构前必做）
npm run check:fe

# 5. 耦合度量基线（自动化约 §1 指标，每阶段对比“在降”）
npm run measure:coupling

# 6. 构建测试（生成二进制，无需打包）
npm run build:check

# 7. 正式发布构建（生成安装包）
npm run build
```

### 多工作区切换与 `code-area` 路由调度中枢
1. 点击主界面左下角手绘齿轮按钮进入「设置」全屏页，在左侧选择 **「工作区」**；
2. **`code-area` 路由工作区特性**：
   - 基于 Rust `rfd` (IFileOpenDialog) 实现 Windows 原生 OpenFolder 文件夹选择器，支持目录浏览、绝对路径输入与历史项目快速切换；
   - 每次切换或启动时自动校验目标项目存在性，失效时自动清理；
   - `code-area` 自身驻留 Hub 技能集（`code-area/.agents/skills/`），运行时调度内置技能指挥操作外部路由目标项目，免污染自身代码；
3. **预设切换**：点击「预设工作区」列表中的「切换」即可平滑生效（首次选中整目录复制模板至 `~/.pi-dl/workspaces/<id>/`，主宿主空闲时自动重启内核重锚 CWD）。

---

## ⚙️ Pi 内核与生态配置

Pi Desktop Lite 深度依托 Pi 原生内核生态，全面支持主流大模型接入（OAuth / API Key / 环境变量 / 本地 Ollama 等）与丰富的扩展组件体系（Packages 扩展包 / Agent Skills / TypeScript Extensions）。

> 📖 **生态配置与组件指南**：有关模型鉴权、端点接入、扩展包管理与插件开发的完整配置说明，请查阅开发技能文档 [`.agents/skills/pi-ecosystem-configuration/SKILL.md`](.agents/skills/pi-ecosystem-configuration/SKILL.md)。

---

## 📁 项目目录拓扑

```text
pi-desktop-lite/
├── .agents/skills/             # 项目开发级技能规范定义 (pi-ecosystem-configuration, auto-compile-and-fix, sketch-drafting-ui 等)
├── .mytools/pi-body/           # 最新 Pi Agent Release 引擎包 (含 pi-windows-x64.7z 压缩包，开发前需解压为 pi-windows-x64 目录)
├── default-area/               # Pi 默认工作区目录（打包与运行时隔离工作空间）
├── workspaces/                 # 公共预设工作区模板（code-area 代码工程中枢 / research-area 深度调研区）
├── scripts/                    # 自动化与环境配置脚本 (tauri.js, check.js, check-frontend.js, measure-coupling.js)
├── src/                        # 前端页面源码与运行时资源
│   ├── assets/                 # 静态资源 (logo.svg, logo.ico, 手绘 SVG 图标)
│   ├── lib/                    # 跨模块共享基础件 (dom-utils, icons, markdown-renderer, view-constants, event-bus 同步事件总线, el-binder DOM 按需自绑定, contracts 事件通道契约表 + api 槽契约定型)
│   ├── modules/                # 按功能域拆分的 UI 业务模块（由 main.js 统一编排；flow-render 纯渲染 / flow-dom 只读 DOM 引用 / flow-state-view 视图派生缓存属主）
│   │   ├── view-mode.js        # 四态状态机与设置页路由
│   │   ├── flow-ui.js          # Flow 渲染核心：Markdown、轮次 DOM、悬浮提问、上下定位导航
│   │   ├── flow-render.js      # Flow 纯渲染层：工具/思维/阶段卡片创建、入参/结果 HTML 格式化（无副作用，显式 import）
│   │   ├── flow-dom.js         # Flow 域只读 DOM 引用层：createFlowDom() → ctx.flowDom，flow-* 模块只读引用
│   │   ├── flow-state-view.js  # Flow 视图派生缓存唯一属主：flowView 密封对象（密封隔离，严禁入 store）
│   │   ├── flow-stream.js      # 流式状态机、错误卡渲染、内置重连胶囊与流中断宽容期
│   │   ├── flow-pipeline.js    # 提问下发、工具调用事件、内置重连引擎与发送拦截
│   │   ├── flow-human-input.js # 中途提问人工回归选择：待答横条 + SketchModal 作答弹窗 + extension_ui_response 回写
│   │   ├── flow-file-changes.js # 会话文件变更收纳框（新增/修改/删除文件汇总，点击打开所在文件夹；按 Task 会话流缓存，回入 Flow 一致恢复；含逐条变更日志供回退预览/剪枝）
│   │   ├── flow-rollback.js     # 会话回退编排（轮次「回退到此处」入口、SketchModal 确认、文件撤回还原 + 内核 fork + 剪枝重渲 + 3 秒浮窗提醒）
│   │   ├── task-panel.js       # 后台任务胶囊、侧边栏、历史恢复与快照归档
│   │   ├── sessions-panel.js   # 会话记录列表、搜索筛选、进入 Flow 管线与界面会话清空
│   │   ├── token-telemetry.js # 对话框旁「额度」遥测图标：两个同心缺口圆弧 + 小闪电纯粹微型仪表（无刻度表、圆弧加粗，取消小闪电常态模糊光晕，新一轮 thinking/point/工具调用 1 秒弧光高亮）+ 上下文消耗 / 全局动态均值推理速度（剔除工具调用窗口与产出停摆期，thinking / point / toolcall 参数生成 / 首 token 延迟期速度定格不衰减，四档阈值着色 <50红/<100橙/<200绿/≥200蓝）/ 已消耗 token（动态量级配额阶梯 1M→10M→1B… 绿/橙/红）悬浮面板；会话数据保留（stats 按 taskId 分仓 + sessionPath 快照入 localStorage，收口 / 重启 / 历史会话还原仍展示该会话遥测；快照缺失时经 IPC `pi_get_session_telemetry` 解析底层会话 JSONL usage 累加即时回填，进入历史对话无需先发起新对话即显示历史额度）
│   │   ├── workspace-panel.js  # 多预设工作区设置面板与路由绑定
│   │   └── global-interactions.js # 全局右键/Esc 回退与外链拦截
│   ├── services/               # 前端服务层 (tauri-bridge, config-service, pi-client, model-failover 内置重连引擎, workspace-service 等)
│   │   └── stores/             # 共享可变状态唯一属主 (view-store, settings-store, attachments-store, flow-store 按 taskId 分仓)
│   ├── styles/                 # 按功能域拆分的手绘样式 (tokens, layout, flow, markdown, settings, form-widgets 等)
│   ├── index.html              # 页面主体
│   ├── styles.css              # 样式聚合入口 (@import 各功能域子样式)
│   └── main.js                 # 前端编排主入口
├── src-tauri/                  # Tauri (Rust) 高性能后端核心
│   ├── extensions/             # 内置内核扩展 (pi-rollback-guard.ts 会话回退快照守卫、pi-tool-sanitizer.ts 工具入参自愈解包净化器，启动时物化至全局扩展目录)
│   ├── inner-skills/           # 应用内置运行态约束技能与规则 (RULES.md, bash兼容, OCR文档解析, 多Agent, 联网搜索, 临时文件沙盒, 工具失败日志 等)
│   └── src/                    # Rust 源码 (lib.rs, main.rs, commands/, config_manager/, workspace, pi_runner, security, session)
├── AGENTS.md                   # 项目规则与代理行为准则
├── README.md                   # 项目介绍与完整配置指南（中文）
├── README_en.md                # 英文介绍与完整配置指南（English）
└── package.json
```
