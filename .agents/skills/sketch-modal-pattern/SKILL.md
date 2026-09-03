---
name: sketch-modal-pattern
description: |
  指导桌面端 (Tauri 2 + Web 前端) 中手绘素描质感模态弹窗系统 (SketchModal / sketchAlert / sketchConfirm / sketchPrompt) 的设计与交互规范。涵盖固定于软件框体中心的居中布局、半透明毛玻璃微模糊背景遮罩、1.4px 实墨草图线框与不对称有机圆角、180ms 快速回弹弹出微抖动动效（Pop & Micro-Shake）、全域右键 (Step Back) 优先拦截、Esc 与 Enter 键盘流、无障碍焦点陷阱 (Focus Trap) 以及双模主题自适应。当用户提出"软件弹窗"、"模态窗"、"弹窗风格"、"重写弹窗"、"sketchModal"、"替换原生alert"、"确认对话框"、"居中弹窗"时使用。
---

# 手绘模态弹窗系统规范 (SketchModal Pattern)

规范桌面端（Tauri 2 + 原生 Web 前端）手绘素描质感模态弹窗系统，彻底杜绝系统原生 `alert` / `confirm` 带来的样式失控与主线程阻塞。

---

## 🚫 核心禁绝清单

- ❌ **严禁原生弹窗**：全域严禁使用 `window.alert()` 与 `window.confirm()`；
- ❌ **严禁机械硬圆角与霓虹渐变**：严禁无脑纯圆角或刺眼蓝紫光晕；
- ❌ **严禁系统默认 Emoji**：所有类型图标统一内联手绘矢量 SVG（`currentColor`）；
- ❌ **严禁穿透背景**：激活态必须完全阻断下层交互，并启用键盘焦点陷阱；
- ❌ **严禁右键与 Esc 穿透**：按右键或 Esc 必须优先关闭弹窗，不误触发底层视图回退。

---

## 📐 核心视觉与几何工程美学

### 1. 软件框体居中固定定位
```css
.sketch-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 11000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgba(28, 26, 23, 0.42);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
```

### 2. 实墨线框与不对称微圆角
- **线宽**：`1.4px solid var(--sketch-border)`；
- **不对称有机圆角**：`border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;`；
- **Pop & Micro-Shake 动效**：180ms 快速回弹弹出微抖动（`@keyframes sketchModalPopShake`）。

---

## 🛠️ API 接口与调用范例

位于 [`src/services/sketch-modal.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/sketch-modal.js)。

```javascript
import { sketchAlert, sketchConfirm, sketchPrompt } from "./services/sketch-modal.js";

// 1. 消息提示 (sketchAlert)
await sketchAlert("操作成功完成！", { type: "success", title: "保存成功" });
await sketchAlert(`错误: ${err.message}`, { type: "error", title: "失败", detail: err.stack });

// 2. 交互确认 (sketchConfirm)
const confirmed = await sketchConfirm("确定要执行此操作吗？", { title: "操作确认" });

// 危险操作确认（删除/卸载，红色警告视觉）
const isDelete = await sketchConfirm(`确定要删除运营商 [${providerId}] 吗？`, {
  title: "删除确认",
  isDanger: true,
  confirmText: "确定删除",
  cancelText: "取消"
});

// 3. 文本输入 (sketchPrompt)
const inputName = await sketchPrompt("请输入新名称：", "默认值", { title: "重命名" });
```

---

## ⌨️ 全域交互与无障碍 (Step Back & Focus Trap)

1. **右键 (Context Menu) 优先拦截**：通过 `window.__piRegisterStepBack` 注册，右键点击任意区域时关闭顶层弹窗并返回 `true`，阻止穿透；
2. **Esc 键**：立即取消/关闭弹窗；
3. **Enter 键**：若焦点在非取消按钮上，直接触发主要操作；
4. **焦点陷阱 (Focus Trap)**：打开时保存原焦点，按 `Tab` 在内部循环，关闭后恢复原焦点。

---

## 📋 交付核查清单

- [ ] 弹窗严格居中于软件框体，具备毛玻璃微模糊背景；
- [ ] 浅色暖纸与深色炭黑双模投影自然；
- [ ] 具备清脆的 Pop-Shake 回弹微抖动；
- [ ] 右键与 Esc 优先关闭弹窗且不触发下层回退；
- [ ] 危险确认弹窗（`isDanger: true`）呈现红色警告与取消默认聚焦。
