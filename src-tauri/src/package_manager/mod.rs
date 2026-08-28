pub mod catalog;
pub mod installer;
pub mod models;

pub use catalog::search_catalog;
pub use installer::{
    check_package_updates, get_installed_packages, install_package, uninstall_package, update_package,
};
pub use models::{InstalledPackage, PackageInfo, PackageSearchResult, PackageUpdateInfo};

#[tauri::command]
pub async fn pi_search_packages(
    query: Option<String>,
    pkg_type: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
) -> Result<PackageSearchResult, String> {
    search_catalog(query, pkg_type, sort, page).await
}

#[tauri::command]
pub fn pi_get_installed_packages() -> Result<Vec<InstalledPackage>, String> {
    get_installed_packages()
}

#[tauri::command]
pub async fn pi_install_package(
    app_handle: tauri::AppHandle,
    package_name: String,
) -> Result<String, String> {
    install_package(&app_handle, &package_name).await
}

#[tauri::command]
pub async fn pi_uninstall_package(
    app_handle: tauri::AppHandle,
    package_name: String,
) -> Result<String, String> {
    uninstall_package(&app_handle, &package_name).await
}

#[tauri::command]
pub async fn pi_check_package_updates() -> Result<Vec<PackageUpdateInfo>, String> {
    check_package_updates().await
}

#[tauri::command]
pub async fn pi_update_package(
    app_handle: tauri::AppHandle,
    package_name: String,
) -> Result<String, String> {
    update_package(&app_handle, &package_name).await
}
