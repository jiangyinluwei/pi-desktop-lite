import { piClient } from "../services/pi-client.js";
import { versionService } from "../services/version-service.js";
import { configService } from "../services/config-service.js";
import { ProgressStepper } from "../services/progress-stepper.js";
import { notificationService } from "../services/notification-service.js";
import { sketchAlert } from "../services/sketch-modal.js";

/**
 * 内核状态、版本检查与一键更新流水线
 */
export function initKernelPanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const settingsBadge = el.settingsBadge;
  const hostStatusDot = el.hostStatusDot;
  const hostStatusText = el.hostStatusText;
  const hostVersionText = el.hostVersionText;
  const btnRestartHost = el.btnRestartHost;
  const btnCheckUpdate = el.btnCheckUpdate;
  const updateNotice = el.updateNotice;
  const updateMsg = el.updateMsg;
  const updateNoticeActions = el.updateNoticeActions;
  const btnToggleChangelog = el.btnToggleChangelog;
  const btnIgnoreUpdate = el.btnIgnoreUpdate;
  const btnUpdateKernel = el.btnUpdateKernel;
  const kernelUpdateProgressWrap = el.kernelUpdateProgressWrap;
  const kernelProgressStage = el.kernelProgressStage;
  const kernelProgressPercent = el.kernelProgressPercent;
  const btnCancelUpdate = el.btnCancelUpdate;
  const kernelProgressFill = el.kernelProgressFill;
  const kernelProgressSubMsg = el.kernelProgressSubMsg;
  const kernelChangelogDrawer = el.kernelChangelogDrawer;
  const changelogVersionTag = el.changelogVersionTag;
  const btnCloseChangelog = el.btnCloseChangelog;
  const kernelChangelogContent = el.kernelChangelogContent;
  const autoReconnectSwitch = el.autoReconnectSwitch;

  // ==========================================================================
  // 6. 内核与版本控制逻辑 (包含一键更新、取消更新、不再提醒与 Changelog 抽屉)
  // ==========================================================================
  let latestUpdateInfo = null;
  let updateNoticeFadeTimer = null;

  const clearUpdateNoticeFade = () => {
    if (updateNoticeFadeTimer) {
      clearTimeout(updateNoticeFadeTimer);
      updateNoticeFadeTimer = null;
    }
    if (updateNotice) {
      updateNotice.classList.remove("fade-out");
    }
  };

  const showUpdateNoticeAutoFade = (durationMs = 8000) => {
    if (!updateNotice) return;
    clearUpdateNoticeFade();
    updateNotice.classList.remove("hidden", "fade-out");

    updateNoticeFadeTimer = setTimeout(() => {
      updateNotice.classList.add("fade-out");
      setTimeout(() => {
        if (updateNotice.classList.contains("fade-out")) {
          updateNotice.classList.add("hidden");
          updateNotice.classList.remove("fade-out");
        }
      }, 500);
    }, durationMs);
  };

  const updateHostUI = (statusPayload) => {
    const status = typeof statusPayload === "string" ? statusPayload : statusPayload?.status || "ready";
    if (hostStatusText) hostStatusText.textContent = status;
    if (hostStatusDot) {
      hostStatusDot.className = "status-dot";
      if (status === "ready") hostStatusDot.classList.add("status-ready");
      else if (status === "starting") hostStatusDot.classList.add("status-starting");
      else if (status === "crashed") hostStatusDot.classList.add("status-crashed");
      else hostStatusDot.classList.add("status-stopped");
    }

    if (statusPayload?.pi_version && hostVersionText) {
      hostVersionText.textContent = `v${statusPayload.pi_version}`;
    }
  };

  const applyUpdateInfoToUI = (info, isManual = false) => {
    latestUpdateInfo = info;
    if (!info) return;

    if (info.has_update) {
      // 若非用户主动点击检查，且用户已勾选“不再提醒更新”，则静默不弹窗
      if (!isManual && configService.getIgnoreUpdateNotification()) {
        if (updateNotice) updateNotice.classList.add("hidden");
        if (settingsBadge) settingsBadge.classList.remove("visible");
        return;
      }

      clearUpdateNoticeFade();
      if (updateNotice) updateNotice.classList.remove("hidden");
      if (updateNoticeActions) updateNoticeActions.classList.remove("hidden");
      if (updateMsg) {
        updateMsg.textContent = `发现新版本 v${info.latest_version} (当前: v${info.current_version})！`;
      }
      if (btnUpdateKernel) {
        btnUpdateKernel.innerHTML = `
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 2v8M4 6l4 4 4-4M2 13h12" />
          </svg>
          一键更新到 v${info.latest_version}
        `;
      }
      if (settingsBadge) settingsBadge.classList.add("visible");
    } else {
      if (updateNoticeActions) updateNoticeActions.classList.add("hidden");
      if (kernelChangelogDrawer) kernelChangelogDrawer.classList.add("hidden");
      if (updateMsg) {
        updateMsg.textContent = `已是最新版本 (v${info.current_version || "0.84.3"})`;
      }
      if (settingsBadge) settingsBadge.classList.remove("visible");
      // "是最新版本" 提醒框 弹出8秒后自动渐隐
      showUpdateNoticeAutoFade(8000);
    }
  };

  piClient.addEventListener("status-change", (e) => {
    updateHostUI(e.detail);
    if (e.detail?.status === "ready") {
      api.loadModelsAndState();
    }
  });

  if (btnRestartHost) {
    btnRestartHost.addEventListener("click", async () => {
      btnRestartHost.disabled = true;
      try {
        await piClient.restartHost();
      } catch (err) {
        console.error("Restart host failed:", err);
      } finally {
        setTimeout(() => {
          btnRestartHost.disabled = false;
        }, 1000);
      }
    });
  }

  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener("click", async () => {
      btnCheckUpdate.disabled = true;
      try {
        // 主动点击检查更新：将 ignoreUpdateNotification 置 false 并持久化记忆
        await configService.setIgnoreUpdateNotification(false);
        const res = await versionService.checkUpdate();
        applyUpdateInfoToUI(res, true);
      } catch (err) {
        console.error("Check update failed:", err);
      } finally {
        btnCheckUpdate.disabled = false;
      }
    });
  }

  // 不再提醒更新
  if (btnIgnoreUpdate) {
    btnIgnoreUpdate.addEventListener("click", async () => {
      await configService.setIgnoreUpdateNotification(true);
      clearUpdateNoticeFade();
      if (updateNotice) updateNotice.classList.add("hidden");
      if (kernelChangelogDrawer) kernelChangelogDrawer.classList.add("hidden");
      if (settingsBadge) settingsBadge.classList.remove("visible");
    });
  }

  // 模型配置「自动重连切换」开关 (默认勾选，全局持久化)
  if (autoReconnectSwitch) {
    autoReconnectSwitch.checked = configService.getAutoReconnectSwitch();
    autoReconnectSwitch.addEventListener("change", () => {
      configService.setAutoReconnectSwitch(autoReconnectSwitch.checked, true);
    });
  }
  configService.addEventListener("auto-reconnect-change", (e) => {
    if (autoReconnectSwitch && e.detail?.value !== undefined) {
      autoReconnectSwitch.checked = e.detail.value;
    }
  });

  // 取消内核更新
  if (btnCancelUpdate) {
    btnCancelUpdate.addEventListener("click", async () => {
      btnCancelUpdate.disabled = true;
      kernelUpdateStepper.stopTimer();
      if (kernelProgressStage) kernelProgressStage.textContent = "正在取消更新...";
      if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = "正在停止下载并清理临时文件...";
      try {
        await versionService.cancelKernelUpdate();
      } catch (err) {
        console.warn("Cancel kernel update error:", err);
      }
    });
  }

  // 展开/收起更新日志抽屉
  if (btnToggleChangelog && kernelChangelogDrawer) {
    btnToggleChangelog.addEventListener("click", () => {
      const isHidden = kernelChangelogDrawer.classList.toggle("hidden");
      if (!isHidden && latestUpdateInfo) {
        if (changelogVersionTag) {
          changelogVersionTag.textContent = latestUpdateInfo.latest_version
            ? `v${latestUpdateInfo.latest_version}`
            : "最新版本";
        }
        if (kernelChangelogContent) {
          kernelChangelogContent.textContent =
            latestUpdateInfo.release_notes?.trim() || "暂无该版本的更新日志详情。";
        }
      }
    });
  }

  if (btnCloseChangelog && kernelChangelogDrawer) {
    btnCloseChangelog.addEventListener("click", () => {
      kernelChangelogDrawer.classList.add("hidden");
    });
  }

  // 内核更新平滑进度步进器（每隔2秒增加1%，直到下个阶段-1%）
  const kernelMilestones = [0, 5, 8, 10, 72, 80, 86, 90, 95, 100];
  const kernelUpdateStepper = new ProgressStepper({
    milestones: kernelMilestones,
    intervalMs: 2000,
    onUpdate: (currentPercent, payload) => {
      if (kernelUpdateProgressWrap) {
        kernelUpdateProgressWrap.classList.remove("hidden");
      }
      if (kernelProgressFill) {
        kernelProgressFill.style.width = `${currentPercent}%`;
      }
      if (kernelProgressPercent) {
        kernelProgressPercent.textContent = `${currentPercent}%`;
      }
      if (payload) {
        if (payload.stageText && kernelProgressStage) {
          kernelProgressStage.textContent = payload.stageText;
        }
        if (payload.subMsgText && kernelProgressSubMsg) {
          kernelProgressSubMsg.textContent = payload.subMsgText;
        }
      }
    },
  });

  // 一键更新内核逻辑
  if (btnUpdateKernel) {
    btnUpdateKernel.addEventListener("click", async () => {
      const targetVer = latestUpdateInfo?.latest_version;
      if (!targetVer) {
        await sketchAlert("未找到可用更新版本", { type: "info", title: "检查更新" });
        return;
      }

      // 注册内核更新任务
      notificationService.registerTask("kernel-update", {
        targetVer,
        type: "kernel",
      });

      // 禁用操作按钮防止重复触发
      btnUpdateKernel.disabled = true;
      if (btnRestartHost) btnRestartHost.disabled = true;
      if (btnCheckUpdate) btnCheckUpdate.disabled = true;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      // 显示进度卡片并重置步进器
      if (kernelUpdateProgressWrap) {
        kernelUpdateProgressWrap.classList.remove("hidden");
        if (kernelProgressFill) kernelProgressFill.style.width = "0%";
        if (kernelProgressPercent) kernelProgressPercent.textContent = "0%";
        if (kernelProgressStage) kernelProgressStage.textContent = "正在准备下载内核...";
        if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = "正在连接 GitHub Releases...";
      }

      kernelUpdateStepper.reset();
      kernelUpdateStepper.step(0, {
        stageText: "正在准备下载内核...",
        subMsgText: "正在连接 GitHub Releases...",
      });

      try {
        await versionService.updateKernel(targetVer);
      } catch (err) {
        console.error("Kernel update failed:", err);
        kernelUpdateStepper.stopTimer();
        if (kernelProgressStage) kernelProgressStage.textContent = "内核更新失败";
        if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = String(err);
        btnUpdateKernel.disabled = false;
        if (btnRestartHost) btnRestartHost.disabled = false;
        if (btnCheckUpdate) btnCheckUpdate.disabled = false;
        if (btnCancelUpdate) btnCancelUpdate.disabled = false;
        notificationService.notifyError({
          title: "pi-dl",
          message: `内核更新失败：${String(err)}`,
          taskId: "kernel-update",
        });
      }
    });
  }

  // 监听内核更新流式进度事件
  versionService.addEventListener("kernel-update-progress", (e) => {
    const p = e.detail;
    if (!p) return;

    let subMsg = p.message || "";
    if (p.stage === "downloading" && p.total_bytes > 0) {
      const mbDown = (p.downloaded_bytes / (1024 * 1024)).toFixed(1);
      const mbTot = (p.total_bytes / (1024 * 1024)).toFixed(1);
      // 仅保留最右侧百分比，下方与左侧不再显示冗余百分比
      subMsg = `流式下载中: ${mbDown} MB / ${mbTot} MB`;
    }

    if (p.stage === "completed") {
      kernelUpdateStepper.stopTimer();
      kernelUpdateStepper.step(100, {
        stageText: p.message || `Pi 内核已成功更新至最新版本 v${p.target_version}！`,
        subMsgText: subMsg,
      });

      if (hostVersionText) {
        hostVersionText.textContent = `v${p.target_version}`;
      }
      if (updateNoticeActions) {
        updateNoticeActions.classList.add("hidden");
      }
      if (kernelChangelogDrawer) {
        kernelChangelogDrawer.classList.add("hidden");
      }
      if (updateMsg) {
        updateMsg.textContent = `Pi 内核已成功更新至最新版本 v${p.target_version}！`;
      }
      if (settingsBadge) {
        settingsBadge.classList.remove("visible");
      }

      if (btnUpdateKernel) btnUpdateKernel.disabled = false;
      if (btnRestartHost) btnRestartHost.disabled = false;
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      // 触发全任务完成通知
      notificationService.notifyIfAllCompleted({
        title: "pi-dl",
        message: `Pi 内核已成功更新至最新版本 v${p.target_version}！`,
        taskId: "kernel-update",
      });

      // "更新成功" 的提醒框 弹出8秒后自动渐隐
      showUpdateNoticeAutoFade(8000);

      // 3.5秒后自动隐去进度卡片
      setTimeout(() => {
        if (kernelUpdateProgressWrap) {
          kernelUpdateProgressWrap.classList.add("hidden");
        }
      }, 3500);
    } else if (p.stage === "cancelled") {
      kernelUpdateStepper.stopTimer();
      if (kernelProgressStage) kernelProgressStage.textContent = "内核更新已取消";
      if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = "已中止下载并清理临时文件";
      if (kernelProgressPercent) kernelProgressPercent.textContent = "0%";
      if (kernelProgressFill) kernelProgressFill.style.width = "0%";

      if (btnUpdateKernel) btnUpdateKernel.disabled = false;
      if (btnRestartHost) btnRestartHost.disabled = false;
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      notificationService.unregisterTask("kernel-update");

      setTimeout(() => {
        if (kernelUpdateProgressWrap) {
          kernelUpdateProgressWrap.classList.add("hidden");
        }
      }, 2000);
    } else if (p.stage === "error") {
      kernelUpdateStepper.stopTimer();
      if (kernelProgressStage) kernelProgressStage.textContent = "内核更新失败";
      if (kernelProgressSubMsg) kernelProgressSubMsg.textContent = p.message || "更新发生异常";

      if (btnUpdateKernel) btnUpdateKernel.disabled = false;
      if (btnRestartHost) btnRestartHost.disabled = false;
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      if (btnCancelUpdate) btnCancelUpdate.disabled = false;

      notificationService.notifyError({
        title: "pi-dl",
        message: `内核更新失败：${p.message || "更新发生异常"}`,
        taskId: "kernel-update",
      });
    } else {
      // 正常多阶段推进：立即跳至 p.percent，并在等待期间每 2s 步进 +1% 直到下个阶段 - 1%
      kernelUpdateStepper.step(p.percent, {
        stageText: p.message || "正在处理内核更新...",
        subMsgText: subMsg,
      });
    }
  });

  versionService.addEventListener("update-available", (e) => {
    applyUpdateInfoToUI(e.detail, false);
  });



}
