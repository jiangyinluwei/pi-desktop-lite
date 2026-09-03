use crate::session::index_cache::SessionIndexCache;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};

enum SessionFileEvent {
    Upsert(PathBuf),
    Remove(PathBuf),
}

pub struct SessionWatcher {
    _watcher: Option<RecommendedWatcher>,
    pub sessions_dir: PathBuf,
}

impl SessionWatcher {
    pub fn get_default_sessions_dir() -> PathBuf {
        dirs::home_dir()
            .map(|h| {
                // Pi 内核真实会话根目录为 ~/.pi/agent/sessions（内含按 CWD 命名的子目录）；
                // 仅当其不存在时回退旧路径 ~/.pi/sessions
                let agent_sessions = h.join(".pi").join("agent").join("sessions");
                if agent_sessions.exists() {
                    agent_sessions
                } else {
                    h.join(".pi").join("sessions")
                }
            })
            .unwrap_or_else(|| PathBuf::from(".pi/sessions"))
    }

    pub fn new(app_handle: AppHandle, cache: SessionIndexCache) -> Self {
        let sessions_dir = Self::get_default_sessions_dir();

        // 确保目录存在
        if !sessions_dir.exists() {
            let _ = std::fs::create_dir_all(&sessions_dir);
        }

        // 初始化全量扫描
        cache.scan_directory(&sessions_dir);

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
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            for p in event.paths {
                                let _ = watcher_tx.send(SessionFileEvent::Upsert(p));
                            }
                        }
                        EventKind::Remove(_) => {
                            for p in event.paths {
                                let _ = watcher_tx.send(SessionFileEvent::Remove(p));
                            }
                        }
                        _ => {}
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
            _watcher: watcher,
            sessions_dir,
        }
    }
}
