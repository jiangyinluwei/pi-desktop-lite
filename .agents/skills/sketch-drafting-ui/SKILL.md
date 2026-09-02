---
name: sketch-drafting-ui
description: |
  参考 Anthropic Research 与 Pi.dev 设计美学，指导前端 UI 采用简约线条、手绘/工程绘图草图风格（Sketch & Hand-drawn / Drafting）、大范围柔和微渐变纸质背景及系统自适应明暗双色方案。当用户提出"手绘风格"、"极简线条"、"Anthropic风格"、"Pi.dev风格"、"工程绘图风"、"草图风格"、"线条设计"、"手绘UI"、"黑板素描/素描纸风格"、"素描纸质感"、"去除蓝紫渐变"时使用此技能。
---

# 简约手绘与工程绘图设计规范 (Sketch & Drafting UI)

提炼自 **Anthropic Research** 的克制学术留白与 **Pi.dev** 的工程手绘草图美学，规范高质感双模界面的视觉语言与交互公理。

---

## 🚫 零容忍禁绝清单

- ❌ **严禁高饱和急促渐变**：严禁标题蓝紫渐变文本、按钮彩虹渐变与霓虹光晕；
- ❌ **严禁机械玻璃拟态**：严禁 Dribbble 风格半透明卡片与多层模糊光斑；
- ❌ **严禁几何硬圆角**：严禁机械硬圆角（`border-radius: 9999px` 搭配纯色投影）；
- ❌ **严禁系统默认 Emoji**：全域使用内联手绘 SVG 图元，严禁 🚀 ⚡ ✨ 等彩色表情符号。

---

## 📐 核心美学公理

### 1. 线条与不对称有机微圆角
- **实墨线宽**：框线与分割线统一采用 `1.2px ~ 1.5px` 的精细描边；
- **不对称有机圆角 (Organic Asymmetric Border Radius)**：
  - 输入框 / 主卡片：`border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;`
  - 小标签 / 按钮：`border-radius: 255px 12px 225px 10px / 12px 225px 10px 255px;`
- **描边图标规范**：`fill="none" stroke="currentColor" stroke-width="1.3~1.6" stroke-linecap="round" stroke-linejoin="round"`。

### 2. 双模纸质与黑板色彩体系

```css
/* 浅色模式（Warm Oatmeal Paper / 暖调素描纸） */
:root {
  --bg-base: #FAF8F5;
  --bg-gradient: radial-gradient(130% 110% at 50% 18%, #FDFBF7 0%, #F6F2EA 55%, #EDE6DA 100%);
  --ink-primary: #1C1A17;
  --ink-muted: #78716A;
  --sketch-border: #262422;
  --sketch-border-subtle: #D6CFC4;
  --sketch-box-bg: #FFFFFF;
  --sketch-tag-bg: #F5F0E6;
  --sketch-shadow: 2px 3px 0px rgba(28, 26, 23, 0.08);
}

/* 深色模式（Charcoal Blackboard / 素描炭黑板） */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-base: #141312;
    --bg-gradient: radial-gradient(130% 110% at 50% 18%, #1C1A18 0%, #141311 55%, #0D0C0B 100%);
    --ink-primary: #F3EFE6;
    --ink-muted: #9C9488;
    --sketch-border: #EDE8DC;
    --sketch-border-subtle: #36322C;
    --sketch-box-bg: #1C1A18;
    --sketch-tag-bg: #23211E;
    --sketch-shadow: 2px 3px 0px rgba(243, 239, 230, 0.08);
  }
}
```

---

## 🔘 按钮设计四大铁律 (Button Principles)

1. **常态背景透明**：`background: transparent;` 融入纸质底色；
2. **常态无边框（1px 占位）**：`border: 1px solid transparent;` 保持几何占位，杜绝 hover 产生布局抖动（Layout Shift）；
3. **悬浮（`:hover`）显手绘边框**：`border-color: var(--sketch-border-subtle); background-color: var(--sketch-tag-bg);`；
4. **按压（`:active`）微触感反馈**：`transform: scale(0.94);`，过渡时长 `150ms ~ 180ms`。

```css
.icon-button {
  background: transparent;
  border: 1px solid transparent; /* 常态透明边框占位 */
  color: var(--ink-muted);
  border-radius: 255px 8px 225px 8px / 8px 225px 8px 255px;
  transition: all 0.18s ease-out;
}
.icon-button:hover {
  color: var(--ink-primary);
  background-color: var(--sketch-tag-bg);
  border-color: var(--sketch-border-subtle);
}
.icon-button:active {
  transform: scale(0.94);
  background-color: var(--sketch-tag-hover-bg);
  border-color: var(--sketch-border);
}
```

---

## 🖥️ 桌面端交互与组件规范

1. **拖拽区域限制**：仅顶部约 **30px** 标题栏响应拖拽（`data-tauri-drag-region`），内容区严禁开启拖拽；
2. **失焦与高亮清除**：点击非输入区或右键时，输入框立即 `blur()` 并清除高亮；
3. **全域右键 Step Back**：禁用浏览器默认右键菜单（`preventDefault()`），统一作为回退层级；
4. **隐藏式极简滚动条**：常态 4px 极窄半透明竖条，无上下箭头与槽底色；仅当鼠标移入滚动条自身时展开至 6px 并高亮加深；
5. **手绘下拉框 (`SketchSelect`)**：180ms Pop & Micro-Shake 微抖动展开，双向同步原生 `<select>`。

---

## 📋 交付核对清单

- [ ] 所有按钮遵循“常态透明、1px transparent 占位、hover 显边框”铁律；
- [ ] 拖拽严格限制于顶部约 30px；
- [ ] 全域右键菜单已被拦截并作为 Step Back；
- [ ] 边框具备 1.2~1.5px 手绘描边与有机不对称微圆角；
- [ ] 所有图标统一内联 `currentColor` 手绘 SVG；
- [ ] 浅色暖纸与深色炭黑双模对比度舒适。
