use crate::session::index_cache::SessionIndexCache;
use crate::session::parser::SessionMetadata;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};

enum SessionFileEvent {
    Upsert(PathBuf),
    Remove(PathBuf),
}

#[derive(Clone)]
pub struct SessionWatcher {
    _watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    pub sessions_dir: PathBuf,
}

impl SessionWatcher {
    pub fn get_default_sessions_dir() -> PathBuf {
        dirs::home_dir()
            .map(|h| h.join(".pi").join("agent").join("sessions"))
            .unwrap_or_else(|| PathBuf::from(".pi/agent/sessions"))
    }

    pub fn new(app_handle: AppHandle, cache: SessionIndexCache) -> Self {
        let sessions_dir = Self::get_default_sessions_dir();

        // 确保目录存在
        if !sessions_dir.exists() {
            let _ = std::fs::create_dir_all(&sessions_dir);
        }

        // 初始化全量扫描（后台线程执行）：会话文件可达数百个且体积较大，
        // 同步扫描会阻塞主线程 setup 回调，导致首次启动窗口卡顿 1~2 秒。
        // 扫描完成后主动广播 pi:sessions-updated，前端会话列表据此刷新。
        let scan_cache = cache.clone();
        let scan_dir = sessions_dir.clone();
        let scan_app_handle = app_handle.clone();
        std::thread::Builder::new()
            .name("session-initial-scan".to_string())
            .spawn(move || {
                scan_cache.scan_directory(&scan_dir);
                // 兼容扫描：若用户仍留存旧版 ~/.pi/sessions 目录，一并补充扫描
                if let Some(h) = dirs::home_dir() {
                    let legacy_dir = h.join(".pi").join("sessions");
                    if legacy_dir.is_dir() && legacy_dir != scan_dir {
                        scan_cache.scan_directory(&legacy_dir);
                    }
                }
                let list = scan_cache.list_all();
                let _ = scan_app_handle.emit("pi:sessions-updated", &list);
                log::info!(
                    "[SessionWatcher] Initial session index scan completed ({} sessions)",
                    list.len()
                );
            })
            .ok();

        let (tx, mut rx) = mpsc::unbounded_channel::<SessionFileEvent>();

        // 后台异步防抖聚合通道：以 300ms 窗口合并高频刷盘事件，杜绝 IPC 广播与全量会话重排风暴
        let debounce_cache = cache.clone();
        let debounce_app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut pending_upserts = HashSet::new();
            let mut pending_removes = HashSet::new();

            loop {
                // 等待第一个文件变更事件到来（闲时零 CPU 消耗）
                let first_event = match rx.recv().await {
                    Some(ev) => ev,
                    None => break,
                };

                match first_event {
                    SessionFileEvent::Upsert(p) => {
                        pending_removes.remove(&p);
                        pending_upserts.insert(p);
                    }
                    SessionFileEvent::Remove(p) => {
                        pending_upserts.remove(&p);
                        pending_removes.insert(p);
                    }
                }

                // 300ms 防抖滑动窗口
                let debounce_window = Duration::from_millis(300);
                let sleep_timer = sleep(debounce_window);
                tokio::pin!(sleep_timer);

                loop {
                    tokio::select! {
                        _ = &mut sleep_timer => {
                            break;
                        }
                        ev_opt = rx.recv() => {
                            match ev_opt {
                                Some(ev) => {
                                    match ev {
                                        SessionFileEvent::Upsert(p) => {
                                            pending_removes.remove(&p);
                                            pending_upserts.insert(p);
                                        }
                                        SessionFileEvent::Remove(p) => {
                                            pending_upserts.remove(&p);
                                            pending_removes.insert(p);
                                        }
                                    }
                                    sleep_timer.as_mut().reset(tokio::time::Instant::now() + debounce_window);
                                }
                                None => break,
                            }
                        }
                    }
                }

                // 统一批处理：仅对去重后的路径单次读盘与索引更新
                let mut changed = false;
                for p in pending_upserts.drain() {
                    debounce_cache.update_file(&p);
                    changed = true;
                }
                for p in pending_removes.drain() {
                    debounce_cache.remove_file(&p);
                    changed = true;
                }

                if changed {
                    let list = debounce_cache.list_all();
                    let _ = debounce_app_handle.emit("pi:sessions-updated", &list);
                }
            }
        });

        let watcher_tx = tx.clone();
        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Remove(_) => {
                            for p in event.paths {
                                let _ = watcher_tx.send(SessionFileEvent::Remove(p));
                            }
                        }
                        EventKind::Access(_) => {
                            // 纯读取事件忽略
                        }
                        _ => {
                            // 包含 Create, Modify, Any, Other 等全部产生或变更文件的事件
                            for p in event.paths {
                                let _ = watcher_tx.send(SessionFileEvent::Upsert(p));
                            }
                        }
                    }
                }
            },
            Config::default(),
        )
        .ok();

        if let Some(ref mut w) = watcher {
            // 递归监听：会话文件存放于按 CWD 命名的二级子目录中
            if let Err(e) = w.watch(&sessions_dir, RecursiveMode::Recursive) {
                log::warn!("[SessionWatcher] Failed to watch {}: {}", sessions_dir.display(), e);
            } else {
                log::info!("[SessionWatcher] Watching session directory: {}", sessions_dir.display());
            }
        }

        Self {
            _watcher: Arc::new(Mutex::new(watcher)),
            sessions_dir,
        }
    }

    /// 主动扫描会话目录并广播更新，返回最新元数据列表
    pub fn scan_and_broadcast(&self, cache: &SessionIndexCache, app_handle: &AppHandle) -> Vec<SessionMetadata> {
        cache.scan_directory(&self.sessions_dir);
        let list = cache.list_all();
        let _ = app_handle.emit("pi:sessions-updated", &list);
        list
    }
}
