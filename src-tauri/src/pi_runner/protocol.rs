use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Host 监督器当前运行状态
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum HostStatus {
    Stopped,
    Starting,
    Ready { pi_version: String },
    Crashed { exit_code: Option<i32>, error: String },
}

/// 通用 RPC 指令发送结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcCommand {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(flatten)]
    pub payload: Value,
}

/// RPC 响应结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub resp_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 前端向 Agent 提交 Prompt 专用参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRequest {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "streamingBehavior")]
    pub streaming_behavior: Option<String>,
}

/// 前端向 Agent 提交 Steering 消息参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteerRequest {
    pub message: String,
}

/// 前端向 Agent 提交 FollowUp 消息参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowUpRequest {
    pub message: String,
}
