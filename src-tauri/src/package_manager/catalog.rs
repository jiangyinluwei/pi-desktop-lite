use super::models::{PackageInfo, PackageSearchResult};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

const CATALOG_CACHE_TTL: Duration = Duration::from_secs(15 * 60); // 15 分钟缓存

static CATALOG_CACHE: Lazy<RwLock<HashMap<String, (Instant, PackageSearchResult)>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

static REGEX_PACKAGES_COUNT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"class=["']packages-count["'][^>]*>\s*\d+-\d+\s*/\s*([0-9,]+)"#).unwrap()
});

static REGEX_ARTICLE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?s)<article[^>]+data-package-card="true".*?</article>"#).unwrap()
});

static REGEX_ATTR_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-package-name="([^"]+)""#).unwrap());
static REGEX_ATTR_TYPES: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-package-types="([^"]*)""#).unwrap());
static REGEX_ATTR_DOWNLOADS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-package-downloads="([^"]*)""#).unwrap());
static REGEX_ATTR_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"data-package-date="([^"]*)""#).unwrap());

static REGEX_DESC: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<p class="packages-desc">(.*?)</p>"#).unwrap());

static REGEX_META_SPANS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?s)<div class="packages-meta">\s*<span>(.*?)</span>\s*<span>(.*?)</span>\s*<span>(.*?)</span>"#).unwrap()
});

static REGEX_NPM_LINK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"href="(https?://(?:www\.)?npmjs\.com/package/[^"]+)""#).unwrap());
static REGEX_REPO_LINK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"href="(https?://github\.com/[^"]+)""#).unwrap());
static REGEX_HTML_TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<[^>]+>"#).unwrap());

/// 简单 HTML 实体解码与标签去除
fn clean_html_text(text: &str) -> String {
    let unescaped = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'");
    
    // 移除 HTML 标签
    let stripped = REGEX_HTML_TAG.replace_all(&unescaped, "");
    stripped.trim().to_string()
}

/// 构建请求 URL
fn url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'@' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push('+'),
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

pub fn build_catalog_url(
    query: Option<&str>,
    pkg_type: Option<&str>,
    sort: Option<&str>,
    page: u32,
) -> String {
    let mut params = Vec::new();
    if let Some(q) = query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            params.push(format!("name={}", url_encode(trimmed)));
        }
    }
    if let Some(t) = pkg_type {
        let trimmed = t.trim();
        if !trimmed.is_empty() && trimmed != "all" {
            params.push(format!("type={}", url_encode(trimmed)));
        }
    }
    if let Some(s) = sort {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            params.push(format!("sort={}", url_encode(trimmed)));
        }
    }
    if page > 1 {
        params.push(format!("page={}", page));
    }

    if params.is_empty() {
        "https://pi.dev/packages".to_string()
    } else {
        format!("https://pi.dev/packages?{}", params.join("&"))
    }
}

/// 解析官网 HTML 为结构化数据
pub fn parse_catalog_html(html: &str, current_page: u32) -> PackageSearchResult {
    // 1. 解析匹配总数
    let total_count: u32 = if let Some(caps) = REGEX_PACKAGES_COUNT.captures(html) {
        if let Some(matched) = caps.get(1) {
            let num_str = matched.as_str().replace(',', "");
            num_str.parse().unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };

    // 2. 逐个解析 <article> 卡片
    let mut packages = Vec::new();
    for article_match in REGEX_ARTICLE.find_iter(html) {
        let article_str = article_match.as_str();

        let name = if let Some(caps) = REGEX_ATTR_NAME.captures(article_str) {
            caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()
        } else {
            continue;
        };

        if name.is_empty() {
            continue;
        }

        let pkg_type = if let Some(caps) = REGEX_ATTR_TYPES.captures(article_str) {
            let raw_type = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if raw_type.is_empty() {
                "extension".to_string()
            } else {
                raw_type.to_string()
            }
        } else {
            "extension".to_string()
        };

        let downloads: u64 = if let Some(caps) = REGEX_ATTR_DOWNLOADS.captures(article_str) {
            caps.get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0)
        } else {
            0
        };

        let date: u64 = if let Some(caps) = REGEX_ATTR_DATE.captures(article_str) {
            caps.get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0)
        } else {
            0
        };

        let description = if let Some(caps) = REGEX_DESC.captures(article_str) {
            clean_html_text(caps.get(1).map(|m| m.as_str()).unwrap_or(""))
        } else {
            String::new()
        };

        let (author, downloads_formatted, time_ago) =
            if let Some(caps) = REGEX_META_SPANS.captures(article_str) {
                let a = clean_html_text(caps.get(1).map(|m| m.as_str()).unwrap_or(""));
                let d = clean_html_text(caps.get(2).map(|m| m.as_str()).unwrap_or(""));
                let t = clean_html_text(caps.get(3).map(|m| m.as_str()).unwrap_or(""));
                (a, d, t)
            } else {
                (String::new(), String::new(), String::new())
            };

        let npm_url = REGEX_NPM_LINK
            .captures(article_str)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));

        let repo_url = REGEX_REPO_LINK
            .captures(article_str)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            .filter(|url| !url.contains("earendil-works/pi/issues"));

        let install_command = format!("pi install npm:{}", name);

        packages.push(PackageInfo {
            name,
            description,
            author,
            pkg_type,
            downloads,
            downloads_formatted,
            date,
            time_ago,
            npm_url,
            repo_url,
            install_command,
        });
    }

    let calculated_total = if total_count > 0 {
        total_count
    } else {
        packages.len() as u32
    };

    let total_pages = if calculated_total == 0 {
        1
    } else {
        (calculated_total + 49) / 50
    };

    let has_more = current_page < total_pages;

    PackageSearchResult {
        packages,
        page: current_page,
        total_count: calculated_total,
        total_pages,
        has_more,
    }
}

/// 检索官网组件目录
pub async fn search_catalog(
    query: Option<String>,
    pkg_type: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
) -> Result<PackageSearchResult, String> {
    let current_page = page.unwrap_or(1).max(1);
    let cache_key = format!(
        "q={}|t={}|s={}|p={}",
        query.as_deref().unwrap_or(""),
        pkg_type.as_deref().unwrap_or(""),
        sort.as_deref().unwrap_or(""),
        current_page
    );

    // 检查缓存
    if let Ok(cache) = CATALOG_CACHE.read() {
        if let Some((inserted_at, result)) = cache.get(&cache_key) {
            if inserted_at.elapsed() < CATALOG_CACHE_TTL {
                return Ok(result.clone());
            }
        }
    }

    let url = build_catalog_url(
        query.as_deref(),
        pkg_type.as_deref(),
        sort.as_deref(),
        current_page,
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("pi-desktop-lite/0.1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch packages from {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Package catalog returned HTTP error {}: {}",
            response.status(),
            url
        ));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let result = parse_catalog_html(&html, current_page);

    // 存入缓存
    if let Ok(mut cache) = CATALOG_CACHE.write() {
        cache.insert(cache_key, (Instant::now(), result.clone()));
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_live_search_catalog() {
        let res = search_catalog(None, None, Some("downloads".to_string()), Some(1))
            .await
            .expect("search_catalog failed");
        println!(
            "Fetched {} packages, total_count: {}, pages: {}",
            res.packages.len(),
            res.total_count,
            res.total_pages
        );
        assert!(!res.packages.is_empty(), "packages should not be empty");
        println!("First package: {:?}", res.packages[0]);
    }
}

