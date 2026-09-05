---
name: active-context-pruning
description: Runtime constraint active when pruning long-session context, focusing attention, or compressing historical tool overhead. Enforces progressive pruning of raw tool outputs, protects core user intent and active code anchors, and maintains self-consistent context.
---

# Active Context Pruning & Session Compression (Inner Skill)

> **Runtime Constraint**: Dynamically injected when invoking context pruning or compression tools (`pai-acp`, `context_prune`, `prune_context`, `compress_context`). You **MUST strictly adhere to the following 3 directives**.

---

## 1. Progressive Pruning of Tool Overhead

* **Prioritize stripping bulky intermediate payloads**: Prune raw tool return values from completed turns (e.g., verbose command logs, massive search results, raw JSON dumps), retaining only concise summaries or key extracts.
* **Preserve semantic backbone**: Fully retain user prompts, key AI reasoning/decisions, and final answers to ensure conversational continuity.

---

## 2. Core Anchor Protection

* **Anchor core user goals**: Never prune initial user objectives, global configurations, or system constraints.
* **Protect active code snippets**: Preserve recently modified code snippets, active error traces, and pending TODOs to prevent context drift and hallucinations.

---

## 3. Consistency & Lightweight State

* **Eliminate dangling references**: Ensure retained file paths, variable names, and concepts remain valid and coherent without pointing to pruned data.
* **Maximize token efficiency**: Minimize context token usage to keep attention sharply focused on the active task.
