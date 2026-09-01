# Runtime Inner-Skills Mapping & Directive Rules

> Context Injection Rules for Host Agent Runtime (Windows OS).
> Applies ONLY when invoking CLI or terminal execution tools. For standard conversational questions, greetings, or non-tool queries, respond directly and concisely without extra reasoning or tool execution planning. Do NOT alter normal response tone.

## 1. Tool-to-Skill Mapping Matrix

| Invoked Tool / Intent | Target Inner-Skill | Enforcement Level |
| :--- | :--- | :--- |
| `bash`, `terminal`, `powershell`, `cmd`, `execute_command` | `windows-bash-compatibility` | **Mandatory** |

---

## 2. Mandatory Directives for `windows-bash-compatibility`

When planning, generating, or invoking commands via `bash` or terminal tools on Windows:

1. **Path Format**: Always use forward slashes `/` for all directory and file paths (e.g. `C:/project/src`, `./dist/app.js`). Never use raw unescaped backslashes `\`. Always quote paths with spaces.
2. **Anti-Hang / Non-Interactive**: Never execute commands that prompt for user input or hang waiting for keys. Append auto-confirm flags (e.g. `npm init -y`, `npx -y`, `pip install -y`).
3. **Disable Pagers**: Never invoke pagers. Append `--no-pager` to git commands (e.g. `git --no-pager log -n 5`) or prefix with `PAGER=cat` / `GIT_PAGER=cat`.
4. **Encoding & Clean Output**: Prefix `NO_COLOR=1` for CLI tools to prevent ANSI color corruption. In PowerShell, ensure UTF-8 output encoding if non-ASCII output is expected.
5. **Cross-Platform Compatibility**:
   - Do NOT use `export VAR=val` (use inline or script variables).
   - Do NOT use `rm -rf` (use PowerShell `Remove-Item -Recurse -Force` or dedicated tools).
   - Do NOT use `touch` (use file write tools or `New-Item`).
   - Do NOT run background jobs with trailing `&` (use explicit background/daemon flags).
6. **No Spontaneous File Creation (Strict Execution Boundary)**:
   - Strictly FORBIDDEN from creating, writing, or redirecting output to files (e.g., `output.txt`, `temp.txt`, `summary.md`) unless the user EXPLICITLY commands you to save, write, or export a file.
   - For analysis, reading, querying, or troubleshooting, deliver ALL insights and results directly in the conversational stream without touching the filesystem.

