import { escapeHtml } from "./dom-utils.js";
import { ICONS } from "./icons.js";

/**
 * ============================================================================
 * 高质感 Markdown 预览渲染引擎 (Typedown & Typora Inspired)
 * 特性：
 * 1. 支持全套 CommonMark + GFM 语法 (标题, 围栏代码块, 表格, 任务清单, 引用警示卡, 内联修饰, 链接)
 * 2. 代码块顶部信息栏 (手绘语言徽标 + 一键复制按钮 + 复制成功动效反馈)
 * 3. 内置主流语言轻量级语法高亮 (JS/TS, Python, Rust, Bash, JSON, HTML, CSS, SQL 等)
 * 4. GitHub 风格警示引用框 (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
 * 5. 全域 HTTP/HTTPS 超链接解析 (带手绘外部跳转微图标)
 * 6. 流式容错 (Streaming Resilience: 自动修复流式过程中未闭合代码块、表格、引用等)
 * ============================================================================
 */

// ============================================================================
// 1. 轻量级多语言语法高亮器 (Zero-dependency Syntax Tokenizer)
// ============================================================================

const KEYWORDS_COMMON = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "function",
  "if", "import", "in", "instanceof", "new", "return", "super", "switch",
  "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield",
  "let", "static", "enum", "await", "async", "def", "elif", "except", "pass",
  "raise", "with", "lambda", "global", "nonlocal", "fn", "pub", "struct",
  "impl", "trait", "mut", "use", "mod", "match", "where", "type", "select",
  "from", "where", "insert", "update", "delete", "join", "group", "by", "order"
]);

const BUILTINS = new Set([
  "true", "false", "null", "undefined", "NaN", "None", "Some", "Ok", "Err",
  "console", "window", "document", "process", "Math", "JSON", "Promise",
  "Array", "Object", "String", "Number", "Boolean", "Set", "Map", "Vec",
  "Option", "Result", "String", "str", "int", "float", "list", "dict", "tuple"
]);

/**
 * 为代码内容进行安全转义与轻量级高亮分词
 * @param {string} code 原始代码字符串
 * @param {string} lang 语言标识
 * @returns {string} 高亮后的 HTML
 */
function highlightCode(code, lang = "") {
  if (!code) return "";
  const l = (lang || "").trim().toLowerCase();

  // 针对 JSON 的轻量高亮
  if (l === "json") {
    const escaped = escapeHtml(code);
    return escaped.replace(
      /(&quot;(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*&quot;(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = "tok-num";
        if (/^&quot;/.test(match)) {
          if (/:$/.test(match)) {
            cls = "tok-key";
          } else {
            cls = "tok-str";
          }
        } else if (/true|false/.test(match)) {
          cls = "tok-bool";
        } else if (/null/.test(match)) {
          cls = "tok-null";
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  // 针对 HTML / XML 的轻量高亮
  if (l === "html" || l === "xml" || l === "svg") {
    const escaped = escapeHtml(code);
    return escaped
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-cmt">$1</span>')
      .replace(/(&lt;\/?)([a-zA-Z0-9_\-]+)([\s\S]*?)(\/?&gt;)/g, (match, open, tag, attrs, close) => {
        const highlightedAttrs = attrs.replace(
          /([a-zA-Z0-9_\-]+)(=)(&quot;.*?&quot;|&#39;.*?&#39;|[^\s&gt;]+)/g,
          '<span class="tok-attr">$1</span>$2<span class="tok-str">$3</span>'
        );
        return `${open}<span class="tok-tag">${tag}</span>${highlightedAttrs}${close}`;
      });
  }

  // 针对通用编程语言（JS/TS/Python/Rust/Bash/C/Go 等）采用分词扫描器
  const lines = code.split("\n");
  const highlightedLines = lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--")) {
      return `<span class="tok-cmt">${escapeHtml(line)}</span>`;
    }

    // 正则分词：匹配 字符串 | 注释 | 数字 | 标识符 | 其他符号 | 空白
    const tokenRegex = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|#[^\n]*|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_$][a-zA-Z0-9_$]*\b|[^\s\w"'/`#]+|\s+)/g;

    let result = "";
    let match;
    let lastIndex = 0;

    while ((match = tokenRegex.exec(line)) !== null) {
      const token = match[0];

      if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
        result += `<span class="tok-str">${escapeHtml(token)}</span>`;
      } else if (token.startsWith("//") || token.startsWith("#") || token.startsWith("--")) {
        result += `<span class="tok-cmt">${escapeHtml(token)}</span>`;
      } else if (/^\d+(?:\.\d+)?$/.test(token)) {
        result += `<span class="tok-num">${escapeHtml(token)}</span>`;
      } else if (KEYWORDS_COMMON.has(token)) {
        result += `<span class="tok-kw">${escapeHtml(token)}</span>`;
      } else if (BUILTINS.has(token)) {
        result += `<span class="tok-builtin">${escapeHtml(token)}</span>`;
      } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token)) {
        const restOfLine = line.slice(tokenRegex.lastIndex);
        if (/^\s*\(/.test(restOfLine)) {
          result += `<span class="tok-fn">${escapeHtml(token)}</span>`;
        } else {
          result += escapeHtml(token);
        }
      } else {
        result += escapeHtml(token);
      }
      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      result += escapeHtml(line.slice(lastIndex));
    }

    return result || escapeHtml(line);
  });

  return highlightedLines.join("\n");
}

// ============================================================================
// 2. 行内元素解析器 (Inline Lexer)
// ============================================================================

/**
 * 解析行内 Markdown 元素（加粗、斜体、删除线、行内代码、公式、超链接、图片等）
 * @param {string} text 已初步转义或待转义的行内文本
 * @returns {string}
 */
function parseInline(text) {
  if (!text) return "";

  // 1. 行内代码保护 `code` -> 暂存 Unicode PUA 占位符防后续规则误伤
  const codeTokens = [];
  let rendered = text.replace(/`([^`]+)`/g, (match, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
    return `\uE000CODE${idx}\uE001`;
  });

  // 2. 行内公式 $formula$ -> 暂存占位符
  const mathTokens = [];
  rendered = rendered.replace(/\$([^\$\n]+)\$/g, (match, formula) => {
    const idx = mathTokens.length;
    mathTokens.push(`<span class="md-math-inline">${escapeHtml(formula)}</span>`);
    return `\uE000MATH${idx}\uE001`;
  });

  // 3. 图片 ![alt](url) -> 暂存占位符防 URL 中的下划线/参数被误伤
  const imgTokens = [];
  rendered = rendered.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const idx = imgTokens.length;
    const safeUrl = escapeHtml(url.trim());
    const safeAlt = escapeHtml(alt.trim());
    imgTokens.push(`<img class="md-img" src="${safeUrl}" alt="${safeAlt}" loading="lazy" />`);
    return `\uE000IMG${idx}\uE001`;
  });

  // 4. 显式超链接 [text](url "title") -> 暂存占位符
  const linkTokens = [];
  const linkIconSvg = `<svg class="md-link-icon" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 8.5 V12.5 A1 1 0 0 1 10.5 13.5 H3.5 A1 1 0 0 1 2.5 12.5 V5.5 A1 1 0 0 1 3.5 4.5 H7.5" /><path d="M9.5 2.5 H13.5 V6.5" /><path d="M6.5 9.5 L13.5 2.5" /></svg>`;

  rendered = rendered.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+|mailto:[^\s\)]+)(?:\s+"([^"]*)")?\)/g, (match, txt, url, title) => {
    const idx = linkTokens.length;
    const safeUrl = escapeHtml(url.trim());
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    linkTokens.push(`<a href="${safeUrl}" class="md-link" target="_blank" rel="noopener noreferrer"${titleAttr}><span>${escapeHtml(txt)}</span>${linkIconSvg}</a>`);
    return `\uE000LINK${idx}\uE001`;
  });

  // 5. 对剩余文本执行基础 HTML 转义（保障 <stdio.h> / Map<K,V> 等非代码块中的尖括号不被吞噬或误解析为 HTML 标签）
  rendered = escapeHtml(rendered);

  // 6. 粗斜体 ***text*** / ___text___
  rendered = rendered.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  rendered = rendered.replace(/(?:^|(?<=[\s\p{P}]))___([^\s_]+|.+?[^\s_])___(?=[\s\p{P}]|$)/gu, "<strong><em>$1</em></strong>");

  // 7. 粗体 **text** / __text__
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/(?:^|(?<=[\s\p{P}]))__([^\s_]+|.+?[^\s_])__(?=[\s\p{P}]|$)/gu, "<strong>$1</strong>");

  // 8. 斜体 *text* / _text_ (避免在单词内部 snake_case_var 误触)
  rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  rendered = rendered.replace(/(?:^|(?<=[\s\p{P}]))_([^\s_]+|.+?[^\s_])_(?=[\s\p{P}]|$)/gu, "<em>$1</em>");

  // 9. 删除线 ~~text~~ 与 高亮 ==text==
  rendered = rendered.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  rendered = rendered.replace(/==([^=]+)==/g, "<mark>$1</mark>");

  // 10. 自动识别纯 URL (不在 href= 或 <a> 内部的独立网址)
  rendered = rendered.replace(
    /(https?:\/\/[a-zA-Z0-9\-_.]+(?:\/[^\s<>"'\)]*)?)/g,
    (url) => {
      return `<a href="${url}" class="md-link auto-url" target="_blank" rel="noopener noreferrer"><span>${url}</span>${linkIconSvg}</a>`;
    }
  );

  // 11. 还原公式、代码、图片与超链接占位符 (使用 split.join 彻底避免正则与单次替换缺陷)
  imgTokens.forEach((tok, i) => {
    rendered = rendered.split(`\uE000IMG${i}\uE001`).join(tok);
  });
  linkTokens.forEach((tok, i) => {
    rendered = rendered.split(`\uE000LINK${i}\uE001`).join(tok);
  });
  mathTokens.forEach((tok, i) => {
    rendered = rendered.split(`\uE000MATH${i}\uE001`).join(tok);
  });
  codeTokens.forEach((tok, i) => {
    rendered = rendered.split(`\uE000CODE${i}\uE001`).join(tok);
  });

  return rendered;
}

// ============================================================================
// 3. 块级元素解析核心 (Block Parser with Streaming Auto-Healing)
// ============================================================================

/**
 * 格式化渲染单个围栏代码块
 * @param {string} rawCode 原始代码内容
 * @param {string} lang 语言
 * @returns {string}
 */
function renderCodeBlock(rawCode, lang = "") {
  const cleanLang = (lang || "").trim();
  const displayLang = cleanLang ? cleanLang.toUpperCase() : "CODE";
  const highlighted = highlightCode(rawCode, cleanLang);

  return `
    <div class="md-code-block" data-lang="${escapeHtml(cleanLang)}">
      <div class="md-code-header">
        <span class="md-code-lang">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="5.5 5 2.5 8 5.5 11" />
            <polyline points="10.5 5 13.5 8 10.5 11" />
            <line x1="9" y1="4" x2="7" y2="12" />
          </svg>
          ${escapeHtml(displayLang)}
        </span>
        <button type="button" class="md-copy-btn" data-action="copy-code" title="复制代码" aria-label="复制代码">
          <span class="md-copy-icon">${ICONS.copy}</span>
          <span class="md-copy-text">复制</span>
        </button>
      </div>
      <pre class="md-code-pre"><code class="md-code-content language-${escapeHtml(cleanLang)}">${highlighted}</code></pre>
    </div>
  `.trim();
}

/**
 * 格式化渲染 GitHub 警示卡片 (Callout / Alert)
 * @param {string} type NOTE | TIP | IMPORTANT | WARNING | CAUTION
 * @param {string} bodyHtml
 * @returns {string}
 */
function renderCallout(type, bodyHtml) {
  const t = type.toUpperCase();
  let iconSvg = ICONS.note;
  let title = "NOTE";
  let cls = "note";

  if (t === "TIP") {
    iconSvg = ICONS.lightbulb;
    title = "TIP";
    cls = "tip";
  } else if (t === "IMPORTANT") {
    iconSvg = ICONS.important || ICONS.sparkle;
    title = "IMPORTANT";
    cls = "important";
  } else if (t === "WARNING") {
    iconSvg = ICONS.warning;
    title = "WARNING";
    cls = "warning";
  } else if (t === "CAUTION") {
    iconSvg = ICONS.caution || ICONS.stop;
    title = "CAUTION";
    cls = "caution";
  }

  return `
    <div class="md-callout md-callout-${cls}">
      <div class="md-callout-header">
        <span class="md-callout-icon">${iconSvg}</span>
        <span class="md-callout-title">${title}</span>
      </div>
      <div class="md-callout-body">${bodyHtml}</div>
    </div>
  `.trim();
}

/**
 * 智能拆分 Markdown 表格行，保护反引号内管道符与转义管道符
 * @param {string} rowText
 * @returns {Array<string>}
 */
function splitTableRow(rowText) {
  const trimmed = (rowText || "").trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let inBacktick = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\") {
      if (inner[i + 1] === "|") {
        current += "|";
        i++;
        continue;
      } else {
        current += ch;
      }
    } else if (ch === "`") {
      inBacktick = !inBacktick;
      current += ch;
    } else if (ch === "|" && !inBacktick) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 格式化渲染 GFM 规范表格
 * @param {Array<string>} headers
 * @param {Array<string>} aligns left | center | right
 * @param {Array<Array<string>>} rows
 * @returns {string}
 */
function renderTable(headers, aligns, rows) {
  let ths = "";
  headers.forEach((h, idx) => {
    const align = aligns[idx] || "left";
    ths += `<th style="text-align: ${align};">${parseInline(h)}</th>`;
  });

  let trs = "";
  rows.forEach((row) => {
    let tds = "";
    row.forEach((cell, idx) => {
      const align = aligns[idx] || "left";
      tds += `<td style="text-align: ${align};">${parseInline(cell)}</td>`;
    });
    trs += `<tr>${tds}</tr>`;
  });

  return `
    <div class="md-table-wrap">
      <table class="md-table">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  `.trim();
}

/**
 * 完整 Markdown 文本转 HTML 核心函数
 * @param {string} markdown
 * @returns {string} HTML 内容
 */
export function renderMarkdown(markdown) {
  if (!markdown || typeof markdown !== "string") return "";

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output = [];

  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines = [];

  let inBlockquote = false;
  let blockquoteLines = [];

  let inTable = false;
  let tableHeaders = [];
  let tableAligns = [];
  let tableRows = [];

  let inList = false;
  let listType = ""; // "ul" | "ol"
  let listItems = [];

  const flushBlockquote = () => {
    if (!inBlockquote || blockquoteLines.length === 0) {
      inBlockquote = false;
      blockquoteLines = [];
      return;
    }
    const fullQuote = blockquoteLines.join("\n").trim();
    // 检查是否命中 GitHub 风格警示卡片: > [!NOTE] 等
    const calloutMatch = fullQuote.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*\n)?([\s\S]*)$/i);
    if (calloutMatch) {
      const type = calloutMatch[1];
      const body = calloutMatch[2] ? renderMarkdown(calloutMatch[2]) : "";
      output.push(renderCallout(type, body));
    } else {
      output.push(`<blockquote class="md-blockquote">${renderMarkdown(fullQuote)}</blockquote>`);
    }
    inBlockquote = false;
    blockquoteLines = [];
  };

  const flushTable = () => {
    if (!inTable) return;
    if (tableHeaders.length > 0) {
      output.push(renderTable(tableHeaders, tableAligns, tableRows));
    }
    inTable = false;
    tableHeaders = [];
    tableAligns = [];
    tableRows = [];
  };

  const flushList = () => {
    if (!inList || listItems.length === 0) {
      inList = false;
      listItems = [];
      return;
    }
    const tag = listType === "ol" ? "ol" : "ul";
    const itemsHtml = listItems.map((it) => it).join("");
    output.push(`<${tag} class="md-${tag}">${itemsHtml}</${tag}>`);
    inList = false;
    listItems = [];
    listType = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ------------------------------------------------------------------------
    // 1. 围栏代码块 ``` 处理 (支持 3+ 反引号与流式自动闭合)
    // ------------------------------------------------------------------------
    const fenceMatch = trimmed.match(/^`{3,}(.*)$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        flushBlockquote();
        flushTable();
        flushList();
        inCodeBlock = true;
        const rawLang = fenceMatch[1].trim().replace(/^`+/, "").trim();
        codeBlockLang = rawLang.split(/\s+/)[0] || "";
        codeBlockLines = [];
        continue;
      } else {
        inCodeBlock = false;
        output.push(renderCodeBlock(codeBlockLines.join("\n"), codeBlockLang));
        codeBlockLines = [];
        codeBlockLang = "";
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // ------------------------------------------------------------------------
    // 2. 表格 GFM Table 处理 (保护单元格反引号管道符)
    // ------------------------------------------------------------------------
    const isTableRow = trimmed.startsWith("|") && trimmed.endsWith("|");
    if (isTableRow) {
      flushBlockquote();
      flushList();

      const cells = splitTableRow(trimmed);

      // 检查下一行是否是分隔行 |:---|:---:|---:|
      if (!inTable) {
        const nextLine = (lines[i + 1] || "").trim();
        if (nextLine.startsWith("|") && nextLine.endsWith("|") && /^[|:\-\s]+$/.test(nextLine)) {
          inTable = true;
          tableHeaders = cells;
          const alignCells = splitTableRow(nextLine);
          tableAligns = alignCells.map((ac) => {
            const left = ac.startsWith(":");
            const right = ac.endsWith(":");
            if (left && right) return "center";
            if (right) return "right";
            return "left";
          });
          tableRows = [];
          i++; // 跳过分隔行
          continue;
        }
      } else {
        tableRows.push(cells);
        continue;
      }
    } else if (inTable) {
      flushTable();
    }

    // ------------------------------------------------------------------------
    // 3. 引用块 Blockquote / Callout 处理 (> text)
    // ------------------------------------------------------------------------
    if (trimmed.startsWith(">")) {
      flushTable();
      flushList();
      inBlockquote = true;
      const quoteText = line.replace(/^\s*>\s?/, "");
      blockquoteLines.push(quoteText);
      continue;
    } else if (inBlockquote) {
      // 若遇到空行或非引用行，结算引用块
      if (trimmed === "") {
        flushBlockquote();
        continue;
      } else {
        flushBlockquote();
      }
    }

    // ------------------------------------------------------------------------
    // 4. 空行处理
    // ------------------------------------------------------------------------
    if (trimmed === "") {
      flushTable();
      flushList();
      continue;
    }

    // ------------------------------------------------------------------------
    // 5. 分割线 (--- / *** / ___)
    // ------------------------------------------------------------------------
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushTable();
      flushList();
      output.push(`<hr class="md-hr" />`);
      continue;
    }

    // ------------------------------------------------------------------------
    // 6. 标题 (H1 ~ H6)
    // ------------------------------------------------------------------------
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushTable();
      flushList();
      const level = headingMatch[1].length;
      const titleText = headingMatch[2];
      output.push(`<h${level} class="md-h md-h${level}">${parseInline(titleText)}</h${level}>`);
      continue;
    }

    // ------------------------------------------------------------------------
    // 7. 任务列表 (- [ ] / - [x]) 与 普通无序/有序列表
    // ------------------------------------------------------------------------
    const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      if (!inList || listType !== "ul") {
        flushList();
        inList = true;
        listType = "ul";
      }
      const isChecked = taskMatch[1].toLowerCase() === "x";
      const taskText = parseInline(taskMatch[2]);
      const checkClass = isChecked ? "md-task-box checked" : "md-task-box";
      const itemClass = isChecked ? "md-task-item md-task-done" : "md-task-item";
      const checkSvg = isChecked ? ICONS.check : "";
      listItems.push(
        `<li class="${itemClass}"><span class="${checkClass}" aria-hidden="true">${checkSvg}</span><span class="md-task-text">${taskText}</span></li>`
      );
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (!inList || listType !== "ul") {
        flushList();
        inList = true;
        listType = "ul";
      }
      listItems.push(`<li>${parseInline(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (!inList || listType !== "ol") {
        flushList();
        inList = true;
        listType = "ol";
      }
      listItems.push(`<li>${parseInline(olMatch[2])}</li>`);
      continue;
    }

    // 若当前为普通段落内容但列表中断
    if (inList) {
      flushList();
    }

    // ------------------------------------------------------------------------
    // 8. 普通段落 (Paragraph)
    // ------------------------------------------------------------------------
    output.push(`<p class="md-p">${parseInline(line)}</p>`);
  }

  // 循环结束：流式输出末尾自动容错闭合未完结元素
  if (inCodeBlock) {
    output.push(renderCodeBlock(codeBlockLines.join("\n"), codeBlockLang));
  }
  flushBlockquote();
  flushTable();
  flushList();

  return output.join("\n");
}

// ============================================================================
// 4. 全局代码块复制交互处理器 (Copy Code Event Delegation)
// ============================================================================

/**
 * 挂载 Markdown 内部交互委托（一键复制代码、状态切换与反馈）
 * @param {HTMLElement} [container=document] 监听容器
 */
export function initMarkdownInteractions(container = document) {
  if (!container || container.__mdInteractionsInit) return;
  container.__mdInteractionsInit = true;

  container.addEventListener("click", async (e) => {
    const copyBtn = e.target && typeof e.target.closest === "function" ? e.target.closest(".md-copy-btn") : null;
    if (!copyBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const codeBlock = copyBtn.closest(".md-code-block");
    if (!codeBlock) return;

    const codeEl = codeBlock.querySelector(".md-code-content");
    const textToCopy = codeEl ? codeEl.textContent : "";
    if (!textToCopy) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = textToCopy;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      // 复制成功 UI 反馈
      copyBtn.classList.add("copied");
      const iconSpan = copyBtn.querySelector(".md-copy-icon");
      const textSpan = copyBtn.querySelector(".md-copy-text");
      if (iconSpan) iconSpan.innerHTML = ICONS.check;
      if (textSpan) textSpan.textContent = "已复制";

      setTimeout(() => {
        copyBtn.classList.remove("copied");
        if (iconSpan) iconSpan.innerHTML = ICONS.copy;
        if (textSpan) textSpan.textContent = "复制";
      }, 1800);
    } catch (err) {
      console.error("[Markdown] Copy failed:", err);
    }
  });
}
