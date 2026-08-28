use serde::{Deserialize, Serialize};

/// 官网组件信息结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub name: String,
    pub description: String,
    pub author: String,
    pub pkg_type: String,
    pub downloads: u64,
    pub downloads_formatted: String,
    pub date: u64,
    pub time_ago: String,
    pub npm_url: Option<String>,
    pub repo_url: Option<String>,
    pub install_command: String,
}

/// 搜索与分页结果返回体
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageSearchResult {
    pub packages: Vec<PackageInfo>,
    pub page: u32,
    pub total_count: u32,
    pub total_pages: u32,
    pub has_more: bool,
}

/// 本地已安装组件结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPackage {
    pub name: String,
    pub version: String,
    pub description: String,
    pub source: String,
}

/// 组件更新检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageUpdateInfo {
    pub name: String,
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
}

/// 组件安装/卸载/更新实时进度事件载荷
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageProgressPayload {
    pub package_name: String,
    pub stage: String,
    pub percent: u32,
    pub message: String,
}

