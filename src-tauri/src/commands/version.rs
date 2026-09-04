//! `commands/version` — 内核版本检测、更新与缓存。

use crate::pi_runner::PiSupervisor;
use crate::version_watcher::{VersionCheckResult, VersionScheduler};
use std::sync::Arc;
use tauri::State;

/// 是否检测到 pi 内核
#[tauri::command]
pub fn pi_has_kernel(supervisor: State<'_, PiSupervisor>) -> bool {
    supervisor.has_kernel()
}

/// 立即检查一次内核版本更新
#[tauri::command]
pub async fn pi_check_update(
    supervisor: State<'_, PiSupervisor>,
    scheduler: State<'_, Arc<VersionScheduler>>,
) -> Result<VersionCheckResult, String> {
    let current_ver = if supervisor.has_kernel() {
        supervisor
            .get_version()
            .await
            .unwrap_or_else(|| crate::version_watcher::checker::FALLBACK_PI_VERSION.to_string())
    } else {
        "".to_string()
    };
    Ok(scheduler.check_now(&current_ver).await)
}

/// 获取缓存的内核版本更新结果（若有）
#[tauri::command]
pub async fn pi_get_cached_update(
    scheduler: State<'_, Arc<VersionScheduler>>,
) -> Result<Option<VersionCheckResult>, String> {
    Ok(scheduler.get_cached_result().await)
}
