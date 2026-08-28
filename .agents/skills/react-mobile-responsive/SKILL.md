---
name: react-mobile-responsive
description: 将前端与 React 项目样式进行移动端/响应式全站适配。包含技术栈分析、断点方案规划、表格/弹窗/日期选择器适配、触控优化（touch-action）、安全区域适配与兼容性测试完整流程。当用户提到"移动端适配"、"响应式布局"、"手机端兼容"、"mobile responsive"、"移动端样式"时使用。
---

# Web / React 移动端响应式适配规范

## 概述

本技能提供规范化的工作流，将前端与 React 项目的前端样式适配移动端，确保仅调整样式与展示层而不破坏既有业务逻辑。

## 核心阶段

```
适配任务进度:
- [ ] 阶段 1: 技术栈分析与样式现状摸排
- [ ] 阶段 2: 响应式适配方案规划
- [ ] 阶段 3: 方案安全性与边界校验
- [ ] 阶段 4: 执行样式与交互适配
- [ ] 阶段 5: 多端兼容性与构建测试
- [ ] 阶段 6: 交付报告与真机 Checklist
```

---

## 阶段 1: 技术栈分析

分析项目现有技术栈与样式体系：
- **CSS 方案**：Tailwind CSS / CSS Modules / Styled-components / Less / Sass / 原生 CSS；
- **UI 组件库**：Ant Design / Element Plus / Shadcn UI / MUI 等；
- **现有视口配置**：`index.html` 是否含 `<meta name="viewport" content="width=device-width, initial-scale=1.0">`。

---

## 阶段 2: 适配方案规划

### 2.1 响应式断点策略
- **Tailwind CSS**: `sm: 640px`, `md: 768px`, `lg: 1024px`；
- **CSS 媒体查询**: 定义标准断点 `@media (max-width: 768px)` 与 `@media (max-width: 1024px)`。

### 2.2 核心布局与导航适配
- **主布局**: 宽屏多列侧边栏布局在移动端折叠为顶部栏 + 汉堡按钮 + Drawer 抽屉导航；
- **卡片与栅格**: 多列等宽网格转换为单列自适应流式排列。

### 2.3 表格专项处理（Ant Design Table 等）
- **移除垂直固定高度**：移动端去掉 `scroll.y`，允许页面自然滚动；
- **解除列冻结**：移动端取消 `fixed: 'left'` / `fixed: 'right'` 冻结列，避免遮挡内容；
- **横向自适应滚动**：设置 `scroll={{ x: 'max-content' }}` 或收窄 `scroll.x`。

### 2.4 日期选择器（DatePicker / RangePicker）专项策略
- PC 端复合日历面板在小屏易溢出；移动端建议使用原生 `<input type="date">` 触发系统日期滚轮选择，或使用移动端专用的 Drawer 浮层。

### 2.5 触控与双击防缩放
```css
/* 全局禁止双击放大延迟，保留单指滑动与捏合缩放 */
html {
  touch-action: manipulation;
}

/* 安全区域适配 */
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
}
```

### 2.6 弹窗与抽屉（Modal / Drawer）
- 弹窗宽度在移动端设置为 `width="95vw"` 或 `max-width: 95vw`；
- 确保关闭按钮可见且触摸热区 ≥ 44px。

---

## 阶段 3: 方案安全性校验

- 确认所有修改仅局限于 CSS、className、响应式 Hook（如 `useMediaQuery` / `useIsMobile`）及展示层组件，不变更业务数据流和接口逻辑；
- 检查触摸热区、文字可读性（正文最小 14px）、无横向非预期溢出。

---

## 阶段 4: 执行适配改造

1. **逐文件改造**：优先改造全局骨架与导航，再推进各业务页面；
2. **样式隔离**：避免对全局类使用高权重 `!important` 覆盖，防止影响组件内部内联样式；
3. **响应式 Hook 统一**：如有复用 Hook（如 `useIsMobile`），收敛至 `src/hooks/useIsMobile.ts`。

---

## 阶段 5: 兼容性与构建测试

```bash
# 类型校验与构建打包
npm run build
```

### 移动端真机验证 Checklist
- [ ] 顶部导航与抽屉菜单展开/收起流畅；
- [ ] 表格横向滑动顺畅且无固定列遮挡；
- [ ] 模态弹窗与下拉面板不超出屏幕边界；
- [ ] 双击按钮或文字无非预期放大；
- [ ] iOS Safari 与 Android Chrome 虚拟键盘弹出时布局无错乱。
