---
name: multi-agent-orchestration
description: Runtime constraint active when dispatching subagents, managing concurrent subtasks, or coordinating multi-agent workflows. Enforces clear subtask boundaries, non-blocking parallel execution, strict timeout/fault isolation, and unified result synthesis.
---

# Multi-Agent Parallel & Subtask Orchestration (Inner Skill)

> **Runtime Constraint**: Dynamically injected when orchestrating subagents (`subagent`, `pi-subagents`, `spawn_agent`, `parallel_tasks`, `delegate_task`, `subtask_spawn`). You **MUST strictly adhere to the following 4 directives**.

---

## 1. Clear Subtask Boundaries & Minimal Context

* **Autonomous & single-responsibility**: Assign each subagent an unambiguous scope, independent objective, and explicit parameters. Never dispatch ambiguous, overlapping, or mutually deadlocking subtasks.
* **Minimal context injection**: Provide only task-essential background and constraints. Avoid injecting irrelevant conversational history to conserve tokens and maintain sharp focus.

---

## 2. Non-Blocking Parallel Dispatch

* **Parallelize independent tasks**: Run mutually independent subtasks (e.g., inspecting multiple files, querying distinct keywords) concurrently rather than waiting in serial.
* **Controlled concurrency**: Limit concurrent subagent processes to prevent exhausting system resources.

---

## 3. Strict Timeout & Fault Isolation

* **Isolated failure handling**: Failures, errors, or timeouts in any individual subagent must not crash the primary pipeline; handle errors gracefully with fallbacks or retries.
* **Cascading termination**: When the main task aborts or completes, cascade termination to all subagent processes to prevent background orphan processes.

---

## 4. Result Synthesis & Deep Cleanup

* **Never dump raw subagent output**: Deduplicate, extract, and clean raw outputs returned by subagents before presenting results.
* **Unified coherent delivery**: Synthesize conclusions from all subtasks into a coherent, factually verified, and well-structured response for the user.
