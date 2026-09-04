/**
 * view-store.js — 四态界面状态机唯一属主（阶段 2 落地）
 *
 * 定位：把散落在 view-mode.js / flow-pipeline / flow-ui / global-interactions /
 *       search-input / sessions-panel / task-panel 中的 `view.mode / view.previous /
 *       view.flowFromSettings / view.hintBannerTimeout` 裸写收拢为唯一属主，消灭多模块直改。
 *
 * 设计硬约束（AGENTS.md 铁律热区清单，阶段 2）：
 *   1. 全同步：morph/set 严禁 async / await / 微任务调度 —— 同步探测不变量；
 *   2. 无 DOM：本 store 绝不触碰 document / appContainer / focus —— DOM 副作用由
 *      view-mode.js 的「view:changed」响应式订阅统一承担；
 *   3. 控制流命令（setViewMode 四态回退链）**禁上事件总线**（事件总线 §4 阶段 1.2），
 *      本 store 就是这条控制流的落点 —— 显式调用、可返回结果、可拦截、调用栈完整；
 *   4. 事件只作「状态已变」通知，payload 自包含（mode/previous/flowFromSettings），
 *      监听方（view-mode.js）据此触 DOM，顺序即调用顺序。
 *
 * 用法：
 *   import { viewStore } from "../services/stores/view-store.js";
 *   viewStore.morph(VIEW_FLOW, { shouldFocusInput: true });   // 状态迁移（控制流）
 *   const m = viewStore.mode;                                  // 读取
 *   viewStore.set({ previous: VIEW_DETAILED });                // 定向覆写（openSettingsView 特例）
 */
import { VIEW_DETAILED, VIEW_FLOW, VIEW_SETTINGS } from "../../lib/view-constants.js";
import { bus } from "../../lib/event-bus.js";

/** 四态合法值。 */
const VALID_MODES = ["detailed", "focus", "flow", "settings"];

// 唯一属主：四态界面状态机的权威数据源。
const state = {
  mode: VIEW_DETAILED,
  previous: VIEW_DETAILED,
  flowFromSettings: false,
  // hintBannerTimeout 为纯视图内定时器句柄，仅 view-mode.js 使用，
  // 不进入共享状态（消灭空引用），由 view-mode.js 闭包持有。
};

export const viewStore = {
  /** 当前视图态（只读）。 */
  get mode() {
    return state.mode;
  },
  /** 上一视图态（设置页回退用，只读）。 */
  get previous() {
    return state.previous;
  },
  /** 是否从设置页定向进入 Flow（只读）。 */
  get flowFromSettings() {
    return state.flowFromSettings;
  },

  /**
   * 四态状态迁移唯一 action（同步，禁 async）。
   *
   * @param {string} mode 目标视图（detailed | focus | flow | settings）
   * @param {{ previousMode?: string, shouldFocusInput?: boolean }} [opts]
   *   - previousMode：设置页定向回退特例，显式覆写 previous（替代旧「openSettingsView 后置覆写」）；
   *   - shouldFocusInput：是否聚焦输入框（默认 true），UI 侧据此决定 focus/blur。
   * @returns {{ mode: string, previous: string, flowFromSettings: boolean }} 迁移后的状态快照
   */
  morph(mode, opts = {}) {
    if (!VALID_MODES.includes(mode)) return { ...state };

    const prev = state.mode;

    // 进入设置页：记录来源界面（供回退）；若调用方显式给 previousMode 则以其为准。
    if (opts.previousMode) {
      state.previous = opts.previousMode;
    } else if (prev !== VIEW_SETTINGS && mode === VIEW_SETTINGS) {
      state.previous = prev;
    }

    // 兜底：任何非回退路径离开 Flow 时复位 flowFromSettings 来源标志。
    if (prev === VIEW_FLOW && mode !== VIEW_FLOW) {
      state.flowFromSettings = false;
    }

    state.mode = mode;

    // 通知「状态已变」：监听方（view-mode.js）据此触 DOM。
    // 严禁在此触 DOM；事件为同步派发（bus 实现满足同步探测不变量）。
    bus.emit("view:changed", {
      mode: state.mode,
      previous: state.previous,
      flowFromSettings: state.flowFromSettings,
      shouldFocusInput: opts.shouldFocusInput !== false,
    });

    return { ...state };
  },

  /**
   * 定向覆写单个/多个状态字段（同步）。仅用于确有必要的特例（如 openSettingsView 显式 previous）。
   * @param {Partial<{mode: string, previous: string, flowFromSettings: boolean}>} patch
   */
  set(patch) {
    if (!patch || typeof patch !== "object") return;
    if (patch.previous !== undefined) state.previous = patch.previous;
    if (patch.mode !== undefined) state.mode = patch.mode;
    if (patch.flowFromSettings !== undefined) state.flowFromSettings = patch.flowFromSettings;
  },
};

export default viewStore;
