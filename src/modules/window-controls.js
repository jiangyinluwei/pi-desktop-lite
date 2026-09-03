import { invokeTauri } from "../services/tauri-bridge.js";

/**
 * 标题栏窗口控制按钮
 */
export function initWindowControls(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;



  // ==========================================================================
  // 窗口控制元素
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
