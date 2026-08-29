use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

/// 编译期内嵌默认规则清单（保障打包发布与离线环境下的可用性）
const EMBEDDED_RULES_MD: &str = include_str!("../../inner-skills/RULES.md");

/// 规则映射定义项
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillMapping {
    pub tools: Vec<String>,
    pub skill_name: String,
    pub enforcement: String,
}

/// 运行态上下文注入结果元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectedContextInfo {
    pub injected: bool,
    pub turn: usize,
}

/// 运行态 Inner-Skills 上下文注入管理器
#[derive(Debug)]
pub struct InnerSkillInjector {
    turn_count: AtomicUsize,
    mappings: Vec<SkillMapping>,
    tool_to_skill_map: HashMap<String, String>,
}

impl InnerSkillInjector {
    pub fn new() -> Self {
        let mappings = Self::parse_mappings_from_markdown(EMBEDDED_RULES_MD);
        let mut tool_to_skill_map = HashMap::new();
        for m in &mappings {
            for tool in &m.tools {
                tool_to_skill_map.insert(tool.to_lowercase(), m.skill_name.clone());
            }
        }

        Self {
            turn_count: AtomicUsize::new(0),
            mappings,
            tool_to_skill_map,
        }
    }

    /// 从 RULES.md Markdown 表格中动态解析工具与 Skill 映射关系
    pub fn parse_mappings_from_markdown(content: &str) -> Vec<SkillMapping> {
        let mut mappings = Vec::new();
        let mut in_matrix_section = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("## 1. Tool-to-Skill Mapping Matrix") || trimmed.contains("Mapping Matrix") {
                in_matrix_section = true;
                continue;
            }
            if in_matrix_section && trimmed.starts_with("## ") {
                break;
            }

            if in_matrix_section && trimmed.starts_with('|') && !trimmed.contains("Invoked Tool") && !trimmed.contains("---") {
                let parts: Vec<&str> = trimmed.split('|').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                if parts.len() >= 2 {
                    let tools_str = parts[0];
                    let skill_str = parts[1].trim_matches('`').trim();
                    let enforcement = if parts.len() >= 3 {
                        parts[2].trim_matches('*').trim().to_string()
                    } else {
                        "Mandatory".to_string()
                    };

                    let tools: Vec<String> = tools_str
                        .split(',')
                        .map(|t| t.trim().trim_matches('`').trim().to_lowercase())
                        .filter(|t| !t.is_empty())
                        .collect();

                    if !tools.is_empty() && !skill_str.is_empty() {
                        mappings.push(SkillMapping {
                            tools,
                            skill_name: skill_str.to_string(),
                            enforcement,
                        });
                    }
                }
            }
        }

        if mappings.is_empty() {
            mappings.push(SkillMapping {
                tools: vec![
                    "bash".to_string(),
                    "terminal".to_string(),
                    "powershell".to_string(),
                    "cmd".to_string(),
                    "execute_command".to_string(),
                ],
                skill_name: "windows-bash-compatibility".to_string(),
                enforcement: "Mandatory".to_string(),
            });
        }

        mappings
    }

    /// 查询某工具是否命中 RULES.md 中的 Inner-Skill 映射
    pub fn resolve_skill_for_tool(&self, tool_name: &str) -> Option<String> {
        let normalized = tool_name.trim().to_lowercase();
        self.tool_to_skill_map.get(&normalized).cloned()
    }

    /// 获取所有动态解析的技能映射清单
    pub fn get_skill_mappings(&self) -> Vec<SkillMapping> {
        self.mappings.clone()
    }

    /// 重置会话轮次计数器（新会话、切换会话时调用）
    pub fn reset_session(&self) {
        self.turn_count.store(0, Ordering::SeqCst);
    }

    /// 获取当前会话轮次
    pub fn get_turn_count(&self) -> usize {
        self.turn_count.load(Ordering::SeqCst)
    }

    /// 获取 RULES.md 完整规则清单内容
    pub fn get_rules_content(&self) -> &'static str {
        EMBEDDED_RULES_MD
    }

    /// 对用户 Prompt / FollowUp 消息进行运行态 RULES.md 上下文持续强行注入
    /// 直接注入 RULES.md 原文，作为工具到 Skill 调用的唯一事实规则来源
    pub fn process_prompt_with_info(&self, message: &str) -> (String, InjectedContextInfo) {
        let turn = self.turn_count.fetch_add(1, Ordering::SeqCst);

        let processed = format!(
            "<runtime_context_rules>\n\
            {}\n\
            </runtime_context_rules>\n\n{}",
            self.get_rules_content().trim(),
            message
        );

        let info = InjectedContextInfo {
            injected: true,
            turn,
        };

        (processed, info)
    }

    /// 兼容方法：返回注入后的提示词字符串
    pub fn process_prompt(&self, message: &str) -> String {
        self.process_prompt_with_info(message).0
    }
}

impl Default for InnerSkillInjector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rules_mapping_parser() {
        let injector = InnerSkillInjector::new();
        let mappings = injector.get_skill_mappings();
        assert!(!mappings.is_empty());

        // 测试 bash / cmd 是否正确映射到 windows-bash-compatibility
        assert_eq!(
            injector.resolve_skill_for_tool("bash"),
            Some("windows-bash-compatibility".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("powershell"),
            Some("windows-bash-compatibility".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("cmd"),
            Some("windows-bash-compatibility".to_string())
        );

        // 未在 RULES.md 映射的工具不应触发任何 inner-skill
        assert_eq!(injector.resolve_skill_for_tool("read_file"), None);
        assert_eq!(injector.resolve_skill_for_tool("web_search"), None);

        // 测试 Prompt 持续注入 RULES.md 原文
        let (processed, info) = injector.process_prompt_with_info("hello");
        assert!(info.injected);
        assert!(processed.contains("<runtime_context_rules>"));
        assert!(processed.contains("Tool-to-Skill Mapping Matrix"));
        assert!(processed.ends_with("hello"));
    }
}


