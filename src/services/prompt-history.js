/**
 * 输入历史记录导航服务 (prompt-history.js)
 * 
 * 职责：
 * 1. 维护用户在输入框提交的 Prompt 历史栈（从旧到新）；
 * 2. 支持方向键上下（ArrowUp / ArrowDown）翻阅历史记录；
 * 3. 智能暂存用户尚未发送的临时草稿 (Draft Preservation)；
 * 4. 本地持久化与会话记忆服务 (ConversationHistoryService) 双向数据同步与去重。
 */

import { invokeTauri } from "./tauri-bridge.js";

const STORAGE_KEY_PROMPTS = "pi_prompt_history_stack";
const MAX_HISTORY_ENTRIES = 100;

export class PromptHistoryNavigator extends EventTarget {
  constructor() {
    super();
    /** @type {string[]} 历史记录，索引 0 为最早，尾部为最新 */
    this.history = [];
    /** @type {number} 当前浏览指针，this.history.length 表示处于草稿态 */
    this.currentIndex = 0;
    /** @type {string} 用户在翻阅前正在输入的草稿内容 */
    this.draft = "";
    this.isNavigating = false;

    this.loadFromStorage();
    this.loadFromNativeSessions();
  }

  /**
   * 从 LocalStorage 加载输入历史
   */
  loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PROMPTS);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          this.history = arr.filter((item) => typeof item === "string" && item.trim().length > 0);
        }
      }
    } catch (err) {
      console.warn("[PromptHistory] Failed to load history from storage:", err);
      this.history = [];
    }
    this.resetIndex();
  }

  /**
   * 持久化至 LocalStorage
   */
  saveToStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY_PROMPTS,
        JSON.stringify(this.history.slice(-MAX_HISTORY_ENTRIES))
      );
    } catch (err) {
      console.warn("[PromptHistory] Failed to save history to storage:", err);
    }
  }

  /**
   * 从 Pi 原生底层会话目录 (~/.pi/agent/sessions/*.jsonl) 深度提取并同步所有历史提问
   */
  async loadFromNativeSessions() {
    try {
      const nativePrompts = await invokeTauri("pi_get_prompt_history");
      if (Array.isArray(nativePrompts) && nativePrompts.length > 0) {
        const merged = Array.from(new Set([...this.history, ...nativePrompts]));
        this.history = merged.slice(-MAX_HISTORY_ENTRIES);
        this.saveToStorage();
        this.resetIndex();
      }
    } catch (err) {
      console.warn("[PromptHistory] Failed to load native session prompt history:", err);
    }
  }

  /**
   * 压入一条新提问
   * @param {string} text
   */
  push(text) {
    if (!text || typeof text !== "string") return;
    const clean = text.trim();
    if (!clean) return;

    // 连续相同内容不重复添加
    const last = this.history[this.history.length - 1];
    if (last !== clean) {
      this.history.push(clean);
      if (this.history.length > MAX_HISTORY_ENTRIES) {
        this.history = this.history.slice(-MAX_HISTORY_ENTRIES);
      }
      this.saveToStorage();
    }

    this.resetIndex();
  }

  /**
   * 重置指针至最新草稿区
   */
  resetIndex() {
    this.currentIndex = this.history.length;
    this.draft = "";
    this.isNavigating = false;
  }

  /**
   * 向上翻阅（获取上一条更早的历史输入）
   * @param {string} currentValue 当前输入框中的内容
   * @returns {{ value: string, changed: boolean }}
   */
  getPrevious(currentValue) {
    if (this.history.length === 0) {
      return { value: currentValue, changed: false };
    }

    // 如果刚从草稿状态开始向上翻阅，先暂存当前输入
    if (!this.isNavigating || this.currentIndex === this.history.length) {
      this.draft = typeof currentValue === "string" ? currentValue : "";
      this.isNavigating = true;
      this.currentIndex = this.history.length;
    }

    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      return {
        value: this.history[this.currentIndex],
        changed: true,
      };
    }

    // 已经在最早一条，保持在最早一条
    return {
      value: this.history[0],
      changed: false,
    };
  }

  /**
   * 向下翻阅（获取下一条较新的历史输入，或恢复草稿）
   * @param {string} currentValue 当前输入框中的内容
   * @returns {{ value: string, changed: boolean }}
   */
  getNext(currentValue) {
    if (this.history.length === 0 || !this.isNavigating) {
      return { value: currentValue, changed: false };
    }

    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex += 1;
      return {
        value: this.history[this.currentIndex],
        changed: true,
      };
    }

    if (this.currentIndex === this.history.length - 1) {
      // 翻回到草稿状态
      this.currentIndex = this.history.length;
      this.isNavigating = false;
      return {
        value: this.draft,
        changed: true,
      };
    }

    // 已经在草稿状态
    return {
      value: this.draft,
      changed: false,
    };
  }

  /**
   * 当前是否有可翻阅的历史
   * @returns {boolean}
   */
  hasHistory() {
    return this.history.length > 0;
  }

  /**
   * 获取所有历史提问列表
   * @returns {string[]}
   */
  getHistoryList() {
    return [...this.history];
  }
}

export const promptHistoryNavigator = new PromptHistoryNavigator();
