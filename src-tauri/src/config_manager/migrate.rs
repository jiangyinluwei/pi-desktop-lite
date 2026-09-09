use serde_json::{json, Value};
use super::io::{read_pi_dl_json, write_pi_dl_json, read_agent_json, write_agent_json};


/// 新「无痕内置重连」引擎写死的推荐配置 (与前端 DEFAULT_FAILOVER_CONFIG 对齐：10 次 / 2-4-8-16s 恒封顶 16s)
fn model_failover_preset() -> Value {
    json!({
        "maxReconnectAttempts": 10,
        "reconnectBackoffMs": [2000, 4000, 8000, 16000],
        "maxBackoffMs": 16000
    })
}

/// 旧引擎（自动切换模型时代）残留的 modelFailover 死字段
const LEGACY_FAILOVER_KEYS: [&str; 7] = [
    "escalateToSwitchAfterReconnectExhausted",
    "maxSwitchCycles",
    "maxTotalSwitchAttempts",
    "perCandidateReconnectBudget",
    "sameErrorTimeoutMs",
    "switchBackoffMs",
    "switchOnPermanentError",
];

/// modelFailover 配置块迁移：检测旧引擎残留字段或与写死预设不一致的值，
/// 整块归一化为新「无痕内置重连」预设（写死 10 次 / 2-4-8-16s 恒封顶 16s）。
/// 幂等：归一化后再次读取命中预设即跳过。返回是否发生了迁移。
fn migrate_model_failover_block(config: &mut Value) -> bool {
    let Some(obj) = config.as_object_mut() else { return false; };
    let Some(block) = obj.get("modelFailover").and_then(|v| v.as_object()) else { return false; };
    let preset = model_failover_preset();
    let preset_obj = preset.as_object().expect("preset is object");
    let needs_migration = LEGACY_FAILOVER_KEYS.iter().any(|k| block.contains_key(*k))
        || preset_obj
            .iter()
            .any(|(k, v)| block.get(k) != Some(v));
    if !needs_migration {
        return false;
    }
    obj.insert("modelFailover".to_string(), preset);
    true
}

/// 读取 ~/.pi-dl/config.json 应用全局持久化配置
#[tauri::command]
pub fn pi_get_app_config() -> Result<Value, String> {
    let mut config = read_pi_dl_json("config.json", json!({})).unwrap_or_else(|_| json!({}));
    if migrate_model_failover_block(&mut config) {
        log::info!("[config_manager] Migrated legacy modelFailover block to silent-reconnect preset (10 attempts / 2-4-8-16s backoff)");
        if let Err(e) = write_pi_dl_json("config.json", &config) {
            log::warn!("[config_manager] Failed to persist migrated modelFailover block: {}", e);
        }
        // 同步归一化内核 settings.json 的 retry 注入块（历史版本曾用旧引擎值如 24 次注入）
        let _ = pi_apply_model_failover_preset(model_failover_preset());
    }
    Ok(config)
}

/// 写入 ~/.pi-dl/config.json 应用全局持久化配置 (含主题色、默认思考强度、所选模型、模型列表排序等)
///
/// 采用「浅合并」策略：以传入 config_data 为覆盖源，保留 config.json 中未被前端声明的其余字段，
/// 特别是 `workspace` 对象（多预设工作区 activeId / code-area 路由目标与历史记录）。
/// 该对象由 workspace 模块通过 write_active_workspace_id / write_code_area_route_path 单独维护，
/// 前端 saveAppConfig 并不感知它。若此处直接整文件覆盖，会在「切换模型 / 改思考等级」等保存时机
/// 清空 workspace 字段，导致运行中工作区被重置回 default-area、code-area 路由目标丢失、需重新填写。
#[tauri::command]
pub fn pi_save_app_config(config_data: Value) -> Result<(), String> {
    // 非对象入参：保持旧行为，按原样写入（防御性兜底）
    if !config_data.is_object() {
        return write_pi_dl_json("config.json", &config_data);
    }

    // 读取现有 config.json，仅当其为对象时才合并，否则从空对象开始
    let mut merged = read_pi_dl_json("config.json", json!({})).unwrap_or_else(|_| json!({}));
    if !merged.is_object() {
        merged = json!({});
    }

    if let (Some(existing), Some(incoming)) = (merged.as_object_mut(), config_data.as_object()) {
        for (k, v) in incoming {
            existing.insert(k.clone(), v.clone());
        }
    }

    write_pi_dl_json("config.json", &merged)
}

/// 检查用户是否配置了“不再提醒更新”（若为 true 则直接跳过启动自检与后台自动轮询）
pub fn is_update_notification_ignored() -> bool {
    if let Ok(config) = read_pi_dl_json("config.json", json!({})) {
        if let Some(ignored) = config.get("ignoreUpdateNotification").and_then(|v| v.as_bool()) {
            return ignored;
        }
    }
    false
}

/// 从 ~/.pi-dl/config.json 预读持久化选中的模型与思考等级
pub fn get_saved_model_and_thinking() -> (Option<(String, String)>, Option<String>) {
    if let Ok(config) = read_pi_dl_json("config.json", json!({})) {
        let model = config.get("selectedModel").and_then(|selected| {
            let provider = selected.get("provider").and_then(|v| v.as_str());
            let model_id = selected
                .get("modelId")
                .or_else(|| selected.get("id"))
                .or_else(|| selected.get("name"))
                .and_then(|v| v.as_str());
            if let (Some(p), Some(m)) = (provider, model_id) {
                if !p.trim().is_empty() && !m.trim().is_empty() {
                    return Some((p.to_string(), m.to_string()));
                }
            }
            None
        });
        let thinking = config
            .get("defaultThinkingLevel")
            .and_then(|v| v.as_str())
            .filter(|lvl| !lvl.trim().is_empty())
            .map(|lvl| lvl.to_string());
        (model, thinking)
    } else {
        (None, None)
    }
}

/// 读取 settings.json
#[tauri::command]
pub fn pi_get_settings_config() -> Result<Value, String> {
    read_agent_json("settings.json", json!({}))
}

/// 写入 settings.json
///
/// 采用「读-合并-写回」语义：将传入字段浅合并进现有 settings.json 后写回，
/// 绝不整体覆盖。前端（如保存思考深度）可能只传入部分字段，若整体替换会
/// 丢失 packages / theme / lastChangelogVersion / retry 等其余关键配置，
/// 从而导致已安装组件在设置页不再显示。合并写回可保证未提及的键全部保留。
#[tauri::command]
pub fn pi_save_settings_config(settings_data: Value) -> Result<(), String> {
    let mut current = read_agent_json("settings.json", json!({})).unwrap_or_else(|_| json!({}));
    if !current.is_object() {
        current = json!({});
    }
    if let Some(cur_obj) = current.as_object_mut() {
        if let Some(in_obj) = settings_data.as_object() {
            for (k, v) in in_obj {
                cur_obj.insert(k.clone(), v.clone());
            }
        }
    }
    write_agent_json("settings.json", &current)
}

/// 向 Pi 内核 ~/.pi/agent/settings.json 探测式注入模型自动重连推荐配置 (best-effort, 失败静默)
///
/// 轨道 A (内核参数注入)：若内核识别重试键则让其自身按推荐值 (10 次 / 2-4-8-16s 退避) 重连；
/// 轨道 B (桌面 ModelFailoverEngine) 为行为主实现，无论本指令是否生效均能保证「恰好 10 次」语义。
/// 本指令对未知 schema 安全跳过、绝不报错，绝不阻断引擎内置重连流水线。
#[tauri::command]
pub fn pi_apply_model_failover_preset(config: Value) -> Result<(), String> {
    let max_attempts = config
        .get("maxReconnectAttempts")
        .and_then(|v| v.as_u64())
        .unwrap_or(10);

    // 退避序列 (ms) 转为秒级数组供内核使用，并封顶 maxBackoffMs
    let backoff_secs: Vec<Value> = config
        .get("reconnectBackoffMs")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|ms| {
                    let s = ms.as_u64().unwrap_or(2000) / 1000;
                    Value::from(s.max(1))
                })
                .collect()
        })
        .unwrap_or_else(|| vec![Value::from(2u64), Value::from(4u64), Value::from(8u64), Value::from(16u64)]);

    let max_backoff_secs = config
        .get("maxBackoffMs")
        .and_then(|v| v.as_u64())
        .map(|ms| (ms / 1000).max(1))
        .unwrap_or(16);

    let mut settings = pi_get_settings_config().unwrap_or_else(|_| json!({}));
    if !settings.is_object() {
        settings = json!({});
    }

    let retry_block = json!({
        "maxAttempts": max_attempts,
        "backoff": backoff_secs,
        "maxBackoffSeconds": max_backoff_secs
    });

    if let Some(obj) = settings.as_object_mut() {
        // 仅当内核 settings.json 未显式声明禁用重试时注入推荐值；
        // 已存在「完整三键形态」(maxAttempts/backoff/maxBackoffSeconds) 的 retry 块视为本指令
        // 历史注入产物（含旧引擎残留值如 24 次），允许覆盖刷新为归一化预设；
        // 仅部分字段的自定义 retry 配置则尊重原值不覆盖，避免破坏用户刻意调优。
        let has_user_retry = obj
            .get("retry")
            .map(|r| r.is_object())
            .unwrap_or(false);
        let is_our_preset_block = obj
            .get("retry")
            .and_then(|r| r.as_object())
            .map(|r| {
                r.contains_key("maxAttempts")
                    && r.contains_key("backoff")
                    && r.contains_key("maxBackoffSeconds")
            })
            .unwrap_or(false);
        if !has_user_retry || is_our_preset_block {
            obj.insert("retry".to_string(), retry_block);
        }
    }

    // 写回为 best-effort：失败仅记录日志，返回 Ok 绝不阻断前端引擎
    if let Err(e) = pi_save_settings_config(settings) {
        log::warn!("[config_manager] Failed to apply model failover preset: {}", e);
    }
    Ok(())
}

/// 检查 settings.json 中是否安装或启用了 pi-subagents 扩展
pub fn is_pi_subagents_enabled(settings: &Value) -> bool {
    if let Some(packages) = settings.get("packages").and_then(|p| p.as_array()) {
        for item in packages {
            let pkg_str = if let Some(s) = item.as_str() {
                s
            } else if let Some(s) = item.get("source").and_then(|v| v.as_str()) {
                s
            } else {
                ""
            };
            let lower = pkg_str.to_lowercase();
            if lower == "pi-subagents"
                || lower == "npm:pi-subagents"
                || lower.starts_with("npm:pi-subagents@")
                || lower.ends_with("/pi-subagents")
                || lower.contains("pi-subagents")
            {
                return true;
            }
        }
    }
    false
}

/// 若启用了 pi-subagents 组件，则自动将子代理默认模型及常用角色（oracle, worker, reviewer, researcher, planner, scout 等）
/// 钉住为当前主模型，写回 ~/.pi/agent/settings.json (保留所有其他配置)
pub fn sync_subagent_pinned_model_if_enabled(model_id: &str) -> Result<bool, String> {
    let clean_model = model_id.trim();
    if clean_model.is_empty() {
        return Ok(false);
    }

    let mut settings = pi_get_settings_config().unwrap_or_else(|_| json!({}));
    if !settings.is_object() {
        settings = json!({});
    }

    if !is_pi_subagents_enabled(&settings) {
        log::debug!("[SubagentsSync] pi-subagents not enabled in settings.json, skip pinning.");
        return Ok(false);
    }

    let roles = ["oracle", "worker", "reviewer", "researcher", "planner", "scout"];

    if let Some(obj) = settings.as_object_mut() {
        let mut subagents_obj = match obj.get("subagents").and_then(|v| v.as_object()).cloned() {
            Some(map) => map,
            None => serde_json::Map::new(),
        };

        // 1. 设置默认子代理模型
        subagents_obj.insert("defaultModel".to_string(), json!(clean_model));

        // 2. 钉住各主要角色的 overrides
        let mut overrides_obj = match subagents_obj.get("agentOverrides").and_then(|v| v.as_object()).cloned() {
            Some(map) => map,
            None => serde_json::Map::new(),
        };

        for role in roles {
            let mut role_map = match overrides_obj.get(role).and_then(|v| v.as_object()).cloned() {
                Some(map) => map,
                None => serde_json::Map::new(),
            };
            role_map.insert("model".to_string(), json!(clean_model));
            overrides_obj.insert(role.to_string(), Value::Object(role_map));
        }

        subagents_obj.insert("agentOverrides".to_string(), Value::Object(overrides_obj));
        obj.insert("subagents".to_string(), Value::Object(subagents_obj));
    }

    if let Err(e) = pi_save_settings_config(settings) {
        log::warn!("[SubagentsSync] Failed to write pinned subagents model to settings.json: {}", e);
        return Err(e);
    }

    log::info!("[SubagentsSync] Pinned pi-subagents model to `{}` in ~/.pi/agent/settings.json", clean_model);
    Ok(true)
}

/// 前端/IPC 调用的子代理模型同步钉住指令
#[tauri::command]
pub fn pi_sync_subagent_pinned_model(model_id: String) -> Result<bool, String> {
    sync_subagent_pinned_model_if_enabled(&model_id)
}
