/**
 * flow-store.js — Flow 流式交互「纯数据状态」唯一属主（阶段 2 / 3 落地，按 taskId 分仓）
 *
 * 定位：把散落在 flow-stream / flow-pipeline / flow-ui / task-panel / flow-rollback 中的
 *       `flow.*` **纯数据**字段收拢为唯一属主。**视图派生缓存**（renderedToolCards、
 *       activeTurnRefs、currentSteps、active*Step、计时器、followBottom 等）**严禁入 store**，
 *       按铁律热区清单留在视图层（flow-render / flow-dom，阶段 3 拆分时归位）。
 *
 * ⚠️ AGENTS.md 铁律敏感热区清单（阶段 2.1）—— Store 设计硬约束：
 *   1. 同步探测不变量：所有 action 全同步，严禁 async / await / 微任务调度；
 *   2. 后台流式前台门禁：本 store 发出的 flow:response 等事件**必须携带 taskId**，
 *      监听方（Flow UI）收到后先经 `taskManager.isForegroundStreamTask` 过前台门禁再触 DOM，
 *      否则后台事件风暴将复发已修复的频闪 bug；
 *   3. 按 Task 隔离：必须按 taskId 分仓（`for(taskId)` ），严禁全局单例裸状态；
 *   4. 回退五步执行链：整体留在 flow-rollback.js 编排，本 store 只承接链尾剪枝/重渲的数据变更；
 *   5. renderedToolCards 留在视图层，本 store 只收纯数据。
 *
 * 用法：
 *   import { flowStore } from "../services/stores/flow-store.js";
 *   const fs = flowStore.for(taskId);
 *   fs.appendResponse(delta);            // 同步 + bus.emit("flow:response", { taskId, delta })
 *   fs.set({ responseText: "", errorMessage: null, ... });
 *   const text = fs.responseText;
 *   flowStore.clear(taskId);             // 任务结束/销毁分仓
 */
import { bus } from "../../lib/event-bus.js";

/** 初始纯数据状态（不含任何视图派生缓存）。 */
function createFlowData() {
  return {
    responseText: "",
    thinkingText: "",
    errorMessage: null,
    lastUserQuery: "",
    hasReceivedDelta: false,
    hasAutoCollapsedThinking: false,
    interruptSendTaskId: null,
    lastSentPrompt: "",
    lastImagePayloads: null,
    lastSentAttachments: [],
    thinkingStartTime: 0,
  };
}

// 按 taskId 分仓：taskId -> state（Task 隔离铁律）。
const buckets = new Map();

/** 获取（或惰性创建）某 taskId 的纯数据分仓。 */
function bucketFor(taskId) {
  if (!buckets.has(taskId)) buckets.set(taskId, createFlowData());
  return buckets.get(taskId);
}

export const flowStore = {
  /**
   * 取某个任务的作用域 store 实例。
   * @param {string|number} taskId 任务唯一标识（必带，保证 Task 隔离）
   */
  for(taskId) {
    const s = bucketFor(taskId);

    return {
      get responseText() {
        return s.responseText;
      },
      get thinkingText() {
        return s.thinkingText;
      },
      get errorMessage() {
        return s.errorMessage;
      },
      get lastUserQuery() {
        return s.lastUserQuery;
      },
      get hasReceivedDelta() {
        return s.hasReceivedDelta;
      },
      get hasAutoCollapsedThinking() {
        return s.hasAutoCollapsedThinking;
      },
      get interruptSendTaskId() {
        return s.interruptSendTaskId;
      },
      get lastSentPrompt() {
        return s.lastSentPrompt;
      },
      get lastImagePayloads() {
        return s.lastImagePayloads;
      },
      get lastSentAttachments() {
        return s.lastSentAttachments;
      },
      get thinkingStartTime() {
        return s.thinkingStartTime;
      },

      /** 同步覆写若干纯数据字段（白名单式安全更新）。 */
      set(patch) {
        if (!patch || typeof patch !== "object") return;
        const keys = Object.keys(createFlowData());
        for (const k of keys) {
          if (k in patch) s[k] = patch[k];
        }
        // 一律同步；事件由各 action 按需发出，避免 set 引发无差别风暴。
      },

      /**
       * 流式追加响应文本（同步）。
       * 同步探测不变量：此函数严禁 async。
       * 事件必带 taskId：监听方先过前台门禁再触 DOM。
       */
      appendResponse(delta) {
        s.responseText += delta;
        s.hasReceivedDelta = true;
        bus.emit("flow:response", { taskId, delta });
      },

      /** 重置本任务纯数据分仓。 */
      resetAll() {
        Object.assign(s, createFlowData());
      },
    };
  },

  /** 是否存在某 taskId 分仓。 */
  has(taskId) {
    return buckets.has(taskId);
  },

  /** 销毁某 taskId 分仓（任务终态/归档时调用，防泄漏）。 */
  clear(taskId) {
    buckets.delete(taskId);
  },
};

export default flowStore;
