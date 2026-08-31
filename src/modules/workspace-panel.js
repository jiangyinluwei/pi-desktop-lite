import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { sketchConfirm } from "../services/sketch-modal.js";
import { workspaceService } from "../services/workspace-service.js";

/**
 * 工作区设置面板 (Workspace Panel)
 * - 当前工作区卡片（名称 + ID 徽章 + 运行时绝对路径）
 * - 预设工作区列表（卡片式：名称 / id 徽章 / 描述 / 运行时路径 / 状态）
 * - 切换交互：运行时任务数 > 0 时走 sketchConfirm 确认；切换后刷新 ctx.settings.activeWorkspace
 */
export function initWorkspacePanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const settings = ctx.settings;

  const workspaceList = el.workspaceList;
  const workspaceActiveName = el.workspaceActiveName;
  const workspaceActivePath = el.workspaceActivePath;
  const workspaceActiveBadge = el.workspaceActiveBadge;

  const showGlobalToast = (msg, duration = 1500) => {
    if (typeof api.showGlobalToast === "function") {
      api.showGlobalToast(msg, duration);
    }
  };

  // ==========================================================================
  // 渲染当前工作区卡片
  // ==========================================================================
  const renderActiveCard = (active) => {
    if (!active) return;
    settings.activeWorkspace = {
      id: active.id,
      name: active.name,
      path: active.path,
    };
    if (workspaceActiveName) {
      workspaceActiveName.textContent = active.name || active.id || "默认工作区";
    }
    if (workspaceActiveBadge) {
      workspaceActiveBadge.textContent = active.id || "default-area";
    }
    if (workspaceActivePath) {
      workspaceActivePath.textContent = active.path || "";
      workspaceActivePath.setAttribute("title", active.path || "");
    }
  };

  // ==========================================================================
  // 渲染预设工作区列表
  // ==========================================================================
  const renderWorkspaceList = (list) => {
    if (!workspaceList) return;

    if (!list || list.length === 0) {
      workspaceList.innerHTML = `<div class="empty-workspaces">未发现任何工作区预设</div>`;
      return;
    }

    workspaceList.innerHTML = "";
    list.forEach((ws) => {
      const item = document.createElement("div");
      item.className = `workspace-item${ws.isActive ? " active" : ""}`;

      const info = document.createElement("div");
      info.className = "workspace-item-info";

      const header = document.createElement("div");
      header.className = "workspace-item-header";
      header.innerHTML = `
        <span class="workspace-item-name">${escapeHtml(ws.name || ws.id)}</span>
        <span class="flat-badge" title="${escapeHtml(ws.id)}">${escapeHtml(ws.id)}</span>
      `;

      const desc = document.createElement("div");
      desc.className = "workspace-item-desc";
      desc.textContent = ws.description || "暂无描述";

      info.appendChild(header);
      info.appendChild(desc);

      // 已物化运行时路径（存在时展示）
      if (ws.runtimePath) {
        const runtime = document.createElement("div");
        runtime.className = "workspace-item-runtime";
        runtime.textContent = ws.runtimePath;
        runtime.setAttribute("title", ws.runtimePath);
        info.appendChild(runtime);
      }

      const actions = document.createElement("div");
      actions.className = "workspace-item-actions";

      if (ws.isActive) {
        const badge = document.createElement("span");
        badge.className = "workspace-inuse-badge";
        badge.textContent = "使用中";
        actions.appendChild(badge);
      } else {
        const switchBtn = document.createElement("button");
        switchBtn.type = "button";
        switchBtn.className = "flat-btn flat-btn-secondary mini";
        switchBtn.innerHTML = `<span>切换</span>${ICONS.check}`;
        switchBtn.addEventListener("click", () => handleSwitch(ws));
        actions.appendChild(switchBtn);
      }

      item.appendChild(info);
      item.appendChild(actions);
      workspaceList.appendChild(item);
    });
  };

  // ==========================================================================
  // 加载工作区列表并渲染
  // ==========================================================================
  const loadWorkspaces = async () => {
    if (!workspaceList) return;

    const [list, active] = await Promise.all([
      workspaceService.listWorkspaces(),
      workspaceService.getActiveWorkspace(),
    ]);

    renderActiveCard(active);
    renderWorkspaceList(list);
  };

  // ==========================================================================
  // 切换工作区
  // ==========================================================================
  const handleSwitch = async (ws) => {
    if (ws.isActive) return;

    // 运行时任务数 > 0 时弹出手绘确认（SketchModal 规范：居中 / 毛玻璃 / 右键 Esc 优先拦截）
    let activeTasks = [];
    try {
      activeTasks = await piClient.getActiveTasks();
    } catch (_) {
      activeTasks = [];
    }

    if (activeTasks.length > 0) {
      const confirmed = await sketchConfirm(
        `有 ${activeTasks.length} 个任务正在运行，切换工作区仅对之后的新会话生效（已运行任务保持原工作区）。确定切换至「${ws.name}」吗？`,
        {
          title: "切换工作区",
          confirmText: "仍要切换",
          cancelText: "取消",
        }
      );
      if (!confirmed) return;
    }

    try {
      const result = await workspaceService.setActiveWorkspace(ws.id);
      if (!result) return;

      // 刷新当前卡片与列表
      await loadWorkspaces();

      if (result.activeTasks > 0) {
        showGlobalToast(`已切换至「${ws.name}」· 仅对新会话生效`, 2200);
      } else if (result.restarted) {
        showGlobalToast(`已切换至「${ws.name}」· 内核已重启生效`, 2200);
      } else {
        showGlobalToast(`已切换至「${ws.name}」`, 1500);
      }
    } catch (err) {
      console.error("[WorkspacePanel] Failed to switch workspace:", err);
      showGlobalToast("工作区切换失败，请重试", 2000);
    }
  };

  api.loadWorkspaces = loadWorkspaces;
}
