---
name: temp-file-hygiene
description: Runtime constraint active when writing files, creating files, or executing shell commands that may generate temporary files, probe scripts, or intermediate output. Enforces strict sandbox isolation in the system temp directory, zero workspace pollution, and immediate cleanup after use.
---

# Temp File Sandbox & Immediate Cleanup Hygiene (Inner Skill)

> **Runtime Constraint**: Dynamically injected when creating files or executing shell commands (`write`, `write_file`, `create_file`, `temp_file`, `bash`, `terminal`, `powershell`, `cmd`, `execute_command`). You **MUST strictly adhere to the following 4 directives**.

---

## 1. Zero-Pollution Workspace Sandbox

* **Never create temporary files in workspace**: Never create temporary files (e.g., `tmp.py`, `temp.txt`, `output.log`, `test.ps1`, `probe.js`) in the workspace root, routed project directories, or subdirectories.
* **Direct markdown output for analysis**: Deliver analysis, reviews, explanations, and answers directly as Markdown in conversation; never redirect output to scratch files on disk.
* **Keep Git status pristine**: Prevent untracked file pollution in git repositories.

---

## 2. Designated Runtime Temp Directory

When multi-step extraction, syntax testing, or diagnostic probes strictly require disk writes:

* **Sole authorized temp directory**: All temporary artifacts **MUST strictly reside** in the designated runtime temp directory:
  `{{PI_DL_TEMP_DIR}}`
* **Naming conventions**: Prefix temp files with a descriptive tag and timestamp (e.g., `pidl_probe_<name>_<timestamp>.py`) to prevent collisions.
* **Normalized forward slashes**: Always reference this directory with forward slashes `/` and quote paths containing spaces.

---

## 3. Immediate Chained Cleanup Invariance

* **Bound lifecycle**: Temporary files exist only for the immediate single step. **Delete immediately after execution; never leave behind.**
* **Chained shell cleanup**: Always chain execution with immediate cleanup so files are removed regardless of exit status:
  * **PowerShell**:
    `python "{{PI_DL_TEMP_DIR}}/probe.py" ; Remove-Item -Force -ErrorAction SilentlyContinue "{{PI_DL_TEMP_DIR}}/probe.py"`
  * **Bash**:
    `python "{{PI_DL_TEMP_DIR}}/probe.py" ; rm -f "{{PI_DL_TEMP_DIR}}/probe.py"`
  * **CMD**:
    `python "{{PI_DL_TEMP_DIR}}/probe.py" & del /f /q "{{PI_DL_TEMP_DIR}}\probe.py"`
* **File tool cleanup loop**: If creating scratch files via `write` or `create_file` in the temp dir, invoke removal commands or tools in subsequent steps before completing the task.

---

## 4. Dirty State Self-Healing

* **Pre-execution purge**: If prior interrupted runs left stale probe files in `{{PI_DL_TEMP_DIR}}`, purge them before starting new runs.
* **Clean delivery**: Before reporting final completion to the user, ensure all session temporary files have been purged.
