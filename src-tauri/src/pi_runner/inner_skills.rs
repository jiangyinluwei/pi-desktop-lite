use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
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
const EMBEDDED_TEMP_HYGIENE_SKILL_MD: &str = include_str!("../../inner-skills/temp-file-hygiene/SKILL.md");

/// 获取统一的运行时临时目录路径 (~/.pi-dl/temp)
pub fn get_runtime_temp_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".pi-dl").join("temp"))
        .unwrap_or_else(|| PathBuf::from(".pi-dl/temp"))
}

/// 确保运行时临时目录存在
pub fn ensure_runtime_temp_dir() -> std::io::Result<PathBuf> {
    let temp_dir = get_runtime_temp_dir();
    if !temp_dir.exists() {
        std::fs::create_dir_all(&temp_dir)?;
    }
    Ok(temp_dir)
}

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
    /// 本次注入的条目清单（供前端会话流顶部「注入提示」信息框展示）
    #[serde(default)]
    pub items: Vec<InjectedItem>,
}

/// 单条上下文注入条目元数据
/// `kind`: inner_skill | agents_md | readme_md | routed_skill | routing_context
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InjectedItem {
    pub kind: String,
    /// 条目名称（文件名或技能名）
    pub name: String,
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
    tool_to_skill_map: HashMap<String, Vec<String>>,
    /// hook 命中后待随下一次出站 Prompt 注入的 Skill 队列（按激活顺序去重，兑底通道）
    pending_skills: Mutex<VecDeque<String>>,
    /// 当前轮次已动态注入过的 Skill（避免同轮重复注入）
    active_turn_skills: Mutex<HashSet<String>>,
}

impl InnerSkillInjector {
    pub fn new() -> Self {
        let _ = ensure_runtime_temp_dir();
        let mappings = Self::parse_mappings_from_markdown(EMBEDDED_RULES_MD);
        let mut tool_to_skill_map: HashMap<String, Vec<String>> = HashMap::new();
        for m in &mappings {
            for tool in &m.tools {
                let entry = tool_to_skill_map.entry(tool.to_lowercase()).or_default();
                if !entry.contains(&m.skill_name) {
                    entry.push(m.skill_name.clone());
                }
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
            mappings.push(SkillMapping {
                tools: vec![
                    "write".to_string(),
                    "write_file".to_string(),
                    "create_file".to_string(),
                    "temp_file".to_string(),
                    "scratchpad".to_string(),
                    "bash".to_string(),
                    "terminal".to_string(),
                    "powershell".to_string(),
                    "cmd".to_string(),
                    "execute_command".to_string(),
                ],
                skill_name: "temp-file-hygiene".to_string(),
                enforcement: "Mandatory".to_string(),
            });
        }

        mappings
    }

    /// 查询某工具是否命中 RULES.md 中的 Inner-Skill 映射（返回首个命中的技能）
    pub fn resolve_skill_for_tool(&self, tool_name: &str) -> Option<String> {
        let normalized = tool_name.trim().to_lowercase();
        self.tool_to_skill_map
            .get(&normalized)
            .and_then(|list| list.first().cloned())
    }

    /// 查询某工具命中的全部 Inner-Skill 映射清单
    pub fn resolve_skills_for_tool(&self, tool_name: &str) -> Vec<String> {
        let normalized = tool_name.trim().to_lowercase();
        self.tool_to_skill_map
            .get(&normalized)
            .cloned()
            .unwrap_or_default()
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
            "temp-file-hygiene" => Some(EMBEDDED_TEMP_HYGIENE_SKILL_MD),
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
    /// 命中 RULES.md 映射时返回所有命中的 Inner-Skill 激活信息。
    pub fn hook_tool_calls(&self, tool_name: &str) -> Vec<ToolSkillActivation> {
        let skills = self.resolve_skills_for_tool(tool_name);
        let mut activations = Vec::new();
        for skill in skills {
            if self.get_skill_detail(&skill).is_some() {
                activations.push(ToolSkillActivation {
                    tool_name: tool_name.trim().to_string(),
                    skill,
                });
            }
        }
        activations
    }

    /// 兼容方法：返回首个命中的 ToolSkillActivation
    pub fn hook_tool_call(&self, tool_name: &str) -> Option<ToolSkillActivation> {
        self.hook_tool_calls(tool_name).into_iter().next()
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

    /// 构建单个 Skill 的动态注入文本块（支持动态展开系统真实临时目录路径）
    pub fn build_skill_injection_text(&self, skill: &str) -> Option<String> {
        let detail = self.get_skill_detail(skill)?;
        let content = if skill == "temp-file-hygiene" {
            let temp_dir = get_runtime_temp_dir();
            let _ = ensure_runtime_temp_dir();
            let temp_dir_str = temp_dir.to_string_lossy().replace('\\', "/");
            detail.replace("{{PI_DL_TEMP_DIR}}", &temp_dir_str)
        } else {
            detail.to_string()
        };
        Some(format!(
            "<runtime_inner_skill name=\"{}\">\n{}\n</runtime_inner_skill>",
            skill,
            content.trim()
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
            return (
                message.to_string(),
                InjectedContextInfo {
                    injected: false,
                    items: Vec::new(),
                },
            );
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
            InjectedContextInfo {
                injected: true,
                items: drained
                    .iter()
                    .map(|s| InjectedItem {
                        kind: "inner_skill".to_string(),
                        name: s.clone(),
                    })
                    .collect(),
            },
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
