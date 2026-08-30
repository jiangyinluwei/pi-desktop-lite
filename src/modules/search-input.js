import { VIEW_DETAILED } from "../lib/view-constants.js";
import { configService } from "../services/config-service.js";
import { promptHistoryNavigator } from "../services/prompt-history.js";
import { enhanceAllSelects } from "../services/sketch-select.js";
import { startFloatingIcons, stopFloatingIcons } from "../services/floating-icons.js";

/**
 * 搜索输入、历史翻阅、格言跑马灯与焦点控制
 */
export function initSearchInput(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const appContainer = el.appContainer;
  const searchInputWrapper = el.searchInputWrapper;
  const searchInput = el.searchInput;
  const searchMottoLayer = el.searchMottoLayer;
  const searchMottoTrack = el.searchMottoTrack;
  const searchMottoText1 = el.searchMottoText1;
  const searchMottoText2 = el.searchMottoText2;
  const clearBtn = el.clearBtn;
  const searchForm = el.searchForm;

  const MAX_INPUT_LINES = 16;
  const INPUT_LINE_HEIGHT = 24;
  const MAX_INPUT_HEIGHT = MAX_INPUT_LINES * INPUT_LINE_HEIGHT; // 384px

  // 输入框多行内容高度自适应（换行自动增加高度，最多容纳16行，超出显示极简滚动条）
  const autoResizeSearchInput = () => {
    if (!searchInput) return;
    searchInput.style.height = "24px";
    const scrollHeight = searchInput.scrollHeight;
    const targetHeight = Math.min(Math.max(scrollHeight, 24), MAX_INPUT_HEIGHT);
    searchInput.style.height = `${targetHeight}px`;
  };

  // 控制清空按钮显隐与格言跑马灯层可见性
  const updateInputState = () => {
    if (!searchInput) return;
    const hasText = searchInput.value.length > 0;
    const hasCapsules = attachments.files.length > 0;

    if (hasText || hasCapsules) {
      clearBtn?.classList.add("visible");
    } else {
      clearBtn?.classList.remove("visible");
    }

    if (hasText) {
      searchInputWrapper?.classList.add("has-value");
    } else {
      searchInputWrapper?.classList.remove("has-value");
    }
  };

  searchInput.addEventListener("input", () => {
    updateInputState();
    autoResizeSearchInput();
  });

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    api.clearAttachedFiles();
    promptHistoryNavigator.resetIndex();
    updateInputState();
    autoResizeSearchInput();
    searchInput.focus();
  });

  const applyNavigatedValue = (val) => {
    searchInput.value = val;
    searchInput.setSelectionRange(val.length, val.length);
    updateInputState();
    autoResizeSearchInput();
  };

  searchInput.addEventListener("keydown", (e) => {
    const sendMode = configService.getSendShortcut();

    if (e.key === "Enter") {
      // 避免中文拼音输入法选词上屏时误触发
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      if (sendMode === "enter") {
        // 发送逻辑 A：Enter 发送，Ctrl+Enter / Shift+Enter 换行
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          api.submitCurrentPrompt();
        } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          const start = searchInput.selectionStart;
          const end = searchInput.selectionEnd;
          const val = searchInput.value;
          searchInput.value = val.substring(0, start) + "\n" + val.substring(end);
          searchInput.selectionStart = searchInput.selectionEnd = start + 1;
          updateInputState();
          autoResizeSearchInput();
        }
      } else {
        // 发送逻辑 B：Ctrl+Enter 发送，Enter 换行
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          api.submitCurrentPrompt();
        } else {
          // Enter 换行：textarea 原生插入换行，延时刷新高度与输入状态
          setTimeout(() => {
            updateInputState();
            autoResizeSearchInput();
          }, 0);
        }
      }
      return;
    }

    if (e.key === "Escape") {
      if (searchInput.value.length > 0 || attachments.files.length > 0) {
        searchInput.value = "";
        api.clearAttachedFiles();
        promptHistoryNavigator.resetIndex();
        updateInputState();
        autoResizeSearchInput();
      } else {
        searchInput.blur();
      }
    } else if (e.key === "ArrowUp") {
      const isCaretAtStart = searchInput.selectionStart === 0 && searchInput.selectionEnd === 0;
      const isEmpty = searchInput.value.length === 0;
      const isAllSelected = searchInput.selectionStart === 0 && searchInput.selectionEnd === searchInput.value.length;

      if (isEmpty || isCaretAtStart || isAllSelected || promptHistoryNavigator.isNavigating) {
        const res = promptHistoryNavigator.getPrevious(searchInput.value);
        if (res.changed) {
          e.preventDefault();
          applyNavigatedValue(res.value);
        }
      }
    } else if (e.key === "ArrowDown") {
      if (promptHistoryNavigator.isNavigating) {
        const res = promptHistoryNavigator.getNext(searchInput.value);
        if (res.changed) {
          e.preventDefault();
          applyNavigatedValue(res.value);
        }
      }
    }
  });

  // ==========================================================================
  // 动态输入框灵感格言轮播与从右向左自适应循环滚动引擎
  // ==========================================================================
  const SEARCH_PROMPTS = [
    "别等完美，先打个草稿",
    "一句话，也能打开一扇门",
    "让模糊的念头，变成清楚的句子",
    "先完成，再完善",
    "把问题写清楚，答案就出来一半",
    "语言的边界，就是我世界的边界",
    "我有很多想法，只是它们还没学会自己排队",
    "我书写文字，并非为了让世界了解我，而是为了让我了解我自己",
    "我的大脑里有个委员会，他们现在正在为了用哪个词而激烈辩论",
    "完美是优秀的敌人",
    "灵感就像猫，你越追它越跑；你安静坐下，它反而会自己蹭过来",
    "最深刻的思想，往往藏在最简单的词语里",
    "每一个未被说出口的想法，都是一座等待被连接的孤岛",
    "文字是思想的琥珀，封存着那一刻最真实的温度",
    "与其在脑海中演练千遍，不如在现实中笨拙地表达一次",
    "思考是灵魂的自我对话，而文字是这场对话的足迹",
    "每一个看似随意的念头，都可能是改变生活轨迹的起点",
  ];

  const PROMPT_INTERVAL_MS = 30 * 60 * 1000;
  const STORAGE_KEY_CURRENT = "pi_placeholder_current";
  const STORAGE_KEY_TIMESTAMP = "pi_placeholder_timestamp";
  const STORAGE_KEY_HISTORY = "pi_placeholder_history";

  let promptTimer = null;
  let currentPromptText = "别等完美，先打个草稿";
  let mottoMeasureCanvas = null;

  /**
   * 精确测量格言文本在当前输入框字体环境下的实际渲染像素宽度
   * @param {string} text
   * @returns {number}
   */
  const measureMottoTextWidth = (text) => {
    if (!text) return 0;
    try {
      if (!mottoMeasureCanvas) {
        mottoMeasureCanvas = document.createElement("canvas");
      }
      const ctx = mottoMeasureCanvas.getContext("2d");
      if (ctx && searchInput) {
        const computed = window.getComputedStyle(searchInput);
        const fontStyle = computed.fontStyle || "normal";
        const fontWeight = computed.fontWeight || "400";
        const fontSize = computed.fontSize || "15.5px";
        const fontFamily = computed.fontFamily || "inherit";
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
        const metrics = ctx.measureText(text);
        return Math.ceil(metrics.width);
      }
    } catch (e) {
      console.warn("[Placeholder Marquee] Text measurement fallback:", e);
    }
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      width += text.charCodeAt(i) > 255 ? 16 : 9;
    }
    return width;
  };

  /**
   * 检查格言文本是否超出输入框宽度，超出则启用从右向左平滑无缝跑马灯
   */
  const checkAndUpdateMottoMarquee = () => {
    if (!searchInputWrapper || !searchMottoLayer || !searchMottoTrack || !searchMottoText1) {
      return;
    }

    const containerWidth = searchInputWrapper.clientWidth;
    if (containerWidth <= 0) return;

    const textWidth = measureMottoTextWidth(currentPromptText);
    const MARQUEE_GAP = 48; // 循环副本间距 (px)
    const MARQUEE_SPEED = 28; // 跑马灯恒定线速度 (px/s)

    // 留 6px 容差防微小亚像素舍入
    if (textWidth > containerWidth - 6) {
      const cycleDistance = textWidth + MARQUEE_GAP;
      const duration = Math.max(6, Math.round((cycleDistance / MARQUEE_SPEED) * 10) / 10);

      searchMottoTrack.style.setProperty("--motto-duration", `${duration}s`);
      searchMottoLayer.classList.add("is-scrolling");
      searchMottoTrack.classList.add("animating");
    } else {
      searchMottoLayer.classList.remove("is-scrolling");
      searchMottoTrack.classList.remove("animating");
      searchMottoTrack.style.removeProperty("--motto-duration");
    }
  };

  const getPromptHistory = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("[Placeholder] Failed to read history:", e);
    }
    return [];
  };

  const savePromptHistory = (history) => {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch (e) {
      console.warn("[Placeholder] Failed to save history:", e);
    }
  };

  const pickNextPrompt = () => {
    const cooldownCount = Math.floor(SEARCH_PROMPTS.length / 2);
    let history = getPromptHistory();

    let candidates = SEARCH_PROMPTS.filter((p) => !history.includes(p));

    if (candidates.length === 0) {
      const lastPicked = history[history.length - 1];
      candidates = SEARCH_PROMPTS.filter((p) => p !== lastPicked);
      if (candidates.length === 0) candidates = SEARCH_PROMPTS;
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    const chosenPrompt = candidates[randomIndex];

    history.push(chosenPrompt);

    while (history.length > cooldownCount) {
      history.shift();
    }

    savePromptHistory(history);
    return chosenPrompt;
  };

  const applyPrompt = (promptText, timestamp = Date.now()) => {
    currentPromptText = promptText || "";
    if (searchMottoText1) searchMottoText1.textContent = currentPromptText;
    if (searchMottoText2) searchMottoText2.textContent = currentPromptText;
    if (searchInput) {
      searchInput.setAttribute("aria-placeholder", currentPromptText);
    }
    checkAndUpdateMottoMarquee();
    try {
      localStorage.setItem(STORAGE_KEY_CURRENT, currentPromptText);
      localStorage.setItem(STORAGE_KEY_TIMESTAMP, timestamp.toString());
    } catch (e) {
      console.warn("[Placeholder] Failed to save prompt:", e);
    }
  };

  const rotatePrompt = () => {
    if (promptTimer) {
      clearTimeout(promptTimer);
      promptTimer = null;
    }

    const nextPrompt = pickNextPrompt();
    const now = Date.now();
    applyPrompt(nextPrompt, now);

    promptTimer = setTimeout(rotatePrompt, PROMPT_INTERVAL_MS);
  };

  const initPlaceholderRotation = () => {
    if (!searchInput) return;

    let storedCurrent = null;
    let storedTimestamp = 0;

    try {
      storedCurrent = localStorage.getItem(STORAGE_KEY_CURRENT);
      const rawTime = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
      if (rawTime) storedTimestamp = parseInt(rawTime, 10) || 0;
    } catch (e) {
      console.warn("[Placeholder] Failed to read storage:", e);
    }

    const now = Date.now();
    const elapsed = now - storedTimestamp;

    if (
      storedCurrent &&
      SEARCH_PROMPTS.includes(storedCurrent) &&
      elapsed < PROMPT_INTERVAL_MS &&
      elapsed >= 0
    ) {
      applyPrompt(storedCurrent, storedTimestamp);
      const remaining = PROMPT_INTERVAL_MS - elapsed;
      promptTimer = setTimeout(rotatePrompt, remaining);
    } else {
      rotatePrompt();
    }
  };

  // 容器尺寸响应式监听（窗口缩放、视图模式切换自适应）
  if (searchInputWrapper && typeof ResizeObserver !== "undefined") {
    const mottoResizeObserver = new ResizeObserver(() => {
      checkAndUpdateMottoMarquee();
    });
    mottoResizeObserver.observe(searchInputWrapper);
  }

  window.__piRotatePlaceholder = rotatePrompt;
  window.__piCheckMottoMarquee = checkAndUpdateMottoMarquee;
  window.__piSetMottoText = (text) => applyPrompt(text);
  initPlaceholderRotation();
  enhanceAllSelects();
  api.loadOfficialProvidersConfig();

  // 启动边框图标飘荡特效（仅在 detailed / focus 模式下活跃）
  startFloatingIcons(appContainer);

  // 视图切换时暂停/恢复飘荡特效
  window.addEventListener("pi:view-change", (e) => {
    const mode = e.detail?.mode;
    if (mode === "flow" || mode === "settings") {
      stopFloatingIcons();
    } else {
      startFloatingIcons(appContainer);
    }
  });

  // ==========================================================================
  // 焦点与失焦控制（点击外部空白区域主动取消输入框高亮）
  // ==========================================================================
  document.addEventListener("pointerdown", (e) => {
    if (
      searchForm &&
      !searchForm.contains(e.target) &&
      !e.target.closest(".settings-view-stage") &&
      !e.target.closest(".settings-btn")
    ) {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        if (view.mode === VIEW_DETAILED) {
          document.activeElement.blur();
        }
      }
    }
  });

  api.updateInputState = updateInputState;
  api.autoResizeSearchInput = autoResizeSearchInput;
}
