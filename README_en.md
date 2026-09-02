# pi-dl (Tauri Desktop App)

<p align="center">
  <b>English</b> | <a href="README.md">简体中文</a>
</p>

A desktop research and reasoning application with minimalist hand-drawn sketch & architectural drafting aesthetics, fully adhering to the core pi engine, built on **Tauri 2 + Native Web Frontend (HTML / CSS / JS)**.

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
  - **State 1 (Initial View - Detailed `detailed`)**: Immersive titlebar, multi-line auto-resizing input box (up to 16 lines), arrow-key history traversal and draft staging, drag-and-drop file/code attachments with sketch summary capsules, MRU message drawer with adaptive ticker;
  - **State 2 (Initial View - Focus `focus`)**: Pure distraction-free input mode retaining centered hand-drawn $\pi$ logo, adaptive input box, and Mini Task capsule;
  - **State 3 (Flow Stream View `flow`)**: Single-line streaming thinking chains with live duration timer, single-line tool summary cards (friendly tool name + running/done/failure status), interleaved chronological step pipeline (`Thinking 1 ➔ Tool 1 ➔ Thinking 2 ➔ Tool 2...` always collapsed by default without auto-expansion), Typedown-quality Markdown rendering engine, sticky floating question tips with turn navigation, automatic failover self-healing engine (`ModelFailoverEngine`), and one-click export to local Markdown;
  - **State 4 (Settings Full-Screen Page `settings`)**: Non-floating standalone full-page view integrating General preferences, Model configurations, Kernel & Package gallery, Session records, and Multi-preset workspaces.
- ⚡ **Flow Background Tasks & Multi-Process Supervision**:
  - **Dual-Channel Decoupling**: Right-click/Esc background suspension (`TaskManager`) vs. explicit cancellation (`Abort`);
  - **Mini Task Capsule & Frosted Glass Sidebar**: Top-right `[ ✏️ 1/3 Task ]` capsule, 320px translucent sketch sidebar (`backdrop-filter: blur(14px)` + Gaussian blur);
  - **`PiHostPool` Multi-Process Supervision**: Rust-native isolated child process supervision pool with single-instance polymorphic wake-up routing.
- 📎 **Multi-Format File Drag-and-Drop & Multimodal Adaptation**: Supports direct drag-and-drop for images and documents, sketch micro-bordered summary capsules, absolute path structural injection, and multimodal extension suggestions.
- 🧠 **Session History & Business Memory Layer**: Automatically snapshots full multi-turn dialogs per round; double-click in message drawer to instantly restore to Flow mode; settings page "Sessions" Tab supports full-text search and time filtering, "Enter Flow" historical pipeline restoration, and "Clear Interface Sessions" (safely clears UI layer without touching underlying `~/.pi` kernel files); back navigation flow preservation (`flowFromSettings` flag).
- 🎨 **Sketch & Drafting UI/UX System**: 20+ custom hand-drawn SVG vector icons (`currentColor` light/dark adaptive), hidden minimalist scrollbars, micro-shake popover dropdowns (`SketchSelect`), smart autofill with recommendation engine (`SketchAutoFill`), and centered modal dialog system (`SketchModal`).
- 🔔 **Native Desktop Integration**: Out-of-focus Windows native Toast notifications with double-lock guard, single-instance mutex preventing duplicate launches, system tray persistence, and polymorphic wake-up.
- 🛡️ **Pi Kernel Insurance & 5-Retry Auto-Reconnect Mechanism**: Global background watchdog monitoring kernel health; automatically activates a 5-step smooth reconnect pipeline (1/5 ~ 5/5) upon capturing a `crashed` state; auto-resets upon self-healing, and triggers a **jittery red lightning bolt + warning text (`内核崩溃 (重连失败)`)** in the top-left corner upon 5-attempt exhaustion, with one-click direct navigation to the Settings Kernel tab for diagnosis.
- 🛠️ **High-Performance Rust Core**: Win32 Job Object kernel-level orphan process harvesting, seamless hot-update engine (streaming download + `ProgressStepper`), official package marketplace with queue management, concurrent in-memory session index, and sensitive credential auto-redaction.

> 📖 **Full Architecture & Development Specifications**: Refer to [`.agents/skills/pi-desktop-overview/SKILL.md`](file:///.agents/skills/pi-desktop-overview/SKILL.md).

---

## 🔑 Part 1: Comprehensive Guide to Pi API & LLM Configuration

Pi Agent supports **OAuth subscription logins**, **direct API keys**, **environment variables**, and **custom/local/reverse-proxy endpoints** (e.g., Ollama, vLLM, DeepSeek, SiliconFlow, OneAPI, Azure).

### Credential Resolution Order
```text
CLI Argument (--api-key) ➔ auth.json Configuration ➔ System Environment Variables ➔ models.json Custom Configuration
```

---

### Method 1: Interactive CLI Login (Recommended & Easiest)

Launch `pi` in terminal, execute `/login` and select your provider:

```bash
# Start interactive mode
pi

# Enter /login and select provider according to prompt
/login
```

- **OAuth Subscription Login**: Supports ChatGPT Plus/Pro (Codex), Claude Pro/Max, GitHub Copilot, xAI (Grok), OpenRouter, and Radius. Tokens are securely stored and automatically refreshed.
- **Interactive API Key Input**: Enter directly and press Enter. Pi will encrypt and store it in the global auth file.

---

### Method 2: Global Configuration File (`~/.pi/agent/auth.json`)

Pi stores global credentials in `~/.pi/agent/auth.json` (on Windows: `C:\Users\<username>\.pi\agent\auth.json`). Recommended file permission: `0600` (read/write by owner only).

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

#### Advanced Technique: Dynamic Key Resolution & Variable Interpolation
The `key` field in `auth.json` supports dynamic evaluation:
- **Environment Variable Interpolation**: `"key": "$MY_ANTHROPIC_KEY"` or `"${KEY_PREFIX}_KEY"`;
- **Password Manager Command Execution**: `"key": "!op read 'op://vault/item/credential'"` or `"!security find-generic-password -ws 'anthropic'"`;
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

To connect local models (Ollama / LM Studio / vLLM) or API aggregators (OneAPI / NewAPI / SiliconFlow), create or edit `~/.pi/agent/models.json`:

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

#### 2. OpenAI-Compatible Custom Proxy (e.g., SiliconFlow / DeepSeek Proxy)
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

> 💡 `models.json` supports hot reloading. Changes take effect immediately without restarting Pi.

---

### Method 5: Global Default Model & Thinking Budgets (`~/.pi/agent/settings.json`)

Configure startup defaults, default provider, and thinking token budgets in `~/.pi/agent/settings.json`:

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
- **Thinking Level Options**: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`.

---

## 🧩 Part 2: Comprehensive Guide to Pi Packages, Skills & Extensions

Pi features an extensible ecosystem consisting of **Packages (all-in-one bundles)**, **Skills (task workflow libraries)**, and **Extensions (TypeScript plugins)**.

---

### 1. Pi Package Manager (Pi Packages)

Pi provides unified package management commands to download and link extensions, skills, prompt templates, and themes automatically.

#### ① Download & Install Packages
```bash
# 1. Install public package from npm
pi install npm:@foo/bar@1.0.0
pi install npm:pi-skills

# 2. Install directly from GitHub / Git repository
pi install git:github.com/user/my-pi-package@v1.0
pi install https://github.com/badlogic/pi-skills

# 3. Install from local development folder
pi install ./my-local-package
pi install C:/Users/name/my-tools/package

# 4. Local workspace installation (persisted to .pi/settings.json)
pi install -l npm:@org/repo-tools
```

#### ② Common Package Management Commands
```bash
pi list                     # List all currently installed packages
pi remove npm:@foo/bar      # Uninstall specific package
pi update --all             # Update Pi itself and all installed packages
pi update --extensions      # Update extensions and packages only
pi update npm:@foo/bar      # Update a single specific package
```

#### ③ Ephemeral Package Trial
```bash
# Run with package loaded for current execution without installing
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

---

### 2. Skills (Compliant with Agent Skills Specification)

Skills provide models with **on-demand specialized workflows, guidelines, and automation scripts** (conforming to the [Agent Skills Specification](https://agentskills.io/specification)).

#### ① Skill Directory Discovery
Pi scans for skills in the following paths upon startup:
- **Global Skill Directories**:
  - `~/.pi/agent/skills/`
  - `~/.agents/skills/`
- **Project Local Skill Directories**:
  - `.pi/skills/` in the current project root
  - `.agents/skills/` in the current project root and parent directories

#### ② Sharing with Claude Code & OpenAI Codex Skills
If you have existing Claude Code or Codex skills, link them in `~/.pi/agent/settings.json`:
```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

#### ③ Standard Skill Structure (`SKILL.md`)
Each skill is contained in its own folder with a mandatory `SKILL.md`:
```text
my-custom-skill/
├── SKILL.md              # [Required] YAML Frontmatter metadata and instructions
├── scripts/              # [Optional] Automation helper scripts (bash / js / py)
└── references/           # [Optional] Detailed reference documents & templates
```

`SKILL.md` Example:
````markdown
---
name: my-custom-skill
description: Specialized in data cleaning, format conversion, and report generation. Trigger when data analysis is requested.
---

# My Custom Skill

## Instructions
Run the following script to begin data processing:
```bash
node ./scripts/process.js --input data.csv
```
````

#### ④ Triggering Skills
- **Progressive Disclosure (Automatic)**: Pi includes skill `description` summaries in system prompts; the model reads `SKILL.md` via `read` tool upon task matching.
- **Explicit Trigger**: Type `/skill:<skill-name>` (e.g., `/skill:brave-search`) in chat to invoke manually.

---

### 3. Extensions & Custom Tools (TypeScript)

Extensions are written in TypeScript, allowing you to register custom tools for LLMs, intercept tool executions (safety confirmations), listen to lifecycle events, or register custom slash commands.

#### ① Extension Locations & Discovery
- **Global Extensions**: `~/.pi/agent/extensions/*.ts` or `~/.pi/agent/extensions/*/index.ts`
- **Project Local Extensions**: `.pi/extensions/*.ts` or `.pi/extensions/*/index.ts`

#### ② Writing a Custom Extension
Create `~/.pi/agent/extensions/custom-tools.ts`:
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // 1. Register a custom tool for the LLM
  pi.registerTool({
    name: "fetch_weather",
    label: "Fetch Weather",
    description: "Query real-time weather information by city name",
    parameters: Type.Object({
      city: Type.String({ description: "City name, e.g., Beijing" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `${params.city} weather: Sunny, 22°C` }],
        details: {},
      };
    },
  });

  // 2. Register safety interception for high-risk commands
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const confirmed = await ctx.ui.confirm("High-Risk Command Intercepted", "Allow deletion execution?");
      if (!confirmed) {
        return { block: true, reason: "User rejected high-risk deletion command" };
      }
    }
  });

  // 3. Register custom slash command
  pi.registerCommand("ping", {
    description: "Test extension connectivity",
    handler: async (args, ctx) => {
      ctx.ui.notify("Pong! Extension is running normally", "info");
    },
  });
}
```

#### ③ Hot Reloading Extensions
Type `/reload` in the Pi prompt to instantly hot-reload all extensions without restarting the application.

---

### 4. Interactive Component Manager (`pi config`) & Project Trust

#### ① Interactive TUI Manager (`pi config`)
Run `pi config` in terminal to launch the sketch-styled TUI dashboard:
- Press `Tab` to switch between **Global Settings** (`~/.pi/agent/settings.json`) and **Project Settings** (`.pi/settings.json`);
- Use arrow keys and Enter to toggle Packages, Extensions, Skills, and Themes.

#### ② Project Trust Policy
To protect against executing unauthorized local code, Pi applies workspace security guards:
- Prompts for confirmation upon first opening projects containing local `.pi` extensions;
- Enter `/trust` to add current workspace to the trusted list (`~/.pi/agent/trust.json`);
- For global auto-trust, configure `"defaultProjectTrust": "always"` in `~/.pi/agent/settings.json`.

---

## 🚀 Quick Start & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Fast Static & Type Check (~1s, recommended for daily iterations)
```bash
npm run check
```

### 3. Launch Desktop App in Dev Mode
```bash
npm run dev
# or
node scripts/tauri.js dev
```

### 4. Build Test (Generate binaries without installer packaging)
```bash
npm run build:check
```

### 5. Production Release Build
```bash
npm run build
```

### 6. Multi-Workspace Switching & code-area Route Hub (Settings → Workspaces)

1. Click the bottom-left gear icon to open the full-screen **Settings** view;
2. Select **"Workspaces"** on the left tab bar;
3. The top "Active Workspace" card displays current workspace name, badge, and runtime absolute path;
4. **`code-area` Routed Workspace & Dispatch Hub (Exclusive Feature)**:
   - Powered by Rust `rfd` (IFileOpenDialog) for a native Windows OpenFolder dialog (standard "Select Folder" / "Open" buttons with zero web upload prompt), supporting directory browsing, manual absolute path input, and quick switching between recent project paths;
   - **Existence Validation & Auto-Cleanup**: Verifies if the currently bound route path and recent project history exist on disk whenever switching to `code-area` or starting the app; automatically clears invalid selections and purges dead paths;
   - Displays built-in coding skills list in `code-area/.agents/skills/` (extensible by developers);
   - In runtime, `code-area` never modifies its own files, but dispatches built-in skills to read and modify the external routed project;
5. The "Preset Workspaces" list displays all built-in templates (`default-area`, `code-area`, `research-area`), materialized paths, and an "In Use" indicator;
6. Click **"Switch"** on any non-active workspace:
   - Allows switching to `code-area` immediately and binding the route target whenever ready;
   - If unbound, the main input box is disabled from typing (read-only hint) and clicking it prompts the route binding dialog;
   - First selection copies template directory to `~/.pi-dl/workspaces/<id>/` (`default-area` retains `~/.pi-dl/default-area` with zero migration loss);
   - Prompts sketch confirmation if tasks are running, clarifying "effective for subsequent new sessions";
   - Restarts idle kernel host to re-anchor CWD automatically.

---

## 📁 Project Structure

```text
pi-desktop-lite/
├── .agents/skills/             # Project development skills & standards (auto-compile-and-fix, iterative-modification-hygiene, sketch-drafting-ui, clean-code-refactoring, etc.)
├── .mytools/pi-body/           # Latest Pi Agent Release engine bundle (embedded as App Bundle Resources for out-of-the-box runtime)
├── default-area/               # Pi default workspace directory (contains AGENTS.md self-description)
├── workspaces/                 # Multi-preset workspace template source (code-area / research-area)
│   ├── code-area/              #   Coding & Engineering Dispatch Hub template (workspace.json + AGENTS.md + README.md + .agents/skills/ built-in skills)
│   └── research-area/          #   Deep Research template (workspace.json + AGENTS.md + README.md)
├── scripts/                    # Automation & tooling scripts (tauri.js, check.js)
├── src/                        # Frontend source files & web assets
│   ├── assets/                 # Static assets (logo.svg, logo.ico, hand-drawn SVG icons, screenshots)
│   ├── lib/                    # Shared core primitives & utilities
│   │   ├── dom-utils.js        # HTML / CSS escaping helpers
│   │   ├── icons.js            # currentColor hand-drawn SVG icon dictionary
│   │   └── view-constants.js   # Four-state view constants (detailed / focus / flow / settings)
│   ├── modules/                # Domain-driven UI business modules (orchestrated by main.js)
│   │   ├── view-mode.js        # Four-state state machine & settings routing
│   │   ├── preferences.js      # Themes, send shortcuts, token snapping
│   │   ├── settings-navigation.js # Settings tabs, inner wizard steps, collapsible drawers
│   │   ├── model-panel.js      # Model whitelist MRU & official provider configurations
│   │   ├── custom-provider-panel.js # Two-step custom provider & model management
│   │   ├── kernel-panel.js     # Kernel status, version checking & one-click updater
│   │   ├── sessions-panel.js   # Session history listing, search/filter, Flow pipeline restore & UI purge
│   │   ├── window-controls.js  # Titlebar window control buttons
│   │   ├── flow-ui.js          # Flow rendering core: Markdown, turns DOM, sticky question tip, turn navigation
│   │   ├── flow-stream.js      # Streaming state machine, error card rendering & auto-failover capsules
│   │   ├── flow-pipeline.js    # Prompt dispatching, tool events, failover engine & send interception
│   │   ├── task-panel.js       # Background task capsule, frosted sidebar, history restore & snapshot archiving
│   │   ├── file-attachments.js # Drag-and-drop attachments, summary capsules & multimodal injection
│   │   ├── search-input.js     # Search input interaction, history flipping, motto ticker & focus control
│   │   ├── packages-panel.js   # Package market & install/update/uninstall queue
│   │   ├── workspace-panel.js  # Multi-preset workspace management panel
│   │   └── global-interactions.js # Global right-click/Esc step-back & window lifecycle guards
│   ├── services/               # UI-decoupled frontend service layer
│   │   ├── tauri-bridge.js     # Unified Tauri IPC bridge
│   │   ├── config-service.js   # ~/.pi/agent config & model whitelist service
│   │   ├── pi-client.js        # Streaming communication client for Rust backend supervisor
│   │   ├── session-service.js  # Historical session management & switching service
│   │   ├── workspace-service.js # Multi-preset workspace IPC service
│   │   └── version-service.js  # Version detection & update notification service
│   ├── styles/                 # Domain-driven modular sketch styles (styles.css acts as @import aggregator)
│   │   ├── tokens.css          # Light / Dark theme tokens
│   │   ├── base.css            # Base resets & minimal hidden scrollbar
│   │   ├── layout.css          # Titlebar & four-state layout
│   │   ├── flow.css            # Flow stream chat & reasoning/response cards
│   │   ├── search.css          # Search input area & action buttons
│   │   ├── message-drawer.css  # Historical message drawer
│   │   ├── animations.css      # Keyframe animations
│   │   ├── settings.css        # Settings standalone full-page view
│   │   ├── form-widgets.css    # Sketch autofill & custom select dropdowns
│   │   ├── custom-provider.css # Custom provider management styles
│   │   ├── tool-response.css   # Tool cards, Markdown rendering & error cards
│   │   ├── packages.css        # Kernel panel & package marketplace
│   │   └── overlays.css        # Floating badges, task sidebar, toasts & modals
│   ├── index.html              # Main HTML entry
│   ├── styles.css              # Main stylesheet aggregator (@import to styles/ subfiles)
│   └── main.js                 # Main frontend orchestrator
├── src-tauri/                  # Tauri (Rust) high-performance backend core
│   ├── Cargo.toml              # Dependencies: tokio, serde, dashmap, notify, reqwest, regex, windows-sys
│   ├── tauri.conf.json         # Window configuration, transparency & security policies
│   ├── inner-skills/           # [Core] Runtime constraints dynamically injected into Pi Agent (RULES.md, bash, multimodal/OCR, subagents, web search, memory, workflows, ACP)
│   └── src/
│       ├── lib.rs              # Tauri initialization, command registry, event bus & tray integration
│       ├── main.rs             # Application entrypoint
│       ├── config_manager.rs   # [Core] Configuration management & directory mapping
│       ├── workspace/          # [Core] Multi-workspace template discovery, runtime materialization & config state
│       ├── package_manager/    # [Core] Official package marketplace search, install/uninstall & update subsystem
│       ├── pi_runner/          # [Core] Process supervision, Win32 Job Object orphan reaper, strict LF framer, Inner-Skills injector
│       ├── security/           # [Core] Regex credential & path sanitization middleware
│       ├── session/            # [Core] DashMap in-memory session index & notify incremental watcher
│       └── version_watcher/    # [Core] Jitter version monitoring & dual-source update detector
│
├── AGENTS.md                   # Project rules and agent guidelines
├── README.md                   # Chinese documentation & configuration guide
├── README_en.md                # English documentation & configuration guide
└── package.json

```
