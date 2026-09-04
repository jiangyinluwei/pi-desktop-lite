---
name: clean-code-refactoring
description: 指导在桌面端（Tauri/Rust）与 Web 前端混合项目中进行逻辑去重、结构精简、样板代码消除与架构轻量化重构。当用户提出"代码精简"、"去冗余"、"重构优化"、"精简结构"、"逻辑优化"、"消除重复代码"时使用。
---

# 桌面端与 Web 混合架构代码精简与重构规范 (Clean Code Refactoring)

规范在 **Tauri 2 / Rust + 原生 Web 前端** 混合架构项目中进行逻辑去冗余、结构精简、样板代码消除与统一复用的工程范式。

---

## 🎯 核心原则

1. **DRY 统一收口**：高频重复逻辑提炼为单一职责的 Helper、Bridge 或 Service；
2. **零运行时副作用**：精简重构保持对外 API、RPC 指令与事件响应 100% 等价；
3. **添加单元测试代码后必须清除**：重构验证期间编写的临时单元测试、断言或测试桩在交付前**必须彻底清除**，保持生产源码纯粹精炼；
4. **闭环验证**：重构完成后自动执行 `node -c` / `npm run check:fe` 与 `npm run check` 验证；涉及降耦合时对比 `npm run measure:coupling` 量化基线。

---

## 🛠️ 7 大标准重构设计范式

### 1. IPC 调用统一桥接模式 (`tauri-bridge.js`)

**消除前端各模块分散处理 `window.__TAURI__` 检查与 try-catch 样板代码**：

```javascript
/**
 * 安全调用 Tauri Invoke 后端指令
 * @param {string} command Tauri 指令名
 * @param {Record<string, any>} [args={}] 传递参数
 */
export async function invokeTauri(command, args = {}) {
  if (window.__TAURI__?.core?.invoke) {
    try {
      return await window.__TAURI__.core.invoke(command, args);
    } catch (err) {
      console.error(`[Tauri IPC] ${command} error:`, err);
      throw err;
    }
  }
  console.warn(`[Tauri IPC] Tauri core is not available for command: ${command}`);
  return null;
}

/**
 * 安全监听 Tauri 全局事件并返回取消监听函数
 * @param {string} event Tauri 事件名
 * @param {(event: any) => void} handler 事件回调
 * @returns {Promise<() => void>} 取消监听函数
 */
export async function listenTauri(event, handler) {
  if (window.__TAURI__?.event?.listen) {
    try {
      return await window.__TAURI__.event.listen(event, handler);
    } catch (err) {
      console.warn(`[Tauri IPC] Failed to listen to ${event}:`, err);
    }
  }
  return () => {};
}
```

### 2. 配置文件泛型读写模式 (Rust Generic JSON I/O)

**消除 Rust 端对 `auth.json`、`models.json`、`settings.json` 重复编写的文件定位与序列化逻辑**：

```rust
/// 通用安全读取 ~/.pi/agent/ 下的 JSON 配置文件
pub fn read_agent_json(filename: &str, default_val: Value) -> Result<Value, String> {
    let path = get_pi_agent_dir()?.join(filename);
    if !path.exists() { return Ok(default_val); }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    Ok(serde_json::from_str(&content).unwrap_or(default_val))
}

/// 通用安全写入 ~/.pi/agent/ 下的 JSON 配置文件
pub fn write_agent_json(filename: &str, data: &Value) -> Result<(), String> {
    let path = get_pi_agent_dir()?.join(filename);
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize {}: {}", filename, e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))
}
```

### 3. 多级 JSON Map 安全操作 (Rust `entry` API)

**消除插入与更新分支重复编写的对象字段赋值**：

```rust
let providers = ensure_providers_map_mut(&mut custom_config);
let p_obj = providers
    .entry(&provider_key)
    .or_insert_with(|| json!({ "models": [] }))
    .as_object_mut()
    .ok_or_else(|| "Provider entry is not an object".to_string())?;

p_obj.insert("baseUrl".to_string(), json!(entry.base_url.trim()));
p_obj.insert("api".to_string(), json!(api_type_str));
p_obj.insert("compat".to_string(), compat_val);
```

### 4. 流式错误统一收口与分发 (`_dispatchErrorFromMessage`)

**消除在 `agent_end`、`turn_end`、`message_end` 等多个事件中重复解构错误字段**：

```javascript
_dispatchErrorFromMessage(msgObj, fallback = "模型执行出错") {
  if (!msgObj) return false;
  if (msgObj.stopReason === "error" || msgObj.errorMessage) {
    const errMsg = parseErrorMessage(msgObj.errorMessage || fallback);
    this.dispatchEvent(
      new CustomEvent("agent-error", {
        detail: {
          message: errMsg,
          model: msgObj.model || this.currentModel?.id,
          provider: msgObj.provider || this.currentModel?.provider,
          raw: msgObj,
        },
      })
    );
    return true;
  }
  return false;
}
```

### 5. 窗口聚合聚焦模式 (Desktop Window Orchestration)

**消除托盘右键菜单、双击/单击中重复的窗口展示与聚焦代码**：

```rust
fn show_and_focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
```

### 6. 跨模块通知降耦合模式 (`event-bus.js` / `contracts.js`)

**消除跨模块通过 `ctx.api.<slot>` 字符串约定调用横切通知（如 toast）造成的隐式耦合**：
- 仅收编「fire-and-forget」横切通知（`ui:*`、`flow:*`），**严禁**收编控制流命令 / 状态迁移（后者走 Store action 或显式 import）；
- 事件注册：`bus.on("ui:toast", ({ text, duration }) => renderToast(text, duration))`；
- 事件派发：`bus.emit("ui:toast", { text, duration })`，payload 自包含上下文（如必带 taskId）；
- 同步派发铁律：emit 内严禁任何 await / 微任务 / Promise；on 返回取消函数便于卸载退订；
- 事件通道须在 `src/lib/contracts.js` 的《事件通道契约表》登记归类（bus / Store action / `pi:*` 内核桥接）。

> **降耦合量化**：用 `npm run measure:coupling` 建立基线（api 调用 / 唯一槽 / api 引用 / bus emit / 共享状态裸写等指标），每阶段重构后对比“在降”。阶段 1 已把 `api.showGlobalToast` 迁至 `bus.emit("ui:toast")`，`task-panel.js` 为唯一 `bus.on` 渲染属主。

---

### 7. 共享可变状态唯一属主模式 (`src/services/stores/*-store.js`)

**消除「神对象 ctx + 多模块直改共享状态」：给 `flow / view / settings / attachments` 建立唯一属主，经 `get/action` 触达。**
- **分层归位**：Store（无 DOM、有状态、有行为）→ `src/services/stores/`；ctx 只留 `el` + store 引用；模块经解构取 `const viewStore = ctx.viewStore`，禁再解构裸对象 `ctx.view / ctx.settings / ctx.attachments`（阶段 2 已移除）；
- **四个 store**：`view-store.js`（四态状态机 `morph(mode, {previousMode, shouldFocusInput})` / `set`，**控制流命令禁上总线**）、`settings-store.js`（`setExpandedChannel` / `setOfficialCatalog` / `setCurrentOfficialAuth` / `setActiveWorkspace` / `updateActiveWorkspace(patch)`）、`attachments-store.js`（`addFiles` / `removeAt` / `clear` / `has` / `last`）、`flow-store.js`（纯数据，**按 taskId 分仓** `flowStore.for(taskId)`）；
- **Store action 硬约束**：一律**同步**、禁 `async/await`、禁微任务调度（同步探测不变量 / 前台门禁 / Task 分仓三铁律）；`bus.emit` 保持同步派发；
- **视图派生缓存不入 Store**：`renderedToolCards` / `currentSteps` / `active*Step` / `activeTurnRefs` / 计时器 / `followBottom` 属视图层，暂留 `ctx.flow` 过渡缓存（阶段 3 已把「纯渲染」拆到 `flow-render.js`；阶段 3b 已落地 `flow-dom.js` 只读 DOM 引用层；视图缓存归位 `flow-state-view` 与 `flow.*` 纯数据迁 `flowStore` 仍列入阶段 3b 后续批次，需运行态流式回归验证）；
- **纯渲染层显式 import**：无副作用、不读共享状态、不碰视图缓存的纯函数（工具/思维/阶段/伪运行卡创建、工具名/图标/摘要映射、入参/结果 HTML 格式化、ANSI 剥离、徽章刷新）迁到 `src/modules/flow-render.js`，调用方 `import { ... } from './flow-render.js'` 显式依赖，**替代旧 `ctx.api` 字符串槽**（阶段 3 已清退 `api.getFriendlyToolName` 等 13 个纯渲染槽）；
- **Flow 域只读 DOM 引用层**：`src/modules/flow-dom.js` 的 `createFlowDom(el)` 从 `ctx.el` 抽出 flow 子集挂 `ctx.flowDom`，flow-* 模块改读 `flowDom.flow*`（阶段 3b 落地，替代直接解构全量 `ctx.el`）；元素定位助手留待阶段 4 `el-binder` 接线。
- **DOM 国产化方向（阶段 4，⚠️ 需 GUI 回归）**：引入 `src/lib/el-binder.js` 的 `bindEl(scope, ids)`（+ 全局 `bindAll`），让每模块只拿自己那棵 DOM，替代全量 `ctx.el` 解构；`main.js` 只留 `#app-container` + 直接子容器（`#flow-stage` / `#search-input-wrapper` / `#settings-view` / `#task-details-sidebar` / `#sketch-messages-drawer`）引用。**因涉铁律热区（流式 / 多任务直切 / 回退链），该阶段推迟到可运行 `npm run dev` 的 GUI 环境**，蓝图（`el-binder` 设计、Feature 作用域归属图 121 id→容器+属主、迁移顺序、组件级+7 项铁律回归矩阵）已备，见《GUI 回归专项》§4 与《pi-desktop-lite-降耦合-第4阶段.md》。目标：「全量 `ctx` 解构」模块 19→0、`const el = ctx.el` 引用清退。落地顺序：①新建 el-binder.js + `contracts.js` 登记 ②非热区模块（workspace/settings-navigation/custom-provider/kernel/model/sessions/search/file-attachments/preferences）③热区模块（view-mode/task-panel/flow-*）逐模块回归 ④收尾 main.js 与 `createFlowDom(el)` 改用 `bindEl(#flow-stage, FLOW_EL_IDS)` 且防双绑。
- **落地方式**：`view.mode === VIEW_FLOW` → `viewStore.mode === VIEW_FLOW`；`api.setViewMode(VIEW_FLOW, true)` → `viewStore.morph(VIEW_FLOW, { shouldFocusInput: true })`；`settings.activeWorkspace.routePath = x` → `settingsStore.updateActiveWorkspace({ routePath: x })`；`attachments.files.push(m)` → `attachmentsStore.addFiles([m])`。
- **后端命令层摊薄（阶段 5，已落地）**：Tauri IPC 命令按领域拆到 `src-tauri/src/commands/`（`file`/`window`/`agent`/`session`/`rollback`/`workspace_cmd`/`skills`/`version`），`lib.rs` 仅保留 `invoke_handler!` 汇总 + `run()` 启动，由 1229 行瘦至 248 行；`config_manager.rs` 拆为 `config_manager/{io,schema,migrate,validate}.rs` 目录（`mod.rs` `pub use` 再导出，调用方 `use` 路径零改动）。原则：命令只做薄封装，业务逻辑留在对应领域模块。
- **函数槽契约定型（阶段 6，已落地）**：`contracts.js` 以 JSDoc `@typedef` 登记全部保留的 ctx 函数槽（按属主模块分组，标注保留原因：①流式/切换热区 ②拦截语义（如 `closeTaskSidebar` 返 boolean 参与 step-back 链）③初始化顺序依赖）；新增槽位必须同步登记。**消亡判据**：槽位删除前先 `grep` 确认零外部调用方；「注册零调用」的幽灵槽直接删注册（函数若模块内仍在用则保留），函数体彻底无引用则连函数一起删。**度量坑**：src 注释严禁出现 `api.<slot>` 字面量（measure-coupling 按原始文本统计），用裸槽名描述。

> **降耦合量化**：阶段 2 已把 `view.*` / `settings.*` / `attachments.*` 裸写清零（93→76，剩余全为 `flow.*`）。阶段 3 拆出 `flow-render.js`（20 模块），src 全量 `api.<slot>` 引用点 299→**270**、唯一槽 84→**71**、调用点 151→**142**、重复注册 0；阶段 3b 落地 `flow-dom.js`（21 模块）；阶段 6 清退 5 个幽灵槽/兼容壳（`setViewMode` 壳 + `ensureActiveTextStep`/`expandThinkingCard`/`getSkillDisplayName`/`saveTurnOutputToDesktop` 幽灵注册），引用点 270→**265**、唯一槽 71→**66**、调用点 142 不变（证实清退槽均零调用），`workspace-changed` 收编为 `bus.emit("ui:workspace-changed")`。阶段 7（GUI 环境收口）批次 A 把 `flow.*` 纯数据 11 字段全部迁 `flowStore.for(taskId)` 分仓（裸写 76→**0**，分仓键经 `resolveStreamTaskId` 解析）、视图派生缓存归位 `flow-state-view.js`（`flowView` sealed）；批次 B 落地 `el-binder.js`，15 模块 `bindAll` 自绑定、`ctx.el` 废除；批次 C/D 纯函数槽显式化 5 个（唯一槽 66→**61**），`pi:view-change`/`pi:step-back` 结论=保留原通道，flow 簇约 40 槽结论=保留（闭包重组型，列阶段 8 候选）。

---

## 📋 重构交付检查清单

- [ ] **语义等价**：功能、RPC 接口与事件响应严格一致；
- [ ] **遗留清理**：历史重构（如抽屉变全屏视图）的废弃方法与变量彻底删除；
- [ ] **编译验证**：`npm run check:fe`、`npm run check` 与 `node -c src/modules/*.js` 均 Exit Code 0；
- [ ] **耦合度量**：降耦合重构前后跑 `npm run measure:coupling`，确认指标“在降”（api 引用 / 唯一槽 / api 调用 / bus emit / 共享状态裸写）；
- [ ] **共享状态属主**：`view.*` / `settings.*` / `attachments.*` 裸写为 **0**（走 Store action）；`flow.*` 纯数据字段归 `flowStore`；
- [ ] **文档对齐**：同步更新 `AGENTS.md`、`README.md` 与相关 Skill。
