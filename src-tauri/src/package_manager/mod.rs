pub mod catalog;
pub mod installer;
pub mod models;
pub mod presets;

pub use catalog::search_catalog;
pub use installer::{
    check_node_environment, check_package_updates, get_installed_packages, install_package,
    uninstall_package, update_package,
};
pub use models::{
    InstalledPackage, NodeEnvironmentInfo, PackageInfo, PackageSearchResult, PackageUpdateInfo,
    RecommendedPlugin,
};
pub use presets::{
    apply_preset_for_package, find_preset_for_package, get_recommended_plugins, is_preset_applied,
    PackagePreset,
};

#[tauri::command]
pub async fn pi_check_node_environment() -> Result<NodeEnvironmentInfo, String> {
    Ok(check_node_environment().await)
}

#[tauri::command]
pub fn pi_get_recommended_plugins() -> Result<Vec<RecommendedPlugin>, String> {
    Ok(get_recommended_plugins().to_vec())
}

#[tauri::command]
pub fn pi_apply_package_preset(package_name: String) -> Result<bool, String> {
    apply_preset_for_package(&package_name)
}


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

