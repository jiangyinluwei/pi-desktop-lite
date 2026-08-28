use crate::security::redaction::redact_json;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::mpsc;

/// 去除末尾的 `\r\n` 或 `\n`，不影响内容中的 Unicode 换行符
fn trim_crlf(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    if end > 0 && bytes[end - 1] == b'\n' {
        end -= 1;
    }
    if end > 0 && bytes[end - 1] == b'\r' {
        end -= 1;
    }
    &bytes[..end]
}

/// 严格按字节 `\n` 切分的 JSONL 字节流分帧器
pub async fn run_stdout_framer<R: AsyncRead + Unpin>(
    reader: R,
    event_tx: mpsc::Sender<Value>,
) -> Result<(), std::io::Error> {
    let mut buf_reader = BufReader::new(reader);
    let mut line_buf = Vec::with_capacity(4096);

    loop {
        line_buf.clear();
        let bytes_read = buf_reader.read_until(b'\n', &mut line_buf).await?;
        if bytes_read == 0 {
            break; // EOF
        }

        let trimmed = trim_crlf(&line_buf);
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_slice::<Value>(trimmed) {
            Ok(json_val) => {
                let redacted = redact_json(&json_val);
                if let Err(_) = event_tx.send(redacted).await {
                    log::debug!("[Framer] Event channel receiver dropped, exiting framer loop.");
                    break;
                }
            }
            Err(err) => {
                let raw_snippet = String::from_utf8_lossy(trimmed);
                log::warn!("[Framer] Invalid JSON line: {}, data: {}", err, raw_snippet);
            }
        }
    }

    Ok(())
}

/// 辅助异步读取 stderr 并记录脱敏日志
pub async fn run_stderr_logger<R: AsyncRead + Unpin>(reader: R) -> Result<(), std::io::Error> {
    let mut buf_reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = buf_reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            break;
        }
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            let redacted = crate::security::redaction::redact_str(trimmed);
            log::warn!("[Pi stderr] {}", redacted);
        }
    }

    Ok(())
}
