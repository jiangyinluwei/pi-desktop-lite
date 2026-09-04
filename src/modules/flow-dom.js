/**
 * flow-dom.js — Flow 域「只读 DOM 引用」层（阶段 3b 落地，阶段 7 批次 B 改为 el-binder 自绑定）
 *
 * 定位：把 flow-ui / flow-stream / flow-pipeline / task-panel / flow-rollback 各自持有的
 *       少量 flow 相关 DOM id，收敛为「本域专属引用」。
 *       只读、无状态、不碰共享可变数据；仅负责「按登记表从 document 取出 flow 子集」。
 *
 * 约定（对应方案 §4 阶段 4 el-binder）：
 *   - 本模块只导出「工厂 + 集中登记的 id 表」，不导出全局单例；
 *   - flow 子集 id 在此集中登记，改动 DOM id 只需改此一处 + index.html；
 *   - 批次 B 起 createFlowDom() 经 el-binder.bindAll 自取（与原 main.js getElementById
 *     全量收集语义一致，同 id 恒同一元素），不再依赖 ctx.el 入参，杜绝双绑；
 *   - 严禁在此读写任何 flowView 状态 / Store（纯引用层）。
 *
 * 用法：
 *   // main.js：
 *   const flowDom = createFlowDom();
 *   // 模块内：const flowDom = ctx.flowDom;
 */

import { bindAll } from "../lib/el-binder.js";

/** Flow 域关注的全部元素 id（集中登记，与 src/index.html 对齐）。 */
export const FLOW_EL_IDS = {
  flowStage: "flow-stage",
  flowScrollArea: "flow-scroll-area",
  flowConversation: "flow-conversation",
  flowQuestionTip: "flow-question-tip",
  flowQuestionTipText: "flow-question-tip-text",
  flowTurnNav: "flow-turn-nav",
  flowTurnNavUp: "flow-turn-nav-up",
  flowTurnNavDown: "flow-turn-nav-down",
  flowUserText: "flow-user-text",
  flowPromptAttachments: "flow-prompt-attachments",
  thinkingToggleBtn: "thinking-toggle-btn",
  agentThinkingCard: "agent-thinking-card",
  thinkingDuration: "thinking-duration",
  thinkingTextStream: "thinking-text-stream",
  thinkingBody: "thinking-body",
  toolCallsContainer: "tool-calls-container",
  flowResponseContent: "flow-response-content",
  flowModelTag: "flow-model-tag",
  flowModelName: "flow-model-name",
  flowBtnAbort: "flow-btn-abort",
  taskDetailsSidebar: "task-details-sidebar",
};

/**
 * 取 Flow 域只读引用（内部经 el-binder.bindAll 按 id 自取，无副作用）。
 * @returns {Record<string, Element|null>} flow 域只读引用
 */
export function createFlowDom() {
  return bindAll(FLOW_EL_IDS);
}

export default createFlowDom;
