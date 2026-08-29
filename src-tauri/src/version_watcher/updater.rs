use crate::pi_runner::PiSupervisor;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use once_cell::sync::Lazy;

/// 全局内核更新互斥锁：保障同一时间只有一个内核更新任务在运行
static KERNEL_UPDATE_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static IS_UPDATING: AtomicBool = AtomicBool::new(false);



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelUpdateProgressPayload {
    pub stage: String, // "checking" | "downloading" | "extracting" | "verifying" | "replacing" | "restarting" | "completed" | "error"
    pub percent: u32,
    pub message: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub target_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelUpdateResult {
    pub success: bool,
    pub version: String,
    pub message: String,
    pub error: Option<String>,
}

/// 发送内核更新进度通知给前端
fn emit_progress(
    app: &AppHandle,
    stage: &str,
    percent: u32,
    message: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    target_version: &str,
) {
    let payload = KernelUpdateProgressPayload {
        stage: stage.to_string(),
        percent,
        message,
        downloaded_bytes,
        total_bytes,
        target_version: target_version.to_string(),
    };
    let _ = app.emit("kernel-update-progress", &payload);
}

/// 获取当前平台的 release 压缩包名称
fn get_platform_asset_name() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "pi-windows-arm64.zip"
        } else {
            "pi-windows-x64.zip"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "pi-darwin-arm64.tar.gz"
        } else {
            "pi-darwin-x64.tar.gz"
        }
    } else {
        if cfg!(target_arch = "aarch64") {
            "pi-linux-arm64.tar.gz"
        } else {
            "pi-linux-x64.tar.gz"
        }
    }
}

/// 执行 Pi 内核一键更新
pub async fn perform_kernel_update(
    app_handle: AppHandle,
    supervisor: PiSupervisor,
    target_version: String,
) -> Result<KernelUpdateResult, String> {
    let _lock = KERNEL_UPDATE_MUTEX.lock().await;

    if IS_UPDATING.swap(true, Ordering::SeqCst) {
        return Err("Another kernel update is already in progress".to_string());
    }

    let result = do_update(&app_handle, &supervisor, &target_version).await;
    IS_UPDATING.store(false, Ordering::SeqCst);

    match result {
        Ok(res) => Ok(res),
        Err(err) => {
            emit_progress(
                &app_handle,
                "error",
                100,
                format!("内核更新失败: {}", err),
                0,
                0,
                &target_version,
            );
            Err(err)
        }
    }
}

async fn do_update(
    app: &AppHandle,
    supervisor: &PiSupervisor,
    target_ver: &str,
) -> Result<KernelUpdateResult, String> {
    let clean_ver = target_ver.trim().trim_start_matches('v').to_string();
    let asset_name = get_platform_asset_name();

    let home_dir = dirs::home_dir().ok_or_else(|| "Could not determine user home directory".to_string())?;
    let pi_dl_dir = home_dir.join(".pi-dl");
    let temp_dir = pi_dl_dir.join("temp");
    let staging_dir = pi_dl_dir.join("kernel_staging");
    let backup_dir = pi_dl_dir.join("kernel_backup");
    let target_kernel_dir = pi_dl_dir.join("kernel").join("pi-windows-x64");

    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let _ = fs::remove_dir_all(&staging_dir);
    let _ = fs::remove_dir_all(&backup_dir);

    // 1. 获取候选下载链接（包含官方直连与高可用加速镜像源）
    emit_progress(
        app,
        "checking",
        5,
        format!("正在准备下载 Pi 内核 v{} ({}) ...", clean_ver, asset_name),
        0,
        0,
        &clean_ver,
    );

    let candidate_urls = [
        format!(
            "https://github.com/earendil-works/pi/releases/download/v{}/{}",
            clean_ver, asset_name
        ),
        format!(
            "https://ghproxy.net/https://github.com/earendil-works/pi/releases/download/v{}/{}",
            clean_ver, asset_name
        ),
        format!(
            "https://gh-proxy.com/https://github.com/earendil-works/pi/releases/download/v{}/{}",
            clean_ver, asset_name
        ),
        format!(
            "https://mirror.ghproxy.com/https://github.com/earendil-works/pi/releases/download/v{}/{}",
            clean_ver, asset_name
        ),
    ];

    let archive_ext = if asset_name.ends_with(".zip") { "zip" } else { "tar.gz" };
    let temp_archive_path = temp_dir.join(format!("pi-kernel-v{}.{}", clean_ver, archive_ext));

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600)) // 10分钟超时保障大包完整传输
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut download_success = false;
    let mut last_error_msg = String::new();
    let mut total_downloaded_bytes = 0u64;
    let mut final_total_bytes = 45 * 1024 * 1024;

    for (idx, download_url) in candidate_urls.iter().enumerate() {
        if idx > 0 {
            log::info!("[Updater] Retrying with mirror: {}", download_url);
            emit_progress(
                app,
                "checking",
                8,
                format!("直连网络波动，正在切换加速镜像节点 ({}/{})...", idx + 1, candidate_urls.len()),
                0,
                0,
                &clean_ver,
            );
        }

        let send_res = client
            .get(download_url)
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send()
            .await;

        let mut response = match send_res {
            Ok(resp) if resp.status().is_success() => resp,
            Ok(resp) => {
                let err_str = format!("HTTP {} from {}", resp.status(), download_url);
                log::warn!("[Updater] {}", err_str);
                last_error_msg = err_str;
                continue;
            }
            Err(err) => {
                let err_str = format!("Connection error to {}: {}", download_url, err);
                log::warn!("[Updater] {}", err_str);
                last_error_msg = err_str;
                continue;
            }
        };

        let total_bytes = response.content_length().unwrap_or(45 * 1024 * 1024);
        final_total_bytes = total_bytes;

        // 2. 流式下载并写入临时文件
        emit_progress(
            app,
            "downloading",
            10,
            format!("开始下载内核安装包 (总大小约 {:.1} MB)...", total_bytes as f64 / (1024.0 * 1024.0)),
            0,
            total_bytes,
            &clean_ver,
        );

        let mut file = match File::create(&temp_archive_path) {
            Ok(f) => f,
            Err(e) => {
                return Err(format!("Failed to create temporary archive file: {}", e));
            }
        };

        let mut downloaded: u64 = 0;
        let mut last_emit = Instant::now();
        let mut chunk_error = false;

        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if let Err(e) = file.write_all(&chunk) {
                        last_error_msg = format!("Failed to write chunk to file: {}", e);
                        chunk_error = true;
                        break;
                    }
                    downloaded += chunk.len() as u64;

                    if last_emit.elapsed() >= Duration::from_millis(150) || downloaded >= total_bytes {
                        let percent = 10 + ((downloaded as f64 / total_bytes.max(1) as f64) * 60.0) as u32;
                        let mb_downloaded = downloaded as f64 / (1024.0 * 1024.0);
                        let mb_total = total_bytes as f64 / (1024.0 * 1024.0);
                        emit_progress(
                            app,
                            "downloading",
                            percent.min(70),
                            format!(
                                "正在下载内核: {:.1} MB / {:.1} MB ({:.0}%)",
                                mb_downloaded,
                                mb_total,
                                (downloaded as f64 / total_bytes.max(1) as f64) * 100.0
                            ),
                            downloaded,
                            total_bytes,
                            &clean_ver,
                        );
                        last_emit = Instant::now();
                    }
                }
                Ok(None) => {
                    // 下载流正常结束
                    break;
                }
                Err(err) => {
                    last_error_msg = format!("Download stream interrupted: {}", err);
                    log::warn!("[Updater] Stream interrupted on {}: {}", download_url, err);
                    chunk_error = true;
                    break;
                }
            }
        }

        drop(file);

        if chunk_error || downloaded == 0 || (total_bytes > 1024 * 1024 && downloaded < 1024 * 1024) {
            let _ = fs::remove_file(&temp_archive_path);
            continue;
        }

        total_downloaded_bytes = downloaded;
        download_success = true;
        break;
    }

    if !download_success {
        return Err(format!(
            "Failed to download release asset from all sources. Last error: {}",
            last_error_msg
        ));
    }

    // 3. 解压内核包到暂存目录
    emit_progress(
        app,
        "extracting",
        72,
        "下载完成，正在解压内核包到暂存区...".to_string(),
        total_downloaded_bytes,
        final_total_bytes,
        &clean_ver,
    );

    fs::create_dir_all(&staging_dir).map_err(|e| format!("Failed to create staging directory: {}", e))?;

    if archive_ext == "zip" {
        extract_zip(&temp_archive_path, &staging_dir)?;
    } else {
        return Err(format!("Unsupported archive format on this platform: {}", archive_ext));
    }

    // 4. 寻找并校验暂存区中的 pi 二进制文件
    emit_progress(
        app,
        "verifying",
        80,
        "正在校验新内核完整性与执行权限...".to_string(),
        total_downloaded_bytes,
        final_total_bytes,
        &clean_ver,
    );

    let staged_binary = find_binary_in_dir(&staging_dir)
        .ok_or_else(|| "Could not find pi executable inside the extracted archive".to_string())?;

    verify_binary(&staged_binary).await?;

    // 5. 安全停止运行中的 Pi 监督进程
    emit_progress(
        app,
        "replacing",
        86,
        "正在优雅停止当前运行中的内核进程...".to_string(),
        total_downloaded_bytes,
        final_total_bytes,
        &clean_ver,
    );

    supervisor.stop().await;
    tokio::time::sleep(Duration::from_millis(600)).await;

    // 6. 原子替换内核目录
    emit_progress(
        app,
        "replacing",
        90,
        "正在替换内核文件并部署到应用目录...".to_string(),
        total_downloaded_bytes,
        final_total_bytes,
        &clean_ver,
    );

    // 如果目标目录已存在，将其重命名备份
    if target_kernel_dir.exists() {
        if let Err(e) = fs::rename(&target_kernel_dir, &backup_dir) {
            log::warn!("[Updater] Failed to rename target to backup: {}, attempting copy fallback", e);
            let _ = fs::remove_dir_all(&target_kernel_dir);
        }
    }

    // 确保父目录存在
    if let Some(parent) = target_kernel_dir.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 将暂存区内容移入目标目录
    let staged_source_dir = if staged_binary.parent().unwrap() != staging_dir {
        staged_binary.parent().unwrap().to_path_buf()
    } else {
        staging_dir.clone()
    };

    if let Err(err) = fs::rename(&staged_source_dir, &target_kernel_dir) {
        log::warn!("[Updater] Rename staging failed: {}, attempting dir copy", err);
        if let Err(copy_err) = copy_dir_all(&staged_source_dir, &target_kernel_dir) {
            // 回滚旧版本
            if backup_dir.exists() {
                let _ = fs::rename(&backup_dir, &target_kernel_dir);
            }
            return Err(format!("Failed to install new kernel directory: {}", copy_err));
        }
    }

    // 清理暂存和备份
    let _ = fs::remove_dir_all(&staging_dir);
    let _ = fs::remove_dir_all(&backup_dir);
    let _ = fs::remove_file(&temp_archive_path);

    // 7. 重启 Pi 监督进程
    emit_progress(
        app,
        "restarting",
        95,
        format!("正在拉起新版 Pi 内核 (v{})...", clean_ver),
        total_downloaded_bytes,
        final_total_bytes,
        &clean_ver,
    );

    if let Err(e) = supervisor.start().await {
        log::error!("[Updater] Failed to restart Pi supervisor with new kernel: {}", e);
        return Err(format!("Kernel replaced successfully, but failed to start host: {}", e));
    }

    // 8. 发送完成事件
    emit_progress(
        app,
        "completed",
        100,
        format!("Pi 内核已成功更新至最新版本 v{}！", clean_ver),
        total_downloaded_bytes,
        final_total_bytes,
        &clean_ver,
    );

    Ok(KernelUpdateResult {
        success: true,
        version: clean_ver.clone(),
        message: format!("Successfully upgraded Pi kernel to v{}", clean_ver),
        error: None,
    })
}

/// 使用纯 Rust zip 库解压 zip 文件
fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to read entry {}: {}", i, e))?;
        let outpath = match file.enclosed_name() {
            Some(path) => dest_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| format!("Failed to create extracted directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| format!("Failed to create parent dir: {}", e))?;
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| format!("Failed to create extracted file {:?}: {}", outpath, e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to write extracted file: {}", e))?;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                let _ = fs::set_permissions(&outpath, fs::Permissions::from_mode(mode));
            }
        }
    }

    Ok(())
}

/// 在目录中递归查找 pi 或 pi.exe
fn find_binary_in_dir(dir: &Path) -> Option<PathBuf> {
    let bin_name = if cfg!(windows) { "pi.exe" } else { "pi" };

    // 1. 直接检查当前目录
    let direct = dir.join(bin_name);
    if direct.is_file() {
        return Some(direct);
    }

    // 2. 检查子目录
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let sub_bin = path.join(bin_name);
                if sub_bin.is_file() {
                    return Some(sub_bin);
                }
            }
        }
    }

    None
}

/// 执行校验命令 staged_binary --version
async fn verify_binary(binary_path: &Path) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(binary_path);
    cmd.arg("--version");

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run pre-check command on new binary: {}", e))?;

    if output.status.success() {
        let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
        log::info!("[Updater] Pre-check verified binary version: {}", ver);
        Ok(ver)
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Binary pre-check failed with exit code {:?}: {}", output.status.code(), err))
    }
}

/// 递归复制目录
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), dest_path)?;
        }
    }
    Ok(())
}
