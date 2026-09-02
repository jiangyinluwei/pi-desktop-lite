use crate::pi_runner::framer::{run_stderr_logger, run_stdout_framer};
use crate::pi_runner::job_object::JobObjectManager;
use crate::pi_runner::protocol::HostStatus;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex, RwLock};

use std::collections::HashMap;
use tokio::sync::oneshot;

use crate::pi_runner::inner_skills::{InjectedContextInfo, InnerSkillInjector};

// 内核保险：崩溃后自动重连的最大尝试次数与间隔（全局后台检测自愈）
const RECONNECT_MAX_ATTEMPTS: usize = 5;
const RECONNECT_DELAY: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct PiSupervisor {
    app_handle: AppHandle,
    job_object: Arc<JobObjectManager>,
    status: Arc<RwLock<HostStatus>>,
    stdin_tx: Arc<Mutex<Option<mpsc::Sender<String>>>>,
    pending_responses: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    pi_version: Arc<RwLock<Option<String>>>,
    is_stopping: Arc<RwLock<bool>>,
    skill_injector: Arc<InnerSkillInjector>,
    custom_workspace: Arc<RwLock<Option<PathBuf>>>,
}

impl PiSupervisor {
    pub fn new(app_handle: AppHandle) -> Self {
        let job_object = Arc::new(JobObjectManager::new().unwrap_or_else(|err| {
            log::warn!("[Supervisor] JobObject init failed: {}", err);
            JobObjectManager::new().unwrap()
        }));

        Self {
            app_handle,
            job_object,
            status: Arc::new(RwLock::new(HostStatus::Stopped)),
            stdin_tx: Arc::new(Mutex::new(None)),
            pending_responses: Arc::new(Mutex::new(HashMap::new())),
            pi_version: Arc::new(RwLock::new(None)),
            is_stopping: Arc::new(RwLock::new(false)),
            skill_injector: Arc::new(InnerSkillInjector::new()),
            custom_workspace: Arc::new(RwLock::new(None)),
        }
    }

    /// 查找可用的 Pi 可执行文件路径（优先支持打包内置资源、同级目录、开发相对路径与 PATH）
    pub fn find_pi_binary(app_handle: Option<&AppHandle>) -> Option<PathBuf> {
        // 1. 检查环境变量 PI_BINARY_PATH
        if let Ok(env_path) = std::env::var("PI_BINARY_PATH") {
            let p = PathBuf::from(env_path);
            if p.is_file() {
                return Some(p);
            }
        }

        // 2. 检查用户级一键更新内核目录 (~/.pi-dl/kernel/pi-windows-x64/pi.exe)
        if let Some(home) = dirs::home_dir() {
            let user_kernel_candidates = [
                home.join(".pi-dl").join("kernel").join("pi-windows-x64").join("pi.exe"),
                home.join(".pi-dl").join("kernel").join("pi-windows-x64").join("pi"),
                home.join(".pi-dl").join("kernel").join("pi.exe"),
                home.join(".pi-dl").join("kernel").join("pi"),
            ];
            for candidate in &user_kernel_candidates {
                if candidate.is_file() {
                    return Some(candidate.clone());
                }
            }
        }

        // 3. 检查当前源码与开发工作区目录 (.mytools/pi-body/pi-windows-x64/pi.exe)
        if let Ok(curr_dir) = std::env::current_dir() {
            let curr_candidates = [
                curr_dir.join(".mytools/pi-body/pi-windows-x64/pi.exe"),
                curr_dir.join("../.mytools/pi-body/pi-windows-x64/pi.exe"),
                curr_dir.join("pi-windows-x64/pi.exe"),
                curr_dir.join(".mytools/pi-body/pi-windows-x64/pi"),
                curr_dir.join("resources/pi-windows-x64/pi.exe"),
                curr_dir.join("pi.exe"),
            ];
            for candidate in &curr_candidates {
                if candidate.is_file() {
                    return Some(candidate.clone());
                }
            }
        }

        // 3. 检查 exe 所在目录及其 resources 子目录 (Release 独立分发/安装目录)
        if let Ok(current_exe) = std::env::current_exe() {
            if let Some(exe_dir) = current_exe.parent() {
                let exe_candidates = [
                    exe_dir.join("resources").join("pi-windows-x64").join("pi.exe"),
                    exe_dir.join("resources").join("pi-windows-x64").join("pi"),
                    exe_dir.join("resources").join("pi-body").join("pi-windows-x64").join("pi.exe"),
                    exe_dir.join("pi-windows-x64").join("pi.exe"),
                    exe_dir.join(".mytools").join("pi-body").join("pi-windows-x64").join("pi.exe"),
                    exe_dir.join("..").join(".mytools").join("pi-body").join("pi-windows-x64").join("pi.exe"),
                    exe_dir.join("resources").join("pi.exe"),
                    exe_dir.join("pi.exe"),
                ];
                for candidate in &exe_candidates {
                    if candidate.is_file() {
                        return Some(candidate.clone());
                    }
                }
            }
        }

        // 4. 检查 Tauri Resource 目录 (安装包标准资源目录)
        if let Some(app) = app_handle {
            if let Ok(resource_dir) = app.path().resource_dir() {
                let resource_candidates = [
                    resource_dir.join("pi-windows-x64").join("pi.exe"),
                    resource_dir.join("pi-windows-x64").join("pi"),
                    resource_dir.join("pi-body").join("pi-windows-x64").join("pi.exe"),
                    resource_dir.join(".mytools").join("pi-body").join("pi-windows-x64").join("pi.exe"),
                    resource_dir.join("pi.exe"),
                    resource_dir.join("pi"),
                ];
                for candidate in &resource_candidates {
                    if candidate.is_file() {
                        return Some(candidate.clone());
                    }
                }
            }
        }

        // 5. 检查系统 PATH 中的 pi / pi.exe
        if let Ok(path_var) = std::env::var("PATH") {
            let split_char = if cfg!(windows) { ';' } else { ':' };
            let bin_name = if cfg!(windows) { "pi.exe" } else { "pi" };
            for dir in path_var.split(split_char) {
                let full = Path::new(dir).join(bin_name);
                if full.is_file() {
                    return Some(full);
                }
            }
        }

        None
    }

    /// 检查是否存在可用的 Pi 内核可执行文件
    pub fn has_kernel(&self) -> bool {
        Self::find_pi_binary(Some(&self.app_handle)).is_some()
    }

    /// 获取当前 Host 状态
    pub async fn get_status(&self) -> HostStatus {
        self.status.read().await.clone()
    }

    /// 获取检测到的 Pi 版本
    pub async fn get_version(&self) -> Option<String> {
        self.pi_version.read().await.clone()
    }

    /// 更新状态并向前端广播
    async fn update_status(&self, new_status: HostStatus) {
        {
            let mut w = self.status.write().await;
            *w = new_status.clone();
        }
        let _ = self.app_handle.emit("pi:status", &new_status);
    }

    /// 启动 Pi Agent Host 子进程
    pub fn start(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'static>> {
        let this = self.clone();
        Box::pin(async move {
            *this.is_stopping.write().await = false;

            if !this.has_kernel() {
                log::warn!("[Supervisor] No Pi kernel binary found. Running in kernel-less mode.");
                this.update_status(HostStatus::Stopped).await;
                return Ok(());
            }

            let binary_path = Self::find_pi_binary(Some(&this.app_handle))
                .ok_or_else(|| "Could not find pi executable in bundled resources, .mytools or PATH".to_string())?;

            let mut ver_cmd = Command::new(&binary_path);
            ver_cmd.arg("--version");
            #[cfg(windows)]
            {
                ver_cmd.creation_flags(0x08000000);
            }

            let version_str = match ver_cmd.output().await {
                Ok(out) if out.status.success() => {
                    String::from_utf8_lossy(&out.stdout).trim().to_string()
                }
                _ => "unknown".to_string(),
            };
            *this.pi_version.write().await = Some(version_str.clone());

            this.update_status(HostStatus::Starting).await;

            this.spawn_child(binary_path, version_str).await
        })
    }

    /// 内部拉起子进程并绑定监管通道
    async fn spawn_child(&self, binary_path: PathBuf, pi_version: String) -> Result<(), String> {
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(128);
        {
            let mut w = self.stdin_tx.lock().await;
            *w = Some(stdin_tx);
        }

        let mut cmd = Command::new(&binary_path);
        cmd.arg("--mode")
            .arg("rpc");

        // 从 ~/.pi-dl/config.json 预读选中的模型与思考等级
        if let Some(home) = dirs::home_dir() {
            let config_path = home.join(".pi-dl").join("config.json");
            if config_path.is_file() {
                if let Ok(content) = std::fs::read_to_string(&config_path) {
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
                                    cmd.arg("--provider").arg(p).arg("--model").arg(m);
                                }
                            }
                        }
                        if let Some(level) = json_val.get("defaultThinkingLevel").and_then(|v| v.as_str()) {
                            if !level.trim().is_empty() {
                                cmd.arg("--thinking").arg(level);
                            }
                        }
                    }
                }
            }
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            cmd.creation_flags(0x08000000);
        }

        // 1. 设置工作目录：使用 resolve_workspace() 锁定当前生效工作区（多预设模板→运行时副本，自动创建并确保存在）
        let workspace = self.resolve_workspace().await;
        if let Err(e) = std::fs::create_dir_all(&workspace) {
            log::warn!("[Supervisor] Failed to create workspace dir {:?}: {}", workspace, e);
        } else {
            log::info!("[Supervisor] Pi child process CWD locked to: {:?}", workspace);
        }
        cmd.current_dir(&workspace);

        // 2. 补全 PATH 环境变量（使用 std::env::var 自动大小写兼容，避免 Windows 环境块冲突）
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
            .map_err(|e| format!("Failed to spawn pi child process: {}", e))?;

        #[cfg(windows)]
        if let Some(raw_handle) = child.raw_handle() {
            let _ = self.job_object.assign_process_usize(raw_handle as usize);
        }

        let stdin = child.stdin.take().ok_or_else(|| "Failed to capture stdin".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "Failed to capture stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "Failed to capture stderr".to_string())?;

        tokio::spawn(async move {
            let mut stdin_writer = stdin;
            while let Some(line) = stdin_rx.recv().await {
                if let Err(err) = stdin_writer.write_all(line.as_bytes()).await {
                    log::error!("[Supervisor] Failed writing to child stdin: {}", err);
                    break;
                }
                if let Err(err) = stdin_writer.flush().await {
                    log::error!("[Supervisor] Failed flushing child stdin: {}", err);
                    break;
                }
            }
        });

        // 启动 Stdout 分帧与事件广播通道
        let (event_tx, mut event_rx) = mpsc::channel::<Value>(256);
        let app_handle_for_events = self.app_handle.clone();
        let pending_responses_clone = self.pending_responses.clone();
        let supervisor_for_events = self.clone();

        tokio::spawn(async move {
            while let Some(event_val) = event_rx.recv().await {
                let event_type = event_val.get("type").and_then(|v| v.as_str()).unwrap_or("");

                // Tool call pre-processing hook：工具调用启动时按映射动态注入 Inner-Skill
                if event_type == "tool_execution_start" {
                    Self::handle_tool_call_hook(&supervisor_for_events, &event_val).await;
                } else if event_type == "turn_start" || event_type == "agent_start" {
                    // 轮次边界：重置当轮激活去重集合，使技能可跨轮重新注入
                    supervisor_for_events.skill_injector.begin_turn();
                }

                // 如果是 response 响应帧且携带 id，尝试唤醒对应的 oneshot 等待者
                if event_type == "response" {
                    if let Some(id) = event_val.get("id").and_then(|v| v.as_str()) {
                        let mut guard = pending_responses_clone.lock().await;
                        if let Some(tx) = guard.remove(id) {
                            let _ = tx.send(event_val.clone());
                        }
                    }
                }

                let _ = app_handle_for_events.emit("pi:event", event_val);
            }
        });

        tokio::spawn(async move {
            if let Err(err) = run_stdout_framer(stdout, event_tx).await {
                log::error!("[Supervisor] Stdout framer error: {}", err);
            }
        });

        tokio::spawn(async move {
            let _ = run_stderr_logger(stderr).await;
        });

        // 启动独立监督生命周期任务
        let self_clone = self.clone();
        tokio::spawn(Self::monitor_child_lifecycle(self_clone, child));

        self.update_status(HostStatus::Ready {
            pi_version,
        })
        .await;

        Ok(())
    }

    /// 独立监控子进程退出与自愈循环
    async fn monitor_child_lifecycle(supervisor: PiSupervisor, mut child: tokio::process::Child) {
        let exit_status = child.wait().await;
        {
            let mut w = supervisor.stdin_tx.lock().await;
            *w = None;
        }

        let is_stopping = *supervisor.is_stopping.read().await;
        if is_stopping {
            supervisor.update_status(HostStatus::Stopped).await;
            return;
        }

        let exit_code = exit_status.as_ref().ok().and_then(|s| s.code());
        log::warn!("[Supervisor] Pi child exited with code {:?}", exit_code);

        // 内核保险：全局后台自动重连机制，最多尝试 RECONNECT_MAX_ATTEMPTS 次
        for attempt in 1..=RECONNECT_MAX_ATTEMPTS {
            supervisor
                .update_status(HostStatus::Crashed {
                    exit_code,
                    error: format!(
                        "Pi process exited unexpectedly. Auto-reconnecting (attempt {}/{}).",
                        attempt, RECONNECT_MAX_ATTEMPTS
                    ),
                })
                .await;

            tokio::time::sleep(RECONNECT_DELAY).await;

            // is_stopping 可能在等待期间被置位（用户主动停止/退出），此时终止重连
            if *supervisor.is_stopping.read().await {
                supervisor.update_status(HostStatus::Stopped).await;
                return;
            }

            match supervisor.start().await {
                Ok(()) => {
                    // start() 在无内核场景下也会返回 Ok（Stopped 态），必须确认真正达到 Ready
                    if matches!(supervisor.get_status().await, HostStatus::Ready { .. }) {
                        log::info!(
                            "[Supervisor] Auto-reconnect succeeded on attempt {}/{}.",
                            attempt,
                            RECONNECT_MAX_ATTEMPTS
                        );
                        return;
                    }
                    log::warn!(
                        "[Supervisor] Auto-reconnect attempt {}/{} did not reach Ready state.",
                        attempt,
                        RECONNECT_MAX_ATTEMPTS
                    );
                }
                Err(e) => {
                    log::warn!(
                        "[Supervisor] Auto-reconnect attempt {}/{} failed: {}",
                        attempt,
                        RECONNECT_MAX_ATTEMPTS,
                        e
                    );
                }
            }
        }

        // 连续 5 次重连均失败：落入终态 Crashed，并向左上角广播红色抖动小闪电提醒事件
        let err_msg = format!(
            "Auto-reconnect failed after {} attempts. Manual restart required.",
            RECONNECT_MAX_ATTEMPTS
        );
        log::error!("[Supervisor] {}", err_msg);
        supervisor
            .update_status(HostStatus::Crashed {
                exit_code,
                error: err_msg.clone(),
            })
            .await;
        let _ = supervisor.app_handle.emit(
            "pi:kernel-reconnect-failed",
            serde_json::json!({
                "attempts": RECONNECT_MAX_ATTEMPTS,
                "error": err_msg,
            }),
        );
    }

    /// 向 Pi 发送通用 RPC 指令（无阻塞等待）
    pub async fn send_command(&self, command_val: Value) -> Result<(), String> {
        let sender = {
            let guard = self.stdin_tx.lock().await;
            guard.clone()
        };

        if let Some(tx) = sender {
            if !command_val.is_object() {
                return Err("Command must be a JSON object".to_string());
            }

            let json_str = serde_json::to_string(&command_val)
                .map_err(|e| format!("Failed to serialize command: {}", e))?;
            let line = format!("{}\n", json_str);

            tx.send(line)
                .await
                .map_err(|e| format!("Failed to queue command to Pi stdin: {}", e))?;

            Ok(())
        } else {
            Err("Pi host is not currently running or stdin is closed".to_string())
        }
    }

    /// 向 Pi 发送带有 ID 关联并同步等待结果响应的 RPC 指令
    pub async fn send_command_with_response(
        &self,
        mut command_val: Value,
        timeout_dur: Duration,
    ) -> Result<Value, String> {
        let id = format!(
            "req_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );

        if let Some(obj) = command_val.as_object_mut() {
            obj.insert("id".to_string(), Value::String(id.clone()));
        } else {
            return Err("Command must be a JSON object".to_string());
        }

        let (resp_tx, resp_rx) = oneshot::channel::<Value>();
        {
            let mut guard = self.pending_responses.lock().await;
            guard.insert(id.clone(), resp_tx);
        }

        // 发送指令
        if let Err(e) = self.send_command(command_val).await {
            let mut guard = self.pending_responses.lock().await;
            guard.remove(&id);
            return Err(e);
        }

        // 等待响应返回
        match tokio::time::timeout(timeout_dur, resp_rx).await {
            Ok(Ok(response_val)) => {
                let success = response_val
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if success {
                    Ok(response_val.get("data").cloned().unwrap_or(Value::Null))
                } else {
                    let err = response_val
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("RPC command returned failure");
                    Err(err.to_string())
                }
            }
            Ok(Err(_)) => {
                let mut guard = self.pending_responses.lock().await;
                guard.remove(&id);
                Err("Response channel dropped before receiving response".to_string())
            }
            Err(_) => {
                let mut guard = self.pending_responses.lock().await;
                guard.remove(&id);
                Err(format!("RPC command timed out after {:?}", timeout_dur))
            }
        }
    }

    /// 获取当前会话完整状态（包含当前模型、思考等级、会话ID等）
    pub async fn get_session_state(&self) -> Result<Value, String> {
        self.send_command_with_response(
            serde_json::json!({
                "type": "get_state"
            }),
            Duration::from_secs(8),
        )
        .await
    }

    /// 获取所有配置和可用的模型列表
    pub async fn get_available_models(&self) -> Result<Value, String> {
        self.send_command_with_response(
            serde_json::json!({
                "type": "get_available_models"
            }),
            Duration::from_secs(8),
        )
        .await
    }

    /// 切换当前使用的模型
    pub async fn set_model(&self, provider: &str, model_id: &str) -> Result<Value, String> {
        let first_res = self
            .send_command_with_response(
                serde_json::json!({
                    "type": "set_model",
                    "provider": provider,
                    "modelId": model_id
                }),
                Duration::from_secs(8),
            )
            .await;

        match first_res {
            Ok(v) => Ok(v),
            Err(ref err) if err.contains("Model not found") => {
                log::warn!(
                    "[PiSupervisor] Model not found in active session ({}). Restarting supervisor to reload ~/.pi/agent/models.json...",
                    err
                );
                // 重启 supervisor 以重新加载最新的 models.json / auth.json 配置
                if let Err(e) = self.restart().await {
                    log::error!(
                        "[PiSupervisor] Failed to restart supervisor after Model not found: {}",
                        e
                    );
                    return Err(format!(
                        "切换模型失败: {} (尝试重启内核重新加载配置失败: {})",
                        err, e
                    ));
                }
                // 等待进程初始化并重试一次 set_model
                tokio::time::sleep(Duration::from_millis(400)).await;
                self.send_command_with_response(
                    serde_json::json!({
                        "type": "set_model",
                        "provider": provider,
                        "modelId": model_id
                    }),
                    Duration::from_secs(8),
                )
                .await
            }
            Err(err) => Err(err),
        }
    }

    /// 切换思考推理等级
    pub async fn set_thinking_level(&self, level: &str) -> Result<(), String> {
        let _ = self
            .send_command_with_response(
                serde_json::json!({
                    "type": "set_thinking_level",
                    "level": level
                }),
                Duration::from_secs(8),
            )
            .await?;
        Ok(())
    }

    /// 发送终止当前操作指令
    pub async fn abort(&self) -> Result<(), String> {
        self.send_command(serde_json::json!({
            "type": "abort"
        }))
        .await
    }

    /// 停止 Pi Host
    pub async fn stop(&self) {
        *self.is_stopping.write().await = true;
        let _ = self.abort().await;
        let mut w = self.stdin_tx.lock().await;
        *w = None;
        self.update_status(HostStatus::Stopped).await;
    }

    /// 重启 Pi Host
    pub async fn restart(&self) -> Result<(), String> {
        self.reset_skill_turns();
        self.stop().await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        self.start().await
    }

    /// 对输入提示词进行 code-area 路由上下文与动态激活 Inner-Skill 注入处理
    /// （不再静态注入完整 RULES.md；Inner-Skill 改由 tool-call hook 按需动态注入）
    pub fn inject_prompt(&self, message: &str) -> (String, InjectedContextInfo) {
        let (skill_injected, info) = self.skill_injector.process_prompt_with_info(message);

        // 检查当前是否处于 code-area 预设工作区
        let active_ws = crate::workspace::read_active_workspace_id();
        if active_ws == "code-area" {
            let route_path = crate::workspace::read_code_area_route_path().unwrap_or_default();
            let skills = crate::workspace::list_code_area_skills(&self.app_handle);

            let routing_context = crate::workspace::build_code_area_routing_context(
                &route_path,
                &skills,
                &self.skill_injector,
            );

            return (format!("{}{}", skill_injected, routing_context), info);
        }

        (skill_injected, info)
    }

    /// Tool call pre-processing hook：
    /// 监听 tool_execution_start 事件，命中 RULES.md 映射时动态注入对应 Inner-Skill。
    /// 优先通过 steer 在当前轮次下一个 LLM 调用前注入；失败时兑底随下一次 Prompt 注入。
    async fn handle_tool_call_hook(this: &PiSupervisor, event_val: &Value) {
        let tool_name = event_val
            .get("toolName")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if tool_name.trim().is_empty() {
            return;
        }

        let Some(activation) = this.skill_injector.hook_tool_call(tool_name) else {
            return;
        };

        // 当轮去重：同一 Skill 在同一轮次内只注入一次
        if !this.skill_injector.mark_skill_activated(&activation.skill) {
            return;
        }

        // 通知前端更新「已激活运行态技能」胶囊
        let _ = this.app_handle.emit(
            "pi:inner-skill-activated",
            serde_json::json!({
                "toolName": activation.tool_name,
                "skill": activation.skill,
            }),
        );

        let Some(injection_text) = this
            .skill_injector
            .build_skill_injection_text(&activation.skill)
        else {
            return;
        };

        let steer_message = format!(
            "[pi-desktop-lite Inner-Skill Hook] 工具 `{}` 触发运行态技能 `{}`，以下约束即时生效，调用该类工具时必须严格遵守：\n{}",
            activation.tool_name, activation.skill, injection_text
        );

        match this
            .send_command(serde_json::json!({
                "type": "steer",
                "message": steer_message,
            }))
            .await
        {
            Ok(_) => {
                // steer 动态注入成功，移除兑底队列避免重复注入
                this.skill_injector.dequeue_skill(&activation.skill);
            }
            Err(err) => {
                log::warn!(
                    "[Supervisor] Inner-Skill steer injection failed for tool `{}` (skill `{}`), fallback to next prompt queue: {}",
                    activation.tool_name,
                    activation.skill,
                    err
                );
            }
        }
    }

    /// 重置 Inner-Skills 动态注入状态（待注入队列与当轮激活去重集合）
    pub fn reset_skill_turns(&self) {
        self.skill_injector.reset_session();
    }

    /// 获取运行态内置规则定义清单
    pub fn get_skill_rules(&self) -> &'static str {
        self.skill_injector.get_rules_content()
    }

    /// 获取从 RULES.md 动态解析的 Skill 映射矩阵
    pub fn get_skill_mappings(&self) -> Vec<crate::pi_runner::SkillMapping> {
        self.skill_injector.get_skill_mappings()
    }

    /// 根据工具名动态查询其在 RULES.md 中绑定的 Inner-Skill
    pub fn resolve_skill_for_tool(&self, tool_name: &str) -> Option<String> {
        self.skill_injector.resolve_skill_for_tool(tool_name)
    }

    /// 获取默认工作空间目录 (default-area)
    /// 优先级（严格按序）：
    /// 1. 显式环境变量 PI_WORKSPACE 覆盖（自动化测试与自定义指定）
    /// 2. 源码工作区相对路径 (开发模式优先，避免 target/debug 临时污染)
    /// 3. 当前运行 exe 所在目录及其 resources/default-area (便携/绿色版)
    /// 4. Tauri Resource 目录 (正式安装版)
    /// 5. 自动兜底创建并写入种子 AGENTS.md 确保防向上穿透
    pub fn get_default_workspace(_app_handle: Option<&AppHandle>) -> PathBuf {
        // 1. 显式环境变量覆盖（自动化测试与自定义指定）
        if let Ok(env_ws) = std::env::var("PI_WORKSPACE") {
            let p = PathBuf::from(env_ws);
            if p.is_dir() {
                return p;
            }
        }

        // 2. 优先使用用户独立数据目录下的隔离工作区（彻底杜绝 Git 根目录向上穿透与无关 AGENTS.md / Skills 污染）
        let target_dir = if let Some(home) = dirs::home_dir() {
            home.join(".pi-dl").join("default-area")
        } else if let Ok(curr) = std::env::current_dir() {
            curr.join("default-area")
        } else {
            PathBuf::from("default-area")
        };

        if let Err(e) = std::fs::create_dir_all(&target_dir) {
            log::warn!("[Supervisor] Failed to create default workspace dir {:?}: {}", target_dir, e);
        } else {
            let agents_md = target_dir.join("AGENTS.md");
            if !agents_md.exists() {
                let seed_content = "# Pi Agent 运行时工作区指南 (AGENTS.md)\n\n欢迎使用 **Pi Desktop Lite** 默认工作区 (`default-area`)。\n\n## 🤖 关于 Pi Agent (自我描述)\n我是 **Pi Agent**，由轻量桌面客户端 (Pi Desktop Lite) 驱动的本地智能助手。当前目录为我的隔离工作空间。\n\n## 📁 默认工作空间说明\n- 当前目录为默认隔离工作空间；\n- 仅当用户明确指示创建或导出文件时，产物才放置于此目录下；未经要求严禁擅自落盘临时文件 (如 output.txt)；纯分析与问答一律直接在对话流中输出 Markdown。\n";
                let _ = std::fs::write(&agents_md, seed_content);
            }
        }

        target_dir
    }

    /// 解析当前生效的工作区路径（多预设模板 → 运行时副本）
    ///
    /// 优先级（严格按序）：
    /// 1. PI_WORKSPACE 环境变量（测试/自动化覆盖，优先）
    /// 2. custom_workspace 运行时覆盖（含 pi_set_active_workspace 写入）
    /// 3. 配置文件 workspace.activeId：存在且合法 → ensure_runtime_workspace(id) 返回的路径
    /// 4. 兜底 → ~/.pi-dl/default-area（保持现状）
    pub async fn resolve_workspace(&self) -> PathBuf {
        // 1. 显式环境变量覆盖（自动化测试与自定义指定）
        if let Ok(env_ws) = std::env::var("PI_WORKSPACE") {
            let p = PathBuf::from(env_ws);
            if p.is_dir() {
                return p;
            }
        }

        // 2. custom_workspace 运行时覆盖
        if let Some(custom) = self.custom_workspace.read().await.as_ref() {
            if custom.is_dir() {
                return custom.clone();
            }
        }

        // 3. 配置文件 workspace.activeId
        let active_id = crate::workspace::read_active_workspace_id();
        if active_id != "default-area" {
            if let Some(template) =
                crate::workspace::find_template_dir(&self.app_handle, &active_id)
            {
                if let Ok(runtime) =
                    crate::workspace::ensure_runtime_workspace(&active_id, &template)
                {
                    if runtime.is_dir() {
                        log::info!(
                            "[Supervisor] Active workspace resolved from config: {} -> {:?}",
                            active_id,
                            runtime
                        );
                        return runtime;
                    }
                }
            }
        }

        // 4. 兜底 → ~/.pi-dl/default-area
        Self::get_default_workspace(Some(&self.app_handle))
    }

    /// 获取当前工作区绝对路径
    pub async fn get_workspace(&self) -> PathBuf {
        self.resolve_workspace().await
    }

    /// 设置并切换工作区（预留后续动态切换接口）
    pub async fn set_workspace(&self, new_path: PathBuf) {
        let _ = std::fs::create_dir_all(&new_path);
        let mut w = self.custom_workspace.write().await;
        *w = Some(new_path);
    }
}



