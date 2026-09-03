/**
 * Tauri IPC 统一跨平台调用桥接器 (tauri-bridge.js)
 * 封装安全的 invoke 调用、异常拦截与无缝 fallback
 */

/**
 * 安全调用 Tauri Invoke 后端指令
 * @param {string} command Tauri 指令名
 * @param {Record<string, any>} [args={}] 传递给后端的参数
 * @returns {Promise<any>}
 */
export async function invokeTauri(command, args = {}) {
  if (window.__TAURI__?.core?.invoke) {
    try {
      return await window.__TAURI__.core.invoke(command, args);
    } catch (err) {
      console.error(`[Tauri IPC] ${command} error:`, err);
      throw err;
    }
  } else {
    console.warn(`[Tauri IPC] Tauri core is not available for command: ${command}`);
    return null;
  }
}

/**
 * 唤起系统默认浏览器打开外部超链接 (URL / HTTP / HTTPS / Mailto)
 * @param {string} url 目标链接
 * @returns {Promise<boolean>}
 */
export async function openExternalUrl(url) {
  if (!url || typeof url !== "string") return false;
  const targetUrl = url.trim();
  if (!targetUrl) return false;

  try {
    if (window.__TAURI__?.opener?.openUrl) {
      await window.__TAURI__.opener.openUrl(targetUrl);
      return true;
    }
  } catch (err) {
    console.warn("[Tauri Opener] plugin opener failed, trying invoke fallback:", err);
  }

  try {
    if (window.__TAURI__?.core?.invoke) {
      await invokeTauri("pi_open_url", { url: targetUrl });
      return true;
    }
  } catch (err) {
    console.warn("[Tauri Opener] pi_open_url invoke failed, trying browser window.open:", err);
  }

  // 浏览器降级通道
  try {
    const newWin = window.open(targetUrl, "_blank", "noopener,noreferrer");
    return Boolean(newWin);
  } catch (err) {
    console.error("[Tauri Opener] window.open failed:", err);
    return false;
  }
}

