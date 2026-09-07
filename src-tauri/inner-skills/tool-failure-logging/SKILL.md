---
name: tool-failure-logging
description: Runtime constraint active when executing tools or handling tool failures. Mandates that whenever any tool invocation results in an error, non-zero exit status, or failure, full diagnostic details must be structured and logged into the workspace log folder.
---

# Tool Failure Diagnostics & Workspace Logging Protocol (Inner Skill)

> **Runtime Constraint**: Injected during tool execution and failure recovery (`bash`, `terminal`, `powershell`, `cmd`, `execute_command`, `write`, `write_file`, `edit`, `read_file`, `subagent`, `web_search`, `tool_failure`, `log_error`). You **MUST strictly adhere to the following 4 directives**.

---

## 1. Zero Silent Failures & Proactive Capture

* **Never ignore or bypass failed tools**: If any tool invocation fails (returns an error message, non-zero exit code, unhandled exception, syntax/parsing error, or timeout), you MUST NOT silently continue or pretend the step succeeded.
* **Immediate diagnostic gathering**: Immediately capture the complete failure context:
  * Timestamp of the event;
  * Target tool name and tool call identifier;
  * Exact invoked parameters and arguments;
  * Full standard error (stderr), error message, or stack trace;
  * Probable root cause (e.g., missing dependency, path error, syntax fault, network timeout).

---

## 2. Workspace `log/` Folder Archival

* **Mandatory destination**: Whenever a tool failure occurs, record and organize the detailed failure information into the `log/` folder in the current workspace:
  `<workspace>/log/tool-errors.log` (and/or `<workspace>/log/tool_failure_<timestamp>.log`).
* **Auto-creation**: If the `<workspace>/log/` directory does not exist, you MUST proactively create it first (e.g., via `mkdir -p log` or file tools) before writing.
* **Structured log format**: Each failure record must follow a clear, readable structure:
  ```text
  ================================================================================
  [TIMESTAMP] TOOL EXECUTION FAILURE
  Tool: <tool_name>
  Call ID: <tool_call_id>
  Arguments: <invoked_arguments_json>
  Error Details:
  <stderr_or_error_message>
  Root Cause Analysis: <brief_cause>
  Remediation Plan: <planned_fix_or_fallback>
  ================================================================================
  ```

---

## 3. Exemption from Scratch Purge Policies

* **Permanent diagnostic value**: Unlike ephemeral probe scripts and scratch files governed by `temp-file-hygiene` (which must stay in `~/.pi-dl/temp/` and be deleted immediately), failure logs in `<workspace>/log/` serve as essential audit trails and troubleshooting history for both the user and the agent.
* **Preserve logs**: Do NOT delete, purge, or clean up `<workspace>/log/` entries during or after task execution. Keep them intact.

---

## 4. Remediation & Transparent Communication

* **Evidence-based recovery**: Formulate the subsequent recovery or retry step based on the logged root cause rather than repeating the same failed command blindly.
* **User transparency**: When concluding or summarizing, briefly inform the user that a tool failure occurred and its full diagnostic report has been preserved in the workspace `log/` folder.
