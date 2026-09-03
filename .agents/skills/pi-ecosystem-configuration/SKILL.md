---
name: pi-ecosystem-configuration
description: |
  Pi 内核与大模型及组件生态配置全指南。涵盖凭据解析优先级、OAuth 与交互式命令行登录、auth.json 环境变量插值、系统环境变量映射、models.json 本地模型（Ollama/vLLM）与反向代理端点（SiliconFlow/OneAPI）配置、settings.json 默认模型与思考预算（Thinking Budgets）、Pi Packages 扩展包生命周期管理、Agent Skills 规范与结构、TypeScript Extensions 扩展插件编写与热重载、pi-subagents 子代理模型自动钉住防跃升机制、以及 pi config 交互式 TUI 与项目信任体系。当涉及"pi配置"、"pi模型配置"、"pi组件"、"pi packages"、"pi skills"、"pi extensions"、"auth.json"、"models.json"、"子代理钉住"、"subagents配置"、"本地模型接入"、"Ollama配置"、"组件安装"、"pi生态"时使用。
---

# Pi 内核与大模型及组件生态配置全指南 (Pi Ecosystem Configuration Guide)

本项目 Pi Desktop Lite (pi-dl) 深度复用 Pi 原生内核生态。本技能系统梳理了 Pi 运行时的大模型连接鉴权、端点配置、扩展包管理、Agent Skills 规范、TypeScript Extensions 插件编写与多智能体子代理管控的最佳实践。

---

## 🔑 第一部分：Pi API 与大模型配置全指南

Pi Agent 支持 **OAuth 订阅账号**、**API 密钥直连**、**环境变量注入** 以及 **自定义/本地/兼容端点**（如 Ollama、DeepSeek、硅基流动、OneAPI、Azure 等）。

### 凭据解析优先级 (Resolution Order)

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

Pi 全局凭据保存在 `~/.pi/agent/auth.json`（Windows 默认路径：`C:\Users\<用户名>\.pi\agent\auth.json`），文件权限建议为 `0600`：

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

### 4. 多智能体子代理 (pi-subagents) 模型自动钉住与防跃升机制

当安装或启用了 `pi-subagents` 扩展组件时，桌面端会在以下场景**自动将当前主模型同步钉住**至 `~/.pi/agent/settings.json`：
1. **初次启动加载**：加载恢复用户持久化模型时自动同步；
2. **切换选择模型**：用户在主界面或设置面板选用任意模型时实时同步；
3. **安装扩展组件**：在扩展管理面板中安装或更新 `pi-subagents` 成功后立即触发同步。

```json
{
  "subagents": {
    "defaultModel": "deepseek-v4-flash-vision-exp",
    "agentOverrides": {
      "oracle":    { "model": "deepseek-v4-flash-vision-exp" },
      "worker":    { "model": "deepseek-v4-flash-vision-exp" },
      "reviewer":  { "model": "deepseek-v4-flash-vision-exp" },
      "researcher":{ "model": "deepseek-v4-flash-vision-exp" },
      "planner":   { "model": "deepseek-v4-flash-vision-exp" }
    }
  }
}
```
> 🛡️ **安全优势**：采用非破坏性读-合并-写回语义，完整保留其余已有配置；彻底杜绝子代理角色因 high-thinking 需求而自动升配到高价模型（如 `deepseek-v4-pro`）造成的意外 Token 消耗。

---

### 5. 交互式组件管理 (`pi config`) 与项目信任机制

#### ① 交互式组件管理器 (`pi config`)
在终端运行 `pi config` 启动手绘 TUI 面板：
- 按 `Tab` 键切换 **全局配置** (`~/.pi/agent/settings.json`) 与 **项目局部配置** (`.pi/settings.json`)；
- 使用上下光标键与回车键启用/禁用 Packages、Extensions、Skills 与 Themes。

#### ② 项目信任机制 (Project Trust)
- 首次打开包含 `.pi` 扩展的项目时弹出信任确认；
- 输入 `/trust` 可将当前项目加入信任名单 (`~/.pi/agent/trust.json`)；
- 全局默认信任可在 `~/.pi/agent/settings.json` 中配置 `"defaultProjectTrust": "always"`。
