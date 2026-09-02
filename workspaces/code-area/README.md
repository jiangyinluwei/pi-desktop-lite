# Code Area (Pi Desktop Lite)

This directory serves as the **global coding skill hub & dispatch center** for Pi Agent.

- **`AGENTS.md`**: Runtime dispatch guidelines, hub-and-spoke routing model, and non-pollution ironclad rules.
- **`workspace.json`**: Workspace preset metadata (`id`, `name`, `description`, `icon`, `requiresRoute: true`).
- **`.agents/skills/`**: Global coding skills library (extensible by developers, e.g. refactoring, review, Git workflow).
- **Routed Target Workspace**: In this workspace mode, Pi Agent never alters files in `code-area` itself. Instead, it reads and modifies files in the configured routed target project.
