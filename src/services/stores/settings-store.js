/**
 * settings-store.js — 设置页跨模块共享状态唯一属主（阶段 2 落地）
 *
 * 定位：把散落在 model-panel / settings-navigation / workspace-panel / search-input /
 *       flow-pipeline / flow-ui 中的 `settings.expandedChannel / officialCatalog /
 *       currentOfficialAuth / activeWorkspace` 裸写收拢为唯一属主，消灭多模块直改。
 *
 * 设计硬约束（AGENTS.md 铁律热区清单）：
 *   1. 全同步：setX 系列 action 严禁 async / await；异步加载结果由调用方 await 后同步落库；
 *   2. 无 DOM：本 store 绝不触碰设置页 DOM；
 *   3. activeWorkspace 为共享对象，多模块仅在「路由」时深改 routePath/routeName，
 *      统一走 updateActiveWorkspace(patch)，严禁模块间直接 `settings.activeWorkspace.x = y`。
 *
 * 用法：
 *   import { settingsStore } from "../services/stores/settings-store.js";
 *   settingsStore.setExpandedChannel("official");
 *   settingsStore.setActiveWorkspace(ws);
 *   settingsStore.updateActiveWorkspace({ routePath: chosen, routeName });
 *   const catalog = settingsStore.officialCatalog;
 */
const state = {
  expandedChannel: null,      // null | "official" | "custom"
  officialCatalog: [],        // 官方模型目录
  currentOfficialAuth: {},    // 官方认证缓存（provider -> auth）
  activeWorkspace: null,      // 当前激活工作区对象（含 id/routePath/routeName/requiresRoute…）
};

export const settingsStore = {
  get expandedChannel() {
    return state.expandedChannel;
  },
  get officialCatalog() {
    return state.officialCatalog;
  },
  get currentOfficialAuth() {
    return state.currentOfficialAuth;
  },
  get activeWorkspace() {
    return state.activeWorkspace;
  },

  /** 切换展开的认证通道抽屉（official | custom | null）。 */
  setExpandedChannel(channel) {
    state.expandedChannel = channel || null;
  },

  /** 落库官方模型目录（强制数组，缺省 []）。 */
  setOfficialCatalog(catalog) {
    state.officialCatalog = catalog || [];
  },

  /** 落库官方认证缓存（强制对象）。 */
  setCurrentOfficialAuth(obj) {
    state.currentOfficialAuth = obj || {};
  },

  /** 落库当前激活工作区对象。 */
  setActiveWorkspace(ws) {
    state.activeWorkspace = ws || null;
  },

  /**
   * 补丁当前激活工作区（用于路由选择后的 routePath / routeName 深改）。
   * 无激活工作区或 patch 非法时静默忽略。
   * @param {Partial<{routePath: string, routeName: string}>} patch
   */
  updateActiveWorkspace(patch) {
    if (state.activeWorkspace && patch && typeof patch === "object") {
      Object.assign(state.activeWorkspace, patch);
    }
  },
};

export default settingsStore;
