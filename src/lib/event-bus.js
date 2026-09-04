/**
 * event-bus.js — 极简同步事件总线（阶段 1 基础设施）
 *
 * 定位：仅收编「fire-and-forget」横切通知（toast、侧栏开合等）。
 * 严禁收编「控制流命令/状态迁移」（如 setViewMode 四态回退链），
 * 后者必须走 Store action 或显式 import（保持同步语义与可拦截）。
 *
 * 铁律（AGENTS.md 同步探测不变量 / 后台流式前台门禁 / Task 隔离，见 §4 阶段 2 热区）：
 *   1. 同步派发：emit 内严禁任何 await / 微任务调度 / Promise；
 *   2. payload 必须自包含所需上下文（如带 taskId），监听方自行决定是否触 DOM；
 *   3. on 返回取消函数，便于组件卸载时退订。
 *
 * 用法：
 *   import { bus } from "../lib/event-bus.js";
 *   bus.on("ui:toast", ({ text, duration }) => renderToast(text, duration));
 *   bus.emit("ui:toast", { text, duration });
 *
 * 事件命名约定（与《事件通道契约表》src/lib/contracts.js 顶部注释保持一致）：
 *   ui:*    —— UI 内部横切通知（本总线管辖）
 *   flow:*  —— Flow 相关通知（本总线管辖，必带 taskId）
 *   (pi:*   —— 内核桥接 CustomEvent，走原生 Tauri channel，本总线概不接管)
 */
const listeners = new Map();

export const bus = {
  /**
   * 订阅事件。
   * @param {string} type 事件类型
   * @param {(payload: any) => void} fn 回调
   * @returns {() => void} 退订函数
   */
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
    return () => bus.off(type, fn);
  },

  /** 退订。 */
  off(type, fn) {
    listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
  },

  /**
   * 同步派发事件。同步遍历监听器（顺序即注册顺序，符合 AGENTS.md 语义）。
   * 铁律：此函数禁止改成异步。
   * @param {string} type 事件类型
   * @param {any} [payload] 负载
   */
  emit(type, payload) {
    for (const fn of listeners.get(type) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        // 单个监听器异常不得中断其它监听器，也不得上抛导致调用方栈断裂。
        // eslint-disable-next-line no-console
        console.error(`[event-bus] listener error on "${type}"`, err);
      }
    }
  },
};

export default bus;
