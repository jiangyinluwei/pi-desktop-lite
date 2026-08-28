use crate::session::parser::{parse_session_file, SessionMetadata};
use dashmap::DashMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Clone)]
pub struct SessionIndexCache {
    /// 键为 session_id，值为元数据
    cache: Arc<DashMap<String, SessionMetadata>>,
    /// 路径到 session_id 映射
    path_to_id: Arc<DashMap<String, String>>,
}

impl SessionIndexCache {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(DashMap::new()),
            path_to_id: Arc::new(DashMap::new()),
        }
    }

    /// 插入或更新会话元数据
    pub fn update_file(&self, path: &Path) {
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            return;
        }

        if let Ok(meta) = parse_session_file(path) {
            let session_id = meta.session_id.clone();
            let path_str = meta.file_path.clone();

            self.cache.insert(session_id.clone(), meta);
            self.path_to_id.insert(path_str, session_id);
        }
    }

    /// 移除会话
    pub fn remove_file(&self, path: &Path) {
        let path_str = path.to_string_lossy().to_string();
        if let Some((_, session_id)) = self.path_to_id.remove(&path_str) {
            self.cache.remove(&session_id);
        }
    }

    /// 全量扫描指定目录
    pub fn scan_directory(&self, dir: &Path) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    self.update_file(&p);
                }
            }
        }
    }

    /// 获取全部会话列表（按修改时间倒序排列）
    pub fn list_all(&self) -> Vec<SessionMetadata> {
        let mut list: Vec<SessionMetadata> = self.cache.iter().map(|kv| kv.value().clone()).collect();
        list.sort_by(|a, b| {
            b.modified_at
                .as_deref()
                .unwrap_or("")
                .cmp(a.modified_at.as_deref().unwrap_or(""))
        });
        list
    }

    /// 根据 session_id 获取元数据
    pub fn get_by_id(&self, session_id: &str) -> Option<SessionMetadata> {
        self.cache.get(session_id).map(|kv| kv.value().clone())
    }
}
