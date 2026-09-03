---
name: desktop-rendering-optimization
description: 诊断与解决桌面端（Tauri/Electron/Webview）与 Web 前端中的动画帧异常、掉帧卡顿、白闪/黑屏、窗口缩放撕裂与渲染重绘风暴，提供全生命周期的渲染性能调优规范与最佳实践。当用户提到"动画卡顿"、"缩放闪白"、"掉帧"、"界面不流畅"、"渲染优化"、"优化动画帧"、"白边"、"撕裂"时使用此技能。
---

# 桌面端与 Webview 渲染性能与动画帧异常诊断规范

规范在桌面端混合应用（Tauri / WebView2）及 Web 前端中排查并治理窗口缩放白闪、掉帧、撕裂与重绘风暴。

---

## 🎯 渲染异常场景与排查治理

| 异常表现 | 核心根因 | 根治方案 |
|---|---|---|
| **窗口缩放/最大化闪白边** | DWM 瞬间扩展尺寸，WebView2 异步重排有 1~2 帧时间差，暴露底层默认白色。 | ① `tauri.conf.json` 配置 `"transparent": true`；<br>② Rust 中设置窗口背景色为透明；<br>③ `<head>` 加入 `<meta name="color-scheme" content="light dark">`。 |
| **位移/缩放动画掉帧** | 动画直接操作 `top`, `left`, `width`, `height`, `margin` 等几何属性触发重排。 | **严格仅使用 GPU 合成器属性**：`transform: translate3d()/scale()` 和 `opacity`。 |
| **视口拉伸重绘顿挫** | CSS 中存在 `background-attachment: fixed` 导致 GPU 纹理缓存失效并全屏重绘。 | 彻底移除 `background-attachment: fixed`，改用独立图层容器。 |
| **布局抖动 (Layout Thrashing)** | 在单帧内交替读写 DOM 几何属性（如 `offsetHeight` ➔ `style.height`）。 | 批量读取 ➔ 批量写入，或通过 `requestAnimationFrame` 调度。 |
| **高频事件阻塞主线程** | `resize`, `scroll`, `mousemove` 监听器执行重型计算。 | 使用 `requestAnimationFrame` 节流或卸载到 Rust 后端执行。 |
| **冷启动首屏主题闪烁 (FOUC)** | 系统暗色 + 应用浅色时，CSS 媒体查询率先匹配暗色，待异步 JS 读完配置后又切浅色。 | `<head>` 顶端（样式表前）插入同步内联 `<script>` 从 `localStorage` 读取 `data-theme` 属性并赋予 `<html>`。 |

---

## 💡 正确 vs 错误范式对照

```javascript
// ❌ 错误示范：交替读写 DOM，触发强制同步布局 (Layout Thrashing)
elements.forEach(el => {
  const height = el.offsetHeight; // 读取（强制 Layout）
  el.style.height = (height + 10) + 'px'; // 写入（使 Layout 失效）
});

// ✅ 正确示范：批量读取 ➔ 批量写入
const heights = elements.map(el => el.offsetHeight);
requestAnimationFrame(() => {
  elements.forEach((el, i) => {
    el.style.height = (heights[i] + 10) + 'px';
  });
});
```

---

## 🛠️ 流畅度调优 Checklist

- [ ] `tauri.conf.json` 配置 `"transparent": true` 消除窗口底色冲突；
- [ ] `<head>` 声明 `<meta name="color-scheme" content="light dark">`；
- [ ] `<head>` 顶端内联脚本同步注入 `data-theme` 杜绝主题闪烁；
- [ ] 全站彻底清除 `background-attachment: fixed`；
- [ ] 过渡动效仅使用 `transform` 与 `opacity`；
- [ ] 复杂数据运算卸载至 Rust 后端，保持 Webview 主线程 0 阻塞。
