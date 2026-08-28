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

- 🤖 **AI-Agent 三态核心界面系统**：
  - **界面1（初始界面-详细版 `detailed`）**：默认完整视图，包含沉浸标题栏、手绘齿轮设置按钮、完整输入框功能（导入图标/清空/Enter快捷引导）、底部快捷标签及内置自适应灵感格言跑马灯（超长文本自动从右向左无缝循环滚动）；
  - **界面2（初始界面-专注版 `focus`）**：单击/聚焦输入框即可自动进入，界面极简纯粹，仅保留居中手绘 $\pi$ Logo 徽标与纯净手绘输入框（支持格言自适应滚动），彻底隐藏所有多余按钮；
  - **界面3（Flow 流式交互版 `flow`）**：输入内容并回车触发，手绘 Logo 优雅移至左上角，主体区展示手绘思考过程卡片（最新一轮默认展开、限高滚动、随输出触发自动收起、支持手动折叠与耗时记录）、工具调用卡片（支持 bash / powershell / 文件编辑等可折叠日志）与纯净 Markdown 流式回答，输入框平滑下移并自适应拉长；
- 🎨 **全域手绘工程草图 SVG 矢量图元体系**：项目前端彻底清除所有系统默认 Emoji 符号，统一设计并内联 19 款手绘草图风格 SVG 矢量图元（`src/assets/svg/`），配合 `currentColor` 严格实现浅色（素描绘图纸）与深色（炭黑素描黑板）双模毫秒级自适应；
- ⚡ **高性能纯 Rust (Tauri 2) 四大后端子系统**：
  - 🛡️ **`pi_runner` (进程监督与孤儿收割)**：Windows 原生 Win32 Job Object 内核级级联收割，杜绝僵尸进程；严格 `\n` (LF) 字节流分帧器；滑动窗口崩溃自愈（30s 内超 2 次熔断保护）；
  - 🔒 **`security` (正则数据脱敏中间件)**：过滤 API Key / Token / 凭据并脱敏本地私有路径为 `[USER_HOME]`；
  - 🔄 **`version_watcher` (抗抖动版本监测引擎)**：启动延迟 30s 自检，6h 周期轮询带 ±8% Jitter 随机抖动与 15s Watchdog 超时熔断；
  - 📁 **`session` (并发内存索引与监听)**：基于 `DashMap` 并发内存缓存与 `notify` 监听 `~/.pi/sessions/`，实现毫秒级会话检索与分支树导航；
- ⚙️ **工程级独立设置全页面与模型配置系统 (Settings View)**：
  - 🖥️ **独立全页面视图 (非浮窗)**：作为与详细版/专注版/Flow版平级的独立全屏视图，顶部常驻醒目导航条与全局指引：“**提示：在任意位置点击鼠标右键或按 Esc 即可快速回退**”，提供左上角一键返回按钮；
  - 📐 **主界面统一配色与非嵌套线框设计**：设置界面配色与主界面完全统一，去除所有高饱和鲜艳颜色，统一采用低饱和度功能色；严格减少层叠 Panel 卡片与胶囊 Tips，外层采用标准细边框（`var(--sketch-border-subtle)`）包裹，内部采用透明底色；
  - 🎨 **软件主题色设置**：支持“跟随系统 (System)”、“浅色模式 (Light - 素描绘图纸)”与“暗色模式 (Dark - 炭黑黑板)”三种模式即时切换与持久化；
  - 📋 **当前模型列表 (白名单筛选、拖拽排序与删除锁定)**：集中管理已启用模型列表，**支持鼠标按住自由拖拽排序并持久化存储**，**当前正在激活使用的模型自动锁定、严禁删除**；点击任一模型卡片即可直接切换选用；
  - ⚡ **官方通道配置 (API Key 自动映射与模型拉取)**：支持 Anthropic Claude, OpenAI, DeepSeek, Google Gemini, OpenRouter, 通义千问 Qwen, 月之暗面 Kimi, MiniMax, Groq, xAI Grok 等官方通道，配置 API Key **自动写入 `~/.pi/agent/auth.json`**，并可一键自动拉取官方可用模型添加到列表；
  - 🛠️ **两步式自定义通道配置 (端点与模型挂载)**：
    - **步骤 1（新增/配置运营商）**：配置 Provider ID、接口类型（支持 `openai-completions` (OpenAI Chat / 聚合代理 / 硅基 / 火山 / DeepSeek)、`openai-responses` (OpenAI Responses API / Azure)、`anthropic-messages`、`google-generative-ai`、`ollama`）、Base URL、API Key 及 developer role / reasoning 兼容参数；
    - **步骤 2（运营商配置修改与模型管理）**：在各运营商卡片内**支持一键修改运营商配置 (API 类型/URL/Key/兼容开关)**、新增与编辑挂载模型（模型 ID、显示名称、上下文窗口、输出上限及思考能力），**自动映射写入 `~/.pi/agent/models.json`** 并同步加入当前模型列表；
  - 🖥️ **宿主内核与会话管理**：支持 Pi 宿主状态监控、一键重启 Host、版本更新检查及历史会话检索切换。
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

---

## 📁 目录结构

```text
pi-desktop-lite/
├── .agents/skills/             # 项目技能规范定义 (auto-compile-and-fix, sketch-drafting-ui, clean-code-refactoring 等)
├── .mytools/pi-body/           # 最新 Pi Agent Release 引擎包 (pi-windows-x64/pi.exe)
├── scripts/                    # 自动化与环境配置脚本 (tauri.js runner)
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
│       ├── pi_runner/          # [核心] 进程管理、Win32 Job Object 孤儿收割、严格 LF 分帧器、Inner-Skills 动态注入引擎
│       ├── security/           # [核心] 正则脱敏中间件 (API Key / 用户隐私路径自动脱敏)
│       ├── session/            # [核心] DashMap 内存会话索引与 notify 增量文件监视
│       └── version_watcher/    # [核心] Jitter 随机抖动版本监测与双源更新探测

├── AGENTS.md                   # 项目规则与代理行为准则
├── README.md                   # 项目介绍与完整配置指南
└── package.json

```
