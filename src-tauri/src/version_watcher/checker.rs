use crate::security::redaction::redact_str;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const NPM_LATEST_URL: &str = "https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest";
const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/earendil-works/pi/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct NpmPackageResponse {
    version: Option<String>,
}

#[derive(Deserialize)]
struct GitHubReleaseResponse {
    tag_name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
}

/// 解析 SemVer 字符串为 (major, minor, patch)
pub fn parse_semver(v: &str) -> (u64, u64, u64) {
    let clean = v.trim().trim_start_matches('v').trim_start_matches('@');
    let parts: Vec<&str> = clean.split('.').collect();
    let major = parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts
        .get(2)
        .and_then(|s| s.split('-').next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    (major, minor, patch)
}

/// 比对是否 remote > local
pub fn is_newer(local: &str, remote: &str) -> bool {
    let (l_maj, l_min, l_pat) = parse_semver(local);
    let (r_maj, r_min, r_pat) = parse_semver(remote);
    (r_maj, r_min, r_pat) > (l_maj, l_min, l_pat)
}

/// 异步检查最新版本
pub async fn check_latest_version(current_version: &str) -> VersionCheckResult {
    let client = match reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent("pi-desktop-lite/0.1.0")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return VersionCheckResult {
                current_version: current_version.to_string(),
                latest_version: current_version.to_string(),
                has_update: false,
                release_notes: None,
                published_at: None,
                error: Some(redact_str(&format!("HTTP client build error: {}", e))),
            };
        }
    };

    // 1. 尝试从 npm registry 探测版本
    let mut detected_version = None;
    if let Ok(resp) = client.get(NPM_LATEST_URL).send().await {
        if resp.status().is_success() {
            if let Ok(pkg) = resp.json::<NpmPackageResponse>().await {
                detected_version = pkg.version;
            }
        }
    }

    // 2. 尝试从 GitHub Releases 获取 changelog 及备用版本
    let mut notes = None;
    let mut published_at = None;
    if let Ok(resp) = client.get(GITHUB_RELEASES_URL).send().await {
        if resp.status().is_success() {
            if let Ok(gh) = resp.json::<GitHubReleaseResponse>().await {
                if detected_version.is_none() {
                    detected_version = gh.tag_name.map(|t| t.trim_start_matches('v').to_string());
                }
                notes = gh.body;
                published_at = gh.published_at;
            }
        }
    }

    match detected_version {
        Some(remote_v) => {
            let has_update = is_newer(current_version, &remote_v);
            VersionCheckResult {
                current_version: current_version.to_string(),
                latest_version: remote_v,
                has_update,
                release_notes: notes.map(|n| redact_str(&n)),
                published_at,
                error: None,
            }
        }
        None => VersionCheckResult {
            current_version: current_version.to_string(),
            latest_version: current_version.to_string(),
            has_update: false,
            release_notes: None,
            published_at: None,
            error: Some("Unable to reach remote registries. Offline or degraded.".to_string()),
        },
    }
}
