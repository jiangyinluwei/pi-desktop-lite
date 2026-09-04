//! `commands/` — Tauri IPC 命令按领域拆分子模块（阶段 5 落地）。
//!
//! 原 `lib.rs` 直接内联 51 个 `#[tauri::command]`；本目录按功能域拆分子模块，
//! `mod.rs` 负责统一再导出，使 `lib.rs` 的 `use commands::*` 与 `generate_handler![...]`
//! 照常按裸名引用，拆分对调用方完全透明。
//!
//! 分组：
//! - `file`    前端文件操作（打开目录 / 路径探测 / 文件检查 / 图片 / Markdown 落盘）
//! - `window`  窗口控制与 Windows 通知
//! - `agent`   Pi Agent 核心 RPC / 监督 / 任务 / 模型 / 工作区切换
//! - `session` 会话索引与树状历史
//! - `rollback` 会话回退 + 文件撤回（fork / 快照）
//! - `workspace_cmd` 多预设工作区与 code-area 路由
//! - `skills`  运行态内置技能规则与工具映射
//! - `version` 内核版本检测

pub mod agent;
pub mod file;
pub mod rollback;
pub mod session;
pub mod skills;
pub mod version;
pub mod window;
pub mod workspace_cmd;

use tauri::{Emitter, Manager};

// ---- 共享 helper（被多个子模块引用，故置于 mod.rs 统一出口） ----

/// 将脱敏占位符 `[USER_HOME]` 还原为真实用户主目录（仅用于后端路径操作，展示层保持脱敏）。
/// 内核事件流经 security/redaction 层时主目录前缀被替换为占位符，前端无法自行还原，
/// 由后端路径操作指令（reveal / exists）入口统一展开，保证功能路径可用。
pub fn expand_user_home_placeholder(path: &str) -> String {
    if !path.contains("[USER_HOME]") {
        return path.to_string();
    }
    match dirs::home_dir() {
        Some(home) => path.replace("[USER_HOME]", &home.to_string_lossy()),
        None => path.to_string(),
    }
}

/// 用系统资源管理器打开目录（空路径交给 explorer 会退化为打开「我的文档」，前置拦截）。
pub fn app_dir_open(p: std::path::PathBuf) -> Result<(), String> {
    if p.as_os_str().is_empty() {
        return Err("无法定位所在文件夹".to_string());
    }
    std::process::Command::new("explorer")
        .arg(p.as_os_str())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 字节数组 → Base64（手写实现，避免引入额外依赖）。
pub fn bytes_to_base64(bytes: &[u8]) -> String {
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

/// 单个文件的检查结果（前端用于附件胶囊分类展示）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileInspectionResult {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub category: String, // "image", "document", "code", "folder", "other"
    pub is_text: bool,
}

/// 检查单个文件并判定其支持类型与分类（自动过滤非解析类二进制文件）。
pub fn inspect_single_file(p: &std::path::Path, display_name: Option<String>) -> Option<FileInspectionResult> {
    if !p.is_file() {
        return None;
    }

    let meta = std::fs::metadata(p).ok()?;
    let size = meta.len();

    // 过滤超大文件 (> 30MB)
    if size > 30 * 1024 * 1024 {
        return None;
    }

    let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let name = display_name.unwrap_or_else(|| file_name.clone());

    // 显式排除常见编译二进制、压缩包与非文本媒体格式
    let ignore_exts = [
        "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib", "wasm", "class",
        "pyc", "pyo", "pyd", "node", "zip", "tar", "gz", "7z", "rar", "bz2", "xz",
        "iso", "mp4", "mp3", "wav", "avi", "mov", "mkv", "flv", "wmv", "ttf", "otf",
        "woff", "woff2", "eot", "lockb", "pdb", "ilk", "exp", "res",
    ];
    if ignore_exts.contains(&ext.as_str()) {
        return None;
    }

    let image_exts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tiff", "avif"];
    let doc_exts = [
        "doc", "docx", "pdf", "txt", "md", "markdown", "mdx", "csv", "tsv", "xlsx",
        "xls", "ppt", "pptx", "rtf", "log",
    ];
    let code_exts = [
        "js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "astro",
        "html", "htm", "css", "scss", "sass", "less", "rs", "py", "pyw", "go",
        "java", "c", "cpp", "cc", "cxx", "h", "hpp", "hxx", "cs", "php", "rb",
        "swift", "kt", "kts", "scala", "dart", "lua", "r", "pl", "pm", "sh",
        "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "json", "jsonc",
        "json5", "yaml", "yml", "toml", "xml", "ini", "conf", "config", "env",
        "properties", "sql", "graphql", "gql", "proto", "prisma", "dockerfile",
        "makefile", "cmake",
    ];

    // 无扩展名或点开头的特殊代码/配置文件名
    let special_code_names = [
        "dockerfile", "makefile", "cmakelists.txt", "gemfile", "rakefile",
        "procfile", "vagrantfile", "jenkinsfile", ".env", ".gitignore",
        ".dockerignore", ".editorconfig", ".prettierrc", ".eslintrc",
        "cargo.lock", "package.json", "tsconfig.json", "license", "readme",
    ];

    let lower_name = file_name.to_lowercase();
    let is_special = special_code_names.iter().any(|&s| lower_name == s || lower_name.ends_with(s));

    let (category, is_text) = if image_exts.contains(&ext.as_str()) {
        ("image".to_string(), ext == "svg")
    } else if doc_exts.contains(&ext.as_str()) {
        let is_plain = ["txt", "md", "markdown", "mdx", "csv", "tsv", "log", "rtf"].contains(&ext.as_str());
        ("document".to_string(), is_plain)
    } else if code_exts.contains(&ext.as_str()) || is_special {
        ("code".to_string(), true)
    } else {
        ("other".to_string(), false)
    };

    // 仅保留明确支持的 code / document / image 分类
    if category == "other" {
        return None;
    }

    Some(FileInspectionResult {
        path: p.to_string_lossy().to_string(),
        name,
        ext,
        size,
        category,
        is_text,
    })
}

/// 显示并聚焦主窗口（供单实例/托盘/通知回调复用）。
pub fn show_and_focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("app-awakened", ());
    }
}

// ---- 统一再导出（供 lib.rs `use commands::*` 裸名引用） ----
pub use agent::*;
pub use file::*;
pub use rollback::*;
pub use session::*;
pub use skills::*;
pub use version::*;
pub use window::*;
pub use workspace_cmd::*;
