import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";

/**
 * 设置页 Tab、内部步骤与折叠通道抽屉导航
 */
export function initSettingsNavigation(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const whitelistModelsList = el.whitelistModelsList;
  const btnToggleOfficial = el.btnToggleOfficial;
  const btnToggleCustom = el.btnToggleCustom;
  const channelConfigOfficial = el.channelConfigOfficial;
  const channelConfigCustom = el.channelConfigCustom;
  const officialProviderSelect = el.officialProviderSelect;

  // ==========================================================================
  // 2. 独立全页面设置视图导航交互
  // ==========================================================================
  const switchSettingsTab = (targetTab) => {
    if (!targetTab) return;
    const tabButtons = document.querySelectorAll(".settings-tab-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");

    tabButtons.forEach((b) => {
      if (b.getAttribute("data-tab") === targetTab) {
        b.classList.add("active");
      } else {
        b.classList.remove("active");
      }
    });

    tabPanes.forEach((pane) => {
      if (pane.id === `pane-${targetTab.replace("tab-", "")}`) {
        pane.classList.add("active");
        if (targetTab === "tab-packages") {
          if (piClient.hasKernel()) {
            if (typeof api.loadInstalledPackages === "function") api.loadInstalledPackages();
            if (typeof api.loadRecommendedPlugins === "function") api.loadRecommendedPlugins();
            if (typeof api.loadCatalogPackages === "function" && !api.hasCatalogLoadedOnce()) {
              api.loadCatalogPackages(1);
            }
          }
        }
        if (targetTab === "tab-workspaces") {
          if (typeof api.loadWorkspaces === "function") api.loadWorkspaces();
        }
      } else {
        pane.classList.remove("active");
      }
    });
  };

  api.switchSettingsTab = switchSettingsTab;

  const initSettingsTabs = () => {
    const tabButtons = document.querySelectorAll(".settings-tab-btn");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetTab = btn.getAttribute("data-tab");
        switchSettingsTab(targetTab);
      });
    });
  };

  initSettingsTabs();

  // 设置面板自动平滑滚动到底部辅助函数 (针对官方通道/自定义通道抽屉首次展开行为)
  const scrollSettingsToBottom = (smooth = true) => {
    const settingsTabContent = document.querySelector(".settings-tab-content");
    if (!settingsTabContent) return;
    const doScroll = () => {
      settingsTabContent.scrollTo({
        top: settingsTabContent.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    };
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 80);
    setTimeout(doScroll, 220); // 覆盖抽屉 fadeInDrawer 动画耗时
  };

  // 设置面板自动平滑滚动使得当前操作的框体/卡片底部对齐视口下边缘 (单次精准计算，杜绝动画掐断与抖动)
  const scrollElementIntoViewBottom = (el, padding = 20, smooth = true) => {
    const container = document.querySelector(".settings-tab-content");
    if (!container || !el) return;

    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      if (containerRect.height <= 0 || elRect.height <= 0) return;

      const viewportHeight = container.clientHeight;
      const effectivePadding = Math.min(padding, 24);

      let targetScrollTop = container.scrollTop;

      // 如果目标元素过大（超出视口可用高度），优先保证其顶部可见
      if (elRect.height + effectivePadding * 2 >= viewportHeight) {
        const topDelta = elRect.top - (containerRect.top + effectivePadding);
        targetScrollTop = container.scrollTop + topDelta;
      } else {
        // 若元素底部超出视口下边缘，则向下滚动让其底部与呼吸间距露出
        if (elRect.bottom > containerRect.bottom - effectivePadding) {
          const bottomDelta = elRect.bottom - (containerRect.bottom - effectivePadding);
          targetScrollTop = container.scrollTop + bottomDelta;
        } else if (elRect.top < containerRect.top + effectivePadding) {
          // 若元素顶部超出视口上边缘，则向上滚动让其顶部露出
          const topDelta = elRect.top - (containerRect.top + effectivePadding);
          targetScrollTop = container.scrollTop + topDelta;
        }
      }

      const maxScroll = container.scrollHeight - viewportHeight;
      targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

      // 若位置已在目标范围，且差距极小 (<2px)，则无需滚动，杜绝抖动
      if (Math.abs(targetScrollTop - container.scrollTop) > 2) {
        container.scrollTo({
          top: targetScrollTop,
          behavior: smooth ? "smooth" : "auto",
        });
      }
    });
  };

  // 自定义通道配置内层 Tab 切换 (步骤1 / 步骤2)
  const switchInnerTab = (targetId) => {
    const innerTabBtns = document.querySelectorAll(".inner-tab-btn");
    const innerTabPanes = document.querySelectorAll(".inner-tab-pane");

    innerTabBtns.forEach((b) => {
      if (b.getAttribute("data-inner-tab") === targetId) {
        b.classList.add("active");
      } else {
        b.classList.remove("active");
      }
    });

    innerTabPanes.forEach((pane) => {
      if (pane.id === targetId) {
        pane.classList.add("active");
      } else {
        pane.classList.remove("active");
      }
    });

    scrollSettingsToBottom(true);
  };

  const initInnerTabs = () => {
    const innerTabBtns = document.querySelectorAll(".inner-tab-btn");
    innerTabBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute("data-inner-tab");
        if (targetId) {
          switchInnerTab(targetId);
        }
      });
    });
  };

  initInnerTabs();

  // ==========================================================================
  // 模型配置面板内折叠通道抽屉 (官方通道配置 / 自定义通道配置)
  // ==========================================================================

  const setExpandedChannel = (channel) => {
    settings.expandedChannel = channel;

    if (channel === "official") {
      if (whitelistModelsList) whitelistModelsList.classList.add("collapsed-single");
      if (channelConfigOfficial) channelConfigOfficial.classList.remove("hidden");
      if (channelConfigCustom) channelConfigCustom.classList.add("hidden");

      if (btnToggleOfficial) {
        btnToggleOfficial.innerHTML = `<span>收起</span>${ICONS.chevronDown}`;
        btnToggleOfficial.classList.add("active");
      }
      if (btnToggleCustom) {
        btnToggleCustom.innerHTML = `<span>自定义通道配置</span>${ICONS.chevronDown}`;
        btnToggleCustom.classList.remove("active");
      }
      if (typeof api.renderOfficialProviderDetails === "function" && officialProviderSelect?.value) {
        api.renderOfficialProviderDetails(officialProviderSelect.value);
      }
      scrollSettingsToBottom(true);
    } else if (channel === "custom") {
      if (whitelistModelsList) whitelistModelsList.classList.add("collapsed-single");
      if (channelConfigOfficial) channelConfigOfficial.classList.add("hidden");
      if (channelConfigCustom) channelConfigCustom.classList.remove("hidden");

      if (btnToggleOfficial) {
        btnToggleOfficial.innerHTML = `<span>官方通道配置</span>${ICONS.chevronDown}`;
        btnToggleOfficial.classList.remove("active");
      }
      if (btnToggleCustom) {
        btnToggleCustom.innerHTML = `<span>收起</span>${ICONS.chevronDown}`;
        btnToggleCustom.classList.add("active");
      }
      if (typeof api.loadCustomProvidersConfig === "function") {
        api.loadCustomProvidersConfig();
      }
      scrollSettingsToBottom(true);
    } else {
      // 收起全部抽屉，恢复模型列表完整展示
      if (whitelistModelsList) whitelistModelsList.classList.remove("collapsed-single");
      if (channelConfigOfficial) channelConfigOfficial.classList.add("hidden");
      if (channelConfigCustom) channelConfigCustom.classList.add("hidden");

      if (btnToggleOfficial) {
        btnToggleOfficial.innerHTML = `<span>官方通道配置 - 展开</span>${ICONS.chevronDown}`;
        btnToggleOfficial.classList.remove("active");
      }
      if (btnToggleCustom) {
        btnToggleCustom.innerHTML = `<span>自定义通道配置 - 展开</span>${ICONS.chevronDown}`;
        btnToggleCustom.classList.remove("active");
      }
    }
  };

  const initChannelDrawers = () => {
    if (btnToggleOfficial) {
      btnToggleOfficial.addEventListener("click", (e) => {
        e.preventDefault();
        if (settings.expandedChannel === "official") {
          setExpandedChannel(null);
        } else {
          setExpandedChannel("official");
        }
      });
    }

    if (btnToggleCustom) {
      btnToggleCustom.addEventListener("click", (e) => {
        e.preventDefault();
        if (settings.expandedChannel === "custom") {
          setExpandedChannel(null);
        } else {
          setExpandedChannel("custom");
        }
      });
    }
  };

  initChannelDrawers();

  api.scrollSettingsToBottom = scrollSettingsToBottom;
  api.scrollElementIntoViewBottom = scrollElementIntoViewBottom;
  api.switchInnerTab = switchInnerTab;
}
