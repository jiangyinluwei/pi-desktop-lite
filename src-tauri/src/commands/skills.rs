//! `commands/skills` — 运行态内置技能规则与工具映射指令。

use crate::pi_runner::{PiSupervisor, SkillMapping};
use tauri::State;

/// 获取内置技能规则总纲 (RULES.md)
#[tauri::command]
pub fn pi_get_inner_skills_rules(supervisor: State<'_, PiSupervisor>) -> Result<String, String> {
    Ok(supervisor.get_skill_rules().to_string())
}

/// 获取工具 → 技能映射矩阵
#[tauri::command]
pub fn pi_get_skill_mappings(
    supervisor: State<'_, PiSupervisor>,
) -> Result<Vec<SkillMapping>, String> {
    Ok(supervisor.get_skill_mappings())
}

/// 解析指定工具命中的技能（供运行态按需注入）
#[tauri::command]
pub fn pi_resolve_tool_skill(
    supervisor: State<'_, PiSupervisor>,
    tool_name: String,
) -> Result<Option<String>, String> {
    Ok(supervisor.resolve_skill_for_tool(&tool_name))
}
