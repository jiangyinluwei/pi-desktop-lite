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

## ✨ 核心特性亮点

- **手绘工程绘图美学**：1.2~1.4px 实墨草图线框与柔和纸质双模主题，全域消除系统 Emoji，统一手绘矢量图元；
- **四态极简交互流**：详细版（多行输入、历史翻阅、多模态附件胶囊）➔ 专注版 ➔ Flow 交互版 ➔ 设置全页面，全域右键/Esc 支持 Step Back；
- **Flow 流式因果步骤流**：单行紧凑折叠的思维切片、阶段 Point 切片与工具调用切片，过程永不自动展开；
- **图片直观展示与一键存桌面**：模型生成与输出的图片在 Flow 界面直观呈现（支持 Markdown 图片、HTML 标签与路径行）；本地磁盘图片经 Rust IPC 异步安全转码 Data URL，前端 Map 缓存防抖；支持点击全屏灯箱放大预览、手绘操作栏「一键保存到桌面」（时间戳防覆盖 + 翠绿对勾微反馈）与资源管理器高亮定位；纯生图任务若模型漏发 Markdown 语法，流式收口阶段自动探测会话新增图片并兜底自愈补全；
- **Typedown 质感 Markdown 与全域外链拦截**：代码块手绘徽标一键复制、Callout 警示框、外链经操作系统默认浏览器安全打开；
- **生图与多模态智能路由**：设置页「模型配置」内部顶部并列 Tab 翻页管理。当会话主模型为纯文本模型且出现图片生成或多模态识图任务时，自动调度路由模型（生图模型严格限制为 OpenAI 兼容 /images/generations 或 DashScope 异步生图接口，识图模型支持多模态视觉 LLM）；执行完毕后无缝切回原会话模型并回填产物与分析文本；
- **会话回退与文件撤回**：配合内核原生 RPC fork 历史节点，基于工具执行前确定性快照安全撤回已修改/删除文件（新增文件永不撤回）；
- **`code-area` 路由调度中枢**：物理 CWD 驻留技能 Hub，原生 Windows 选夹器透明绑定目标外部工程，严格免污染。

> 📖 **完整特性清单、23 项交互铁律与架构规范**：详见 [`.agents/skills/`](.agents/skills/) 下各开发技能（总览与特性矩阵：[`pi-desktop-overview`](.agents/skills/pi-desktop-overview/SKILL.md)；交互铁律：[`desktop-interaction-invariants`](.agents/skills/desktop-interaction-invariants/SKILL.md)；Flow 细节：[`flow-interaction-pattern`](.agents/skills/flow-interaction-pattern/SKILL.md)）。

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

# 4. 前端静态校验门禁（语法 + import 图解析 + 命名导出匹配 + 循环依赖检测，复合重构前必做）
npm run check:fe

# 5. 耦合度量基线（自动化架构降耦合指标）
npm run measure:coupling

# 6. 构建测试（生成二进制，无需打包）
npm run build:check

# 7. 正式发布构建（生成安装包）
npm run build
```

### 多工作区切换与 `code-area` 路由调度中枢
1. 点击主界面左下角手绘齿轮按钮进入「设置」全屏页，在左侧边栏选择 **「工作区」**；
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
├── .agents/skills/             # 项目开发级技能规范定义（总览 / 交互铁律 / Flow 模式 / 生态配置 / 编译门禁等，映射矩阵见 AGENTS.md）
├── .mytools/pi-body/           # 最新 Pi Agent Release 引擎包 (含 pi-windows-x64.7z 压缩包，开发前需解压为 pi-windows-x64 目录)
├── default-area/               # Pi 默认工作区目录（打包与运行时隔离工作空间）
├── workspaces/                 # 公共预设工作区模板（code-area 代码工程中枢 / research-area 深度调研区）
├── scripts/                    # 自动化与环境配置脚本 (tauri.js, check.js, check-frontend.js, measure-coupling.js)
├── src/                        # 前端页面源码与运行时资源
│   ├── assets/                 # 静态资源 (logo.svg, logo.ico, 手绘 SVG 图标)
│   ├── lib/                    # 跨模块共享基础件 (dom-utils, icons, markdown-renderer, view-constants, event-bus, el-binder, contracts 契约归口)
│   ├── modules/                # 按功能域拆分的 UI 业务模块（由 main.js 统一编排）
│   │   ├── view-mode.js        # 四态状态机与设置页路由
│   │   ├── flow-ui.js          # Flow 渲染核心：Markdown、轮次 DOM、悬浮提问、上下定位导航
│   │   ├── flow-render.js      # Flow 纯渲染层（无副作用，显式 import）
│   │   ├── flow-dom.js         # Flow 域只读 DOM 引用层 (createFlowDom → ctx.flowDom)
│   │   ├── flow-state-view.js  # Flow 视图派生缓存唯一属主 (flowView 密封对象)
│   │   ├── flow-stream.js      # 流式状态机、错误卡渲染、重连胶囊与流中断宽容期
│   │   ├── flow-pipeline.js    # 提问下发、工具调用事件、内置重连引擎与发送拦截
│   │   ├── flow-human-input.js # 中途提问人工回归：待答横条 + 作答弹窗 + extension_ui_response 回写
│   │   ├── flow-file-changes.js # 会话文件变更收纳框（按 Task 分仓缓存，回入 Flow 一致恢复）
│   │   ├── flow-rollback.js    # 会话回退编排（内核 fork + 文件撤回 + 剪枝重渲 + 浮窗提醒）
│   │   ├── task-panel.js       # 后台任务胶囊、侧边栏、历史恢复与快照归档
│   │   ├── sessions-panel.js   # 会话记录列表、搜索筛选、进入 Flow 管线
│   │   ├── token-telemetry.js  # 额度遥测图标：上下文消耗 / 均值推理速度 / 已耗 token 悬浮面板 + 历史回填
│   │   ├── image-routing-panel.js # 生图与多模态路由独立面板（接口协议过滤、双下拉框与状态同步）
│   │   ├── workspace-panel.js  # 多预设工作区设置面板与路由绑定
│   │   └── global-interactions.js # 全局右键/Esc 回退与外链拦截
│   ├── services/               # 前端服务层 (tauri-bridge, config-service, pi-client, multimodal-detector, image-routing-engine, model-failover, workspace-service 等)
│   │   └── stores/             # 共享可变状态唯一属主 (view-store, settings-store, attachments-store, flow-store 按 taskId 分仓)
│   ├── styles/                 # 按功能域拆分的手绘样式 (tokens, layout, flow, markdown, settings 等)
│   ├── index.html              # 页面主体
│   ├── styles.css              # 样式聚合入口 (@import 各功能域子样式)
│   └── main.js                 # 前端编排主入口
├── src-tauri/                  # Tauri (Rust) 高性能后端核心
│   ├── extensions/             # 内置内核扩展 (pi-rollback-guard.ts 回退快照守卫、pi-tool-sanitizer.ts 工具调用全链路自愈：0.86.0 工具锚定丢失回注/畸形工具名修复/入参外壳解包/私有协议标签正文泄漏抽取/空工具与 strict 防御过滤，启动时物化至全局扩展目录)
│   ├── inner-skills/           # 应用内置运行态约束技能 (RULES.md 映射总纲 + 9 个按需注入技能，机制见 inner-skills-injection 技能)
│   └── src/                    # Rust 源码 (lib.rs, main.rs, commands/, config_manager/, workspace, pi_runner, security, session)
├── AGENTS.md                   # 项目规则与代理行为准则（浓缩不变量 + 技能映射路由）
├── README.md                   # 项目介绍与完整配置指南（中文）
├── README_en.md                # 英文介绍与完整配置指南（English）
└── package.json
```
