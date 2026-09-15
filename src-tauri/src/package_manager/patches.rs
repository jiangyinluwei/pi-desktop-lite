//! 组件缺陷补丁预设 (Package Patch Presets)
//!
//! 与 `presets.rs` 的「推荐配置预设」互补：后者向组件配置文件合并键值，本模块把
//! 应用层修复过的组件源码文件（编译期 `include_str!` 内嵌进二进制）物化到已安装
//! 组件的 node_modules 目录，修复第三方组件在本机环境上的缺陷。
//!
//! 典型范例：pi-ocr 1.4.x 在 Windows 上三处硬编码 `spawn("python3")`，而 Windows
//! PATH 上的 `python3` 通常是 Microsoft Store 的 app-execution-alias 占位 stub
//! （退出码 49 并打印 "Python was not found; run without arguments to install
//! from the Microsoft Store..."），导致默认 MinerU 后端处理图片前的 PIL 打包步骤
//! 必失败；`getPdfPageCount` 又缺少 win32 分支恒返回 1，>20 页 PDF 整包直发
//! MinerU 免费档被服务端拒绝。本模块把修复后的四个文件落盘到
//! `~/.pi/agent/npm/node_modules/pi-ocr/extensions/`。
//!
//! 三道安全闸门：
//! - **版本闸门**：仅当已安装组件版本匹配清单 `version_prefixes`（major.minor 精确
//!   匹配，`"*"` 表示任意）时才应用，组件升级换版后不盲目覆盖可能已重排或上游已
//!   修复的文件；
//! - **存在性闸门**：`create: false` 的条目仅在目标文件已存在时覆盖（版本闸门已放行
//!   却找不到目标文件说明上游改了布局，直接报错暴露漂移），`create: true` 允许新增；
//! - **幂等 + 回读校验**：内容与内嵌源一致时跳过写入，写入后严格回读比对全部文件。
//!
//! 三个应用时机（与推荐配置预设一致）：组件安装完成（installer.rs）、组件更新完成
//! （installer.rs，npm 会覆盖 node_modules 故需重打）、应用启动自愈（lib.rs setup）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::config_manager::get_pi_agent_dir;

/// 静态内嵌在二进制 exe 中的组件缺陷补丁映射表
const PACKAGE_PATCHES_RAW: &str = include_str!("../../presets/package-patches.json");

/// 内嵌的补丁源码文件（与 `presets/patches/` 目录一一对应，source 字段映射到这些常量）
const PATCH_PI_OCR_PYTHON_TS: &str = include_str!("../../presets/patches/pi-ocr/python.ts");
const PATCH_PI_OCR_MINERU_TS: &str = include_str!("../../presets/patches/pi-ocr/mineru.ts");
const PATCH_PI_OCR_PIX2TEXT_TS: &str = include_str!("../../presets/patches/pi-ocr/pix2text.ts");
const PATCH_PI_OCR_OLLAMA_TS: &str = include_str!("../../presets/patches/pi-ocr/ollama.ts");

/// 单个补丁文件定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFile {
    /// 内嵌源在 `presets/patches/` 下的相对路径（如 `pi-ocr/python.ts`）
    pub source: String,
    /// 目标文件在组件根目录下的相对路径（如 `extensions/python.ts`）
    pub target: String,
    /// `true` 允许新增目标文件；`false` 仅在目标已存在时覆盖
    #[serde(default)]
    pub create: bool,
}

/// 单个组件的补丁集定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchSet {
    pub id: String,
    pub package_names: Vec<String>,
    pub title: String,
    pub description: String,
    /// 允许应用的已安装组件版本（major.minor 精确匹配，如 `["1.4"]` 命中 1.4.0/1.4.1）；
    /// `["*"]` 表示任意版本。版本不匹配时跳过，避免覆盖升级后可能已修复的上游文件。
    pub version_prefixes: Vec<String>,
    pub files: Vec<PatchFile>,
}

/// 补丁映射表 JSON 根对象
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PatchRoot {
    #[serde(default)]
    pub patches: Vec<PatchSet>,
}

/// 获取所有已内嵌的组件缺陷补丁集（基于 OnceLock 全局缓存，避免重复反序列化）
pub fn get_all_patch_sets() -> &'static [PatchSet] {
    static PATCHES: std::sync::OnceLock<Vec<PatchSet>> = std::sync::OnceLock::new();
    PATCHES.get_or_init(|| {
        match serde_json::from_str::<PatchRoot>(PACKAGE_PATCHES_RAW) {
            Ok(root) => root.patches,
            Err(err) => {
                log::error!(
                    "[PackagePatches] Failed to parse embedded package-patches.json: {}",
                    err
                );
                Vec::new()
            }
        }
    })
}

/// 根据补丁 source 名称取出内嵌的源码内容
fn patch_source_by_name(source: &str) -> Option<&'static str> {
    match source {
        "pi-ocr/python.ts" => Some(PATCH_PI_OCR_PYTHON_TS),
        "pi-ocr/mineru.ts" => Some(PATCH_PI_OCR_MINERU_TS),
        "pi-ocr/pix2text.ts" => Some(PATCH_PI_OCR_PIX2TEXT_TS),
        "pi-ocr/ollama.ts" => Some(PATCH_PI_OCR_OLLAMA_TS),
        _ => {
            log::error!("[PackagePatches] Unknown patch source '{}'", source);
            None
        }
    }
}

/// 根据包名匹配对应的补丁集
pub fn find_patch_set_for_package(package_name: &str) -> Option<PatchSet> {
    let clean_name = super::installer::extract_npm_package_name(package_name);
    get_all_patch_sets()
        .iter()
        .find(|patch_set| {
            patch_set.package_names.iter().any(|name| {
                let clean_p_name = super::installer::extract_npm_package_name(name);
                clean_p_name.eq_ignore_ascii_case(&clean_name)
            })
        })
        .cloned()
}

/// 定位已安装组件的根目录与其版本（读取 node_modules/<pkg>/package.json）
///
/// 返回 `(组件根目录绝对路径, 版本号字符串)`，未安装时返回 `None`
pub fn resolve_installed_package(package_name: &str) -> Option<(PathBuf, String)> {
    let clean_name = super::installer::extract_npm_package_name(package_name);
    let agent_dir = get_pi_agent_dir().ok()?;
    let pkg_root = agent_dir
        .join("npm")
        .join("node_modules")
        .join(&clean_name);
    let pkg_json = pkg_root.join("package.json");
    if !pkg_json.exists() {
        return None;
    }
    let version = fs::read_to_string(&pkg_json)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|v| v.get("version").and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_else(|| "unknown".to_string());
    Some((pkg_root, version))
}

/// 取版本号的 `major.minor` 段（如 `1.4.0` → `1.4`，异常时回落原值）
fn major_minor(version: &str) -> String {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() >= 2 {
        format!("{}.{}", parts[0], parts[1])
    } else {
        version.to_string()
    }
}

/// 版本闸门：已安装版本是否落在补丁支持的版本范围内
fn is_version_supported(patch_set: &PatchSet, version: &str) -> bool {
    if patch_set.version_prefixes.iter().any(|v| v == "*") {
        return true;
    }
    let installed_mm = major_minor(version);
    patch_set
        .version_prefixes
        .iter()
        .any(|allowed| allowed.as_str() == installed_mm.as_str())
}

/// 校验补丁集是否已完整落盘（全部目标文件存在且内容与内嵌源一致）
pub fn is_patch_set_applied(patch_set: &PatchSet, package_root: &Path) -> bool {
    patch_set.files.iter().all(|file| {
        let Some(expected) = patch_source_by_name(&file.source) else {
            return false;
        };
        let target = package_root.join(&file.target);
        match fs::read_to_string(&target) {
            Ok(content) => content == expected,
            Err(_) => false,
        }
    })
}

/// 应用补丁集到已安装组件目录（版本闸门通过后逐一写入，幂等并回读校验）
pub fn apply_patch_set(patch_set: &PatchSet, package_root: &Path, version: &str) -> Result<(), String> {
    if !is_version_supported(patch_set, version) {
        return Err(format!(
            "补丁 '{}' 不支持组件版本 '{}'（支持范围: {}）—— 组件可能已修复或调整布局，已跳过",
            patch_set.title,
            version,
            patch_set.version_prefixes.join(" / ")
        ));
    }

    for file in &patch_set.files {
        let expected = patch_source_by_name(&file.source)
            .ok_or_else(|| format!("未知的补丁源文件 '{}'", file.source))?;
        let target = package_root.join(&file.target);

        if !file.create && !target.exists() {
            return Err(format!(
                "补丁 '{}' 目标文件 {:?} 不存在（组件 {} 可能已调整文件布局，已中止避免破坏）",
                patch_set.title, target, version
            ));
        }

        // 幂等：内容一致时跳过写入
        if let Ok(existing) = fs::read_to_string(&target) {
            if existing == expected {
                continue;
            }
        }

        if let Some(parent) = target.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录 {:?} 失败: {}", parent, e))?;
            }
        }
        fs::write(&target, expected)
            .map_err(|e| format!("写入补丁文件 {:?} 失败: {}", target, e))?;
        log::info!("[PackagePatches] Patched {:?} -> {:?}", file.source, target);
    }

    // 写入后严格回读校验全部文件
    if !is_patch_set_applied(patch_set, package_root) {
        return Err(format!(
            "补丁 '{}' 写入后回读校验失败",
            patch_set.title
        ));
    }

    log::info!(
        "[PackagePatches] Successfully applied and verified patch '{}' for package version {}",
        patch_set.title,
        version
    );
    Ok(())
}

/// 启动时自愈已安装组件的缺陷补丁：遍历已安装组件，把未生效的补丁自动补打。
/// 应对组件升级（npm 覆盖 node_modules）后补丁丢失、或组件安装时尚未及打补丁的情形。
pub fn self_heal_installed_package_patches() {
    let installed = match super::installer::get_installed_packages() {
        Ok(list) => list,
        Err(e) => {
            log::warn!(
                "[PackagePatches] Self-heal skipped: failed to list installed packages: {}",
                e
            );
            return;
        }
    };

    for pkg in installed {
        let Some(patch_set) = find_patch_set_for_package(&pkg.name) else {
            continue;
        };
        let Some((package_root, version)) = resolve_installed_package(&pkg.name) else {
            continue;
        };
        if is_patch_set_applied(&patch_set, &package_root) {
            continue;
        }
        match apply_patch_set(&patch_set, &package_root, &version) {
            Ok(_) => log::info!(
                "[PackagePatches] Self-healed patch '{}' for installed package '{}' v{}",
                patch_set.title,
                pkg.name,
                version
            ),
            Err(e) => log::warn!(
                "[PackagePatches] Self-heal skipped for package '{}' v{}: {}",
                pkg.name,
                version,
                e
            ),
        }
    }
}

/// 根据包名匹配补丁集并执行应用（前端「修复补丁」按钮入口）
pub fn apply_patches_for_package(package_name: &str) -> Result<bool, String> {
    let Some(patch_set) = find_patch_set_for_package(package_name) else {
        return Ok(false);
    };
    let (package_root, version) = resolve_installed_package(package_name)
        .ok_or_else(|| format!("组件 '{}' 尚未安装，无法应用补丁", package_name))?;
    apply_patch_set(&patch_set, &package_root, &version)?;
    Ok(true)
}
