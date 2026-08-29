use crate::pi_runner::PiSupervisor;
use crate::version_watcher::checker::{check_latest_version, VersionCheckResult};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

const INITIAL_DELAY: Duration = Duration::from_secs(2);
const BASE_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 3600); // 6 小时
const JITTER_RATIO: f64 = 0.08; // ±8% 随机浮动

pub struct VersionScheduler {
    app_handle: AppHandle,
    last_result: Arc<RwLock<Option<VersionCheckResult>>>,
}

impl VersionScheduler {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            last_result: Arc::new(RwLock::new(None)),
        }
    }

    /// 计算带 ±8% Jitter 抖动的下次等待时间
    fn calculate_jittered_interval(base: Duration) -> Duration {
        let now_micros = chrono::Utc::now().timestamp_subsec_micros() as f64;
        let factor = ((now_micros % 1000.0) / 1000.0) * 2.0 - 1.0; // [-1.0, 1.0]
        let offset_secs = (base.as_secs_f64() * JITTER_RATIO) * factor;
        let final_secs = (base.as_secs_f64() + offset_secs).max(60.0);
        Duration::from_secs_f64(final_secs)
    }

    /// 获取最近一次检查结果
    pub async fn get_cached_result(&self) -> Option<VersionCheckResult> {
        self.last_result.read().await.clone()
    }

    /// 手动执行一次即时版本检查
    pub async fn check_now(&self, current_version: &str) -> VersionCheckResult {
        let result = check_latest_version(current_version).await;
        {
            let mut w = self.last_result.write().await;
            *w = Some(result.clone());
        }
        let _ = self.app_handle.emit("pi:update", &result);
        result
    }

    /// 启动后台版本轮询任务（使用 Tauri 异步运行时，确保跨线程安全）
    pub fn start_background_loop(self: Arc<Self>, supervisor: PiSupervisor) {
        tauri::async_runtime::spawn(async move {
            // 初始延迟 2 秒，让应用先完成启动与首次渲染
            tokio::time::sleep(INITIAL_DELAY).await;

            loop {
                // 若用户已设置“不再提醒更新”，直接跳过启动自检与后台自动轮询（不发网络请求）
                // 用户在设置页主动点击“检查更新”时，会自动重置此标记并恢复
                if !crate::config_manager::is_update_notification_ignored() {
                    let current_ver = supervisor
                        .get_version()
                        .await
                        .unwrap_or_else(|| crate::version_watcher::checker::FALLBACK_PI_VERSION.to_string());
                    let res = self.check_now(&current_ver).await;
                    if res.has_update {
                        log::info!(
                            "[VersionWatcher] New Pi version detected: {} (current: {})",
                            res.latest_version,
                            res.current_version
                        );
                    }
                } else {
                    log::info!("[VersionWatcher] Auto update check skipped (ignoreUpdateNotification is true)");
                }

                let next_sleep = Self::calculate_jittered_interval(BASE_CHECK_INTERVAL);
                tokio::time::sleep(next_sleep).await;
            }
        });
    }
}
