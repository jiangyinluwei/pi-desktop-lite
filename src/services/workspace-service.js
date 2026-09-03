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
   * @returns {Promise<{path, restarted, activeTasks, requiresRoute, routePath}|null>}
   */
  async setActiveWorkspace(id) {
    try {
      return await invokeTauri("pi_set_active_workspace", { id });
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_set_active_workspace:", err);
      throw err;
    }
  }

  /**
   * 唤起系统原生文件夹选择器 (Windows 原生 OpenFolder / 选择文件夹对话框)
   * @param {string} [defaultPath] 初始候选目录
   * @returns {Promise<string|null>}
   */
  async selectFolder(defaultPath = "") {
    try {
      const selected = await invokeTauri("pi_select_folder", { defaultPath: defaultPath || null });
      return typeof selected === "string" && selected.trim() ? selected.trim().replace(/\\/g, "/") : null;
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_select_folder:", err);
      return null;
    }
  }

  /**
   * 获取 code-area 路由工作区详情（目标路径、历史、内置技能集）
   * @returns {Promise<{routePath, name, exists, history, skills}|null>}
   */
  async getCodeAreaRoute() {
    try {
      return await invokeTauri("pi_get_code_area_route");
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_get_code_area_route:", err);
      return null;
    }
  }

  /**
   * 设置并保存 code-area 路由工作区路径
   * @param {string} routePath 目标项目物理绝对路径
   * @returns {Promise<{routePath, name, history}>}
   */
  async setCodeAreaRoute(routePath) {
    try {
      return await invokeTauri("pi_set_code_area_route", { routePath });
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_set_code_area_route:", err);
      throw err;
    }
  }

  /**
   * 列出 code-area 内置编码技能集
   * @returns {Promise<Array<{id, name, description, path}>>}
   */
  async listCodeAreaSkills() {
    try {
      const skills = await invokeTauri("pi_list_code_area_skills");
      return Array.isArray(skills) ? skills : [];
    } catch (err) {
      console.warn("[WorkspaceService] Failed to invoke pi_list_code_area_skills:", err);
      return [];
    }
  }
}

export const workspaceService = new WorkspaceService();
