import { configService } from "../services/config-service.js";
import { piClient } from "../services/pi-client.js";

/**
 * 主题、发送快捷键与输出 Tokens 规范吸附
 */
export function initPreferences(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const searchHint = el.searchHint;
  const hintKeyText = el.hintKeyText;

  // ==========================================================================
  // 0. 模型输出上限规范吸附辅助函数 (Snap to Closest Canonical Token Limits)
  // ==========================================================================
  const STANDARD_OUTPUT_TOKENS = [
    512, 1024, 2048, 4096, 8192, 16384, 32768, 64000, 65536, 100000, 128000, 131072,
  ];

  const snapToClosestStandardTokens = (inputVal) => {
    let num = parseInt(inputVal, 10);
    if (isNaN(num) || num <= 0) return 4096;

    let closest = STANDARD_OUTPUT_TOKENS[0];
    let minDiff = Math.abs(num - closest);

    for (const val of STANDARD_OUTPUT_TOKENS) {
      const diff = Math.abs(num - val);
      if (diff < minDiff) {
        minDiff = diff;
        closest = val;
      }
    }
    return closest;
  };

  const setupOutputTokensAutoSnap = (inputEl) => {
    if (!inputEl) return;
    const doSnap = () => {
      if (inputEl.value && inputEl.value.trim() !== "") {
        const snapped = snapToClosestStandardTokens(inputEl.value);
        inputEl.value = snapped.toString();
      }
    };
    inputEl.addEventListener("blur", doSnap);
    inputEl.addEventListener("change", doSnap);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSnap();
        inputEl.blur();
      }
    });
  };

  // ==========================================================================
  // 1. 软件主题色设置 (Theme Mode: 跟随系统、浅色、暗色)
  // ==========================================================================
  const initThemeControl = () => {
    configService.initTheme();
    const currentTheme = configService.getTheme();

    const themeButtons = document.querySelectorAll(".theme-option");
    themeButtons.forEach((btn) => {
      if (btn.getAttribute("data-theme-val") === currentTheme) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetTheme = btn.getAttribute("data-theme-val");
        configService.applyTheme(targetTheme);

        themeButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });

    configService.addEventListener("theme-change", (e) => {
      const activeTheme = e.detail?.theme || configService.getTheme();
      themeButtons.forEach((b) => {
        if (b.getAttribute("data-theme-val") === activeTheme) {
          b.classList.add("active");
        } else {
          b.classList.remove("active");
        }
      });
    });
  };

  // ==========================================================================
  // 发送逻辑与快捷键切换控制 (Send Shortcut Logic: enter | ctrlEnter)
  // ==========================================================================
  const updateSendShortcutUI = (shortcut) => {
    const isEnter = shortcut !== "ctrlEnter";
    const hasKernel = piClient.hasKernel();

    if (hintKeyText) {
      hintKeyText.textContent = isEnter ? "Enter" : "Ctrl+Enter";
    }
    if (searchHint) {
      if (!hasKernel) {
        searchHint.classList.add("disabled");
        searchHint.setAttribute("title", "未检测到pi内核，无法发送指令");
        searchHint.setAttribute("aria-label", "未检测到pi内核，无法发送指令");
      } else {
        searchHint.classList.remove("disabled");
        searchHint.setAttribute("title", isEnter ? "发送 (Enter)" : "发送 (Ctrl+Enter)");
        searchHint.setAttribute("aria-label", isEnter ? "发送 (Enter)" : "发送 (Ctrl+Enter)");
      }
    }

    const shortcutButtons = document.querySelectorAll(".shortcut-option");
    shortcutButtons.forEach((btn) => {
      if (btn.getAttribute("data-shortcut-val") === (isEnter ? "enter" : "ctrlEnter")) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  };

  const initSendShortcutControl = () => {
    const currentShortcut = configService.getSendShortcut();
    updateSendShortcutUI(currentShortcut);

    const shortcutButtons = document.querySelectorAll(".shortcut-option");
    shortcutButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const targetShortcut = btn.getAttribute("data-shortcut-val") || "enter";
        configService.setSendShortcut(targetShortcut);
        updateSendShortcutUI(targetShortcut);
      });
    });

    configService.addEventListener("send-shortcut-change", (e) => {
      const activeShortcut = e.detail?.sendShortcut || configService.getSendShortcut();
      updateSendShortcutUI(activeShortcut);
    });

    piClient.addEventListener("status-change", () => {
      updateSendShortcutUI(configService.getSendShortcut());
    });

    piClient.addEventListener("kernel-status-change", () => {
      updateSendShortcutUI(configService.getSendShortcut());
    });

    if (searchHint) {
      searchHint.addEventListener("click", (e) => {
        e.preventDefault();
        if (!piClient.hasKernel()) return;
        api.submitCurrentPrompt();
      });
    }
  };

  // 异步预加载 ~/.pi-dl/config.json 并初始化主题与控件
  (async () => {
    await configService.loadAppConfig();
    initThemeControl();
    initSendShortcutControl();
    // 启动时 best-effort 向 Pi 内核注入推荐重连配置 (仅当自动重连开启时，失败静默不阻断)
    if (configService.getAutoReconnectSwitch()) {
      configService.applyModelFailoverPreset().catch(() => {});
    }
  })();

  api.snapToClosestStandardTokens = snapToClosestStandardTokens;
  api.setupOutputTokensAutoSnap = setupOutputTokensAutoSnap;
}
