---
name: sketch-modal-pattern
description: |
  指导桌面端 (Tauri 2 + Web 前端) 中手绘素描质感模态弹窗系统 (SketchModal / sketchAlert / sketchConfirm / sketchPrompt) 的设计与交互规范。涵盖固定于软件框体中心的居中布局、半透明毛玻璃微模糊背景遮罩、1.4px 实墨草图线框与不对称有机圆角、180ms 快速回弹弹出微抖动动效（Pop & Micro-Shake）、全域右键 (Step Back) 优先拦截、Esc 与 Enter 键盘流、无障碍焦点陷阱 (Focus Trap) 以及双模主题自适应。当用户提出"软件弹窗"、"模态窗"、"弹窗风格"、"重写弹窗"、"sketchModal"、"替换原生alert"、"确认对话框"、"居中弹窗"时使用。
---

# 手绘素描质感模态弹窗系统设计与交互规范 (SketchModal Pattern)

本规范提炼自 **Anthropic Research** 的学术理性与 **Pi.dev** 的工程绘图手绘草图美学，指导在桌面端（Tauri 2 + 原生 Web 前端）中实现高质感、轻量、居中固定的手绘模态弹窗系统，彻底杜绝 Web 原生系统弹窗（`alert` / `confirm` / `prompt`）带来的割裂与样式失控。

---

## 🚫 核心禁绝清单 (Anti-Patterns)

1. ❌ **严禁调用浏览器原生弹窗**：全域严禁使用阻塞主线程且无法定制外观的 `window.alert()` 与 `window.confirm()`；
2. ❌ **严禁使用纯硬几何边框与浮夸霓虹渐变**：严禁机械硬圆角或刺眼的蓝紫高亮光晕；
3. ❌ **严禁使用系统默认 Emoji 表情**：所有类型图标统一采用 `src/assets/svg/` 中的手绘矢量 SVG，属性统一声明 `stroke="currentColor"` 或低饱和度语义颜色；
4. ❌ **严禁弹窗浮层穿透背景操作**：模态弹窗处于激活态时，必须完全阻断下层界面的点击与交互，并通过键盘焦点陷阱限制 Tab 键逃逸；
5. ❌ **严禁右键与 Esc 穿透**：模态弹窗激活时，按右键或按 Esc 必须优先关闭模态弹窗并拦截消耗事件，严禁误触发底层的视图回退或任务挂起。

---

## 📐 核心视觉与几何工程美学

### 1. 软件框体绝对中心定位 (Fixed Center Layout)
模态遮罩与卡片容器严格使用固定定位居中，不受页面滚动或视图切换影响：

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
  opacity: 0;
  pointer-events: auto;
  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
```

### 2. 手绘草图框线与不对称有机微圆角 (Organic Asymmetric Border Radius)
- **实墨线宽**：`1.4px solid var(--sketch-border)`；
- **不对称有机圆角**：`border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;`；
- **纸质双模微投影**：
  - 浅色模式：`box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22), 3px 4px 0px var(--sketch-border-subtle);`
  - 深色模式：`box-shadow: 0 18px 40px rgba(0, 0, 0, 0.65), 3px 4px 0px rgba(0, 0, 0, 0.8);`

### 3. 弹出微抖动动效 (Pop & Micro-Shake)
展开时在 180ms ~ 200ms 内快速弹出，伴随极微小回弹倾角过冲，灵动而不油腻：

```css
@keyframes sketchModalPopShake {
  0% {
    opacity: 0;
    transform: scale(0.92) rotate(-0.5deg) translateY(6px);
  }
  65% {
    opacity: 1;
    transform: scale(1.02) rotate(0.25deg) translateY(-1px);
  }
  100% {
    opacity: 1;
    transform: scale(1) rotate(0deg) translateY(0);
  }
}
```

---

## 🛠️ API 接口与使用范例

在模块中导入 `SketchModal` 或快捷辅助函数：

```javascript
import { sketchAlert, sketchConfirm, sketchPrompt, SketchModal } from "./services/sketch-modal.js";
```

### 1. 消息提示 (sketchAlert)
```javascript
// 基础提示
await sketchAlert("操作已成功完成！", { type: "success", title: "保存成功" });

// 错误提示与详情
await sketchAlert(`切换模型失败: ${err.message}`, {
  type: "error",
  title: "切换模型失败",
  detail: err.stack
});
```

### 2. 交互确认 (sketchConfirm)
```javascript
// 常规确认
const confirmed = await sketchConfirm("确定要执行此操作吗？", {
  title: "操作确认"
});
if (confirmed) {
  // 执行操作
}

// 危险操作确认（删除/卸载，红色警告视觉）
const isDelete = await sketchConfirm(`确定要删除运营商 [${providerId}] 及其全部模型配置吗？`, {
  title: "删除运营商确认",
  isDanger: true,
  confirmText: "确定删除",
  cancelText: "取消"
});
if (isDelete) {
  // 执行删除逻辑
}
```

### 3. 文本输入提示 (sketchPrompt)
```javascript
const newName = await sketchPrompt("请输入新的自定义会话名称：", "默认会话", {
  title: "重命名会话",
  placeholder: "输入会话标题..."
});
if (newName !== null && newName.trim().length > 0) {
  // 处理输入
}
```

---

## ⌨️ 全域交互与无障碍规范 (Step Back & Accessibility)

1. **右键 (Context Menu) 优先拦截**：
   - 弹窗通过 `window.__piRegisterStepBack` 注册回退处理器；
   - 鼠标右键点击界面任意区域时，自动关闭最顶层模态弹窗并返回 `true`，阻止事件穿透到下层视图（如侧边栏、Flow 挂起或 Detailed 回退）；
2. **Esc 键**：立即关闭/取消弹窗；
3. **Enter 键**：若焦点在非取消按钮上，直接触发主要操作；
4. **焦点陷阱 (Focus Trap)**：
   - 弹窗打开时保存 `document.activeElement`；
   - 自动聚焦首选操作按钮（或输入框，危险弹窗默认聚焦取消按钮以防误触）；
   - 按 `Tab` / `Shift+Tab` 时焦点在弹窗内部可聚焦元素间循环；
   - 弹窗关闭后平滑恢复原先焦点。

---

## 📋 交付自检核对清单 (Pre-Ship Checklist)

- [ ] **居中固定**：弹窗是否无论在何种窗口尺寸下均严格居中于软件框体？
- [ ] **毛玻璃遮罩**：背景是否具有 `backdrop-filter: blur(4px)` 与柔和暗化？
- [ ] **双模自适应**：在浅色模式（暖纸墨水）与深色模式（炭黑粉笔）下对比度与阴影是否自然？
- [ ] **动效体验**：是否具有快速清脆的 Pop-Shake 回弹动效？
- [ ] **无障碍与回退**：按右键与 Esc 是否优先关闭弹窗且不触发下层视图回退？
- [ ] **编译闭环**：是否已执行 `npm run check` 且 Exit Code 0？
