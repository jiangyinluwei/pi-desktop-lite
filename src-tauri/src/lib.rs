pub mod config_manager;
pub mod package_manager;
pub mod pi_runner;
pub mod security;
pub mod session;
pub mod version_watcher;

use config_manager::{
    pi_add_custom_model, pi_add_custom_provider_model, pi_apply_model_failover_preset,
    pi_delete_custom_model, pi_delete_custom_provider, pi_fetch_official_models,
    pi_get_app_config, pi_get_auth_config, pi_get_custom_models, pi_get_official_models_catalog,
    pi_get_settings_config, pi_save_app_config, pi_save_auth_config, pi_save_custom_models,
    pi_save_custom_provider, pi_save_provider_api_key, pi_save_settings_config,
};
use package_manager::{
    pi_apply_package_preset, pi_check_package_updates, pi_get_installed_packages,
    pi_get_recommended_plugins, pi_install_package, pi_search_packages, pi_uninstall_package,
    pi_update_package,
};
use pi_runner::{FollowUpRequest, HostStatus, PiHostPool, PiSupervisor, PromptRequest, SteerRequest};
use session::{parse_session_entries, SessionEntrySummary, SessionIndexCache, SessionMetadata, SessionWatcher};
use std::path::Path;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};
use version_watcher::{pi_cancel_kernel_update, pi_update_kernel, VersionCheckResult, VersionScheduler};

// ==========================================================================
// 窗口控制指令
// ==========================================================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileInspectionResult {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub category: String, // "image", "document", "code", "other"
    pub is_text: bool,
}

#[tauri::command]
fn pi_inspect_file(path: String) -> Result<FileInspectionResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let size = meta.len();

    let image_exts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tiff", "avif"];
    let doc_exts = ["doc", "docx", "pdf", "txt", "md", "markdown", "csv", "xlsx", "xls", "ppt", "pptx", "rtf"];
    let code_exts = ["js", "jsx", "ts", "tsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp", "html", "css", "json", "yaml", "yml", "toml", "xml", "sql", "sh", "bash", "ps1", "bat", "env"];

    let (category, is_text) = if image_exts.contains(&ext.as_str()) {
        ("image".to_string(), ext == "svg")
    } else if doc_exts.contains(&ext.as_str()) {
        let is_plain = ["txt", "md", "markdown", "csv", "rtf"].contains(&ext.as_str());
        ("document".to_string(), is_plain)
    } else if code_exts.contains(&ext.as_str()) {
        ("code".to_string(), true)
    } else {
        ("other".to_string(), false)
    };

    Ok(FileInspectionResult {
        path,
        name,
        ext,
        size,
        category,
        is_text,
    })
}

#[tauri::command]
fn pi_read_file_text_preview(path: String, max_chars: Option<usize>) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    let limit = max_chars.unwrap_or(30000);
    let content = std::fs::read_to_string(p).map_err(|e| format!("无法读取文件文本内容 (可能是二进制文件): {}", e))?;
    if content.chars().count() > limit {
        let truncated: String = content.chars().take(limit).collect();
        Ok(format!("{}\n\n[...内容过长，已截断显示前 {} 字...]", truncated, limit))
    } else {
        Ok(content)
    }
}

fn bytes_to_base64(bytes: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(CHARSET[(b0 >> 2) as usize] as char);
        out.push(CHARSET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARSET[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[tauri::command]
fn pi_prepare_image_payload(path: String) -> Result<serde_json::Value, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("图片文件不存在: {}", path));
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
    let mime_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "image/png",
    };
    let b64 = bytes_to_base64(&bytes);
    Ok(serde_json::json!({
        "type": "image",
        "mimeType": mime_type,
        "data": b64,
        "path": path,
    }))
}

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
// Windows 系统通知指令 (基于系统 Toast 与原生提示音，自动绑定 pi-dl AUMID 与应用 Logo)
// ==========================================================================

#[cfg(windows)]
pub fn init_windows_notification_identity() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let aumid = "com.pidl.desktop";

    // 1. 设置当前进程的显式 AUMID
    unsafe {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = OsStr::new(aumid).encode_wide().chain(std::iter::once(0)).collect();
        let _ = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(wide.as_ptr());
    }

    // 2. 提取并持久化应用高清 Logo 图标至 ~/.pi-dl/icons/app-logo.png
    if let Some(user_dirs) = dirs::home_dir() {
        let icon_dir = user_dirs.join(".pi-dl").join("icons");
        let _ = std::fs::create_dir_all(&icon_dir);
        let target_icon = icon_dir.join("app-logo.png");

        // 编译期内嵌 128x128 高清手绘 Logo
        let icon_bytes = include_bytes!("../icons/128x128.png");
        let _ = std::fs::write(&target_icon, icon_bytes);

        // 3. 在 HKCU\Software\Classes\AppUserModelId\com.pidl.desktop 注册 DisplayName 与 IconUri
        // 彻底解决在开发环境 (npm run dev / cargo run) 下 Toast 顶部显示 "Windows PowerShell" 的问题
        let reg_key = format!("HKCU\\Software\\Classes\\AppUserModelId\\{}", aumid);
        let icon_path_str = target_icon.to_string_lossy().to_string();

        let mut cmd_name = std::process::Command::new("reg");
        cmd_name.args(["add", &reg_key, "/v", "DisplayName", "/d", "pi-dl", "/f"]);
        cmd_name.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd_name.output();

        let mut cmd_icon = std::process::Command::new("reg");
        cmd_icon.args(["add", &reg_key, "/v", "IconUri", "/d", &icon_path_str, "/f"]);
        cmd_icon.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd_icon.output();
    }
}

#[tauri::command]
fn pi_show_notification(_app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    // 双重焦点防护铁律：若主窗口当前处于操作系统聚焦/前台激活状态，直接拦截丢弃，绝不打扰用户
    if let Some(window) = _app.get_webview_window("main") {
        if let Ok(true) = window.is_focused() {
            log::debug!("[Notification] Main window is currently focused, suppressing notification");
            return Ok(());
        }
    }

    #[cfg(windows)]
    {
        use tauri_winrt_notification::{Toast, Sound};
        let aumid = "com.pidl.desktop";

        let mut toast = Toast::new(aumid);
        toast = toast.title(&title);
        toast = toast.text1(&body);
        toast = toast.sound(Some(Sound::Default));

        let app_handle_clone = _app.clone();
        toast = toast.on_activated(move |_action| {
            show_and_focus_main_window(&app_handle_clone);
            if let Some(window) = app_handle_clone.get_webview_window("main") {
                let _ = window.emit("notification-clicked", ());
            }
            Ok(())
        });

        toast.show().map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        _app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| e.to_string())
    }
}

// ==========================================================================
// Pi Agent 核心 RPC 与监督控制指令
// ==========================================================================

#[tauri::command]
async fn pi_send_prompt(
    host_pool: State<'_, PiHostPool>,
    request: PromptRequest,
) -> Result<String, String> {
    host_pool.send_prompt(request).await
}

#[tauri::command]
async fn pi_send_steer(
    host_pool: State<'_, PiHostPool>,
    request: SteerRequest,
) -> Result<(), String> {
    host_pool.send_steer(request).await
}

#[tauri::command]
async fn pi_send_follow_up(
    host_pool: State<'_, PiHostPool>,
    request: FollowUpRequest,
) -> Result<(), String> {
    host_pool.send_follow_up(request).await
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
async fn pi_abort(
    host_pool: State<'_, PiHostPool>,
    task_id: Option<String>,
) -> Result<(), String> {
    host_pool.abort_task(task_id).await
}

#[tauri::command]
async fn pi_destroy_task(
    host_pool: State<'_, PiHostPool>,
    task_id: String,
) -> Result<(), String> {
    host_pool.destroy_task(&task_id).await
}

#[tauri::command]
async fn pi_get_active_tasks(
    host_pool: State<'_, PiHostPool>,
) -> Result<Vec<String>, String> {
    Ok(host_pool.get_active_task_ids().await)
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
    host_pool: State<'_, PiHostPool>,
    provider: String,
    model_id: String,
) -> Result<serde_json::Value, String> {
    host_pool.set_active_model(provider.clone(), model_id.clone()).await;
    supervisor.set_model(&provider, &model_id).await
}

#[tauri::command]
async fn pi_set_thinking_level(
    supervisor: State<'_, PiSupervisor>,
    host_pool: State<'_, PiHostPool>,
    level: String,
) -> Result<(), String> {
    host_pool.set_active_thinking_level(level.clone()).await;
    supervisor.set_thinking_level(&level).await
}

#[tauri::command]
async fn pi_get_workspace(supervisor: State<'_, PiSupervisor>) -> Result<String, String> {
    Ok(supervisor.get_workspace().await.to_string_lossy().to_string())
}

#[tauri::command]
async fn pi_set_workspace(
    supervisor: State<'_, PiSupervisor>,
    workspace_path: String,
) -> Result<(), String> {
    let p = std::path::PathBuf::from(workspace_path);
    supervisor.set_workspace(p).await;
    Ok(())
}

// ==========================================================================
// 会话索引与树状历史指令
// ==========================================================================

#[tauri::command]
fn pi_list_sessions(session_cache: State<'_, SessionIndexCache>) -> Result<Vec<SessionMetadata>, String> {
    Ok(session_cache.list_all())
}

#[tauri::command]
fn pi_get_prompt_history(session_cache: State<'_, SessionIndexCache>) -> Result<Vec<String>, String> {
    let sessions = session_cache.list_all();
    let mut all_prompts = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 会话列表按修改时间倒序排列，逆序遍历以获得从旧到新的历史提问栈
    for s in sessions.iter().rev() {
        let p = Path::new(&s.file_path);
        let prompts = crate::session::extract_user_prompts_from_session(p);
        for prompt in prompts {
            if !prompt.is_empty() && seen.insert(prompt.clone()) {
                all_prompts.push(prompt);
            }
        }
    }
    Ok(all_prompts)
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
        .unwrap_or_else(|| crate::version_watcher::checker::FALLBACK_PI_VERSION.to_string());
    Ok(scheduler.check_now(&current_ver).await)
}

#[tauri::command]
async fn pi_get_cached_update(
    scheduler: State<'_, Arc<VersionScheduler>>,
) -> Result<Option<VersionCheckResult>, String> {
    Ok(scheduler.get_cached_result().await)
}

fn show_and_focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("app-awakened", ());
    }
}

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
            pi_abort,
            pi_destroy_task,
            pi_get_active_tasks,
            pi_restart_host,
            pi_get_host_status,
            pi_get_version,
            pi_get_state,
            pi_get_available_models,
            pi_set_model,
            pi_set_thinking_level,
            pi_get_workspace,
            pi_set_workspace,
            pi_list_sessions,
            pi_get_prompt_history,
            pi_get_session_tree,
            pi_switch_session,
            pi_new_session,
            pi_get_inner_skills_rules,
            pi_get_skill_mappings,
            pi_resolve_tool_skill,
            pi_check_update,
            pi_get_cached_update,
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
            pi_get_app_config,
            pi_save_app_config,
            pi_get_official_models_catalog,
            pi_fetch_official_models,
            pi_get_recommended_plugins,
            pi_search_packages,
            pi_get_installed_packages,
            pi_install_package,
            pi_uninstall_package,
            pi_check_package_updates,
            pi_update_package,
            pi_apply_package_preset,
            pi_inspect_file,
            pi_read_file_text_preview,
            pi_prepare_image_payload,
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
