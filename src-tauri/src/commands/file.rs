//! `commands/file` — 前端文件操作指令。
//! 含：打开目录 / 路径探测 / 主目录读取 / 文件夹与文件检查 / 文本预览 / 图片载荷 / Markdown 落盘。

use super::{app_dir_open, bytes_to_base64, expand_user_home_placeholder, inspect_single_file, FileInspectionResult};
use std::path::Path;
use tauri_plugin_opener::OpenerExt;

/// 在系统文件管理器（Windows 资源管理器）中定位文件或直接打开文件夹
#[tauri::command]
pub async fn pi_reveal_path(path: String) -> Result<(), String> {
    let path = expand_user_home_placeholder(&path);
    let p = std::path::PathBuf::from(&path);
    if p.exists() {
        if p.is_dir() {
            return app_dir_open(p);
        }
        // 文件：优先在所在文件夹中高亮定位；失败则退化为直接打开所在文件夹
        return match tauri_plugin_opener::reveal_item_in_dir(&path) {
            Ok(_) => Ok(()),
            Err(_) => match p.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => app_dir_open(parent.to_path_buf()),
                _ => Err("无法定位文件所在文件夹".to_string()),
            },
        };
    }
    // 路径已不存在（如已被删除的文件）：退化为打开其原所在文件夹（上级目录）
    match p.parent() {
        // 空/无效父目录绝不能交给 explorer（否则退化为打开「我的文档」），直接报错
        Some(parent) if !parent.as_os_str().is_empty() && parent.exists() => {
            app_dir_open(parent.to_path_buf())
        }
        _ => Err(format!("路径不存在或父目录无效: {}", path)),
    }
}

/// 极速判断路径是否真实存在（用于区分文件「新增」与「修改」；自动还原 [USER_HOME] 占位符）
#[tauri::command]
pub async fn pi_path_exists(path: String) -> Result<bool, String> {
    let path = expand_user_home_placeholder(&path);
    Ok(Path::new(&path).exists())
}

/// 获取当前用户主目录绝对路径
/// （内核事件流经 security/redaction 脱敏后真实主目录被替换为 [USER_HOME] 占位符，
/// 前端本地文件操作前需用该指令还原为真实绝对路径）
#[tauri::command]
pub async fn pi_get_home_dir() -> Result<String, String> {
    Ok(dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default())
}

/// 检查一批路径并返回各文件/文件夹的支持类型与分类
#[tauri::command]
pub fn pi_inspect_paths(paths: Vec<String>) -> Result<Vec<FileInspectionResult>, String> {
    let mut results = Vec::new();
    let max_count = 100;

    for path_str in paths {
        if results.len() >= max_count {
            break;
        }
        let p = Path::new(&path_str);
        if !p.exists() {
            continue;
        }

        if p.is_dir() {
            let folder_name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&path_str)
                .to_string();
            results.push(FileInspectionResult {
                path: p.to_string_lossy().to_string(),
                name: folder_name,
                ext: String::new(),
                size: 0,
                category: "folder".to_string(),
                is_text: false,
            });
        } else if p.is_file() {
            if let Some(inspected) = inspect_single_file(p, None) {
                results.push(inspected);
            }
        }
    }

    Ok(results)
}

/// 检查单个文件并返回其支持类型与分类
#[tauri::command]
pub fn pi_inspect_file(path: String) -> Result<Vec<FileInspectionResult>, String> {
    pi_inspect_paths(vec![path])
}

/// 将 Markdown 内容保存到系统桌面目录，返回最终绝对路径
#[tauri::command]
pub fn pi_save_markdown_to_desktop(filename: Option<String>, content: String) -> Result<String, String> {
    let desktop = dirs::desktop_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Desktop")))
        .ok_or_else(|| "无法获取系统桌面目录路径".to_string())?;

    if !desktop.exists() {
        std::fs::create_dir_all(&desktop).map_err(|e| format!("创建桌面目录失败: {}", e))?;
    }

    let default_name = format!("pi_output_{}.md", chrono::Local::now().format("%Y%m%d_%H%M%S"));
    let raw_name = filename.unwrap_or(default_name);
    let trimmed = raw_name.trim();

    // 清理非法文件名字符
    let invalid_chars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\r', '\n'];
    let mut safe_name: String = trimmed
        .chars()
        .map(|c| if invalid_chars.contains(&c) { '_' } else { c })
        .collect();

    if safe_name.is_empty() {
        safe_name = format!("pi_output_{}.md", chrono::Local::now().format("%Y%m%d_%H%M%S"));
    }

    if !safe_name.to_lowercase().ends_with(".md") {
        safe_name.push_str(".md");
    }

    let target_path = desktop.join(&safe_name);
    std::fs::write(&target_path, content.as_bytes())
        .map_err(|e| format!("写入 Markdown 文件失败: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

/// 读取文本文件并返回预览（过长时截断）
#[tauri::command]
pub fn pi_read_file_text_preview(path: String, max_chars: Option<usize>) -> Result<String, String> {
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

/// 将图片读入内存并封装为 base64 data URL 载荷（供多模态上下文注入）
#[tauri::command]
pub fn pi_prepare_image_payload(path: String) -> Result<serde_json::Value, String> {
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

/// 通过系统默认浏览器打开外部 URL
#[tauri::command]
pub async fn pi_open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// 读取 Windows 系统剪贴板中被复制的文件和文件夹绝对路径（CF_HDROP 格式）
#[tauri::command]
pub fn pi_read_clipboard_files() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::DataExchange::{
            CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
        };
        use windows_sys::Win32::UI::Shell::DragQueryFileW;

        const CF_HDROP_VAL: u32 = 15;
        let mut paths = Vec::new();

        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP_VAL) == 0 {
                return Ok(paths);
            }
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Ok(paths);
            }
            let handle = GetClipboardData(CF_HDROP_VAL);
            if !handle.is_null() {
                let count = DragQueryFileW(handle as _, 0xFFFFFFFF, std::ptr::null_mut(), 0);
                for i in 0..count {
                    let len = DragQueryFileW(handle as _, i, std::ptr::null_mut(), 0);
                    if len > 0 {
                        let mut buffer: Vec<u16> = vec![0; (len + 1) as usize];
                        let copied = DragQueryFileW(handle as _, i, buffer.as_mut_ptr(), len + 1);
                        if copied > 0 {
                            let path_str = String::from_utf16_lossy(&buffer[..copied as usize]);
                            if !path_str.is_empty() {
                                paths.push(path_str);
                            }
                        }
                    }
                }
            }
            CloseClipboard();
        }

        Ok(paths)
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

/// 保存剪贴板中的图片 Base64 数据到临时附件目录，返回绝对路径
#[tauri::command]
pub fn pi_save_clipboard_image(base64_data: String, ext: Option<String>) -> Result<String, String> {
    use base64::Engine;

    // 清理可能的 Data URL 前缀（如 "data:image/png;base64,"）
    let clean_b64 = if let Some(idx) = base64_data.find(";base64,") {
        &base64_data[idx + 8..]
    } else if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(clean_b64.trim())
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    if bytes.is_empty() {
        return Err("图片数据为空".to_string());
    }

    let ext_str = ext
        .unwrap_or_else(|| "png".to_string())
        .trim()
        .trim_start_matches('.')
        .to_lowercase();
    let safe_ext = if ["png", "jpg", "jpeg", "webp", "gif", "bmp"].contains(&ext_str.as_str()) {
        ext_str
    } else {
        "png".to_string()
    };

    let home = dirs::home_dir().ok_or_else(|| "无法获取主目录".to_string())?;
    let attach_dir = home.join(".pi-dl").join("attachments");
    if !attach_dir.exists() {
        std::fs::create_dir_all(&attach_dir).map_err(|e| format!("创建附件目录失败: {}", e))?;
    }

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let short_id = &uuid::Uuid::new_v4().to_string()[..8];
    let file_name = format!("pasted_image_{}_{}.{}", timestamp, short_id, safe_ext);
    let target_path = attach_dir.join(file_name);

    std::fs::write(&target_path, &bytes).map_err(|e| format!("保存剪贴板图片失败: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

