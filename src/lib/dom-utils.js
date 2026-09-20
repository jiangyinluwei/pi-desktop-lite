/**
 * DOM 字符串安全工具集
 */

/**
 * 简单 HTML 转义防 XSS
 * @param {string} str
 * @returns {string}
 */
export const escapeHtml = (str) => {
  if (str === null || str === undefined) return "";
  return String(str)
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

  // 1. 剥离所有已知与通用的注入信封（支持标签属性与未闭合兜底）
  clean = clean.replace(/<runtime_context_rules(?:\s[^>]*)?>[\s\S]*?<\/runtime_context_rules>/gi, "");
  clean = clean.replace(/<runtime_inner_skills(?:\s[^>]*)?>[\s\S]*?<\/runtime_inner_skills>/gi, "");
  clean = clean.replace(/<runtime_inner_skill(?:\s[^>]*)?>[\s\S]*?<\/runtime_inner_skill>/gi, "");
  clean = clean.replace(/<code_area_routing_context(?:\s[^>]*)?>[\s\S]*?<\/code_area_routing_context>/gi, "");
  clean = clean.replace(/<routed_agents_md(?:\s[^>]*)?>[\s\S]*?<\/routed_agents_md>/gi, "");
  clean = clean.replace(/<routed_readme_md(?:\s[^>]*)?>[\s\S]*?<\/routed_readme_md>/gi, "");
  clean = clean.replace(/<routed_project_skills(?:\s[^>]*)?>[\s\S]*?<\/routed_project_skills>/gi, "");
  clean = clean.replace(/<routed_skill(?:\s[^>]*)?>[\s\S]*?<\/routed_skill>/gi, "");
  clean = clean.replace(/<workspace_context(?:\s[^>]*)?>[\s\S]*?<\/workspace_context>/gi, "");
  clean = clean.replace(/<runtime_rules(?:\s[^>]*)?>[\s\S]*?<\/runtime_rules>/gi, "");
  clean = clean.replace(/<inner_skills_context(?:\s[^>]*)?>[\s\S]*?<\/inner_skills_context>/gi, "");
  clean = clean.replace(/<inner_skill_rules(?:\s[^>]*)?>[\s\S]*?<\/inner_skill_rules>/gi, "");
  clean = clean.replace(/<prompt_context(?:\s[^>]*)?>[\s\S]*?<\/prompt_context>/gi, "");
  clean = clean.replace(/<image_routing_handover(?:\s[^>]*)?>[\s\S]*?<\/image_routing_handover>/gi, "");
  clean = clean.replace(/<([a-zA-Z0-9_-]*(?:context|rules|skill|routing)[a-zA-Z0-9_-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, "");
  clean = clean.replace(/<(?:runtime_context_rules|runtime_inner_skills|runtime_inner_skill|code_area_routing_context|routed_agents_md|routed_readme_md|routed_project_skills|routed_skill|workspace_context|runtime_rules|inner_skills_context|inner_skill_rules|prompt_context|image_routing_handover)(?:\s[^>]*)?>[\s\S]*$/gi, "");

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

/**
 * 净化阶段性输出 (Point 卡) 文本：
 * 剥离模型意外漏入正文的工具调用代码块、模拟执行标签与引导提示语，
 * 确保 Point 卡仅展示纯粹的人类自然语言阶段性说明，杜绝工具命令与伪造输出污染。
 * 若净化后无实质内容，返回空字符串以触发空卡自愈移除。
 * @param {string} text
 * @returns {string}
 */
export const cleanPhaseOutputText = (text) => {
  if (!text || typeof text !== "string") return "";
  let clean = text;

  // 1. 剥离模型输出的 Markdown 命令行代码块 (```bash ... ``` 等，含尾随 -exec 标识)
  clean = clean.replace(/```(?:bash|sh|powershell|cmd|terminal|json)?\s*\n[\s\S]*?\n```(?:\s*-exec[^\n]*)?/gi, "");

  // 2. 剥离模型模拟标签或内置工具调用外壳 (<bash>...</bash>, <invoke>...</invoke>, <acp...>...</acp>, <string>...</string> 等)
  clean = clean.replace(/<(?:bash|invoke|call|acp|dsml|string|m[0-9]+)(?:\s[^>]*)?>[\s\S]*?<\/(?:bash|invoke|call|acp|dsml|string|m[0-9]+)>/gi, "");
  clean = clean.replace(/<(?:bash|invoke|call|acp|dsml|string|m[0-9]+)(?:\s[^>]*)?>/gi, "");
  clean = clean.replace(/<\/(?:bash|invoke|call|acp|dsml|string|m[0-9]+)>/gi, "");

  // 3. 剥离伪造执行引导语、自我道歉与模拟语句
  clean = clean.replace(/\*\*很抱歉——我在没有调用工具的情况下模拟了输出[^\n]*\*\*/gi, "");
  clean = clean.replace(/(?:我需要实际调用工具而不是在文本中假装执行[^\n]*\n*)+/gi, "");
  clean = clean.replace(/(?:下面实际执行代码探查[^\n]*\n*)+/gi, "");
  clean = clean.replace(/(?:现在实际执行探查[^\n]*\n*)+/gi, "");
  clean = clean.replace(/(?:我现在真正运行这些命令来探查代码[^\n]*\n*)+/gi, "");
  clean = clean.replace(/📌\s*正在执行命令[^\n]*/gi, "");
  clean = clean.replace(/-exec\s+bash[^\n]*/gi, "");
  clean = clean.replace(/(?:<br>|\n)*\*\*Tool Results\*\*[\s\S]*$/gi, "");
  clean = clean.replace(/让我(?:实际|真正)?(?:运行[^\n:：]{0,25}|先用[a-zA-Z\s]+工具|纠正[^\n:：]{0,25})[^\n]*/gi, "");
  clean = clean.replace(/现在正式开始[^\n]*/gi, "");
  clean = clean.replace(/下面(?:实际)?执行[^\n]*/gi, "");
  clean = clean.replace(/更正——以实际命令输出为准[^\n]*/gi, "");

  // 4. 清理残余的多余连续空行与首尾空白
  clean = clean.replace(/\n{3,}/g, "\n\n").trim();

  // 若剩余内容仅为无意义的标点符号或前缀引导语，视为空
  if (/^(?:让我(?:实际|真正)?(?:运行[^\n:：]{0,20}|先用[a-zA-Z\s]+工具)?|现在正式开始|下面(?:实际)?执行[：:]?|[：:]\s*|\s*)+$/i.test(clean)) {
    return "";
  }

  return clean;
};

