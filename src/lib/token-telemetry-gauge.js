/**
 * Token Telemetry SVG Gauge
 * 
 * 精密手绘工程绘图风格 Token 遥测微型仪表盘
 * 
 * 同时呈现三项核心遥测指标：
 * 1. 当前上下文消耗比值 (Current Context Window Ratio)
 * 2. token/s 实时速度 (Generation Speed)
 * 3. 已消耗 token 比值 (Consumed Token Quota Ratio)
 *    配额分母不走固定值，而是动态量级阶梯（resolveTokenQuota）：
 *    从 1M 起，累计用量满足当前量级后分母自动增长十倍（1M → 10M → 100M → 1B → 10B → …），
 *    量级档位分别以绿色（1M 档）/ 橙色（10M 档）/ 红色（100M 及以后全部）呈现。
 * 
 * 特性：
 * - 纯矢量 SVG，零外部依赖，极速轻量
 * - 支持三种精巧布局形态：
 *   • 'capsule' (横向遥测卡片，320×92，推荐主视图)
 *   • 'radial'  (同心圆微型仪表盘，110×110，紧凑小窗/悬浮球)
 *   • 'mini'    (24×24 原生双弧微型仪表，对话框「额度」按钮)
 * - 遵循 Anthropic / Pi.dev 手绘草图美学，全域 currentColor + CSS 变量双模自适应
 * - 具备毫秒级无损更新函数 update(params)，适合逐 token 流式高频刷新
 */

const ARC_ANGLE = 240;
const ARC_START_ANGLE = 150; // 顺时针旋转起始角度 (对应 150° ~ 390°/30°，下方留 120° 开放缺口)

/**
 * 限制数值在 [min, max] 范围
 */
function clamp(val, min = 0, max = 1) {
  const n = parseFloat(val);
  if (isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/**
 * 格式化数值为友好单位简写（如 128000 -> 128k, 1048576 -> 1M, 1e9 -> 1B, 1e12 -> 1T）
 */
export function formatTokenCount(num) {
  if (num === undefined || num === null || num === '' || isNaN(num)) return '';
  if (typeof num === 'string') return num;
  const abs = Math.abs(num);
  if (abs >= 1e12) return (num / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
  if (abs >= 1e9) return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(num);
}

/**
 * 已消耗 token 的动态配额阶梯唯一源。
 * 分母从 1M（TOKEN_QUOTA_BASE）起步，累计用量满足当前量级（>= 分母）后自动增长十倍：
 *   1M → 10M → 100M → 1B → 10B → 100B → 1T → …
 * 量级档位 level：0 = 1M 档（绿）、1 = 10M 档（橙）、>=2 = 100M 及以后全部（红）。
 * @param {number} usedTokens 累计已消耗 token
 * @returns {{ budget: number, level: number }}
 */
export const TOKEN_QUOTA_BASE = 1_000_000;

export function resolveTokenQuota(usedTokens) {
  const used = Math.max(0, parseFloat(usedTokens) || 0);
  let budget = TOKEN_QUOTA_BASE;
  while (budget <= used) budget *= 10;
  const level = Math.round(Math.log10(budget / TOKEN_QUOTA_BASE));
  return { budget, level };
}

/**
 * 解析并归一化传入的指标参数
 */
function resolveMetrics(options = {}) {
  // 1. 上下文消耗比值
  let ctxRatio = options.contextRatio !== undefined ? clamp(options.contextRatio) : 0;
  let ctxLabel = `${(ctxRatio * 100).toFixed(1)}%`;
  let ctxSub = options.contextText || '';

  if (options.contextUsed !== undefined && options.contextTotal !== undefined && options.contextTotal > 0) {
    ctxRatio = clamp(options.contextUsed / options.contextTotal);
    ctxLabel = `${(ctxRatio * 100).toFixed(1)}%`;
    if (!options.contextText) {
      ctxSub = `${formatTokenCount(options.contextUsed)} / ${formatTokenCount(options.contextTotal)}`;
    }
  }

  // 2. 已消耗 Token 比值（配额量级档位：0=绿(1M) / 1=橙(10M) / >=2=红(100M+)）
  let tokRatio = options.tokenRatio !== undefined ? clamp(options.tokenRatio) : 0;
  let tokLabel = `${(tokRatio * 100).toFixed(1)}%`;
  let tokSub = options.tokenText || '';
  const tokLevel = Math.min(2, Math.max(0, Math.floor(parseFloat(options.tokensLevel) || 0)));

  if (options.tokensUsed !== undefined && options.tokensBudget !== undefined && options.tokensBudget > 0) {
    tokRatio = clamp(options.tokensUsed / options.tokensBudget);
    tokLabel = `${(tokRatio * 100).toFixed(1)}%`;
    if (!options.tokenText) {
      tokSub = `${formatTokenCount(options.tokensUsed)} / ${formatTokenCount(options.tokensBudget)}`;
    }
  }

  // 3. 速度 token/s
  const speed = Math.max(0, parseFloat(options.speed) || 0);
  const speedMax = Math.max(10, parseFloat(options.speedMax) || 100);
  const speedRatio = clamp(speed / speedMax);
  const speedSub = options.speedText || (speed > 0 ? '推理中' : '空闲');

  return {
    ctxRatio,
    ctxLabel,
    ctxSub,
    tokRatio,
    tokLabel,
    tokSub,
    tokLevel,
    speed,
    speedMax,
    speedRatio,
    speedSub,
  };
}

/**
 * 生成手绘刻度线
 */
function generateDraftingTicks(cx, cy, r, count = 9, strokeWidth = 1) {
  let ticksSvg = '';
  const step = ARC_ANGLE / (count - 1);
  for (let i = 0; i < count; i++) {
    const angle = (ARC_START_ANGLE + i * step) * (Math.PI / 180);
    const isMajor = i === 0 || i === Math.floor(count / 2) || i === count - 1;
    const tickLen = isMajor ? 3.5 : 2.0;
    const r1 = r + 2.0;
    const r2 = r1 + tickLen;
    const x1 = (cx + r1 * Math.cos(angle)).toFixed(2);
    const y1 = (cy + r1 * Math.sin(angle)).toFixed(2);
    const x2 = (cx + r2 * Math.cos(angle)).toFixed(2);
    const y2 = (cy + r2 * Math.sin(angle)).toFixed(2);
    const opacity = isMajor ? 0.8 : 0.35;
    ticksSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" opacity="${opacity}" />`;
  }
  return ticksSvg;
}

/**
 * 共享 CSS 样式块
 */
function getSharedStyles(id) {
  return `
    #${id} {
      font-family: -apple-system, BlinkMacSystemFont, "JetBrains Mono", "SF Mono", "Fira Code", monospace;
      user-select: none;
      color: var(--ink-primary, #1c1a17);
      display: inline-block;
      vertical-align: middle;
    }
    #${id} .ttg-bg {
      fill: var(--sketch-box-bg, #ffffff);
      stroke: var(--sketch-border-subtle, #d6cfc4);
      stroke-width: 1.2;
    }
    #${id} .ttg-track {
      fill: none;
      stroke: var(--sketch-border-subtle, #e5e0d8);
      stroke-linecap: round;
    }
    #${id} .ttg-track-inner {
      opacity: 0.6;
    }
    #${id} .ttg-ctx-arc {
      fill: none;
      stroke: var(--color-ctx, #6d5f8a);
      stroke-linecap: round;
      transition: stroke-dasharray 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    #${id} .ttg-tok-arc {
      fill: none;
      stroke: var(--color-token, #d97706);
      stroke-linecap: round;
      transition: stroke-dasharray 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    #${id}.ttg-quota-l0 { --color-token: var(--ttg-quota-green, #4a7c59); }
    #${id}.ttg-quota-l1 { --color-token: var(--ttg-quota-orange, #d97706); }
    #${id}.ttg-quota-l2 { --color-token: var(--ttg-quota-red, #c2413c); }
    #${id} .ttg-bolt {
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: stroke 0.25s ease, filter 0.25s ease;
    }
    #${id} .spd-active .ttg-bolt {
      stroke: var(--color-speed, #2563eb);
      animation: ttg-pulse-${id} 1.6s ease-in-out infinite alternate;
    }
    #${id} .spd-idle .ttg-bolt {
      stroke: var(--ink-faint, #a69f94);
    }
    #${id} .ttg-speed-num {
      font-weight: 700;
      fill: var(--ink-primary, #1c1a17);
      text-anchor: middle;
    }
    #${id} .ttg-speed-unit {
      font-size: 7.5px;
      font-weight: 600;
      letter-spacing: 0.5px;
      fill: var(--ink-muted, #78716a);
      text-anchor: middle;
    }
    #${id} .ttg-label {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.4px;
    }
    #${id} .ttg-val {
      font-size: 11px;
      font-weight: 600;
    }
    #${id} .ttg-sub {
      font-size: 8.5px;
      fill: var(--ink-muted, #78716a);
    }
    #${id} .ttg-bar-bg {
      fill: var(--sketch-tag-bg, #f2ece1);
      rx: 1.75;
    }
    #${id} .ttg-bar-fill {
      rx: 1.75;
      transition: width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    @keyframes ttg-pulse-${id} {
      0% { filter: drop-shadow(0 0 1px rgba(37, 99, 235, 0.25)); opacity: 0.85; }
      100% { filter: drop-shadow(0 0 4.5px rgba(37, 99, 235, 0.7)); opacity: 1; }
    }
  `.trim();
}

/**
 * 渲染形态 1：Capsule 横向遥测卡片 (320 × 92)
 */
function renderCapsuleSvg(metrics, options, id) {
  const width = options.width || 320;
  const height = options.height || 92;

  const R_OUTER = 34;
  const R_INNER = 25;
  const maxOuterLen = 2 * Math.PI * R_OUTER * (ARC_ANGLE / 360);
  const maxInnerLen = 2 * Math.PI * R_INNER * (ARC_ANGLE / 360);

  const ctxDash = (maxOuterLen * metrics.ctxRatio).toFixed(2);
  const tokDash = (maxInnerLen * metrics.tokRatio).toFixed(2);

  const barMaxW = 84;
  const ctxBarW = (barMaxW * metrics.ctxRatio).toFixed(1);
  const spdBarW = (barMaxW * metrics.speedRatio).toFixed(1);
  const tokBarW = (barMaxW * metrics.tokRatio).toFixed(1);

  const ticksSvg = generateDraftingTicks(52, 48, R_OUTER, 9);
  const boltStateClass = metrics.speed > 0 ? 'spd-active' : 'spd-idle';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
     class="token-telemetry-gauge ttg-layout-capsule ttg-quota-l${metrics.tokLevel}" id="${id}" role="img"
     aria-label="Token 遥测：上下文 ${metrics.ctxLabel}, 速度 ${metrics.speed.toFixed(1)} tok/s, 已消耗 ${metrics.tokLabel}">
  <defs>
    <style>${getSharedStyles(id)}</style>
  </defs>

  <!-- 手绘质感外框 (不对称有机微圆角) -->
  <rect class="ttg-bg" x="1" y="1" width="${width - 2}" height="${height - 2}" rx="10" ry="10" />

  <!-- 仪表盘区域 (Center: 52, 48) -->
  <g class="ttg-dial-group">
    <!-- 外圈工程微刻度 -->
    <g class="ttg-ticks">${ticksSvg}</g>

    <!-- 外环底轨：上下文容量底轨 -->
    <circle class="ttg-track" cx="52" cy="48" r="${R_OUTER}" stroke-width="4.2"
            stroke-dasharray="${maxOuterLen.toFixed(2)} 300"
            transform="rotate(${ARC_START_ANGLE} 52 48)" />

    <!-- 外环进度：当前上下文消耗比值 -->
    <circle class="ttg-ctx-arc" id="${id}-arc-ctx" cx="52" cy="48" r="${R_OUTER}" stroke-width="4.2"
            stroke-dasharray="${ctxDash} 300"
            transform="rotate(${ARC_START_ANGLE} 52 48)" />

    <!-- 内环底轨：已消耗 Token 底轨 -->
    <circle class="ttg-track ttg-track-inner" cx="52" cy="48" r="${R_INNER}" stroke-width="3.5"
            stroke-dasharray="${maxInnerLen.toFixed(2)} 300"
            transform="rotate(${ARC_START_ANGLE} 52 48)" />

    <!-- 内环进度：已消耗 Token 比值 -->
    <circle class="ttg-tok-arc" id="${id}-arc-tok" cx="52" cy="48" r="${R_INNER}" stroke-width="3.5"
            stroke-dasharray="${tokDash} 300"
            transform="rotate(${ARC_START_ANGLE} 52 48)" />

    <!-- 核心中心：手绘闪电 + 速度数值 -->
    <g class="ttg-center-core ${boltStateClass}" id="${id}-core-bolt">
      <path class="ttg-bolt" d="M52.5 24.5 L48.8 29.2 L52.0 29.2 L51.2 33.5 L55.5 28.5 L52.8 28.5 Z" stroke-width="1.3" />
      <text class="ttg-speed-num" id="${id}-txt-speed" x="52" y="47.5" font-size="13.5">${metrics.speed.toFixed(1)}</text>
      <text class="ttg-speed-unit" x="52" y="58">tok/s</text>
    </g>
  </g>

  <!-- 工程草图微分割虚线 -->
  <line x1="98" y1="14" x2="98" y2="${height - 14}" stroke="var(--sketch-border-subtle, #d6cfc4)"
        stroke-width="1" stroke-dasharray="3 3" opacity="0.75" />

  <!-- 右侧三项指标遥测矩阵 (translate: 112, 0) -->
  <g class="ttg-metrics-group" transform="translate(112, 0)">
    
    <!-- 1. 当前上下文消耗 (y = 24) -->
    <g class="ttg-row" transform="translate(0, 24)">
      <circle cx="3" cy="-3.5" r="2.8" fill="var(--color-ctx, #6d5f8a)" />
      <text class="ttg-label" x="11" y="0" fill="var(--color-ctx, #6d5f8a)">CTX</text>
      <text class="ttg-val" id="${id}-txt-ctx-val" x="42" y="0" fill="var(--ink-primary, #1c1a17)">${metrics.ctxLabel}</text>
      <text class="ttg-sub" id="${id}-txt-ctx-sub" x="${width - 126}" y="0" text-anchor="end">${metrics.ctxSub}</text>
      <rect class="ttg-bar-bg" x="11" y="4" width="${barMaxW}" height="3.5" />
      <rect class="ttg-bar-fill" id="${id}-bar-ctx" x="11" y="4" width="${ctxBarW}" height="3.5" fill="var(--color-ctx, #6d5f8a)" />
    </g>

    <!-- 2. 实时速率 token/s (y = 50) -->
    <g class="ttg-row" transform="translate(0, 50)">
      <circle cx="3" cy="-3.5" r="2.8" fill="var(--color-speed, #2563eb)" />
      <text class="ttg-label" x="11" y="0" fill="var(--color-speed, #2563eb)">SPD</text>
      <text class="ttg-val" id="${id}-txt-spd-val" x="42" y="0" fill="var(--ink-primary, #1c1a17)">${metrics.speed.toFixed(1)} <tspan font-size="8.5" fill="var(--ink-muted, #78716a)">tok/s</tspan></text>
      <text class="ttg-sub" id="${id}-txt-spd-sub" x="${width - 126}" y="0" text-anchor="end">${metrics.speedSub}</text>
      <rect class="ttg-bar-bg" x="11" y="4" width="${barMaxW}" height="3.5" />
      <rect class="ttg-bar-fill" id="${id}-bar-spd" x="11" y="4" width="${spdBarW}" height="3.5" fill="var(--color-speed, #2563eb)" />
    </g>

    <!-- 3. 已消耗 Token (y = 76) -->
    <g class="ttg-row" transform="translate(0, 76)">
      <circle cx="3" cy="-3.5" r="2.8" fill="var(--color-token, #d97706)" />
      <text class="ttg-label" x="11" y="0" fill="var(--color-token, #d97706)">USED</text>
      <text class="ttg-val" id="${id}-txt-tok-val" x="42" y="0" fill="var(--ink-primary, #1c1a17)">${metrics.tokLabel}</text>
      <text class="ttg-sub" id="${id}-txt-tok-sub" x="${width - 126}" y="0" text-anchor="end">${metrics.tokSub}</text>
      <rect class="ttg-bar-bg" x="11" y="4" width="${barMaxW}" height="3.5" />
      <rect class="ttg-bar-fill" id="${id}-bar-tok" x="11" y="4" width="${tokBarW}" height="3.5" fill="var(--color-token, #d97706)" />
    </g>

  </g>
</svg>
`.trim();
}

/**
 * 渲染形态 2：Radial 同心圆微型仪表盘 (110 × 110)
 */
function renderRadialSvg(metrics, options, id) {
  const size = options.size || 110;
  const cx = size / 2;
  const cy = 48;

  const R_OUTER = 38;
  const R_INNER = 28;
  const maxOuterLen = 2 * Math.PI * R_OUTER * (ARC_ANGLE / 360);
  const maxInnerLen = 2 * Math.PI * R_INNER * (ARC_ANGLE / 360);

  const ctxDash = (maxOuterLen * metrics.ctxRatio).toFixed(2);
  const tokDash = (maxInnerLen * metrics.tokRatio).toFixed(2);

  const ticksSvg = generateDraftingTicks(cx, cy, R_OUTER, 9);
  const boltStateClass = metrics.speed > 0 ? 'spd-active' : 'spd-idle';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"
     class="token-telemetry-gauge ttg-layout-radial ttg-quota-l${metrics.tokLevel}" id="${id}" role="img"
     aria-label="Token 遥测：上下文 ${metrics.ctxLabel}, 速度 ${metrics.speed.toFixed(1)} tok/s, 已消耗 ${metrics.tokLabel}">
  <defs>
    <style>${getSharedStyles(id)}</style>
  </defs>

  <rect class="ttg-bg" x="1" y="1" width="${size - 2}" height="${size - 2}" rx="12" ry="12" />

  <g class="ttg-ticks">${ticksSvg}</g>

  <!-- 外环：当前上下文消耗比值 (R=38) -->
  <circle class="ttg-track" cx="${cx}" cy="${cy}" r="${R_OUTER}" stroke-width="4.5"
          stroke-dasharray="${maxOuterLen.toFixed(2)} 300"
          transform="rotate(${ARC_START_ANGLE} ${cx} ${cy})" />
  <circle class="ttg-ctx-arc" id="${id}-arc-ctx" cx="${cx}" cy="${cy}" r="${R_OUTER}" stroke-width="4.5"
          stroke-dasharray="${ctxDash} 300"
          transform="rotate(${ARC_START_ANGLE} ${cx} ${cy})" />

  <!-- 内环：已消耗 Token 比值 (R=28) -->
  <circle class="ttg-track ttg-track-inner" cx="${cx}" cy="${cy}" r="${R_INNER}" stroke-width="3.5"
          stroke-dasharray="${maxInnerLen.toFixed(2)} 300"
          transform="rotate(${ARC_START_ANGLE} ${cx} ${cy})" />
  <circle class="ttg-tok-arc" id="${id}-arc-tok" cx="${cx}" cy="${cy}" r="${R_INNER}" stroke-width="3.5"
          stroke-dasharray="${tokDash} 300"
          transform="rotate(${ARC_START_ANGLE} ${cx} ${cy})" />

  <!-- 中心速率核心 -->
  <g class="ttg-center-core ${boltStateClass}" id="${id}-core-bolt">
    <path class="ttg-bolt" d="M${cx + 0.5} 24.5 L${cx - 3.2} 29.2 L${cx} 29.2 L${cx - 0.8} 33.5 L${cx + 3.5} 28.5 L${cx + 0.8} 28.5 Z" stroke-width="1.3" />
    <text class="ttg-speed-num" id="${id}-txt-speed" x="${cx}" y="47" font-size="14">${metrics.speed.toFixed(1)}</text>
    <text class="ttg-speed-unit" x="${cx}" y="57">tok/s</text>
  </g>

  <!-- 底部对称读数胶囊 (左 CTX，右 USED) -->
  <g transform="translate(0, 94)">
    <circle cx="16" cy="-2.5" r="2.5" fill="var(--color-ctx, #6d5f8a)" />
    <text class="ttg-val" id="${id}-txt-ctx-val" x="22" y="1" font-size="9.5" fill="var(--color-ctx, #6d5f8a)">${metrics.ctxLabel}</text>

    <circle cx="${size - 44}" cy="-2.5" r="2.5" fill="var(--color-token, #d97706)" />
    <text class="ttg-val" id="${id}-txt-tok-val" x="${size - 38}" y="1" font-size="9.5" fill="var(--color-token, #d97706)">${metrics.tokLabel}</text>
  </g>
</svg>
`.trim();
}

/**
 * 渲染形态 4：Mini 单图标模式 (原生 24×24 viewBox，专为对话框左侧「额度」按钮设计)
 * 直观呈现：外环上下文消耗比例 + 内环已消耗 Token 比例 + 中心手绘速度闪电
 */
function renderMiniSvg(metrics, options, id) {
  const size = options.size || 20;

  const R_OUTER = 9.2;
  const R_INNER = 6.8;
  const maxOuterLen = 2 * Math.PI * R_OUTER * (ARC_ANGLE / 360); // ~38.54
  const maxInnerLen = 2 * Math.PI * R_INNER * (ARC_ANGLE / 360); // ~28.48

  const ctxDash = (maxOuterLen * metrics.ctxRatio).toFixed(2);
  const tokDash = (maxInnerLen * metrics.tokRatio).toFixed(2);
  const boltStateClass = metrics.speed > 0 ? 'spd-active' : 'spd-idle';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"
     class="token-telemetry-gauge ttg-layout-mini ttg-quota-l${metrics.tokLevel}" id="${id}" role="img" aria-hidden="true">
  <defs>
    <style>
      #${id} {
        display: block;
        color: var(--ink-primary, currentColor);
        overflow: visible;
        user-select: none;
      }
      #${id} .ttg-mini-track-out {
        fill: none;
        stroke: var(--sketch-border-subtle, #d6cfc4);
        stroke-width: 1.8;
        stroke-linecap: round;
        opacity: 0.35;
      }
      #${id} .ttg-mini-track-in {
        fill: none;
        stroke: var(--sketch-border-subtle, #d6cfc4);
        stroke-width: 1.4;
        stroke-linecap: round;
        opacity: 0.3;
      }
      #${id} .ttg-mini-arc-ctx {
        fill: none;
        stroke: var(--color-ctx, #6d5f8a);
        stroke-width: 1.8;
        stroke-linecap: round;
        transition: stroke-dasharray 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      #${id} .ttg-mini-arc-tok {
        fill: none;
        stroke: var(--color-token, #d97706);
        stroke-width: 1.4;
        stroke-linecap: round;
        transition: stroke-dasharray 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      #${id}.ttg-quota-l0 { --color-token: var(--ttg-quota-green, #4a7c59); }
      #${id}.ttg-quota-l1 { --color-token: var(--ttg-quota-orange, #d97706); }
      #${id}.ttg-quota-l2 { --color-token: var(--ttg-quota-red, #c2413c); }
      #${id} .ttg-mini-bolt {
        transition: fill 0.2s ease, stroke 0.2s ease, filter 0.2s ease;
      }
      #${id} .ttg-mini-core.spd-active .ttg-mini-bolt {
        fill: var(--color-speed, #2563eb);
        stroke: var(--color-speed, #2563eb);
        animation: ttg-mini-pulse-${id} 1.4s ease-in-out infinite alternate;
      }
      #${id} .ttg-mini-core.spd-idle .ttg-mini-bolt {
        fill: none;
        stroke: var(--ink-faint, #a69f94);
        opacity: 0.55;
      }
      @keyframes ttg-mini-pulse-${id} {
        0% { filter: drop-shadow(0 0 0.8px rgba(37, 99, 235, 0.3)); opacity: 0.85; }
        100% { filter: drop-shadow(0 0 2.5px rgba(37, 99, 235, 0.85)); opacity: 1; }
      }
    </style>
  </defs>

  <!-- 3 点精简工程微刻度 -->
  <g class="ttg-mini-ticks" stroke="currentColor" opacity="0.38" stroke-linecap="round">
    <line x1="12" y1="0.8" x2="12" y2="2.0" stroke-width="0.9" />
    <line x1="2.2" y1="8.0" x2="3.1" y2="8.5" stroke-width="0.8" />
    <line x1="21.8" y1="8.0" x2="20.9" y2="8.5" stroke-width="0.8" />
  </g>

  <!-- 外环：当前上下文消耗比值 (R=9.2, 宽 1.8) -->
  <circle class="ttg-mini-track-out" cx="12" cy="12" r="${R_OUTER}"
          stroke-dasharray="${maxOuterLen.toFixed(2)} 100"
          transform="rotate(${ARC_START_ANGLE} 12 12)" />
  <circle class="ttg-mini-arc-ctx" id="${id}-arc-ctx" cx="12" cy="12" r="${R_OUTER}"
          stroke-dasharray="${ctxDash} 100"
          transform="rotate(${ARC_START_ANGLE} 12 12)" />

  <!-- 内环：已消耗 Token 比值 (R=6.8, 宽 1.4) -->
  <circle class="ttg-mini-track-in" cx="12" cy="12" r="${R_INNER}"
          stroke-dasharray="${maxInnerLen.toFixed(2)} 100"
          transform="rotate(${ARC_START_ANGLE} 12 12)" />
  <circle class="ttg-mini-arc-tok" id="${id}-arc-tok" cx="12" cy="12" r="${R_INNER}"
          stroke-dasharray="${tokDash} 100"
          transform="rotate(${ARC_START_ANGLE} 12 12)" />

  <!-- 中心手绘流速闪电火花 -->
  <g class="ttg-mini-core ${boltStateClass}" id="${id}-core-bolt">
    <path class="ttg-mini-bolt" id="${id}-bolt"
          d="M12.3 7.2 L9.8 11.2 L11.8 11.2 L11.2 16.5 L14.2 11.8 L12.2 11.8 Z"
          stroke-width="0.9" stroke-linejoin="round" stroke-linecap="round" />
  </g>
</svg>
`.trim();
}

/**
 * 生成参数化 SVG 字符串入口
 * @param {Object} options 
 * @returns {string} 纯 SVG 字符串
 */
export function renderTokenTelemetrySvg(options = {}) {
  const metrics = resolveMetrics(options);
  const layout = options.layout || 'capsule';
  const id = options.id || `ttg-${Math.random().toString(36).slice(2, 9)}`;

  if (layout === 'mini' || layout === 'icon') {
    return renderMiniSvg(metrics, options, id);
  }
  if (layout === 'radial') {
    return renderRadialSvg(metrics, options, id);
  }
  return renderCapsuleSvg(metrics, options, id);
}

/**
 * 创建交互式 Token 遥测仪表盘 DOM 实例，支持极速平滑传参更新
 * @param {Object} initialOptions
 * @returns {{ element: SVGElement, update: Function, destroy: Function }}
 */
export function createTokenTelemetryGauge(initialOptions = {}) {
  const container = document.createElement('div');
  container.className = 'ttg-wrapper';
  container.style.display = 'inline-flex';
  container.style.lineHeight = '0';

  const layout = initialOptions.layout || 'capsule';
  const svgStr = renderTokenTelemetrySvg(initialOptions);
  container.innerHTML = svgStr;
  const svgEl = container.firstElementChild;

  const id = svgEl.getAttribute('id');
  const arcCtx = svgEl.querySelector(`#${id}-arc-ctx`);
  const arcTok = svgEl.querySelector(`#${id}-arc-tok`);
  const coreBolt = svgEl.querySelector(`#${id}-core-bolt`);
  const txtSpeed = svgEl.querySelector(`#${id}-txt-speed`);

  const txtCtxVal = svgEl.querySelector(`#${id}-txt-ctx-val`);
  const txtCtxSub = svgEl.querySelector(`#${id}-txt-ctx-sub`);
  const barCtx = svgEl.querySelector(`#${id}-bar-ctx`);

  const txtSpdVal = svgEl.querySelector(`#${id}-txt-spd-val`);
  const txtSpdSub = svgEl.querySelector(`#${id}-txt-spd-sub`);
  const barSpd = svgEl.querySelector(`#${id}-bar-spd`);

  const txtTokVal = svgEl.querySelector(`#${id}-txt-tok-val`);
  const txtTokSub = svgEl.querySelector(`#${id}-txt-tok-sub`);
  const barTok = svgEl.querySelector(`#${id}-bar-tok`);

  const barMaxW = 84;

  // 弧长计算参数
  const isMini = layout === 'mini' || layout === 'icon';
  const rOuter = isMini ? 9.2 : (layout === 'radial' ? 38 : 34);
  const rInner = isMini ? 6.8 : (layout === 'radial' ? 28 : 25);
  const maxOuterLen = 2 * Math.PI * rOuter * (ARC_ANGLE / 360);
  const maxInnerLen = 2 * Math.PI * rInner * (ARC_ANGLE / 360);
  const dashModulo = isMini ? 100 : 300;

  /**
   * 毫秒级极速平滑更新参数（无 DOM 销毁重构，纯属性/文本同步）
   * @param {Object} nextOptions
   */
  function update(nextOptions = {}) {
    const m = resolveMetrics({ ...initialOptions, ...nextOptions });

    // 0. 配额量级档位换色（绿 → 橙 → 红）：重定义 --color-token，TOK 弧/条/读数整体跟随
    const levelClass = `ttg-quota-l${m.tokLevel}`;
    if (!svgEl.classList.contains(levelClass)) {
      svgEl.classList.remove('ttg-quota-l0', 'ttg-quota-l1', 'ttg-quota-l2');
      svgEl.classList.add(levelClass);
    }

    // 1. 上下文消耗比值 (CTX)
    if (arcCtx) {
      const len = (maxOuterLen * m.ctxRatio).toFixed(2);
      arcCtx.setAttribute('stroke-dasharray', `${len} ${dashModulo}`);
    }
    if (txtCtxVal) txtCtxVal.textContent = m.ctxLabel;
    if (txtCtxSub && m.ctxSub) txtCtxSub.textContent = m.ctxSub;
    if (barCtx) barCtx.setAttribute('width', (barMaxW * m.ctxRatio).toFixed(1));

    // 2. 速度 (SPD)
    if (txtSpeed) txtSpeed.textContent = m.speed.toFixed(1);
    if (txtSpdVal) {
      txtSpdVal.innerHTML = `${m.speed.toFixed(1)} <tspan font-size="8.5" fill="var(--ink-muted, #78716a)">tok/s</tspan>`;
    }
    if (txtSpdSub) txtSpdSub.textContent = m.speedSub;
    if (barSpd) barSpd.setAttribute('width', (barMaxW * m.speedRatio).toFixed(1));

    if (coreBolt) {
      if (m.speed > 0) {
        coreBolt.classList.add('spd-active');
        coreBolt.classList.remove('spd-idle');
      } else {
        coreBolt.classList.remove('spd-active');
        coreBolt.classList.add('spd-idle');
      }
    }

    // 3. 已消耗 Token 比值 (USED)
    if (arcTok) {
      const len = (maxInnerLen * m.tokRatio).toFixed(2);
      arcTok.setAttribute('stroke-dasharray', `${len} ${dashModulo}`);
    }
    if (txtTokVal) txtTokVal.textContent = m.tokLabel;
    if (txtTokSub && m.tokSub) txtTokSub.textContent = m.tokSub;
    if (barTok) barTok.setAttribute('width', (barMaxW * m.tokRatio).toFixed(1));
  }

  return {
    element: svgEl,
    update,
    destroy() {
      svgEl.remove();
    }
  };
}
