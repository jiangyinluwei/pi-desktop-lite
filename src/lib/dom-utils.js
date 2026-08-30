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
