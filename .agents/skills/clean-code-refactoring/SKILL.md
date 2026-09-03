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
3. **闭环验证**：重构完成后自动执行 `node -c` 与 `npm run check` 验证。

---

## 🛠️ 5 大标准重构设计范式

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

---

## 📋 重构交付检查清单

- [ ] **语义等价**：功能、RPC 接口与事件响应严格一致；
- [ ] **遗留清理**：历史重构（如抽屉变全屏视图）的废弃方法与变量彻底删除；
- [ ] **编译验证**：`npm run check` 与 `node -c src/modules/*.js` 均 Exit Code 0；
- [ ] **文档对齐**：同步更新 `AGENTS.md` 与相关 Skill。
