import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { SketchModal, sketchConfirm } from "../services/sketch-modal.js";
import { workspaceService } from "../services/workspace-service.js";

/**
 * 弹出手绘草图质感路由工作区配置对话框 (SketchModal 规范)
 * 必须选择有效目录，点击取消或关闭返回 null
 * @param {string} [initialPath] 初始路径
 * @param {string} [customTitle] 自定义标题
 * @returns {Promise<string|null>} 选中的规范化绝对路径
 */
export function promptCodeAreaRouteModal(initialPath = "", customTitle = "配置 code-area 路由目标项目") {
  return new Promise(async (resolve) => {
    let routeInfo = null;
    try {
      routeInfo = await workspaceService.getCodeAreaRoute();
    } catch (_) {
      routeInfo = null;
    }

    const currentVal = initialPath || (routeInfo ? routeInfo.routePath : "") || "";
    const historyList = (routeInfo && Array.isArray(routeInfo.history)) ? routeInfo.history : [];

    let inputEl = null;
    let errorTip = null;

    // 创建自定义手绘模态窗
    const modal = new SketchModal({
      title: customTitle,
      type: "confirm",
      confirmText: "确认绑定并使用",
      cancelText: "取消",
      showCancel: true,
      closeOnBackdrop: true,
      closeOnStepBack: true,
      onConfirm: async () => {
        const val = inputEl ? inputEl.value.trim().replace(/\\/g, "/") : "";
        if (!val) {
          if (errorTip) errorTip.textContent = "必须选择或输入一个有效的目标项目目录！";
          if (inputEl) inputEl.focus();
          return false;
        }

        try {
          const saved = await workspaceService.setCodeAreaRoute(val);
          return saved && saved.routePath ? saved.routePath : val;
        } catch (err) {
          if (errorTip) errorTip.textContent = `路径校验失败：${err.message || err}`;
          if (inputEl) inputEl.focus();
          return false;
        }
      },
    });

    // 劫持 buildDOM 追加路由选择器
    const origBuildDOM = modal._buildDOM.bind(modal);
    modal._buildDOM = function () {
      origBuildDOM();
      const body = modal.card.querySelector(".sketch-modal-body");
      if (!body) return;

      body.innerHTML = `
        <div class="sketch-modal-message">
          <strong>code-area</strong> 为全局编码技能调度中枢，不修改自身目录。<br>
          必须指定一个本地项目文件夹作为<strong>路由目标</strong>，不可空置运行。
        </div>
        <div class="sketch-route-modal-box">
          <div class="sketch-route-input-row">
            <input type="text" class="sketch-modal-input sketch-route-input" id="sketch-route-input-field"
              placeholder="请选择或输入本地项目绝对路径 (例如: C:/Users/.../my-project)"
              value="${escapeHtml(currentVal)}" autocomplete="off" spellcheck="false" />
            <button type="button" class="flat-btn flat-btn-secondary mini sketch-browse-btn" id="sketch-browse-folder-btn" title="浏览文件夹">
              <span>浏览</span>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1.5 3.5 A1 1 0 0 1 2.5 2.5 H6 L7.5 4.5 H13.5 A1 1 0 0 1 14.5 5.5 V12.5 A1 1 0 0 1 13.5 13.5 H2.5 A1 1 0 0 1 1.5 12.5 Z" />
              </svg>
            </button>
          </div>
          <div class="sketch-route-tips" id="sketch-route-error-tip"></div>
          ${
            historyList.length > 0
              ? `
            <div class="sketch-route-history">
              <span class="sketch-route-history-label">历史项目：</span>
              <div class="sketch-route-history-chips" id="sketch-route-history-chips">
                ${historyList
                  .slice(0, 4)
                  .map(
                    (p) =>
                      `<button type="button" class="sketch-chip-btn" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">${escapeHtml(
                        p.split("/").pop() || p
                      )}</button>`
                  )
                  .join("")}
              </div>
            </div>`
              : ""
          }
        </div>
      `;

      inputEl = body.querySelector("#sketch-route-input-field");
      const browseBtn = body.querySelector("#sketch-browse-folder-btn");
      errorTip = body.querySelector("#sketch-route-error-tip");
      const historyChips = body.querySelector("#sketch-route-history-chips");

      if (browseBtn && inputEl) {
        browseBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            const selected = await workspaceService.selectFolder(inputEl.value.trim());
            if (selected) {
              inputEl.value = selected;
              if (errorTip) errorTip.textContent = "";
              inputEl.focus();
            }
          } catch (err) {
            console.warn("[WorkspaceModal] Browse folder error:", err);
          }
        });
      }

      if (historyChips && inputEl) {
        historyChips.addEventListener("click", async (e) => {
          const btn = e.target.closest(".sketch-chip-btn");
          if (btn) {
            const path = btn.getAttribute("data-path");
            if (path) {
              inputEl.value = path;
              if (errorTip) errorTip.textContent = "";
              inputEl.focus();
            }
          }
        });
      }

      if (inputEl) {
        inputEl.addEventListener("input", () => {
          if (errorTip) errorTip.textContent = "";
        });
      }
    };

    const res = await modal.open();
    resolve(typeof res === "string" && res.trim() ? res.trim() : null);
  });
}

/**
 * 工作区设置面板 (Workspace Panel)
 * - 当前工作区卡片（名称 + ID 徽章 + 运行时绝对路径）
 * - code-area 专属路由工作区配置区（目标路径 / 文件夹选择 / 历史项目 / 技能清单）
 * - 预设工作区列表（卡片式：名称 / id 徽章 / 描述 / 运行时路径 / 状态）
 * - 切换交互：code-area 门禁拦截（必须选路由） / 运行时任务确认 / 切换后自动重载
 */
export function initWorkspacePanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const settings = ctx.settings;

  const workspaceList = el.workspaceList;
  const workspaceActiveName = el.workspaceActiveName;
  const workspaceActivePath = el.workspaceActivePath;
  const workspaceActiveBadge = el.workspaceActiveBadge;

  // code-area 专享 DOM 元素
  const codeAreaRouteCard = el.codeAreaRouteCard;
  const codeAreaRouteInput = el.codeAreaRouteInput;
  const codeAreaRouteStatus = el.codeAreaRouteStatus;
  const btnBrowseRouteFolder = el.btnBrowseRouteFolder;
  const btnSaveRoutePath = el.btnSaveRoutePath;
  const codeAreaHistorySection = el.codeAreaHistorySection;
  const codeAreaHistoryList = el.codeAreaHistoryList;
  const codeAreaSkillsSection = el.codeAreaSkillsSection;
  const codeAreaSkillsList = el.codeAreaSkillsList;
  const codeAreaSkillsCount = el.codeAreaSkillsCount;

  const showGlobalToast = (msg, duration = 1500) => {
    if (typeof api.showGlobalToast === "function") {
      api.showGlobalToast(msg, duration);
    }
  };

  // ==========================================================================
  // 渲染 code-area 路由目标项目卡片
  // ==========================================================================
  const renderCodeAreaRouteDetails = async () => {
    if (!codeAreaRouteCard) return;

    try {
      const routeInfo = await workspaceService.getCodeAreaRoute();
      if (!routeInfo) return;

      const hasRoute = Boolean(routeInfo.routePath && routeInfo.exists);
      if (codeAreaRouteStatus) {
        if (hasRoute) {
          codeAreaRouteStatus.className = "code-area-route-status-badge active";
          codeAreaRouteStatus.textContent = `已绑定：${routeInfo.name || "目标项目"}`;
          codeAreaRouteStatus.title = `绝对路径: ${routeInfo.routePath}`;
        } else {
          codeAreaRouteStatus.className = "code-area-route-status-badge warning";
          codeAreaRouteStatus.textContent = "⚠️ 未绑定项目 (不可空置运行)";
          codeAreaRouteStatus.title = "请选择或输入实际需要开发调试的目标项目路径";
        }
      }

      if (codeAreaRouteInput) {
        codeAreaRouteInput.value = routeInfo.routePath || "";
        if (!hasRoute) {
          codeAreaRouteInput.classList.add("needs-attention");
        } else {
          codeAreaRouteInput.classList.remove("needs-attention");
        }
      }

      // 渲染历史项目药丸
      if (codeAreaHistoryList && codeAreaHistorySection) {
        const history = Array.isArray(routeInfo.history) ? routeInfo.history : [];
        if (history.length > 0) {
          codeAreaHistorySection.classList.remove("hidden");
          codeAreaHistoryList.innerHTML = history
            .map((p) => {
              const name = p.split("/").pop() || p;
              const isCurrent = routeInfo.routePath && routeInfo.routePath.toLowerCase() === p.toLowerCase();
              return `<button type="button" class="route-history-pill${isCurrent ? " current" : ""}" data-path="${escapeHtml(
                p
              )}" title="${escapeHtml(p)}">
                <span class="pill-icon">${ICONS.folder}</span>
                <span class="pill-name">${escapeHtml(name)}</span>
              </button>`;
            })
            .join("");
        } else {
          codeAreaHistorySection.classList.add("hidden");
        }
      }

      // 渲染内置技能清单
      if (codeAreaSkillsList && codeAreaSkillsSection) {
        const skills = Array.isArray(routeInfo.skills) ? routeInfo.skills : [];
        if (codeAreaSkillsCount) {
          codeAreaSkillsCount.textContent = `${skills.length} 个已装载技能`;
        }
        if (skills.length > 0) {
          codeAreaSkillsList.innerHTML = skills
            .map(
              (s) => `
            <div class="code-area-skill-item" title="${escapeHtml(s.description)}">
              <div class="skill-item-header">
                <span class="skill-name">${escapeHtml(s.name)}</span>
                <span class="skill-id-badge">${escapeHtml(s.id)}</span>
              </div>
              <div class="skill-desc">${escapeHtml(s.description || "暂无描述")}</div>
            </div>`
            )
            .join("");
        } else {
          codeAreaSkillsList.innerHTML = `<div class="empty-skills-tip">暂无额外技能，可在 code-area/.agents/skills 目录中自由增减</div>`;
        }
      }
    } catch (err) {
      console.warn("[WorkspacePanel] Failed to render code-area details:", err);
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
      requiresRoute: Boolean(active.requiresRoute || active.id === "code-area"),
      routePath: active.routePath || null,
      routeName: active.routeName || null,
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

    // 若当前为 code-area，显示路由目标项目专享配置卡片并刷新详情
    if (active.id === "code-area") {
      if (codeAreaRouteCard) codeAreaRouteCard.classList.remove("hidden");
      renderCodeAreaRouteDetails();
    } else {
      if (codeAreaRouteCard) codeAreaRouteCard.classList.add("hidden");
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
        ${
          ws.requiresRoute || ws.id === "code-area"
            ? `<span class="flat-badge route-hub-badge" title="全局编码技能调度中枢：指挥操作外部路由目标项目">路由调度中枢</span>`
            : ""
        }
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
        runtime.textContent = `运行时: ${ws.runtimePath}`;
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
  // 切换工作区 (允许先切换 code-area 后择时绑定，运行时任务确认)
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

      // 通知全局与输入框更新工作区状态
      window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { workspace: ws } }));
      if (typeof api.syncWorkspaceInputState === "function") {
        api.syncWorkspaceInputState();
      }

      if (ws.id === "code-area") {
        let routeInfo = null;
        try {
          routeInfo = await workspaceService.getCodeAreaRoute();
        } catch (_) {}
        const hasValidRoute = Boolean(routeInfo && routeInfo.routePath && routeInfo.exists);
        if (!hasValidRoute) {
          showGlobalToast(`已切换至「${ws.name}」· 请绑定路由目标项目`, 2500);
        } else if (result.restarted) {
          showGlobalToast(`已切换至「${ws.name}」· 内核已重启生效`, 2200);
        } else {
          showGlobalToast(`已切换至「${ws.name}」`, 1500);
        }
      } else if (result.activeTasks > 0) {
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

  // ==========================================================================
  // 事件绑定：路由项目输入、浏览选择与历史点选
  // ==========================================================================
  if (btnBrowseRouteFolder && codeAreaRouteInput) {
    btnBrowseRouteFolder.addEventListener("click", async () => {
      try {
        const chosen = await workspaceService.selectFolder(codeAreaRouteInput.value.trim());
        if (chosen) {
          codeAreaRouteInput.value = chosen;
          await workspaceService.setCodeAreaRoute(chosen);
          await renderCodeAreaRouteDetails();
          if (settings.activeWorkspace) {
            settings.activeWorkspace.routePath = chosen;
            settings.activeWorkspace.routeName = chosen.split("/").pop() || chosen;
          }
          if (typeof api.syncWorkspaceInputState === "function") {
            api.syncWorkspaceInputState();
          }
          window.dispatchEvent(new CustomEvent("workspace-changed"));
          showGlobalToast("已绑定目标项目目录", 1600);
        }
      } catch (err) {
        console.warn("[WorkspacePanel] Browse folder failed:", err);
        showGlobalToast("选择目录失败", 2000);
      }
    });
  }

  if (btnSaveRoutePath && codeAreaRouteInput) {
    btnSaveRoutePath.addEventListener("click", async () => {
      const val = codeAreaRouteInput.value.trim();
      if (!val) {
        showGlobalToast("请输入有效项目绝对路径", 2000);
        return;
      }
      try {
        await workspaceService.setCodeAreaRoute(val);
        await renderCodeAreaRouteDetails();
        if (settings.activeWorkspace) {
          settings.activeWorkspace.routePath = val;
          settings.activeWorkspace.routeName = val.split("/").pop() || val;
        }
        if (typeof api.syncWorkspaceInputState === "function") {
          api.syncWorkspaceInputState();
        }
        window.dispatchEvent(new CustomEvent("workspace-changed"));
        showGlobalToast("已保存目标项目路由绑定", 1800);
      } catch (err) {
        console.error("[WorkspacePanel] Save route failed:", err);
        showGlobalToast(`绑定失败：${err.message || err}`, 2500);
      }
    });
  }

  if (codeAreaRouteInput) {
    codeAreaRouteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (btnSaveRoutePath) btnSaveRoutePath.click();
      }
    });
  }

  if (codeAreaHistoryList && codeAreaRouteInput) {
    codeAreaHistoryList.addEventListener("click", async (e) => {
      const pill = e.target.closest(".route-history-pill");
      if (pill) {
        const path = pill.getAttribute("data-path");
        if (path) {
          codeAreaRouteInput.value = path;
          try {
            await workspaceService.setCodeAreaRoute(path);
            await renderCodeAreaRouteDetails();
            if (settings.activeWorkspace) {
              settings.activeWorkspace.routePath = path;
              settings.activeWorkspace.routeName = path.split("/").pop() || path;
            }
            if (typeof api.syncWorkspaceInputState === "function") {
              api.syncWorkspaceInputState();
            }
            window.dispatchEvent(new CustomEvent("workspace-changed"));
            showGlobalToast(`已切换路由目标为: ${path.split("/").pop() || path}`, 1800);
          } catch (err) {
            showGlobalToast(`切换历史项目失败: ${err.message || err}`, 2200);
          }
        }
      }
    });
  }

  api.loadWorkspaces = loadWorkspaces;
  api.promptCodeAreaRouteModal = promptCodeAreaRouteModal;
  if (typeof window !== "undefined") {
    window.__piPromptCodeAreaRoute = promptCodeAreaRouteModal;
  }
}

