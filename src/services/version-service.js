/**
 * 版本监测与更新提醒服务 (version-service.js)
 */

class VersionService extends EventTarget {
  constructor() {
    super();
    this.latestUpdate = null;
    this.initListeners();
  }

  async initListeners() {
    if (!window.__TAURI__?.event?.listen) return;

    try {
      await window.__TAURI__.event.listen("pi:update", (event) => {
        this.latestUpdate = event.payload;
        this.dispatchEvent(new CustomEvent("update-available", { detail: this.latestUpdate }));
      });

      // 尝试获取缓存的更新状态
      if (window.__TAURI__?.core?.invoke) {
        const cached = await window.__TAURI__.core.invoke("pi_get_cached_update");
        if (cached) {
          this.latestUpdate = cached;
          if (cached.has_update) {
            this.dispatchEvent(new CustomEvent("update-available", { detail: cached }));
          }
        }
      }
    } catch (e) {
      console.warn("[VersionService] Failed to bind version events:", e);
    }
  }

  /**
   * 手动触发即时版本检查
   */
  async checkUpdate() {
    if (window.__TAURI__?.core?.invoke) {
      try {
        const res = await window.__TAURI__.core.invoke("pi_check_update");
        this.latestUpdate = res;
        return res;
      } catch (err) {
        console.error("[VersionService] Failed to check update:", err);
      }
    }
    return null;
  }
}

export const versionService = new VersionService();
