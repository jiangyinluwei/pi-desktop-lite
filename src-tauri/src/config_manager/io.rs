use serde_json::Value;
use std::fs;
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
fn read_json_in(dir: PathBuf, filename: &str, default_val: Value) -> Result<Value, String> {
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(default_val);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    Ok(serde_json::from_str(&content).unwrap_or(default_val))
}

/// 通用底层写入指定目录下的 JSON 配置文件
fn write_json_in(dir: PathBuf, filename: &str, data: &Value) -> Result<(), String> {
    let path = dir.join(filename);
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize {}: {}", filename, e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))
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
