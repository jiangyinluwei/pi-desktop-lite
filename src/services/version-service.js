import { invokeTauri } from "./tauri-bridge.js";

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

      await window.__TAURI__.event.listen("kernel-update-progress", (event) => {
        const payload = event.payload;
        this.dispatchEvent(new CustomEvent("kernel-update-progress", { detail: payload }));
        if (payload?.stage === "completed") {
          this.latestUpdate = {
            ...(this.latestUpdate || {}),
            current_version: payload.target_version,
            has_update: false,
          };
          this.dispatchEvent(new CustomEvent("kernel-updated", { detail: payload }));
        }
      });

      // 尝试获取缓存的更新状态
      const cached = await invokeTauri("pi_get_cached_update");
      if (cached) {
        this.latestUpdate = cached;
        if (cached.has_update) {
          this.dispatchEvent(new CustomEvent("update-available", { detail: cached }));
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
    try {
      const res = await invokeTauri("pi_check_update");
      this.latestUpdate = res;
      return res;
    } catch (err) {
      console.error("[VersionService] Failed to check update:", err);
      return null;
    }
  }

  /**
   * 触发 Pi 内核一键更新
   * @param {string} targetVersion 目标版本号 (如 "0.84.4")
   */
  async updateKernel(targetVersion) {
    if (!targetVersion) {
      throw new Error("Target version cannot be empty");
    }
    try {
      const res = await invokeTauri("pi_update_kernel", { targetVersion });
      return res;
    } catch (err) {
      console.error("[VersionService] Failed to update kernel:", err);
      throw err;
    }
  }
}

export const versionService = new VersionService();

