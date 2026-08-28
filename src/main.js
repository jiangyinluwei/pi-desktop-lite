import { piClient } from "./services/pi-client.js";
import { sessionService } from "./services/session-service.js";
import { versionService } from "./services/version-service.js";

window.addEventListener("DOMContentLoaded", () => {
  const appContainer = document.getElementById("app-container");
  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsBadge = document.getElementById("settings-badge");
  const searchForm = document.getElementById("search-form");
  const flowStage = document.getElementById("flow-stage");
  const flowScrollArea = document.getElementById("flow-scroll-area");
  const flowConversation = document.getElementById("flow-conversation");
  const flowUserText = document.getElementById("flow-user-text");
  const thinkingToggleBtn = document.getElementById("thinking-toggle-btn");
  const agentThinkingCard = document.getElementById("agent-thinking-card");
  const thinkingDuration = document.getElementById("thinking-duration");
  const thinkingTextStream = document.getElementById("thinking-text-stream");
  const toolCallsContainer = document.getElementById("tool-calls-container");
  const flowResponseContent = document.getElementById("flow-response-content");

  // 设置抽屉元素
  const settingsBackdrop = document.getElementById("settings-backdrop");
  const settingsDrawer = document.getElementById("settings-drawer");
  const drawerCloseBtn = document.getElementById("drawer-close-btn");
  const hostStatusDot = document.getElementById("host-status-dot");
  const hostStatusText = document.getElementById("host-status-text");
  const hostVersionText = document.getElementById("host-version-text");
  const btnRestartHost = document.getElementById("btn-restart-host");
  const btnCheckUpdate = document.getElementById("btn-check-update");
  const updateNotice = document.getElementById("update-notice");
  const updateMsg = document.getElementById("update-msg");
  const btnNewSession = document.getElementById("btn-new-session");
  const sessionsList = document.getElementById("sessions-list");
  const sessionCount = document.getElementById("session-count");

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

    window.dispatchEvent(new CustomEvent("pi:view-change", { detail: { mode } }));
  };

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

  // ==========================================================================
  // 设置抽屉打开与关闭交互
  // ==========================================================================
  const openSettingsDrawer = async () => {
    if (settingsBackdrop) {
      settingsBackdrop.classList.add("open");
      settingsBackdrop.setAttribute("aria-hidden", "false");
    }
    // 刷新会话列表与宿主状态
    loadSessions();
  };

  const closeSettingsDrawer = () => {
    if (settingsBackdrop && settingsBackdrop.classList.contains("open")) {
      settingsBackdrop.classList.remove("open");
      settingsBackdrop.setAttribute("aria-hidden", "true");
      return true;
    }
    return false;
  };

  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openSettingsDrawer();
    });
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeSettingsDrawer();
    });
  }

  if (settingsBackdrop) {
    settingsBackdrop.addEventListener("click", (e) => {
      if (e.target === settingsBackdrop) {
        closeSettingsDrawer();
      }
    });
  }

  // 监听托盘“设置”事件
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen("navigate-settings", () => {
      openSettingsDrawer();
    });
  }

  // ==========================================================================
  // 宿主与版本控制逻辑
  // ==========================================================================
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

  piClient.addEventListener("status-change", (e) => {
    updateHostUI(e.detail);
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
        const res = await versionService.checkUpdate();
        if (res && res.has_update) {
          if (updateNotice) updateNotice.classList.remove("hidden");
          if (updateMsg) updateMsg.textContent = `发现新版本 v${res.latest_version}！`;
          if (settingsBadge) settingsBadge.classList.add("visible");
        } else {
          if (updateNotice) updateNotice.classList.remove("hidden");
          if (updateMsg) updateMsg.textContent = `已是最新版本 (v${res?.current_version || "0.84.3"})`;
        }
      } catch (err) {
        console.error("Check update failed:", err);
      } finally {
        btnCheckUpdate.disabled = false;
      }
    });
  }

  versionService.addEventListener("update-available", (e) => {
    const info = e.detail;
    if (info && info.has_update) {
      if (settingsBadge) settingsBadge.classList.add("visible");
      if (updateNotice) updateNotice.classList.remove("hidden");
      if (updateMsg) updateMsg.textContent = `发现新版本 v${info.latest_version}！`;
    }
  });

  // ==========================================================================
  // 会话列表渲染与操作
  // ==========================================================================
  const loadSessions = async () => {
    if (!sessionsList) return;
    const list = await sessionService.listSessions();
    if (sessionCount) sessionCount.textContent = list.length.toString();

    if (list.length === 0) {
      sessionsList.innerHTML = `<div class="empty-sessions">暂无历史会话</div>`;
      return;
    }

    sessionsList.innerHTML = "";
    list.forEach((s) => {
      const item = document.createElement("div");
      item.className = "session-item";

      const formattedDate = s.modified_at
        ? new Date(s.modified_at).toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      item.innerHTML = `
        <div class="session-title-line">
          <span class="session-name" title="${escapeHtml(s.session_id)}">${escapeHtml(s.session_id.substring(0, 16))}...</span>
          <span class="session-date">${formattedDate}</span>
        </div>
        <div class="session-snippet">${escapeHtml(s.first_message || `(${s.message_count} 条消息)`)}</div>
      `;

      item.addEventListener("click", async () => {
        try {
          await sessionService.switchSession(s.file_path);
          closeSettingsDrawer();
          // 进入 Flow 模式
          setViewMode(VIEW_FLOW, true);
        } catch (err) {
          console.error("Failed to switch session:", err);
        }
      });

      sessionsList.appendChild(item);
    });
  };

  sessionService.addEventListener("sessions-change", () => {
    loadSessions();
  });

  if (btnNewSession) {
    btnNewSession.addEventListener("click", async () => {
      try {
        await sessionService.newSession();
        closeSettingsDrawer();
        setViewMode(VIEW_DETAILED, false);
      } catch (err) {
        console.error("Failed to create new session:", err);
      }
    });
  }

  // ==========================================================================
  // 窗口控制元素
  // ==========================================================================
  const btnMinimize = document.getElementById("btn-minimize");
  const btnMaximize = document.getElementById("btn-maximize");
  const btnClose = document.getElementById("btn-close");
  const titlebar = document.getElementById("titlebar");

  const invokeTauri = async (command, args = {}) => {
    if (window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke(command, args);
      } catch (error) {
        console.warn(`[Tauri] Failed to execute ${command}:`, error);
      }
    }
  };

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
      if (!e.target.closest(".titlebar-controls") && !e.target.closest(".flow-mini-brand")) {
        invokeTauri("toggle_maximize_window");
      }
    });
  }

  // ==========================================================================
  // 极简安全 Markdown 渲染器
  // ==========================================================================
  const renderMarkdown = (text) => {
    if (!text) return "";
    let html = escapeHtml(text);

    // 1. 代码块 ```lang ... ```
    html = html.replace(/```([a-zA-Z0-9_\-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code class="language-${lang}">${code}</code></pre>`;
    });

    // 2. 行内代码 `code`
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // 3. 粗体与斜体
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // 4. 引用块 >
    html = html.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");

    // 5. 列表与换行
    html = html.replace(/^- (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

    // 6. 段落换行
    html = html.replace(/\n\n+/g, "</p><p>");
    html = html.replace(/\n/g, "<br/>");

    return `<p>${html}</p>`;
  };

  // ==========================================================================
  // 流式消息与工具调用渲染中心
  // ==========================================================================
  let thinkingStartTime = 0;
  let thinkingTimerInterval = null;
  let currentThinkingText = "";
  let currentResponseText = "";
  const renderedToolCards = new Map();

  const resetStreamState = (query) => {
    if (flowUserText) flowUserText.textContent = query;
    currentThinkingText = "";
    currentResponseText = "";
    renderedToolCards.clear();

    if (thinkingTextStream) thinkingTextStream.innerHTML = "";
    if (toolCallsContainer) toolCallsContainer.innerHTML = "";
    if (flowResponseContent) {
      flowResponseContent.innerHTML = `<span class="streaming-cursor"></span>`;
    }

    if (agentThinkingCard) {
      agentThinkingCard.classList.add("open");
      if (thinkingToggleBtn) thinkingToggleBtn.setAttribute("aria-expanded", "true");
    }

    thinkingStartTime = Date.now();
    if (thinkingTimerInterval) clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = setInterval(() => {
      if (thinkingDuration) {
        const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        thinkingDuration.textContent = `思考中 (${elapsed}s)...`;
      }
    }, 100);
  };

  const finalizeStream = () => {
    if (thinkingTimerInterval) {
      clearInterval(thinkingTimerInterval);
      thinkingTimerInterval = null;
      if (thinkingDuration) {
        const finalElapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
        thinkingDuration.textContent = `已思考 ${finalElapsed} 秒`;
      }
    }
    // 移除光标
    if (flowResponseContent) {
      const cursor = flowResponseContent.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
    }
  };

  // 绑定 PiClient 流式事件
  piClient.addEventListener("thinking-delta", (e) => {
    currentThinkingText += e.detail;
    if (thinkingTextStream) {
      thinkingTextStream.textContent = currentThinkingText;
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("thinking-end", () => {
    if (thinkingDuration) {
      const elapsed = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
      thinkingDuration.textContent = `已思考 ${elapsed} 秒`;
    }
  });

  piClient.addEventListener("text-delta", (e) => {
    currentResponseText += e.detail;
    if (flowResponseContent) {
      flowResponseContent.innerHTML = renderMarkdown(currentResponseText) + `<span class="streaming-cursor"></span>`;
    }
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("tool-start", (e) => {
    const data = e.detail;
    const toolCallId = data.toolCallId;
    const toolName = data.toolName || "tool";

    const card = document.createElement("div");
    card.className = "tool-card running";
    card.id = `tool-${toolCallId}`;

    const argsStr = data.args ? JSON.stringify(data.args, null, 2) : "";

    card.innerHTML = `
      <div class="tool-header">
        <div class="tool-title-group">
          <span class="tool-icon">⚙</span>
          <span class="tool-name">${escapeHtml(toolName)}</span>
        </div>
        <span class="tool-status-badge">running</span>
      </div>
      <div class="tool-body">${escapeHtml(argsStr)}</div>
    `;

    if (toolCallsContainer) {
      toolCallsContainer.appendChild(card);
    }
    renderedToolCards.set(toolCallId, card);
    if (flowScrollArea) flowScrollArea.scrollTop = flowScrollArea.scrollHeight;
  });

  piClient.addEventListener("tool-update", (e) => {
    const data = e.detail;
    const card = renderedToolCards.get(data.toolCallId);
    if (card) {
      const body = card.querySelector(".tool-body");
      if (body && data.partialResult) {
        const text = typeof data.partialResult === "string" ? data.partialResult : JSON.stringify(data.partialResult, null, 2);
        body.textContent = text;
      }
    }
  });

  piClient.addEventListener("tool-end", (e) => {
    const data = e.detail;
    const card = renderedToolCards.get(data.toolCallId);
    if (card) {
      card.classList.remove("running");
      card.classList.add(data.isError ? "error" : "done");
      const badge = card.querySelector(".tool-status-badge");
      if (badge) {
        badge.textContent = data.isError ? "failed" : "done";
      }
      const body = card.querySelector(".tool-body");
      if (body && data.result) {
        const resText = typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2);
        body.textContent = resText;
      }
    }
  });

  piClient.addEventListener("agent-end", finalizeStream);

  /**
   * 触发用户提问并向 Pi 下发指令
   * @param {string} query
   */
  const handleFlowQuery = async (query) => {
    if (!query) return;

    resetStreamState(query);
    setViewMode(VIEW_FLOW, true);
    searchInput.value = "";
    updateClearBtn();

    try {
      await piClient.sendPrompt(query);
    } catch (err) {
      console.error("Failed to send prompt to Pi:", err);
      if (flowResponseContent) {
        flowResponseContent.innerHTML = `<p class="sketch-callout" style="border-color:#ef4444;color:#ef4444;">⚠️ <em>发送失败：${escapeHtml(err.toString())}</em></p>`;
      }
      finalizeStream();
    }
  };

  /**
   * 简单 HTML 转义防 XSS
   * @param {string} str
   * @returns {string}
   */
  const escapeHtml = (str) => {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // 表单回车提交
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
      handleFlowQuery(query);
    }
  });

  // 手绘草图快捷标签点击
  const sketchTags = document.querySelectorAll(".sketch-tag");
  sketchTags.forEach((tag) => {
    tag.addEventListener("click", () => {
      const query = tag.getAttribute("data-query");
      if (query) {
        handleFlowQuery(query);
      }
    });
  });

  // 控制清空按钮显隐
  const updateClearBtn = () => {
    if (searchInput.value.trim().length > 0) {
      clearBtn.classList.add("visible");
    } else {
      clearBtn.classList.remove("visible");
    }
  };

  searchInput.addEventListener("input", updateClearBtn);

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    updateClearBtn();
    searchInput.focus();
  });

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
    "每一个看似随意的念头，都可能是改变生活轨迹的起点",
  ];

  const PROMPT_INTERVAL_MS = 30 * 60 * 1000;
  const STORAGE_KEY_CURRENT = "pi_placeholder_current";
  const STORAGE_KEY_TIMESTAMP = "pi_placeholder_timestamp";
  const STORAGE_KEY_HISTORY = "pi_placeholder_history";

  let promptTimer = null;

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
    if (searchInput) {
      searchInput.placeholder = promptText;
    }
    try {
      localStorage.setItem(STORAGE_KEY_CURRENT, promptText);
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

  window.__piRotatePlaceholder = rotatePrompt;
  initPlaceholderRotation();

  // ==========================================================================
  // 焦点与失焦控制（点击外部空白区域主动取消输入框高亮）
  // ==========================================================================
  document.addEventListener("pointerdown", (e) => {
    if (searchForm && !searchForm.contains(e.target) && !e.target.closest(".sketch-drawer")) {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        if (currentView === VIEW_DETAILED) {
          document.activeElement.blur();
        }
      }
    }
  });

  // ==========================================================================
  // 全局右键行为规范：禁用上下文菜单，统一作为“返回上一步/回退 (Step Back)”
  // 回退层级：关闭抽屉 -> Flow (界面3, abort) -> Focus (界面2) -> Detailed (界面1) -> 失焦/清空
  // ==========================================================================
  const stepBackHandlers = [];

  const registerStepBackHandler = (handler) => {
    stepBackHandlers.push(handler);
    return () => {
      const idx = stepBackHandlers.indexOf(handler);
      if (idx !== -1) stepBackHandlers.splice(idx, 1);
    };
  };

  // 注册抽屉关闭回退
  registerStepBackHandler(() => {
    return closeSettingsDrawer();
  });

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

    // 2. Flow (界面3) -> 右键中止 Agent 并回退至 Focus (界面2)
    if (currentView === VIEW_FLOW) {
      piClient.abort();
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

    // Detailed (界面1) -> 失焦高亮输入框或清空内容
    const activeEl = document.activeElement;
    const isInputActive =
      activeEl &&
      (activeEl === searchInput ||
        ["INPUT", "TEXTAREA"].includes(activeEl.tagName) ||
        activeEl.getAttribute("contenteditable") === "true");

    if (isInputActive) {
      activeEl.blur();
      return;
    }

    if (searchInput && searchInput.value.trim().length > 0) {
      searchInput.value = "";
      updateClearBtn();
      return;
    }

    window.dispatchEvent(new CustomEvent("pi:step-back", { detail: { originalEvent: e } }));
  };

  window.__piRegisterStepBack = registerStepBackHandler;
  window.__piStepBack = handleGlobalStepBack;

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    handleGlobalStepBack(e);
  });
});
