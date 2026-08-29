use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// 静态内嵌在二进制 exe 中的插件推荐配置映射表
const PACKAGE_PRESETS_RAW: &str = include_str!("../../presets/package-presets.json");

/// 单个扩展组件的推荐配置项定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePreset {
    pub id: String,
    pub package_names: Vec<String>,
    pub title: String,
    pub description: String,
    pub config_file: String,
    pub settings: serde_json::Map<String, Value>,
}

/// 预设配置 JSON 根对象
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PackagePresetRoot {
    #[serde(default)]
    pub presets: Vec<PackagePreset>,
}

/// 获取所有已内嵌的组件推荐配置映射 (基于 OnceLock 全局缓存，避免重复反序列化)
pub fn get_all_presets() -> &'static [PackagePreset] {
    static PRESETS: std::sync::OnceLock<Vec<PackagePreset>> = std::sync::OnceLock::new();
    PRESETS.get_or_init(|| {
        match serde_json::from_str::<PackagePresetRoot>(PACKAGE_PRESETS_RAW) {
            Ok(root) => root.presets,
            Err(err) => {
                log::error!("[PackagePresets] Failed to parse embedded package-presets.json: {}", err);
                Vec::new()
            }
        }
    })
}

/// 根据包名匹配对应的预设配置定义
pub fn find_preset_for_package(package_name: &str) -> Option<PackagePreset> {
    let clean_name = package_name.trim().trim_start_matches("npm:");
    let presets = get_all_presets();
    presets.iter().find(|preset| {
        preset.package_names.iter().any(|name| {
            let clean_p_name = name.trim().trim_start_matches("npm:");
            clean_p_name.eq_ignore_ascii_case(clean_name)
        })
    }).cloned()
}

/// 将包含 `~` 占位符的配置文件路径解析为绝对系统路径
pub fn resolve_preset_config_path(config_file: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to find user home directory".to_string())?;
    let path = if config_file.starts_with("~/") || config_file.starts_with("~\\") {
        home.join(&config_file[2..])
    } else if config_file == "~" {
        home
    } else {
        PathBuf::from(config_file)
    };
    Ok(path)
}

/// 校验指定预设配置是否已经在目标配置文件中完整生效且键值匹配
pub fn is_preset_applied(preset: &PackagePreset) -> bool {
    let path = match resolve_preset_config_path(&preset.config_file) {
        Ok(p) => p,
        Err(_) => return false,
    };

    if !path.exists() {
        return false;
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let json_val: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let obj = match json_val.as_object() {
        Some(o) => o,
        None => return false,
    };

    // 严格检查预设中的每一个键值对是否与现有配置完全一致
    for (k, expected_v) in &preset.settings {
        match obj.get(k) {
            Some(actual_v) => {
                if actual_v != expected_v {
                    return false;
                }
            }
            None => return false,
        }
    }

    true
}

/// 应用预设配置到目标配置文件，保留用户已有的其他字段，并写入后进行严格回读校验
pub fn apply_preset(preset: &PackagePreset) -> Result<(), String> {
    let path = resolve_preset_config_path(&preset.config_file)?;

    // 确保目标配置文件的父级目录递归存在
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
        }
    }

    // 读取已有配置或初始化新字典
    let mut current_obj = if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read existing config {:?}: {}", path, e))?;
        serde_json::from_str::<Value>(&content)
            .unwrap_or_else(|_| Value::Object(serde_json::Map::new()))
            .as_object()
            .cloned()
            .unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    // 合并覆盖预设键值
    for (k, v) in &preset.settings {
        current_obj.insert(k.clone(), v.clone());
    }

    // 格式化输出写入文件
    let serialized = serde_json::to_string_pretty(&Value::Object(current_obj))
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, format!("{}\n", serialized))
        .map_err(|e| format!("Failed to write config {:?}: {}", path, e))?;

    // 写入后即刻执行严格回读校验
    if !is_preset_applied(preset) {
        return Err(format!(
            "Configuration verification failed after writing to {:?}",
            path
        ));
    }

    log::info!(
        "[PackagePresets] Successfully applied and verified preset '{}' to {:?}",
        preset.title,
        path
    );

    Ok(())
}

/// 根据包名匹配预设并执行应用
pub fn apply_preset_for_package(package_name: &str) -> Result<bool, String> {
    if let Some(preset) = find_preset_for_package(package_name) {
        apply_preset(&preset)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 静态内嵌在二进制 exe 中的推荐扩展组件列表
const RECOMMENDED_PLUGINS_RAW: &str = include_str!("../../presets/recommended-plugins.json");

/// 推荐插件 JSON 根对象
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecommendedPluginsRoot {
    #[serde(default)]
    pub plugins: Vec<super::models::RecommendedPlugin>,
}

/// 获取所有已内嵌的推荐扩展组件列表 (基于 OnceLock 全局缓存，避免重复反序列化)
pub fn get_recommended_plugins() -> &'static [super::models::RecommendedPlugin] {
    static RECOMMENDED: std::sync::OnceLock<Vec<super::models::RecommendedPlugin>> = std::sync::OnceLock::new();
    RECOMMENDED.get_or_init(|| {
        match serde_json::from_str::<RecommendedPluginsRoot>(RECOMMENDED_PLUGINS_RAW) {
            Ok(root) => root.plugins,
            Err(err) => {
                log::error!("[PackagePresets] Failed to parse embedded recommended-plugins.json: {}", err);
                Vec::new()
            }
        }
    })
}

