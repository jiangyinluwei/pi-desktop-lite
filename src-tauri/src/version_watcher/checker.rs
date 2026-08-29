use crate::security::redaction::redact_str;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const FALLBACK_PI_VERSION: &str = "0.84.3";

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

impl VersionCheckResult {
    pub fn error(current_version: &str, err: String) -> Self {
        Self {
            current_version: current_version.to_string(),
            latest_version: current_version.to_string(),
            has_update: false,
            release_notes: None,
            published_at: None,
            error: Some(err),
        }
    }

    pub fn success(
        current_version: &str,
        latest_version: String,
        has_update: bool,
        release_notes: Option<String>,
        published_at: Option<String>,
    ) -> Self {
        Self {
            current_version: current_version.to_string(),
            latest_version,
            has_update,
            release_notes,
            published_at,
            error: None,
        }
    }
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
    let clean = v.trim().trim_start_matches('v').trim_start_matches('^').trim_start_matches('~').trim_start_matches('@');
    let main_part = clean.split('-').next().unwrap_or(clean);
    let parts: Vec<&str> = main_part.split('.').collect();
    let major = parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

/// 比对是否 remote > local
pub fn is_newer(local: &str, remote: &str) -> bool {
    let (l_maj, l_min, l_pat) = parse_semver(local);
    let (r_maj, r_min, r_pat) = parse_semver(remote);
    (r_maj, r_min, r_pat) > (l_maj, l_min, l_pat)
}

/// 异步检查最新版本（并发请求 npm 与 GitHub 注册表）
pub async fn check_latest_version(current_version: &str) -> VersionCheckResult {
    let client = match reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent("pi-desktop-lite/0.1.0")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return VersionCheckResult::error(
                current_version,
                redact_str(&format!("HTTP client build error: {}", e)),
            );
        }
    };

    // 并发探测 npm registry 与 GitHub Releases
    let npm_fut = async {
        if let Ok(resp) = client.get(NPM_LATEST_URL).send().await {
            if resp.status().is_success() {
                if let Ok(pkg) = resp.json::<NpmPackageResponse>().await {
                    return pkg.version;
                }
            }
        }
        None
    };

    let gh_fut = async {
        if let Ok(resp) = client.get(GITHUB_RELEASES_URL).send().await {
            if resp.status().is_success() {
                if let Ok(gh) = resp.json::<GitHubReleaseResponse>().await {
                    return Some(gh);
                }
            }
        }
        None
    };

    let (npm_ver, gh_info) = tokio::join!(npm_fut, gh_fut);

    let (detected_version, notes, published_at) = match (npm_ver, gh_info) {
        (Some(ver), Some(gh)) => (
            Some(ver),
            gh.body.map(|n| redact_str(&n)),
            gh.published_at,
        ),
        (Some(ver), None) => (Some(ver), None, None),
        (None, Some(gh)) => (
            gh.tag_name.map(|t| t.trim_start_matches('v').to_string()),
            gh.body.map(|n| redact_str(&n)),
            gh.published_at,
        ),
        (None, None) => (None, None, None),
    };

    match detected_version {
        Some(remote_v) => {
            let has_update = is_newer(current_version, &remote_v);
            VersionCheckResult::success(current_version, remote_v, has_update, notes, published_at)
        }
        None => VersionCheckResult::error(
            current_version,
            "Unable to reach remote registries. Offline or degraded.".to_string(),
        ),
    }
}
