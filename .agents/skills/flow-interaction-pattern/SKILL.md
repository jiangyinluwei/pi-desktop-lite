---
name: flow-interaction-pattern
description: |
  指导 Flow 流式交互界面（界面3）的核心交互逻辑实现规范：①过程框体（思维切片卡片/工具调用切片卡片）单行流式紧凑呈现，可手动折叠展开，任何时候均不自动展开；②时序步骤流容器（flow-steps-container）按「思维1-工具1-思维2-工具2...」真实因果链条一段一段拼接；③Flow 界面任意区域滚轮事件委托至最外层滚动容器；④多段对话顶部悬浮当前提问提示 (Flow Floating Question Tip)；⑤多段对话右侧上下轮次定位导航 (Flow Turn Navigation，定位到每轮最终输出内容顶部、鼠标弹起触发可连续逐轮定位、长按「下」1.5 秒立即定位到底部，按下伴随由左至右背景填充及轻微抖动动画)；⑥模型自动重连切换自愈流水线 (ModelFailoverEngine)；⑦输出卡底部手绘风格的保存操作栏。当用户提出"flow界面交互"、"思维链流式展示"、"工具调用简略"、"单行思维"、"步骤切片"、"滚轮滚动"、"flow滚动条"、"悬浮提问提示"、"上下按钮"、"轮次定位"、"保存输出"时使用此技能。
---

# Flow 界面交互逻辑规范 (Flow Interaction Pattern)

本 Skill 归档了 Flow 流式交互界面（`界面3 / data-view="flow"`）的核心交互机制的**实现规范、已验证代码模式与关键陷阱**。

---

## 🏛️ 架构总览

Flow 界面卡片层级如下（从上到下）：

```
#app-container            ← 全局容器（position: relative; overflow: hidden）
  ├─ flow-stage           ← Flow 主体（max-width: 760px 居中）
  │    └─ flow-scroll-area ← 唯一可滚动容器（overflow-y: auto）
  │         ├─ flow-question-tip      ← 顶部悬浮当前提问提示（sticky top:0，仅溢出时显现）
  │         └─ flow-conversation
  │              └─ flow-message-group
  │                   ├─ flow-user-prompt-card       用户提问（不可折叠）
  │                   ├─ flow-injection-capsule      Inner-Skill 注入胶囊（不可折叠）
  │                   ├─ flow-route-capsule          路由目标项目胶囊（不可折叠）
  │                   ├─ flow-failover-capsule       自动重连/切换进度胶囊（不可折叠）
  │                   ├─ flow-steps-container        【时序步骤流容器】(思维1-工具1-思维2-工具2...)
  │                   │    ├─ flow-step-card.flow-step-thinking   思维切片（单行流式刷新，可折叠，绝不自动展开）
  │                   │    └─ flow-step-card.flow-step-tool       工具切片（单行名称+状态，可折叠，绝不自动展开）
  │                   └─ flow-response-card          最终输出正文（永不折叠 Markdown 输出）
  ├─ flow-turn-nav        ← 右侧上下轮次定位导航（absolute，右移到 flow 内容外，多轮 >= 2 时显现）
  └─ search-section       ← 底部输入区
```

**铁律**：
1. `flow-response-card`（最终输出卡）**永远不折叠**；
2. 所有过程框体（`flow-step-thinking` 思维切片与 `flow-step-tool` 工具切片）**常态保持单行紧凑折叠状态，在任何时候（启动、流式、结束）均绝不自动展开**，用户可随时手动点击 Header 展开查阅详情；
3. 思维与工具按真实 ReAct 循环时序**一段一段交织拼接**（`思维1 ➔ 工具1 ➔ 思维2 ➔ 工具2 ➔ ...`）。

---

## 📌 1. 时序步骤流与单行切片卡片

### 1.1 思维链切片（`flow-step-thinking`）

- **单行流式刷新**：在折叠状态下，Header 内的 `.flow-step-preview` 实时刷新流式输出的文本片段（`text.replace(/[\r\n\t]+/g, ' ').trim()`），结合单行文本溢出省略号（`text-overflow: ellipsis; white-space: nowrap;`）；
- **动态读秒**：`.flow-step-duration` 在流式期间显示 `思考中 (3.2s)...`，结束时定格为 `已思考 3.2 秒`；
- **手动折叠展开**：点击 Header 切换 `.open` class，展开后呈现完整思维 Markdown / 代码文本。

```html
<div class="flow-step-card flow-step-thinking">
  <div class="flow-step-header" role="button" tabindex="0" aria-expanded="false">
    <div class="flow-step-header-left">
      <span class="flow-step-icon">${ICONS.sparkle}</span>
      <span class="flow-step-title">思考过程</span>
      <span class="flow-step-duration">思考中 (1.2s)...</span>
      <span class="flow-step-preview">分析当前项目结构与依赖...</span>
    </div>
    <div class="flow-step-header-right">
      <span class="flow-step-arrow">${ICONS.chevronDown}</span>
    </div>
  </div>
  <div class="flow-step-body">
    <div class="thinking-text-stream">完整思维链 Markdown 内容...</div>
  </div>
</div>
```

### 1.2 工具调用切片（`flow-step-tool`）

- **单行友好提醒**：自动映射友好工具名（如 `BASH 调用`、`Web 查询`、`读取文件`、`写入文件` 等），展示简短摘要（如命令或文件路径）；
- **状态徽章**：右侧显现 `running`（琥珀黄）、`done`（翡翠绿）、`failure`（朱红）；
- **手动折叠展开**：默认折叠，点击展开查看完整入参（Arguments JSON）与执行结果（Result）。

```html
<div class="flow-step-card flow-step-tool tool-card running">
  <div class="flow-step-header tool-header" role="button" tabindex="0" aria-expanded="false">
    <div class="flow-step-header-left">
      <span class="flow-step-icon tool-icon">${ICONS.tool}</span>
      <span class="flow-step-title tool-name">BASH 调用</span>
      <span class="flow-step-preview">npm test</span>
    </div>
    <div class="flow-step-header-right tool-header-right">
      <span class="tool-status-badge running">running</span>
      <span class="flow-step-arrow tool-collapse-arrow">${ICONS.chevronDown}</span>
    </div>
  </div>
  <div class="flow-step-body tool-body">[入参 / Arguments] ...</div>
</div>
```

---

## 📌 2. 流式交织切分时序流水线

> **核心逻辑**：将思维和工具调用“一段一段”流式拼接，真实还原模型的 ReAct 推理与行动链条。

| 触发事件 | 步骤切片动作 |
|---|---|
| `thinking-start` / `thinking-delta` | 若当前无活跃思维切片，创建新思维切片（默认折叠）；实时单行刷新预览文本与秒表 |
| `tool-start` (如 bash) | 封口上一段思维切片；创建新工具切片（单行 running，默认折叠） |
| `tool-update` | 更新当前工具切片的执行结果文本 |
| `tool-end` | 更新当前工具切片状态为 `done` 或 `failure`；封口工具切片 |
| 工具结束后再次 `thinking-start` | 自动开启下一个思维切片（思维#2，默认折叠） |
| `text-start` / `text-delta` | 封口所有前序切片，展开并在下方流式输出最终回答卡片 |
| `agent-end` | 结算定格所有步骤切片，沉淀多轮步骤快照至历史记录 |

## 📌 3. Flow 界面全区域滚轮委托

### 3.1 问题背景

Flow 界面布局：

```
.flow-stage      (overflow: hidden，不可滚动)
  └─ .flow-scroll-area  (overflow-y: auto，唯一滚动容器)
       └─ .flow-conversation
            └─ ... 卡片内容
```

当鼠标悬停在 `flow-stage` 内但 `flow-scroll-area` 的内容空白处（如卡片间隙、padding 区域）时，浏览器默认不触发 `flow-scroll-area` 滚动，导致滚轮失效。

### 3.2 解决方案：window 捕获阶段委托

> **⚠️ 关键陷阱**：不要把 wheel 监听绑在 `flow-stage` 元素上——`flow-scroll-area` 自身已消费 wheel 事件，事件不一定冒泡到 `flow-stage`。必须在 **`window` 捕获阶段** 监听，在浏览器执行默认滚动前拦截。

```javascript
if (flowScrollArea) {
  window.addEventListener("wheel", (e) => {
    // 仅在 flow 视图激活时处理
    if (currentView !== VIEW_FLOW) return;

    // 若目标在独立可滚动子区域（thinking-body/tool-body）且该区域还有剩余滚动空间，放行
    const scrollableInner = e.target.closest(".thinking-body") ||
      e.target.closest(".tool-body");
    if (scrollableInner) {
      const canScrollUp = e.deltaY < 0 && scrollableInner.scrollTop > 0;
      const canScrollDown = e.deltaY > 0 &&
        scrollableInner.scrollTop < scrollableInner.scrollHeight - scrollableInner.clientHeight - 1;
      if (canScrollUp || canScrollDown) return; // 子区域还能滚，不拦截
    }

    // 将滚动量全部委托给 flow-scroll-area
    e.preventDefault();
    flowScrollArea.scrollTop += e.deltaY;
  }, { passive: false, capture: true }); // ← capture: true 是关键
}
```

### 3.3 独立可滚动子区域清单

以下子区域设有 `max-height` + `overflow-y: auto`，**优先让其自然滚动**，到达边界后再由外层接管：

| 选择器 | 最大高度 | 用途 |
|---|---|---|
| `.thinking-body` | `240px` | 思考过程文本 |
| `.tool-body` | `200px` | 工具调用参数/结果 |

注意：`.response-content`（最终输出）**不设独立滚动限制**，随外层 `flow-scroll-area` 自然撑高，无需特殊处理。

---

## 📌 3.5 多段对话顶部悬浮当前提问提示 (Flow Floating Question Tip)

### 3.5.1 交互设计
- **触发条件**：仅当 Flow 内容溢出触发滚动条（`flowScrollArea.scrollHeight > flowScrollArea.clientHeight + 1`）且处于 Flow 视图、存在当前提问文本时显现；
- **悬浮形态**：`position: sticky; top: 0;` 吸附于滚动容器顶部、靠左对齐（`width: fit-content`），内容滚动时始终保持在对话区域上方；
- **纯提醒无鼠标行为**：`pointer-events: none; user-select: none;`，绝不拦截滚轮/点击/右键事件，无 hover 交互；
- **多段对话锚定 (Turn Anchoring)**：根据滚动位置动态切换顶部信息——取「顶部仍高于/等于视口顶边」的最后一个 `.flow-message-group` 作为锚定段；当视口顶边定位于第 N 段至第 N+1 段之间时，显示第 N 段对话顶部信息（其提问文本）；单段对话时回退显示当前轮提问（`lastUserQuery`）；超长提问自动省略号截断。

### 3.5.2 实现要点

```html
<!-- 位于 #flow-scroll-area 内、#flow-conversation 之前（更优雅的手绘窗体风格） -->
<div class="flow-question-tip" id="flow-question-tip" aria-hidden="true">
  <div class="flow-question-tip-window-bar">
    <span class="flow-question-tip-badge">
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.2 4.2 C3.2 3.5, 3.8 3, 4.5 3 L11.5 3 C12.2 3, 12.8 3.5, 12.8 4.2 L12.8 11.2 C12.8 11.9, 12.2 12.4, 11.5 12.4 L6.2 12.4 L3.5 14.5 L3.5 4.2 Z" />
        <path d="M5.5 6.2 L10.5 6.2 M5.5 8.8 L9 8.8" />
      </svg>
      <span class="badge-label">当前提问</span>
    </span>
  </div>
  <span class="flow-question-tip-divider" aria-hidden="true"></span>
  <span class="flow-question-tip-text" id="flow-question-tip-text"></span>
  <span class="flow-question-tip-pin" aria-hidden="true">
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="4" r="2" />
      <path d="M8 6 L8 14" />
    </svg>
  </span>
</div>
```

```css
.flow-question-tip {
  position: sticky;
  top: 0;
  z-index: 30;
  display: none;               /* 未溢出时零占位 */
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  padding: 4px 10px 4px 8px;
  margin-bottom: 12px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--ink-primary);
  background: var(--sketch-box-bg);
  border: 1.3px solid var(--sketch-border-subtle);
  border-radius: 255px 12px 225px 10px / 12px 225px 10px 255px;
  box-shadow: var(--sketch-shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  pointer-events: none;
  user-select: none;
}
.flow-question-tip.visible { display: inline-flex; animation: sketchModalPopShake 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
.flow-question-tip .flow-question-tip-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%; min-width: 0; color: var(--ink-primary); font-weight: 550; font-size: 12px;
}
```

```javascript
const updateFlowQuestionTip = () => {
  if (!flowQuestionTip || !flowQuestionTipText || !flowScrollArea) return;
  const overflowing = flowScrollArea.scrollHeight > flowScrollArea.clientHeight + 1;

  // 多段对话锚定：取「顶部仍高于/等于视口顶边」的最后一个 flow-message-group
  let question = "";
  if (overflowing && flowConversation) {
    const groups = flowConversation.querySelectorAll(".flow-message-group");
    if (groups.length > 0) {
      const areaTop = flowScrollArea.getBoundingClientRect().top;
      let anchorGroup = groups[0];
      for (const g of groups) {
        if (g.getBoundingClientRect().top <= areaTop) {
          anchorGroup = g;
        } else {
          break;
        }
      }
      const qEl = anchorGroup.querySelector(".flow-user-prompt-card .prompt-content");
      question = qEl?.textContent?.trim() || lastUserQuery?.trim() || "";
    } else {
      question = String(lastUserQuery?.trim() || activeTurnRefs?.userTextEl?.textContent?.trim() || "");
    }
  }

  flowQuestionTipText.textContent = question;
  const shouldShow = currentView === VIEW_FLOW && overflowing && Boolean(question);
  flowQuestionTip.classList.toggle("visible", shouldShow);
};

// 内容/容器尺寸变化自动刷新（流式增长/折叠展开/多轮追加/窗口缩放）
if (flowConversation && flowScrollArea) {
  const tipResizeObserver = new ResizeObserver(() => updateFlowQuestionTip());
  tipResizeObserver.observe(flowConversation);
  tipResizeObserver.observe(flowScrollArea);
  window.addEventListener("resize", updateFlowQuestionTip);
  // 滚动位置变化时重算锚定的对话段
  flowScrollArea.addEventListener("scroll", updateFlowQuestionTip, { passive: true });
}
window.addEventListener("pi:view-change", () => updateFlowQuestionTip()); // 进入/离开 Flow 刷新
```

### 3.5.3 关键陷阱
- **必须置于滚动容器内部且位于 `flow-conversation` 之前**：`position: sticky` 相对于最近的滚动祖先生效，若放在 `.flow-stage` 外层则无法吸附滚动；
- **不要用 `display: inline-flex` + 省略号**：flex 子项需 `min-width: 0` 才能正确收缩触发 `text-overflow: ellipsis`；
- **锚定判定依赖 `getBoundingClientRect()`**：以 `flow-scroll-area` 的 `top` 为视口顶边参照，滚动事件（`passive: true`）与 `ResizeObserver` 双重驱动，避免内容增删/折叠后锚定错位；
- **新轮次/恢复会话后必须刷新**：`resetStreamState` 末尾显式调用一次（新提问文本即时生效），多轮/历史恢复经由 `pi:view-change` 事件兜底刷新；
- **`aria-hidden="true"`**：提示为纯视觉提醒，避免辅助技术重复朗读当前提问。

---

## 📌 3.6 多段对话右侧上下轮次定位导航 (Flow Turn Navigation)

### 3.6.1 交互设计
- **触发条件**：处于 Flow 视图且对话轮次 ≥ 2（`#flow-conversation` 内 `.flow-message-group` 数量 ≥ 2）时，在 Flow 内容区**右侧外部**显现「上 / 下」按钮；
- **悬浮形态**：导航是 `#app-container` 的直接子元素（非 `#flow-stage` 内），`position: absolute; right: 24px;` 右移到 flow 内容区域之外（窗体内右边距处），垂直方向由 JS（`positionFlowTurnNav`）动态对齐 Flow 内容区底部；纵向排列两个 34px 手绘按钮；非 Flow 视图下 `display: none !important` 绝不显现；
- **定位目标（问题2）**：每轮对话定位到「该轮最终输出内容」的顶部（`.flow-response-card` / `.agent-response-card` / `.response-content`），对齐显示窗体顶部（扣除顶部悬浮提示吸附高度，避免被遮挡）；
- **锚定与定位同源（问题1）**：当前锚定轮次与定位目标使用同一元素（最终输出内容顶），且判定阈值加上提示吸附高度——点击一次后锚定随之推进，可**连续多次**向上/向下逐轮定位（修复「只能点一次」的问题）；
- **交互铁律（鼠标弹起才响应）**：所有定位效果仅在**鼠标弹起（mouseup）**时触发——
  - 按下后移出按钮再弹起**不会生效**：`mouseleave` 时即作废按下状态（`cancelNavPress`），且 `mouseup` 仅当指针仍在按钮上时才会派发到按钮；
  - 「上」按钮弹起 → 按**两段式优化**定位（`OUTPUT_TOP_PROXIMITY_PX = 100`）：
    - **情形 1**：视口顶边位于第 N 轮对话开头下方、且距第 N 轮最终输出顶部 ≤ 100px（含其上方思考/提问区）→ 定位到**第 N-1 轮**最终输出顶部（`scrollToTurnStart(n - 1)`）；
    - **情形 2**：视口顶边已深入第 N 轮最终输出（> 100px，位于其底部之上，或已越过其底部）→ 先定位到**第 N 轮**最终输出顶部（`scrollToTurnStart(n)`），避免误跳过当前轮，再逐级向上回退；
    - 其中 N = `getCurrentTurnIndex()`（最后一个「整组对话起点 <= 视口顶边」的轮次）；N ≤ 0 时无可回退直接 return；
  - 「下」按钮弹起（未满 3 秒）→ 定位到**下一个**对话的最终输出内容顶部（当前锚定轮次 + 1）；
- **长按「下」满 1.5 秒（问题4）**：1.5 秒定时器到点**立即**定位到会话最底部（`scrollTop = scrollHeight`），**无需弹起**；弹起后不再重复定位；
- **长按视觉反馈**：按下添加 `holding`（scale 微缩），「下」按钮按住时触发 1.5 秒由左至右背景填充动画（`transition: transform 1.5s linear`）与手绘轻微抖动（`flowNavHoldShake`）；按住满 1.5s 定位后添加 `long-press`（图标轻呼吸 `flowNavHoldPulse` + title 变为「已定位到会话最底部」）；
- **键盘可访问性**：补充 Enter/Space 的 keydown/keyup，行为与鼠标一致（长按同样 1.5 秒立即定位）。

### 3.6.2 实现要点

```html
<!-- 位于 #app-container 内、#flow-stage 之后（absolute 定位，右移到 flow 内容外） -->
<div class="flow-turn-nav" id="flow-turn-nav">
  <button type="button" class="flow-turn-nav-btn flow-turn-nav-up" id="flow-turn-nav-up"
    aria-label="定位到上一个对话的最终输出内容顶部" title="上一个对话">
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="4 10 8 6 12 10" />
    </svg>
  </button>
  <button type="button" class="flow-turn-nav-btn flow-turn-nav-down" id="flow-turn-nav-down"
    aria-label="定位到下一个对话的最终输出内容顶部 (长按 1.5 秒直接定位到底部)" title="下一个对话 (长按 1.5 秒直接定位到底部)">
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  </button>
</div>
```

```css
/* 右移到 flow 内容区域之外（窗体内右边距处）；垂直 top 由 JS 动态计算 */
.flow-turn-nav {
  position: absolute;
  right: 24px;
  top: auto;   /* 由 positionFlowTurnNav() 设置 */
  z-index: 40;
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.flow-turn-nav.visible { display: flex; animation: sketchFadeIn 0.25s ease-out; }

.flow-turn-nav-btn {
  position: relative;
  overflow: hidden;
  width: 34px; height: 34px; padding: 0;
  background: transparent;
  border: 1px solid transparent; /* 常态无边框，保持 1px 几何占位防抖动 */
  border-radius: 255px 12px 225px 10px / 12px 225px 10px 255px;
  color: var(--ink-muted);
  cursor: pointer; user-select: none;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}
.flow-turn-nav-btn svg {
  position: relative;
  z-index: 2;
}
.flow-turn-nav-btn:hover,
.flow-turn-nav-btn:focus-visible {
  border-color: var(--sketch-border);
  color: var(--ink-primary);
  background: var(--sketch-box-bg);
  box-shadow: var(--sketch-shadow-hover);
}
.flow-turn-nav-btn:active,
.flow-turn-nav-btn.holding { transform: scale(0.93); }

/* 「下」按钮按下长按 1.5 秒背景色由左至右填充层 */
.flow-turn-nav-down::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--sketch-tag-hover-bg);
  transform-origin: left center;
  transform: scaleX(0);
  border-radius: inherit;
  z-index: 1;
  pointer-events: none;
}
.flow-turn-nav-down.holding::before {
  transform: scaleX(1);
  transition: transform 1.5s linear;
}

/* 「下」按钮按下长按中的轻微抖动动画与悬浮边框 */
.flow-turn-nav-down.holding {
  border-color: var(--sketch-border);
  color: var(--ink-primary);
  box-shadow: var(--sketch-shadow-hover);
  animation: flowNavHoldShake 0.16s ease-in-out infinite;
}

.flow-turn-nav-btn.long-press {
  border-color: var(--sketch-border);
  color: var(--ink-primary);
  background: var(--sketch-tag-bg);
  box-shadow: var(--sketch-shadow);
  animation: none;
  transform: scale(1);
}
.flow-turn-nav-btn.long-press::before {
  transform: scaleX(1);
  transition: none;
}
.flow-turn-nav-btn.long-press svg { animation: flowNavHoldPulse 1.1s ease-in-out infinite; }

/* 非 Flow 视图下绝不显现 */
.app-container:not([data-view="flow"]) .flow-turn-nav { display: none !important; }

@keyframes flowNavHoldShake {
  0%, 100% { transform: scale(0.94) translate(0, 0) rotate(0deg); }
  25% { transform: scale(0.94) translate(-0.6px, 0.4px) rotate(-0.6deg); }
  50% { transform: scale(0.94) translate(0.6px, -0.4px) rotate(0.5deg); }
  75% { transform: scale(0.94) translate(-0.4px, -0.3px) rotate(-0.4deg); }
}

@keyframes flowNavHoldPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
```

```javascript
const LONG_PRESS_MS = 1500;
let navPressState = null;      // { type: 'up'|'down', startTime, done }
let downLongPressTimer = null;

const resetNavButtonVisual = (type) => {
  const btn = type === "up" ? flowTurnNavUp : flowTurnNavDown;
  if (!btn) return;
  btn.classList.remove("holding", "long-press");
  if (type === "down") btn.setAttribute("title", "下一个对话 (长按 1.5 秒直接定位到底部)");
};

const beginNavPress = (type) => {
  if (navPressState) cancelNavPress(navPressState.type);
  navPressState = { type, startTime: Date.now(), done: false };
  const btn = type === "up" ? flowTurnNavUp : flowTurnNavDown;
  if (btn) btn.classList.add("holding");
  if (type === "down") {
    clearTimeout(downLongPressTimer);
    downLongPressTimer = setTimeout(() => {
      if (navPressState && navPressState.type === "down" && !navPressState.done) {
        navPressState.done = true;   // 长按满 1.5 秒：立即定位到底部，无需弹起
        scrollToConversationBottom();
        if (flowTurnNavDown) {
          flowTurnNavDown.classList.add("long-press");
          flowTurnNavDown.setAttribute("title", "已定位到会话最底部");
        }
      }
    }, LONG_PRESS_MS);
  }
};

const endNavPress = (type) => {
  if (!navPressState || navPressState.type !== type) return;
  const wasDone = navPressState.done;
  navPressState = null;
  clearTimeout(downLongPressTimer); downLongPressTimer = null;
  resetNavButtonVisual(type);
  if (wasDone) return;             // 长按已触发定位，弹起不再重复定位
  if (type === "up") scrollToPreviousTurn();
  else scrollToNextTurn();
};

const cancelNavPress = (type) => {
  if (navPressState && navPressState.type === type) {
    navPressState = null;
    clearTimeout(downLongPressTimer); downLongPressTimer = null;
    resetNavButtonVisual(type);
  }
};

// 顶部悬浮提示吸附高度（锚定判定与定位偏移共用，保证目标不被遮挡）
const getStickyTipOffset = () =>
  flowQuestionTip && flowQuestionTip.classList.contains("visible")
    ? flowQuestionTip.offsetHeight + 8 : 0;

// 每轮对话的定位锚点 = 该轮「最终输出内容」卡片（.flow-response-card / .agent-response-card）
const getTurnResponseAnchor = (group) =>
  group?.querySelector(".flow-response-card") ||
  group?.querySelector(".agent-response-card") ||
  group?.querySelector(".response-content") ||
  group;

// 视口顶边「内容线」：滚动区顶边 + 顶部悬浮提示吸附高度（锚定判定与定位偏移共用同一基准）
const getViewportTopLine = () => {
  if (!flowScrollArea) return 0;
  return flowScrollArea.getBoundingClientRect().top + getStickyTipOffset();
};

// 当前锚定轮次：取「最终输出内容顶部 <= 视口顶边(+提示吸附高度)」的最后一个轮次；
// 与定位使用同一目标，点击后锚定随之推进，可连续多次向上/向下定位（修复二次点击失效）。
const getAnchoredTurnIndex = () => {
  if (!flowScrollArea || !flowConversation) return -1;
  const groups = flowConversation.querySelectorAll(".flow-message-group");
  if (groups.length === 0) return -1;
  const threshold = getViewportTopLine();
  let anchor = 0;
  for (let i = 0; i < groups.length; i++) {
    if (getTurnResponseAnchor(groups[i]).getBoundingClientRect().top <= threshold) anchor = i; else break;
  }
  return anchor;
};

// 当前所在轮次 N：最后一个「整组对话起点（用户提问卡顶部）<= 视口顶边」的轮次；
// 用于「上」按钮两段式定位（情形 1 / 情形 2）的基准轮次判定。
const getCurrentTurnIndex = () => {
  if (!flowScrollArea || !flowConversation) return -1;
  const groups = flowConversation.querySelectorAll(".flow-message-group");
  if (groups.length === 0) return -1;
  const viewTop = getViewportTopLine();
  let n = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].getBoundingClientRect().top <= viewTop) n = i; else break;
  }
  return n;
};

// 定位到第 index 段对话「最终输出内容」顶部（对齐显示窗体顶部，扣除顶部悬浮提示吸附高度）
const scrollToTurnStart = (index) => {
  if (!flowScrollArea || !flowConversation) return;
  const groups = flowConversation.querySelectorAll(".flow-message-group");
  if (index < 0 || index >= groups.length) return;
  const target = getTurnResponseAnchor(groups[index]);
  const areaTop = flowScrollArea.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;
  const tipOffset = getStickyTipOffset();
  const maxTop = flowScrollArea.scrollHeight - flowScrollArea.clientHeight;
  const nextTop = Math.max(0, Math.min(flowScrollArea.scrollTop + (targetTop - areaTop) - tipOffset, maxTop));
  flowScrollArea.scrollTop = nextTop; // scroll-behavior: smooth 平滑滚动
};

// 「上」按钮两段式优化定位（见 3.6.1 情形 1 / 情形 2 判定）
const OUTPUT_TOP_PROXIMITY_PX = 100;
const scrollToPreviousTurn = () => {
  if (!flowConversation) return;
  const groups = flowConversation.querySelectorAll(".flow-message-group");
  if (groups.length === 0) return;

  const viewTop = getViewportTopLine();
  const n = getCurrentTurnIndex();
  if (n < 0) return;

  const respTop = getTurnResponseAnchor(groups[n]).getBoundingClientRect().top;
  if (viewTop <= respTop + OUTPUT_TOP_PROXIMITY_PX) {
    // 情形 1：第 N 轮最终输出顶部向上 100px 范围内（含其上方思考/提问区）→ 回退第 N-1 轮最终输出顶部
    if (n <= 0) return; // 已是第一轮
    scrollToTurnStart(n - 1);
  } else {
    // 情形 2：已深入第 N 轮最终输出（或越过其底部）→ 先定位第 N 轮最终输出顶部
    scrollToTurnStart(n);
  }
};
const scrollToNextTurn = () => {
  const anchor = getAnchoredTurnIndex();
  const count = flowConversation.querySelectorAll(".flow-message-group").length;
  if (anchor < 0 || anchor >= count - 1) return; // 已是最后一轮
  scrollToTurnStart(anchor + 1);
};
const scrollToConversationBottom = () => {
  if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
};

// 垂直对齐：按钮已右移到 flow 内容区之外，垂直方向动态对齐 flow 内容区底部
const positionFlowTurnNav = () => {
  if (!flowTurnNav || !flowStage || !appContainer || currentView !== VIEW_FLOW) return;
  const appRect = appContainer.getBoundingClientRect();
  const stageRect = flowStage.getBoundingClientRect();
  const navHeight = flowTurnNav.offsetHeight || 0;
  flowTurnNav.style.top = `${Math.round(stageRect.bottom - appRect.top - navHeight - 14)}px`;
};

const updateFlowTurnNav = () => {
  if (!flowTurnNav) return;
  const count = flowConversation ? flowConversation.querySelectorAll(".flow-message-group").length : 0;
  const shouldShow = currentView === VIEW_FLOW && count >= 2;
  flowTurnNav.classList.toggle("visible", shouldShow);
  if (!shouldShow) { cancelNavPress("up"); cancelNavPress("down"); }
  positionFlowTurnNav();
};

// flow 内容区尺寸变化（窗口缩放 / 输入框多行高度变化 / 视图切换）时保持按钮垂直对齐
if (flowStage) {
  const navStageResizeObserver = new ResizeObserver(() => positionFlowTurnNav());
  navStageResizeObserver.observe(flowStage);
  window.addEventListener("resize", positionFlowTurnNav);
}

// 绑定：mouseup 仅在指针仍在按钮上时触发；mouseleave 即作废；键盘 Enter/Space 支持可访问性
const bindTurnNavButton = (type) => {
  const btn = type === "up" ? flowTurnNavUp : flowTurnNavDown;
  if (!btn) return;
  btn.addEventListener("mousedown", (e) => { if (e.button !== 0) return; e.preventDefault(); beginNavPress(type); });
  btn.addEventListener("mouseup",   (e) => { if (e.button !== 0) return; endNavPress(type); });
  btn.addEventListener("mouseleave", () => cancelNavPress(type));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginNavPress(type); }
  });
  btn.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); endNavPress(type); }
  });
};
bindTurnNavButton("up");
bindTurnNavButton("down");

// 刷新时机：resetStreamState 末尾（新轮次追加）+ pi:view-change（进入/离开 Flow、历史恢复）
window.addEventListener("pi:view-change", () => updateFlowTurnNav());
```

### 3.6.3 关键陷阱
- **导航必须挂在 `#app-container` 下而非 `#flow-stage` 内**：`#flow-stage` 有 `overflow: hidden`，会把右移到内容外的按钮裁掉；挂到 `#app-container`（`position: relative`）后用 JS（`positionFlowTurnNav` + `ResizeObserver`）对齐垂直位置；
- **`mouseleave` 必须作废按下状态**：这是「按下后移出按钮再弹起不生效」的核心保障——仅靠 `mouseup` 在按钮上派发还不够，拖出再拖回后释放仍会触发，必须用 `mouseleave` 清零；
- **锚定与定位必须同源**：锚定轮次与定位目标都使用「每轮最终输出内容顶部」，且判定阈值要加 `tipOffset`（提示吸附高度）；否则点击一次后锚定不推进，第二次点击就失效（「只能点一次」的根因）；
- **扣除 sticky 提示高度**：直接 `scrollTop += targetTop - areaTop` 会把目标顶部对齐到视口顶边，从而被 `flow-question-tip` 遮挡，需减去 `tipOffset = tipHeight + 8`；
- **长按立即定位用定时器触发**：1.5s 定时器到点直接 `scrollToConversationBottom()` 并置 `done = true`，弹起时不再重复定位（无需再用时间戳在 mouseup 判定）；
- **导航显隐必须在两个时机刷新**：`resetStreamState`（新轮次追加后，含跟随即时显现）与 `pi:view-change`（进入/离开 Flow、历史任务/会话恢复），缺一不可；同时用 `ResizeObserver` 监听 `flow-stage` 以保持垂直对齐；
- **常态透明无边框**：遵循项目按钮铁律，`border: 1px solid transparent` 防抖，仅 hover/focus-visible 显框。

---

## 📌 4. Windows 系统通知与失焦调度规范 (Notification & Focus Pipeline)

### 4.1 触发时机铁律
- **失焦判定（严格门禁）**：`notificationService.isWindowFocused()` 为 `true` 时，绝不发出任何通知；
- **人工回归 (Human Intervention)**：当收到 `extension-ui` 或交互请求时，若失焦**立即通知**；
- **报错终止 (Error Termination)**：当模型调用发生异常、RPC 报错或致命终止时，若失焦**立即通知**；
- **输出完成 (Agent Completed)**：模型输出结束时，必须检查并发任务池（如包管理器队列、内核升级等），若无其他任务运行且失焦时触发“所有任务已完成”通知；若仍有其他任务在运行则暂不通知。

---

## 📌 5. 输入历史记录上下翻阅与草稿暂存规范 (Prompt History Navigation & Draft Preservation)

### 5.1 交互设计与触发条件
1. **草稿暂存 (Draft Preservation)**：首次按 `ArrowUp` 离开当前正在输入的文本时，自动将当前输入暂存为 `draft`，按 `ArrowDown` 翻回到最新之后时无缝恢复；
2. **光标位置与智能触发**：输入框为空、光标在最前（`selectionStart === 0`）或全部选中时按 `ArrowUp` 触发向上翻阅；切换历史后光标自动移至末尾并触发 `updateInputState` 同步跑马灯与清空按钮；
3. **数据源联动**：通过 `promptHistoryNavigator` 维护历史队列，冷启动时从 `conversationHistoryService` 及本地会话历史同步，每次提问提交时自动压栈并去重。

---

## 📌 6. 后台对话任务与双通道解耦规范 (Background Tasks & Dual Channel Abort/Suspend)

### 6.1 交互设计与双通道解耦
1. **通道 1：后台挂起 (Background Suspend)**：
   - 在 Flow 模式下按鼠标右键或按 Esc，当前推理任务**无感转入后台 `TaskManager` 持续执行**（绝不调用 `abort`）；
   - 界面平滑回退至 Focus 专注版，顶部弹出 1.5s 提示条 `已转入后台运行 (Task #1)`；
   - 右上角 Mini 任务胶囊计数同步更新（如 `[ ✏️ 1/3 Task ]`），伴随旋转呼吸动效；
2. **通道 2：显式中止 (Explicit Abort) 与手动终止提示**：
   - Flow 输入框右侧显式提供手绘「⏹ 中止」按钮（`#flow-btn-abort`）及侧边栏单任务中止操作，负责彻底杀死 Agent 生成；
   - 用户主动终止时，Flow 会在对话输出结尾即时追加手绘草图风格「刚刚会话已手动终止」提示字段（`.flow-abort-callout`），并在恢复会话与历史沉淀时完整持久化保留；
3. **毛玻璃侧边栏与背景高斯模糊 (`Task Details Sidebar`)**：
   - 点击 Mini 胶囊滑出 320px 半透明手绘侧边栏（`backdrop-filter: blur(14px)`），主界面区域自动触发高斯模糊（`blur(4px)`）；
   - 侧边栏支持查看所有 Task（模型、运行状态、提问摘要）及操作（「进入 Flow」、「⏹ 中止」、「✕ 清除」）；
   - 全域右键或按 Esc 优先平滑收起侧边栏并复原主背景。

---

## 📌 7. 同一工作流多轮连续对话规范 (Multi-turn Continuous Workflow Pattern)

### 7.1 设计原则
1. **工作流连续性 (Workflow Continuity)**：在 Flow 交互界面内，问完问题 1 后用户继续输入问题 2，必须保持在**同一个会话工作流**（同一个 Flow 实例、同一个 Task ID、同一个底层 `SessionHost` 子进程），严禁误判为新对话重置清空历史。
2. **DOM 消息组级联追加 (Turn Message Group Appending)**：
   - 历史各轮消息（问题卡片、思考卡片、工具卡片、回答卡片）依次在 `flow-conversation` 容器内保留；
   - 历史各轮思考卡片与工具卡片自动收起，保留 Markdown 回答卡片供随时阅读回顾，点击历史思考卡片 header 依然支持独立折叠/展开；
   - 最新一轮动态追加在容器最下方，流式光标与思考计时器仅挂载在最新一轮；
3. **数据模型与多轮快照归档**：
   - `TaskManager` 中的 `TaskItem` 维护 `turns: Array<TurnItem>` 轮次数组，实时同步思考、工具调用与回答；
   - 生成完成（`agent-end` / `agent-error` / abort）、右键回退及窗口关闭生命周期（`beforeunload` / `pagehide`）时，`conversationHistoryService` 均即时更新并持久化沉淀所有轮次快照（`turns`），结合 Conversation ID 与 Task ID 双向映射，无论何时关闭重启软件，点击历史讯息方框或 Task 时均能 100% 完整无损还原所有多轮对话！

### 7.2 运行中提交拦截与「终止并发送」流水线 (Mid-stream Submit Intercept & Interrupt-Send Pipeline)
- **背景**：当前轮处于运行态（`thinking` / `streaming` / `tool_exec`）或待确认（`paused`）时用户仍可编辑并提交输入框。若直接放行并发起新轮，旧轮流式残留事件（无 taskId 路由的 `thinking-delta` / `text-delta` / `tool-start`）会混入新轮 DOM 与数据，旧轮 `agent-end` 还会提前归档历史并提前置 Task 为 `completed`，形成内容串轮、状态错乱与历史脏快照三重竞态；
- **拦截交互**：`handleFlowQuery` 入口检测「当前视图为 Flow 且前台任务处于运行态/待确认」时，弹出 `sketchConfirm`（标题「上一轮仍在生成中」，`confirmText: 终止并发送`（危险操作红标），`cancelText: 等待完成`）：
  - 选择「等待完成」→ 输入内容原样保留、仅回焦输入框，不发起任何请求；
  - 选择「终止并发送」→ 进入中断发送流水线（见下），随后走正常多轮下发路径（`startNewTurn` → `resetStreamState(isFollowUpTurn=true)` → `piClient.sendPrompt`）；
- **中断发送流水线时序铁律**（`src/modules/flow-pipeline.js`）：
  1. `modelFailoverEngine.cancel("new-query")` 取消同任务在途自愈（清退避定时器、结算在途尝试）；
  2. 置 `interruptSendTaskId = taskId` 与 `task.pendingInterruptSend = true`，弹出「正在终止当前生成，即将发送新提问…」Toast；
  3. **先注册** `waitForTurnSettled(taskId)`（监听 `agent-end` / `agent-error` 且按 taskId 过滤，6s 超时兜底），**再** `piClient.abort(taskId)` —— 监听器必须先于 abort 注册，杜绝结算事件先于等待窗口到达导致永久悬挂；
  4. 结算到达或超时后清除 `interruptSendTaskId` 与 `pendingInterruptSend`，旧轮头部耗时位定格为「已中断 (Xs)」；
  5. 结算期间任务被挂起/切换则丢弃本次发送并回填输入内容；
- **结算期抑制铁律**（双守卫，顺序无关）：
  - `src/modules/flow-pipeline.js` 的 `agent-end` / `agent-error` 监听器：`interruptSendTaskId` 非空且事件 taskId 匹配（或缺失）时一律 `return`——跳过 `finalizeStream` / `collapseAllToolCards` / `archiveCurrentFlowToHistory` / `renderErrorCard`，也绝不冷启动新自愈流水线；
  - `task-manager.js` 的 `agent-error` 监听与 `handleTaskEvent` 的 `agent_end` / `agent_settled` / `turn_end` / `message_start` / `message_end` / `extension_error` 分支：`task.pendingInterruptSend` 为真时只把旧轮标记为 `aborted`（`isAborted = true`、`completedAt` 落时间戳），**绝不**置整个 Task 为 `completed` / `error`、不发错误通知；
- **根因消除**：新轮 DOM 只在旧轮真正结算（agent-end / agent-error / 超时）之后才创建，后端 `prompt` 指令在 `abort` 指令之后入同一 SessionHost 的 stdin FIFO 队列，旧轮残留流式内容永远落在旧轮 DOM/数据内，彻底杜绝内容混串。

---

## 📌 8. 模型自动重连切换自愈流水线规范 (Model Auto Reconnect & Failover Pattern)

> 前置开关：设置页「模型配置」标题右侧「自动重连切换」Checkbox（默认勾选，见 `settings-view-pattern`），持久化于 `~/.pi-dl/config.json`；仅影响 Flow 流程中的模型调用错误处理。

### 8.1 引擎职责与行为分支 (ModelFailoverEngine)
- **文件**：`src/services/model-failover.js`（单例 `modelFailoverEngine`）；
- **错误分类（先于友好化文案）**：`pi-client.js` 导出 `extractErrorCode` / `classifyModelError`，从 `detail.raw`（原始 RPC 数据）提取 HTTP 状态码 / 错误 token / 网络层关键字；
  - **瞬态 `TRANSIENT`**（408/429/500/502/503/504、`rate_limit`/`server_error`/`overloaded`/`timeout`、`ECONNRESET`/`ETIMEDOUT`/`fetch failed`/`请求超时` 等）→ 自动重连；
  - **永久 `PERMANENT`**（400/401/403/404/405/422、`authentication_error`/`insufficient_quota`/`model_not_found`、中文 `鉴权失败`/`额度不足`/`模型不存在` 等）→ 自动切换模型；UNKNOWN 保守归永久；
- **分支一：瞬态自动重连**：`delay = min(reconnectBackoffMs[attempt-1] ?? 8000, 8000)`（2s → 4s → 8s → 8s…），上限 `maxReconnectAttempts = 24` 次；同 Turn 复用重发（不重建提问卡、不重复压入 prompt history、不新建 Task）；重连耗尽默认升级为切换（`escalateToSwitchAfterReconnectExhausted = true`，可配置关闭）；
- **分支二：永久自动切换**：候选 = 白名单 MRU 顺序（跳过当前失败模型），单次遍历不循环；每候选先「临时切换」（仅 `pi_set_model`，**绝不刷新 MRU / `selectedModel`**）再重发；候选瞬态错误仅消耗 `perCandidateReconnectBudget = 2` 次小额重连预算；候选成功输出后才转「正常切换」（`saveSelectedModel` + `touchModelAsRecentlyUsed` 置顶持久化）；
- **全部失败兜底**：恢复原模型（`pi_set_model` 切回，MRU/selectedModel 本就未变）+ 复用 `renderErrorCard` 并追加自愈摘要行（`已尝试重连 N 次 / 已依次尝试 N 个模型后仍失败` / 单模型时 `当前仅配置 1 个模型`）。

### 8.2 Flow 内进度反馈与事件结算
- **进度胶囊**：`createFlowTurnGroupElement` 在注入胶囊之后新增 `.flow-failover-capsule`（默认隐藏，不沉淀历史快照）；引擎派发 `failover-status` 事件（`status/attempt/maxAttempts/nextDelayMs/candidate/modelName/phase`），`updateFailoverCapsule` 更新文案：
  - 重连中：`模型调用异常 (429) · 自动重连中 3/24 · 8s 后重试`；
  - 切换中：`正在自动切换至 <模型名> 重试 … (2/5)`；
  - 切换成功：`已自动切换至 <模型名> · 已记入最近使用`（绿墨色，2s 后淡出）；重连成功（未切换）：淡出 `已恢复连接`；
  - 全部失败 / 被取消：隐藏胶囊；
- **事件结算**（关键时序铁律）：`pi-client` 对一次失败尝试会先派发 `agent-error` 再派发 `agent-end`（同步 `dispatchEvent` 保证顺序）——
  - `agent-error` 监听器：引擎活跃 → `handleModelError`（热结算当前在途尝试为失败并继续流水线）；引擎未活跃但 `canHandle`（自动重连开启且含模型上下文）→ 冷启动自愈；否则 `renderErrorCard`；
  - `agent-end` 监听器：引擎活跃 → `resolveTurnSuccess()`（结算成功并交由引擎 `onSuccess` 收尾，绝不提前归档）；未活跃 → 既有正常收尾逻辑；
  - 退避等待期间到达的杂散 `agent-error` / `agent-end` 因无在途尝试被引擎安全忽略；
- **不提前归档铁律**：自愈进行中全局 `agent-end` / `agent-error` 被引擎接管，`archiveCurrentFlowToHistory` 与 Task「error」状态、错误通知全部延后至终态（成功或 GIVE_UP），`task-manager.js` 的 `agent-error` 监听与 `handleTaskEvent` 错误分支均以 `modelFailoverEngine.isActive() || canHandle(detail)` 门控跳过；
- **终止 / 挂起 / 多任务隔离**：「⏹ 终止」与侧边栏任务终止调用 `modelFailoverEngine.cancel()`（清除退避定时器 + 结算在途尝试 + 走既有手动终止提示）；右键后台挂起后引擎继续在后台运行，侧边栏挂起任务徽章显示「自动重连中 / 切换模型中」；引擎按 `taskId` 隔离多任务互不干扰（`MAX_CONCURRENT_TASKS = 3` 保护不变）；用户发起新显式提问时取消同任务在途自愈（后台任务不受影响）。

---

## 📌 9. Typedown 质感 Markdown 预览与全域超链接跳转规范 (Markdown Preview & Hyperlink Pattern)

### 9.1 渲染引擎架构 (`src/lib/markdown-renderer.js`)
- **设计定位**：参考 Windows 平台开源 Markdown 编辑器 **Typedown** 与 Typora 风格，融合手绘素描纸（浅色）与炭黑黑板（深色）双模主题；
- **流式容错（Streaming Resilience）**：流式生成过程中自动修补未闭合代码围栏（```）、未完结表格（`|`）与行内标记，实时渲染不闪烁、不破坏布局；
- **全套 GFM 与排版特性**：
  1. **多级标题（H1 ~ H6）**：H1/H2 带有手绘实线/虚线下边框，阶梯字阶与舒适行距；
  2. **代码块顶部信息栏与一键复制**：语言徽标（手绘代码图标 + `JS`/`PYTHON`/`RUST` 等大写标签）+ 右侧手绘「复制」按钮；点击后通过 `navigator.clipboard.writeText` 写入剪贴板，按钮即时切换为绿墨勾选 `已复制` 并维持 1.8 秒；
  3. **轻量语法高亮**：内置 JS/TS、Python、Rust、Bash/Shell、JSON、HTML、CSS、SQL、YAML 等分词扫描器，支持关键字（`.tok-kw`）、字符串（`.tok-str`）、数字（`.tok-num`）、函数调用（`.tok-fn`）、注释（`.tok-cmt`）及内置对象；
  4. **GFM 规范表格**：支持对齐语法（`:---` / `:---:` / `---:`）、斑马纹悬浮与横向平滑滚动；
  5. **任务清单（Task Lists）**：支持 `- [ ]` 与 `- [x]`，手绘素描复选方框与划线完成态；
  6. **GitHub Callout 警示框**：识别 `> [!NOTE]`、`> [!TIP]`、`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]` 并以内联手绘 SVG 图标与左侧彩色描边卡片呈现。

### 9.2 全域 HTTP/HTTPS 超链接跳转
- **解析层**：Markdown 显式链接 `[text](url)` 与独立纯网址 `https://...` 自动识别为超链接，并附带手绘外部跳转微图标（`ICONS.externalLink`）；
- **拦截与唤起**：
  - `src/modules/global-interactions.js` 在 `document` 捕获阶段拦截所有 `a[href^="http://"]` / `a[href^="https://"]` / `a[href^="mailto:"]` 的点击事件；
  - 阻止 Webview 内部导航（`e.preventDefault()`）；
  - 调用 `src/services/tauri-bridge.js` 的 `openExternalUrl(url)`，通过 Rust 指令 `pi_open_url`（`tauri_plugin_opener`）唤起用户操作系统默认浏览器打开外部页面。

---

## 📌 10. 历史会话还原与提示词上下文信封净化规范 (Session History Restoration & Prompt Context Stripping)

### 10.1 问题背景与根本诱因
当应用在运行时向 Pi 内核发送 Prompt 时，Rust 后端会根据当前环境透明注入上下文信封（如 `<runtime_context_rules>`、`<code_area_routing_context>` 等），同时包含附带文件/目录的绝对路径尾注（`[附带本地文件/目录绝对路径]:`）。这些信息会真实保存在底层 Pi 会话文件（`~/.pi/agent/sessions/*.jsonl`）中。
若在从设置页「会话记录」Tab 或主界面讯息抽屉恢复进入 Flow 界面时未进行深度脱敏净化，这些注入信封与绝对路径就会暴露在用户提问卡片与顶部悬浮提示中。

### 10.2 纯净还原流水线
1. **Rust 后端原生净化 (`src-tauri/src/session/parser.rs`)**：
   - `strip_injected_contexts(text)`：递归与循环剥离所有 XML-like 上下文信封（`<runtime_context_rules>`, `<code_area_routing_context>`, `<workspace_context>` 等）；
   - `clean_user_prompt(text)`：剥离注入信封 + 截断 `[附带本地文件/目录绝对路径]:` 等附件尾注 + 移除目录引导提示语 + 将纯附件占位前缀还原为空字符串；
   - `split_user_prompt_attachments(text)`：精确提取附件物理路径列表，过滤引导提示行与标签行；
   - `extract_user_prompts_from_session` 与 `parse_session_file` 均统一采用 `clean_user_prompt`。
2. **Web 前端纵深防御 (`src/lib/dom-utils.js` & 各 UI 模块)**：
   - `cleanUserPrompt(text)` 工具函数：在 `createFlowTurnGroupElement`、`mapSessionTurns`、`recordConversation`、`PromptHistoryNavigator` 以及 `restoreConversationToFlow` / `restoreTaskToFlow` 中进行纵深净化；
   - 彻底保证：无论是从本地存储恢复、从内核原生会话文件解析、还是在上下翻阅历史提示词栈时，用户输入卡片均 100% 仅展现用户原始真实提问，绝无注入标签残留。

---

## 📎 关联文件索引

| 文件 | 关键内容 |
|---|---|
| [`src/lib/dom-utils.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/lib/dom-utils.js) | `escapeHtml`、`cleanUserPrompt`（提示词注入信封与附件尾注纵深净化器） |
| [`src/lib/markdown-renderer.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/lib/markdown-renderer.js) | `renderMarkdown` 流式 Markdown 预览渲染引擎、轻量分词高亮器、`initMarkdownInteractions` 代码块一键复制事件委托 |
| [`src/styles/markdown.css`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/styles/markdown.css) | Typedown 质感 Markdown 预览样式表（标题、代码块、语法分词、表格、任务清单、警示框、超链接） |
| [`src/services/tauri-bridge.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/tauri-bridge.js) | `invokeTauri` 与 `openExternalUrl`（调用后端 `pi_open_url` 或 `plugin:opener|open_url` 打开系统默认浏览器） |
| [`src/modules/global-interactions.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/modules/global-interactions.js) | 全局拦截所有外部超链接点击，统一唤起系统默认浏览器打开 |
| [`src/services/task-manager.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/task-manager.js) | `TaskManager` 多任务状态机、`turns` 轮次数组、多轮开启 `startNewTurn`、任务挂起与中止 |
| [`src/services/model-failover.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/model-failover.js) | `ModelFailoverEngine` 自动重连切换引擎 |
| [`src/services/pi-client.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/pi-client.js) | `extractErrorCode` / `classifyModelError` 错误分类、`agent-error` / `agent-end` / `retry-status` 事件流 |
| [`src/services/conversation-history.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/conversation-history.js) | `ConversationHistoryService` 多轮快照沉淀与 MRU 恢复、提问净化与简短标题生成 |
| [`src/services/prompt-history.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/prompt-history.js) | `PromptHistoryNavigator` 输入框历史回溯栈与原生会话提问同步 |
| [`src-tauri/src/session/parser.rs`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/src/session/parser.rs) | `strip_injected_contexts`、`clean_user_prompt`、`split_user_prompt_attachments`、`parse_session_turns` 原生会话解析与净化 |
| [`src-tauri/src/pi_runner/host_pool.rs`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/src/pi_runner/host_pool.rs) | `PiHostPool` 多进程监管池、独立子进程隔离与 `task_id` 分帧注入 |
| [`src/main.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/main.js) | 前端编排入口：收集 DOM 引用、构建 `ctx` 并按依赖顺序初始化各模块 |
| [`src/modules/flow-ui.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/modules/flow-ui.js) | `createFlowTurnGroupElement`、`updateFlowTurnNav`、`renderMarkdown` 接入与提问卡净化 |
| [`src/modules/sessions-panel.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/modules/sessions-panel.js) | 会话记录面板列表渲染、`enterKernelSessionFlow` 会话恢复与进入 Flow 管线 |
| [`src/modules/task-panel.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/modules/task-panel.js) | `renderTurnsIntoFlow`、`restoreConversationToFlow`、`restoreTaskToFlow` 轮次渲染与恢复 |
| [`src/modules/flow-stream.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/modules/flow-stream.js) | 流式输出 `text-delta` 事件实时渲染 Markdown 与光标更新 |
| [`src/styles.css`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/styles.css) | 样式聚合入口（包含 `@import url("./styles/markdown.css");`） |
| [`src-tauri/src/lib.rs`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/src/lib.rs) | `pi_get_session_detail`、`pi_get_prompt_history`、`pi_open_url` 指令等 |


