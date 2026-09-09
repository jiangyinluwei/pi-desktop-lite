/**
 * flow-store.js — Flow 流式交互「纯数据状态」唯一属主（阶段 2 / 3 落地，阶段 7 批次 A 接管全部纯数据字段）
 *
 * 定位：把散落在 flow-stream / flow-pipeline / flow-ui / task-panel / flow-rollback 中的
 *       流式「纯数据」字段收拢为唯一属主。**视图派生缓存**（renderedToolCards、
 *       activeTurnRefs、currentSteps、active*Step、计时器、followBottom 等）**严禁入 store**，
 *       已归位 src/modules/flow-state-view.js 的 flowView（阶段 7 批次 A）。
 *
 * ⚠️ AGENTS.md 铁律敏感热区清单（阶段 2.1）—— Store 设计硬约束：
 *   1. 同步探测不变量：所有 action 全同步，严禁 async / await / 微任务调度；
 *   2. 后台流式前台门禁：本 store 发出的 flow:response 等事件**必须携带 taskId**，
 *      监听方（Flow UI）收到后先经 `taskManager.isForegroundStreamTask` 过前台门禁再触 DOM，
 *      否则后台事件风暴将复发已修复的频闪 bug；
 *   3. 按 Task 隔离：必须按 taskId 分仓（`for(taskId)` ），严禁全局单例裸状态；
 *   4. 回退五步执行链：整体留在 flow-rollback.js 编排，本 store 只承接链尾剪枝/重渲的数据变更；
 *   5. renderedToolCards 等视图派生缓存留在视图层（flow-state-view.js），本 store 只收纯数据。
 *
 * 分仓键解析：调用方经 flow-state-view.js 的 `resolveStreamTaskId(explicit)` 取键
 * （显式 id 优先 → 前台活跃任务 → 事件帧 task_id → 哨兵分仓）。本 store 对空键归一化到
 * 稳定哨兵分仓，保证任何调用路径都不会因键缺失而抛错或写散。
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

/** 空分仓键归一化哨兵（legacy 无 task_id 帧兜底）。 */
const FALLBACK_BUCKET = "__stream__";

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
    lastSentAttachments: [],
    thinkingStartTime: 0,
  };
}

/** 纯数据字段白名单（set 增量更新只接受这些键；模块级常量避免热路径每次分配）。 */
const FLOW_DATA_KEYS = Object.keys(createFlowData());

// 按 taskId 分仓：taskId -> state（Task 隔离铁律）。
const buckets = new Map();
// 分仓作用域实例记忆化：同一 taskId 的 for() 恒定返回同一代理对象，
// 流式热路径（逐 token）零分配。clear(taskId) 时一并失效。
const scopes = new Map();

/** 归一化分仓键。 */
function normalizeKey(taskId) {
  return taskId || FALLBACK_BUCKET;
}

/** 获取（或惰性创建）某 taskId 的纯数据分仓。 */
function bucketFor(taskId) {
  const key = normalizeKey(taskId);
  if (!buckets.has(key)) buckets.set(key, createFlowData());
  return buckets.get(key);
}

/** 构建（或复用）某 taskId 的作用域实例。 */
function scopeFor(taskId) {
  const key = normalizeKey(taskId);
  let scope = scopes.get(key);
  if (scope) return scope;

  const s = bucketFor(key);

  scope = {
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
    get lastSentAttachments() {
      return s.lastSentAttachments;
    },
    get thinkingStartTime() {
      return s.thinkingStartTime;
    },

    /** 同步覆写若干纯数据字段（白名单式安全更新）。 */
    set(patch) {
      if (!patch || typeof patch !== "object") return;
      for (const k of FLOW_DATA_KEYS) {
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
      bus.emit("flow:response", { taskId: key, delta });
    },

    /** 重置本任务纯数据分仓。 */
    resetAll() {
      Object.assign(s, createFlowData());
    },
  };

  scopes.set(key, scope);
  return scope;
}

export const flowStore = {
  /**
   * 取某个任务的作用域 store 实例（同一 taskId 恒定返回同一实例）。
   * @param {string|number|null} [taskId] 任务唯一标识（保证 Task 隔离；空键归一化哨兵分仓）
   */
  for(taskId) {
    return scopeFor(taskId);
  },

  /** 是否存在某 taskId 分仓。 */
  has(taskId) {
    return buckets.has(normalizeKey(taskId));
  },

  /** 销毁某 taskId 分仓（任务终态/归档时调用，防泄漏）。 */
  clear(taskId) {
    const key = normalizeKey(taskId);
    buckets.delete(key);
    scopes.delete(key);
  },
};

export default flowStore;
