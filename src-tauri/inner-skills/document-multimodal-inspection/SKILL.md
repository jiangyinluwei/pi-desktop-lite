---
name: document-multimodal-inspection
description: Runtime constraint active when traversing directories or handling multi-format non-plain-text content (Word, PDF, PPTX, Excel, images). Mandates proactive deep directory inspection, prohibits raw binary reads with plain text tools, prioritizes native multimodal vision reading for images with OCR fallback, and enforces specialized parsers for authentic content extraction.
---

# Multi-Format Document & Multimodal Inspection (Inner Skill)

> **Runtime Constraint**: Dynamically injected when exploring directories or reading multi-format documents/images (`read_file`, `docparser`, `ocr`, `deword`, `pi-ocr`, `pi-docparser`, `extract_text`, `image_ocr`). You **MUST strictly adhere to the following directives**.

---

## 1. Proactive Deep Directory Inspection

* **Never stop at filenames**: When exploring a directory or file tree, recursively inspect target files. Never rely on file names or directory listings alone to guess contents.
* **Extract authentic text & content**: For all relevant documents and files, retrieve and inspect their actual content before drawing conclusions.

---

## 2. Anti-Raw-Binary Read Invariance

* **Never use plain-text tools on binary files**: Strictly prohibit running `cat`, `type`, or plain text readers on `.docx`, `.doc`, `.pdf`, `.pptx`, `.xlsx`, `.png`, `.jpg`, `.jpeg`, `.webp`, or other binary media.
* **Prevent context corruption**: Reading binary files with text tools produces garbled characters and null bytes that corrupt context and derail reasoning.

---

## 3. Image & Visual Content Adaptive Protocol (Vision-Native Priority with OCR Fallback)

* **Vision-Native First**: If the active model has native multimodal vision capabilities, inspect and comprehend images (`.png`, `.jpg`, `.jpeg`, `.webp`, etc.) directly from visual inputs without calling external OCR tools.
* **OCR Fallback**: Invoke external OCR tools (e.g., `pi-ocr` or vision parsing tools) ONLY when:
  1. The active model is text-only (lacks multimodal vision capabilities);
  2. Direct visual processing fails, returns an unsupported media error, or encounters API limitations; OR
  3. Precise, verbatim tabular text extraction, exact text coordinates, or specialized document OCR is explicitly demanded.
* **Graceful Degradation**: If an OCR tool is unavailable or fails, report the limitation clearly. Never enter recursive tool-call retry loops on missing OCR utilities.

---

## 4. Specialized Document Parsers

* **Word / Docx**: For `.docx` / `.doc`, invoke specialized Word parsers (e.g., `deword`, `pi-docparser`, or dedicated parser scripts) to extract paragraphs, tables, and headings.
* **PDF Documents**: For `.pdf`, use dedicated PDF parsers or render pages for visual inspection / OCR fallback as appropriate.
* **Spreadsheets**: For `.xlsx` / `.xls`, invoke structured data extraction tools to parse cell contents.

---

## 5. Authentic Content Synthesis

* After extracting document structures, text, or visual findings across the directory, synthesize conclusions grounded strictly in actual extracted content, avoiding speculative or unsubstantiated generalizations.
