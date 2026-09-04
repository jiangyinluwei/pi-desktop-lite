/**
 * flow-dom.js — Flow 域「只读 DOM 引用」层（阶段 3b 落地）
 *
 * 定位：把 flow-ui / flow-stream / flow-pipeline / task-panel / flow-rollback 各自持有的
 *       少量 flow 相关 DOM id，从「全量 ctx.el 中解构」收敛为「本域专属引用」。
 *       只读、无状态、不碰共享可变数据；仅负责「从 ctx.el 里挑出 flow 子集」。
 *
 * 约定（对应方案 §4 阶段 4 el-binder 的前置原型，阶段 4 再统一到 src/lib/el-binder.js）：
 *   - 本模块只导出「工厂 + 集中登记的 id 表」，不导出全局单例；
 *   - flow 子集 id 在此集中登记，改动 DOM id 只需改此一处 + index.html；
 *   - 严禁在此读写任何 flow.* 状态 / Store / 视图缓存（纯引用层）；
 *   - 「元素定位」类助手（findFlowMessageGroup 等）留待阶段 4 el-binder 落地并真正接线时一并迁入，
 *     避免本阶段引入暂未消费的孤儿导出（代码卫生铁律）。
 *
 * 用法：
 *   // main.js：
 *   const flowDom = createFlowDom(el);
 *   // 模块内：const { flowConversation, flowScrollArea, ... } = flowDom;
 */

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
 * 从已收集的 ctx.el 中抽出 Flow 域引用，返回只读代理对象。
 * 不做任何 DOM 查询（依赖 main.js 的 DOMContentLoaded 收集），无副作用。
 * @param {Record<string, Element|null>} el 由 main.js 收集的全局元素表
 * @returns {Record<string, Element|null>} flow 域只读引用
 */
export function createFlowDom(el) {
  const out = {};
  for (const key of Object.keys(FLOW_EL_IDS)) {
    out[key] = el ? el[key] ?? null : null;
  }
  return out;
}

export default createFlowDom;
