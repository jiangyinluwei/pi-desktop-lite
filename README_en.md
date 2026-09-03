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

- **Four-State Interface & Flow Streaming**: Detailed, Focus, Flow stream, and full-page Settings modes with single-line thinking chains and Typedown-grade Markdown rendering;
- **Background Tasks & Routed Workspaces**: Seamless task background suspension, historical turn restoration, `code-area` non-polluting routing hub, and multi-preset switching;
- **Hand-Drawn Sketch Aesthetics**: Universal hand-drawn SVG vector icons, paper-texture dual-mode themes, and custom `SketchSelect` / `SketchAutoFill` / `SketchModal` components;
- **Rust Performance & Self-Healing Core**: Kernel-level orphan process harvesting, smooth auto-reconnect insurance on crashes, Node.js preflight checks, and native desktop integration.

> 📖 **Full Architecture & Development Specifications**: Refer to [`.agents/skills/pi-desktop-overview/SKILL.md`](.agents/skills/pi-desktop-overview/SKILL.md).

---

## 🚀 Quick Start & Desktop Development

> ⚠️ **Important Prerequisite**: Before launching the project, please extract [`.mytools/pi-body/pi-windows-x64.7z`](.mytools/pi-body/pi-windows-x64.7z) (extract into `.mytools/pi-body/pi-windows-x64/` containing `pi.exe` and core binaries).

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

## ⚙️ Pi Ecosystem Configuration
 
Pi Desktop Lite fully adheres to the native Pi kernel ecosystem, supporting various LLM integrations (OAuth / API Key / environment variables / local Ollama) as well as rich extension components (Packages / Agent Skills / TypeScript Extensions).

> 📖 **Configuration & Ecosystem Guide**: For complete instructions on model authentication, custom endpoints, package management, and extension development, please refer to [`.agents/skills/pi-ecosystem-configuration/SKILL.md`](.agents/skills/pi-ecosystem-configuration/SKILL.md).

---

## 📁 Project Directory Topology

```text
pi-desktop-lite/
├── .agents/skills/             # Development-level agent skill definitions (pi-ecosystem-configuration, auto-compile-and-fix, sketch-drafting-ui, etc.)
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
