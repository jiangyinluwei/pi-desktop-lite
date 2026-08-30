import { escapeHtml, escapeCss } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { configService } from "../services/config-service.js";
import { enhanceSelect } from "../services/sketch-select.js";
import { ProgressStepper } from "../services/progress-stepper.js";
import { notificationService } from "../services/notification-service.js";
import { sketchAlert, sketchConfirm } from "../services/sketch-modal.js";

/**
 * 扩展组件市场、安装/更新/卸载队列与推荐插件
 */
export function initPackagesPanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;



  // ==========================================================================
  // 8. 扩展组件管理与 Package Catalog 市场 (Installed & Catalog Market)
  // ==========================================================================
  const installedPackagesWrapper = document.getElementById("installed-packages-wrapper");
  const installedSectionToggle = document.getElementById("installed-section-toggle");
  const installedPackagesCount = document.getElementById("installed-packages-count");
  const installedPackagesList = document.getElementById("installed-packages-list");
  const btnInstallRecommendedPackages = document.getElementById("btn-install-recommended-packages");
  const btnUpdateAllPackages = document.getElementById("btn-update-all-packages");
  const btnCheckAllPackageUpdates = document.getElementById("btn-check-all-package-updates");

  const packagesSearchInput = document.getElementById("packages-search-input");
  const btnClearPackageSearch = document.getElementById("btn-clear-package-search");
  const packagesTypeSelect = document.getElementById("packages-type-select");
  const packagesSortSelect = document.getElementById("packages-sort-select");
  const btnSearchPackages = document.getElementById("btn-search-packages");

  const packagesTotalInfo = document.getElementById("packages-total-info");
  const packagesCatalogGrid = document.getElementById("packages-catalog-grid");
  const packagesPagination = document.getElementById("packages-pagination");
  const btnPackagesPrevPage = document.getElementById("btn-packages-prev-page");
  const btnPackagesNextPage = document.getElementById("btn-packages-next-page");
  const packagesPageIndicator = document.getElementById("packages-page-indicator");

  const packageProgressFloatCard = document.getElementById("package-progress-float-card");
  const packageProgressTitle = document.getElementById("package-progress-title");
  const packageProgressPkgName = document.getElementById("package-progress-pkg-name");
  const packageProgressPercent = document.getElementById("package-progress-percent");
  const packageProgressFill = document.getElementById("package-progress-fill");
  const packageProgressMessage = document.getElementById("package-progress-message");
  const packageQueueBadge = document.getElementById("package-queue-badge");
  const btnClosePackageProgress = document.getElementById("btn-close-package-progress");

  let installedPackages = [];
  let recommendedPlugins = [];
  let packageUpdatesMap = new Map(); // packageName -> { latestVersion, hasUpdate }
  let packageOperationMap = new Map(); // packageName -> 'installing' | 'uninstalling' | 'updating'
  let packageProgressMap = new Map(); // packageName -> { stage, percent, message }
  let packageSteppersMap = new Map(); // packageName.toLowerCase() -> ProgressStepper

  // 扩展任务队列：FIFO 顺序执行安装、更新与卸载，保证互斥不冲突
  let packageTaskQueue = []; // Array<{ id: string, packageName: string, action: 'install' | 'uninstall' | 'update' }>
  let currentRunningTask = null;
  let isProcessingQueue = false;

  let currentCatalogPage = 1;
  let currentCatalogResult = null;
  let hasLoadedCatalogOnce = false;
  let floatCardDismissTimer = null;

  // 队列状态查询辅助函数
  const isPackageRunning = (pkgName) => {
    return (
      currentRunningTask !== null &&
      currentRunningTask.packageName.toLowerCase() === pkgName.toLowerCase()
    );
  };

  const getPackageQueueIndex = (pkgName) => {
    return packageTaskQueue.findIndex(
      (t) => t.packageName.toLowerCase() === pkgName.toLowerCase()
    );
  };

  const getQueuedPackageTask = (pkgName) => {
    return packageTaskQueue.find(
      (t) => t.packageName.toLowerCase() === pkgName.toLowerCase()
    );
  };

  const isPackageInQueue = (pkgName) => {
    return getPackageQueueIndex(pkgName) !== -1;
  };

  const isPackageBusy = (pkgName) => {
    return isPackageRunning(pkgName) || isPackageInQueue(pkgName);
  };

  // 实时更新队列提示徽章
  const updateQueueBadge = () => {
    if (!packageQueueBadge) return;
    if (packageTaskQueue.length > 0) {
      packageQueueBadge.textContent = `队列待执行: ${packageTaskQueue.length}`;
      packageQueueBadge.classList.remove("hidden");
    } else {
      packageQueueBadge.classList.add("hidden");
    }
  };

  // 统一刷新已安装组件列表与扩展市场卡片视图
  const refreshPackageViews = () => {
    renderInstalledPackages();
    updateRecommendedButtonVisibility();
    updateBatchUpdateButtonVisibility();
    if (currentCatalogResult?.packages) {
      renderCatalogGrid(currentCatalogResult.packages);
    }
  };

  if (btnClosePackageProgress && packageProgressFloatCard) {
    btnClosePackageProgress.addEventListener("click", () => {
      if (floatCardDismissTimer) clearTimeout(floatCardDismissTimer);
      packageProgressFloatCard.classList.add("hidden");
      packageProgressFloatCard.classList.remove("fade-out");
    });
  }

  // 获取各组件操作的阶段里程碑
  const getPackageMilestones = (stage, action) => {
    if (stage === "uninstalling" || stage === "uninstalled" || action === "uninstall") {
      return [0, 30, 100];
    }
    if (stage === "updating" || action === "update") {
      return [0, 5, 10, 15, 35, 55, 75, 90, 100];
    }
    return [0, 5, 15, 35, 55, 75, 90, 100];
  };

  // 获取或创建单个组件的平滑步进器
  const getOrCreatePackageStepper = (packageName, stage, action) => {
    const key = (packageName || "").toLowerCase();
    let stepper = packageSteppersMap.get(key);
    const milestones = getPackageMilestones(stage, action);
    if (!stepper) {
      stepper = new ProgressStepper({
        milestones,
        intervalMs: 2000,
        onUpdate: (currentPercent, payload) => {
          applyPackageProgressToUI(
            payload?.packageName || packageName,
            payload?.stage || stage,
            currentPercent,
            payload?.message || ""
          );
        },
      });
      packageSteppersMap.set(key, stepper);
    } else {
      stepper.setMilestones(milestones);
    }
    return stepper;
  };

  // 应用进度变化到 UI (浮动卡片 + 已安装列表与市场卡片局部/全局同步)
  const applyPackageProgressToUI = (packageName, stage, percent, message) => {
    if (!packageName) return;
    const cleanPercent = Math.min(100, Math.max(0, Number(percent) || 0));

    packageProgressMap.set(packageName, {
      stage,
      percent: cleanPercent,
      message: message || "",
    });

    if (packageProgressFloatCard) {
      if (floatCardDismissTimer) clearTimeout(floatCardDismissTimer);
      packageProgressFloatCard.classList.remove("hidden", "fade-out");

      if (packageProgressTitle) {
        if (stage === "uninstalling" || stage === "uninstalled") {
          packageProgressTitle.textContent = "正在卸载";
        } else if (stage === "updating") {
          packageProgressTitle.textContent = "正在更新";
        } else {
          packageProgressTitle.textContent = "正在安装";
        }
      }

      if (packageProgressPkgName) packageProgressPkgName.textContent = packageName;
      if (packageProgressPercent) packageProgressPercent.textContent = `${cleanPercent}%`;
      if (packageProgressFill) packageProgressFill.style.width = `${cleanPercent}%`;
      if (packageProgressMessage) packageProgressMessage.textContent = message || "";

      // 实时更新队列提示徽章
      updateQueueBadge();

      // 当单项任务结束且队列为空时，平滑渐隐
      if (
        (stage === "completed" || stage === "uninstalled" || stage === "error") &&
        packageTaskQueue.length === 0
      ) {
        floatCardDismissTimer = setTimeout(() => {
          packageProgressFloatCard.classList.add("fade-out");
          setTimeout(() => {
            packageProgressFloatCard.classList.add("hidden");
            packageProgressFloatCard.classList.remove("fade-out");
          }, 350);
        }, 1800);
      }
    }

    // 局部同步已安装列表与卡片中的进度条与百分比（极速无重绘）
    let updatedInList = false;
    let updatedInGrid = false;

    if (installedPackagesList) {
      const activeInstalledItem = installedPackagesList.querySelector(
        `[data-package="${escapeCss(packageName)}"]`
      );
      if (activeInstalledItem) {
        const pctEl = activeInstalledItem.querySelector(".card-progress-pct");
        const fillEl = activeInstalledItem.querySelector(".sketch-progress-fill");
        const msgEl = activeInstalledItem.querySelector(".card-progress-msg");
        if (pctEl && fillEl) {
          pctEl.textContent = `${cleanPercent}%`;
          fillEl.style.width = `${cleanPercent}%`;
          if (msgEl && message) {
            msgEl.textContent = message;
            msgEl.title = message;
          }
          updatedInList = true;
        }
      }
    }

    if (packagesCatalogGrid) {
      const activeCard = packagesCatalogGrid.querySelector(
        `[data-package="${escapeCss(packageName)}"]`
      );
      if (activeCard) {
        const pctEl = activeCard.querySelector(".card-progress-pct");
        const fillEl = activeCard.querySelector(".sketch-progress-fill");
        const msgEl = activeCard.querySelector(".card-progress-msg");
        if (pctEl && fillEl) {
          pctEl.textContent = `${cleanPercent}%`;
          fillEl.style.width = `${cleanPercent}%`;
          if (msgEl && message) {
            msgEl.textContent = message;
            msgEl.title = message;
          }
          updatedInGrid = true;
        }
      }
    }

    // 若 DOM 尚未挂载进度条结构（如刚由常态按钮进入运行态），全量渲染一次挂载结构
    if (!updatedInList) {
      renderInstalledPackages();
    }
    if (!updatedInGrid && currentCatalogResult?.packages) {
      renderCatalogGrid(currentCatalogResult.packages);
    }
  };

  // 更新进度条 UI (接入平滑步进引擎)
  const updatePackageProgressUI = (payload) => {
    if (!payload || !payload.packageName) return;
    const { packageName, stage, percent, message } = payload;
    const cleanPercent = Math.min(100, Math.max(0, Number(percent) || 0));

    const stepper = getOrCreatePackageStepper(
      packageName,
      stage,
      packageOperationMap.get(packageName)
    );

    if (stage === "completed" || stage === "uninstalled" || stage === "error") {
      stepper.stopTimer();
      stepper.step(cleanPercent, { packageName, stage, message });
      packageSteppersMap.delete(packageName.toLowerCase());
    } else {
      // 阶段触发：立即跳至 cleanPercent，并在等待期间每 2s 步进 +1% 直到下个阶段 - 1%
      stepper.step(cleanPercent, { packageName, stage, message });
    }
  };

  // 监听 Tauri 派发的 package-progress 事件
  if (window.__TAURI__?.event?.listen) {
    try {
      window.__TAURI__.event.listen("package-progress", (event) => {
        if (event.payload) {
          updatePackageProgressUI(event.payload);
        }
      });
    } catch (e) {
      console.warn("[PackageManager] Failed to register package-progress listener:", e);
    }
  }

  // 折叠/展开已安装列表
  if (installedSectionToggle && installedPackagesWrapper) {
    installedSectionToggle.addEventListener("click", () => {
      const isCollapsed = installedPackagesWrapper.classList.toggle("collapsed");
      installedSectionToggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    });
  }

  // 动态更新“安装推荐插件”按钮可见性（若全部推荐插件均已安装，则自动隐藏）
  const updateRecommendedButtonVisibility = () => {
    if (!btnInstallRecommendedPackages) return;
    if (!recommendedPlugins || recommendedPlugins.length === 0) {
      btnInstallRecommendedPackages.classList.add("hidden");
      return;
    }

    const uninstalled = recommendedPlugins.filter(
      (p) => !isPackageInstalled(p.name)
    );

    if (uninstalled.length === 0) {
      btnInstallRecommendedPackages.classList.add("hidden");
    } else {
      btnInstallRecommendedPackages.classList.remove("hidden");
      btnInstallRecommendedPackages.title = `一键队列安装推荐扩展插件 (待安装 ${uninstalled.length} 个)`;
    }
  };

  // 动态更新“一键全部更新”按钮可见性（检测到 >= 2 个组件有可用更新时显现）
  const updateBatchUpdateButtonVisibility = () => {
    if (!btnUpdateAllPackages) return;

    const updatablePkgs = installedPackages.filter((pkg) => {
      const updateInfo = packageUpdatesMap.get(pkg.name);
      return updateInfo && updateInfo.hasUpdate;
    });

    if (updatablePkgs.length >= 2) {
      btnUpdateAllPackages.classList.remove("hidden");
      const pendingUpdates = updatablePkgs.filter((pkg) => !isPackageBusy(pkg.name));
      if (pendingUpdates.length > 0) {
        btnUpdateAllPackages.disabled = false;
        btnUpdateAllPackages.title = `一键将 ${updatablePkgs.length} 个有可用更新的组件加入队列自动按序升级`;
      } else {
        btnUpdateAllPackages.disabled = true;
        btnUpdateAllPackages.title = "所有待更新组件已在队列中或正在执行";
      }
    } else {
      btnUpdateAllPackages.classList.add("hidden");
    }
  };

  // 加载内嵌推荐插件列表
  const loadRecommendedPlugins = async () => {
    try {
      const list = await configService.getRecommendedPlugins();
      recommendedPlugins = Array.isArray(list) ? list : [];
      updateRecommendedButtonVisibility();
    } catch (err) {
      console.warn("[PackageManager] Failed to load recommended plugins:", err);
    }
  };

  // 加载已安装组件
  const loadInstalledPackages = async () => {
    try {
      const list = await configService.getInstalledPackages();
      installedPackages = Array.isArray(list) ? list : [];
      if (installedPackagesCount) {
        installedPackagesCount.textContent = installedPackages.length.toString();
      }
      renderInstalledPackages();
      updateRecommendedButtonVisibility();
      updateBatchUpdateButtonVisibility();
      if (currentCatalogResult && currentCatalogResult.packages) {
        renderCatalogGrid(currentCatalogResult.packages);
      }
    } catch (err) {
      console.warn("[PackageManager] Failed to load installed packages:", err);
    }
  };

  // 渲染已安装组件列表
  const renderInstalledPackages = () => {
    if (!installedPackagesList) return;

    if (!installedPackages || installedPackages.length === 0) {
      installedPackagesList.innerHTML = `<div class="packages-empty-hint">暂未安装任何扩展组件。可在下方市场中搜索并一键安装。</div>`;
      return;
    }

    installedPackagesList.innerHTML = "";
    installedPackages.forEach((pkg) => {
      const item = document.createElement("div");
      item.className = "installed-package-item";
      item.dataset.package = pkg.name;

      const updateInfo = packageUpdatesMap.get(pkg.name);
      const isRunning = isPackageRunning(pkg.name);
      const isQueued = isPackageInQueue(pkg.name);
      const progress = packageProgressMap.get(pkg.name);

      const verBadgeClass = updateInfo?.hasUpdate ? "installed-pkg-ver update-available" : "installed-pkg-ver";
      const verText = updateInfo?.hasUpdate
        ? `v${pkg.version} → v${updateInfo.latestVersion}`
        : `v${pkg.version}`;

      let actionsHtml = "";
      if (isRunning && progress) {
        actionsHtml = `
          <div class="card-progress-wrap" style="min-width: 140px;">
            <div class="card-progress-labels">
              <span class="card-progress-msg" title="${escapeHtml(progress.message)}">${escapeHtml(progress.message)}</span>
              <span class="card-progress-pct">${progress.percent}%</span>
            </div>
            <div class="sketch-progress-track">
              <div class="sketch-progress-fill" style="width: ${progress.percent}%;"></div>
            </div>
          </div>
        `;
      } else if (isQueued) {
        const queuePos = getPackageQueueIndex(pkg.name) + 1;
        const queuedTask = getQueuedPackageTask(pkg.name);
        const taskAction = queuedTask ? queuedTask.action : "uninstall";
        let queueText = `排队中 (#${queuePos})`;
        let queueTitle = "点击取消排队";
        let queueClass = "flat-btn flat-btn-secondary mini btn-queue-cancel";
        if (taskAction === "update") {
          queueText = `更新排队中 (#${queuePos})`;
          queueTitle = "点击取消更新排队";
          queueClass += " update-queued";
        } else if (taskAction === "uninstall") {
          queueText = `卸载排队中 (#${queuePos})`;
          queueTitle = "点击取消卸载排队";
          queueClass += " uninstall-queued";
        } else if (taskAction === "install") {
          queueText = `安装排队中 (#${queuePos})`;
          queueTitle = "点击取消安装排队";
        }
        actionsHtml = `
          <button type="button" class="${queueClass}" data-name="${escapeHtml(pkg.name)}" title="${queueTitle}">
            <span class="thinking-dot"></span> ${escapeHtml(queueText)}
          </button>
        `;
      } else {
        const hasUnappliedPreset = pkg.hasPreset && !pkg.isPresetApplied;
        actionsHtml = `
          ${
            hasUnappliedPreset
              ? `<button type="button" class="flat-btn flat-btn-secondary mini btn-preset-pkg" data-name="${escapeHtml(pkg.name)}" title="应用推荐配置：${escapeHtml(pkg.presetTitle || '推荐配置')}">
                   推荐配置
                 </button>`
              : ""
          }
          ${
            updateInfo?.hasUpdate
              ? `<button type="button" class="flat-btn flat-btn-primary mini btn-update-pkg" data-name="${escapeHtml(pkg.name)}">
                   更新
                 </button>`
              : ""
          }
          <button type="button" class="flat-btn flat-btn-secondary mini btn-uninstall-pkg" data-name="${escapeHtml(pkg.name)}" title="卸载组件" aria-label="卸载组件">
            卸载
          </button>
        `;
      }

      item.innerHTML = `
        <div class="installed-pkg-info">
          <div class="installed-pkg-header">
            <span class="installed-pkg-name">${escapeHtml(pkg.name)}</span>
            <span class="${verBadgeClass}">${escapeHtml(verText)}</span>
          </div>
          ${pkg.description ? `<p class="installed-pkg-desc">${escapeHtml(pkg.description)}</p>` : ""}
        </div>
        <div class="installed-pkg-actions">
          ${actionsHtml}
        </div>
      `;

      // 绑定应用推荐配置
      const btnPreset = item.querySelector(".btn-preset-pkg");
      if (btnPreset) {
        btnPreset.addEventListener("click", (e) => {
          e.stopPropagation();
          handleApplyPackagePreset(pkg.name, btnPreset);
        });
      }

      // 绑定卸载
      const btnUninstall = item.querySelector(".btn-uninstall-pkg");
      if (btnUninstall) {
        btnUninstall.addEventListener("click", (e) => {
          e.stopPropagation();
          handleUninstallPackage(pkg.name);
        });
      }

      // 绑定更新
      const btnUpdate = item.querySelector(".btn-update-pkg");
      if (btnUpdate) {
        btnUpdate.addEventListener("click", (e) => {
          e.stopPropagation();
          handleUpdatePackage(pkg.name);
        });
      }

      // 绑定取消排队
      const btnCancel = item.querySelector(".btn-queue-cancel");
      if (btnCancel) {
        btnCancel.addEventListener("click", (e) => {
          e.stopPropagation();
          cancelQueuedPackageTask(pkg.name);
        });
      }

      installedPackagesList.appendChild(item);
    });
  };

  // 加载官网组件市场
  const loadCatalogPackages = async (page = 1) => {
    if (!packagesCatalogGrid) return;
    currentCatalogPage = page;

    if (packagesTotalInfo) {
      packagesTotalInfo.textContent = "正在从 pi.dev 获取官方组件目录...";
    }

    packagesCatalogGrid.innerHTML = `
      <div class="packages-empty-hint" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span class="thinking-dot"></span>
        <span>加载官方组件目录中...</span>
      </div>
    `;

    try {
      const query = packagesSearchInput?.value?.trim() || "";
      const pkgType = packagesTypeSelect?.value || "";
      const sort = packagesSortSelect?.value || "downloads";

      const res = await configService.searchPackages(query, pkgType, sort, page);
      if (!res || !Array.isArray(res.packages)) {
        if (packagesTotalInfo) {
          packagesTotalInfo.textContent = "未能获取官方组件数据";
        }
        packagesCatalogGrid.innerHTML = `<div class="packages-empty-hint">未能获取到官方组件数据，请检查网络连接后重试</div>`;
        return;
      }

      currentCatalogResult = res;
      hasLoadedCatalogOnce = true;

      if (packagesTotalInfo) {
        if (res.totalCount === 0) {
          packagesTotalInfo.textContent = "未找到符合条件的组件";
        } else {
          packagesTotalInfo.textContent = `共找到 ${res.totalCount} 个组件 (第 ${res.page} / ${res.totalPages} 页)`;
        }
      }

      renderCatalogGrid(res.packages);

      // 分页器处理
      if (packagesPagination) {
        if (res.totalPages > 1) {
          packagesPagination.classList.remove("hidden");
          if (packagesPageIndicator) {
            packagesPageIndicator.textContent = `第 ${res.page} / ${res.totalPages} 页`;
          }
          if (btnPackagesPrevPage) {
            btnPackagesPrevPage.disabled = res.page <= 1;
          }
          if (btnPackagesNextPage) {
            btnPackagesNextPage.disabled = !res.hasMore;
          }
        } else {
          packagesPagination.classList.add("hidden");
        }
      }
    } catch (err) {
      console.error("[PackageManager] Failed to search catalog:", err);
      if (packagesTotalInfo) {
        packagesTotalInfo.textContent = "组件目录加载失败";
      }
      packagesCatalogGrid.innerHTML = `
        <div class="packages-empty-hint" style="color: #ef4444;">
          获取官方组件失败：${escapeHtml(err?.toString() || "网络错误")}
        </div>
      `;
    }
  };

  // 检查某个包是否已安装
  const isPackageInstalled = (pkgName) => {
    const cleanName = pkgName.toLowerCase().replace(/^npm:/, "");
    return installedPackages.some(
      (p) => p.name.toLowerCase() === cleanName || p.name.toLowerCase() === `npm:${cleanName}`
    );
  };

  // 渲染市场卡片网格
  const renderCatalogGrid = (packages) => {
    if (!packagesCatalogGrid) return;

    if (!packages || packages.length === 0) {
      packagesCatalogGrid.innerHTML = `<div class="packages-empty-hint">暂无匹配的组件，请尝试更换关键词或类型筛选</div>`;
      return;
    }

    packagesCatalogGrid.innerHTML = "";

    packages.forEach((pkg) => {
      const card = document.createElement("article");
      card.className = "package-card";
      card.dataset.package = pkg.name;

      const isInstalled = isPackageInstalled(pkg.name);
      const isRunning = isPackageRunning(pkg.name);
      const isQueued = isPackageInQueue(pkg.name);
      const updateInfo = packageUpdatesMap.get(pkg.name);
      const progress = packageProgressMap.get(pkg.name);

      let actionBtnHtml = "";
      if (isRunning && progress) {
        actionBtnHtml = `
          <div class="card-progress-wrap" style="min-width: 140px;">
            <div class="card-progress-labels">
              <span class="card-progress-msg" title="${escapeHtml(progress.message)}">${escapeHtml(progress.message)}</span>
              <span class="card-progress-pct">${progress.percent}%</span>
            </div>
            <div class="sketch-progress-track">
              <div class="sketch-progress-fill" style="width: ${progress.percent}%;"></div>
            </div>
          </div>
        `;
      } else if (isQueued) {
        const queuePos = getPackageQueueIndex(pkg.name) + 1;
        const queuedTask = getQueuedPackageTask(pkg.name);
        const taskAction = queuedTask ? queuedTask.action : "install";
        let queueText = `排队中 (#${queuePos})`;
        let queueTitle = "点击取消排队";
        let queueClass = "flat-btn flat-btn-secondary mini btn-queue-cancel";
        if (taskAction === "update") {
          queueText = `更新排队中 (#${queuePos})`;
          queueTitle = "点击取消更新排队";
          queueClass += " update-queued";
        } else if (taskAction === "uninstall") {
          queueText = `卸载排队中 (#${queuePos})`;
          queueTitle = "点击取消卸载排队";
          queueClass += " uninstall-queued";
        } else if (taskAction === "install") {
          queueText = `安装排队中 (#${queuePos})`;
          queueTitle = "点击取消安装排队";
        }
        actionBtnHtml = `<button type="button" class="${queueClass}" data-name="${escapeHtml(pkg.name)}" title="${queueTitle}"><span class="thinking-dot"></span> ${escapeHtml(queueText)}</button>`;
      } else if (isInstalled && updateInfo?.hasUpdate) {
        actionBtnHtml = `<button type="button" class="flat-btn flat-btn-primary mini package-card-btn-action btn-catalog-update" data-name="${escapeHtml(pkg.name)}">更新到 v${escapeHtml(updateInfo.latestVersion)}</button>`;
      } else if (isInstalled) {
        actionBtnHtml = `<button type="button" class="flat-btn flat-btn-secondary mini package-card-btn-action" disabled style="opacity: 0.6; display: inline-flex; align-items: center; gap: 4px;"><span class="btn-icon">${ICONS.check}</span> 已安装</button>`;
      } else {
        actionBtnHtml = `<button type="button" class="flat-btn flat-btn-primary mini package-card-btn-action btn-catalog-install" data-name="${escapeHtml(pkg.name)}">+ 一键安装</button>`;
      }

      const linksHtml = [];
      if (pkg.npmUrl) {
        linksHtml.push(`<a href="${escapeHtml(pkg.npmUrl)}" target="_blank" rel="noreferrer" class="package-link-icon" title="在 npm 查看">npm</a>`);
      }
      if (pkg.repoUrl) {
        linksHtml.push(`<a href="${escapeHtml(pkg.repoUrl)}" target="_blank" rel="noreferrer" class="package-link-icon" title="查看源码仓库">repo</a>`);
      }

      card.innerHTML = `
        <div class="package-card-top">
          <div class="package-card-header">
            <h4 class="package-card-name">${escapeHtml(pkg.name)}</h4>
            <span class="package-type-badge" data-type="${escapeHtml(pkg.pkgType)}">${escapeHtml(pkg.pkgType)}</span>
          </div>
          ${pkg.description ? `<p class="package-card-desc" title="${escapeHtml(pkg.description)}">${escapeHtml(pkg.description)}</p>` : ""}
          <div class="package-card-meta">
            ${pkg.author ? `<span class="package-meta-item">👤 ${escapeHtml(pkg.author)}</span>` : ""}
            ${pkg.downloadsFormatted ? `<span class="package-meta-item">⬇️ ${escapeHtml(pkg.downloadsFormatted)}</span>` : ""}
            ${pkg.timeAgo ? `<span class="package-meta-item">🕒 ${escapeHtml(pkg.timeAgo)}</span>` : ""}
          </div>
        </div>
        <div class="package-card-footer">
          <div class="package-card-links">
            ${linksHtml.join("")}
          </div>
          ${actionBtnHtml}
        </div>
      `;

      // 绑定安装事件
      const btnInstall = card.querySelector(".btn-catalog-install");
      if (btnInstall) {
        btnInstall.addEventListener("click", (e) => {
          e.stopPropagation();
          handleInstallPackage(pkg.name);
        });
      }

      // 绑定更新事件
      const btnUpdate = card.querySelector(".btn-catalog-update");
      if (btnUpdate) {
        btnUpdate.addEventListener("click", (e) => {
          e.stopPropagation();
          handleUpdatePackage(pkg.name);
        });
      }

      // 绑定取消排队事件
      const btnCancel = card.querySelector(".btn-queue-cancel");
      if (btnCancel) {
        btnCancel.addEventListener("click", (e) => {
          e.stopPropagation();
          cancelQueuedPackageTask(pkg.name);
        });
      }

      packagesCatalogGrid.appendChild(card);
    });
  };

  // 入队新任务
  const enqueuePackageTask = (packageName, action) => {
    if (isPackageBusy(packageName)) {
      console.warn(`[PackageManager] Package ${packageName} is already busy or queued.`);
      return;
    }

    const task = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      packageName,
      action, // 'install' | 'uninstall' | 'update'
    };

    packageTaskQueue.push(task);

    // 注册包管理器队列并发任务
    notificationService.registerTask("package-queue", {
      count: packageTaskQueue.length,
      type: "package",
    });

    // 如果当前没有运行中的任务，且浮动提示存在，显示初始入队提示
    if (!currentRunningTask && packageProgressFloatCard) {
      updatePackageProgressUI({
        packageName,
        stage: action === "uninstall" ? "uninstalling" : action === "update" ? "updating" : "installing",
        percent: 5,
        message: "任务已加入队列，准备执行...",
      });
    }

    updateQueueBadge();
    refreshPackageViews();

    processPackageQueue();
  };

  // 取消排队中的任务
  const cancelQueuedPackageTask = (packageName) => {
    const idx = getPackageQueueIndex(packageName);
    if (idx !== -1) {
      packageTaskQueue.splice(idx, 1);
      packageProgressMap.delete(packageName);
      const stepper = packageSteppersMap.get(packageName.toLowerCase());
      if (stepper) {
        stepper.stopTimer();
        packageSteppersMap.delete(packageName.toLowerCase());
      }
      if (packageTaskQueue.length === 0 && !currentRunningTask) {
        notificationService.unregisterTask("package-queue");
      }
      updateQueueBadge();
      refreshPackageViews();
    }
  };

  // 队列处理循环引擎 (FIFO 严格排他互斥执行)
  const processPackageQueue = async () => {
    if (isProcessingQueue) return;
    if (packageTaskQueue.length === 0) {
      currentRunningTask = null;
      if (packageQueueBadge) packageQueueBadge.classList.add("hidden");
      notificationService.notifyIfAllCompleted({
        title: "pi-dl",
        message: "扩展组件安装与更新任务已全部完成。",
        taskId: "package-queue",
      });
      refreshPackageViews();
      return;
    }

    isProcessingQueue = true;
    currentRunningTask = packageTaskQueue.shift();
    const { packageName, action } = currentRunningTask;

    packageOperationMap.set(
      packageName,
      action === "uninstall" ? "uninstalling" : action === "update" ? "updating" : "installing"
    );

    updateQueueBadge();
    refreshPackageViews();

    try {
      if (action === "install") {
        await configService.installPackage(packageName);
      } else if (action === "uninstall") {
        await configService.uninstallPackage(packageName);
      } else if (action === "update") {
        await configService.updatePackage(packageName);
        packageUpdatesMap.delete(packageName);
      }
      await loadInstalledPackages();
    } catch (err) {
      console.error(`[PackageManager] Task ${action} error for ${packageName}:`, err);
      await sketchAlert(
        `组件 ${packageName} ${
          action === "uninstall" ? "卸载" : action === "update" ? "更新" : "安装"
        } 失败：\n${err?.toString() || "未知错误"}`,
        { type: "error", title: "组件操作失败" }
      );
    } finally {
      packageOperationMap.delete(packageName);
      const stepper = packageSteppersMap.get(packageName.toLowerCase());
      if (stepper) {
        stepper.stopTimer();
        packageSteppersMap.delete(packageName.toLowerCase());
      }
      setTimeout(() => {
        packageProgressMap.delete(packageName);
        refreshPackageViews();
      }, 1500);

      currentRunningTask = null;
      isProcessingQueue = false;

      refreshPackageViews();

      // 自动出队继续执行下一个任务
      if (packageTaskQueue.length > 0) {
        processPackageQueue();
      } else {
        if (packageQueueBadge) packageQueueBadge.classList.add("hidden");
        // 队列全部清空且当前无任务，注销任务并触发全任务完成判定通知
        notificationService.notifyIfAllCompleted({
          title: "pi-dl",
          message: "扩展组件安装与更新任务已全部完成。",
          taskId: "package-queue",
        });
      }
    }
  };

  // 应用推荐配置预设
  const handleApplyPackagePreset = async (packageName, btnElement) => {
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.textContent = "配置中...";
    }
    try {
      await configService.applyPackagePreset(packageName);
      await loadInstalledPackages();
    } catch (err) {
      console.error(`[PackageManager] Failed to apply preset for ${packageName}:`, err);
      await sketchAlert(`应用组件【${packageName}】推荐配置失败：\n${err?.toString() || "未知错误"}`, {
        type: "error",
        title: "应用推荐配置失败"
      });
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = "推荐配置";
      }
    }
  };

  // 安装组件
  const handleInstallPackage = (packageName) => {
    enqueuePackageTask(packageName, "install");
  };

  // 卸载组件
  const handleUninstallPackage = async (packageName) => {
    const confirmed = await sketchConfirm(`确定要从系统中卸载扩展组件「${packageName}」吗？\n（将加入操作队列自动执行）`, {
      title: "卸载扩展组件确认",
      isDanger: true
    });
    if (!confirmed) {
      return;
    }
    enqueuePackageTask(packageName, "uninstall");
  };

  // 更新单个组件
  const handleUpdatePackage = (packageName) => {
    enqueuePackageTask(packageName, "update");
  };

  // 批量检查更新
  const handleCheckAllUpdates = async () => {
    if (!btnCheckAllPackageUpdates) return;
    const origText = btnCheckAllPackageUpdates.innerHTML;
    btnCheckAllPackageUpdates.disabled = true;
    btnCheckAllPackageUpdates.innerHTML = `
      <span class="thinking-dot" style="margin-right: 4px;"></span>
      检查中...
    `;

    try {
      const updates = await configService.checkPackageUpdates();
      packageUpdatesMap.clear();
      let updateCount = 0;
      if (Array.isArray(updates)) {
        updates.forEach((u) => {
          packageUpdatesMap.set(u.name, u);
          if (u.hasUpdate) updateCount++;
        });
      }
      renderInstalledPackages();
      updateBatchUpdateButtonVisibility();
      if (currentCatalogResult?.packages) renderCatalogGrid(currentCatalogResult.packages);

      if (updateCount > 0) {
        await sketchAlert(`检查完成：发现 ${updateCount} 个组件有可用更新！`, { type: "success", title: "检查完成" });
      } else {
        await sketchAlert("已安装组件均为最新版本！", { type: "info", title: "检查完成" });
      }
    } catch (err) {
      console.error("[PackageManager] Check updates error:", err);
      await sketchAlert(`检查更新失败：${err?.toString() || "网络错误"}`, { type: "error", title: "检查更新失败" });
    } finally {
      btnCheckAllPackageUpdates.disabled = false;
      btnCheckAllPackageUpdates.innerHTML = origText;
    }
  };

  // 一键队列安装推荐扩展插件
  const handleInstallRecommendedPackages = () => {
    if (!recommendedPlugins || recommendedPlugins.length === 0) return;

    // 过滤出尚未安装且未在排队/运行中的推荐插件
    const toInstall = recommendedPlugins.filter(
      (p) => !isPackageInstalled(p.name) && !isPackageBusy(p.name)
    );

    if (toInstall.length === 0) {
      updateRecommendedButtonVisibility();
      return;
    }

    // 依次加入 FIFO 安装任务队列
    toInstall.forEach((p) => {
      enqueuePackageTask(p.name, "install");
    });
  };

  // 一键更新所有有可用更新的组件
  const handleUpdateAllPackages = () => {
    const updatablePkgs = installedPackages.filter((pkg) => {
      const updateInfo = packageUpdatesMap.get(pkg.name);
      return updateInfo && updateInfo.hasUpdate && !isPackageBusy(pkg.name);
    });

    if (updatablePkgs.length === 0) return;

    updatablePkgs.forEach((pkg) => {
      enqueuePackageTask(pkg.name, "update");
    });
  };

  if (btnInstallRecommendedPackages) {
    btnInstallRecommendedPackages.addEventListener("click", (e) => {
      e.stopPropagation();
      handleInstallRecommendedPackages();
    });
  }

  if (btnUpdateAllPackages) {
    btnUpdateAllPackages.addEventListener("click", (e) => {
      e.stopPropagation();
      handleUpdateAllPackages();
    });
  }

  if (btnCheckAllPackageUpdates) {
    btnCheckAllPackageUpdates.addEventListener("click", (e) => {
      e.stopPropagation();
      handleCheckAllUpdates();
    });
  }

  // 搜索栏交互绑定
  if (packagesSearchInput) {
    packagesSearchInput.addEventListener("input", () => {
      if (btnClearPackageSearch) {
        if (packagesSearchInput.value.trim().length > 0) {
          btnClearPackageSearch.classList.remove("hidden");
        } else {
          btnClearPackageSearch.classList.add("hidden");
        }
      }
    });

    packagesSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadCatalogPackages(1);
      }
    });
  }

  if (btnClearPackageSearch) {
    btnClearPackageSearch.addEventListener("click", () => {
      if (packagesSearchInput) {
        packagesSearchInput.value = "";
        btnClearPackageSearch.classList.add("hidden");
        loadCatalogPackages(1);
      }
    });
  }

  if (btnSearchPackages) {
    btnSearchPackages.addEventListener("click", () => {
      loadCatalogPackages(1);
    });
  }

  if (packagesTypeSelect) {
    packagesTypeSelect.addEventListener("change", () => {
      loadCatalogPackages(1);
    });
  }

  if (packagesSortSelect) {
    packagesSortSelect.addEventListener("change", () => {
      loadCatalogPackages(1);
    });
  }

  // 分页按钮绑定
  if (btnPackagesPrevPage) {
    btnPackagesPrevPage.addEventListener("click", () => {
      if (currentCatalogPage > 1) {
        loadCatalogPackages(currentCatalogPage - 1);
      }
    });
  }

  if (btnPackagesNextPage) {
    btnPackagesNextPage.addEventListener("click", () => {
      if (currentCatalogResult?.hasMore) {
        loadCatalogPackages(currentCatalogPage + 1);
      }
    });
  }

  // 初始化增强下拉框
  enhanceSelect(packagesTypeSelect);
  enhanceSelect(packagesSortSelect);


  api.loadInstalledPackages = loadInstalledPackages;
  api.loadRecommendedPlugins = loadRecommendedPlugins;
  api.loadCatalogPackages = loadCatalogPackages;
  api.hasCatalogLoadedOnce = () => hasLoadedCatalogOnce;
}
