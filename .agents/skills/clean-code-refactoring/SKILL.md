---
name: clean-code-refactoring
description: 指导在桌面端（Tauri/Rust）与 Web 前端混合项目中进行逻辑去重、结构精简、样板代码消除与架构轻量化重构。当用户提出"代码精简"、"去冗余"、"重构优化"、"精简结构"、"逻辑优化"、"消除重复代码"时使用。
---

# 桌面端与 Web 混合项目代码精简与重构规范 (Clean Code Refactoring)

本 Skill 用于规范在 **Tauri / Rust + 原生 Web 前端** 混合架构项目中进行**逻辑去冗余、结构精简、样板代码消除与统一复用**的最佳实践。

---

## 🎯 核心原则

1. **DRY (Don't Repeat Yourself)**：重复出现的样板逻辑必须提炼为单一职责的 Helper 或 Bridge；
2. **零运行时副作用**：精简重构必须保持原有对外 API、事件流与业务逻辑 100% 行为一致；
3. **架构演进一致性**：当视图模式重构（如 Drawer ➔ View）时，全域遗留调用必须彻底收敛清理；
4. **编译与自愈闭环**：重构完成后必须自动执行 `cargo check` 与 `npm run build:check` 验证。

---

## 🛠️ 可复用重构设计范式

### 1. 跨进程 IPC 调用统一桥接模式 (Frontend Bridge)

**问题**：前端各 Service 或业务组件各自手写 `window.__TAURI__?.core?.invoke` 的环境检查、参数包装与 try-catch 拦截，样板代码膨胀。

**标准解法**：建立统一的 `tauri-bridge.js`：
```javascript
/**
 * 安全调用 Tauri Invoke 后端指令
 * @param {string} command Tauri 指令名
 * @param {Record<string, any>} [args={}] 传递给后端的参数
 * @returns {Promise<any>}
 */
export async function invokeTauri(command, args = {}) {
  if (window.__TAURI__?.core?.invoke) {
    try {
      return await window.__TAURI__.core.invoke(command, args);
    } catch (err) {
      console.error(`[Tauri IPC] ${command} error:`, err);
      throw err;
    }
  } else {
    console.warn(`[Tauri IPC] Tauri core is not available for command: ${command}`);
    return null;
  }
}
```
各业务 Service 类直接复用：
```javascript
import { invokeTauri } from "./tauri-bridge.js";

class SessionService extends EventTarget {
  async listSessions() {
    return (await invokeTauri("pi_list_sessions")) || [];
  }
}
```

---

### 2. 配置文件统一读写模式 (Rust Generic JSON I/O)

**问题**：Rust 端对多个配置文件（如 `auth.json`、`models.json`、`settings.json`）重复编写目录定位、存在性判断、字符串读取、反序列化、序列化及写入逻辑。

**标准解法**：抽象统一的 `read_agent_json` 和 `write_agent_json`：
```rust
/// 通用安全读取 ~/.pi/agent/ 下的 JSON 配置文件
pub fn read_agent_json(filename: &str, default_val: Value) -> Result<Value, String> {
    let agent_dir = get_pi_agent_dir()?;
    let path = agent_dir.join(filename);
    if !path.exists() {
        return Ok(default_val);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    Ok(serde_json::from_str(&content).unwrap_or(default_val))
}

/// 通用安全写入 ~/.pi/agent/ 下的 JSON 配置文件
pub fn write_agent_json(filename: &str, data: &Value) -> Result<(), String> {
    let agent_dir = get_pi_agent_dir()?;
    let path = agent_dir.join(filename);
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize {}: {}", filename, e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))
}
```
上层指令即可压缩为单行声明：
```rust
#[tauri::command]
pub fn pi_get_auth_config() -> Result<Value, String> {
    read_agent_json("auth.json", json!({}))
}

#[tauri::command]
pub fn pi_save_auth_config(auth_data: Value) -> Result<(), String> {
    write_agent_json("auth.json", &auth_data)
}
```

---

### 3. 多级 JSON Map 安全操作模式 (Rust `entry` API)

**问题**：多级嵌套 JSON（如 `config.providers.provider_id`）中，插入与更新分支大量重复编写对象字段赋值代码。

**标准解法**：使用 `entry` API 统一获取对象引用：
```rust
let providers = ensure_providers_map_mut(&mut custom_config);
let p_obj = providers
    .entry(&provider_key)
    .or_insert_with(|| json!({ "models": [] }))
    .as_object_mut()
    .ok_or_else(|| "Provider entry is not an object".to_string())?;

// 统一写入通用配置，消除 insert/update 重复
p_obj.insert("baseUrl".to_string(), json!(entry.base_url.trim()));
p_obj.insert("api".to_string(), json!(api_type_str));
p_obj.insert("compat".to_string(), compat_val);
```

---

### 4. 流式消息错误提取与分发收口 (Event Stream Error Dispatcher)

**问题**：流式通信（如 `agent_end`、`turn_end`、`message_start`、`message_end`）中，重复解构 `stopReason === "error" || errorMessage` 并分发错误事件。

**标准解法**：在客户端提取单一私有方法 `_dispatchErrorFromMessage`：
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

---

### 5. 系统托盘与窗口操作聚合模式 (Desktop Window Orchestration)

**问题**：托盘右键各菜单、双击事件、单击事件均重复编写窗口查找、取消最小化、展示与聚焦逻辑。

**标准解法**：在 Rust 端提炼单一聚焦函数：
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

- [x] **语义等价**：重构前后所有功能、RPC 接口与事件响应严格一致；
- [x] **遗留清理**：历史重构变更（如抽屉变全屏视图）的命名与调用全域同步；
- [x] **构建验证**：运行 `cargo check` 与 `npm run build:check` 验证 Exit Code 0；
- [x] **文档同步**：同步更新 `AGENTS.md`、`README.md` 与对应 Skill。
