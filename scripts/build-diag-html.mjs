/**
 * 生成 .diag-index.html：注入 Tauri IPC mock 与自动点击设置按钮的观测脚本。
 * 运行: node scripts/build-diag-html.mjs
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");
const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");

const injection = `
<script type="module">
  window.__TAURI__ = {
    core: {
      invoke: async (command) => {
        window.__diagIpcCalls = (window.__diagIpcCalls || []);
        window.__diagIpcCalls.push(command);
        switch (command) {
          case "pi_get_installed_packages":
            return [{ name: "pi-web-access", version: "1.2.3", description: "网络访问组件", hasPreset: true, isPresetApplied: true }];
          case "pi_get_recommended_plugins":
            return [];
          case "pi_search_packages":
            return { packages: [], page: 1, totalCount: 0, totalPages: 0, hasMore: false };
          case "pi_list_sessions":
            return [];
          case "pi_get_state":
            return { model: { provider: "anthropic", id: "claude" }, thinkingLevel: null };
          case "pi_get_official_models_catalog":
            return [];
          case "pi_get_auth_config":
            return {};
          case "pi_get_custom_models":
            return { providers: {} };
          case "pi_get_skill_mappings":
            return [];
          case "pi_get_prompt_history":
            return [];
          case "pi_inspect_file":
            return null;
          case "pi_get_host_status":
            return { status: "ready", pi_version: "0.0.0" };
          default:
            return null;
        }
      }
    },
    event: { listen: async () => Promise.resolve(() => {}) }
  };
</script>
<script type="module">
  window.addEventListener("error", (e) => {
    window.__diagErrors = (window.__diagErrors || []);
    window.__diagErrors.push(String(e.error || e.message));
  });
  window.addEventListener("unhandledrejection", (e) => {
    window.__diagErrors = (window.__diagErrors || []);
    window.__diagErrors.push(String(e.reason?.stack || e.reason));
  });
  setTimeout(() => {
    const btn = document.getElementById("settings-btn");
    if (btn) btn.click();
  }, 400);
  setTimeout(() => {
    const count = document.getElementById("installed-packages-count");
    const list = document.getElementById("installed-packages-list");
    const wrapper = document.querySelector(".installed-packages-wrapper");
    const header = document.querySelector(".installed-section-header");
    const pane = document.getElementById("pane-packages");
    const result = {
      diag: true,
      installedCount: count?.textContent || null,
      listChildren: list?.children?.length ?? null,
      listHtml: (list?.innerHTML || "").slice(0, 300),
      wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : "no-wrapper",
      wrapperVisibility: wrapper ? getComputedStyle(wrapper).visibility : "no-wrapper",
      headerDisplay: header ? getComputedStyle(header).display : "no-header",
      paneActive: pane ? pane.classList.contains("active") : null,
      ipcCalls: window.__diagIpcCalls || [],
      errors: window.__diagErrors || [],
      stylesLoaded: Array.from(document.styleSheets).length,
    };
    const pre = document.createElement("pre");
    pre.id = "diag-result";
    pre.textContent = JSON.stringify(result, null, 2);
    document.body.appendChild(pre);
  }, 4500);
</script>
`;

const diagHtml = html.replace(
  '<script type="module" src="./main.js"></script>',
  `${injection}\n<script type="module" src="./main.js"></script>`
);

fs.writeFileSync(path.join(SRC, ".diag-index.html"), diagHtml, "utf8");
console.log("generated src/.diag-index.html");
