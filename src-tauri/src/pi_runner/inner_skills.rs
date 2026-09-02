use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;

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
}

/// Tool call pre-processing hook 命中结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSkillActivation {
    pub tool_name: String,
    pub skill: String,
}

/// 运行态 Inner-Skills 上下文注入管理器
///
/// 注入策略：不再将完整 RULES.md 静态前置到 Prompt（system prompt 路径），
/// 而是由 Tool call pre-processing hook 在工具调用启动时按需动态注入
/// 对应 Inner-Skill 的 SKILL.md 内容。
#[derive(Debug)]
pub struct InnerSkillInjector {
    mappings: Vec<SkillMapping>,
    tool_to_skill_map: HashMap<String, String>,
    /// hook 命中后待随下一次出站 Prompt 注入的 Skill 队列（按激活顺序去重，兑底通道）
    pending_skills: Mutex<VecDeque<String>>,
    /// 当前轮次已动态注入过的 Skill（避免同轮重复注入）
    active_turn_skills: Mutex<HashSet<String>>,
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
            mappings,
            tool_to_skill_map,
            pending_skills: Mutex::new(VecDeque::new()),
            active_turn_skills: Mutex::new(HashSet::new()),
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

    /// 重置会话动态注入状态（新会话、切换会话时调用）
    pub fn reset_session(&self) {
        self.pending_skills.lock().unwrap().clear();
        self.active_turn_skills.lock().unwrap().clear();
    }

    /// 获取 RULES.md 完整规则清单内容
    pub fn get_rules_content(&self) -> &'static str {
        EMBEDDED_RULES_MD
    }

    /// Tool call pre-processing hook：工具调用启动前由宿主调用。
    /// 命中 RULES.md 映射时返回对应的 Inner-Skill 激活信息。
    pub fn hook_tool_call(&self, tool_name: &str) -> Option<ToolSkillActivation> {
        let skill = self.resolve_skill_for_tool(tool_name)?;
        // 确保对应 SKILL.md 内容可用
        self.get_skill_detail(&skill)?;
        Some(ToolSkillActivation {
            tool_name: tool_name.trim().to_string(),
            skill,
        })
    }

    /// 标记 Skill 已激活：当轮去重 + 兑底入队（供下一次出站 Prompt 注入）。
    /// 返回 true 表示本轮首次激活（需要执行动态注入）。
    pub fn mark_skill_activated(&self, skill: &str) -> bool {
        {
            let mut turn = self.active_turn_skills.lock().unwrap();
            if !turn.insert(skill.to_string()) {
                return false;
            }
        }
        let mut queue = self.pending_skills.lock().unwrap();
        if !queue.iter().any(|s| s == skill) {
            queue.push_back(skill.to_string());
        }
        true
    }

    /// 将 Skill 从兑底注入队列中移除（动态 steer 注入成功后调用，避免重复注入）
    pub fn dequeue_skill(&self, skill: &str) {
        self.pending_skills.lock().unwrap().retain(|s| s != skill);
    }

    /// 构建单个 Skill 的动态注入文本块
    pub fn build_skill_injection_text(&self, skill: &str) -> Option<String> {
        let detail = self.get_skill_detail(skill)?;
        Some(format!(
            "<runtime_inner_skill name=\"{}\">\n{}\n</runtime_inner_skill>",
            skill,
            detail.trim()
        ))
    }

    /// 轮次边界回调：清空当轮激活去重集合（turn_start / agent_start 时调用）
    pub fn begin_turn(&self) {
        self.active_turn_skills.lock().unwrap().clear();
    }

    /// 出站 Prompt 注入：仅注入 tool-call hook 命中的待注入 Skill 内容，
    /// 不再注入完整 RULES.md；无待注入内容时保持消息原样。
    pub fn process_prompt_with_info(&self, message: &str) -> (String, InjectedContextInfo) {
        let drained: Vec<String> = {
            let mut queue = self.pending_skills.lock().unwrap();
            queue.drain(..).collect()
        };

        if drained.is_empty() {
            return (message.to_string(), InjectedContextInfo { injected: false });
        }

        let mut block = String::from(
            "<runtime_inner_skills>\n\
             以下 Inner-Skill 约束由 tool call pre-processing hook 按实际工具调用动态激活，\
             本轮及后续相关工具调用必须严格遵守：\n\n",
        );
        for skill in &drained {
            if let Some(text) = self.build_skill_injection_text(skill) {
                block.push_str(&text);
                block.push('\n');
            }
        }
        block.push_str("</runtime_inner_skills>\n\n");

        (
            format!("{}{}", block, message),
            InjectedContextInfo { injected: true },
        )
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

        // 未命中映射的工具不应触发 tool-call hook
        assert!(injector.hook_tool_call("unknown_fake_tool_xyz").is_none());

        // 无待注入内容时 Prompt 保持原样，不再注入完整 RULES.md
        let (clean, clean_info) = injector.process_prompt_with_info("hello");
        assert!(!clean_info.injected);
        assert_eq!(clean, "hello");
        assert!(!clean.contains("<runtime_context_rules>"));
        assert!(!clean.contains("Tool-to-Skill Mapping Matrix"));

        // tool-call hook 命中 bash → 当轮首次激活，兑底入队后随下一次 Prompt 注入对应 SKILL.md
        let activation = injector.hook_tool_call("bash").expect("bash should hit hook");
        assert_eq!(activation.skill, "windows-bash-compatibility");
        assert!(injector.mark_skill_activated(&activation.skill));

        let (processed, info) = injector.process_prompt_with_info("hello");
        assert!(info.injected);
        assert!(processed.contains("<runtime_inner_skills>"));
        assert!(processed.contains("<runtime_inner_skill name=\"windows-bash-compatibility\">"));
        assert!(processed.ends_with("hello"));
        // 注入后队列清空，重复发送不再注入（兑底通道一次性消费）
        let (again, again_info) = injector.process_prompt_with_info("world");
        assert!(!again_info.injected);
        assert_eq!(again, "world");

        // 同轮重复激活被去重；跨轮（begin_turn）后可重新激活
        assert!(!injector.mark_skill_activated("windows-bash-compatibility"));
        injector.begin_turn();
        assert!(injector.mark_skill_activated("windows-bash-compatibility"));

        // steer 动态注入成功后可通过 dequeue 移除兑底队列，避免重复注入
        injector.mark_skill_activated("windows-bash-compatibility");
        injector.dequeue_skill("windows-bash-compatibility");
        let (after_dequeue, after_info) = injector.process_prompt_with_info("next");
        assert!(!after_info.injected);
        assert_eq!(after_dequeue, "next");

        // 动态注入文本块可独立构建
        let text = injector
            .build_skill_injection_text("windows-bash-compatibility")
            .expect("skill text should build");
        assert!(text.contains("<runtime_inner_skill name=\"windows-bash-compatibility\">"));
    }
}
