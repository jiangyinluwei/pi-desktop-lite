---
name: sketch-drafting-ui
description: |
  参考 Anthropic Research 与 Pi.dev 设计美学，指导前端 UI 采用简约线条、手绘/工程绘图草图风格（Sketch & Hand-drawn / Drafting）、大范围柔和微渐变纸质背景及系统自适应明暗双色方案。当用户提出"手绘风格"、"极简线条"、"Anthropic风格"、"Pi.dev风格"、"工程绘图风"、"草图风格"、"线条设计"、"手绘UI"、"黑板素描/素描纸风格"、"素描纸质感"、"去除蓝紫渐变"时使用此技能。
---

# 简约手绘与工程绘图风格设计规范 (Sketch & Drafting UI)

本规范提炼自 **Anthropic Research** 的学术理性、克制留白与 **Pi.dev** 的工程绘图手绘草图美学，旨在打造具有人类工匠温度、高学术与工具审美的前端界面。

---

## 🚫 零容忍禁绝清单 (Anti-Patterns & Forbidden Elements)

任何遵循本规范生成的界面，**绝对严禁**出现以下 AI 模版特征与陈旧视觉元素：

1. **严禁高饱和度发光与急促渐变**：
   - ❌ 严禁标题使用蓝紫渐变文本（`-webkit-background-clip: text` 蓝紫色系）；
   - ❌ 严禁在小范围按钮、卡片上使用急促刺眼的彩虹/双色渐变；
   - ❌ 严禁使用霓虹光晕、外发光投影（`box-shadow: 0 0 20px rgba(59,130,246,0.5)`）。
2. **严禁机械玻璃拟态与大模糊**：
   - ❌ 严禁使用 2021 Dribbble 风格的磨砂玻璃（`backdrop-filter: blur(...)` + 半透明白色大卡片）；
   - ❌ 严禁多层半透明光斑（floating blurred blur orbs）。
3. **严禁冰冷机械的几何完美胶囊**：
   - ❌ 严禁无脑使用纯硬圆角 `border-radius: 9999px` 搭配纯色大投影；
   - ❌ 严禁使用未经微调的标准无衬线单调字体。
4. **严禁使用缺乏描边个性的通用标准图标**：
   - ❌ 严禁使用实心填充彩色表情符号（🚀 ⚡ ✨）作为功能图标；
   - ❌ 严禁混用不同描边粗细的生硬标准图标。

---

## 📐 核心美学公理 (Core Aesthetics)

### 1. 手绘草图与工程绘图线条美学 (Hand-Drawn & Drafting Aesthetics)

- **线条质感**：所有框线、分隔线均使用 **1.2px ~ 1.5px** 的精细描边（笔触感）；
- **自然微不对称有机圆角 (Organic Asymmetric Border Radius)**：
  - 搜索框 / 大卡片：`border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;`
  - 小标签 / 按钮：`border-radius: 255px 12px 225px 10px / 12px 225px 10px 255px;`
  - *原理*：打破 CSS 默认机械平滑，模拟工程师在绘图纸上手绘描画的自然微弧度。
- **手绘草图点缀图形 (Sketch Accents)**：
  - 手工贝塞尔曲线的微弯横梁与竖划（如手绘 $\pi$、波浪下划线 `~`）；
  - 极简草图思维星标、草图交叉点、铅笔折线、工程坐标参考十字 `+`。
- **矢量图标手绘规范**：
  - 统一使用 `fill="none" stroke="currentColor" stroke-width="1.3~1.6" stroke-linecap="round" stroke-linejoin="round"`；
  - 关键图形（放大镜、叉号、窗口控制）带有轻微手工绘制微弧，而非绝对正圆/硬折角。

---

### 2. 色彩哲学：大范围微渐变纸质背景 (Ambient Paper & Slate Palette)

仅允许**大范围（120%~140% 视口跨度）、极低对比度**的柔和放射渐变，模拟真实素描纸张光照与黑板质感：

#### 浅色模式（Warm Oatmeal & Ink / 暖调素描绘图纸）
| 变量名 | 推荐取值 | 语义说明 |
| :--- | :--- | :--- |
| `--bg-base` | `#FAF8F5` | 底层暖纸色 |
| `--bg-gradient` | `radial-gradient(130% 110% at 50% 18%, #FDFBF7 0%, #F6F2EA 55%, #EDE6DA 100%)` | 大范围柔和纸张微渐变 |
| `--ink-primary` | `#1C1A17` | 高品质深墨色（正文、主标题） |
| `--ink-muted` | `#78716A` | 铅笔石墨灰（副标题、占位符、次级说明） |
| `--sketch-border` | `#262422` | 手绘深墨实线（聚焦/悬停态） |
| `--sketch-border-subtle` | `#D6CFC4` | 绘图纸网格线/浅草图线（静止态） |
| `--sketch-box-bg` | `#FFFFFF` | 输入框纸张白色底 |
| `--sketch-tag-bg` | `#F5F0E6` | 草图标签纸质底色 |
| `--sketch-shadow` | `2px 3px 0px rgba(28, 26, 23, 0.08)` | 纸张硬边微投影 |

#### 深色模式（Charcoal Blackboard & Chalk / 素描炭黑板）
| 变量名 | 推荐取值 | 语义说明 |
| :--- | :--- | :--- |
| `--bg-base` | `#141312` | 底层炭黑底色（非纯黑 `#000`） |
| `--bg-gradient` | `radial-gradient(130% 110% at 50% 18%, #1C1A18 0%, #141311 55%, #0D0C0B 100%)` | 大范围微光炭黑渐变 |
| `--ink-primary` | `#F3EFE6` | 暖白粉笔色（主文字） |
| `--ink-muted` | `#9C9488` | 灰白炭色（次级文字、占位符） |
| `--sketch-border` | `#EDE8DC` | 亮粉笔描边（聚焦/激活态） |
| `--sketch-border-subtle` | `#36322C` | 暗石炭底线（静止态） |
| `--sketch-box-bg` | `#1C1A18` | 输入框深炭黑底 |
| `--sketch-tag-bg` | `#23211E` | 标签深石炭底色 |
| `--sketch-shadow` | `2px 3px 0px rgba(0, 0, 0, 0.5)` | 沉浸炭黑投影 |

---

### 3. 系统自适应明暗双模 (Dual-Theme Adaptation)

必须严格使用 `@media (prefers-color-scheme: dark)` 进行无缝自动切换：

```css
:root {
  /* 浅色纸张墨水变量 */
}

@media (prefers-color-scheme: dark) {
  :root {
    /* 深色炭黑粉笔变量 */
  }
}
```

所有矢量图标统一使用 `currentColor`，随主题自动继承文字与笔触颜色。

---

### 4. 字体与排版层级 (Typography)

- **主品牌/学术标题**：结合高质量经典衬线（如 `"Newsreader"`, `"Charter"`, `"Georgia"`, `serif`）与大写/字偶距微调（`letter-spacing: -0.04em;`），辅以手绘微下划线墨水笔触；
- **正文与控件**：系统现代清晰无衬线（`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`）；
- **辅助说明/代码/徽标**：工程等宽字体（`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`）。

---

### 5. 触觉微交互 (Tactile Micro-Interactions)

- **按压与位移**：悬停时微浮 `transform: translateY(-1px);`，按压激活时复位 `transform: translateY(0);` 或微缩放 `scale(0.98)`；
- **聚焦手感**：`:focus-within` 触发生墨线条加深与 `3px 5px 0px` 墨迹投影强化；
- **动效时长**：所有过渡时长保持在 `150ms ~ 220ms`，使用 `ease-out` 或 `ease`，严禁夸张弹跳（no bounce/jello）。

---

### 6. 桌面端交互与手势行为准则 (Desktop Interaction & Gesture Guidelines)

- **窗口拖拽响应范围 (Titlebar Drag Region)**：
  - 严格限制仅顶部约 **30px** 标题栏区域响应窗口拖拽（`-webkit-app-region: drag` / `data-tauri-drag-region`）；
  - 主应用容器、内容区、品牌区等全域严禁开启拖拽，保证文本选择与常规点击正常；
  - 窗口控制按钮等交互元素必须明确设置 `-webkit-app-region: no-drag` / `data-tauri-no-drag`。
- **焦点生命周期与即时消除高亮 (Focus & Blur Management)**：
  - 点击输入框产生手绘边框加深与墨水投影高亮（`:focus-within`）；
  - 点击页面任意非输入空白区域、外部元素或触发鼠标右键时，必须即时主动调用 `blur()` 释放焦点，消除高亮特效。
- **右键行为核心铁律：永远作为“返回上一步/回退 (Step Back)”**：
  - 🚫 **全域禁用原生上下文菜单**：页面任何区域（除系统原生标题栏外）严禁弹出浏览器右键菜单（`contextmenu` 必须 `preventDefault()`）；
  - 🔄 **右键统一语义为“回退上一步”**：
    1. 若有输入框/组件处于聚焦高亮态，右键优先失焦并清除高亮；
    2. 若打开了弹窗、抽屉、下拉面板或子页面，右键统一执行“关闭当前层级/返回上一视图”；
    3. 若处于顶层主页且搜索框有内容，右键清空当前搜索内容；
    4. 必须通过标准分发器（`handleGlobalStepBack` / `__piRegisterStepBack` / `CustomEvent("pi:step-back")`）统一维护回退栈。

---

### 7. 交互按钮设计铁律（新增 Button 统一规范） (Button Design Principles)

**本项目中所有现有及未来新增的交互按钮（包括图标按钮、操作项），必须 100% 严格遵守以下铁律：**

1. **背景常态透明 (Transparent by Default)**：
   - 常态下按钮背景必须声明 `background: transparent;`（或 `background-color: transparent;`），融入纸质底色；
2. **常态无边框 (No Border in Rest State)**：
   - 常态下严禁显示可见边框，必须采用 `border: 1px solid transparent;` 保持 1px 几何占位，杜绝悬停时因边框出现引起界面抖动与重排（Layout Shift）；
3. **鼠标悬浮显框 (Border on Hover)**：
   - 仅当鼠标悬浮（`:hover`）或获得键盘焦点（`:focus-visible`）时，才显现手绘边框（`border-color: var(--sketch-border-subtle)` 或 `var(--sketch-border)`）与柔和背景微底色（`background-color: var(--sketch-tag-bg)`）；
4. **手绘微触感反馈 (Tactile Feedback on Active)**：
   - 按压激活（`:active`）时触发自然微缩放（`transform: scale(0.92~0.95)`）或情境微旋转（如齿轮设置按钮 `rotate(15deg)`），过渡时长保持在 `150ms ~ 180ms`。

```css
/* 标准按钮规范基类范例 */
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

### 4. 设置与复杂表单界面的现代工程横平竖直规范 (Settings & Form Specification)
- **配色与主界面统一**：设置界面完全继承主界面的纸质微渐变与素描墨水变量，全面禁止使用高饱和鲜艳颜色（如刺眼的亮蓝、高饱和紫、荧光绿、鲜艳大红），功能标识统一使用低饱和度功能色；
- **非嵌套纯净线框布局**：杜绝多层卡片嵌套（Card-in-card Shading）与冗余胶囊 Tips，外层容器一律采用标准细边框（`1px solid var(--sketch-border-subtle)` / 4px~6px 圆角）包裹，内部所有子项与输入控件统一采用透明背景（`background: transparent`），呈现极简绘图纸工程质感；
- 保证多选项卡 Tab 导航、API Key 输入、下拉选择及模型参数配置在清晰、高对比度的规整网格中呈现，兼顾工程实用性与现代审美。

### 5. 灵感格言自适应跑马灯规范 (Input Motto Marquee Specification)
- 输入框内置手绘/学术灵感格言文本，当文本渲染宽度超过输入框可视宽度时，自适应启用从右向左无缝循环滚动（Marquee）；
- 滚动线速度保持在约 28~30px/s 恒定速度，维持克制、慢节奏阅读质感；
- 跑马灯左右两端配合 `mask-image` 实现微柔和羽化；当用户键入任意内容时瞬时隐去，清空后优雅复显。

### 8. 运行态技能注入胶囊设计规范 (Inner-Skill Injection Capsule Specification)
- **视觉层级与定位**：位于 Flow 交互版中用户提问卡片下方、AI 思考过程卡片 (`.agent-thinking-card`) 正上方，以极简轻量的一行草图“胶囊（Capsule / Pill Badge）”示意当前已强行注入的运行态上下文；
- **手绘纸质微徽章质感**：
  - **草图虚线与有机圆角**：采用 `1px dashed var(--sketch-border-subtle)` 搭配有机不对称圆角 `border-radius: 255px 12px 225px 10px / 12px 225px 10px 255px;`；
  - **双模纸质色彩**：底色采用 `var(--sketch-tag-bg)`，文字采用 `var(--ink-muted)`（字号 ~11.5px），手绘线框图标采用 `var(--ink-primary)`；
  - **悬停微反馈**：鼠标悬浮时边框切换为实墨草图线 `var(--sketch-border)`，字体颜色同步加深；
- **三态动态响应流**：
  - **`Boost` (高危/命令意图)**：呈现 `⚡ 已注入运行态技能: windows-bash-compatibility (Windows Shell 兼容规范)`；
  - **`PeriodicAnchor` (周期心跳刷新)**：呈现 `⚓ 已注入运行态锚点: windows-bash-compatibility (Windows 环境感知)`；
  - **`Bypass` (纯净放行)**：纯问答或日常对话时胶囊处于隐藏（`display: none`）状态；
  - **流式生命周期**：在每次 `resetStreamState`（新提问提交）时先瞬时隐去，待 Rust 后端分发 `pi:context_injected` 事件时平滑淡入（`animation: sketchCapsuleFadeIn 0.25s ease-out`）。

---

## 📋 交付前严格核查清单 (Pre-Ship Checklist)

每次调整界面前，必须逐项自检：

- [ ] **按钮规范检查**：所有新增与已有按钮是否遵循“常态背景透明、常态无边框（1px transparent 占位）、悬浮（hover）时才显示边框”原则？
- [ ] **拖拽区域检查**：拖拽是否仅限顶部 ~30px，主体内容区未被误设为 drag region？
- [ ] **右键行为检查**：全局右键菜单是否已被禁用且统一响应“返回上一步”？点击外部或右键是否即时取消输入框高亮？
- [ ] **渐变检查**：是否存在局部的急促、高饱和蓝紫/彩虹渐变？（必须为 0）
- [ ] **线条检查**：边框是否具有 1.2~1.5px 的手绘/绘图感？是否使用了不对称自然微圆角？
- [ ] **图标检查**：是否所有图标均为手绘描边风格（`stroke-linecap="round"`，使用 `currentColor`）？
- [ ] **双模检查**：在浅色模式（暖纸墨水）与深色模式（黑板粉笔）下对比度是否舒适？
- [ ] **编译闭环**：是否已执行 `npm run build:check` 验证且 Exit Code 0？
