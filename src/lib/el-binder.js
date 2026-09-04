/**
 * el-binder.js — DOM 按需绑定（阶段 7 批次 B 落地，对应方案 §4 / 《GUI 回归专项》§4 蓝图）
 *
 * 定位：终结 main.js「一次性收集 121 个 DOM id 进 ctx.el」的 Hub 模式。
 *       各 feature 模块在本模块内声明自己真正用到的 id 子集并就地绑定，
 *       改某个 DOM id 只需改「该模块的绑定表 + index.html」两处。
 *
 * 两个绑定入口：
 *   - bindAll(ids)：在全局 document 上按 id 查询（document.getElementById）。
 *     用于「模块自绑定」——与原 main.js 全量收集的取值语义完全一致（同 id 恒返回同一
 *     存活元素），因此跨模块共享 id（searchInput / searchForm / appContainer /
 *     autoReconnectSwitch 等，见《GUI 回归专项》§4.2 跨簇注记）天然共享同一元素引用，
 *     不存在「双绑互消」；未命中的 id 返回 null，调用方按原有 truthy 判定兜底。
 *   - bindEl(scope, ids)：只在给定容器内查询（scope.querySelector('#id')）。
 *     供「明确知道自己所有 id 都落在某个容器内」的模块使用（如 Flow 簇对 #flow-stage）；
 *     误用会拿到 null，故仅在确认作用域归属时使用。
 *
 * 约定（对齐《GUI 回归专项》§4.4）：
 *   - 模块绑定表内 id 与 index.html 一一对应；新增/改名 DOM id 必须同步绑定表；
 *   - ctx.el 已废除，严禁任何模块再解构 ctx.el（measure-coupling 断言全量 ctx 拉取 = 0）；
 *   - flow 域引用仍走 ctx.flowDom（flow-dom.js 内部经 bindAll 自取），严禁两套并存。
 */

/**
 * 全局按 id 绑定（模块自绑定入口，语义与原 main.js 全量收集一致）。
 * @param {Record<string, string>} ids 键 → DOM id 映射表
 * @returns {Record<string, Element|null>} 键 → 元素（未命中为 null，调用方按需兜底）
 */
export function bindAll(ids) {
  const out = {};
  for (const [key, id] of Object.entries(ids)) {
    out[key] = typeof id === "string" ? document.getElementById(id) : null;
  }
  return out;
}

/**
 * 容器内按 id 绑定（仅在确认全部 id 落于 scope 内时使用）。
 * @param {ParentNode|null} scope 容器元素
 * @param {Record<string, string>} ids 键 → DOM id 映射表
 * @returns {Record<string, Element|null>} 键 → 元素（scope 为空或未命中均为 null）
 */
export function bindEl(scope, ids) {
  const out = {};
  for (const [key, id] of Object.entries(ids)) {
    out[key] = scope && typeof id === "string" ? scope.querySelector("#" + id) : null;
  }
  return out;
}
