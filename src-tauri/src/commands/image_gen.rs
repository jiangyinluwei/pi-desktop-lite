//! `commands/image_gen` — 专用生图接口调用与产物落盘指令。
//! 支持：
//! 1. OpenAI 兼容 `/images/generations` 接口（SiliconFlow FLUX、OpenAI DALL-E 等）
//! 2. 阿里百炼 DashScope 原生异步生图接口（通义万相 Wanx 系列）

use crate::config_manager::pi_get_custom_models;
use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;

/// 保存图像字节流到本地附件目录并返回绝对路径
fn save_image_bytes(bytes: &[u8], ext: &str) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("生图返回的数据流为空".to_string());
    }

    let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    let attach_dir = home.join(".pi-dl").join("attachments");
    if !attach_dir.exists() {
        std::fs::create_dir_all(&attach_dir).map_err(|e| format!("创建附件目录失败: {}", e))?;
    }

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let short_id = &uuid::Uuid::new_v4().to_string()[..8];
    let safe_ext = if ["png", "jpg", "jpeg", "webp"].contains(&ext) {
        ext
    } else {
        "png"
    };
    let file_name = format!("pi_gen_{}_{}.{}", timestamp, short_id, safe_ext);
    let target_path = attach_dir.join(file_name);

    std::fs::write(&target_path, bytes).map_err(|e| format!("保存生图产物失败: {}", e))?;
    Ok(target_path.to_string_lossy().to_string())
}

/// 解析可能的环境变量引用 ($ENV_VAR)
/// 返回 Err 表示声明了 $VAR 引用但环境变量缺失/为空，显式报错优于把字面 "$VAR" 当密钥发送
fn resolve_api_key(raw_key: Option<&str>) -> Result<Option<String>, String> {
    let Some(k) = raw_key else {
        return Ok(None);
    };
    let trimmed = k.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if let Some(var_name) = trimmed.strip_prefix('$') {
        return match std::env::var(var_name) {
            Ok(val) if !val.trim().is_empty() => Ok(Some(val)),
            _ => Err(format!(
                "环境变量 {} 未设置或为空，无法读取生图接口凭据",
                var_name
            )),
        };
    }
    Ok(Some(trimmed.to_string()))
}

/// 调用专用生图接口生成图像并落盘至本地
#[tauri::command]
pub async fn pi_generate_image(
    provider_id: String,
    model_id: String,
    prompt: String,
    size: Option<String>,
) -> Result<String, String> {
    let p_id_lower = provider_id.trim().to_lowercase();
    if p_id_lower.is_empty() {
        return Err("生图运营商 ID 不能为空".to_string());
    }
    let m_id = model_id.trim();
    if m_id.is_empty() {
        return Err("生图模型 ID 不能为空".to_string());
    }
    let p_text = prompt.trim();
    if p_text.is_empty() {
        return Err("生图提示词 (prompt) 不能为空".to_string());
    }

    // 1. 读取自定义运营商配置
    let custom_config = pi_get_custom_models().unwrap_or_else(|_| json!({ "providers": {} }));
    let providers = custom_config
        .get("providers")
        .and_then(|p| p.as_object())
        .ok_or_else(|| "未找到自定义运营商配置字典".to_string())?;

    let prov_data = providers
        .get(&p_id_lower)
        .and_then(|p| p.as_object())
        .ok_or_else(|| format!("未在 models.json 中找到运营商 [{}] 的配置", provider_id))?;

    let base_url = prov_data
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let api_type = prov_data
        .get("api")
        .and_then(|v| v.as_str())
        .unwrap_or("openai-completions")
        .trim()
        .to_lowercase();
    let api_key = resolve_api_key(prov_data.get("apiKey").and_then(|v| v.as_str()))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 2. 生图接口判定：与前端 multimodal-detector.js isImageGenerationApiType 保持唯一同口径 ——
    //    接口类型名包含 "image"，或为 DashScope 原生异步接口（dashscope-async）
    let is_dashscope = api_type.contains("dashscope");
    let is_image_api = api_type.contains("image") || api_type == "dashscope-async";
    if !is_image_api {
        return Err(format!(
            "运营商 [{}] 接口类型为 [{}]，不支持直接生图。\n“/v1/chat/completions”、“/v1/responses”、“Anthropic类型” 都不支持直接输出图片，必须使用 “OpenAI 兼容的 /images/generations 类型” 或 “DashScope 原生异步接口”。",
            provider_id, api_type
        ));
    }

    if !is_dashscope {
        // --------------------------------------------------------------------
        // OpenAI 兼容 /images/generations 端点
        // --------------------------------------------------------------------
        let target_url = if base_url.ends_with("/images/generations") {
            base_url.to_string()
        } else if base_url.ends_with("/v1") {
            format!("{}/images/generations", base_url)
        } else if !base_url.is_empty() {
            format!("{}/v1/images/generations", base_url.trim_end_matches('/'))
        } else {
            "https://api.openai.com/v1/images/generations".to_string()
        };

        let mut body_map = serde_json::Map::new();
        body_map.insert("model".to_string(), json!(m_id));
        body_map.insert("prompt".to_string(), json!(p_text));
        body_map.insert("n".to_string(), json!(1));
        if let Some(ref s) = size {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                body_map.insert("size".to_string(), json!(trimmed));
            }
        }
        let body = Value::Object(body_map);

        let mut req = client.post(&target_url).header("User-Agent", "pi-desktop-lite");
        if let Some(ref key) = api_key {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let resp = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求生图端点失败: {}", e))?;

        let status = resp.status();
        let resp_text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!(
                "生图接口返回错误 (HTTP {}): {}",
                status.as_u16(),
                resp_text
            ));
        }

        let json_val: Value = serde_json::from_str(&resp_text)
            .map_err(|e| format!("解析生图响应 JSON 失败: {} (原始数据: {})", e, resp_text))?;

        let data_arr = json_val
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or_else(|| format!("生图响应中缺少 'data' 字段: {}", resp_text))?;

        if data_arr.is_empty() {
            return Err("生图响应中的 'data' 数组为空".to_string());
        }

        let first_item = &data_arr[0];
        if let Some(b64_str) = first_item.get("b64_json").and_then(|b| b.as_str()) {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64_str.trim())
                .map_err(|e| format!("解码 b64_json 失败: {}", e))?;
            return save_image_bytes(&bytes, "png");
        } else if let Some(url_str) = first_item.get("url").and_then(|u| u.as_str()) {
            let img_resp = client
                .get(url_str)
                .send()
                .await
                .map_err(|e| format!("下载生成的图片失败: {}", e))?;
            let img_bytes = img_resp
                .bytes()
                .await
                .map_err(|e| format!("读取生成的图片数据流失败: {}", e))?;
            return save_image_bytes(&img_bytes, "png");
        } else {
            return Err(format!("生图结果中未找到 b64_json 或 url: {}", resp_text));
        }
    } else {
        // --------------------------------------------------------------------
        // DashScope 原生异步接口 (通义万相)
        // --------------------------------------------------------------------
        let submit_url = if !base_url.is_empty() {
            base_url.to_string()
        } else {
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
                .to_string()
        };

        let request_size = size.unwrap_or_else(|| "1024*1024".to_string());
        let submit_body = json!({
            "model": m_id,
            "input": {
                "prompt": p_text
            },
            "parameters": {
                "size": request_size,
                "n": 1
            }
        });

        let mut req = client
            .post(&submit_url)
            .header("User-Agent", "pi-desktop-lite")
            .header("X-DashScope-Async", "enable");
        if let Some(ref key) = api_key {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let submit_resp = req
            .json(&submit_body)
            .send()
            .await
            .map_err(|e| format!("提交 DashScope 异步生图任务失败: {}", e))?;

        let submit_status = submit_resp.status();
        let submit_text = submit_resp.text().await.unwrap_or_default();
        if !submit_status.is_success() {
            return Err(format!(
                "提交 DashScope 异步生图任务失败 (HTTP {}): {}",
                submit_status.as_u16(),
                submit_text
            ));
        }

        let submit_val: Value = serde_json::from_str(&submit_text)
            .map_err(|e| format!("解析 DashScope 任务返回失败: {}", e))?;

        let task_id = submit_val
            .get("output")
            .and_then(|o| o.get("task_id"))
            .and_then(|t| t.as_str())
            .ok_or_else(|| format!("未在响应中获取到 task_id: {}", submit_text))?
            .to_string();

        // 异步轮询任务状态（最多 50 次，每次间隔 2 秒，最长 100 秒）
        // 轮询端点从提交 URL 的 origin 派生：兼容国际站（dashscope-intl）与反向代理部署，
        // 严禁硬编码官方主域——任务在代理域提交却在官方域查询将永远 404 直至假超时
        let poll_origin = reqwest::Url::parse(&submit_url)
            .ok()
            .map(|u| u.origin().ascii_serialization())
            .filter(|o| o.starts_with("http"))
            .unwrap_or_else(|| "https://dashscope.aliyuncs.com".to_string());
        let poll_url = format!("{}/api/v1/tasks/{}", poll_origin, task_id);
        let max_polls = 50;

        for _ in 0..max_polls {
            tokio::time::sleep(Duration::from_secs(2)).await;

            let mut poll_req = client.get(&poll_url).header("User-Agent", "pi-desktop-lite");
            if let Some(ref key) = api_key {
                poll_req = poll_req.header("Authorization", format!("Bearer {}", key));
            }

            let poll_resp = match poll_req.send().await {
                Ok(r) => r,
                Err(_) => continue,
            };

            if let Ok(poll_val) = poll_resp.json::<Value>().await {
                let status_str = poll_val
                    .get("output")
                    .and_then(|o| o.get("task_status"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");

                if status_str == "SUCCEEDED" {
                    let results = poll_val
                        .get("output")
                        .and_then(|o| o.get("results"))
                        .and_then(|r| r.as_array());

                    if let Some(arr) = results {
                        if let Some(first_res) = arr.first() {
                            if let Some(img_url) = first_res.get("url").and_then(|u| u.as_str()) {
                                let img_resp = client
                                    .get(img_url)
                                    .send()
                                    .await
                                    .map_err(|e| format!("下载通义万相图片失败: {}", e))?;
                                let img_bytes = img_resp
                                    .bytes()
                                    .await
                                    .map_err(|e| format!("读取通义万相图片流失败: {}", e))?;
                                return save_image_bytes(&img_bytes, "png");
                            }
                        }
                    }
                    return Err(format!("DashScope 任务成功但未获取到结果图片 URL: {:?}", poll_val));
                } else if status_str == "FAILED" {
                    let msg = poll_val
                        .get("output")
                        .and_then(|o| o.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("未知错误");
                    return Err(format!("DashScope 异步生图任务失败: {}", msg));
                } else if status_str == "CANCELED" {
                    return Err("DashScope 异步生图任务已被取消".to_string());
                }
            }
        }

        Err("DashScope 异步生图任务等待超时（100秒）".to_string())
    }
}
