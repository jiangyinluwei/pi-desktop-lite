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

- 🤖 **AI-Agent 四态核心界面系统**：
  - **界面 1（详细版 `detailed`）**：沉浸式标题栏、自适应高度多行输入框（最高 16 行）、方向键历史翻阅与草稿暂存、文件/文件夹拖拽与手绘概述胶囊、MRU 动态讯息抽屉与自适应跑马灯；
  - **界面 2（专注版 `focus`）**：极简纯粹输入模式，保留居中手绘 $\pi$ Logo、自适应输入框与 Mini 任务胶囊；
  - **界面 3（Flow 流式交互版 `flow`）**：单行流式思维链与动态读秒、阶段性输出 Point 切片卡、工具调用简略切片、时序步骤因果拼接（常态紧凑折叠）、「路由目标项目」胶囊下方「注入提示」信息框（集中展示调用模型前注入的全部上下文条目：Inner-Skill 运行态技能、路由工作区 AGENTS.md / README.md、命中技能等，直角简洁风格，默认收起显示「注入提示」与注入数量，点击展开完整清单，动态累积）、**Typedown 质感 Markdown 预览渲染引擎**（多级标题、围栏代码块轻量高亮与一键复制、GFM 表格、任务清单、GitHub Callout 警示框、流式容错）、全域 HTTP/HTTPS 超链接外部浏览器打开、多段对话顶部悬浮提问吸附与轮次定位导航、模型自动重连自愈流水线 (`ModelFailoverEngine`)、输出一键保存为桌面 Markdown；
  - **界面 4（项目设置独立全屏页面 `settings`）**：非浮窗全屏独立视图，整合常规偏好、模型配置、内核与扩展市场、会话记录及多预设工作区。
- ⚡ **Flow 任务与多进程监管体系**：
  - **双通道解耦与终止防重连铁律**：右键/Esc 无感后台挂起（`TaskManager`）vs 显式中止（`Abort`，手动终止全链路绝对禁止触发模型自动重连或切换）；**后台流式串轮过滤铁律**：挂起任务的流式事件经前台门禁 (`taskManager.isForegroundStreamTask`) 全量过滤，绝不触碰前台 Flow DOM 与历史记录渲染，历史讯息抽屉采用签名比对+节流调度渲染杜绝悬浮频闪；
  - **Mini 任务胶囊与毛玻璃侧边栏**：右上角 `[ ✏️ 1/3 Task ]` 任务胶囊、320px 半透明手绘侧边栏（`backdrop-filter: blur(14px)` + 高斯模糊）；
  - **`PiHostPool` 多进程监管**：Rust 原生子进程隔离监管池与单实例多态唤醒路由调度。
- 📎 **多格式文件与文件夹拖入自动链路**：支持直接拖入单/多文件或整个文件夹；文件夹拖入生成单个文件夹概述胶囊（不展开炸裂为零散文件）；胶囊在输入框内部上方自然换行排列，对话发起时自动注入系统绝对路径供内核原生遍历。
- 🧠 **对话历史沉淀与业务记忆系统**：每轮生成自动持久化多轮快照，讯息抽屉双击即时恢复至 Flow；设置页「会话记录」Tab 支持全量会话关键字搜索与时间筛选、「进入 Flow」一键还原完整历史轮次（从会话记录进入 Flow 支持右键定向回退设置页），并提供安全清空界面会话（不触碰底层会话文件）。
- 🎨 **手绘工程草图 UI/UX 体系**：全域手绘 SVG 矢量图元（`currentColor` 双模自适应）、隐藏式极简滚动条、手绘下拉框 (`SketchSelect`)、自定义填表与智能联想引擎 (`SketchAutoFill`) 及居中模态弹窗系统 (`SketchModal`)。
- 🔔 **桌面原生系统集成**：失焦 Windows 原生 Toast 通知与双重锁防护、单实例互斥防重复启动、系统托盘后台常驻与多态唤醒。
- 🛠️ **高性能 Rust 后端核心**：Win32 Job Object 内核级孤儿进程收割、无内核平稳待机与全链路交互降级、无感热更新引擎、**内核保险自动重连机制**（后台检测 crashed 状态自动平滑重连最多 5 次，均失败后左上角红色抖动小闪电提醒并支持手动重启）、包市场管理、内存会话索引及全量敏感数据脱敏。

> 📖 **完整特性与架构规范**：详见项目内置开发技能 [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md)。

---

## 🔑 第一部分：Pi API 与大模型配置全指南

Pi Agent 支持 **OAuth 订阅账号**、**API 密钥直连**、**环境变量注入** 以及 **自定义/本地/兼容端点**（如 Ollama、DeepSeek、硅基流动、OneAPI、Azure 等）。

### 凭据优先级 (Resolution Order)
```text
CLI 命令行参数 (--api-key) ➔ auth.json 文件配置 ➔ 系统环境变量 ➔ models.json 自定义配置
```

---

### 方式 1：交互式命令行登录（推荐）

在终端启动 `pi`，输入 `/login` 命令并选择对应提供商：

```bash
# 启动交互模式
pi

# 输入 /login，根据提示选择提供商
/login
```

- **OAuth 订阅登录**：支持 ChatGPT Plus/Pro (Codex)、Claude Pro/Max、GitHub Copilot、xAI (Grok)、OpenRouter、Radius，Token 自动保存并支持无感刷新；
- **API Key 交互输入**：直接输入并回车，Pi 会自动加密保存在全局鉴权文件中。

---

### 方式 2：配置文件设置 (`~/.pi/agent/auth.json`)

Pi 全局凭据保存在 `~/.pi/agent/auth.json`（Windows: `C:\Users\<用户名>\.pi\agent\auth.json`），文件权限建议为 `0600`：

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "sk-..." },
  "deepseek": { "type": "api_key", "key": "sk-..." },
  "google": { "type": "api_key", "key": "AIzaSy..." },
  "opencode": { "type": "api_key", "key": "sk-..." },
  "openrouter": { "type": "api_key", "key": "sk-or-v1-..." },
  "qwen-token-plan": { "type": "api_key", "key": "sk-sp-..." },
  "kimi-coding": { "type": "api_key", "key": "..." },
  "minimax": { "type": "api_key", "key": "..." }
}
```

#### 进阶技巧：动态 Key 与环境变量插值
`auth.json` 中的 `key` 字段支持动态解析：
- **环境变量插值**：`"key": "$MY_ANTHROPIC_KEY"` 或 `"${KEY_PREFIX}_KEY"`；
- **密码管理器命令读取**：`"key": "!op read 'op://vault/item/credential'"`；
- **字面量转义**：`"key": "$$literal_dollar"`。

---

### 方式 3：系统环境变量注入

直接在系统环境变量中配置对应 Key：

| 提供商 (Provider) | 环境变量名称 (Environment Variable) | `auth.json` 对应 key |
| :--- | :--- | :--- |
| **Anthropic (Claude)** | `ANTHROPIC_API_KEY` | `anthropic` |
| **OpenAI (GPT-4o/o3)** | `OPENAI_API_KEY` | `openai` |
| **DeepSeek** | `DEEPSEEK_API_KEY` | `deepseek` |
| **Google Gemini** | `GEMINI_API_KEY` | `google` |
| **OpenCode (Zen / Go)** | `OPENCODE_API_KEY` | `opencode` |
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

若需接入本地模型（Ollama / LM Studio / vLLM）或国内大模型代理平台（硅基流动 / OneAPI），可编辑 `~/.pi/agent/models.json`：

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

#### 2. 自定义 OpenAI 兼容代理 / 硅基流动
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

> 💡 `models.json` 支持热加载，修改后直接生效，无需重启应用。

---

### 方式 5：全局默认模型与思考强度设置 (`~/.pi/agent/settings.json`)

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

## 🧩 第二部分：Pi 组件（Packages / Skills / Extensions）配置全指南

Pi 拥有高度可扩展的生态体系，涵盖 **Packages（扩展包）**、**Skills（任务技能库）** 与 **Extensions（TypeScript 深度扩展插件）**。

---

### 1. Pi 包管理器 (Pi Packages)

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

# 4. 项目局部安装（仅当前仓库生效，写入 .pi/settings.json）
pi install -l npm:@org/repo-tools
```

#### ② 组件包管理常用命令
```bash
pi list                     # 查看当前已安装的所有组件包
pi remove npm:@foo/bar      # 卸载指定组件包
pi update --all             # 更新 Pi 自身与所有已安装组件包
pi update --extensions      # 仅更新扩展与组件包（保持 Pi 版本不变）
pi update npm:@foo/bar      # 更新单一指定组件包
```

#### ③ 免安装临时试用（当前会话有效）
```bash
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

---

### 2. 技能组件 (Skills - 遵循 Agent Skills 规范)

Skills 为模型提供**按需加载的专业工作流与指导规范**（符合 [Agent Skills Specification](https://agentskills.io/specification)）。

#### ① 技能存放目录
- **全局技能目录**：`~/.pi/agent/skills/` 或 `~/.agents/skills/`
- **项目局部技能目录**：当前项目根目录下的 `.pi/skills/` 或 `.agents/skills/`

#### ② 共享复用 Claude Code 与 OpenAI Codex 技能库
在 `~/.pi/agent/settings.json` 中直接引用：
```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

#### ③ 技能标准结构规范 (`SKILL.md`)
每个技能为一个独立文件夹，根目录下必须包含 `SKILL.md`：
```text
my-custom-skill/
├── SKILL.md              # [必须] 包含 YAML Frontmatter 元数据与使用指导
├── scripts/              # [可选] 辅助自动化执行脚本
└── references/           # [可选] 详细参考文档与架构模板
```

`SKILL.md` 模板示例：
````markdown
---
name: my-custom-skill
description: 专门用于数据清洗与报告生成的技能。当用户提到数据分析或报表生成时使用。
---

# My Custom Skill

## 使用说明
```bash
node ./scripts/process.js --input data.csv
```
````

#### ④ 技能触发方式
- **自动渐进式加载（Progressive Disclosure）**：Pi 默认将所有技能的 `description` 放入系统提示词，任务匹配时模型自动通过 `read` 工具读取完整 `SKILL.md`；
- **手动强制调用**：在交互框中输入 `/skill:<skill-name>`（例如 `/skill:brave-search`）直接执行。

---

### 3. 扩展与工具组件 (Extensions)

Extensions 是使用 TypeScript 编写的运行级扩展，可向 LLM 注册新工具（Custom Tools）、拦截高危操作或注册自定义 `/command`。

#### ① 扩展存放目录
- **全局扩展**：`~/.pi/agent/extensions/*.ts` 或 `~/.pi/agent/extensions/*/index.ts`
- **项目局部扩展**：`.pi/extensions/*.ts` 或 `.pi/extensions/*/index.ts`

#### ② 编写自定义扩展示例
创建 `~/.pi/agent/extensions/custom-tools.ts`：
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // 1. 注册供 LLM 调用的自定义工具
  pi.registerTool({
    name: "fetch_weather",
    label: "Fetch Weather",
    description: "根据城市名称查询实时天气信息",
    parameters: Type.Object({
      city: Type.String({ description: "城市名称，如 Beijing" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
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
在交互界面中输入 `/reload` 即可热重载所有扩展，无需重启应用。

---

### 4. 交互式组件管理 (`pi config`) 与项目信任机制

#### ① 交互式组件管理器 (`pi config`)
在终端运行 `pi config` 启动手绘 TUI 面板：
- 按 `Tab` 键切换 **全局配置** (`~/.pi/agent/settings.json`) 与 **项目局部配置** (`.pi/settings.json`)；
- 使用上下光标键与回车键启用/禁用 Packages、Extensions、Skills 与 Themes。

#### ② 项目信任机制 (Project Trust)
- 首次打开包含 `.pi` 扩展的项目时弹出信任确认；
- 输入 `/trust` 可将当前项目加入信任名单 (`~/.pi/agent/trust.json`)；
- 全局默认信任可在 `~/.pi/agent/settings.json` 中配置 `"defaultProjectTrust": "always"`。

---

## 🚀 快速开始与桌面端开发运行

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

## 📁 项目目录拓扑

```text
pi-desktop-lite/
├── .agents/skills/             # 项目开发级技能规范定义 (auto-compile-and-fix, sketch-drafting-ui, flow-interaction-pattern 等)
├── .mytools/pi-body/           # 最新 Pi Agent Release 引擎包 (打包发布时自动内嵌作为 App Bundle Resources)
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
