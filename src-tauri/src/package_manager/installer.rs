use super::models::{InstalledPackage, PackageProgressPayload, PackageUpdateInfo};
use crate::config_manager::get_pi_agent_dir;
use crate::pi_runner::supervisor::PiSupervisor;
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

/// 标准化包名规范（统一转换为 npm:<name> 形式或保留 git/http 规范）
fn normalize_package_source(raw_name: &str) -> (String, String) {
    let trimmed = raw_name.trim();
    if trimmed.starts_with("npm:") {
        let pkg_name = trimmed.trim_start_matches("npm:").to_string();
        (pkg_name, trimmed.to_string())
    } else if trimmed.starts_with("git:")
        || trimmed.starts_with("https:")
        || trimmed.starts_with("http:")
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
    {
        (trimmed.to_string(), trimmed.to_string())
    } else {
        (trimmed.to_string(), format!("npm:{}", trimmed))
    }
}

/// 查找已安装在 npm/node_modules 下的 package.json
fn find_installed_package_json(agent_dir: &Path, pkg_name: &str) -> Option<PathBuf> {
    let npm_modules = agent_dir.join("npm").join("node_modules");
    let target = npm_modules.join(pkg_name).join("package.json");
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
        let raw_str = match item.as_str() {
            Some(s) => s,
            None => continue,
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

        let (has_preset, is_preset_applied, preset_title) = match super::presets::find_preset_for_package(&pkg_name) {
            Some(preset) => {
                let applied = super::presets::is_preset_applied(&preset);
                (true, applied, Some(preset.title))
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
        });
    }

    Ok(installed_list)
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

    // 异步排队获取全局互斥锁（严格按队列顺序执行，杜绝并发冲突）
    let _lock = PACKAGE_OPERATION_MUTEX.lock().await;

    let pi_bin = PiSupervisor::find_pi_binary(Some(app_handle)).unwrap_or_else(|| PathBuf::from("pi"));

    log::info!(
        "[PackageManager] Installing package '{}' using binary: {:?}",
        source_spec,
        pi_bin
    );

    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.clone(),
            stage: "resolving".to_string(),
            percent: 15,
            message: format!("正在解析组件 {} 依赖环境...", pkg_name),
        },
    );

    let mut cmd = tokio::process::Command::new(&pi_bin);
    cmd.arg("install")
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

    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("Failed to spawn pi install command: {}", e);
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

    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.clone(),
            stage: "downloading".to_string(),
            percent: 35,
            message: "正在从 npm 仓库拉取组件包与依赖...".to_string(),
        },
    );

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_handle_clone = app_handle.clone();
    let pkg_name_clone = pkg_name.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = Vec::new();
        if let Some(out) = stdout {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log::info!("[PackageManager stdout] {}", line);
                let lower = line.to_lowercase();
                if lower.contains("installing") || lower.contains("fetch") || lower.contains("download") {
                    let _ = app_handle_clone.emit(
                        "package-progress",
                        PackageProgressPayload {
                            package_name: pkg_name_clone.clone(),
                            stage: "downloading".to_string(),
                            percent: 55,
                            message: "正在下载 npm 模块与静态依赖...".to_string(),
                        },
                    );
                } else if lower.contains("added") || lower.contains("changed") || lower.contains("packages") {
                    let _ = app_handle_clone.emit(
                        "package-progress",
                        PackageProgressPayload {
                            package_name: pkg_name_clone.clone(),
                            stage: "linking".to_string(),
                            percent: 75,
                            message: "依赖下载完成，正在解压与校验签名...".to_string(),
                        },
                    );
                } else if lower.contains("installed") || lower.contains("success") {
                    let _ = app_handle_clone.emit(
                        "package-progress",
                        PackageProgressPayload {
                            package_name: pkg_name_clone.clone(),
                            stage: "registering".to_string(),
                            percent: 90,
                            message: "正在注册并挂载至 settings.json...".to_string(),
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

    let status = child.wait().await.map_err(|e| format!("Wait failed: {}", e))?;
    let stdout_str = stdout_task.await.unwrap_or_default();
    let stderr_str = stderr_task.await.unwrap_or_default();

    if !status.success() {
        let err_msg = if !stderr_str.trim().is_empty() {
            stderr_str
        } else {
            stdout_str
        };
        log::error!("[PackageManager] Install failed: {}", err_msg);
        let final_err = format!("Install failed (code {:?}): {}", status.code(), err_msg.trim());
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

    log::info!("[PackageManager] Successfully installed {}", pkg_name);

    // 检查并自动应用推荐配置预设
    let auto_preset_applied = if let Some(preset) = super::presets::find_preset_for_package(&pkg_name) {
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

    let completed_msg = if auto_preset_applied {
        format!("组件 {} 安装成功，已自动应用推荐配置！", pkg_name)
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

    let pi_bin = PiSupervisor::find_pi_binary(Some(app_handle)).unwrap_or_else(|| PathBuf::from("pi"));

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
        let final_err = format!("Uninstall failed (code {:?}): {}", output.status.code(), err_msg.trim());
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

/// 解析 SemVer 字符串为数字三元组 (major, minor, patch)
fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
    let clean = v.trim().trim_start_matches('v').trim_start_matches('^').trim_start_matches('~');
    let main_part = clean.split('-').next().unwrap_or(clean);
    let parts: Vec<&str> = main_part.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let major = parts[0].parse::<u64>().ok()?;
    let minor = parts[1].parse::<u64>().ok()?;
    let patch = parts[2].parse::<u64>().ok()?;
    Some((major, minor, patch))
}

/// 检查版本 a 是否小于版本 b (即 b 是否为更新版本)
fn is_newer(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some((c_maj, c_min, c_pat)), Some((l_maj, l_min, l_pat))) => {
            (l_maj > c_maj)
                || (l_maj == c_maj && l_min > c_min)
                || (l_maj == c_maj && l_min == c_min && l_pat > c_pat)
        }
        _ => false,
    }
}

/// 检查已安装组件的最新版本可用性
pub async fn check_package_updates() -> Result<Vec<PackageUpdateInfo>, String> {
    let installed = get_installed_packages()?;
    if installed.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("pi-desktop-lite/0.1.0")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut update_results = Vec::new();

    for pkg in installed {
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

        update_results.push(PackageUpdateInfo {
            name: pkg.name,
            current_version: pkg.version,
            latest_version,
            has_update,
        });
    }

    Ok(update_results)
}

/// 更新指定组件 (重新执行 install npm:<pkg> -a)
pub async fn update_package(
    app_handle: &tauri::AppHandle,
    raw_name: &str,
) -> Result<String, String> {
    let (pkg_name, _) = normalize_package_source(raw_name);
    let _ = app_handle.emit(
        "package-progress",
        PackageProgressPayload {
            package_name: pkg_name.clone(),
            stage: "updating".to_string(),
            percent: 10,
            message: format!("正在准备更新组件 {}...", pkg_name),
        },
    );
    install_package(app_handle, raw_name).await
}
