pub mod checker;
pub mod scheduler;
pub mod updater;

pub use checker::{check_latest_version, VersionCheckResult};
pub use scheduler::VersionScheduler;
pub use updater::{perform_kernel_update, KernelUpdateProgressPayload, KernelUpdateResult};

#[tauri::command]
pub async fn pi_update_kernel(
    app_handle: tauri::AppHandle,
    supervisor: tauri::State<'_, crate::pi_runner::PiSupervisor>,
    target_version: String,
) -> Result<KernelUpdateResult, String> {
    perform_kernel_update(app_handle, supervisor.inner().clone(), target_version).await
}

