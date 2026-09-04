import { invokeTauri } from "../services/tauri-bridge.js";

/**
 * 标题栏窗口控制按钮
 */
export function initWindowControls(ctx) {
  const api = ctx.api;

  // ==========================================================================
  // 窗口控制元素（批次 B：本模块自取，不再依赖 ctx.el）
  // ==========================================================================
  const btnMinimize = document.getElementById("btn-minimize");
  const btnMaximize = document.getElementById("btn-maximize");
  const btnClose = document.getElementById("btn-close");
  const titlebar = document.getElementById("titlebar");

  if (btnMinimize) {
    btnMinimize.addEventListener("click", () => invokeTauri("minimize_window"));
  }
  if (btnMaximize) {
    btnMaximize.addEventListener("click", () => invokeTauri("toggle_maximize_window"));
  }
  if (btnClose) {
    btnClose.addEventListener("click", () => invokeTauri("close_window"));
  }

  if (titlebar) {
    titlebar.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".titlebar-controls") && !e.target.closest(".flow-mini-brand") && !e.target.closest(".flow-model-tag")) {
        invokeTauri("toggle_maximize_window");
      }
    });
  }


}
