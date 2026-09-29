use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;


/// 获取 ~/.pi/agent 目录路径并确保其存在
pub fn get_pi_agent_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to find user home directory".to_string())?;
    let agent_dir = home.join(".pi").join("agent");
    if !agent_dir.exists() {
        fs::create_dir_all(&agent_dir)
            .map_err(|e| format!("Failed to create directory {:?}: {}", agent_dir, e))?;
    }
    Ok(agent_dir)
}

/// 获取 ~/.pi-dl 目录路径并确保其存在 (若不存在则自动新建)
pub fn get_pi_dl_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to find user home directory".to_string())?;
    let pi_dl_dir = home.join(".pi-dl");
    if !pi_dl_dir.exists() {
        fs::create_dir_all(&pi_dl_dir)
            .map_err(|e| format!("Failed to create directory {:?}: {}", pi_dl_dir, e))?;
    }
    Ok(pi_dl_dir)
}

/// 通用底层读取指定目录下的 JSON 配置文件
///
/// 文件缺失 → Ok(default_val)；文件存在但 JSON 损坏 → Err 并落 error 日志。
/// 严禁损坏时静默以默认值顶替——调用方随后任意一次保存会把默认值写回磁盘，
/// 造成用户配置无痕迹永久丢失；损坏必须显式暴露（调用方均以 unwrap_or_else /
/// if let Ok 优雅兜底，不会 panic）。
fn read_json_in(dir: PathBuf, filename: &str, default_val: Value) -> Result<Value, String> {
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(default_val);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    serde_json::from_str(&content).map_err(|e| {
        let msg = format!(
            "Config file {} is corrupted (JSON parse failed: {}); refusing to silently replace with defaults",
            filename, e
        );
        log::error!("{}", msg);
        msg
    })
}

/// 通用底层写入指定目录下的 JSON 配置文件（temp 落盘 + rename 原子替换）
///
/// 直接 fs::write 覆盖原文件时，写盘中途崩溃/断电会留下截断文件，被下次读取
/// 判定为损坏；先写同目录临时文件再 rename（Windows 下为 MOVEFILE_REPLACE_EXISTING，
/// 可原子覆盖已存在目标）保证任意时刻磁盘上都存在一份完整配置。
fn write_json_in(dir: PathBuf, filename: &str, data: &Value) -> Result<(), String> {
    let path = dir.join(filename);
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize {}: {}", filename, e))?;
    let tmp_path = dir.join(format!("{}.tmp", filename));
    let write_result = (|| -> std::io::Result<()> {
        let mut tmp = fs::File::create(&tmp_path)?;
        tmp.write_all(content.as_bytes())?;
        tmp.flush()?;
        tmp.sync_all()
    })()
    .map_err(|e| format!("Failed to write temp file {}: {}", tmp_path.display(), e));
    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }
    fs::rename(&tmp_path, &path)
        .map(|_| ())
        .map_err(|e| {
            let _ = fs::remove_file(&tmp_path);
            format!("Failed to atomically replace {}: {}", path.display(), e)
        })
}

/// 通用安全读取 ~/.pi-dl/ 下的 JSON 配置文件
pub fn read_pi_dl_json(filename: &str, default_val: Value) -> Result<Value, String> {
    read_json_in(get_pi_dl_dir()?, filename, default_val)
}

/// 通用安全写入 ~/.pi-dl/ 下的 JSON 配置文件
pub fn write_pi_dl_json(filename: &str, data: &Value) -> Result<(), String> {
    write_json_in(get_pi_dl_dir()?, filename, data)
}

/// 通用安全读取 ~/.pi/agent/ 下的 JSON 配置文件
pub fn read_agent_json(filename: &str, default_val: Value) -> Result<Value, String> {
    read_json_in(get_pi_agent_dir()?, filename, default_val)
}

/// 通用安全写入 ~/.pi/agent/ 下的 JSON 配置文件
pub fn write_agent_json(filename: &str, data: &Value) -> Result<(), String> {
    write_json_in(get_pi_agent_dir()?, filename, data)
}
