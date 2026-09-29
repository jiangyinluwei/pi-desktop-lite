//! app_meta.rs — 应用级元信息单一出口
//!
//! HTTP User-Agent 等随包版本演进的标识符统一从此读取（`env!("CARGO_PKG_VERSION")`
//! 编译期取自 Cargo.toml），此前 catalog / checker / installer 三处硬编码
//! `pi-desktop-lite/0.1.2` 将随版本升级漂移，收敛后不再需要手工同步。

/// HTTP 客户端 User-Agent（catalog 目录拉取 / 内核版本检查 / 内核下载共用）
pub fn user_agent() -> String {
    format!("pi-desktop-lite/{}", env!("CARGO_PKG_VERSION"))
}
