window.addEventListener("DOMContentLoaded", () => {
  const appContainer = document.getElementById("app-container");
  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const searchForm = document.getElementById("search-form");
  const flowStage = document.getElementById("flow-stage");
  const flowScrollArea = document.getElementById("flow-scroll-area");
  const flowUserText = document.getElementById("flow-user-text");
  const thinkingToggleBtn = document.getElementById("thinking-toggle-btn");
  const agentThinkingCard = document.getElementById("agent-thinking-card");
  const thinkingDuration = document.getElementById("thinking-duration");
  const flowResponseContent = document.getElementById("flow-response-content");

  // ==========================================================================
  // 三态界面状态机 (detailed | focus | flow)
  // ==========================================================================
  const VIEW_DETAILED = "detailed";
  const VIEW_FOCUS = "focus";
  const VIEW_FLOW = "flow";

  let currentView = VIEW_DETAILED;

  /**
   * 切换界面模式
   * @param {"detailed" | "focus" | "flow"} mode
   * @param {boolean} [shouldFocusInput=true]
   */
  const setViewMode = (mode, shouldFocusInput = true) => {
    if (![VIEW_DETAILED, VIEW_FOCUS, VIEW_FLOW].includes(mode)) return;
    currentView = mode;
    if (appContainer) {
      appContainer.setAttribute("data-view", mode);
    }

    if (shouldFocusInput && searchInput) {
      if (mode === VIEW_FOCUS || mode === VIEW_FLOW) {
        searchInput.focus();
      } else if (mode === VIEW_DETAILED) {
        searchInput.blur();
      }
    }

    // 触发视图变更事件
    window.dispatchEvent(new CustomEvent("pi:view-change", { detail: { mode } }));
  };

  // 暴露模式获取与切换接口
  window.__piGetViewMode = () => currentView;
  window.__piSetViewMode = setViewMode;

  // 单击/聚焦输入框：详细版自动切换至专注版
  if (searchInput) {
    searchInput.addEventListener("focus", () => {
      if (currentView === VIEW_DETAILED) {
        setViewMode(VIEW_FOCUS, false);
      }
    });

    searchInput.addEventListener("click", () => {
      if (currentView === VIEW_DETAILED) {
        setViewMode(VIEW_FOCUS, true);
      }
    });
  }

  // 思考过程卡片手绘折叠与展开交互
  if (thinkingToggleBtn && agentThinkingCard) {
    thinkingToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = agentThinkingCard.classList.toggle("open");
      thinkingToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // 设置按钮预留交互（暂无业务逻辑）
      console.log("[Settings] Settings button clicked.");
    });
  }

  // 窗口控制元素
  const btnMinimize = document.getElementById("btn-minimize");
  const btnMaximize = document.getElementById("btn-maximize");
  const btnClose = document.getElementById("btn-close");
  const titlebar = document.getElementById("titlebar");

  // 调用 Tauri 后端指令安全封装
  const invokeTauri = async (command, args = {}) => {
    if (window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke(command, args);
      } catch (error) {
        console.warn(`[Tauri] Failed to execute ${command}:`, error);
      }
    }
  };

  // 窗口最小化、最大化/还原、关闭控制
  if (btnMinimize) {
    btnMinimize.addEventListener("click", () => invokeTauri("minimize_window"));
  }
  if (btnMaximize) {
    btnMaximize.addEventListener("click", () => invokeTauri("toggle_maximize_window"));
  }
  if (btnClose) {
    btnClose.addEventListener("click", () => invokeTauri("close_window"));
  }

  // 标题栏双击切换最大化 / 还原
  if (titlebar) {
    titlebar.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".titlebar-controls") && !e.target.closest(".flow-mini-brand")) {
        invokeTauri("toggle_maximize_window");
      }
    });
  }

  // 控制清空按钮显隐
  const updateClearBtn = () => {
    if (searchInput.value.trim().length > 0) {
      clearBtn.classList.add("visible");
    } else {
      clearBtn.classList.remove("visible");
    }
  };

  searchInput.addEventListener("input", updateClearBtn);

  // 清空按钮事件
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    updateClearBtn();
    searchInput.focus();
  });

  // 键盘快捷键监听
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (searchInput.value.length > 0) {
        searchInput.value = "";
        updateClearBtn();
      } else {
        searchInput.blur();
      }
    }
  });

  /**
   * 触发 Flow 模式提问与渲染
   * @param {string} query
   */
  const handleFlowQuery = (query) => {
    if (!query) return;

    // 1. 更新用户问题内容
    if (flowUserText) {
      flowUserText.textContent = query;
    }

    // 2. 模拟思考时长与步骤状态
    const randomDuration = (1.2 + Math.random() * 1.2).toFixed(1);
    if (thinkingDuration) {
      thinkingDuration.textContent = `已深度思考 ${randomDuration} 秒`;
    }

    // 默认保持思考过程展开
    if (agentThinkingCard) {
      agentThinkingCard.classList.add("open");
      if (thinkingToggleBtn) thinkingToggleBtn.setAttribute("aria-expanded", "true");
    }

    // 3. 更新 Agent 回复卡片内容
    if (flowResponseContent) {
      flowResponseContent.innerHTML = `
        <p>已接收你的指令：「<strong>${escapeHtml(query)}</strong>」。</p>
        <p>Agent 已完成思维链路推演与任务分解：</p>
        <ul>
          <li><strong>意图提取</strong>：${escapeHtml(query)}</li>
          <li><strong>架构状态</strong>：已成功挂载 Flow 流式交互上下文；</li>
          <li><strong>多轮准备</strong>：输入框已拉长居于底部，可继续追加指令或修改草稿。</li>
        </ul>
        <p class="sketch-callout">💡 <em>快捷操作：鼠标右键点击任意区域可返回「专注版」，再次右键返回「详细版」。</em></p>
      `;
    }

    // 4. 切换至 Flow 模式并清空输入框
    setViewMode(VIEW_FLOW, true);
    searchInput.value = "";
    updateClearBtn();

    // 5. 滚动到底部
    if (flowScrollArea) {
      requestAnimationFrame(() => {
        flowScrollArea.scrollTop = 0;
      });
    }
  };

  /**
   * 简单 HTML 转义防 XSS
   * @param {string} str
   * @returns {string}
   */
  const escapeHtml = (str) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // 表单回车处理：进入界面 3 (Flow 界面)
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
      handleFlowQuery(query);
    }
  });

  // 手绘草图快捷标签点击事件
  const sketchTags = document.querySelectorAll(".sketch-tag");
  sketchTags.forEach((tag) => {
    tag.addEventListener("click", () => {
      const query = tag.getAttribute("data-query");
      if (query) {
        searchInput.value = query;
        updateClearBtn();
        handleFlowQuery(query);
      }
    });
  });

  // ==========================================================================
  // 动态输入框灵感提示词轮播（30分钟周期，Math.floor(N/2) 冷却队列机制）
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
    "每一个看似随意的念头，都可能是改变生活轨迹的起点"
  ];

  const PROMPT_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟刷新周期
  const STORAGE_KEY_CURRENT = "pi_placeholder_current";
  const STORAGE_KEY_TIMESTAMP = "pi_placeholder_timestamp";
  const STORAGE_KEY_HISTORY = "pi_placeholder_history";

  let promptTimer = null;

  /**
   * 获取最近被选中的历史队列（用于冷却排重）
   * @returns {string[]}
   */
  const getPromptHistory = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("[Placeholder] Failed to read history from localStorage:", e);
    }
    return [];
  };

  /**
   * 保存历史队列
   * @param {string[]} history
   */
  const savePromptHistory = (history) => {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch (e) {
      console.warn("[Placeholder] Failed to save history to localStorage:", e);
    }
  };

  /**
   * 按照“选中文本后接下来的 Math.floor(N/2) 次随机均不命中”算法抽取下一个随机提示语
   * @returns {string}
   */
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

  /**
   * 应用提示词到输入框并持久化状态
   * @param {string} promptText
   * @param {number} timestamp
   */
  const applyPrompt = (promptText, timestamp = Date.now()) => {
    if (searchInput) {
      searchInput.placeholder = promptText;
    }
    try {
      localStorage.setItem(STORAGE_KEY_CURRENT, promptText);
      localStorage.setItem(STORAGE_KEY_TIMESTAMP, timestamp.toString());
    } catch (e) {
      console.warn("[Placeholder] Failed to save current prompt to localStorage:", e);
    }
  };

  /**
   * 执行提示词轮换并安排下一次轮换定时器
   */
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

  /**
   * 初始化提示词轮播系统（支持应用重启后的时间跨度续接与状态恢复）
   */
  const initPlaceholderRotation = () => {
    if (!searchInput) return;

    let storedCurrent = null;
    let storedTimestamp = 0;

    try {
      storedCurrent = localStorage.getItem(STORAGE_KEY_CURRENT);
      const rawTime = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
      if (rawTime) storedTimestamp = parseInt(rawTime, 10) || 0;
    } catch (e) {
      console.warn("[Placeholder] Failed to read storage on init:", e);
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

  window.__piRotatePlaceholder = rotatePrompt;
  initPlaceholderRotation();

  // ==========================================================================
  // 焦点与失焦控制（点击外部空白区域主动取消输入框高亮）
  // ==========================================================================
  document.addEventListener("pointerdown", (e) => {
    // 若点击区域在搜索框外部
    if (searchForm && !searchForm.contains(e.target)) {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        // 在 detailed 模式下点击外部失焦
        if (currentView === VIEW_DETAILED) {
          document.activeElement.blur();
        }
      }
    }
  });

  // ==========================================================================
  // 全局右键行为规范：禁用上下文菜单，统一作为“返回上一步/回退 (Step Back)”
  // 回退层级：Flow (界面3) -> Focus (界面2) -> Detailed (界面1) -> 失焦/清空
  // ==========================================================================
  const stepBackHandlers = [];

  /**
   * 注册业务回退钩子（供后续视图、模态框、抽屉组件使用）
   * @param {Function} handler 返回 true 表示已消费回退事件
   * @returns {Function} 解绑函数
   */
  const registerStepBackHandler = (handler) => {
    stepBackHandlers.push(handler);
    return () => {
      const idx = stepBackHandlers.indexOf(handler);
      if (idx !== -1) stepBackHandlers.splice(idx, 1);
    };
  };

  /**
   * 全局回退处理器（右键/回退动作分发中心）
   */
  const handleGlobalStepBack = (e) => {
    // 1. 逆序执行已注册的外部业务层回退钩子
    for (let i = stepBackHandlers.length - 1; i >= 0; i--) {
      try {
        const handled = stepBackHandlers[i](e);
        if (handled) return;
      } catch (err) {
        console.error("[StepBack] Error in handler:", err);
      }
    }

    // 2. 核心界面三态回退流水线
    // Flow (界面3) -> 右键回退至 Focus (界面2)
    if (currentView === VIEW_FLOW) {
      setViewMode(VIEW_FOCUS, true);
      return;
    }

    // Focus (界面2) -> 右键回退至 Detailed (界面1) 并失焦
    if (currentView === VIEW_FOCUS) {
      setViewMode(VIEW_DETAILED, false);
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
      return;
    }

    // Detailed (界面1) ->
    // 2.1 若当前有输入框获得焦点，优先失焦并清除高亮
    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl === searchInput ||
      ["INPUT", "TEXTAREA"].includes(activeEl.tagName) ||
      activeEl.getAttribute("contenteditable") === "true"
    );

    if (isInputActive) {
      activeEl.blur();
      return;
    }

    // 2.2 若输入框有文本内容，清空输入框
    if (searchInput && searchInput.value.trim().length > 0) {
      searchInput.value = "";
      updateClearBtn();
      return;
    }

    // 3. 派发全局自定义事件
    window.dispatchEvent(new CustomEvent("pi:step-back", { detail: { originalEvent: e } }));
  };

  // 挂载至全局接口
  window.__piRegisterStepBack = registerStepBackHandler;
  window.__piStepBack = handleGlobalStepBack;

  // 拦截全局右键菜单事件并触发 Step-Back 回退
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    handleGlobalStepBack(e);
  });
});
