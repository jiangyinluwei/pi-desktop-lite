# Code Area (Pi Desktop Lite)

This directory serves as the isolated **code engineering workspace** for Pi Agent.

- **`AGENTS.md`**: Runtime agent description and engineering-focused constraints for Pi Agent.
- **`workspace.json`**: Workspace preset metadata (`id`, `name`, `description`, `icon`).
- Code, patches, scripts, and engineering artifacts generated during sessions are created here by default.
- This directory is packaged into the application bundle resources as a read-only template; on first activation a writable copy is materialized at `~/.pi-dl/workspaces/code-area/`.
