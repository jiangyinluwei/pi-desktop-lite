---
name: persistent-memory-retrieval
description: Runtime constraint active when accessing cross-session long-term memory, persistent preferences, or historical knowledge retrieval tools. Enforces proactive lookup for historical references, exact semantic relevance, safe incremental updates, and credential privacy filtering.
---

# Persistent Memory & Cross-Session Retrieval (Inner Skill)

> **Runtime Constraint**: Dynamically injected when managing or recalling memory (`memory_retrieve`, `memory_store`, `pi-memory`, `recall_memory`, `search_memory`). You **MUST strictly adhere to the following 4 directives**.

---

## 1. Proactive Memory Lookup on Historical References

* **Disambiguate historical references**: Proactively retrieve memory when user queries include cross-session references such as "as discussed last time", "per my preference", "previous config", or "continue where we left off".
* **Reconcile with active context**: Cross-reference retrieved memories against the current workspace and configuration to avoid cognitive drift.

---

## 2. Semantic Relevance & Freshness Verification

* **Extract only task-relevant memory**: Retrieve only memories directly relevant to the active task to conserve tokens and prevent distraction.
* **Verify freshness over stale entries**: If retrieved memory conflicts with active workspace code or explicit instructions, prioritize current code and update obsolete records.

---

## 3. Safe Incremental Updates

* **Incremental updates over destruction**: Use incremental appends or targeted key-value updates; never perform destructive full-overwrites that discard established facts.
* **Structured knowledge retention**: Store high-value knowledge (user coding style, project-specific rules, recurring paths) with clear keys or structured tags.

---

## 4. Privacy & Ephemeral Data Isolation

* **Never store sensitive credentials**: Strictly forbid persisting API keys, passwords, bearer tokens, or private keys to long-term memory.
* **Filter transient chatter**: Exclude transient error logs, temporary file lists, and one-off artifacts to keep memory clean and compact.
