import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { invokeTauri } from "../services/tauri-bridge.js";

/**
 * 文件拖入、概述胶囊与多模态路径注入
 */
export function initFileAttachments(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const searchInputWrapper = el.searchInputWrapper;
  const searchInput = el.searchInput;
  const attachedCapsulesContainer = el.attachedCapsulesContainer;
  const searchIconBox = el.searchIconBox;
  const filePickerInput = el.filePickerInput;
  const searchForm = el.searchForm;

  // ==========================================================================
  // 输入框文件拖入、手绘概述胶囊与多模态文件注入引擎
  // ==========================================================================

  const getFileCategoryIcon = (category) => {
    if (category === "folder" || category === "directory") return ICONS.folder;
    if (category === "image") return ICONS.image;
    if (category === "code") return ICONS.code;
    return ICONS.document;
  };

  const renderAttachedCapsules = () => {
    if (!attachedCapsulesContainer) return;
    attachedCapsulesContainer.innerHTML = "";

    if (attachments.files.length === 0) {
      searchInputWrapper?.classList.remove("has-capsules");
      api.updateInputState();
      return;
    }

    searchInputWrapper?.classList.add("has-capsules");

    attachments.files.forEach((file, index) => {
      const capsule = document.createElement("div");
      capsule.className = "sketch-file-capsule";
      capsule.title = file.path || file.name;
      capsule.innerHTML = `
        <span class="capsule-file-icon">${getFileCategoryIcon(file.category)}</span>
        <span class="capsule-file-name">${escapeHtml(file.name)}</span>
        <button type="button" class="capsule-remove-btn" aria-label="移除 ${escapeHtml(file.name)}" title="移除">
          ${ICONS.close}
        </button>
      `;

      const removeBtn = capsule.querySelector(".capsule-remove-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeAttachedFile(index);
        });
      }

      attachedCapsulesContainer.appendChild(capsule);
    });

    api.updateInputState();
  };

  const addAttachedFiles = async (paths) => {
    if (!Array.isArray(paths) || paths.length === 0) return;

    const validPaths = paths
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => Boolean(p));
    if (validPaths.length === 0) return;

    let inspectedList = [];
    try {
      const res = await invokeTauri("pi_inspect_paths", { paths: validPaths });
      if (Array.isArray(res)) {
        inspectedList = res;
      }
    } catch (_) {
      // 降级使用单个 pi_inspect_file 遍历
      for (const p of validPaths) {
        try {
          const singleRes = await invokeTauri("pi_inspect_file", { path: p });
          if (Array.isArray(singleRes)) {
            inspectedList.push(...singleRes);
          } else if (singleRes) {
            inspectedList.push(singleRes);
          }
        } catch (err) {
          console.warn("[FileAttachments] Inspect failed for path:", p, err);
        }
      }
    }

    // 兜底本地简易识别（若 Rust 接口因故未命中但属于基础文件时）
    if (inspectedList.length === 0) {
      for (const p of validPaths) {
        const normalized = p.replace(/\\/g, "/");
        const name = normalized.split("/").filter(Boolean).pop() || "file";
        const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
        const codeExts = ["js", "jsx", "ts", "tsx", "rs", "py", "go", "java", "c", "cpp", "json", "yaml", "yml", "html", "css", "md", "sql", "sh"];
        let category = "document";
        if (imageExts.includes(ext)) category = "image";
        else if (codeExts.includes(ext)) category = "code";
        else if (!ext) category = "folder";

        inspectedList.push({
          path: p,
          name,
          ext,
          category,
          size: 0,
          is_text: category !== "image" && category !== "folder",
        });
      }
    }

    if (inspectedList.length === 0) {
      api.showGlobalToast?.("未检测到支持解析的文件或目录", 2000);
      return;
    }

    let addedCount = 0;
    for (const fileMeta of inspectedList) {
      if (!fileMeta || !fileMeta.path) continue;
      if (attachments.files.some((f) => f.path === fileMeta.path)) continue;
      attachments.files.push(fileMeta);
      addedCount++;
    }

    if (addedCount > 0) {
      renderAttachedCapsules();
      if (addedCount === 1) {
        const item = attachments.files[attachments.files.length - 1];
        if (item?.category === "folder" || item?.category === "directory") {
          api.showGlobalToast?.(`已关联文件夹「${item.name}」`, 1800);
        } else {
          api.showGlobalToast?.(`已添加文件「${item.name}」`, 1800);
        }
      } else if (addedCount > 1) {
        api.showGlobalToast?.(`已添加 ${addedCount} 个关联项`, 1800);
      }
    } else if (attachments.files.length > 0) {
      api.showGlobalToast?.("所选项目已在关联列表中", 1500);
    }

    if (searchInput) searchInput.focus();
  };

  const removeAttachedFile = (index) => {
    if (index >= 0 && index < attachments.files.length) {
      attachments.files.splice(index, 1);
      renderAttachedCapsules();
    }
  };

  const clearAttachedFiles = () => {
    attachments.files = [];
    renderAttachedCapsules();
  };

  // 绑定 Tauri 文件拖拽广播事件
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen("file-drop-paths", (event) => {
      const paths = event.payload;
      if (Array.isArray(paths) && paths.length > 0) {
        addAttachedFiles(paths);
      }
      searchForm?.classList.remove("drag-over", "drag-active");
    });

    window.__TAURI__.event.listen("file-drag-enter", () => {
      searchForm?.classList.add("drag-over");
    });

    window.__TAURI__.event.listen("file-drag-leave", () => {
      searchForm?.classList.remove("drag-over", "drag-active");
    });
  }

  // 绑定原生 DOM Drag & Drop 视觉高亮与防止误跳转
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    searchForm?.classList.add("drag-over");
  });

  window.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) {
      searchForm?.classList.remove("drag-over", "drag-active");
    }
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    searchForm?.classList.remove("drag-over", "drag-active");
  });

  // 点击导入图标唤起文件选择
  if (searchIconBox && filePickerInput) {
    searchIconBox.addEventListener("click", (e) => {
      e.preventDefault();
      filePickerInput.value = "";
      filePickerInput.click();
    });

    searchIconBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        filePickerInput.value = "";
        filePickerInput.click();
      }
    });

    filePickerInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        const paths = files.map((f) => f.path || f.name);
        addAttachedFiles(paths);
      }
    });
  }

  api.getFileCategoryIcon = getFileCategoryIcon;
  api.clearAttachedFiles = clearAttachedFiles;
}
