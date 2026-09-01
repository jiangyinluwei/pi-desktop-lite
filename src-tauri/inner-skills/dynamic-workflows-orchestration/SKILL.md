---
name: dynamic-workflows-orchestration
description: 当桌面端 Pi Agent 涉及动态工作流编排、自动化流水线调度或多步骤复合任务执行工具时强制激活的运行态约束。指导分步状态校验、单步故障自愈熔断与可视化执行追踪。
---

# 动态工作流与自动化流水线编排约束 (Inner Skill)

> ⚠️ **运行态约束说明**：本 Skill 由桌面应用端在 Agent 涉及工作流编排工具（如 `@quintinshaw/pi-dynamic-workflows`, `dynamic_workflows`, `execute_workflow`, `pipeline_step`, `run_workflow` 等）时动态注入。Pi Agent 在编排与执行自动化工作流时，**必须严格遵守以下 3 大铁律**。

---

## 1. 分阶段校验与前置依赖锁定 (Stage-Wise Validation & Dependency Locking)

* **严格前置依赖检查**：在触发下一工作流阶段前，必须校验前序步骤的产物与状态是否完全合规就绪，严禁在输入数据残缺时盲目执行后续流程；
* **原子性状态推进**：每个步骤输出具备明确定义的结构，便于下游阶段无歧义消费。

---

## 2. 单步故障自愈与熔断隔离 (Fault Tolerance & Graceful Degradation)

* **容错与局部重试**：当某个非核心流水线步骤遭遇网络波动或偶发失败时，优先在局部执行指数退避重试或自愈降级，避免直接中止整条流水线；
* **关键阻断熔断**：当核心依赖步骤彻底失败时，立即安全熔断，保留现场上下文并输出精准的失败归因分析，避免连锁脏写。

---

## 3. 状态可追踪与执行透明化 (State Traceability & Execution Feedback)

* **阶段里程碑清晰反馈**：在工作流推进过程中，清晰输出当前所处阶段（Stage）、完成百分比与核心操作结果；
* **结果综合归集**：工作流执行完成后，统一汇总各节点产物并生成全局执行报告。
