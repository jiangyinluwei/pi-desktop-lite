---
name: flow-interaction-pattern
description: |
  指导 Flow 流式交互界面（界面3）的四大核心交互逻辑实现规范：①过程框体（思考卡片/工具调用卡片）可手动折叠展开；②"当前最下方框体展开、出现下一框时自动收起"的级联自动收起流水线；③Flow 界面任意区域滚轮事件委托至最外层滚动容器；④多段对话顶部悬浮当前提问提示 (Flow Floating Question Tip)。当用户提出"flow界面交互"、"思考卡片折叠"、"工具调用卡折叠"、"自动收起"、"滚轮滚动"、"flow滚动条"、"卡片收起"、"悬浮提问提示"、"顶部悬浮tips"、"当前提问提示"时使用此技能。
---

# Flow 界面交互逻辑规范 (Flow Interaction Pattern)

本 Skill 归档了 Flow 流式交互界面（`界面3 / data-view="flow"`）的四大核心交互机制的**实现规范、已验证代码模式与关键陷阱**。

---

## 🏛️ 架构总览

Flow 界面卡片层级如下（从上到下）：

```
flow-scroll-area            ← 唯一可滚动容器（overflow-y: auto）
  ├─ flow-question-tip      ← 顶部悬浮当前提问提示（sticky top:0，仅溢出时显现）
  └─ flow-conversation
       └─ flow-message-group
            ├─ flow-user-prompt-card       用户提问（不可折叠）
            ├─ flow-injection-capsule      Inner-Skill 注入胶囊（不可折叠）
            ├─ agent-thinking-card         思考过程（可折叠）
            ├─ tool-calls-container
            │    └─ tool-card × N          工具调用卡（可折叠）
            └─ agent-response-card         最终输出（永不折叠）
```

**铁律**：`agent-response-card`（最终输出卡）**永远不折叠**，仅过程类框体可折叠。

---

## 📌 1. 过程框体手动折叠

### 1.1 思考卡片（`agent-thinking-card`）

通过 `.open` class 控制展开/收起，CSS 通过子选择器驱动 `thinking-body` 的显隐。

```css
/* 收起状态：body 隐藏，箭头朝下 */
.thinking-body {
  display: none;
}
.agent-thinking-card.open .thinking-body {
  display: block;
  animation: sketchFadeIn 0.25s ease-out;
}
/* 展开时箭头旋转朝上 */
.agent-thinking-card.open .thinking-arrow-icon {
  transform: rotate(180deg);
}
/* 收起时呼吸脉冲停止 */
.agent-thinking-card:not(.open) .thinking-dot {
  animation: none;
}
```

```javascript
const collapseThinkingCard = () => {
  if (agentThinkingCard && agentThinkingCard.classList.contains("open")) {
    agentThinkingCard.classList.remove("open");
    thinkingToggleBtn?.setAttribute("aria-expanded", "false");
  }
};
const expandThinkingCard = () => {
  if (agentThinkingCard && !agentThinkingCard.classList.contains("open")) {
    agentThinkingCard.classList.add("open");
    thinkingToggleBtn?.setAttribute("aria-expanded", "true");
  }
};
```

点击 `#thinking-toggle-btn` 调用上述函数切换。

### 1.2 工具调用卡片（`tool-card`）

每张卡片动态创建，header 内含折叠箭头，绑定点击/键盘事件：

```javascript
// tool-start 事件中创建卡片时
card.innerHTML = `
  <div class="tool-header" role="button" tabindex="0" aria-expanded="true">
    <div class="tool-title-group">
      <span class="tool-icon" aria-hidden="true">${ICONS.tool}</span>
      <span class="tool-name">${escapeHtml(toolName)}</span>
    </div>
    <div class="tool-header-right">
      <span class="tool-status-badge">running</span>
      <span class="tool-collapse-arrow" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </span>
    </div>
  </div>
  <div class="tool-body">${escapeHtml(argsStr)}</div>
`;

const header = card.querySelector(".tool-header");
const toggle = () => {
  if (card.classList.contains("collapsed")) {
    expandToolCard(card);
  } else {
    collapseToolCard(card);
  }
};
header.addEventListener("click", toggle);
header.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
});
```

```css
/* 折叠箭头默认朝下，折叠后旋转朝上 */
.tool-collapse-arrow {
  transition: transform 0.2s ease;
}
.tool-card.collapsed .tool-collapse-arrow {
  transform: rotate(-90deg);
}
/* 折叠时隐藏 body */
.tool-card.collapsed .tool-body {
  display: none;
}
```

辅助函数：

```javascript
const collapseToolCard = (card) => {
  if (card && !card.classList.contains("collapsed")) {
    card.classList.add("collapsed");
    card.querySelector(".tool-header")?.setAttribute("aria-expanded", "false");
  }
};
const expandToolCard = (card) => {
  if (card && card.classList.contains("collapsed")) {
    card.classList.remove("collapsed");
    card.querySelector(".tool-header")?.setAttribute("aria-expanded", "true");
  }
};
const collapseAllDoneToolCards = () => {
  renderedToolCards.forEach((card) => {
    if (!card.classList.contains("running")) collapseToolCard(card);
  });
};
const collapseAllToolCards = () => {
  renderedToolCards.forEach((card) => collapseToolCard(card));
};
```

---

## 📌 2. 自动收起级联流水线

### 2.1 规则定义

> **核心规则**：当前正在运行/最下方的框体默认展开；当下一个框体出现时，上一个框体自动收起。

| 触发事件 | 自动收起动作 |
|---|---|
| `thinking-end` | 调用 `autoCollapseThinkingOnNextPhase()`，首次收起思考卡片 |
| `toolcall-delta-start` | `autoCollapseThinkingOnNextPhase()` |
| `tool-start`（新工具卡出现） | `collapseAllDoneToolCards()`（收起已完成旧卡，保留 running） |
| `text-start`（输出开始） | `autoCollapseThinkingOnNextPhase()` + `collapseAllDoneToolCards()` |
| `text-delta` | `autoCollapseThinkingOnNextPhase()` |
| `agent-end`（全流程结束） | `collapseAllToolCards()`（收起所有工具卡，输出卡不动） |

### 2.2 `hasAutoCollapsedThinking` 门禁标志

`hasAutoCollapsedThinking` 是一轮对话中的一次性标志：

```javascript
let hasAutoCollapsedThinking = false;

// 重置（每次新提问时）
const resetStreamState = (query) => {
  hasAutoCollapsedThinking = false;
  // ...
  expandThinkingCard(); // 新提问时展开思考卡
};

// 首次自动收起（只执行一次）
const autoCollapseThinkingOnNextPhase = () => {
  if (!hasAutoCollapsedThinking) {
    hasAutoCollapsedThinking = true;
    collapseThinkingCard();
  }
};
```

### ⚠️ 关键陷阱：`thinking-start` 不可无条件展开

工具调用结束后，Agent 可能继续二次思考，再次触发 `thinking-start`。

**错误写法**（会导致思考卡二次展开后再也不收起）：
```javascript
piClient.addEventListener("thinking-start", () => {
  hasReceivedDelta = true;
  expandThinkingCard(); // ❌ 无条件展开
});
```

**正确写法**（通过门禁标志防止二次展开）：
```javascript
piClient.addEventListener("thinking-start", () => {
  hasReceivedDelta = true;
  // 仅首轮思考（未自动收起过）时展开；工具调用后的二次思考不再重新展开
  if (!hasAutoCollapsedThinking) {
    expandThinkingCard();
  }
});
```

---

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

---

## 📎 关联文件索引

| 文件 | 关键内容 |
|---|---|
| [`src/services/task-manager.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/task-manager.js) | `TaskManager` 多任务状态机、`turns` 轮次数组、多轮开启 `startNewTurn`、任务挂起与中止 |
| [`src/services/conversation-history.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/conversation-history.js) | `ConversationHistoryService` 多轮快照沉淀与 MRU 恢复 |
| [`src-tauri/src/pi_runner/host_pool.rs`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/src/pi_runner/host_pool.rs) | `PiHostPool` 多进程监管池、独立子进程隔离与 `task_id` 分帧注入 |
| [`src/services/prompt-history.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/prompt-history.js) | `PromptHistoryNavigator` 历史记录栈、草稿暂存与指针控制 |
| [`src/main.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/main.js) | `createFlowTurnGroupElement`、`resetStreamState`（多轮追加）、`handleFlowQuery`（同一工作流路由）、`restoreTaskToFlow` 与 `restoreConversationToFlow`（多轮还原） |
| [`src/services/notification-service.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/notification-service.js) | 全局焦点追踪器、任务池追踪器、Windows 原生 Toast 通知分发 |
| [`src-tauri/src/lib.rs`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/src/lib.rs) | `tauri-plugin-notification` 初始化、`pi_show_notification`、`app-awakened` 广播与任务池 RPC |
| [`src/styles.css`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/styles.css) | `.flow-message-group`、`.agent-thinking-card`、`.tool-card`、`#mini-task-capsule`、`#task-details-sidebar` |
| [`src/index.html`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/index.html) | `#flow-conversation`、`#flow-btn-abort`、`#flow-scroll-area` |

