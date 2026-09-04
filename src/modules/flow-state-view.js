/**
 * flow-state-view.js — Flow 视图派生缓存唯一属主 + 流式数据分仓 taskId 解析（阶段 7 批次 A）
 *
 * 定位（对应《降耦合方案》§4 阶段 3b-B / 《GUI 回归专项》§3）：
 *   1. flowView：把原本散挂在 ctx.flow 上的「视图派生缓存」（当前轮次 DOM 引用、步骤快照、
 *      活跃切片卡、计时器句柄、吸底跟随标记）统一收拢到本模块唯一属主。
 *      按铁律热区清单（方案 §4 阶段 2.1 ⑤）**严禁迁入 flowStore**——它们是 DOM 派生物，
 *      与 flowStore 的纯数据（responseText / thinkingText …）一一分离。
 *      对象已 Object.seal：任何把纯数据字段误写回 flowView 的行为会在 ESM 严格模式下
 *      立即抛 TypeError（防幽灵字段复发的硬闸）。
 *   2. resolveStreamTaskId：流式纯数据分仓（flowStore.for(taskId)）的 taskId 解析器，
 *      显式 id 优先（发送链 currentTask.id / 回填链 task.id / 自愈链 engine.taskId），
 *      缺省回退「前台活跃任务」→ 事件帧 task_id → 稳定哨兵分仓（legacy 无 task_id 帧）。
 *      事件驱动写入点全部位于前台门禁（isForegroundStreamEvent）之后，
 *      分仓键在门禁通过时恒等于 piClient.lastEventTaskId，后台任务事件永远写不到前台分仓。
 *
 * 纯数据字段（responseText / thinkingText / errorMessage / lastUserQuery / hasReceivedDelta /
 * hasAutoCollapsedThinking / interruptSendTaskId / lastSentPrompt / lastSentAttachments /
 * lastImagePayloads / thinkingStartTime）一律经 `flowStore.for(resolveStreamTaskId(id))` 读写，
 * 本模块与任何模块都严禁再出现 `flow.<纯数据>` 裸写。
 */

import { taskManager } from "../services/task-manager.js";
import { piClient } from "../services/pi-client.js";

/** legacy 无 task_id 事件帧且无活跃任务时的稳定哨兵分仓键。 */
export const STREAM_BUCKET_FALLBACK = "__stream__";

/**
 * Flow 视图派生缓存（唯一属主，sealed 防幽灵字段）。
 * @type {{
 *   renderedToolCards: Map<string, HTMLElement>,
 *   currentSteps: object[],
 *   activeThinkingStep: object|null,
 *   activeToolStep: object|null,
 *   activeTextStep: object|null,
 *   activeToolPseudoStep: object|null,
 *   thinkingTimerInterval: number|null,
 *   textTimerInterval: number|null,
 *   toolPseudoTimerInterval: number|null,
 *   toolRunTimerInterval: number|null,
 *   activeTurnRefs: object|null,
 *   followBottom: boolean,
 * }}
 */
export const flowView = Object.seal({
  /** 当前轮次已渲染的工具卡注册表（toolCallId → cardEl），tool-update/tool-end 与自愈检索共用 */
  renderedToolCards: new Map(),
  /** 当前轮次时序步骤快照（thinking / text(Point) / tool 切片），归档时沉淀 */
  currentSteps: [],
  /** 当前活跃思维切片卡（含 cardEl/durationEl 等 DOM 引用） */
  activeThinkingStep: null,
  /** 当前活跃工具切片卡 */
  activeToolStep: null,
  /** 当前活跃阶段性输出 (Point) 切片卡 */
  activeTextStep: null,
  /** 伪工具运行框占位卡（参数流式期空窗辅助显示） */
  activeToolPseudoStep: null,
  /** 思维切片读秒计时器句柄 */
  thinkingTimerInterval: null,
  /** 阶段性输出读秒计时器句柄 */
  textTimerInterval: null,
  /** 伪工具运行框读秒计时器句柄 */
  toolPseudoTimerInterval: null,
  /** 真实工具卡读秒计时器句柄 */
  toolRunTimerInterval: null,
  /** 当前轮次 DOM 组引用（groupEl / responseContentEl / stepsContainerEl …） */
  activeTurnRefs: null,
  /** 吸底跟随开关：用户向上滚离即 false，流式输出不再拽动视口 */
  followBottom: true,
});

/**
 * 解析流式纯数据分仓的 taskId（显式 id 优先）。
 * @param {string|null} [explicit] 调用方已知的任务 id（发送链 / 回填链 / 自愈链）
 * @returns {string} 分仓键（永不为空，兜底哨兵分仓）
 */
export function resolveStreamTaskId(explicit) {
  if (explicit) return explicit;
  return (
    taskManager.getCurrentActiveTask()?.id ||
    piClient.lastEventTaskId ||
    STREAM_BUCKET_FALLBACK
  );
}
