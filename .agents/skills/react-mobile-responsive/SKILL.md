---
name: react-mobile-responsive
description: 将前端与 React 项目样式进行移动端/响应式全站适配。包含技术栈分析、断点方案规划、表格/弹窗/日期选择器适配、触控优化（touch-action）、安全区域适配与兼容性测试完整流程。当用户提到"移动端适配"、"响应式布局"、"手机端兼容"、"mobile responsive"、"移动端样式"时使用。
---

# Web / React 移动端与响应式全站适配规范

规范在前端与 React 项目中进行移动端与响应式适配，保证仅变更展示层样式而不破坏业务逻辑。

---

## 🧭 响应式适配流水线

```text
阶段 1: 技术栈摸排 ➔ 阶段 2: 方案规划 ➔ 阶段 3: 执行适配 ➔ 阶段 4: 多端验证
```

### 1. 技术栈摸排与视口声明

确认 `index.html` 具备标准视口声明：
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

### 2. 断点策略与核心布局适配

| 屏幕类别 | 断点阈值 | 布局表现 |
|---|---|---|
| **移动端 (Mobile)** | `< 768px` (`sm/md`) | 宽屏多列侧边栏折叠为顶部栏 + Drawer 抽屉导航；网格转为单列流式 |
| **平板/桌面 (Tablet/Desktop)** | `≥ 768px` / `≥ 1024px` | 保持多列网格与常驻导航栏 |

### 3. 组件专项适配策略

- **数据表格（AntD Table 等）**：
  - 移除固定垂直高度 `scroll.y`，允许移动端自然滚动；
  - 移除 `fixed: 'left'` / `fixed: 'right'` 冻结列，防止在窄屏遮挡内容；
  - 开启横向自适应滚动 `scroll={{ x: 'max-content' }}`。
- **日期选择器**：小屏优先选用原生 `<input type="date">` 或移动端专用的 Drawer 浮层。
- **弹窗与抽屉 (Modal / Drawer)**：移动端设置宽度 `width="95vw"` 或 `max-width: 95vw`，关闭按钮触摸热区 ≥ 44px。

### 4. 触控与安全区域优化

```css
/* 全局禁止双击放大延迟，保留单指滑动与缩放 */
html {
  touch-action: manipulation;
}

/* 安全区域适配 (iOS Notch & Bottom Bar) */
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
}

.mobile-bottom-bar {
  padding-bottom: calc(12px + var(--safe-area-bottom));
}
```

---

## 📋 移动端真机验证 Checklist

- [ ] 顶部导航与抽屉菜单展开/收起流畅；
- [ ] 表格横向滑动顺畅且无固定列遮挡；
- [ ] 模态弹窗与下拉面板不超出屏幕边界；
- [ ] 按钮触摸热区 ≥ 44px，双击无非预期缩放；
- [ ] 虚拟键盘弹出时界面布局与固定底栏无错乱；
- [ ] `npm run build` 类型校验与构建均通过。
