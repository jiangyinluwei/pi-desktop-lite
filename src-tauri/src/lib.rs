pub mod config_manager;
pub mod package_manager;
pub mod pi_runner;
pub mod security;
pub mod session;
pub mod version_watcher;

use config_manager::{
    pi_add_custom_model, pi_add_custom_provider_model, pi_delete_custom_model,
    pi_delete_custom_provider, pi_get_app_config, pi_get_auth_config, pi_get_custom_models,
    pi_get_official_models_catalog, pi_get_settings_config, pi_save_app_config,
    pi_save_auth_config, pi_save_custom_models, pi_save_custom_provider,
    pi_save_provider_api_key, pi_save_settings_config,
};
use package_manager::{
    pi_check_package_updates, pi_get_installed_packages, pi_install_package, pi_search_packages,
    pi_uninstall_package, pi_update_package,
};
use pi_runner::{FollowUpRequest, HostStatus, PiSupervisor, PromptRequest, SteerRequest};
use session::{parse_session_entries, SessionEntrySummary, SessionIndexCache, SessionMetadata, SessionWatcher};
use std::path::Path;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};
use version_watcher::{VersionCheckResult, VersionScheduler};

// ==========================================================================
// 窗口控制指令
// ==========================================================================

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::WebviewWindow) {
    if let Ok(is_maximized) = window.is_maximized() {
        if is_maximized {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) {
    // 隐藏窗口保持后台运行，托盘图标保留
    let _ = window.hide();
}

// ==========================================================================
// Pi Agent 核心 RPC 与监督控制指令
// ==========================================================================

#[tauri::command]
async fn pi_send_prompt(
    supervisor: State<'_, PiSupervisor>,
    request: PromptRequest,
) -> Result<(), String> {
    let (processed_message, _info) = supervisor.inject_prompt(&request.message);
    let mut val = serde_json::json!({
        "type": "prompt",
        "message": processed_message,
    });

    if let Some(imgs) = request.images {
        val["images"] = serde_json::Value::Array(imgs);
    }
    if let Some(sb) = request.streaming_behavior {
        val["streamingBehavior"] = serde_json::Value::String(sb);
    }

    supervisor.send_command(val).await
}

#[tauri::command]
async fn pi_send_steer(
    supervisor: State<'_, PiSupervisor>,
    request: SteerRequest,
) -> Result<(), String> {
    let val = serde_json::json!({
        "type": "steer",
        "message": request.message,
    });
    supervisor.send_command(val).await
}

#[tauri::command]
async fn pi_send_follow_up(
    supervisor: State<'_, PiSupervisor>,
    request: FollowUpRequest,
) -> Result<(), String> {
    let (processed_message, _info) = supervisor.inject_prompt(&request.message);
    let val = serde_json::json!({
        "type": "follow_up",
        "message": processed_message,
    });
    supervisor.send_command(val).await
}

#[tauri::command]
fn pi_get_inner_skills_rules(supervisor: State<'_, PiSupervisor>) -> Result<String, String> {
    Ok(supervisor.get_skill_rules().to_string())
}

#[tauri::command]
fn pi_get_skill_mappings(
    supervisor: State<'_, PiSupervisor>,
) -> Result<Vec<pi_runner::SkillMapping>, String> {
    Ok(supervisor.get_skill_mappings())
}

#[tauri::command]
fn pi_resolve_tool_skill(
    supervisor: State<'_, PiSupervisor>,
    tool_name: String,
) -> Result<Option<String>, String> {
    Ok(supervisor.resolve_skill_for_tool(&tool_name))
}

#[tauri::command]
async fn pi_send_command(
    supervisor: State<'_, PiSupervisor>,
    command: serde_json::Value,
) -> Result<(), String> {
    supervisor.send_command(command).await
}

#[tauri::command]
async fn pi_abort(supervisor: State<'_, PiSupervisor>) -> Result<(), String> {
    supervisor.abort().await
}

#[tauri::command]
async fn pi_restart_host(supervisor: State<'_, PiSupervisor>) -> Result<(), String> {
    supervisor.restart().await
}

#[tauri::command]
async fn pi_get_host_status(supervisor: State<'_, PiSupervisor>) -> Result<HostStatus, String> {
    Ok(supervisor.get_status().await)
}

#[tauri::command]
async fn pi_get_version(supervisor: State<'_, PiSupervisor>) -> Result<Option<String>, String> {
    Ok(supervisor.get_version().await)
}

#[tauri::command]
async fn pi_get_state(supervisor: State<'_, PiSupervisor>) -> Result<serde_json::Value, String> {
    supervisor.get_session_state().await
}

#[tauri::command]
async fn pi_get_available_models(
    supervisor: State<'_, PiSupervisor>,
) -> Result<serde_json::Value, String> {
    supervisor.get_available_models().await
}

#[tauri::command]
async fn pi_set_model(
    supervisor: State<'_, PiSupervisor>,
    provider: String,
    model_id: String,
) -> Result<serde_json::Value, String> {
    supervisor.set_model(&provider, &model_id).await
}

#[tauri::command]
async fn pi_set_thinking_level(
    supervisor: State<'_, PiSupervisor>,
    level: String,
) -> Result<(), String> {
    supervisor.set_thinking_level(&level).await
}

// ==========================================================================
// 会话索引与树状历史指令
// ==========================================================================

#[tauri::command]
fn pi_list_sessions(session_cache: State<'_, SessionIndexCache>) -> Result<Vec<SessionMetadata>, String> {
    Ok(session_cache.list_all())
}

#[tauri::command]
fn pi_get_session_tree(session_path: String) -> Result<Vec<SessionEntrySummary>, String> {
    let path = Path::new(&session_path);
    parse_session_entries(path)
}

#[tauri::command]
async fn pi_switch_session(
    supervisor: State<'_, PiSupervisor>,
    session_path: String,
) -> Result<(), String> {
    supervisor.reset_skill_turns();
    let val = serde_json::json!({
        "type": "switch_session",
        "sessionPath": session_path
    });
    supervisor.send_command(val).await
}

#[tauri::command]
async fn pi_new_session(
    supervisor: State<'_, PiSupervisor>,
    parent_session: Option<String>,
) -> Result<(), String> {
    supervisor.reset_skill_turns();
    let mut val = serde_json::json!({
        "type": "new_session"
    });
    if let Some(p) = parent_session {
        val["parentSession"] = serde_json::Value::String(p);
    }
    supervisor.send_command(val).await
}

// ==========================================================================
// 版本监测指令
// ==========================================================================

#[tauri::command]
async fn pi_check_update(
    supervisor: State<'_, PiSupervisor>,
    scheduler: State<'_, Arc<VersionScheduler>>,
) -> Result<VersionCheckResult, String> {
    let current_ver = supervisor
        .get_version()
        .await
        .unwrap_or_else(|| "0.84.3".to_string());
    Ok(scheduler.check_now(&current_ver).await)
}

#[tauri::command]
async fn pi_get_cached_update(
    scheduler: State<'_, Arc<VersionScheduler>>,
) -> Result<Option<VersionCheckResult>, String> {
    Ok(scheduler.get_cached_result().await)
}

// ==========================================================================
// 主启动入口
// ==========================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize_window,
            close_window,
            pi_send_prompt,
            pi_send_steer,
            pi_send_follow_up,
            pi_send_command,
            pi_abort,
            pi_restart_host,
            pi_get_host_status,
            pi_get_version,
            pi_get_state,
            pi_get_available_models,
            pi_set_model,
            pi_set_thinking_level,
            pi_list_sessions,
            pi_get_session_tree,
            pi_switch_session,
            pi_new_session,
            pi_get_inner_skills_rules,
            pi_get_skill_mappings,
            pi_resolve_tool_skill,
            pi_check_update,
            pi_get_cached_update,
            pi_get_auth_config,
            pi_save_auth_config,
            pi_save_provider_api_key,
            pi_get_custom_models,
            pi_save_custom_models,
            pi_add_custom_model,
            pi_delete_custom_model,
            pi_save_custom_provider,
            pi_delete_custom_provider,
            pi_add_custom_provider_model,
            pi_get_settings_config,
            pi_save_settings_config,
            pi_get_app_config,
            pi_save_app_config,
            pi_get_official_models_catalog,
            pi_search_packages,
            pi_get_installed_packages,
            pi_install_package,
            pi_uninstall_package,
            pi_check_package_updates,
            pi_update_package,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            }

            // 1. 初始化 Pi Supervisor
            let supervisor = PiSupervisor::new(app.handle().clone());
            app.manage(supervisor.clone());

            // 2. 初始化 Session Cache 与 Watcher
            let session_cache = SessionIndexCache::new();
            let _session_watcher = SessionWatcher::new(app.handle().clone(), session_cache.clone());
            app.manage(session_cache);

            // 3. 初始化 Version Scheduler
            let version_scheduler = Arc::new(VersionScheduler::new(app.handle().clone()));
            app.manage(version_scheduler.clone());

            // 启动版本检测后台轮询
            version_scheduler.start_background_loop(supervisor.clone());

            // 4. 异步拉起 Pi Agent 宿主进程
            let supervisor_clone = supervisor.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = supervisor_clone.start().await {
                    log::error!("[Setup] Failed to auto-start Pi host: {}", e);
                }
            });

            // 5. 构建系统托盘右键菜单：打开、设置、退出
            let open_item = MenuItem::with_id(app, "open", "打开", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &settings_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("Failed to get default window icon");

fn show_and_focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("pi-dl")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        show_and_focus_main_window(app);
                    }
                    "settings" => {
                        show_and_focus_main_window(app);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("navigate-settings", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    }
                    | TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        show_and_focus_main_window(tray.app_handle());
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
