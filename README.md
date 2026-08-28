# pi-dl (Tauri Desktop App)

一个极简手绘与工程绘图线条风格的桌面端研究与搜索应用，参考 **Anthropic Research** 与 **Pi.dev** 设计美学，基于 **Tauri 2 + 原生 Web 前端（HTML / CSS / JS）** 构建。

## ✨ 特性
 
- 🤖 **AI-Agent 三态核心界面系统**：
  - **界面1（初始界面-详细版 `detailed`）**：默认完整视图，包含沉浸标题栏、手绘齿轮设置按钮、完整输入框功能（导入图标/清空/Enter快捷引导）与底部快捷标签；
  - **界面2（初始界面-专注版 `focus`）**：单击/聚焦输入框即可自动进入，界面极简纯粹，仅保留居中手绘 $\pi$ Logo 徽标与纯净手绘输入框，彻底隐藏所有多余按钮；
  - **界面3（Flow 流式交互版 `flow`）**：输入内容并回车触发，手绘 Logo 优雅移至左上角，主体区展示真实手绘思考过程卡片（支持折叠/耗时/实时打字流）、工具调用卡片（支持 bash / 文件编辑等可折叠日志）与 Markdown 流式回答，输入框平滑下移并自适应拉长；
- ⚡ **高性能纯 Rust (Tauri 2) 四大后端子系统**：
  - 🛡️ **`pi_runner` (进程监督与孤儿收割)**：Windows 原生 Win32 Job Object 内核级级联收割，杜绝僵尸进程；严格 `\n` (LF) 字节流分帧器；滑动窗口崩溃自愈（30s 内超 2 次熔断保护）；
  - 🔒 **`security` (正则数据脱敏中间件)**：过滤 API Key / Token / 凭据并脱敏本地私有路径为 `[USER_HOME]`；
  - 🔄 **`version_watcher` (抗抖动版本监测引擎)**：启动延迟 30s 自检，6h 周期轮询带 ±8% Jitter 随机抖动与 15s Watchdog 超时熔断；
  - 📁 **`session` (并发内存索引与监听)**：基于 `DashMap` 并发内存缓存与 `notify` 监听 `~/.pi/sessions/`，实现毫秒级会话检索与分支树导航；
- 🔄 **全域右键“返回上一步 (Step Back)”层级流水线**：
  - 在任意位置点击右键：关闭抽屉模态框 ➔ `Flow (界面3, 触发 abort 中止)` ➔ 回退至 `专注版 (界面2)` ➔ 回退至 `详细版 (界面1)` ➔ 输入框失焦/清空；
- 📌 **系统右下角托盘与后台休眠常驻**：
  - **关闭即后台休眠**：右上角“关闭”按钮与系统关闭请求拦截，隐藏窗口保持后台运行与托盘驻留；
  - **托盘菜单与唤醒**：托盘右键菜单支持“打开”、“设置”（弹出设置与会话抽屉）、“退出”（彻底杀死后台完全退出应用）；左键单击或双击托盘图标立即唤醒并聚焦窗口。
- ✏️ **简约线条与手绘草图美学**：融合学术研究与工程绘图质感，采用手绘 $\pi$ 徽标、自然有机微弧度线框及手绘矢量图标，告别千篇一律的 AI 模版味。
- 🎨 **大范围克制微渐变**：浅色模式采用高质感暖调素描绘图纸（Warm Oatmeal Paper），深色模式采用素描炭黑质感（Charcoal Blackboard），摒弃急促刺眼的高饱和渐变。
- 🪟 **隐藏式沉浸标题栏**：纯净无文本干扰，严格限制顶部 30px 区域响应拖拽移动，支持双击切换最大化与手绘线条控制按钮（最小化、最大化/还原、关闭）。
- 🎯 **智能焦点与失焦管理**：点击输入框获得手绘加深与纸质微投影高亮，点击背景空白区或点击鼠标右键立即取消高亮失焦。
- 💡 **灵感提示语动态轮播**：内置 17 条思维草图哲学提示语，每隔 30 分钟周期无感随机刷新，基于 `Math.floor(N / 2)` 动态冷却队列算法避免短期重复命中，并支持应用重启跨会话状态恢复。
- ⚙️ **手绘齿轮设置与会话抽屉**：输入框左侧手绘齿轮按钮，点击滑出手绘纸质抽屉，集成 Pi Host 状态查看与一键重启、版本更新感知检测、历史会话切换与新建会话功能。统一遵循“常态透明、无常态边框、悬浮显框”铁律。

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 启动桌面端开发调试
```bash
npm run dev
# 或
node scripts/tauri.js dev
```

### 3. 构建测试（无需安装包打包）
```bash
npm run build:check
```

### 4. 正式发布安装包构建
```bash
npm run build
```

## 📁 目录结构

```text
pi-desktop-lite/
├── .agents/skills/             # 项目技能规范定义 (auto-compile-and-fix, sketch-drafting-ui 等)
├── .doc/                       # 架构规划与实施运维文档
│   ├── pi-agent-architecture.md# Pi Agent 高性能数据交互与版本监测架构设计
│   └── issues-and-risks.md     # 联通与实施问题、隐患与运维要点汇总
├── .mytools/pi-body/           # 最新 Pi Agent Release 引擎包 (pi-windows-x64/pi.exe)
├── scripts/                    # 自动化与环境配置脚本 (tauri.js runner)
├── src/                        # 前端页面源码与运行时资源
│   ├── assets/                 # 静态资源 (logo.svg, logo.ico)
│   ├── services/               # 前端服务层
│   │   ├── pi-client.js        # 对接 Rust 后端 supervisor 的流式通信客户端
│   │   ├── session-service.js  # 历史会话管理与切换服务
│   │   └── version-service.js  # 版本检测与更新通知服务
│   ├── index.html              # 页面主体（隐藏式标题栏 + 手绘Logo + 三态流容器 + 设置抽屉）
│   ├── styles.css              # 手绘线条、微渐变、按钮交互规范与系统自适应明暗主题样式
│   └── main.js                 # 状态机分发、流式渲染、思维卡片、工具卡片与右键回退流水线
├── src-tauri/                  # Tauri (Rust) 高性能后端核心
│   ├── Cargo.toml              # 依赖: tokio, serde, dashmap, notify, reqwest, regex, windows-sys
│   ├── tauri.conf.json         # 窗口无边框、原生透明与安全策略配置
│   └── src/
│       ├── lib.rs              # Tauri 状态初始化、命令注册、事件广播与托盘集成
│       ├── main.rs             # 程序主入口
│       ├── pi_runner/          # [核心] 进程管理、Win32 Job Object 孤儿收割、严格 LF 分帧器
│       ├── security/           # [核心] 正则脱敏中间件 (API Key / 用户隐私路径自动脱敏)
│       ├── session/            # [核心] DashMap 内存会话索引与 notify 增量文件监视
│       └── version_watcher/    # [核心] Jitter 随机抖动版本监测与双源更新探测
├── AGENTS.md                   # 项目规则与代理行为准则
├── README.md                   # 项目介绍与说明文档
└── package.json
```
