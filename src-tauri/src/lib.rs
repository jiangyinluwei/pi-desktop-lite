pub mod commands;
pub mod config_manager;
pub mod package_manager;
pub mod pi_runner;
pub mod rollback;
pub mod security;
pub mod session;
pub mod version_watcher;
pub mod workspace;

use commands::*;
use config_manager::{
    pi_add_custom_model, pi_add_custom_provider_model, pi_apply_model_failover_preset,
    pi_delete_custom_model, pi_delete_custom_provider, pi_fetch_custom_provider_models,
    pi_fetch_official_models, pi_get_app_config, pi_get_auth_config, pi_get_custom_models,
    pi_get_official_models_catalog, pi_get_settings_config, pi_save_app_config,
    pi_save_auth_config, pi_save_custom_models, pi_save_custom_provider,
    pi_save_provider_api_key, pi_save_settings_config, pi_sync_subagent_pinned_model,
};
use package_manager::{
    pi_apply_package_preset, pi_check_node_environment, pi_check_package_updates,
    pi_get_installed_packages, pi_get_recommended_plugins, pi_install_package,
    pi_search_packages, pi_uninstall_package, pi_update_package,
};
use pi_runner::{PiHostPool, PiSupervisor};
use session::{SessionIndexCache, SessionWatcher};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use version_watcher::{pi_cancel_kernel_update, pi_update_kernel, VersionScheduler};

// ==========================================================================
// 主启动入口
// ==========================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_and_focus_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize_window,
            close_window,
            pi_show_notification,
            pi_send_prompt,
            pi_send_steer,
            pi_send_follow_up,
            pi_send_command,
            pi_get_fork_messages,
            pi_fork_session,
            pi_rollback_files,
            pi_abort,
            pi_destroy_task,
            pi_get_active_tasks,
            pi_restart_host,
            pi_get_host_status,
            pi_get_version,
            pi_has_kernel,
            pi_get_state,
            pi_get_available_models,
            pi_set_model,
            pi_set_thinking_level,
            pi_get_workspace,
            pi_set_workspace,
            pi_list_workspaces,
            pi_get_active_workspace,
            pi_set_active_workspace,
            pi_select_folder,
            pi_get_code_area_route,
            pi_set_code_area_route,
            pi_list_code_area_skills,
            pi_list_sessions,
            pi_refresh_sessions,
            pi_get_prompt_history,
            pi_get_session_tree,
            pi_get_session_detail,
            pi_switch_session,
            pi_new_session,
            pi_get_inner_skills_rules,
            pi_get_skill_mappings,
            pi_resolve_tool_skill,
            pi_check_update,
            pi_get_cached_update,
            pi_open_url,
            pi_update_kernel,
            pi_cancel_kernel_update,
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
            pi_apply_model_failover_preset,
            pi_sync_subagent_pinned_model,
            pi_get_app_config,
            pi_save_app_config,
            pi_get_official_models_catalog,
            pi_fetch_official_models,
            pi_fetch_custom_provider_models,
            pi_get_recommended_plugins,
            pi_check_node_environment,
            pi_search_packages,
            pi_get_installed_packages,
            pi_install_package,
            pi_uninstall_package,
            pi_check_package_updates,
            pi_update_package,
            pi_apply_package_preset,
            pi_inspect_paths,
            pi_inspect_file,
            pi_read_file_text_preview,
            pi_prepare_image_payload,
            pi_save_markdown_to_desktop,
            pi_reveal_path,
            pi_path_exists,
            pi_get_home_dir,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            }

            // 0. 初始化 Windows 通知身份（注册 AUMID 与 Logo 图标，消除 PowerShell 标题）
            #[cfg(windows)]
            init_windows_notification_identity();

            // 1. 初始化 Pi Supervisor 与 PiHostPool 多进程任务池
            let supervisor = PiSupervisor::new(app.handle().clone());
            let supervisor_arc = Arc::new(supervisor.clone());
            let host_pool = PiHostPool::new(app.handle().clone(), supervisor_arc.clone());
            app.manage(supervisor.clone());
            app.manage(host_pool);

            // 2. 初始化 Session Cache 与 Watcher（注入全局状态，防止 setup 返回后被 RAII 析构）
            let session_cache = SessionIndexCache::new();
            let session_watcher = Arc::new(SessionWatcher::new(app.handle().clone(), session_cache.clone()));
            app.manage(session_cache);
            app.manage(session_watcher);

            // 2b. 物化会话回退快照守卫扩展至全局扩展目录（幂等，内容变更时覆盖）
            if let Err(e) = rollback::materialize_extension() {
                log::warn!("[Setup] Failed to materialize rollback extension: {}", e);
            }

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
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(focused) => {
                let _ = window.emit("window-focus-change", *focused);
            }
            WindowEvent::DragDrop(drag_event) => {
                match drag_event {
                    tauri::DragDropEvent::Drop { paths, position: _ } => {
                        let file_paths: Vec<String> =
                            paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
                        let _ = window.emit("file-drop-paths", file_paths);
                    }
                    tauri::DragDropEvent::Enter { .. } => {
                        let _ = window.emit("file-drag-enter", ());
                    }
                    tauri::DragDropEvent::Leave => {
                        let _ = window.emit("file-drag-leave", ());
                    }
                    _ => {}
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
