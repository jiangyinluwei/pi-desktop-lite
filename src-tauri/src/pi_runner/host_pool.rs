use crate::pi_runner::framer::{run_stderr_logger, run_stdout_framer};
use crate::pi_runner::job_object::JobObjectManager;
use crate::pi_runner::protocol::{FollowUpRequest, PromptRequest, SteerRequest};
use crate::pi_runner::supervisor::PiSupervisor;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex, RwLock};

pub const MAX_CONCURRENT_TASKS: usize = 3;

/// 单个 Task 的独立 Pi 会话进程封装
pub struct SessionHost {
    pub task_id: String,
    pub session_id: String,
    app_handle: AppHandle,
    job_object: Arc<JobObjectManager>,
    stdin_tx: Arc<Mutex<Option<mpsc::Sender<String>>>>,
    is_active: Arc<RwLock<bool>>,
    started_at: Instant,
    provider: Arc<RwLock<Option<String>>>,
    model_id: Arc<RwLock<Option<String>>>,
    child_handle: Arc<Mutex<Option<tokio::process::Child>>>,
}

impl SessionHost {
    pub fn new(
        task_id: String,
        session_id: String,
        app_handle: AppHandle,
        job_object: Arc<JobObjectManager>,
    ) -> Self {
        Self {
            task_id,
            session_id,
            app_handle,
            job_object,
            stdin_tx: Arc::new(Mutex::new(None)),
            is_active: Arc::new(RwLock::new(false)),
            started_at: Instant::now(),
            provider: Arc::new(RwLock::new(None)),
            model_id: Arc::new(RwLock::new(None)),
            child_handle: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn is_running(&self) -> bool {
        *self.is_active.read().await
    }

    pub fn started_at(&self) -> Instant {
        self.started_at
    }

    /// 启动该任务专属的 Pi RPC 子进程
    pub async fn start(
        &self,
        initial_model: Option<(String, String)>,
        initial_thinking_level: Option<String>,
    ) -> Result<(), String> {
        let binary_path = PiSupervisor::find_pi_binary(Some(&self.app_handle))
            .ok_or_else(|| "Could not find pi executable in bundled resources, .mytools or PATH".to_string())?;

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(128);
        {
            let mut w = self.stdin_tx.lock().await;
            *w = Some(stdin_tx);
        }

        let mut cmd = Command::new(&binary_path);
        cmd.arg("--mode")
            .arg("rpc")
            .arg("--session-id")
            .arg(&self.session_id);

        if let Some((ref provider, ref model_id)) = initial_model {
            cmd.arg("--provider").arg(provider).arg("--model").arg(model_id);
        }
        if let Some(ref level) = initial_thinking_level {
            cmd.arg("--thinking").arg(level);
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            cmd.creation_flags(0x08000000);
        }

        // 锁定工作空间至 default-area
        let workspace = PiSupervisor::get_default_workspace(Some(&self.app_handle));
        if let Err(e) = std::fs::create_dir_all(&workspace) {
            log::warn!("[SessionHost:{}] Failed to create workspace dir {:?}: {}", self.task_id, workspace, e);
        }
        cmd.current_dir(&workspace);

        // PATH 补全
        if let Some(bin_dir) = binary_path.parent() {
            let split_char = if cfg!(windows) { ';' } else { ':' };
            let existing_path = std::env::var("PATH").unwrap_or_default();
            let bin_dir_str = bin_dir.to_string_lossy().to_string();
            if !existing_path.split(split_char).any(|p| p.eq_ignore_ascii_case(&bin_dir_str)) {
                let new_path = format!("{}{}{}", bin_dir_str, split_char, existing_path);
                cmd.env("PATH", new_path);
            }
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn pi child process for task {}: {}", self.task_id, e))?;

        #[cfg(windows)]
        if let Some(raw_handle) = child.raw_handle() {
            let _ = self.job_object.assign_process_usize(raw_handle as usize);
        }

        let stdin = child.stdin.take().ok_or_else(|| "Failed to capture stdin".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "Failed to capture stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "Failed to capture stderr".to_string())?;

        // 写入 stdin 循环
        tokio::spawn(async move {
            let mut stdin_writer = stdin;
            while let Some(line) = stdin_rx.recv().await {
                if let Err(err) = stdin_writer.write_all(line.as_bytes()).await {
                    log::error!("[SessionHost] Failed writing to child stdin: {}", err);
                    break;
                }
                if let Err(err) = stdin_writer.flush().await {
                    log::error!("[SessionHost] Failed flushing child stdin: {}", err);
                    break;
                }
            }
        });

        // 启动 Stdout 分帧并在事件中注入 task_id
        let (event_tx, mut event_rx) = mpsc::channel::<Value>(256);
        let app_handle_for_events = self.app_handle.clone();
        let task_id_clone = self.task_id.clone();
        let is_active_clone = self.is_active.clone();

        tokio::spawn(async move {
            while let Some(mut event_val) = event_rx.recv().await {
                // 注入 task_id 确保前端路由精准分发
                if let Value::Object(ref mut map) = event_val {
                    if !map.contains_key("task_id") {
                        map.insert("task_id".to_string(), Value::String(task_id_clone.clone()));
                    }
                    if !map.contains_key("taskId") {
                        map.insert("taskId".to_string(), Value::String(task_id_clone.clone()));
                    }

                    // 监听 agent 状态变化以更新 is_active
                    if let Some(event_type) = map.get("type").and_then(|v| v.as_str()) {
                        match event_type {
                            "agent_start" => {
                                *is_active_clone.write().await = true;
                            }
                            "agent_end" | "agent_settled" => {
                                *is_active_clone.write().await = false;
                            }
                            _ => {}
                        }
                    }
                }

                let _ = app_handle_for_events.emit("pi:event", event_val);
            }
        });

        tokio::spawn(async move {
            if let Err(err) = run_stdout_framer(stdout, event_tx).await {
                log::error!("[SessionHost] Stdout framer error: {}", err);
            }
        });

        tokio::spawn(async move {
            let _ = run_stderr_logger(stderr).await;
        });

        // 若指定了模型，下发 set_model 指令初始化
        if let Some((ref provider, ref model_id)) = initial_model {
            *self.provider.write().await = Some(provider.clone());
            *self.model_id.write().await = Some(model_id.clone());
            let set_cmd = serde_json::json!({
                "type": "set_model",
                "provider": provider,
                "modelId": model_id
            });
            let _ = self.send_command(set_cmd).await;
        }

        // 若指定了思考等级，下发 set_thinking_level 指令初始化
        if let Some(ref level) = initial_thinking_level {
            let set_thinking_cmd = serde_json::json!({
                "type": "set_thinking_level",
                "level": level
            });
            let _ = self.send_command(set_thinking_cmd).await;
        }

        // 保存 child handle 以供停止收割
        {
            let mut handle_guard = self.child_handle.lock().await;
            *handle_guard = Some(child);
        }

        *self.is_active.write().await = true;
        Ok(())
    }

    /// 确保子进程当前运行的模型与思考等级与预期保持 100% 一致
    pub async fn ensure_model_and_thinking(
        &self,
        provider: &str,
        model_id: &str,
        thinking_level: Option<&str>,
    ) -> Result<(), String> {
        let cur_provider = self.provider.read().await.clone();
        let cur_model = self.model_id.read().await.clone();

        let need_set_model = match (cur_provider, cur_model) {
            (Some(ref p), Some(ref m)) => p != provider || m != model_id,
            _ => true,
        };

        if need_set_model {
            log::info!(
                "[SessionHost:{}] Syncing model to {}/{}",
                self.task_id,
                provider,
                model_id
            );
            let set_cmd = serde_json::json!({
                "type": "set_model",
                "provider": provider,
                "modelId": model_id
            });
            self.send_command(set_cmd).await?;
            *self.provider.write().await = Some(provider.to_string());
            *self.model_id.write().await = Some(model_id.to_string());
        }

        if let Some(level) = thinking_level {
            let set_thinking_cmd = serde_json::json!({
                "type": "set_thinking_level",
                "level": level
            });
            let _ = self.send_command(set_thinking_cmd).await;
        }

        Ok(())
    }

    /// 向该 Task 子进程发送 JSON RPC 指令
    pub async fn send_command(&self, command_val: Value) -> Result<(), String> {
        let sender = {
            let guard = self.stdin_tx.lock().await;
            guard.clone()
        };

        if let Some(tx) = sender {
            let json_str = serde_json::to_string(&command_val)
                .map_err(|e| format!("Failed to serialize command: {}", e))?;
            let line = format!("{}\n", json_str);

            tx.send(line)
                .await
                .map_err(|e| format!("Failed to queue command to Task stdin: {}", e))?;
            Ok(())
        } else {
            Err(format!("Task {} process is not running or stdin is closed", self.task_id))
        }
    }

    /// 中止该 Task 的当前生成
    pub async fn abort(&self) -> Result<(), String> {
        *self.is_active.write().await = false;
        self.send_command(serde_json::json!({
            "type": "abort"
        }))
        .await
    }

    /// 彻底终止并清理该 Task 子进程
    pub async fn stop(&self) {
        *self.is_active.write().await = false;
        let _ = self.abort().await;
        {
            let mut w = self.stdin_tx.lock().await;
            *w = None;
        }
        let mut handle_guard = self.child_handle.lock().await;
        if let Some(mut child) = handle_guard.take() {
            let _ = child.kill().await;
        }
    }
}

/// Pi 多进程监管池管理器 (`PiHostPool`)
#[derive(Clone)]
pub struct PiHostPool {
    app_handle: AppHandle,
    job_object: Arc<JobObjectManager>,
    primary_supervisor: Arc<PiSupervisor>,
    hosts: Arc<RwLock<HashMap<String, Arc<SessionHost>>>>,
    active_model: Arc<RwLock<Option<(String, String)>>>,
    active_thinking_level: Arc<RwLock<Option<String>>>,
}

impl PiHostPool {
    pub fn new(app_handle: AppHandle, primary_supervisor: Arc<PiSupervisor>) -> Self {
        let job_object = Arc::new(JobObjectManager::new().unwrap_or_else(|err| {
            log::warn!("[PiHostPool] JobObject init failed: {}", err);
            JobObjectManager::new().unwrap()
        }));

        Self {
            app_handle,
            job_object,
            primary_supervisor,
            hosts: Arc::new(RwLock::new(HashMap::new())),
            active_model: Arc::new(RwLock::new(None)),
            active_thinking_level: Arc::new(RwLock::new(None)),
        }
    }

    /// 记录当前选中的活跃模型
    pub async fn set_active_model(&self, provider: String, model_id: String) {
        *self.active_model.write().await = Some((provider, model_id));
    }

    /// 记录当前选中的思考等级
    pub async fn set_active_thinking_level(&self, level: String) {
        *self.active_thinking_level.write().await = Some(level);
    }

    /// 从 ~/.pi-dl/config.json 读取持久化选中的模型
    pub async fn get_saved_config_model(&self) -> Option<(String, String)> {
        let home_dir = dirs::home_dir()?;
        let config_path = home_dir.join(".pi-dl").join("config.json");
        if config_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(config_path) {
                if let Ok(json_val) = serde_json::from_str::<Value>(&content) {
                    if let Some(selected) = json_val.get("selectedModel") {
                        let provider = selected.get("provider").and_then(|v| v.as_str());
                        let model_id = selected
                            .get("modelId")
                            .or_else(|| selected.get("id"))
                            .or_else(|| selected.get("name"))
                            .and_then(|v| v.as_str());
                        if let (Some(p), Some(m)) = (provider, model_id) {
                            if !p.trim().is_empty() && !m.trim().is_empty() {
                                return Some((p.to_string(), m.to_string()));
                            }
                        }
                    }
                }
            }
        }
        None
    }

    /// 从 ~/.pi-dl/config.json 读取持久化的思考等级
    pub async fn get_saved_config_thinking_level(&self) -> Option<String> {
        let home_dir = dirs::home_dir()?;
        let config_path = home_dir.join(".pi-dl").join("config.json");
        if config_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(config_path) {
                if let Ok(json_val) = serde_json::from_str::<Value>(&content) {
                    if let Some(level) = json_val.get("defaultThinkingLevel").and_then(|v| v.as_str()) {
                        if !level.trim().is_empty() {
                            return Some(level.to_string());
                        }
                    }
                }
            }
        }
        None
    }

    /// 解析当前 Prompt 请求最终应该使用的模型（多级兜底保障）
    pub async fn resolve_effective_model(&self, request: &PromptRequest) -> Option<(String, String)> {
        // 1. 优先使用 PromptRequest 中的显式指定
        if let (Some(ref p), Some(ref m)) = (&request.provider, &request.model_id) {
            if !p.trim().is_empty() && !m.trim().is_empty() {
                return Some((p.clone(), m.clone()));
            }
        }

        // 2. 其次使用 HostPool 运行时维护的活跃模型
        if let Some(active) = self.active_model.read().await.clone() {
            return Some(active);
        }

        // 3. 尝试从 ~/.pi-dl/config.json 读取持久化选中的模型
        if let Some(saved) = self.get_saved_config_model().await {
            return Some(saved);
        }

        // 4. 尝试从 primary_supervisor 的 session state 中提取
        if let Ok(state) = self.primary_supervisor.get_session_state().await {
            if let Some(model_obj) = state.get("model") {
                let provider = model_obj.get("provider").and_then(|v| v.as_str());
                let model_id = model_obj
                    .get("id")
                    .or_else(|| model_obj.get("modelId"))
                    .or_else(|| model_obj.get("name"))
                    .and_then(|v| v.as_str());
                if let (Some(p), Some(m)) = (provider, model_id) {
                    return Some((p.to_string(), m.to_string()));
                }
            }
        }

        None
    }

    /// 解析当前 Prompt 请求最终应该使用的思考等级
    pub async fn resolve_effective_thinking_level(&self, request: &PromptRequest) -> Option<String> {
        if let Some(ref lvl) = request.thinking_level {
            if !lvl.trim().is_empty() {
                return Some(lvl.clone());
            }
        }

        if let Some(lvl) = self.active_thinking_level.read().await.clone() {
            return Some(lvl);
        }

        if let Some(saved_lvl) = self.get_saved_config_thinking_level().await {
            return Some(saved_lvl);
        }

        None
    }

    /// 获取活跃（正在运行/推理）的 Task 数量
    pub async fn get_active_tasks_count(&self) -> usize {
        let hosts = self.hosts.read().await;
        let mut count = 0;
        for host in hosts.values() {
            if host.is_running().await {
                count += 1;
            }
        }
        count
    }

    /// 获取所有活跃 Task ID 列表
    pub async fn get_active_task_ids(&self) -> Vec<String> {
        let hosts = self.hosts.read().await;
        let mut result = Vec::new();
        for (id, host) in hosts.iter() {
            if host.is_running().await {
                result.push(id.clone());
            }
        }
        result
    }

    /// 获取或创建 SessionHost
    pub async fn get_or_create_host(
        &self,
        task_id: &str,
        initial_model: Option<(String, String)>,
        initial_thinking_level: Option<String>,
    ) -> Result<Arc<SessionHost>, String> {
        {
            let hosts = self.hosts.read().await;
            if let Some(host) = hosts.get(task_id) {
                return Ok(host.clone());
            }
        }

        // 并发上限保护
        let active_count = self.get_active_tasks_count().await;
        if active_count >= MAX_CONCURRENT_TASKS {
            return Err(format!(
                "后台任务已达上限 ({}/{})，请等待某个任务完成后再发起新对话",
                active_count, MAX_CONCURRENT_TASKS
            ));
        }

        let host = Arc::new(SessionHost::new(
            task_id.to_string(),
            task_id.to_string(),
            self.app_handle.clone(),
            self.job_object.clone(),
        ));

        host.start(initial_model, initial_thinking_level).await?;

        {
            let mut hosts = self.hosts.write().await;
            hosts.insert(task_id.to_string(), host.clone());
        }

        Ok(host)
    }

    /// 向指定 Task 发送 Prompt（若未指定 task_id 则自动分配独立 SessionHost）
    pub async fn send_prompt(
        &self,
        request: PromptRequest,
    ) -> Result<String, String> {
        let task_id = request.task_id.clone().unwrap_or_else(|| {
            format!(
                "task_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            )
        });

        let effective_model = self.resolve_effective_model(&request).await;
        let effective_thinking = self.resolve_effective_thinking_level(&request).await;

        let host = self
            .get_or_create_host(&task_id, effective_model.clone(), effective_thinking.clone())
            .await?;

        // 确保子进程运行的模型与用户指定的模型保持 100% 严格一致
        if let Some((ref provider, ref model_id)) = effective_model {
            host.ensure_model_and_thinking(provider, model_id, effective_thinking.as_deref())
                .await?;
        }

        let (processed_message, _info) = self.primary_supervisor.inject_prompt(&request.message);
        let mut val = serde_json::json!({
            "type": "prompt",
            "message": processed_message,
        });

        if let Some(imgs) = request.images {
            val["images"] = Value::Array(imgs);
        }
        if let Some(sb) = request.streaming_behavior {
            val["streamingBehavior"] = Value::String(sb);
        }

        host.send_command(val).await?;
        Ok(task_id)
    }

    /// 向指定 Task 发送 Steer 指令
    pub async fn send_steer(&self, request: SteerRequest) -> Result<(), String> {
        if let Some(ref task_id) = request.task_id {
            let hosts = self.hosts.read().await;
            if let Some(host) = hosts.get(task_id) {
                let val = serde_json::json!({
                    "type": "steer",
                    "message": request.message,
                });
                return host.send_command(val).await;
            }
        }
        // 兜底发往主 supervisor
        let val = serde_json::json!({
            "type": "steer",
            "message": request.message,
        });
        self.primary_supervisor.send_command(val).await
    }

    /// 向指定 Task 发送 FollowUp 指令
    pub async fn send_follow_up(&self, request: FollowUpRequest) -> Result<(), String> {
        if let Some(ref task_id) = request.task_id {
            let hosts = self.hosts.read().await;
            if let Some(host) = hosts.get(task_id) {
                let (processed_message, _) = self.primary_supervisor.inject_prompt(&request.message);
                let val = serde_json::json!({
                    "type": "follow_up",
                    "message": processed_message,
                });
                return host.send_command(val).await;
            }
        }
        // 兜底发往主 supervisor
        let (processed_message, _) = self.primary_supervisor.inject_prompt(&request.message);
        let val = serde_json::json!({
            "type": "follow_up",
            "message": processed_message,
        });
        self.primary_supervisor.send_command(val).await
    }

    /// 中止指定 Task 或中止全部
    pub async fn abort_task(&self, task_id: Option<String>) -> Result<(), String> {
        if let Some(ref id) = task_id {
            let hosts = self.hosts.read().await;
            if let Some(host) = hosts.get(id) {
                return host.abort().await;
            }
        }

        // 若未指定 task_id，中止所有活跃子进程与主 supervisor
        let hosts = self.hosts.read().await;
        for host in hosts.values() {
            let _ = host.abort().await;
        }
        self.primary_supervisor.abort().await
    }

    /// 销毁并清理指定 Task 资源
    pub async fn destroy_task(&self, task_id: &str) -> Result<(), String> {
        let host = {
            let mut hosts = self.hosts.write().await;
            hosts.remove(task_id)
        };
        if let Some(h) = host {
            h.stop().await;
        }
        Ok(())
    }

    /// 获取主 supervisor 引用
    pub fn supervisor(&self) -> &PiSupervisor {
        &self.primary_supervisor
    }
}
