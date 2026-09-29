use super::models::{
    InstalledPackage, NodeEnvironmentInfo, PackageProgressPayload, PackageUpdateInfo,
};
use crate::config_manager::get_pi_agent_dir;
use crate::pi_runner::supervisor::PiSupervisor;
use crate::version_watcher::checker::is_newer;
use futures_util::future::join_all;
use once_cell::sync::Lazy;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

/// 全局组件操作互斥锁：严格保障同一时刻只能有一个扩展组件在安装、更新或卸载
static PACKAGE_OPERATION_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// 提取 npm 包名，正确处理 scoped 包 (@scope/pkg) 和版本号后缀 (@1.0.0 / @latest)
pub fn extract_npm_package_name(raw: &str) -> String {
    let s = raw.trim().trim_start_matches("npm:");
    if s.starts_with('@') {
        // Scoped package: @scope/pkg or @scope/pkg@1.0.0
        if let Some(slash_idx) = s.find('/') {
            let after_slash = &s[slash_idx + 1..];
            if let Some(ver_idx) = after_slash.find('@') {
                return format!("{}/{}", &s[..slash_idx], &after_slash[..ver_idx]);
            }
        }
        s.to_string()
    } else {
        // Non-scoped package: pkg or pkg@1.0.0 or pkg@latest
        if let Some(idx) = s.find('@') {
            s[..idx].to_string()
        } else {
            s.to_string()
        }
    }
}

/// 标准化包名规范（统一转换为纯净包名与 npm:<name> / git / http 标准源标识）
pub fn normalize_package_source(raw_name: &str) -> (String, String) {
    let trimmed = raw_name.trim();
    if let Some(rest) = trimmed.strip_prefix("npm:") {
        let pkg_name = extract_npm_package_name(rest);
        (pkg_name.clone(), format!("npm:{}", pkg_name))
    } else if trimmed.starts_with("git:")
        || trimmed.starts_with("https:")
        || trimmed.starts_with("http:")
        || trimmed.starts_with("ssh:")
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
    {
        let name = trimmed
            .split('@')
            .next()
            .unwrap_or(trimmed)
            .trim_end_matches(".git")
            .split('/')
            .last()
            .unwrap_or(trimmed)
            .to_string();
        (name, trimmed.to_string())
    } else {
        let pkg_name = extract_npm_package_name(trimmed);
        (pkg_name.clone(), format!("npm:{}", pkg_name))
    }
}

/// 查找已安装在 npm/node_modules 下的 package.json
fn find_installed_package_json(agent_dir: &Path, pkg_name: &str) -> Option<PathBuf> {
    let clean_name = extract_npm_package_name(pkg_name);
    let npm_modules = agent_dir.join("npm").join("node_modules");
    let target = npm_modules.join(&clean_name).join("package.json");
    if target.exists() {
        Some(target)
    } else {
        None
    }
}

/// 获取已安装的所有扩展组件
pub fn get_installed_packages() -> Result<Vec<InstalledPackage>, String> {
    let agent_dir = get_pi_agent_dir()?;
    let settings_file = agent_dir.join("settings.json");
    if !settings_file.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&settings_file)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;

    let json_val: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let packages_arr = match json_val.get("packages") {
        Some(Value::Array(arr)) => arr,
        _ => return Ok(Vec::new()),
    };

    let mut installed_list = Vec::new();
    for item in packages_arr {
        let raw_str = if let Some(s) = item.as_str() {
            s
        } else if let Some(s) = item.get("source").and_then(|v| v.as_str()) {
            s
        } else {
            continue;
        };

        let (pkg_name, source_spec) = normalize_package_source(raw_str);
        if pkg_name.is_empty() {
            continue;
        }

        let mut version = "unknown".to_string();
        let mut description = String::new();

        if let Some(pkg_json_path) = find_installed_package_json(&agent_dir, &pkg_name) {
            if let Ok(pkg_json_content) = fs::read_to_string(&pkg_json_path) {
                if let Ok(pkg_val) = serde_json::from_str::<Value>(&pkg_json_content) {
                    if let Some(v) = pkg_val.get("version").and_then(|v| v.as_str()) {
                        version = v.to_string();
                    }
                    if let Some(d) = pkg_val.get("description").and_then(|d| d.as_str()) {
                        description = d.to_string();
                    }
                }
            }
        }

        let (has_preset, is_preset_applied, preset_title) =
            match super::presets::find_preset_for_package(&pkg_name) {
                Some(preset) => {
                    let applied = super::presets::is_preset_applied(&preset);
                    (true, applied, Some(preset.title))
                }
                None => (false, false, None),
            };

        let (has_patches, is_patches_applied, patch_title) =
            match super::patches::find_patch_set_for_package(&pkg_name) {
                Some(patch_set) => {
                    let applied =
                        match super::patches::resolve_installed_package(&pkg_name) {
                            Some((root, _version)) => {
                                super::patches::is_patch_set_applied(&patch_set, &root)
                            }
                            None => false,
                        };
                    (true, applied, Some(patch_set.title))
                }
                None => (false, false, None),
            };

        installed_list.push(InstalledPackage {
            name: pkg_name,
            version,
            description,
            source: source_spec,
            has_preset,
            is_preset_applied,
            preset_title,
            has_patches,
            is_patches_applied,
            patch_title,
        });
    }

    Ok(installed_list)
}

/// 检测系统中的 Node.js 与 npm 运行环境
pub async fn check_node_environment() -> NodeEnvironmentInfo {
    let mut node_version = None;
    let mut node_found = false;

    // 1. 尝试直接从 PATH 执行 node --version
    let mut cmd = tokio::process::Command::new("node");
    cmd.arg("--version");
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Ok(output_res) = tokio::time::timeout(Duration::from_secs(3), cmd.output()).await {
        if let Ok(out) = output_res {
            if out.status.success() {
                let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !v.is_empty() {
                    node_version = Some(v);
                    node_found = true;
                }
            }
        }
    }

    // 若 PATH 中未直接找到，尝试探测 Windows 常见默认安装路径
    if !node_found {
        let mut candidates = Vec::new();
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(pf).join("nodejs").join("node.exe"));
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(pf86).join("nodejs").join("node.exe"));
        }
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(&local_app)
                    .join("Programs")
                    .join("node")
                    .join("node.exe"),
            );
            candidates.push(
                PathBuf::from(&local_app)
                    .join("Programs")
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
        if let Ok(app_data) = std::env::var("APPDATA") {
            candidates.push(
                PathBuf::from(app_data)
                    .join("nvm")
                    .join("current")
                    .join("node.exe"),
            );
        }

        for candidate in candidates {
            if candidate.exists() {
                let mut fallback_cmd = tokio::process::Command::new(&candidate);
                fallback_cmd.arg("--version");
                #[cfg(windows)]
                {
                    fallback_cmd.creation_flags(0x08000000);
                }
                if let Ok(output_res) =
                    tokio::time::timeout(Duration::from_secs(3), fallback_cmd.output()).await
                {
                    if let Ok(out) = output_res {
                        if out.status.success() {
                            let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                            if !v.is_empty() {
                                node_version = Some(v);
                                node_found = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 若找到 Node.js，探测 npm 版本
    let mut npm_version = None;
    if node_found {
        let mut npm_cmd = if cfg!(windows) {
            tokio::process::Command::new("npm.cmd")
        } else {
            tokio::process::Command::new("npm")
        };
        npm_cmd.arg("--version");
        #[cfg(windows)]
        {
            npm_cmd.creation_flags(0x08000000);
        }

        if let Ok(output_res) = tokio::time::timeout(Duration::from_secs(3), npm_cmd.output()).await
        {
            if let Ok(out) = output_res {
                if out.status.success() {
                    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !v.is_empty() {
                        npm_version = Some(v);
                    }
                }
            }
        }
    }

    if node_found {
        NodeEnvironmentInfo {
            installed: true,
            node_version,
            npm_version,
            error: None,
        }
    } else {
        NodeEnvironmentInfo {
            installed: false,
            node_version: None,
            npm_version: None,
            error: Some("未检测到 Node.js 运行环境，请先安装 Node.js".to_string()),
        }
    }
}

/// 安装/更新共用的 npm 生命周期文案与关键词差异面。
/// 此前 install_package 与 update_package 各自维护一份约 220 行结构重复的流水线，
/// 仅命令词/文案/关键词不同——更新路径的静默吞错正是只改一份没同步另一份的产物，
/// 差异面参数化后收敛为 run_package_lifecycle 单一实现。
struct NpmLifecycleFlavor {
    /// 日志动词（"Installing" / "Updating"）
    verb: &'static str,
    /// pi 子命令（"install" / "update"）
    subcommand: &'static str,
    /// 子命令附加参数（install 为 ["-a"]，update 为空）
    extra_args: &'static [&'static str],
    /// 包规格（install 传原始 source_spec，update 传 npm:<pkg>）
    spec: String,
    /// spawn 失败消息中的命令标签（"pi install command" / "pi update command"）
    spawn_label: &'static str,
    /// 失败日志与最终错误前缀（"Install" / "Update"）
    fail_label: &'static str,
    /// resolving 阶段（15%）文案
    resolving_msg: String,
    /// downloading 阶段（35%）文案
    downloading_msg: String,
    /// stdout 首段关键词（"installing" / "updating"，与 fetch/download 并列）
    head_keyword: &'static str,
    /// downloading 进度（55%）文案
    download_progress_msg: String,
    /// linking 进度（75%）文案
    link_msg: String,
    /// registering 关键词（"installed" / "updated"，与 success 并列）
    register_keyword: &'static str,
    /// registering 进度（90%）文案
    register_msg: String,
}

/// 安装/更新共用的 npm 生命周期执行流水线：
/// 互斥排队 ➔ Node 环境校验 ➔ spawn pi 子命令 ➔ stdout/stderr 进度解析任务 ➔
/// wait ➔ 失败结算（error 事件 + Err）。成功路径仅保证子命令执行完毕，
/// 预设/补丁等后处理语义分属安装（无条件应用）与更新（缺失才重打）两套，由调用方自理。
async fn run_package_lifecycle(
    app_handle: &tauri::AppHandle,
    pkg_name: &str,
    flavor: &NpmLifecycleFlavor,
) -> Result<(), String> {
    // 异步排队获取全局互斥锁（严格按队列顺序执行，杜绝并发冲突）
    let _lock = PACKAGE_OPERATION_MUTEX.lock().await;

    // 前置环境防御校验：确认 Node.js 环境就绪
    let node_env = check_node_environment().await;
    if !node_env.installed {
        let err_msg =
            "未检测到 Node.js 运行环境，请先安装 Node.js (https://nodejs.org/)".to_string();
        let _ = app_handle.emit(
            "package-progress",
            PackageProgressPayload {
                package_name: pkg_name.to_string(),
                stage: "error".to_string(),
                percent: 100,
                message: err_msg.clone(),
            },
        );
        return Err(err_msg);
    }

    let pi_bin =
        PiSupervisor::find_pi_binary(Some(app_handle)).unwrap_or_else(|| PathBuf::from("pi"));

    log::info!(
        "[PackageManager] {} package '{}' using binary: {:?}",
        flavor.verb,
        flavor.spec,
        pi_bin
    );

    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.to_string(),
            stage: "resolving".to_string(),
            percent: 15,
            message: flavor.resolving_msg.clone(),
        },
    );

    let mut cmd = tokio::process::Command::new(&pi_bin);
    cmd.arg(flavor.subcommand).arg(&flavor.spec);
    for extra in flavor.extra_args {
        cmd.arg(extra);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let workspace = PiSupervisor::get_default_workspace(Some(app_handle));
    let _ = std::fs::create_dir_all(&workspace);
    cmd.current_dir(&workspace);

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("Failed to spawn {}: {}", flavor.spawn_label, e);
        let _ = app_handle.emit(
            "package-progress",
            PackageProgressPayload {
                package_name: pkg_name.to_string(),
                stage: "error".to_string(),
                percent: 100,
                message: msg.clone(),
            },
        );
        msg
    })?;

    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.to_string(),
            stage: "downloading".to_string(),
            percent: 35,
            message: flavor.downloading_msg.clone(),
        },
    );

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_handle_clone = app_handle.clone();
    let pkg_name_clone = pkg_name.to_string();
    let download_msg = flavor.download_progress_msg.clone();
    let link_msg = flavor.link_msg.clone();
    let register_msg = flavor.register_msg.clone();
    let head_keyword = flavor.head_keyword;
    let register_keyword = flavor.register_keyword;
    let stdout_task = tokio::spawn(async move {
        let mut lines = Vec::new();
        if let Some(out) = stdout {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log::info!("[PackageManager stdout] {}", line);
                let lower = line.to_lowercase();
                if lower.contains(head_keyword)
                    || lower.contains("fetch")
                    || lower.contains("download")
                {
                    let _ = app_handle_clone.emit(
                        "package-progress",
                        PackageProgressPayload {
                            package_name: pkg_name_clone.clone(),
                            stage: "downloading".to_string(),
                            percent: 55,
                            message: download_msg.clone(),
                        },
                    );
                } else if lower.contains("added")
                    || lower.contains("changed")
                    || lower.contains("packages")
                {
                    let _ = app_handle_clone.emit(
                        "package-progress",
                        PackageProgressPayload {
                            package_name: pkg_name_clone.clone(),
                            stage: "linking".to_string(),
                            percent: 75,
                            message: link_msg.clone(),
                        },
                    );
                } else if lower.contains(register_keyword) || lower.contains("success") {
                    let _ = app_handle_clone.emit(
                        "package-progress",
                        PackageProgressPayload {
                            package_name: pkg_name_clone.clone(),
                            stage: "registering".to_string(),
                            percent: 90,
                            message: register_msg.clone(),
                        },
                    );
                }
                lines.push(line);
            }
        }
        lines.join("\n")
    });

    let stderr_task = tokio::spawn(async move {
        let mut lines = Vec::new();
        if let Some(err) = stderr {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log::warn!("[PackageManager stderr] {}", line);
                lines.push(line);
            }
        }
        lines.join("\n")
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Wait failed: {}", e))?;
    let stdout_str = stdout_task.await.unwrap_or_default();
    let stderr_str = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let err_msg = if !stderr_str.trim().is_empty() {
            stderr_str
        } else {
            stdout_str
        };
        log::error!("[PackageManager] {} failed: {}", flavor.fail_label, err_msg);
        let final_err = format!(
            "{} failed (code {:?}): {}",
            flavor.fail_label,
            status.code(),
            err_msg.trim()
        );
        let _ = app_handle.emit(
            "package-progress",
            PackageProgressPayload {
                package_name: pkg_name.to_string(),
                stage: "error".to_string(),
                percent: 100,
                message: final_err.clone(),
            },
        );
        return Err(final_err);
    }

    Ok(())
}

/// 执行 pi.exe install <pkg> -a 安装组件并实时派发进度事件
pub async fn install_package(
    app_handle: &tauri::AppHandle,
    raw_name: &str,
) -> Result<String, String> {
    let (pkg_name, source_spec) = normalize_package_source(raw_name);
    if pkg_name.is_empty() {
        return Err("Package name cannot be empty".to_string());
    }

    let flavor = NpmLifecycleFlavor {
        verb: "Installing",
        subcommand: "install",
        extra_args: &["-a"],
        spec: source_spec,
        spawn_label: "pi install command",
        fail_label: "Install",
        resolving_msg: format!("正在解析组件 {} 依赖环境...", pkg_name),
        downloading_msg: "正在从 npm 仓库拉取组件包与依赖...".to_string(),
        head_keyword: "installing",
        download_progress_msg: "正在下载 npm 模块与静态依赖...".to_string(),
        link_msg: "依赖下载完成，正在解压与校验签名...".to_string(),
        register_keyword: "installed",
        register_msg: "正在注册并挂载至 settings.json...".to_string(),
    };
    run_package_lifecycle(app_handle, &pkg_name, &flavor).await?;

    log::info!("[PackageManager] Successfully installed {}", pkg_name);

    // 检查并自动应用推荐配置预设
    let auto_preset_applied =
        if let Some(preset) = super::presets::find_preset_for_package(&pkg_name) {
            match super::presets::apply_preset(&preset) {
                Ok(_) => {
                    log::info!(
                        "[PackageManager] Auto-applied preset '{}' for package '{}'",
                        preset.title,
                        pkg_name
                    );
                    true
                }
                Err(e) => {
                    log::warn!(
                        "[PackageManager] Failed to auto-apply preset for package '{}': {}",
                        pkg_name,
                        e
                    );
                    false
                }
            }
        } else {
            false
        };

    // 检查并自动应用缺陷补丁（修复第三方组件在本机环境上的源码级缺陷，幂等 + 版本闸门）
    let auto_patch_applied =
        if let Some(patch_set) = super::patches::find_patch_set_for_package(&pkg_name) {
            if let Some((package_root, version)) =
                super::patches::resolve_installed_package(&pkg_name)
            {
                match super::patches::apply_patch_set(&patch_set, &package_root, &version) {
                    Ok(_) => {
                        log::info!(
                            "[PackageManager] Auto-applied patch '{}' for package '{}' v{}",
                            patch_set.title,
                            pkg_name,
                            version
                        );
                        true
                    }
                    Err(e) => {
                        log::warn!(
                            "[PackageManager] Skipped patch for package '{}' v{}: {}",
                            pkg_name,
                            version,
                            e
                        );
                        false
                    }
                }
            } else {
                false
            }
        } else {
            false
        };

    let completed_msg = if auto_preset_applied && auto_patch_applied {
        format!("组件 {} 安装成功，已自动应用推荐配置与缺陷修复！", pkg_name)
    } else if auto_preset_applied {
        format!("组件 {} 安装成功，已自动应用推荐配置！", pkg_name)
    } else if auto_patch_applied {
        format!("组件 {} 安装成功，已自动应用缺陷修复！", pkg_name)
    } else {
        format!("组件 {} 安装成功！", pkg_name)
    };

    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.clone(),
            stage: "completed".to_string(),
            percent: 100,
            message: completed_msg,
        },
    );

    Ok(format!("Installed {}", pkg_name))
}

/// 执行 pi.exe remove <pkg> -a 卸载组件并实时派发进度事件
pub async fn uninstall_package(
    app_handle: &tauri::AppHandle,
    raw_name: &str,
) -> Result<String, String> {
    let (pkg_name, source_spec) = normalize_package_source(raw_name);
    if pkg_name.is_empty() {
        return Err("Package name cannot be empty".to_string());
    }

    // 异步排队获取全局互斥锁（严格按队列顺序执行，杜绝并发冲突）
    let _lock = PACKAGE_OPERATION_MUTEX.lock().await;

    let pi_bin =
        PiSupervisor::find_pi_binary(Some(app_handle)).unwrap_or_else(|| PathBuf::from("pi"));

    log::info!(
        "[PackageManager] Removing package '{}' using binary: {:?}",
        source_spec,
        pi_bin
    );

    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.clone(),
            stage: "uninstalling".to_string(),
            percent: 30,
            message: format!("正在卸载组件 {} 并清理配置...", pkg_name),
        },
    );

    let mut cmd = tokio::process::Command::new(&pi_bin);
    cmd.arg("remove")
        .arg(&source_spec)
        .arg("-a")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let workspace = PiSupervisor::get_default_workspace(Some(app_handle));
    let _ = std::fs::create_dir_all(&workspace);
    cmd.current_dir(&workspace);

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().await.map_err(|e| {
        let msg = format!("Failed to execute pi remove command: {}", e);
        let _ = app_handle.emit(
            "package-progress",
            PackageProgressPayload {
                package_name: pkg_name.clone(),
                stage: "error".to_string(),
                percent: 100,
                message: msg.clone(),
            },
        );
        msg
    })?;

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if !stderr_str.trim().is_empty() {
            stderr_str
        } else {
            stdout_str
        };
        log::error!("[PackageManager] Uninstall failed: {}", err_msg);
        let final_err = format!(
            "Uninstall failed (code {:?}): {}",
            output.status.code(),
            err_msg.trim()
        );
        let _ = app_handle.emit(
            "package-progress",
            PackageProgressPayload {
                package_name: pkg_name.clone(),
                stage: "error".to_string(),
                percent: 100,
                message: final_err.clone(),
            },
        );
        return Err(final_err);
    }

    log::info!("[PackageManager] Successfully uninstalled {}", pkg_name);
    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.clone(),
            stage: "uninstalled".to_string(),
            percent: 100,
            message: format!("组件 {} 卸载完成！", pkg_name),
        },
    );

    Ok(format!("Uninstalled {}", pkg_name))
}

/// 检查已安装组件的最新版本可用性（并发请求 npm registry）
pub async fn check_package_updates() -> Result<Vec<PackageUpdateInfo>, String> {
    let installed = get_installed_packages()?;
    if installed.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(&crate::app_meta::user_agent())
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let futures = installed.into_iter().map(|pkg| {
        let client = client.clone();
        async move {
            let registry_url = format!("https://registry.npmjs.org/{}/latest", pkg.name);
            let mut latest_version = pkg.version.clone();
            let mut has_update = false;

            if let Ok(resp) = client.get(&registry_url).send().await {
                if resp.status().is_success() {
                    if let Ok(json_body) = resp.json::<Value>().await {
                        if let Some(ver_str) = json_body.get("version").and_then(|v| v.as_str()) {
                            latest_version = ver_str.to_string();
                            if pkg.version != "unknown" && is_newer(&pkg.version, &latest_version) {
                                has_update = true;
                            }
                        }
                    }
                }
            }

            PackageUpdateInfo {
                name: pkg.name,
                current_version: pkg.version,
                latest_version,
                has_update,
            }
        }
    });

    let update_results = join_all(futures).await;
    Ok(update_results)
}

/// 执行 pi.exe update <pkg> 更新组件并实时派发进度事件
pub async fn update_package(
    app_handle: &tauri::AppHandle,
    raw_name: &str,
) -> Result<String, String> {
    let (pkg_name, _) = normalize_package_source(raw_name);
    if pkg_name.is_empty() {
        return Err("Package name cannot be empty".to_string());
    }

    let flavor = NpmLifecycleFlavor {
        verb: "Updating",
        subcommand: "update",
        extra_args: &[],
        spec: format!("npm:{}", pkg_name),
        spawn_label: "pi update command",
        fail_label: "Update",
        resolving_msg: format!("正在连接 npm 仓库解析组件 {} 最新版本...", pkg_name),
        downloading_msg: "正在从 npm 仓库拉取最新组件代码与依赖...".to_string(),
        head_keyword: "updating",
        download_progress_msg: "正在下载 npm 最新包模块与文件...".to_string(),
        link_msg: "依赖更新完成，正在解压与校验签名...".to_string(),
        register_keyword: "updated",
        register_msg: "正在更新 settings.json 配置...".to_string(),
    };
    run_package_lifecycle(app_handle, &pkg_name, &flavor).await?;

    log::info!("[PackageManager] Successfully updated {}", pkg_name);

    // 检查并自动同步应用推荐配置预设（失败必须落日志——静默丢失会让用户无痕迹地
    // 失去「后台静默执行」等推荐配置；与安装路径的 warn 日志口径对齐）
    if let Some(preset) = super::presets::find_preset_for_package(&pkg_name) {
        if !super::presets::is_preset_applied(&preset) {
            if let Err(e) = super::presets::apply_preset(&preset) {
                log::warn!("[PackageManager] Post-update preset re-apply failed for {}: {}", pkg_name, e);
            }
        }
    }

    // npm 更新会整体覆盖 node_modules，缺陷补丁需重新打回（幂等 + 版本闸门保护）
    if let Some(patch_set) = super::patches::find_patch_set_for_package(&pkg_name) {
        if let Some((package_root, version)) =
            super::patches::resolve_installed_package(&pkg_name)
        {
            if !super::patches::is_patch_set_applied(&patch_set, &package_root) {
                if let Err(e) = super::patches::apply_patch_set(&patch_set, &package_root, &version) {
                    log::warn!("[PackageManager] Post-update patch re-apply failed for {}: {}", pkg_name, e);
                }
            }
        }
    }

    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.clone(),
            stage: "completed".to_string(),
            percent: 100,
            message: format!("组件 {} 更新成功！", pkg_name),
        },
    );

    Ok(format!("Updated {}", pkg_name))
}
