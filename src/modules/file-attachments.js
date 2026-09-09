import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { bus } from "../lib/event-bus.js";
import { invokeTauri, listenTauri } from "../services/tauri-bridge.js";
import { bindAll } from "../lib/el-binder.js";
import { VIEW_SETTINGS } from "../lib/view-constants.js";

// ==========================================================================
// 阶段 7 批次 D：纯函数显式化（原 ctx.api 函数槽清退为显式 import）
// 附件类别 → 手绘 SVG 图标映射（file-attachments 胶囊与 Flow 轮次附件 chip 共用）
// ==========================================================================
export const getFileCategoryIcon = (category) => {
  if (category === "folder" || category === "directory") return ICONS.folder;
  if (category === "image") return ICONS.image;
  if (category === "code") return ICONS.code;
  return ICONS.document;
};

/**
 * 文件拖入、概述胶囊与多模态路径注入
 */
export function initFileAttachments(ctx) {
  const api = ctx.api;
  const viewStore = ctx.viewStore;
  const attachmentsStore = ctx.attachmentsStore;
  // 批次 B：模块自绑定（searchInput / searchForm 为跨簇共享 id，bindAll 同 id 同元素）
  const el = bindAll({
    searchInputWrapper: "search-input-wrapper",
    searchInput: "search-input",
    attachedCapsulesContainer: "attached-capsules-container",
    searchIconBox: "search-icon-box",
    filePickerInput: "file-picker-input",
    searchForm: "search-form",
  });
  const searchInputWrapper = el.searchInputWrapper;
  const searchInput = el.searchInput;
  const attachedCapsulesContainer = el.attachedCapsulesContainer;
  const searchIconBox = el.searchIconBox;
  const filePickerInput = el.filePickerInput;
  const searchForm = el.searchForm;

  // ==========================================================================
  // 输入框文件拖入、手绘概述胶囊与多模态文件注入引擎
  // ==========================================================================

  const renderAttachedCapsules = () => {
    if (!attachedCapsulesContainer) return;
    attachedCapsulesContainer.innerHTML = "";

    if (attachmentsStore.files.length === 0) {
      searchInputWrapper?.classList.remove("has-capsules");
      api.updateInputState();
      return;
    }

    searchInputWrapper?.classList.add("has-capsules");

    attachmentsStore.files.forEach((file, index) => {
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
      bus.emit("ui:toast", { text: "未检测到支持解析的文件或目录", duration: 2000 });
      return;
    }

    let addedCount = 0;
    const newItems = [];
    for (const fileMeta of inspectedList) {
      if (!fileMeta || !fileMeta.path) continue;
      if (attachmentsStore.files.some((f) => f.path === fileMeta.path)) continue;
      newItems.push(fileMeta);
    }
    addedCount = attachmentsStore.addFiles(newItems);

    if (addedCount > 0) {
      renderAttachedCapsules();
      if (addedCount === 1) {
        const item = attachmentsStore.last();
        if (item?.category === "folder" || item?.category === "directory") {
          bus.emit("ui:toast", { text: `已关联文件夹「${item.name}」`, duration: 1800 });
        } else {
          bus.emit("ui:toast", { text: `已添加文件「${item.name}」`, duration: 1800 });
        }
      } else if (addedCount > 1) {
        bus.emit("ui:toast", { text: `已添加 ${addedCount} 个关联项`, duration: 1800 });
      }
    } else if (attachmentsStore.files.length > 0) {
      bus.emit("ui:toast", { text: "所选项目已在关联列表中", duration: 1500 });
    }

    if (searchInput) searchInput.focus();
  };

  const removeAttachedFile = (index) => {
    if (index >= 0 && index < attachmentsStore.files.length) {
      attachmentsStore.removeAt(index);
      renderAttachedCapsules();
    }
  };

  const clearAttachedFiles = () => {
    attachmentsStore.clear();
    renderAttachedCapsules();
  };

  // 绑定 Tauri 文件拖拽广播事件
  listenTauri("file-drop-paths", (event) => {
    const paths = event.payload;
    if (Array.isArray(paths) && paths.length > 0) {
      addAttachedFiles(paths);
    }
    searchForm?.classList.remove("drag-over", "drag-active");
  });

  listenTauri("file-drag-enter", () => {
    searchForm?.classList.add("drag-over");
  });

  listenTauri("file-drag-leave", () => {
    searchForm?.classList.remove("drag-over", "drag-active");
  });

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

  // ==========================================================================
  // 对话框多模态剪贴板粘贴引擎（截图图片 / 系统文件与目录 / 绝对路径文本）
  // ==========================================================================

  const insertTextAtCursor = (text) => {
    if (!searchInput) return;
    const start = searchInput.selectionStart ?? searchInput.value.length;
    const end = searchInput.selectionEnd ?? searchInput.value.length;
    const val = searchInput.value;
    searchInput.value = val.substring(0, start) + text + val.substring(end);
    const newPos = start + text.length;
    searchInput.setSelectionRange(newPos, newPos);
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof api.autoResizeSearchInput === "function") {
      api.autoResizeSearchInput();
    }
  };

  const handleClipboardPaste = async (e) => {
    if (e.__piHandled) return;

    // 门禁：如果在设置页或焦点在其他输入框（非 searchInput），不予拦截
    const target = e.target;
    if (viewStore?.mode === VIEW_SETTINGS && target !== searchInput) {
      return;
    }
    if (document.querySelector(".sketch-modal-backdrop") && target !== searchInput) {
      return;
    }
    if (target && target !== searchInput) {
      const tag = target.tagName ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || target.isContentEditable) {
        return;
      }
    }

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    // 1. 优先提取截图/图片位图
    const items = clipboardData.items ? Array.from(clipboardData.items) : [];
    const imageItems = items.filter(
      (it) => it.kind === "file" && it.type && it.type.startsWith("image/")
    );

    if (imageItems.length > 0) {
      e.__piHandled = true;
      e.preventDefault();
      const savedImagePaths = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const ext = file.type === "image/jpeg" ? "jpg" : "png";
          const savedPath = await invokeTauri("pi_save_clipboard_image", {
            base64Data,
            ext,
          });
          if (savedPath) {
            savedImagePaths.push(savedPath);
          }
        } catch (err) {
          console.warn("[FileAttachments] Save pasted image error:", err);
        }
      }

      if (savedImagePaths.length > 0) {
        await addAttachedFiles(savedImagePaths);
      }
      return;
    }

    // 2. 检查系统文件/文件夹类型（在 Windows 资源管理器中复制的文件或目录）
    const types = clipboardData.types ? Array.from(clipboardData.types) : [];
    const hasFilesType = types.includes("Files") || (clipboardData.files && clipboardData.files.length > 0);

    if (hasFilesType) {
      e.__piHandled = true;
      e.preventDefault();
      let paths = [];
      try {
        const clipRes = await invokeTauri("pi_read_clipboard_files");
        if (Array.isArray(clipRes) && clipRes.length > 0) {
          paths = clipRes;
        }
      } catch (err) {
        console.warn("[FileAttachments] Read clipboard files error:", err);
      }

      // 若系统接口未读出但 clipboardData.files 有 path 属性，降级读取
      if (paths.length === 0 && clipboardData.files?.length > 0) {
        const domPaths = Array.from(clipboardData.files)
          .map((f) => f.path)
          .filter(Boolean);
        if (domPaths.length > 0) {
          paths = domPaths;
        }
      }

      if (paths.length > 0) {
        await addAttachedFiles(paths);
        return;
      }

      // 若系统接口与 DOM 均未提取到有效路径（极少见），尝试读取 plainText 恢复用户粘贴
      const text = clipboardData.getData ? clipboardData.getData("text/plain") : "";
      if (text) {
        insertTextAtCursor(text);
      }
      return;
    }

    // 3. 检查纯文本内容（是否复制了一行或多行纯本地绝对路径）
    const plainText = clipboardData.getData ? clipboardData.getData("text/plain") : "";
    if (plainText) {
      const trimmed = plainText.trim();
      const lines = trimmed
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);

      // 单行或多行（<=20行），每一行均符合 Windows 绝对路径或 UNC 路径格式
      const isCandidatePath =
        lines.length > 0 &&
        lines.length <= 20 &&
        lines.every((l) => /^([a-zA-Z]:[\\/]|\\\\)/.test(l) && !l.includes("\n") && l.length < 500);

      if (isCandidatePath) {
        // 尝试探测全部路径是否存在
        let allExist = true;
        for (const line of lines) {
          try {
            const exists = await invokeTauri("pi_path_exists", { path: line });
            if (!exists) {
              allExist = false;
              break;
            }
          } catch (_) {
            allExist = false;
            break;
          }
        }

        if (allExist) {
          // 全部路径真实存在于本地，拦截默认粘贴并添加为多模态附件
          e.__piHandled = true;
          e.preventDefault();
          await addAttachedFiles(lines);
          return;
        }
      }
    }

    // 4. 普通文本提问或代码：放行原生粘贴，并在宏任务后自适应高度与输入态
    setTimeout(() => {
      if (typeof api.autoResizeSearchInput === "function") {
        api.autoResizeSearchInput();
      }
      if (typeof api.updateInputState === "function") {
        api.updateInputState();
      }
    }, 0);
  };

  // 绑定输入框与全局粘贴事件
  if (searchInput) {
    searchInput.addEventListener("paste", handleClipboardPaste);
  }
  if (searchForm) {
    searchForm.addEventListener("paste", handleClipboardPaste);
  }
  window.addEventListener("paste", handleClipboardPaste);

  // getFileCategoryIcon 已显式化（模块顶层 export），消费方直接 import
  api.clearAttachedFiles = clearAttachedFiles;
  api.addAttachedFiles = addAttachedFiles;
}
