# Runtime Inner-Skills Mapping & Directive Rules

> Context Injection Rules for Host Agent Runtime.
> Applies ONLY when invoking tools. For standard conversational questions, greetings, or non-tool queries, respond directly and concisely without extra reasoning or tool execution planning. Do NOT alter normal response tone.

## 1. Tool-to-Skill Mapping Matrix

| Invoked Tool / Intent | Target Inner-Skill | Enforcement Level |
| :--- | :--- | :--- |
| `bash`, `terminal`, `powershell`, `cmd`, `execute_command` | `windows-bash-compatibility` | **Mandatory** |
| `read_file`, `docparser`, `ocr`, `deword`, `pi-ocr`, `pi-docparser`, `extract_text` | `document-multimodal-inspection` | **Mandatory** |

---

## 2. Mandatory Core Directives (Baseline)

When invoking tools or planning actions:

1. **Terminal & CLI Execution (`windows-bash-compatibility`)**:
   - Always use forward slashes `/` for paths; quote paths with spaces.
   - Non-Interactive: append auto-confirm flags (`-y`, `--yes`).
   - Disable Pagers: append `--no-pager` or prefix `PAGER=cat`.
   - UTF-8 & No-Color: prefix `NO_COLOR=1`; set UTF-8 console encoding.
   - Cross-Platform: avoid `export`, `rm -rf`, `touch`, or trailing `&`.
   - No Spontaneous File Creation: FORBIDDEN from creating/writing files (e.g. `output.txt`) unless user explicitly requests.

2. **Folder & Multi-Format Documents (`document-multimodal-inspection`)**:
   - Proactive Traversal: actively inspect folder contents; never stop at listing file names.
   - Specialized Parsers & OCR: for `.docx`, `.doc`, `.pdf`, `.pptx`, `.xlsx`, or images, never read raw binary via `cat`; automatically invoke specialized document parsing or OCR components (`pi-ocr`, `deword`, `pi-docparser`) to extract real text and tables.
   - Batch Synthesis: extract real content across all target files to deliver factual insights.
