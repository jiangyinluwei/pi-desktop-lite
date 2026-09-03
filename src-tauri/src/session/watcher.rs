use crate::session::index_cache::SessionIndexCache;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

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

        let cache_clone = cache.clone();
        let app_handle_clone = app_handle.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let mut changed = false;
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            for p in event.paths {
                                cache_clone.update_file(&p);
                                changed = true;
                            }
                        }
                        EventKind::Remove(_) => {
                            for p in event.paths {
                                cache_clone.remove_file(&p);
                                changed = true;
                            }
                        }
                        _ => {}
                    }

                    if changed {
                        let list = cache_clone.list_all();
                        let _ = app_handle_clone.emit("pi:sessions-updated", &list);
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
