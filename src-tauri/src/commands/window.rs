//! `commands/window` — 窗口控制与 Windows 系统通知。

use super::show_and_focus_main_window;
use tauri::{Emitter, Manager};

/// 最小化主窗口
#[tauri::command]
pub fn minimize_window(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

/// 切换主窗口最大/还原态
#[tauri::command]
pub fn toggle_maximize_window(window: tauri::WebviewWindow) {
    if let Ok(is_maximized) = window.is_maximized() {
        if is_maximized {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

/// 关闭主窗口：隐藏窗口保持后台运行，托盘图标保留
#[tauri::command]
pub fn close_window(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

/// 初始化 Windows 通知身份（注册 AUMID 与 Logo 图标，消除开发环境下 PowerShell 标题）。
/// 非命令，由 `lib.rs` 的 `run()` setup 调起。
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
        let icon_bytes = include_bytes!("../../icons/128x128.png");
        let _ = std::fs::write(&target_icon, icon_bytes);

        // 3. 在 HKCU\Software\Classes\AppUserModelId\com.pidl.desktop 注册 DisplayName 与 IconUri
        // 彻底解决在开发环境 (npm run dev / cargo run) 下 Toast 顶部显示 "Windows PowerShell" 的问题
        // 注：reg add 子进程冷启动耗时可达数百毫秒，必须放至后台线程执行，
        // 否则会阻塞主线程 setup 回调导致首次启动卡顿
        let reg_key = format!("HKCU\\Software\\Classes\\AppUserModelId\\{}", aumid);
        let icon_path_str = target_icon.to_string_lossy().to_string();

        std::thread::Builder::new()
            .name("notification-identity-reg".to_string())
            .spawn(move || {
                let mut cmd_name = std::process::Command::new("reg");
                cmd_name.args(["add", &reg_key, "/v", "DisplayName", "/d", "pi-dl", "/f"]);
                cmd_name.creation_flags(CREATE_NO_WINDOW);
                let _ = cmd_name.output();

                let mut cmd_icon = std::process::Command::new("reg");
                cmd_icon.args(["add", &reg_key, "/v", "IconUri", "/d", &icon_path_str, "/f"]);
                cmd_icon.creation_flags(CREATE_NO_WINDOW);
                let _ = cmd_icon.output();
            })
            .ok();
    }
}

/// 触发一条 Windows 原生 Toast 通知（带双重焦点防护：主窗聚焦时静默丢弃）。
#[tauri::command]
pub fn pi_show_notification(_app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    // 双重焦点防护铁律：若主窗口当前处于操作系统聚焦/前台激活状态，直接拦截丢弃，绝不打扰用户
    if let Some(window) = _app.get_webview_window("main") {
        if let Ok(true) = window.is_focused() {
            log::debug!("[Notification] Main window is currently focused, suppressing notification");
            return Ok(());
        }
    }

    #[cfg(windows)]
    {
        use tauri_winrt_notification::{Sound, Toast};
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

        if let Err(e) = toast.show() {
            log::warn!("[Notification] tauri_winrt_notification failed: {}, falling back to tauri_plugin_notification", e);
            use tauri_plugin_notification::NotificationExt;
            let _ = _app.notification()
                .builder()
                .title(&title)
                .body(&body)
                .show();
        }
        Ok(())
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
