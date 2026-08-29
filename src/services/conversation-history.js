/**
 * 对话历史与业务记忆服务 (conversation-history.js)
 * 
 * 职责：
 * 1. 记录与沉淀 Flow 界面完成的对话快照（问题、思考链、工具调用、回答与元数据）；
 * 2. 维护按最近“浏览/点开”时间 (MRU: Most Recently Viewed) 排序的会话列表；
 * 3. 管理 UI 层的讯息隐藏（仅从界面移除，不破坏底层 Pi 会话或磁盘记忆）；
 * 4. 提供业务级标准记忆接口，预留挂载 Pi 官方/社区 Memory 扩展 (如 pi-memory / NPM 插件) 的通道。
 */

const STORAGE_KEY_HISTORY = "pi_conversation_history";
const STORAGE_KEY_HIDDEN = "pi_hidden_conversation_ids";
const MAX_STORED_CONVERSATIONS = 60;

class ConversationHistoryService extends EventTarget {
  constructor() {
    super();
    this.conversations = [];
    this.hiddenIds = new Set();
    this.memoryExtensionProvider = null;
    this.loadFromStorage();
  }

  /**
   * 从 LocalStorage 加载历史对话索引与隐藏列表
   */
  loadFromStorage() {
    try {
      const storedHidden = localStorage.getItem(STORAGE_KEY_HIDDEN);
      if (storedHidden) {
        const arr = JSON.parse(storedHidden);
        if (Array.isArray(arr)) {
          this.hiddenIds = new Set(arr);
        }
      }

      const storedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (storedHistory) {
        const list = JSON.parse(storedHistory);
        if (Array.isArray(list)) {
          this.conversations = list.map((item) => ({
            ...item,
            lastViewedAt: item.lastViewedAt || item.createdAt || Date.now(),
          }));
        }
      }
    } catch (err) {
      console.warn("[ConversationHistory] Failed to load history from storage:", err);
      this.conversations = [];
      this.hiddenIds = new Set();
    }
  }

  /**
   * 持久化保存至 LocalStorage
   */
  saveToStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY_HISTORY,
        JSON.stringify(this.conversations.slice(0, MAX_STORED_CONVERSATIONS))
      );
      localStorage.setItem(
        STORAGE_KEY_HIDDEN,
        JSON.stringify(Array.from(this.hiddenIds))
      );
    } catch (err) {
      console.warn("[ConversationHistory] Failed to save history to storage:", err);
    }
  }

  /**
   * 获取当前可见的对话讯息列表（按最近浏览时间 lastViewedAt 降序排列）
   * @returns {Array<any>}
   */
  getVisibleConversations() {
    return this.conversations
      .filter((conv) => conv && conv.id && !this.hiddenIds.has(conv.id))
      .sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));
  }

  /**
   * 记录 Flow 模式完成的一轮对话
   * @param {Object} data
   * @param {string} data.query 用户问题
   * @param {string} [data.thinkingText] 思考过程
   * @param {string} [data.responseText] 回答内容
   * @param {Array<any>} [data.toolCalls] 工具调用快照
   * @param {string} [data.thinkingDuration] 思考耗时文本
   * @param {string} [data.modelId] 模型ID
   * @param {string} [data.sessionPath] 关联的 Pi 会话文件路径
   * @returns {Object} 新增/更新的对话记录
   */
  recordConversation(data) {
    if (!data || !data.query || data.query.trim().length === 0) return null;

    const trimmedQuery = data.query.trim();
    const now = Date.now();

    // 检查是否已有完全相同提问的最新项，如果有则原地更新
    let existingIndex = this.conversations.findIndex(
      (c) => c.query === trimmedQuery && Math.abs(now - c.lastViewedAt) < 60000
    );

    let conv;
    if (existingIndex !== -1) {
      conv = this.conversations[existingIndex];
      conv.thinkingText = data.thinkingText || conv.thinkingText || "";
      conv.responseText = data.responseText || conv.responseText || "";
      conv.toolCalls = data.toolCalls || conv.toolCalls || [];
      conv.thinkingDuration = data.thinkingDuration || conv.thinkingDuration || "";
      conv.lastViewedAt = now;
      conv.modelId = data.modelId || conv.modelId;
      conv.sessionPath = data.sessionPath || conv.sessionPath;
      // 重新恢复显示（若此前被隐藏）
      this.hiddenIds.delete(conv.id);
    } else {
      conv = {
        id: `conv_${now}_${Math.random().toString(36).substring(2, 7)}`,
        title: this.generateSummaryTitle(trimmedQuery),
        query: trimmedQuery,
        thinkingText: data.thinkingText || "",
        responseText: data.responseText || "",
        toolCalls: data.toolCalls || [],
        thinkingDuration: data.thinkingDuration || "",
        modelId: data.modelId || "",
        sessionPath: data.sessionPath || "",
        createdAt: now,
        lastViewedAt: now,
      };
      this.conversations.unshift(conv);
    }

    // 限制最大缓存量
    if (this.conversations.length > MAX_STORED_CONVERSATIONS) {
      this.conversations = this.conversations.slice(0, MAX_STORED_CONVERSATIONS);
    }

    this.saveToStorage();
    this.dispatchEvent(new CustomEvent("conversations-change", { detail: this.getVisibleConversations() }));

    // 触发可选挂载的外部 Pi 记忆扩展
    if (this.memoryExtensionProvider && typeof this.memoryExtensionProvider.onRecord === "function") {
      try {
        this.memoryExtensionProvider.onRecord(conv);
      } catch (err) {
        console.warn("[ConversationHistory] Memory extension hook failed:", err);
      }
    }

    return conv;
  }

  /**
   * 刷新对话的最近浏览时间（MRU），使其跃升至列表首位
   * @param {string} id
   */
  touchConversation(id) {
    if (!id) return;
    const conv = this.conversations.find((c) => c.id === id);
    if (conv) {
      conv.lastViewedAt = Date.now();
      this.hiddenIds.delete(id);
      this.saveToStorage();
      this.dispatchEvent(new CustomEvent("conversations-change", { detail: this.getVisibleConversations() }));
    }
  }

  /**
   * 隐藏指定讯息（仅在 UI 列表中隐藏，不删除底层持久化数据）
   * @param {string} id
   */
  hideConversation(id) {
    if (!id) return;
    this.hiddenIds.add(id);
    this.saveToStorage();
    this.dispatchEvent(new CustomEvent("conversations-change", { detail: this.getVisibleConversations() }));
  }

  /**
   * 恢复所有已隐藏的讯息方框
   */
  unhideAll() {
    this.hiddenIds.clear();
    this.saveToStorage();
    this.dispatchEvent(new CustomEvent("conversations-change", { detail: this.getVisibleConversations() }));
  }

  /**
   * 根据 ID 获取完整对话对象
   * @param {string} id
   * @returns {Object|null}
   */
  getConversationById(id) {
    return this.conversations.find((c) => c.id === id) || null;
  }

  /**
   * 提炼用户问题的简短显示标题
   * @param {string} query
   * @returns {string}
   */
  generateSummaryTitle(query) {
    if (!query) return "新对话";
    // 移除多余换行与空格
    const clean = query.replace(/[\r\n\t]+/g, " ").trim();
    if (clean.length <= 22) return clean;
    return `${clean.substring(0, 20)}...`;
  }

  /**
   * 挂载第三方或 Pi 官方 Memory 扩展组件接口 (Pluggable Memory Provider)
   * 满足："可以先写好业务接口，挂载可行的Pi-memory组件后就可以正常调用"
   * @param {{ name: string, onRecord?: Function, onRecall?: Function, onSearch?: Function }} provider
   */
  mountMemoryExtension(provider) {
    if (!provider) return;
    this.memoryExtensionProvider = provider;
    console.info(`[ConversationHistory] Mounted Memory Extension Provider: ${provider.name || "custom-memory"}`);
    this.dispatchEvent(new CustomEvent("memory-provider-mounted", { detail: provider }));
  }

  /**
   * 查询关联记忆（优先调用挂载的 Memory 扩展，降级到本地会话匹配）
   * @param {string} query
   * @returns {Promise<Array<any>>}
   */
  async recallMemories(query) {
    if (this.memoryExtensionProvider && typeof this.memoryExtensionProvider.onRecall === "function") {
      try {
        return await this.memoryExtensionProvider.onRecall(query);
      } catch (e) {
        console.warn("[ConversationHistory] Memory provider recall failed:", e);
      }
    }
    // 本地轻量关键字检索降级
    if (!query) return this.getVisibleConversations().slice(0, 5);
    const qLower = query.toLowerCase();
    return this.conversations
      .filter((c) => c.query?.toLowerCase().includes(qLower) || c.responseText?.toLowerCase().includes(qLower))
      .slice(0, 5);
  }
}

export const conversationHistoryService = new ConversationHistoryService();
