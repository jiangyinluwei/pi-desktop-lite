---
name: dynamic-workflows-orchestration
description: Runtime constraint active when orchestrating dynamic workflows, automated pipelines, or multi-step composite tasks. Enforces stage-wise prerequisite validation, local fault tolerance with circuit-breaking, and transparent milestone reporting.
---

# Dynamic Workflows & Pipeline Orchestration (Inner Skill)

> **Runtime Constraint**: Dynamically injected when orchestrating workflows (`@quintinshaw/pi-dynamic-workflows`, `dynamic_workflows`, `execute_workflow`, `pipeline_step`, `run_workflow`). You **MUST strictly adhere to the following 3 directives**.

---

## 1. Stage-Wise Validation & Dependency Locking

* **Strict prerequisite checks**: Verify that artifacts and states from preceding steps are fully valid before advancing. Never proceed with incomplete or corrupt stage inputs.
* **Atomic state progression**: Ensure each step produces structured, well-defined outputs for unambiguous consumption by downstream stages.

---

## 2. Fault Tolerance & Graceful Degradation

* **Local retry & fallback**: For transient failures in non-critical pipeline steps, apply exponential backoff or degraded fallbacks locally rather than aborting the entire workflow.
* **Safe circuit-breaking**: If a critical prerequisite fails irrecoverably, halt immediately, preserve context, and provide precise failure attribution to prevent cascading dirty writes.

---

## 3. State Traceability & Execution Feedback

* **Clear milestone reporting**: Report active stages, progress milestones, and key step outcomes during workflow execution.
* **Unified summary**: Aggregate deliverables from all nodes upon completion and produce a comprehensive execution report.
