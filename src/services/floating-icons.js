/**
 * 边框图标飘荡特效引擎 (Floating Edge Icons)
 * ─────────────────────────────────────────────
 * 从软件窗口两侧随机滑入手绘 SVG 图标，沿直线或曲线轨迹向中间漂移，
 * 同时伴随极慢自转。留存 1~3 秒后渐隐消失。
 *
 * 严格控制：单边仅允许 1~4 个图案同时滑入。
 */

const SVG_FILES = [
  "ic_apple.svg",
  "ic_badminton_racket.svg",
  "ic_banana.svg",
  "ic_bicycle_wheel.svg",
  "ic_briefcase.svg",
  "ic_cat.svg",
  "ic_compass.svg",
  "ic_desk_lamp.svg",
  "ic_dog.svg",
  "ic_drawing_board.svg",
  "ic_eraser.svg",
  "ic_flower.svg",
  "ic_gamepad.svg",
  "ic_glasses.svg",
  "ic_joystick.svg",
  "ic_laptop.svg",
  "ic_palette.svg",
  "ic_pencil.svg",
  "ic_protractor.svg",
  "ic_ruler.svg",
  "ic_scale.svg",
  "ic_scissors.svg",
  "ic_shuttlecock.svg",
  "ic_soccer.svg",
  "ic_straw_hat.svg",
  "ic_wrench.svg",
];

/** 已加载的 SVG 内容缓存（key → SVG innerHTML） */
const svgCache = new Map();

/** 当前存活的浮动图标数（按侧） */
let leftAlive = 0;
let rightAlive = 0;

/** 每侧最大同时存在数 */
const MAX_PER_SIDE = 4;

/** 容器 DOM */
let container = null;

/** 定时器 ID */
let spawnTimer = null;

/** 是否已启动 */
let running = false;

// ─── 工具函数 ───────────────────────────────────────────────────────────────

/** 返回 [min, max] 之间的随机整数 */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** 返回 [min, max] 之间的随机浮点数 */
const randFloat = (min, max) => Math.random() * (max - min) + min;

/** 从数组中随机选取 */
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ─── SVG 加载 ───────────────────────────────────────────────────────────────

/**
 * 预加载所有 SVG 文件内容
 */
async function preloadSVGs() {
  const fetchPromises = SVG_FILES.map(async (filename) => {
    if (svgCache.has(filename)) return;
    try {
      const resp = await fetch(`assets/svg-moving/${filename}`);
      if (resp.ok) {
        const text = await resp.text();
        svgCache.set(filename, text);
      }
    } catch {
      // 静默失败：素材缺失不影响整体
    }
  });
  await Promise.allSettled(fetchPromises);
}

// ─── 单个浮动图标生命周期 ─────────────────────────────────────────────────────

/**
 * 生成一个浮动图标并动画播放其整个生命周期
 */
function spawnIcon() {
  if (!container) return;

  // 决定从哪侧滑入
  const canLeft = leftAlive < MAX_PER_SIDE;
  const canRight = rightAlive < MAX_PER_SIDE;
  if (!canLeft && !canRight) return;

  let side;
  if (canLeft && canRight) {
    side = Math.random() < 0.5 ? "left" : "right";
  } else {
    side = canLeft ? "left" : "right";
  }

  // 选择一个随机 SVG
  const available = Array.from(svgCache.keys());
  if (available.length === 0) return;
  const filename = pickRandom(available);
  const svgContent = svgCache.get(filename);
  if (!svgContent) return;

  // 计数递增
  if (side === "left") leftAlive++;
  else rightAlive++;

  // 创建 DOM 元素
  const el = document.createElement("div");
  el.className = "floating-icon";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = svgContent;

  // 使内联 SVG 继承 currentColor 并设置尺寸
  const svgEl = el.querySelector("svg");
  if (svgEl) {
    svgEl.setAttribute("width", "24");
    svgEl.setAttribute("height", "24");
    svgEl.style.display = "block";
  }

  // 随机垂直位置（避开标题栏 30px 和底部 40px）
  const containerHeight = container.clientHeight || 500;
  const safeTop = 40;
  const safeBottom = 50;
  const topPos = randInt(safeTop, Math.max(safeTop + 20, containerHeight - safeBottom));

  // 起始 X 位置（窗口外侧）和结束 X（向中间滑入一段距离）
  const containerWidth = container.clientWidth || 600;
  let startX, endX;
  if (side === "left") {
    startX = -36; // 从左侧外部出发
    endX = randInt(20, Math.min(120, Math.floor(containerWidth * 0.18)));
  } else {
    startX = containerWidth + 12; // 从右侧外部出发
    endX = containerWidth - randInt(20, Math.min(120, Math.floor(containerWidth * 0.18)));
  }

  // 随机生命周期 1~3 秒
  const lifespan = randFloat(1000, 3000);

  // 默认角度（0°）滑入，滑入后再缓慢自转
  const initialRotation = 0;
  // 极慢自转速率（正或负方向），整个生命周期转动 15~60 度
  const rotationDelta = randFloat(15, 60) * (Math.random() < 0.5 ? 1 : -1);

  // 是否使用曲线轨迹（50% 概率）
  const useCurve = Math.random() < 0.5;
  // 曲线偏移量（垂直方向的弧度，正负随机）
  const curveAmplitude = useCurve ? randFloat(15, 50) * (Math.random() < 0.5 ? 1 : -1) : 0;

  // 设置初始位置
  el.style.position = "absolute";
  el.style.left = `${startX}px`;
  el.style.top = `${topPos}px`;
  el.style.transform = `rotate(${initialRotation}deg)`;
  el.style.opacity = "0";

  container.appendChild(el);

  // ── 动画帧驱动 ──
  const startTime = performance.now();
  let rafId = null;

  const fadeInDuration = 300; // 渐入 300ms
  const fadeOutDuration = 400; // 渐出 400ms
  const fadeOutStart = lifespan - fadeOutDuration;

  const animate = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / lifespan, 1);

    // 缓动函数 (ease-out)
    const easeOut = 1 - Math.pow(1 - progress, 3);

    // 计算当前 X
    const currentX = startX + (endX - startX) * easeOut;

    // 曲线轨迹的 Y 偏移（sin 曲线模拟弧形）
    const curveY = curveAmplitude * Math.sin(progress * Math.PI);
    const currentY = topPos + curveY;

    // 旋转
    const currentRotation = initialRotation + rotationDelta * progress;

    // 透明度控制
    let opacity;
    if (elapsed < fadeInDuration) {
      opacity = elapsed / fadeInDuration; // 渐入
    } else if (elapsed > fadeOutStart) {
      opacity = Math.max(0, 1 - (elapsed - fadeOutStart) / fadeOutDuration); // 渐出
    } else {
      opacity = 1;
    }

    el.style.left = `${currentX}px`;
    el.style.top = `${currentY}px`;
    el.style.transform = `rotate(${currentRotation}deg)`;
    el.style.opacity = `${opacity}`;

    if (progress < 1) {
      rafId = requestAnimationFrame(animate);
    } else {
      // 生命周期结束，清理
      cleanup();
    }
  };

  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (el.parentNode) el.parentNode.removeChild(el);
    if (side === "left") leftAlive = Math.max(0, leftAlive - 1);
    else rightAlive = Math.max(0, rightAlive - 1);
  };

  rafId = requestAnimationFrame(animate);
}

// ─── 调度器 ─────────────────────────────────────────────────────────────────

/**
 * 随机间隔定时器：每隔 800ms~2500ms 尝试生成一个新的浮动图标
 */
function scheduleNext() {
  if (!running) return;
  const delay = randInt(800, 2500);
  spawnTimer = setTimeout(() => {
    spawnIcon();
    scheduleNext();
  }, delay);
}

// ─── 公共 API ───────────────────────────────────────────────────────────────

/**
 * 启动浮动图标特效
 * @param {HTMLElement} [hostEl] - 挂载容器，默认为 body
 */
export async function startFloatingIcons(hostEl) {
  if (running) return;

  // 确保容器
  container = hostEl || document.body;

  // 创建或复用层容器
  let layer = document.getElementById("floating-icons-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "floating-icons-layer";
    layer.className = "floating-icons-layer";
    layer.setAttribute("aria-hidden", "true");
    container.appendChild(layer);
  }
  container = layer;

  // 预加载素材
  await preloadSVGs();

  if (svgCache.size === 0) {
    // 无可用素材则不启动
    return;
  }

  running = true;
  scheduleNext();
}

/**
 * 停止浮动图标特效
 */
export function stopFloatingIcons() {
  running = false;
  if (spawnTimer) {
    clearTimeout(spawnTimer);
    spawnTimer = null;
  }
  // 不立即移除已有动画（让它们自然消亡）
}

/**
 * 彻底销毁（清理所有残留 DOM）
 */
export function destroyFloatingIcons() {
  stopFloatingIcons();
  leftAlive = 0;
  rightAlive = 0;
  const layer = document.getElementById("floating-icons-layer");
  if (layer && layer.parentNode) {
    layer.parentNode.removeChild(layer);
  }
  container = null;
}
