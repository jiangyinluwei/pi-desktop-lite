/**
 * 对话历史与业务记忆服务 (conversation-history.js)
 * 
 * 职责：
 * 1. 记录与沉淀 Flow 界面完成的对话快照（问题、思考链、工具调用、回答与元数据）；
 * 2. 维护按最近“浏览/点开”时间 (MRU: Most Recently Viewed) 排序的会话列表；
 * 3. 管理 UI 层的讯息隐藏（仅从界面移除，不破坏底层 Pi 会话或磁盘记忆）；
 * 4. 提供业务级标准记忆接口，预留挂载 Pi 官方/社区 Memory 扩展 (如 pi-memory / NPM 插件) 的通道；
 * 5. 持久化尺寸预算与优雅降级（Persistence Budget & Graceful Degradation）：
 *    Chromium localStorage 每源硬配额约 10MiB（值以 UTF-16 落盘，实测 2 字节/字符）。历史记录
 *    含工具卡片 HTML 快照（toolCalls[].html）与步骤/结果快照（steps[]），单个工具密集会话可达
 *    数 MB；一旦总序列化体积超配额，`setItem` 会抛 QuotaExceededError 且被 try/catch 吞掉，
 *    表现为「新会话界面内可见、重启后永久消失」。因此写入前主动预算控制并自最旧会话起降级，
 *    保证最新一条记录永远优先完整落盘。
 * 6. 30 天未打开自动归档清除（Archive & Evict Stale Conversations）：最后一次打开时间
 *    （lastViewedAt）距今超过 30 天的会话快照，在启动加载与每次持久化时自动从内存与
 *    localStorage 归档清除（仅清理 UI 层快照，绝不触碰 ~/.pi 底层 Pi 会话 JSONL 文件）。
 */

import { cleanUserPrompt } from "../lib/dom-utils.js";

const STORAGE_KEY_HISTORY = "pi_conversation_history";
const STORAGE_KEY_HIDDEN = "pi_hidden_conversation_ids";
const MAX_STORED_CONVERSATIONS = 60;

// —— 30 天未打开自动归档清除（Archive & Evict Stale Conversations）——
// 最后一次打开（lastViewedAt）距今超过该天数的会话快照，在启动加载与每次持久化时
// 自动从内存与 localStorage 归档清除（仅清理 UI 层快照，绝不触碰 ~/.pi 底层会话 JSONL）。
const ARCHIVE_RETENTION_DAYS = 30;
const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// —— 持久化尺寸预算（防御 localStorage 静默 QuotaExceeded 丢失）——
// 全列表序列化字符预算：×2 字节 (UTF-16) ≈ 8MB 落盘，为其他 key（遥测/输入历史等）留出配额余量；
const MAX_STORAGE_BUDGET_CHARS = 4_000_000;
// 单条会话序列化字符上限：×2 ≈ 3MB，防止单个工具密集会话独自撑爆预算；
const MAX_CONVERSATION_CHARS = 1_500_000;
// 逐轮回答文本保底截断上限（超出仅保头部，真实回答通常远小于该值）；
const MAX_RESPONSE_TEXT_CHARS = 120_000;
const STORAGE_TRUNCATION_MARKER = "…[内容过长已截断]";

/** 估算对象 JSON 序列化后的字符长度（循环引用等异常返回 0，仅用于预算核算） */
const jsonLen = (value) => {
  try {
    return JSON.stringify(value ?? "").length;
  } catch {
    return 0;
  }
};

/** 剥离单轮重载荷快照（步骤流 / 工具卡片 HTML / 思考链） */
const stripTurnHeavyFields = (turn) => {
  turn.steps = [];
  turn.toolCalls = [];
  turn.thinkingText = "";
};

/**
 * 将单条会话的序列化体积压缩至上限内（仅在该会话超限时调用）：
 * ① 自最旧的非末轮开始整体剥离重载荷；
 * ② 末轮优先从最旧条目起逐条丢弃 steps / toolCalls（保留近期工具卡完整可渲染），再清思考链；
 * ③ 仍超限则自最旧轮起截断回答文本（保头部 + 截断标记），确保提问/回答骨架永远存活。
 */
const shrinkConversationToCap = (conv, capChars) => {
  let excess = jsonLen(conv) - capChars;
  if (excess <= 0) return;
  const turns = Array.isArray(conv.turns) ? conv.turns : [];
  for (let i = 0; i < turns.length - 1 && excess > 0; i++) {
    const t = turns[i];
    excess -= jsonLen(t.steps) + jsonLen(t.toolCalls) + (t.thinkingText || "").length;
    stripTurnHeavyFields(t);
  }
  const last = turns[turns.length - 1];
  if (last && excess > 0) {
    while (excess > 0 && Array.isArray(last.steps) && last.steps.length > 0) {
      excess -= jsonLen(last.steps.shift());
    }
    while (excess > 0 && Array.isArray(last.toolCalls) && last.toolCalls.length > 0) {
      excess -= jsonLen(last.toolCalls.shift());
    }
    if (excess > 0) {
      excess -= (last.thinkingText || "").length;
      last.thinkingText = "";
    }
  }
  for (const t of turns) {
    if (excess <= 0) break;
    const text = typeof t.responseText === "string" ? t.responseText : "";
    if (text.length > MAX_RESPONSE_TEXT_CHARS) {
      excess -= text.length - MAX_RESPONSE_TEXT_CHARS;
      t.responseText = text.slice(0, MAX_RESPONSE_TEXT_CHARS) + STORAGE_TRUNCATION_MARKER;
    }
  }
};

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
          this.conversations = list.map((item) => {
            const cleanedQuery = cleanUserPrompt(item.query);
            const cleanedTurns = Array.isArray(item.turns)
              ? item.turns.map((t) => ({
                  ...t,
                  query: cleanUserPrompt(t.query),
                }))
              : item.turns;
            return {
              ...item,
              query: cleanedQuery || item.query,
              title: item.title && !item.title.includes("<") ? item.title : this.generateSummaryTitle(cleanedQuery || item.title),
              turns: cleanedTurns,
              lastViewedAt: item.lastViewedAt || item.createdAt || Date.now(),
            };
          });
          // 30 天未打开的会话快照在启动加载时自动归档清除并立即回写，
          // 保证磁盘持久化与内存一致（底层 Pi 会话文件不受影响）
          if (this.purgeArchivedConversations() > 0) {
            this.saveToStorage();
          }
        }
      }
    } catch (err) {
      console.warn("[ConversationHistory] Failed to load history from storage:", err);
      this.conversations = [];
      this.hiddenIds = new Set();
    }
  }

  /**
   * 30 天未打开自动归档清除：移除最后一次打开时间（lastViewedAt，缺省回退 createdAt）
   * 距今超过 ARCHIVE_RETENTION_DAYS 的会话快照；无任何时间戳的损坏记录不予清除（无法判定）。
   * @returns {number} 本次清除的会话数量
   */
  purgeArchivedConversations() {
    const now = Date.now();
    const before = this.conversations.length;
    this.conversations = this.conversations.filter((conv) => {
      if (!conv || typeof conv !== "object") return false;
      const lastOpened = conv.lastViewedAt || conv.createdAt || 0;
      if (!lastOpened) return true;
      return now - lastOpened <= ARCHIVE_RETENTION_MS;
    });
    if (this.conversations.length === before) return 0;
    // 同步清掉已不存在会话的隐藏标记，避免隐藏列表残留幽灵 ID
    const aliveIds = new Set(this.conversations.map((c) => c.id));
    for (const id of Array.from(this.hiddenIds)) {
      if (!aliveIds.has(id)) this.hiddenIds.delete(id);
    }
    return before - this.conversations.length;
  }

  /**
   * 持久化保存至 LocalStorage（带尺寸预算与优雅降级）
   * 0. 写入前先执行 30 天未打开自动归档清除；
   * 1. 写入前执行 trimHistoryToFit 预算瘦身；
   * 2. setItem 仍失败（如被其他 key 挤占配额）时逐级降级重试：
   *    物理丢弃最旧会话 → 极限压缩最新会话，保证最新记录永远优先落盘且绝不静默丢失。
   */
  saveToStorage() {
    this.purgeArchivedConversations();
    this.trimHistoryToFit();
    let attempt = 0;
    while (attempt < 4) {
      try {
        localStorage.setItem(
          STORAGE_KEY_HISTORY,
          JSON.stringify(this.conversations.slice(0, MAX_STORED_CONVERSATIONS))
        );
        localStorage.setItem(
          STORAGE_KEY_HIDDEN,
          JSON.stringify(Array.from(this.hiddenIds))
        );
        return;
      } catch (err) {
        attempt += 1;
        console.warn(
          `[ConversationHistory] localStorage 写入失败（降级重试 ${attempt}/4）:`,
          err?.name || err
        );
        if (this.conversations.length > 1) {
          // 仍超配额：物理丢弃最旧会话后重试（最新记录永不丢弃）
          this.conversations.pop();
        } else if (attempt < 4) {
          // 仅剩最新记录仍写不进：极限压缩后重试
          shrinkConversationToCap(
            this.conversations[0],
            Math.floor(MAX_CONVERSATION_CHARS / 2 ** attempt)
          );
        }
      }
    }
  }

  /**
   * 持久化预算瘦身：序列化总量超预算时，自最旧会话起剥离重载荷快照
   * （steps / toolCalls HTML / 思考链），仍超则物理丢弃最旧会话；
   * 最新一条记录（index 0）在两级降级中均豁免，保证本次归档永远可落盘。
   * 内存与磁盘同步裁剪，保证 restore / 重渲行为与已持久化内容一致。
   */
  trimHistoryToFit() {
    if (this.conversations.length === 0) return;
    let excess = jsonLen(this.conversations) - MAX_STORAGE_BUDGET_CHARS;
    if (excess <= 0) return;
    // 第一级：自最旧会话起剥离重载荷（index 0 最新记录豁免）
    for (let i = this.conversations.length - 1; i >= 1 && excess > 0; i--) {
      const conv = this.conversations[i];
      const turns = Array.isArray(conv.turns) ? conv.turns : [];
      for (const t of turns) {
        excess -= jsonLen(t.steps) + jsonLen(t.toolCalls) + (t.thinkingText || "").length;
        stripTurnHeavyFields(t);
      }
      // 兼容旧记录结构：顶层可能直接挂载 steps / toolCalls / thinkingText
      excess -= jsonLen(conv.steps) + jsonLen(conv.toolCalls) + (conv.thinkingText || "").length;
      stripTurnHeavyFields(conv);
    }
    // 第二级：仍超预算 → 物理丢弃最旧会话（永远保留最新一条）
    while (excess > 0 && this.conversations.length > 1) {
      excess -= jsonLen(this.conversations.pop());
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
   * 记录 Flow 模式完成的一轮或多轮对话
   * @param {Object} data
   * @param {string} [data.id] 会话唯一 ID (若已知则精准定位更新)
   * @param {string} [data.taskId] 关联的任务 ID
   * @param {string} [data.title] 会话标题摘要
   * @param {string} data.query 用户问题 (首轮提问)
   * @param {Array<any>} [data.turns] 多轮对话完整轮次快照
   * @param {string} [data.thinkingText] 思考过程
   * @param {string} [data.responseText] 回答内容
   * @param {Array<any>} [data.toolCalls] 工具调用快照
   * @param {string} [data.thinkingDuration] 思考耗时文本
   * @param {string} [data.modelId] 模型ID
   * @param {string} [data.sessionPath] 关联的 Pi 会话文件路径
   * @param {boolean} [data.isAborted] 是否已中止
   * @returns {Object} 新增/更新的对话记录
   */
  recordConversation(data) {
    if (!data) return null;
    const rawQuery = data.query || data.turns?.[0]?.query || "";
    const trimmedQuery = cleanUserPrompt(rawQuery).trim() || rawQuery.trim();
    if (!trimmedQuery && (!Array.isArray(data.turns) || data.turns.length === 0)) return null;

    const cleanedTurns = Array.isArray(data.turns)
      ? data.turns.map((t) => ({
          ...t,
          query: cleanUserPrompt(t.query),
        }))
      : undefined;

    const now = Date.now();

    // 1. 优先根据明确的 conversation id 匹配
    let existingIndex = -1;
    if (data.id) {
      existingIndex = this.conversations.findIndex((c) => c.id === data.id);
    }

    // 2. 其次根据 taskId 匹配（若该任务此前已沉淀过记录）
    if (existingIndex === -1 && data.taskId) {
      existingIndex = this.conversations.findIndex(
        (c) => (c.taskId && c.taskId === data.taskId) || c.id === data.taskId
      );
    }

    // 3. 再次根据提问内容进行回退匹配 (5分钟容差)
    if (existingIndex === -1 && trimmedQuery) {
      existingIndex = this.conversations.findIndex(
        (c) => c.query === trimmedQuery && Math.abs(now - c.lastViewedAt) < 300000
      );
    }

    let conv;
    if (existingIndex !== -1) {
      conv = this.conversations[existingIndex];
      if (data.title) conv.title = data.title;
      if (trimmedQuery) conv.query = trimmedQuery;
      conv.thinkingText = data.thinkingText || conv.thinkingText || "";
      conv.responseText = data.responseText || conv.responseText || "";
      conv.toolCalls = data.toolCalls || conv.toolCalls || [];
      conv.thinkingDuration = data.thinkingDuration || conv.thinkingDuration || "";
      conv.lastViewedAt = now;
      conv.modelId = data.modelId || conv.modelId;
      if (data.sessionPath) {
        conv.sessionPath = data.sessionPath;
      }
      if (data.sessionId) {
        conv.sessionId = data.sessionId;
      }
      if (data.taskId) {
        conv.taskId = data.taskId;
      }
      if (Array.isArray(cleanedTurns) && cleanedTurns.length > 0) {
        conv.turns = cleanedTurns;
      }
      if (typeof data.isAborted === "boolean") {
        conv.isAborted = data.isAborted;
      }
      if (Array.isArray(data.injectedItems)) {
        conv.injectedItems = data.injectedItems;
      }
      // 重新恢复显示（若此前被隐藏）
      this.hiddenIds.delete(conv.id);
    } else {
      conv = {
        id: data.id || `conv_${now}_${Math.random().toString(36).substring(2, 7)}`,
        taskId: data.taskId || undefined,
        title: data.title || this.generateSummaryTitle(trimmedQuery),
        query: trimmedQuery,
        thinkingText: data.thinkingText || "",
        responseText: data.responseText || "",
        toolCalls: data.toolCalls || [],
        thinkingDuration: data.thinkingDuration || "",
        modelId: data.modelId || "",
        sessionPath: data.sessionPath || "",
        sessionId: data.sessionId || undefined,
        isAborted: Boolean(data.isAborted),
        turns: cleanedTurns,
        injectedItems: Array.isArray(data.injectedItems) ? data.injectedItems : [],
        createdAt: now,
        lastViewedAt: now,
      };
      this.conversations.unshift(conv);
    }

    // 限制最大缓存量
    if (this.conversations.length > MAX_STORED_CONVERSATIONS) {
      this.conversations = this.conversations.slice(0, MAX_STORED_CONVERSATIONS);
    }

    // 单条会话体积硬上限：防止单个工具密集会话独自撑爆持久化预算
    shrinkConversationToCap(conv, MAX_CONVERSATION_CHARS);

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
   * 彻底删除指定会话记录（如首轮提问回退撤销时物理移除记录）
   * @param {string} idOrTaskId 会话 ID 或关联的 Task ID
   * @returns {boolean} 是否成功删除
   */
  deleteConversation(idOrTaskId) {
    if (!idOrTaskId) return false;
    const idx = this.conversations.findIndex(
      (c) => c.id === idOrTaskId || c.taskId === idOrTaskId
    );
    if (idx !== -1) {
      const removed = this.conversations.splice(idx, 1)[0];
      if (removed?.id) {
        this.hiddenIds.delete(removed.id);
      }
      this.saveToStorage();
      this.dispatchEvent(new CustomEvent("conversations-change", { detail: this.getVisibleConversations() }));
      return true;
    }
    return false;
  }

  /**
   * 同步剪枝多轮历史记录的轮次（用于多轮对话回退至第 k 轮）
   * @param {string} idOrTaskId 会话 ID 或关联的 Task ID
   * @param {number} pruneToIndex 剪枝保留的目标轮次数
   * @returns {boolean} 是否成功剪枝
   */
  pruneConversationTurns(idOrTaskId, pruneToIndex) {
    if (!idOrTaskId || typeof pruneToIndex !== "number" || pruneToIndex <= 0) return false;
    const conv = this.conversations.find((c) => c.id === idOrTaskId || c.taskId === idOrTaskId);
    if (!conv || !Array.isArray(conv.turns)) return false;

    conv.turns = conv.turns.slice(0, pruneToIndex);
    const lastTurn = conv.turns[conv.turns.length - 1];
    if (lastTurn) {
      conv.responseText = lastTurn.responseText || "";
      conv.thinkingText = lastTurn.thinkingText || "";
      conv.toolCalls = lastTurn.toolCalls || [];
      conv.steps = lastTurn.steps || [];
      // 思考耗时字段兼容：旧版记录轮次内为 thinkingDuration，现行标准为 thinkingDurationText
      // （恢复侧 renderTurnsIntoFlow 已做双名兼容读取，剪枝侧同步兼容，杜绝瘦身回写后丢失耗时展示）
      conv.thinkingDuration = lastTurn.thinkingDurationText || lastTurn.thinkingDuration || "";
      conv.isAborted = Boolean(lastTurn.isAborted);
    }
    this.saveToStorage();
    this.dispatchEvent(new CustomEvent("conversations-change", { detail: this.getVisibleConversations() }));
    return true;
  }

  /**
   * 清空全部界面展示会话记录（仅清 UI 展示层与 localStorage，
   * 绝不触碰 ~/.pi 下的 Pi 内核会话 JSONL 文件）
   */
  clearAllConversations() {
    this.conversations = [];
    this.hiddenIds.clear();
    try {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      localStorage.removeItem(STORAGE_KEY_HIDDEN);
    } catch (err) {
      console.warn("[ConversationHistory] Failed to clear storage keys:", err);
    }
    this.dispatchEvent(new CustomEvent("conversations-change", { detail: [] }));
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
    const cleaned = cleanUserPrompt(query);
    // 移除多余换行与空格
    const clean = (cleaned || query).replace(/[\r\n\t]+/g, " ").trim();
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
