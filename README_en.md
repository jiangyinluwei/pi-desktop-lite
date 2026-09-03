# pi-dl (Tauri Desktop App)

<p align="center">
  <b>English</b> | <a href="README.md">简体中文</a>
</p>

A desktop research and reasoning application with minimalist hand-drawn sketch & architectural drafting aesthetics, fully adhering to the core Pi engine ecosystem, built on **Tauri 2 + Native Web Frontend (HTML / CSS / JS)**.

<p align="center">
  <img src="src/assets/111.png" alt="pi-dl Main Interface" width="49%" />
  <img src="src/assets/222.png" alt="pi-dl Flow Interaction View" width="49%" />
</p>

---

## 🌐 Official Resources & Ecosystem

- 🔗 **Pi Official Website**: [https://pi.dev/](https://pi.dev/)
- 📦 **Pi Package Gallery**: [https://pi.dev/packages](https://pi.dev/packages)
- 🐙 **Pi Open Source Repository**: [earendil-works/pi (GitHub)](https://github.com/earendil-works/pi)
- 📚 **Curated Skills Repositories**: [Anthropic Skills](https://github.com/anthropics/skills) ｜ [Pi Skills](https://github.com/badlogic/pi-skills)

---

## ✨ Core Features

- 🤖 **Four-State Core AI-Agent Interface System**:
  - **State 1 (Detailed View `detailed`)**: Immersive titlebar, multi-line auto-resizing input box (up to 16 lines), arrow-key history traversal and draft staging, drag-and-drop file/folder attachments with sketch summary capsules, MRU message drawer with adaptive ticker;
  - **State 2 (Focus View `focus`)**: Pure distraction-free input mode retaining centered hand-drawn $\pi$ logo, adaptive input box, and Mini Task capsule;
  - **State 3 (Flow Stream View `flow`)**: Single-line streaming thinking chains with live duration timer, incremental Point output cards, concise tool invocation cards, interleaved chronological step pipeline (collapsed by default), an "Injection Notice" info box below the routed-target-project capsule (centrally listing all context entries injected before model invocation: runtime Inner-Skills, routed workspace AGENTS.md / README.md, matched skills, etc.; plain right-angle style, collapsed by default showing only the injection count, click to expand the full list; accumulating dynamically), **Typedown-quality Markdown rendering engine** (multi-level headings, fenced code blocks with syntax highlighting and one-click copy, GFM tables, task checklists, GitHub Callout alert boxes, streaming error self-healing), global external URL opening via default OS browser, sticky floating question tips with turn navigation, automatic failover self-healing engine (`ModelFailoverEngine`), and one-click export to local Markdown;
  - **State 4 (Settings Full-Screen Page `settings`)**: Standalone full-page view integrating General preferences, Model configurations, Kernel & Package gallery, Session records, and Multi-preset workspaces.
- ⚡ **Flow Background Tasks & Multi-Process Supervision**:
  - **Dual-Channel Decoupling & Manual Abort Guard**: Right-click/Esc background suspension (`TaskManager`) vs. explicit cancellation (`Abort`, manual abort strictly disables automatic model failover/reconnect);
  - **Mini Task Capsule & Frosted Glass Sidebar**: Top-right `[ ✏️ 1/3 Task ]` capsule, 320px translucent sketch sidebar (`backdrop-filter: blur(14px)` + Gaussian blur);
  - **`PiHostPool` Multi-Process Supervision**: Rust-native isolated child process supervision pool with single-instance polymorphic wake-up routing.
- 📎 **Multi-Format File & Folder Drag-and-Drop Auto-Linking**: Supports direct drag-and-drop for files or whole project folders; folder drag-and-drop generates a single folder overview capsule (without exploding into individual child files); capsules wrap naturally inside the top of the input container, and absolute paths are structured and injected into prompts upon dispatch.
- 🧠 **Session History & Business Memory Layer**: Automatically snapshots full multi-turn dialogs per round; double-click in message drawer to instantly restore to Flow mode; settings page "Sessions" Tab supports full-text search and time filtering, "Enter Flow" historical pipeline restoration (with directional Step Back to settings), and safe UI session clearing.
- 🎨 **Sketch & Drafting UI/UX System**: Custom hand-drawn SVG vector icons (`currentColor` light/dark adaptive), hidden minimalist scrollbars, micro-shake popover dropdowns (`SketchSelect`), smart autofill with recommendation engine (`SketchAutoFill`), and centered modal dialog system (`SketchModal`).
- 🔔 **Native Desktop Integration**: Out-of-focus Windows native Toast notifications with double-lock guard, single-instance mutex preventing duplicate launches, system tray persistence, and polymorphic wake-up.
- 🛠️ **High-Performance Rust Core**: Win32 Job Object kernel-level orphan process harvesting, kernel-less standby & interactive degradation, seamless hot-update engine, **kernel insurance auto-reconnect** (background crashed-state detection, up to 5 smooth reconnect attempts, red shaking lightning alert in top-left corner upon all failures with click-to-restart), official package marketplace, in-memory session index, and sensitive credential auto-redaction.

> 📖 **Full Architecture & Development Specifications**: Refer to [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md).

---

## 🔑 Part 1: Comprehensive Guide to Pi API & LLM Configuration

Pi Agent supports **OAuth subscription logins**, **direct API keys**, **environment variables**, and **custom/local/reverse-proxy endpoints** (e.g., Ollama, DeepSeek, SiliconFlow, OneAPI, Azure).

### Credential Resolution Order
```text
CLI Argument (--api-key) ➔ auth.json Configuration ➔ System Environment Variables ➔ models.json Custom Configuration
```

---

### Method 1: Interactive CLI Login (Recommended)

Launch `pi` in terminal, execute `/login` and select your provider:

```bash
# Start interactive mode
pi

# Enter /login and select provider according to prompt
/login
```

- **OAuth Subscription Login**: Supports ChatGPT Plus/Pro (Codex), Claude Pro/Max, GitHub Copilot, xAI (Grok), OpenRouter, and Radius with automatic token refresh;
- **Interactive API Key Input**: Enter directly and press Enter. Pi will encrypt and store it in the global auth file.

---

### Method 2: Global Configuration File (`~/.pi/agent/auth.json`)

Pi stores global credentials in `~/.pi/agent/auth.json` (on Windows: `C:\Users\<username>\.pi\agent\auth.json`), recommended permission `0600`:

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

#### Dynamic Key Resolution & Variable Interpolation
The `key` field in `auth.json` supports dynamic evaluation:
- **Environment Variable Interpolation**: `"key": "$MY_ANTHROPIC_KEY"` or `"${KEY_PREFIX}_KEY"`;
- **Password Manager Command Execution**: `"key": "!op read 'op://vault/item/credential'"` ;
- **Literal Escaping**: `"key": "$$literal_dollar"`.

---

### Method 3: System Environment Variables

Set the corresponding API keys in your terminal or OS environment variables:

| Provider | Environment Variable | `auth.json` Key |
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
| **Qwen (Tongyi Qianwen)** | `QWEN_TOKEN_PLAN_CN_API_KEY` | `qwen-token-plan-cn` |
| **Moonshot (Kimi)** | `KIMI_API_KEY` | `kimi-coding` |
| **MiniMax** | `MINIMAX_CN_API_KEY` | `minimax-cn` |
| **Azure OpenAI** | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL` | `azure-openai-responses` |
| **Amazon Bedrock** | `AWS_BEARER_TOKEN_BEDROCK` (or `AWS_PROFILE`) | `amazon-bedrock` |

---

### Method 4: Custom Providers / Local Models / Reverse Proxies (`~/.pi/agent/models.json`)

To connect local models (Ollama / LM Studio / vLLM) or API aggregators (OneAPI / SiliconFlow), edit `~/.pi/agent/models.json`:

#### 1. Local Ollama Example
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

#### 2. Custom OpenAI Compatible Proxy / SiliconFlow
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

> 💡 `models.json` supports hot-reloading; changes take effect immediately without restarting.

---

### Method 5: Global Defaults & Thinking Budgets (`~/.pi/agent/settings.json`)

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
- **Thinking Level options**: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`.

---

## 🧩 Part 2: Pi Packages, Skills & Extensions Guide

---

### 1. Pi Package Manager (Pi Packages)

#### ① Installation
```bash
# 1. Install via npm
pi install npm:@foo/bar@1.0.0
pi install npm:pi-skills

# 2. Install via Git / GitHub repository
pi install git:github.com/user/my-pi-package@v1.0
pi install https://github.com/badlogic/pi-skills

# 3. Install from local directory
pi install ./my-local-package

# 4. Project-local installation
pi install -l npm:@org/repo-tools
```

#### ② Management Commands
```bash
pi list                     # List installed packages
pi remove npm:@foo/bar      # Uninstall package
pi update --all             # Update Pi core and packages
pi update --extensions      # Update extensions only
pi update npm:@foo/bar      # Update specific package
```

#### ③ Ephemeral Trial (Current Session Only)
```bash
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

---

### 2. Skills (Agent Skills Specification)

Skills provide **on-demand workflows and guidelines** following the [Agent Skills Specification](https://agentskills.io/specification).

#### ① Directory Discovery
- **Global**: `~/.pi/agent/skills/` or `~/.agents/skills/`
- **Project-local**: `.pi/skills/` or `.agents/skills/`

#### ② Sharing Claude Code & OpenAI Codex Skills
Add to `~/.pi/agent/settings.json`:
```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

#### ③ Standard `SKILL.md` Structure
```text
my-custom-skill/
├── SKILL.md              # [Required] YAML Frontmatter + Markdown guidance
├── scripts/              # [Optional] Automation scripts
└── references/           # [Optional] Reference docs & templates
```

Example `SKILL.md`:
````markdown
---
name: my-custom-skill
description: Specialized skill for data processing and reporting. Use when data analysis is requested.
---

# My Custom Skill

## Usage
```bash
node ./scripts/process.js --input data.csv
```
````

#### ④ Invocation Methods
- **Progressive Disclosure**: Pi includes skill descriptions in system prompts; LLM reads full `SKILL.md` via `read` tool on demand;
- **Manual Execution**: Run `/skill:<skill-name>` (e.g. `/skill:brave-search`) in the chat input.

---

### 3. Extensions

Extensions are TypeScript runtime plugins that register custom tools, security interceptors, and slash commands.

#### ① Directory Discovery
- **Global**: `~/.pi/agent/extensions/*.ts` or `~/.pi/agent/extensions/*/index.ts`
- **Project-local**: `.pi/extensions/*.ts` or `.pi/extensions/*/index.ts`

#### ② Example Extension
Create `~/.pi/agent/extensions/custom-tools.ts`:
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // 1. Register a custom tool for LLM
  pi.registerTool({
    name: "fetch_weather",
    label: "Fetch Weather",
    description: "Query real-time weather by city name",
    parameters: Type.Object({
      city: Type.String({ description: "City name, e.g. Beijing" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `${params.city} Weather: Sunny, 22°C` }],
        details: {},
      };
    },
  });

  // 2. Register security interceptor
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const confirmed = await ctx.ui.confirm("Dangerous Command", "Allow execution of delete command?");
      if (!confirmed) {
        return { block: true, reason: "User rejected dangerous delete operation" };
      }
    }
  });

  // 3. Register custom slash command
  pi.registerCommand("ping", {
    description: "Test extension connectivity",
    handler: async (args, ctx) => {
      ctx.ui.notify("Pong! Extension is working", "info");
    },
  });
}
```

#### ③ Hot Reload
Execute `/reload` in the prompt to hot-reload all extensions without restarting.

---

### 4. Multi-Agent Subagents (`pi-subagents`) Model Auto-Pinning

When `pi-subagents` is installed or enabled, the desktop application automatically synchronizes and pins the current primary model to `~/.pi/agent/settings.json`:
1. **Initial Startup**: Automatically synced upon loading/restoring user-selected model;
2. **Model Switching**: Real-time synchronization whenever the user selects any model;
3. **Package Installation**: Immediately synced when `pi-subagents` is installed or updated in the packages panel.

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
> 🛡️ **Safety Assurance**: Non-destructive read-merge-write semantics preserve all existing settings. Completely prevents subagents from unexpectedly escalating to expensive models (like `deepseek-v4-pro`) due to high-thinking role profiles.

---

### 5. Interactive Configuration (`pi config`) & Project Trust

#### ① Interactive Manager (`pi config`)
Run `pi config` in terminal to launch the TUI:
- Press `Tab` to switch between **Global** and **Project** configs;
- Use Arrow keys and Enter to toggle Packages, Extensions, Skills, and Themes.

#### ② Project Trust
- First launch with `.pi` extensions prompts for confirmation;
- Enter `/trust` to add current workspace to `~/.pi/agent/trust.json`;
- Set `"defaultProjectTrust": "always"` in `settings.json` for global trust.

---

## 🚀 Quick Start & Desktop Development

> [!IMPORTANT]
> **Prerequisites**: Before launching the project, please extract [`.mytools/pi-body/pi-windows-x64.7z`](.mytools/pi-body/pi-windows-x64.7z) (extract into `.mytools/pi-body/pi-windows-x64/` containing `pi.exe` and core binaries).

### Common Commands
```bash
# 1. Install dependencies
npm install

# 2. Fast compilation check (~1s, recommended for daily iterations)
npm run check

# 3. Start desktop dev mode
npm run dev

# 4. Build check (compile binaries without full packaging)
npm run build:check

# 5. Build release installer package
npm run build
```

### Multi-Workspace Switching & `code-area` Routing
1. Click the gear icon on the bottom-left to enter Settings full-page, select **"Workspaces"**;
2. **`code-area` Routing Hub Features**:
   - Native Windows OpenFolder dialog via Rust `rfd` (IFileOpenDialog) supporting directory browsing, direct path input, and MRU project switching;
   - Auto-validates target directory existence upon startup/switching and cleans up stale items;
   - `code-area` hosts central Hub skills (`code-area/.agents/skills/`), dispatching commands to external routed target projects without polluting its own files;
3. **Workspace Switching**: Click "Switch" in the presets list (materializes workspace template into `~/.pi-dl/workspaces/<id>/`, automatically restarting idle kernel to re-anchor CWD).

---

## 📁 Project Directory Topology

```text
pi-desktop-lite/
├── .agents/skills/             # Development-level agent skill definitions (auto-compile-and-fix, sketch-drafting-ui, flow-interaction-pattern, etc.)
├── .mytools/pi-body/           # Bundled Pi Agent Release engine (contains pi-windows-x64.7z, extract to pi-windows-x64 before development)
├── default-area/               # Default workspace template & runtime isolation sandbox
├── workspaces/                 # Public preset workspace templates (code-area hub / research-area)
├── custom-workspaces/          # [Private] Custom enterprise workspaces (.gitignore isolated, distributed offline)
├── scripts/                    # Automation and build scripts (tauri.js, check.js)
├── src/                        # Frontend source code and assets
│   ├── assets/                 # Static assets (logo.svg, logo.ico, hand-drawn SVG icons)
│   ├── lib/                    # Shared foundational utilities (dom-utils, icons, markdown-renderer, view-constants)
│   ├── modules/                # Feature-scoped UI modules orchestrated by main.js
│   │   ├── view-mode.js        # Four-state state machine & settings routing
│   │   ├── flow-ui.js          # Flow rendering: Markdown, turns DOM, floating tip, turn navigation
│   │   ├── flow-stream.js      # Stream state machine, error cards, and auto-failover capsules
│   │   ├── flow-pipeline.js    # Prompt dispatch, tool call events, self-healing pipeline
│   │   ├── task-panel.js       # Background task capsule, sidebar, history restore
│   │   ├── sessions-panel.js   # Session records, search/filter, enter Flow pipeline
│   │   ├── workspace-panel.js  # Workspace management panel and routing binding
│   │   └── global-interactions.js # Global Step Back & URL interceptor
│   ├── services/               # Decoupled frontend services (tauri-bridge, config-service, pi-client, workspace-service)
│   ├── styles/                 # Feature-scoped sketch styles (tokens, layout, flow, markdown, settings, form-widgets)
│   ├── index.html              # Main HTML container
│   ├── styles.css              # Aggregated style entry (@import to styles/ subfiles)
│   └── main.js                 # Main orchestrator entry
├── src-tauri/                  # High-performance Tauri (Rust) backend
│   ├── inner-skills/           # Runtime dynamic inner-skills (RULES.md, bash compatibility, OCR inspection, multi-agent, web search, etc.)
│   └── src/                    # Rust core source (lib.rs, main.rs, config_manager, workspace, pi_runner, security, session)
├── AGENTS.md                   # Project rules and agent guidelines
├── README.md                   # Project overview & configuration guide (Chinese)
├── README_en.md                # Project overview & configuration guide (English)
└── package.json
```
