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
