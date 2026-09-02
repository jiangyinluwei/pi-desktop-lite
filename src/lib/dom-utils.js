/**
 * DOM 字符串安全工具集
 */

/**
 * 简单 HTML 转义防 XSS
 * @param {string} str
 * @returns {string}
 */
export const escapeHtml = (str) => {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * CSS 属性选择器值转义
 * @param {string} str
 * @returns {string}
 */
export const escapeCss = (str) => {
  if (typeof str !== "string") return "";
  return str.replace(/["'\\]/g, "\\$&");
};

/**
 * 净化用户提问内容：剥离运行态注入的上下文信封（如 <runtime_context_rules>、<code_area_routing_context> 等）
 * 以及附带文件绝对路径尾注与引导提示语，确保历史恢复与界面展示始终为用户原始真实提问。
 * @param {string} text
 * @returns {string}
 */
export const cleanUserPrompt = (text) => {
  if (!text || typeof text !== "string") return "";
  let clean = text;

  // 1. 剥离所有已知与通用的注入信封（如 <runtime_context_rules>...</runtime_context_rules>、<code_area_routing_context>...</code_area_routing_context>）
  clean = clean.replace(/<runtime_context_rules>[\s\S]*?<\/runtime_context_rules>/gi, "");
  clean = clean.replace(/<code_area_routing_context>[\s\S]*?<\/code_area_routing_context>/gi, "");
  clean = clean.replace(/<[a-zA-Z0-9_-]*(?:context|rules)[a-zA-Z0-9_-]*>[\s\S]*?<\/[a-zA-Z0-9_-]*(?:context|rules)[a-zA-Z0-9_-]*>/gi, "");

  // 2. 查找并截断附带本地文件路径尾注
  const attachmentMarkers = [
    "[附带本地文件/目录绝对路径]:",
    "[附带本地文件绝对路径]:",
    "[附带本地目录绝对路径]:",
    "[附带本地文件路径]:",
    "[附带本地目录路径]:",
    "[附带文件绝对路径]:",
    "[附带文件路径]:",
  ];

  let earliestPos = -1;
  for (const marker of attachmentMarkers) {
    const idx = clean.indexOf(marker);
    if (idx !== -1) {
      if (earliestPos === -1 || idx < earliestPos) {
        earliestPos = idx;
      }
    }
  }

  if (earliestPos !== -1) {
    clean = clean.substring(0, earliestPos);
  }

  // 3. 剥离末尾可能残留的目录引导语
  clean = clean.replace(/（提示：附带项目中包含本地目录[\s\S]*?）/g, "");
  clean = clean.replace(/\(提示：附带项目中包含本地目录[\s\S]*?\)/g, "");

  clean = clean.trim();

  // 4. 若为无字输入纯附件时的系统默认占位前缀，还原为空字符串
  if (
    clean === "请查阅并分析以下本地文件/目录：" ||
    clean === "请查阅并分析以下本地文件/目录:" ||
    clean === "请查阅并分析以下本地文件：" ||
    clean === "请查阅并分析以下本地文件:" ||
    clean === "请查阅并分析以下本地目录：" ||
    clean === "请查阅并分析以下本地目录:"
  ) {
    clean = "";
  }

  return clean;
};

