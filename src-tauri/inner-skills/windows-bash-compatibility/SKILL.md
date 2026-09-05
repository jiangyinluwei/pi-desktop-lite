---
name: windows-bash-compatibility
description: Runtime constraint active when invoking bash, powershell, or command-line execution tools on Windows. Mandates cross-platform syntax substitution, forward-slash paths, pager suppression to prevent hanging, and UTF-8 console encoding safeguards.
---

# Windows Runtime Shell & Tool Calling Directives (Inner Skill)

> **Runtime Constraint**: Dynamically injected into tool-calling context under Windows (`bash`, `terminal`, `powershell`, `cmd`, `execute_command`). You **MUST strictly adhere to the following 5 directives**.

---

## 1. Path Formatting: Universal Forward Slashes `/`

* **Never use unescaped backslashes**: Backslashes `\` in escape sequences and JSON parsing turn `\n`, `\t`, `\r` into control characters, mangling file paths.
* **Standardize on forward slashes**: Always format file paths and working directory arguments with forward slashes (e.g., `C:/Users/name/repo/src` or `./src/config.json`). Windows API and modern CLI tools fully support forward slashes natively.
* **Quote paths with spaces**: Always wrap paths containing spaces (e.g., `"C:/Program Files/..."`) in double quotes.

---

## 2. Anti-Hang Invariance: Non-Interactive Execution & Pager Suppression

In non-PTY or automated execution environments, commands waiting on interactive user input hang indefinitely until timeout:

* **Enforce non-interactive flags**: Always append auto-confirm flags to initialization, installation, and deletion commands (e.g., `npm init -y`, `pnpm add -y`, `npx -y`).
* **Suppress pagers**: Never run commands that invoke a pager. When running `git log` or `git diff`, explicitly pass `--no-pager` (e.g., `git --no-pager log -n 5`).
* **Environment pager override**: In batch or chained commands, prefix with `PAGER=cat` or `GIT_PAGER=cat`.

---

## 3. Cross-Platform Syntax & Command Equivalents

On Windows, never issue unadapted Linux-specific commands or Bash idioms:

| Disallowed (Linux/Bash Idiom) | Safe Windows Alternative | Reason |
| :--- | :--- | :--- |
| `export VAR=val && ...` | `cross-env VAR=val ...` or handle in-process | Windows CMD / PowerShell do not support `export` |
| `rm -rf <path>` | Prefer Node/Python script deletion, or PowerShell `Remove-Item -Recurse -Force` | Native Windows Shell lacks `rm -rf` |
| `touch <file>` | `New-Item <file>` or write directly via file tools | Windows lacks native `touch` |
| `curl -X POST ...` (in PowerShell) | Explicitly call `curl.exe` or use JS/Python scripts | PowerShell aliases `curl` to `Invoke-WebRequest`, breaking parameter syntax |
| `cat <file> \| grep ...` | Prefer dedicated search/grep tools | Pipeline differences risk encoding corruption |
| `$(command)` or complex subshells | Decompose into separate steps or script files | Windows Shell has limited subshell nesting support |

---

## 4. Encoding Safeguards & Clean Output (UTF-8 & No-Color)

* **Strip ANSI control codes**: When running CLI tools with styled terminal output, pass `NO_COLOR=1` to prevent ANSI escape codes from cluttering context.
* **Console UTF-8 declaration**:
  * In PowerShell: `$OutputEncoding = [System.Text.UTF8Encoding]::new($false);`
  * In CMD: `chcp 65001` before commands with non-ASCII characters.

---

## 5. Daemons & Long-Running Processes

* Never append `&` to background a process on Windows (it fails to detach properly, causing hangs or orphan processes).
* To start long-running servers or watchers (e.g., `npm run dev`), use host-provided `IsDaemon` / `run_in_background` parameters instead.
