---
name: svg-asset-workflow
description: |
  指导项目中 SVG 矢量图标与图元资源的设计规范、存放组织、属性约束（currentColor / 系统双模自适应 / 描边手绘质感）、内联集成及无障碍交互规范。当用户提出"SVG图标"、"替换图标"、"图标规范"、"引入SVG"、"整理SVG"、"修改图标"、"图标暗黑模式适配"时使用此技能。
---

# SVG 矢量资源管理与使用规范 (SVG Asset Workflow)

规范在 Tauri 2 + Web 前端中管理与使用手绘工程草图风格 SVG 矢量图元，实现主题双模自适应与无障碍交互。

---

## 📁 1. 资产组织与命名规范

所有原始 SVG 源文件统一存放于 `src/assets/svg/`，采用小写蛇形命名（`ic_<action_or_noun>.svg`）：

```text
src/assets/svg/
├── ic_logo.svg          # 规范化手绘主徽标
├── ic_bolt.svg          # 手绘闪电 (运行态/快速)
├── ic_lightbulb.svg     # 手绘灯泡提示 (Tips/Hints)
├── ic_theme_system.svg  # 手绘系统主题
├── ic_theme_light.svg   # 手绘浅色模式太阳
├── ic_theme_dark.svg    # 手绘暗色模式月牙
├── ic_lock.svg          # 手绘挂锁 (激活模型锁定)
├── ic_edit.svg          # 手绘素描铅笔
├── ic_warning.svg       # 手绘圆角警告三角
├── ic_tool.svg          # 手绘工具扳手 (工具调用)
├── ic_sparkle.svg       # 手绘思维火花 (思考过程)
├── ic_check.svg         # 手绘对勾完成
├── ic_close.svg         # 手绘交叉关闭
├── ic_external_link.svg # 手绘外部跳转箭头
├── ic_import.svg        # 导入图标
├── ic_chevron_down.svg  # 手绘折叠微箭头 (下拉框/抽屉)
└── ic_settings.svg      # 手绘齿轮设置
```

---

## 🎨 2. 编码规范与双模适配铁律

### 2.1 颜色适配：统一使用 `currentColor`
- ❌ **严禁硬编码颜色**：严禁在 `<svg>`、`<path>` 中写入十六进制颜色（如 `fill="#000"`）；
- ✅ **填充型图标 (Fill)**：声明 `fill="currentColor"`，移除局部 `fill`；
- ✅ **描边型手绘图标 (Stroke)**：
  - 声明 `fill="none" stroke="currentColor"`；
  - 描边粗细：`stroke-width="1.3" ~ 1.6`；
  - 端点拐角：`stroke-linecap="round" stroke-linejoin="round"`。

### 2.2 尺寸层级推荐

| 场景 | 推荐尺寸 | 典型用途 |
|---|---|---|
| **标题栏控制** | `12px × 12px` | 最小化、关闭按钮 |
| **操作 / 清空** | `16px × 16px` | 搜索框清空 (Esc)、微型操作项 |
| **设置 / 前缀** | `18px × 18px` | 输入框左侧设置、导入按钮 |
| **品牌徽标** | `42px ~ 48px` | 头部主 Logo、空状态大草图 |

---

## 🛠️ 3. 页面内联集成模式

采用 **HTML 内联 SVG** 模式，零额外网络请求，毫秒级响应主题切换与 hover 动效。

```html
<!-- 按钮与手绘 SVG 范例 -->
<button type="button" id="settings-btn" class="icon-button" aria-label="设置" title="设置">
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4"
       stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.2 5.8 C10.3 4.5, 10.4 3.2, 10.4 3.2 L13.6 3.1 C13.6 3.1, 13.7 4.5, 13.8 5.7 ... Z" />
    <path d="M12 9.1 C13.6 9.05, 14.95 10.4, 14.9 12 ... Z" />
  </svg>
</button>
```

```css
/* 按钮通用规范：透明底、1px 占位无边框、hover 显框 */
.icon-button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--ink-muted);
  border-radius: 255px 8px 225px 8px / 8px 225px 8px 255px;
  transition: all 0.18s ease-out;
}
.icon-button:hover {
  color: var(--ink-primary);
  background-color: var(--sketch-tag-bg);
  border-color: var(--sketch-border-subtle);
}
.icon-button svg {
  pointer-events: none;
  display: block;
}
```

---

## 📋 交付核对清单

- [ ] SVG 源文件存入 `src/assets/svg/` 并以 `ic_*.svg` 规范命名；
- [ ] 剔除所有写死色值，统一声明 `currentColor`；
- [ ] 描边图标具备 `stroke-linecap="round"` 与 `round` 拐角；
- [ ] 浅色暖纸与深色炭黑双模下对比度正常；
- [ ] 装饰性图标添加 `aria-hidden="true"`，交互按钮添加 `aria-label`；
- [ ] 运行 `npm run check` 构建顺利通过。
