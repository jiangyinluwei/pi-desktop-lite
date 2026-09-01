use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

/// 编译期内嵌默认规则清单（保障打包发布与离线环境下的可用性）
const EMBEDDED_RULES_MD: &str = include_str!("../../inner-skills/RULES.md");
const EMBEDDED_BASH_SKILL_MD: &str = include_str!("../../inner-skills/windows-bash-compatibility/SKILL.md");
const EMBEDDED_DOC_SKILL_MD: &str = include_str!("../../inner-skills/document-multimodal-inspection/SKILL.md");
const EMBEDDED_SUBAGENTS_SKILL_MD: &str = include_str!("../../inner-skills/multi-agent-orchestration/SKILL.md");
const EMBEDDED_WEB_SKILL_MD: &str = include_str!("../../inner-skills/web-search-silent-access/SKILL.md");
const EMBEDDED_MEMORY_SKILL_MD: &str = include_str!("../../inner-skills/persistent-memory-retrieval/SKILL.md");
const EMBEDDED_WORKFLOW_SKILL_MD: &str = include_str!("../../inner-skills/dynamic-workflows-orchestration/SKILL.md");
const EMBEDDED_PRUNING_SKILL_MD: &str = include_str!("../../inner-skills/active-context-pruning/SKILL.md");

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
            mappings.push(SkillMapping {
                tools: vec![
                    "read_file".to_string(),
                    "docparser".to_string(),
                    "ocr".to_string(),
                    "deword".to_string(),
                    "pi-ocr".to_string(),
                    "pi-docparser".to_string(),
                    "extract_text".to_string(),
                    "image_ocr".to_string(),
                ],
                skill_name: "document-multimodal-inspection".to_string(),
                enforcement: "Mandatory".to_string(),
            });
            mappings.push(SkillMapping {
                tools: vec![
                    "subagent".to_string(),
                    "pi-subagents".to_string(),
                    "spawn_agent".to_string(),
                    "parallel_tasks".to_string(),
                    "delegate_task".to_string(),
                    "subtask_spawn".to_string(),
                ],
                skill_name: "multi-agent-orchestration".to_string(),
                enforcement: "Mandatory".to_string(),
            });
            mappings.push(SkillMapping {
                tools: vec![
                    "web_search".to_string(),
                    "pi-web-access".to_string(),
                    "search_web".to_string(),
                    "fetch_web_page".to_string(),
                    "web_access".to_string(),
                    "browse_page".to_string(),
                ],
                skill_name: "web-search-silent-access".to_string(),
                enforcement: "Mandatory".to_string(),
            });
            mappings.push(SkillMapping {
                tools: vec![
                    "memory_retrieve".to_string(),
                    "memory_store".to_string(),
                    "pi-memory".to_string(),
                    "recall_memory".to_string(),
                    "search_memory".to_string(),
                ],
                skill_name: "persistent-memory-retrieval".to_string(),
                enforcement: "Mandatory".to_string(),
            });
            mappings.push(SkillMapping {
                tools: vec![
                    "dynamic_workflows".to_string(),
                    "execute_workflow".to_string(),
                    "pipeline_step".to_string(),
                    "run_workflow".to_string(),
                ],
                skill_name: "dynamic-workflows-orchestration".to_string(),
                enforcement: "Mandatory".to_string(),
            });
            mappings.push(SkillMapping {
                tools: vec![
                    "context_prune".to_string(),
                    "prune_context".to_string(),
                    "pai-acp".to_string(),
                    "compress_context".to_string(),
                ],
                skill_name: "active-context-pruning".to_string(),
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

    /// 获取具体 Inner-Skill 的详细 SKILL.md 内容
    pub fn get_skill_detail(&self, skill_name: &str) -> Option<&'static str> {
        match skill_name.trim().to_lowercase().as_str() {
            "windows-bash-compatibility" => Some(EMBEDDED_BASH_SKILL_MD),
            "document-multimodal-inspection" => Some(EMBEDDED_DOC_SKILL_MD),
            "multi-agent-orchestration" => Some(EMBEDDED_SUBAGENTS_SKILL_MD),
            "web-search-silent-access" => Some(EMBEDDED_WEB_SKILL_MD),
            "persistent-memory-retrieval" => Some(EMBEDDED_MEMORY_SKILL_MD),
            "dynamic-workflows-orchestration" => Some(EMBEDDED_WORKFLOW_SKILL_MD),
            "active-context-pruning" => Some(EMBEDDED_PRUNING_SKILL_MD),
            _ => None,
        }
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

        // 测试文档解析与 OCR 工具是否正确映射到 document-multimodal-inspection
        assert_eq!(
            injector.resolve_skill_for_tool("read_file"),
            Some("document-multimodal-inspection".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("ocr"),
            Some("document-multimodal-inspection".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("deword"),
            Some("document-multimodal-inspection".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("pi-ocr"),
            Some("document-multimodal-inspection".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("pi-docparser"),
            Some("document-multimodal-inspection".to_string())
        );

        // 测试多 Agent 调度工具是否正确映射到 multi-agent-orchestration
        assert_eq!(
            injector.resolve_skill_for_tool("subagent"),
            Some("multi-agent-orchestration".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("pi-subagents"),
            Some("multi-agent-orchestration".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("spawn_agent"),
            Some("multi-agent-orchestration".to_string())
        );

        // 测试联网搜索工具是否正确映射到 web-search-silent-access
        assert_eq!(
            injector.resolve_skill_for_tool("web_search"),
            Some("web-search-silent-access".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("pi-web-access"),
            Some("web-search-silent-access".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("search_web"),
            Some("web-search-silent-access".to_string())
        );

        // 测试记忆检索工具是否正确映射到 persistent-memory-retrieval
        assert_eq!(
            injector.resolve_skill_for_tool("memory_retrieve"),
            Some("persistent-memory-retrieval".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("pi-memory"),
            Some("persistent-memory-retrieval".to_string())
        );

        // 测试动态工作流工具是否正确映射到 dynamic-workflows-orchestration
        assert_eq!(
            injector.resolve_skill_for_tool("dynamic_workflows"),
            Some("dynamic-workflows-orchestration".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("execute_workflow"),
            Some("dynamic-workflows-orchestration".to_string())
        );

        // 测试上下文修剪工具是否正确映射到 active-context-pruning
        assert_eq!(
            injector.resolve_skill_for_tool("context_prune"),
            Some("active-context-pruning".to_string())
        );
        assert_eq!(
            injector.resolve_skill_for_tool("pai-acp"),
            Some("active-context-pruning".to_string())
        );

        // 未在 RULES.md 映射的随机工具不应触发任何 inner-skill
        assert_eq!(injector.resolve_skill_for_tool("unknown_fake_tool_xyz"), None);

        // 验证各 Skill 的详细内容均可正常获取
        assert!(injector.get_skill_detail("windows-bash-compatibility").is_some());
        assert!(injector.get_skill_detail("document-multimodal-inspection").is_some());
        assert!(injector.get_skill_detail("multi-agent-orchestration").is_some());
        assert!(injector.get_skill_detail("web-search-silent-access").is_some());
        assert!(injector.get_skill_detail("persistent-memory-retrieval").is_some());
        assert!(injector.get_skill_detail("dynamic-workflows-orchestration").is_some());
        assert!(injector.get_skill_detail("active-context-pruning").is_some());

        // 测试 Prompt 持续注入 RULES.md 原文
        let (processed, info) = injector.process_prompt_with_info("hello");
        assert!(info.injected);
        assert!(processed.contains("<runtime_context_rules>"));
        assert!(processed.contains("Tool-to-Skill Mapping Matrix"));
        assert!(processed.ends_with("hello"));
    }
}
