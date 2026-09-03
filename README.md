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

- **四态界面与 Flow 流式交互**：涵盖详细版、专注版、Flow 流式交互版及设置页，支持单行紧凑思维链与 Typedown 质感 Markdown 预览；
- **后台任务与工作区路由**：任务无感后台挂起与历史轮次恢复，提供 `code-area` 免污染路由调度中枢与多预设工作区切换；
- **手绘草图美学与组件套件**：全域手绘 SVG 图元、明暗纸质双模自适应，配套 `SketchSelect` / `SketchAutoFill` / `SketchModal` 原生草图组件；
- **Rust 高性能核心与自愈保障**：底层孤儿进程级监管、内核崩溃平滑自动重连、Node.js 运行环境极速预检与 Windows 桌面级系统集成。

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

# 4. 构建测试（生成二进制，无需打包）
npm run build:check

# 5. 正式发布构建（生成安装包）
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
├── custom-workspaces/          # [私有化] 私人定制/专有交付工作区（.gitignore 物理隔离，不随安装包打包，定向分发）
├── scripts/                    # 自动化与环境配置脚本 (tauri.js, check.js)
├── src/                        # 前端页面源码与运行时资源
│   ├── assets/                 # 静态资源 (logo.svg, logo.ico, 手绘 SVG 图标)
│   ├── lib/                    # 跨模块共享基础件 (dom-utils, icons, markdown-renderer, view-constants)
│   ├── modules/                # 按功能域拆分的 UI 业务模块（由 main.js 统一编排）
│   │   ├── view-mode.js        # 四态状态机与设置页路由
│   │   ├── flow-ui.js          # Flow 渲染核心：Markdown、轮次 DOM、悬浮提问、上下定位导航
│   │   ├── flow-stream.js      # 流式状态机、错误卡渲染与自动重连胶囊
│   │   ├── flow-pipeline.js    # 提问下发、工具调用事件、自愈引擎与发送拦截
│   │   ├── task-panel.js       # 后台任务胶囊、侧边栏、历史恢复与快照归档
│   │   ├── sessions-panel.js   # 会话记录列表、搜索筛选、进入 Flow 管线与界面会话清空
│   │   ├── workspace-panel.js  # 多预设工作区设置面板与路由绑定
│   │   └── global-interactions.js # 全局右键/Esc 回退与外链拦截
│   ├── services/               # 前端服务层 (tauri-bridge, config-service, pi-client, workspace-service 等)
│   ├── styles/                 # 按功能域拆分的手绘样式 (tokens, layout, flow, markdown, settings, form-widgets 等)
│   ├── index.html              # 页面主体
│   ├── styles.css              # 样式聚合入口 (@import 各功能域子样式)
│   └── main.js                 # 前端编排主入口
├── src-tauri/                  # Tauri (Rust) 高性能后端核心
│   ├── inner-skills/           # 应用内置运行态约束技能与规则 (RULES.md, bash兼容, OCR文档解析, 多Agent, 联网搜索 等)
│   └── src/                    # Rust 源码 (lib.rs, main.rs, config_manager, workspace, pi_runner, security, session)
├── AGENTS.md                   # 项目规则与代理行为准则
├── README.md                   # 项目介绍与完整配置指南（中文）
├── README_en.md                # 英文介绍与完整配置指南（English）
└── package.json
```
