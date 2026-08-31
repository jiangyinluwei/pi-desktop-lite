/**
 * 多预设工作区服务 (workspace-service.js)
 * 封装后端 Tauri 工作区指令：纯 IPC，不触碰任何 UI DOM。
 */
import { invokeTauri } from "./tauri-bridge.js";

class WorkspaceService {
  /**
   * 列出全部内置工作区预设（模板 + 运行时状态）
   * @returns {Promise<Array<{id, name, description, icon, templatePath, runtimePath, isActive, isRuntimeReady}>>}
   */
  async listWorkspaces() {
    try {
      const list = await invokeTauri("pi_list_workspaces");
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_list_workspaces:", err);
      return [];
    }
  }

  /**
   * 解析当前生效工作区
   * @returns {Promise<{id, name, path}|null>}
   */
  async getActiveWorkspace() {
    try {
      return await invokeTauri("pi_get_active_workspace");
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_get_active_workspace:", err);
      return null;
    }
  }

  /**
   * 切换当前激活工作区（后端负责物化运行时副本与持久化）
   * @param {string} id 工作区 id（如 code-area / research-area / default-area）
   * @returns {Promise<{path, restarted, activeTasks}|null>}
   */
  async setActiveWorkspace(id) {
    try {
      return await invokeTauri("pi_set_active_workspace", { id });
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_set_active_workspace:", err);
      throw err;
    }
  }
}

export const workspaceService = new WorkspaceService();
