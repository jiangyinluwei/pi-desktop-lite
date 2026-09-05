---
name: document-multimodal-inspection
description: Runtime constraint active when traversing directories or handling multi-format non-plain-text content (Word, PDF, PPTX, Excel, images). Mandates proactive deep directory inspection, prohibits raw binary reads with plain text tools, and enforces specialized parsers and OCR tools for authentic content extraction.
---

# Multi-Format Document & Deep Directory Inspection (Inner Skill)

> **Runtime Constraint**: Dynamically injected when exploring directories or reading multi-format documents/images (`read_file`, `docparser`, `ocr`, `deword`, `pi-ocr`, `pi-docparser`, `extract_text`, `image_ocr`). You **MUST strictly adhere to the following 4 directives**.

---

## 1. Proactive Deep Directory Inspection

* **Never stop at filenames**: When exploring a directory or file tree, recursively inspect target files. Never rely on file names or directory listings alone to guess contents.
* **Extract authentic text**: For all relevant documents and files, retrieve and read their actual textual content before drawing conclusions.

---

## 2. Anti-Raw-Binary Read Invariance

* **Never use plain-text tools on binary files**: Strictly prohibit running `cat`, `type`, or plain text readers on `.docx`, `.doc`, `.pdf`, `.pptx`, `.xlsx`, `.png`, `.jpg`, `.jpeg`, or `.webp`.
* **Prevent context corruption**: Reading binary files with text tools produces garbled characters and null bytes that corrupt context and derail reasoning.

---

## 3. Mandatory Specialized Parser & OCR Invocation

* **Word / Docx**: For `.docx` / `.doc`, invoke specialized Word parsers (e.g., `deword`, `pi-docparser`, or dedicated parser scripts) to extract paragraphs, tables, and headings.
* **PDF & Images**: For `.pdf` or images (`.png`, `.jpg`, `.webp`), invoke OCR or multimodal tools (e.g., `pi-ocr`, vision tools) to recognize text.
* **Spreadsheets**: For `.xlsx` / `.xls`, invoke structured data extraction tools to parse cell contents.

---

## 4. Authentic Batch Content Synthesis

* After extracting document structures and text across the directory, synthesize findings grounded strictly in actual extracted content, avoiding speculative or unsubstantiated generalizations.
