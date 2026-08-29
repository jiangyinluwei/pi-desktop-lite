# pi-dl (Tauri Desktop App)

一个极简手绘与工程绘图线条风格的桌面端研究与搜索应用，参考 **Anthropic Research** 与 **Pi.dev** 设计美学，基于 **Tauri 2 + 原生 Web 前端（HTML / CSS / JS）** 构建。

---

## 🌐 官方资源与生态

- 🔗 **Pi 官方网站**：[https://pi.dev/](https://pi.dev/)
- 📦 **Pi 组件与扩展市场 (Package Gallery)**：[https://pi.dev/packages](https://pi.dev/packages)
- 🐙 **Pi 开源仓库**：[earendil-works/pi (GitHub)](https://github.com/earendil-works/pi)
- 📚 **官方技能库精选**：[Anthropic Skills](https://github.com/anthropics/skills) ｜ [Pi Skills](https://github.com/badlogic/pi-skills)

---

## ✨ 核心特性

- 🤖 **AI-Agent 四态核心界面系统**：
  - **界面1（初始界面-详细版 `detailed`）**：默认完整视图，包含沉浸标题栏、手绘齿轮设置按钮、完整输入框功能（导入图标/清空/Enter快捷引导）、**文件直接拖入与手绘概述胶囊（Overview Capsule）**（支持图片与各类文档/代码拖入或点击导入，在输入框内部渲染手绘矢量图标、文件名截断、绝对路径悬停 Tooltip 与手绘「×」移除按钮，发送时自动注入文件的系统绝对路径；多模态反馈智能分流：支持多模态则正常输出，纯文本模型若命中多模态限制则自动展示手绘草图建议条并提供一键直达安装扩展组件）、**动态历史对话讯息方框抽屉**（首行常态展示 3 个，鼠标悬浮绝对定位向下平滑展开且消除整体上移，下方每行 4 个依次延迟 1 秒级联渐出[每行耗时 1 秒平滑从透明渐变至显示，第 2 行 0s~1s, 第 3 行 1s~2s, 第 4 行 2s~3s...]，移出时触发 2 秒平滑渐隐[耗时 2 秒从完全显示淡出至完全透明]，自适应视口高度，支持 MRU 最近浏览排序、点击一键恢复对话与悬浮「×」局部隐藏）及内置自适应灵感格言跑马灯（超长文本自动从右向左无缝循环滚动）；
  - **界面2（初始界面-专注版 `focus`）**：单击/聚焦输入框即可自动进入，界面极简纯粹，仅保留居中手绘 $\pi$ Logo 徽标与纯净手绘输入框（支持格言自适应滚动），彻底隐藏所有多余按钮；
  - **界面3（Flow 流式交互版 `flow`）**：输入内容并回车触发，手绘 Logo 优雅移至左上角，提问卡片展示手绘附件微徽章，主体区展示手绘思考过程卡片（最新一轮默认展开、限高滚动、随输出或新框出现触发自动收起、支持手动折叠与耗时记录）、工具调用卡片（支持 bash / powershell / 文件编辑等可手动/级联折叠日志）与纯净 Markdown 流式回答（最终回答卡片常态展示），支持全区域滚轮委托滑动，输入框平滑下移并自适应拉长；
  - **界面4（项目设置独立全屏页面 `settings`）**：非浮窗全屏视图，整合外观与常规、模型配置、内核与包管理、会话记录。
- 📎 **多格式文件拖入、手绘概述胶囊与多模态自适应系统 (`File Drag-Drop & Multimodal System`)**：
  - 支持直接将图片（png/jpg/jpeg/gif/webp/svg/bmp 等）与文档/代码（docx/pdf/txt/md/json/py/rs 等）拖拽至输入框或点击导入图标选取；
  - 输入框内以手绘微边框胶囊展示，悬停显现绝对路径，点击「×」快速剔除；
  - 上下文绝对路径自动结构化注入，Flow 提问卡片展示对应手绘附件微徽章；
  - 多模态反馈自适应处理：正常流式输出不干预；若模型不支持多模态且未安装相应 Pi 插件，则输出报错并在手绘卡片中提示「💡 建议：当前模型不支持多模态，可前往安装推荐 Pi 扩展组件弥补能力」并提供一键直达安装。
- 🧠 **对话历史沉淀与业务记忆接口层 (`Conversation History & Memory Interface`)**：
  - 自动捕获 Flow 流式对话快照（问题、思考链、工具调用、回答与元数据），沉淀至输入框下方讯息方框；
  - 严格按 MRU 浏览时间自动排序，点击任一讯息即刻刷新时间戳跃升至首位，并无缝恢复完整对话到 Flow 模式；
  - 支持悬浮「×」按钮局部隐藏（保留底层会话文件与持久化记录）；
  - 提供标准业务级记忆接口层，预留随时挂载 Pi 官方/社区 Memory 扩展（如 `pi-memory` / NPM 组件）的标准插件钩子；
- 🎨 **全域手绘工程草图 SVG 矢量图元体系**：项目前端彻底清除所有系统默认 Emoji 符号，统一设计并内联 20 款手绘草图风格 SVG 矢量图元（`src/assets/svg/`），配合 `currentColor` 严格实现浅色（素描绘图纸）与深色（炭黑素描黑板）双模毫秒级自适应；
- 📜 **隐藏式极简滚动条体系**：全域消除上下图标与滚动槽，常态为 4px 隐匿窄竖条，悬浮可滚动内容区不高亮，仅鼠标移入滚动条本身范围时自适应放大至 6px 并高亮加深；
- 📐 **手绘草图质感自定义下拉框 (Pop-Shake)**：封装 `SketchSelect` 组件，展开时触发迅速轻快的弹出微抖动动画（Pop & Micro-Shake，约 180ms 快速回弹），边框、底色、字色完美适配纸质与黑板双模，双向同步原生 `<select>` 数据与事件；
- ⚡ **高性能纯 Rust (Tauri 2) 后端核心架构**：
  - 🪟 **单实例互斥与防重复启动 (`single-instance`)**：全局保证软件仅有一个实例运行，检测到重复启动时新进程直接退出，并自动将已有主窗口取消最小化、唤醒并置顶聚焦；
  - 🛡️ **`pi_runner` (进程监督与孤儿收割)**：Windows 原生 Win32 Job Object 内核级级联收割，杜绝僵尸进程；严格 `\n` (LF) 字节流分帧器；滑动窗口崩溃自愈（30s 内超 2 次熔断保护）；`default-area` 默认隔离工作区自动探测与工作目录锁定（源码工作区优先 + 独立 `AGENTS.md` 防穿透规则与自动播种保障，打包时完整打包至 Release 资源目录，预留动态切换接口）；
  - 🧩 **`package_manager` (官方组件市场、生命周期与智能配置预设)**：连通 Pi 官方 Package Catalog (pi.dev/packages)，基于轻量正则解析与 15min TTL 缓存提取结构化组件；精确探测本地已安装组件及版本；内置全局单任务互斥锁（Mutex）与 FIFO 异步任务队列，支持批量连续点击加入队列并自动按序出队执行；接入 `ProgressStepper` 平滑步进引擎（阶段等待期间每 2s 自动 +1% 直到下个阶段 - 1%，新阶段触发立即跳变响应）；调用 `pi install/remove npm:<pkg> -a` 执行非阻塞安装与卸载；并发查询 npm registry API 进行 SemVer 版本比对与一键更新；**内置插件默认配置预设映射系统 (`presets.json` 编译内嵌至二进制)**，触发插件安装时自动应用推荐配置（如 `pi-web-access` 自动静默后台与禁用弹窗），未配置项在已安装列表支持一键「推荐配置」手动应用；**内置推荐 Pi 插件列表 (`recommended-plugins.json` 编译内嵌至二进制)**，在「检查组件更新」按钮左侧集成「安装推荐插件」按钮，支持一键队列安装所有未安装的推荐插件（自动跳过已有插件，当全部推荐插件均已安装时动态自动隐藏）；
  - 🔒 **`security` (正则数据脱敏中间件)**：过滤 API Key / Token / 凭据并脱敏本地私有路径为 `[USER_HOME]`；
  - 🔄 **`version_watcher & kernel_updater` (抗抖动版本监测与一键内核更新引擎)**：启动延迟 2s 自检，6h 周期轮询带 ±8% Jitter 随机抖动与 15s Watchdog 超时熔断；支持“不再提醒更新”持久化（写入 `~/.pi-dl/config.json`，生效后直接跳过启动自检与后台自动轮询，不发网络请求；在设置页主动点击“检查更新”时自动重置恢复）；提示框 8 秒平滑自动渐隐；支持流式 HTTP 管道下载与 `ProgressStepper` 平滑步进引擎（仅保留最右侧百分比，阶段等待期间每 2s 自动 +1% 直到下个阶段 - 1%，新阶段触发立即跳变响应）、支持一键取消更新（`pi_cancel_kernel_update` 安全终止下载流与清理临时文件），在 `~/.pi-dl/` 执行 staging 暂存、`--version` 预检校验、原子备份替换旧内核并热重启 `PiSupervisor`，实现零提权免安装无感热升级；
  - 📁 **`session` (并发内存索引与监听)**：基于 `DashMap` 并发内存缓存与 `notify` 监听 `~/.pi/sessions/`，实现毫秒级会话检索与分支树导航；
  - ⚙️ **`config_manager` (配置管理与目录映射)**：双向管理 `~/.pi-dl/config.json` 及 `~/.pi/agent/` 下的 `auth.json`、`models.json`、`settings.json`；
- ⚙️ **工程级独立设置全页面与模型配置系统 (Settings View)**：
  - 🖥️ **独立全页面视图 (4 大 Tab 导航)**：作为与详细版/专注版/Flow版平级的独立全屏视图，整合「外观与常规」、「模型配置」（集成当前模型列表与折叠式官方/自定义通道配置）、「内核」、「会话记录」，右上角操作指引（“**提示：在任意位置点击鼠标右键或按 Esc 即可快速回退**”）进入后 3 秒自动平滑渐隐；
  - 📐 **主界面统一配色与非嵌套线框设计**：设置界面配色与主界面完全统一，去除所有高饱和鲜艳颜色，统一采用低饱和度功能色；严格减少层叠 Panel 卡片与胶囊 Tips，外层采用标准细边框（`var(--sketch-border-subtle)`）包裹，内部采用透明底色；
  - 💾 **应用全局配置持久化 (`~/.pi-dl/config.json`)**：界面主题色、默认思考推理深度（Thinking Level）、默认选中模型及模型顺序等统一持久化至 `~/.pi-dl/config.json`（自动创建目录）；
  - 📋 **模型配置 (MRU 自动排序、首位选中固定、激活锁定与折叠式通道抽屉)**：
    - 模型列表限制最大高度（240px）与隐藏式极简滚动条，**第一行始终固定为当前激活选中的模型（锁定且禁止删除）**；新增模型自动插入在当前选中模型之后（index 1），绝不挤占首位；点击选用立即生效并移至首位；
    - 列表下方内置「官方通道配置 - 展开」与「自定义通道配置 - 展开」（统一复用下拉框手绘 `ic_chevron_down.svg` 矢量微箭头）操作栏，默认处于隐藏状态；
    - 点击展开任一通道配置后，模型列表自动折叠仅显示当前生效的选中项，按钮动态切换为「收起」（微箭头平滑旋转 180° 朝上）与通道切换按钮，支持自由切换通道与一键收起恢复；
  - ⚡ **官方通道配置 (API Key 自动映射与模型拉取)**：支持 Anthropic Claude, OpenAI, DeepSeek, Google Gemini, OpenRouter, 通义千问 Qwen, 月之暗面 Kimi, MiniMax, Groq, xAI Grok 等官方通道，配置 API Key **自动写入 `~/.pi/agent/auth.json`**，并可一键自动拉取官方可用模型添加到列表；
  - 🛠️ **两步式自定义通道配置与规范吸附**：
    - **步骤 1（新增/配置运营商）**：配置 Provider ID、接口类型（支持 `openai-completions` (OpenAI Chat / 聚合代理 / 硅基 / 火山 / DeepSeek)、`openai-responses` (OpenAI Responses API / Azure)、`anthropic-messages`、`google-generative-ai`、`ollama`）、Base URL、API Key 及 developer role / reasoning 兼容参数；
    - **步骤 2（运营商配置修改与模型管理）**：在各运营商卡片内**支持一键修改运营商配置 (API 类型/URL/Key/兼容开关)**、新增与编辑挂载模型（模型 ID、显示名称、上下文窗口、输出上限及思考能力），**新增模型时思考推理选项默认勾选，输出上限输入任意数字在回车/失焦/保存时自动吸附匹配最接近的标准 Token 规范值**，**自动映射写入 `~/.pi/agent/models.json`** 并同步加入当前模型列表；
  - 🧩 **内核与扩展组件管理 (`Package Catalog & Kernel Runtime`)**：顶部集成底层 Pi 内核状态监控、软件版本、一键重启内核、检查更新与**一键内核热更新**（支持流式下载进度条与 Changelog 折叠预览）；连通 Pi 官方 Package Catalog，支持按关键词、类型（extension/skill/theme/prompt）与热度排序检索，折叠展示本地已安装扩展列表，提供多阶段手绘草图进度条与 `ProgressStepper` 引擎（解析 ➔ npm下载 ➔ 解压编译 ➔ 写入注册，等待期间每 2s 自动 +1% 直到下个阶段 - 1%），支持一键安装、批量检查更新、单包更新、卸载、**未配置项「推荐配置」一键应用**及**「安装推荐插件」一键队列安装**（已安装自动跳过，全部安装后自动隐藏）；
  - 📁 **会话历史管理**：支持历史会话列表展示、新建会话与毫秒级会话切换。
- 🔄 **全域右键“返回上一步 (Step Back)”层级流水线**：
  - 在任意位置点击右键：退出设置全屏视图 ➔ `Flow (界面3, 触发 abort 中止)` ➔ 回退至 `专注版 (界面2)` ➔ 回退至 `详细版 (界面1)` ➔ 输入框失焦/清空；

---

## 🔑 第一部分：Pi API 与大模型配置全指南

Pi Agent 支持 **OAuth 订阅账号**、**API 密钥直连**、**环境变量注入** 以及 **自定义/本地/兼容端点**（如 Ollama、vLLM、DeepSeek、硅基流动、OneAPI、Azure 等）。

### 凭据优先级 (Resolution Order)
```text
CLI 命令行参数 (--api-key) ➔ auth.json 文件配置 ➔ 系统环境变量 ➔ models.json 自定义配置
```

---

### 方式 1：交互式命令行登录（最简推荐）

在终端启动 `pi`，输入 `/login` 命令并选择对应提供商：

```bash
# 启动交互模式
pi

# 输入 /login，根据提示选择提供商
/login
```

- **OAuth 订阅登录**：支持 ChatGPT Plus/Pro (Codex)、Claude Pro/Max、GitHub Copilot、xAI (Grok)、OpenRouter、Radius。登录后 Token 自动保存并支持无感刷新。
- **API Key 交互式输入**：直接输入并回车，Pi 会自动加密保存在全局鉴权文件中。

---

### 方式 2：配置文件设置 (`~/.pi/agent/auth.json`)

Pi 的全局凭据保存在用户主目录的 `~/.pi/agent/auth.json` 中（Windows 路径通常为 `C:\Users\<用户名>\.pi\agent\auth.json`）。文件权限建议设为 `0600`（仅用户读写）。

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "sk-..." },
  "deepseek": { "type": "api_key", "key": "sk-..." },
  "google": { "type": "api_key", "key": "AIzaSy..." },
  "openrouter": { "type": "api_key", "key": "sk-or-v1-..." },
  "qwen-token-plan": { "type": "api_key", "key": "sk-sp-..." },
  "kimi-coding": { "type": "api_key", "key": "..." },
  "minimax": { "type": "api_key", "key": "..." }
}
```

#### 进阶技巧：动态 Key 与环境变量插值
`auth.json` 中的 `key` 字段支持高级动态解析：
- **环境变量插值**：`"key": "$MY_ANTHROPIC_KEY"` 或 `"${KEY_PREFIX}_KEY"`；
- **密码管理器命令读取**：`"key": "!op read 'op://vault/item/credential'"` 或 `"!security find-generic-password -ws 'anthropic'"`；
- **字面量转义**：`"key": "$$literal_dollar"`。

---

### 方式 3：系统环境变量注入

直接在终端或系统环境变量中设置对应的 API Key 即可：

| 提供商 (Provider) | 环境变量名称 (Environment Variable) | `auth.json` 对应 key |
| :--- | :--- | :--- |
| **Anthropic (Claude)** | `ANTHROPIC_API_KEY` | `anthropic` |
| **OpenAI (GPT-4o/o3)** | `OPENAI_API_KEY` | `openai` |
| **DeepSeek** | `DEEPSEEK_API_KEY` | `deepseek` |
| **Google Gemini** | `GEMINI_API_KEY` | `google` |
| **OpenRouter** | `OPENROUTER_API_KEY` | `openrouter` |
| **xAI (Grok)** | `XAI_API_KEY` | `xai` |
| **Mistral** | `MISTRAL_API_KEY` | `mistral` |
| **Groq** | `GROQ_API_KEY` | `groq` |
| **NVIDIA NIM** | `NVIDIA_API_KEY` | `nvidia` |
| **通义千问 (Qwen)** | `QWEN_TOKEN_PLAN_CN_API_KEY` | `qwen-token-plan-cn` |
| **月之暗面 (Kimi)** | `KIMI_API_KEY` | `kimi-coding` |
| **MiniMax** | `MINIMAX_CN_API_KEY` | `minimax-cn` |
| **Azure OpenAI** | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL` | `azure-openai-responses` |
| **Amazon Bedrock** | `AWS_BEARER_TOKEN_BEDROCK` (或 `AWS_PROFILE`) | `amazon-bedrock` |

---

### 方式 4：配置自定义提供商 / 本地模型 / 国内代理 (`~/.pi/agent/models.json`)

若需接入本地模型（Ollama / LM Studio / vLLM）或国内大模型代理聚合平台（OneAPI / NewAPI / 硅基流动），可创建或编辑 `~/.pi/agent/models.json`：

#### 1. 本地 Ollama 示例
```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen2.5-coder:7b",
          "name": "Qwen 2.5 Coder 7B (Local)",
          "reasoning": false,
          "contextWindow": 128000
        },
        {
          "id": "deepseek-r1:14b",
          "name": "DeepSeek R1 14B (Local)",
          "reasoning": true,
          "contextWindow": 64000
        }
      ]
    }
  }
}
```

#### 2. 自定义 OpenAI 兼容代理 / 国内平台（如硅基流动、DeepSeek 代理）
```json
{
  "providers": {
    "siliconflow": {
      "baseUrl": "https://api.siliconflow.cn/v1",
      "api": "openai-completions",
      "apiKey": "$SILICONFLOW_API_KEY",
      "models": [
        {
          "id": "deepseek-ai/DeepSeek-V3",
          "name": "DeepSeek-V3 (SiliconFlow)",
          "contextWindow": 64000,
          "reasoning": false
        },
        {
          "id": "deepseek-ai/DeepSeek-R1",
          "name": "DeepSeek-R1 (SiliconFlow)",
          "contextWindow": 64000,
          "reasoning": true
        }
      ]
    }
  }
}
```

> 💡 `models.json` 支持热加载，在会话中直接修改即可生效，无需重启 Pi。

---

### 方式 5：全局默认模型与思考强度设置 (`~/.pi/agent/settings.json`)

在 `~/.pi/agent/settings.json` 中可指定启动默认模型、默认提供商与思考预算（Thinking Level）：

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  },
  "defaultProjectTrust": "always"
}
```
- **Thinking Level 可选值**：`"off"`、`"minimal"`、`"low"`、`"medium"`、`"high"`、`"xhigh"`、`"max"`。

---

## 🧩 第二部分：Pi 组件（Packages / Skills / Extensions）下载与配置全指南

Pi 拥有高度可扩展的生态体系，包含 **Packages（一体化扩展包）**、**Skills（任务技能库）** 与 **Extensions（TypeScript 深度扩展插件）**。

---

### 1. Pi 包管理器 (Pi Packages)

Pi 内置了类似 npm/cargo 的一体化包管理命令，可自动下载并链接扩展、技能、Prompt 模板与主题。

#### ① 下载与安装组件包
```bash
# 1. 通过 npm 安装公开组件包
pi install npm:@foo/bar@1.0.0
pi install npm:pi-skills

# 2. 通过 GitHub / Git 仓库直接安装
pi install git:github.com/user/my-pi-package@v1.0
pi install https://github.com/badlogic/pi-skills

# 3. 通过本地开发目录安装
pi install ./my-local-package
pi install C:/Users/name/my-tools/package

# 4. 项目局部安装（仅在当前仓库生效，写入 .pi/settings.json）
pi install -l npm:@org/repo-tools
```

#### ② 组件包管理常用命令
```bash
pi list                     # 查看当前已安装的所有组件包
pi remove npm:@foo/bar      # 卸载指定组件包
pi update --all             # 更新 Pi 自身与所有已安装的组件包
pi update --extensions      # 仅更新扩展与组件包（保持 Pi 版本不变）
pi update npm:@foo/bar      # 更新单一指定组件包
```

#### ③ 免安装临时试用（当前会话有效）
```bash
# 无需正式安装，仅在单次执行中临时加载体验
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

---

### 2. 技能组件 (Skills - 遵循 Agent Skills 规范)

Skills 为模型提供**按需加载的专业工作流、规范指南与辅助脚本**（符合 [Agent Skills Specification](https://agentskills.io/specification)）。

#### ① 技能存放目录
Pi 启动时会自动扫描以下目录中的 Skills：
- **全局技能目录**：
  - `~/.pi/agent/skills/`
  - `~/.agents/skills/`
- **项目局部技能目录**：
  - 当前项目根目录下的 `.pi/skills/`
  - 当前项目根目录及父目录下的 `.agents/skills/`

#### ② 共享复用 Claude Code 与 OpenAI Codex 技能库
若已有 Claude Code 或 Codex 技能库，可在 `~/.pi/agent/settings.json` 中直接引用：
```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

#### ③ 技能标准结构规范 (`SKILL.md`)
每个技能通常为一个独立文件夹，根目录下必须包含 `SKILL.md`：
```text
my-custom-skill/
├── SKILL.md              # [必须] 包含 YAML Frontmatter 元数据与使用指导
├── scripts/              # [可选] 辅助自动化执行脚本 (bash / js / py)
└── references/           # [可选] 详细参考文档与架构模板
```

`SKILL.md` 模板示例：
````markdown
---
name: my-custom-skill
description: 专门用于处理数据清洗、格式转换与生成报告的技能。当用户提到数据分析或报表生成时使用。
---

# My Custom Skill

## 使用说明
运行以下脚本开始数据处理：
```bash
node ./scripts/process.js --input data.csv
```
````

#### ④ 技能触发方式
- **自动渐进式加载（Progressive Disclosure）**：Pi 默认将所有技能的 `description` 放入系统提示词，当用户任务匹配时，模型会自动通过 `read` 工具读取完整 `SKILL.md` 并执行；
- **手动强制调用**：在交互框中输入 `/skill:<skill-name>`（例如 `/skill:brave-search`）直接执行。

---

### 3. 扩展与工具组件 (Extensions)

Extensions 是使用 TypeScript 编写的运行级扩展，可以直接向 LLM 注册新工具（Custom Tools）、拦截工具调用（安全确认拦截）、监听生命周期或注册自定义 `/command`。

#### ① 扩展存放与自动发现目录
- **全局扩展**：`~/.pi/agent/extensions/*.ts` 或 `~/.pi/agent/extensions/*/index.ts`
- **项目局部扩展**：`.pi/extensions/*.ts` 或 `.pi/extensions/*/index.ts`

#### ② 编写自定义扩展示例
创建 `~/.pi/agent/extensions/custom-tools.ts`：
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // 1. 注册一个供 LLM 调用的自定义工具
  pi.registerTool({
    name: "fetch_weather",
    label: "Fetch Weather",
    description: "根据城市名称查询实时天气信息",
    parameters: Type.Object({
      city: Type.String({ description: "城市名称，如 Beijing" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // 执行业务逻辑
      return {
        content: [{ type: "text", text: `${params.city} 当前天气：晴朗，气温 22°C` }],
        details: {},
      };
    },
  });

  // 2. 注册危险操作前置安全拦截器
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const confirmed = await ctx.ui.confirm("高危命令拦截", "是否允许执行删除操作？");
      if (!confirmed) {
        return { block: true, reason: "用户拒绝执行高危删除操作" };
      }
    }
  });

  // 3. 注册自定义斜杠命令
  pi.registerCommand("ping", {
    description: "测试扩展连通性",
    handler: async (args, ctx) => {
      ctx.ui.notify("Pong! 扩展运行正常", "info");
    },
  });
}
```

#### ③ 热重载扩展
修改扩展代码后，在 Pi 交互界面中输入 `/reload` 即可瞬间热重载所有扩展，无需重启应用。

---

### 4. 交互式组件管理 (`pi config`) 与项目信任机制

#### ① 交互式组件管理器 (`pi config`)
在终端运行 `pi config`，将启动手绘 TUI 图形面板：
- 按 `Tab` 键可自由切换 **全局配置** (`~/.pi/agent/settings.json`) 与 **项目局部配置** (`.pi/settings.json`)；
- 使用上下光标键与回车键，可直观启用/禁用各个 Packages、Extensions、Skills 与 Themes。

#### ② 项目信任机制 (Project Trust)
为了保证本地代码执行安全性，Pi 默认对未信任的项目路径进行防护：
- 交互模式下首次打开包含 `.pi` 扩展的项目会弹出信任确认；
- 输入 `/trust` 可将当前项目加入信任名单 (`~/.pi/agent/trust.json`)；
- 若希望全局默认信任，可在 `~/.pi/agent/settings.json` 中配置 `"defaultProjectTrust": "always"`。

---

## 🚀 快速开始开发与运行桌面端

### 1. 安装依赖
```bash
npm install
```

### 2. 极速编译检查（推荐日常迭代与修改后验证，~1s）
```bash
npm run check
```

### 3. 启动桌面端开发调试
```bash
npm run dev
# 或
node scripts/tauri.js dev
```

### 4. 构建测试（生成二进制，无需安装包打包）
```bash
npm run build:check
```

### 5. 正式发布安装包构建
```bash
npm run build
```

---

## 📁 目录结构

```text
pi-desktop-lite/
├── .agents/skills/             # 项目技能规范定义 (auto-compile-and-fix, sketch-drafting-ui, clean-code-refactoring 等)
├── .mytools/pi-body/           # 最新 Pi Agent Release 引擎包 (打包发布时自动内嵌作为 App Bundle Resources，开箱即用)
├── default-area/               # Pi 默认工作区目录（含 AGENTS.md 运行时自我描述，打包与运行时隔离工作空间）
├── scripts/                    # 自动化与环境配置脚本 (tauri.js, check.js)
├── src/                        # 前端页面源码与运行时资源
│   ├── assets/                 # 静态资源 (logo.svg, logo.ico)
│   ├── services/               # 前端服务层
│   │   ├── tauri-bridge.js     # 统一 Tauri IPC 跨平台调用桥接器
│   │   ├── config-service.js   # ~/.pi/agent 配置与模型白名单管理服务
│   │   ├── pi-client.js        # 对接 Rust 后端 supervisor 的流式通信客户端
│   │   ├── session-service.js  # 历史会话管理与切换服务
│   │   └── version-service.js  # 版本检测与更新通知服务
│   ├── index.html              # 页面主体（沉浸式标题栏 + 手绘Logo + 四态界面容器 + 独立设置视图）
│   ├── styles.css              # 手绘线条、微渐变、工程几何设置页与系统自适应明暗主题样式
│   └── main.js                 # 状态机分发、流式渲染、思维卡片、工具卡片、跑马灯与右键回退流水线
├── src-tauri/                  # Tauri (Rust) 高性能后端核心
│   ├── Cargo.toml              # 依赖: tokio, serde, dashmap, notify, reqwest, regex, windows-sys
│   ├── tauri.conf.json         # 窗口无边框、原生透明与安全策略配置
│   ├── inner-skills/           # [核心] 桌面应用运行时动态注入 Pi Agent 的内置约束技能与规则 (RULES.md, windows-bash-compatibility)
│   └── src/
│       ├── lib.rs              # Tauri 状态初始化、命令注册、事件广播与托盘集成
│       ├── main.rs             # 程序主入口
│       ├── config_manager.rs   # [核心] 配置管理与目录映射
│       ├── package_manager/    # [核心] 官网组件市场检索、安装/卸载与版本更新子系统
│       ├── pi_runner/          # [核心] 进程管理、Win32 Job Object 孤儿收割、严格 LF 分帧器、Inner-Skills 动态注入引擎
│       ├── security/           # [核心] 正则脱敏中间件 (API Key / 用户隐私路径自动脱敏)
│       ├── session/            # [核心] DashMap 内存会话索引与 notify 增量文件监视
│       └── version_watcher/    # [核心] Jitter 随机抖动版本监测与双源更新探测

├── AGENTS.md                   # 项目规则与代理行为准则
├── README.md                   # 项目介绍与完整配置指南
└── package.json

```
