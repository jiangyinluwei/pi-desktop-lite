# Runtime Inner-Skills Mapping & Directive Rules

> Context Injection Rules for Host Agent Runtime.
> Applies ONLY when invoking tools. For standard conversational questions, greetings, or non-tool queries, respond directly and concisely without extra reasoning or tool execution planning. Do NOT alter normal response tone.

## 1. Tool-to-Skill Mapping Matrix

| Invoked Tool / Intent | Target Inner-Skill | Enforcement Level |
| :--- | :--- | :--- |
| `bash`, `terminal`, `powershell`, `cmd`, `execute_command` | `windows-bash-compatibility` | **Mandatory** |
| `read_file`, `docparser`, `ocr`, `deword`, `pi-ocr`, `pi-docparser`, `extract_text`, `image_ocr` | `document-multimodal-inspection` | **Mandatory** |
| `subagent`, `pi-subagents`, `spawn_agent`, `parallel_tasks`, `delegate_task`, `subtask_spawn` | `multi-agent-orchestration` | **Mandatory** |
| `web_search`, `pi-web-access`, `search_web`, `fetch_web_page`, `web_access`, `browse_page` | `web-search-silent-access` | **Mandatory** |
| `memory_retrieve`, `memory_store`, `pi-memory`, `recall_memory`, `search_memory` | `persistent-memory-retrieval` | **Mandatory** |
| `dynamic_workflows`, `execute_workflow`, `pipeline_step`, `run_workflow` | `dynamic-workflows-orchestration` | **Mandatory** |
| `context_prune`, `prune_context`, `pai-acp`, `compress_context` | `active-context-pruning` | **Mandatory** |

---

## 2. Mandatory Core Directives (Baseline)

When invoking tools or planning actions:

1. **Terminal & CLI Execution (`windows-bash-compatibility`)**:
   - Forward slashes `/` for paths; quote paths with spaces; non-interactive (`-y`); disable pagers (`PAGER=cat`, `--no-pager`); UTF-8 & `NO_COLOR=1`; no spontaneous file creation.

2. **Folder & Multi-Format Documents (`document-multimodal-inspection`)**:
   - Proactively traverse directories; never cat raw binary (`.docx`, `.doc`, `.pdf`, `.pptx`, `.xlsx`, images); automatically invoke specialized parsers/OCR (`pi-ocr`, `deword`, `pi-docparser`) to extract authentic text; batch synthesize findings.

3. **Multi-Agent Scheduling (`multi-agent-orchestration`)**:
   - Define clear subtask boundaries; dispatch independent subtasks in parallel; enforce timeouts; synthesize and deduplicate subagent findings before final response.

4. **Silent Web Access (`web-search-silent-access`)**:
   - Execute in background silently without launching frontend browser windows; multi-source cross-verification; extract authentic citations and dates; filter spam sites.

5. **Persistent Memory (`persistent-memory-retrieval`)**:
   - Proactively retrieve historical context for cross-session queries; match semantic relevance; safe incremental storage; exclude secrets and ephemeral data.

6. **Dynamic Workflows (`dynamic-workflows-orchestration`)**:
   - Stage-wise prerequisite validation; graceful fault tolerance and fallback; clear execution progress and milestone reporting.

7. **Active Context Pruning (`active-context-pruning`)**:
   - Progressively prune obsolete raw tool payloads; protect core goals and latest code snippets; maintain consistent context state.
