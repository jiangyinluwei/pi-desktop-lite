/**
 * attachments-store.js — 输入框附件胶囊状态唯一属主（阶段 2 落地）
 *
 * 定位：把散落在 file-attachments.js / search-input / flow-pipeline / flow-ui /
 *       global-interactions 中的 `attachments.files` 裸写收拢为唯一属主，消灭多模块直改。
 *
 * 设计硬约束（AGENTS.md 铁律热区清单）：
 *   1. 全同步：addFiles/removeAt/clear 严禁 async / await；invokeTauri 等异步调用
 *      一律在 Store 之外的调用方（file-attachments.js）完成，Store 只接收结果并同步落库；
 *   2. 无 DOM：本 store 绝不触碰胶囊 DOM —— 渲染回调由 file-attachments.js 负责；
 *   3. `get files()` 返回权威数组引用供遍历/读取，但**写入只能走 action**。
 *
 * 用法：
 *   import { attachmentsStore } from "../services/stores/attachments-store.js";
 *   attachmentsStore.addFiles(resultList);   // 写入（去重 by path）
 *   attachmentsStore.removeAt(index);        // 移除单个
 *   attachmentsStore.clear();                // 清空
 *   const n = attachmentsStore.files.length; // 读取
 */
const state = {
  files: [],
};

export const attachmentsStore = {
  /** 权威附件数组（只读遍历；写入一律走 addFiles/removeAt/clear）。 */
  get files() {
    return state.files;
  },

  /**
   * 追加一组附件（按 path 去重）。
   * @param {Array<{path: string, name?: string, category?: string, size?: number, is_text?: boolean}>} items
   * @returns {number} 实际新增条数
   */
  addFiles(items) {
    if (!Array.isArray(items) || items.length === 0) return 0;
    let added = 0;
    for (const item of items) {
      if (!item || !item.path) continue;
      if (state.files.some((f) => f.path === item.path)) continue;
      state.files.push(item);
      added += 1;
    }
    return added;
  },

  /** 移除指定下标附件（安全越界）。 */
  removeAt(index) {
    if (index >= 0 && index < state.files.length) {
      state.files.splice(index, 1);
      return true;
    }
    return false;
  },

  /** 清空全部附件。 */
  clear() {
    state.files = [];
  },

  /** 是否已存在某 path。 */
  has(path) {
    return state.files.some((f) => f.path === path);
  },

  /** 末位附件（若无则 null）。 */
  last() {
    return state.files.length > 0 ? state.files[state.files.length - 1] : null;
  },
};

export default attachmentsStore;
