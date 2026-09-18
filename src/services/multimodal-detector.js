/**
 * 多模态能力与任务意图检测器 (multimodal-detector.js)
 * 负责检测会话模型的多模态能力（视觉识图/生图），并精准识别输入任务是否为识图或生图任务
 */

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"]);

/**
 * 判定文件路径或文件名是否为图片格式
 * @param {string} [pathOrName]
 * @returns {boolean}
 */
export function isImageFilePath(pathOrName) {
  if (!pathOrName || typeof pathOrName !== "string") return false;
  const clean = pathOrName.split("?")[0].split("#")[0].trim().toLowerCase();
  const ext = clean.split(".").pop();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * 智能判定模型是否具备多模态视觉能力 (Vision / Multimodal)
 * @param {Object | string | null} model
 * @returns {boolean}
 */
export function isModelMultimodal(model) {
  if (!model) return false;

  // 显式属性标记优先 (如 catalog 或 custom-models 配置)
  if (typeof model === "object") {
    if (model.multimodal === true || model.vision === true || model.isMultimodal === true) {
      return true;
    }
  }

  const rawId = typeof model === "string" ? model : (model.id || model.modelId || model.name || "");
  const normalized = String(rawId).toLowerCase().trim();
  if (!normalized) return false;

  // 1. 明确的纯文本/纯推理模型 (黑名单短路)
  if (
    normalized.includes("deepseek") ||
    normalized.includes("o1-mini") ||
    normalized.includes("o3-mini") ||
    normalized.includes("qwq") ||
    normalized.startsWith("r1") ||
    normalized.startsWith("v3")
  ) {
    // 除非明确带有 vision / vl 后缀
    if (!normalized.includes("vision") && !normalized.includes("vl")) {
      return false;
    }
  }

  // 2. 具备原生视觉/多模态能力的大模型族谱
  const visionPatterns = [
    "gpt-4o",
    "gpt-4-turbo",
    "chatgpt-4o",
    "claude-3",
    "claude-4",
    "gemini",
    "vision",
    "-vl",
    "_vl",
    "vl-",
    "/vl",
    "omni",
    "llava",
    "minicpm-v",
    "qwen-vl",
    "pixtral",
    "internvl",
    "cogvlm",
    "step-1v",
    "florence",
    "glm-4v",
    "hunyuan-vision",
  ];

  return visionPatterns.some((p) => normalized.includes(p));
}


/**
 * 任务意图检测：判定当前任务是否为「识图任务」或「生图任务」
 * @param {string} query
 * @param {Array<any>} [attachments=[]]
 * @returns {"vision" | "generation" | null}
 */
export function detectImageTaskType(query = "", attachments = []) {
  const cleanQuery = typeof query === "string" ? query.trim() : "";

  // 1. 优先判定「识图任务」：附带了图片附件，或附带了图片路径且含有视觉检视意图
  const hasImageAttachment = Array.isArray(attachments) && attachments.some((f) => {
    return f.category === "image" || isImageFilePath(f.path) || isImageFilePath(f.name);
  });

  if (hasImageAttachment) {
    return "vision";
  }

  // 检查 Prompt 中是否显式引用了本地图片路径（如 ~/.pi-dl/attachments/*.png 或 C:\...jpg）
  const containsImagePath = /\.(png|jpe?g|webp|bmp|gif|svg)([\s"'\)\]]|$)/i.test(cleanQuery);
  // 检视/评析意图（检视动词 + 图像宾语）：命中时优先视为识图/分析而非生图，
  // 防止「优化这张海报」「评价一下这张图」类分析请求被误路由到生图模型
  const isInspectionQuery = /(识别|看下|查看|分析|提取|解读|描述|总结|解释|评价|点评|优化|对比|比较|ocr|阅览|视检)\s*.*(这?张?个?幅?)(图片|图|照片|截图|截屏|海报|插画|头像|壁纸|logo|icon|配图|插图|漫画)/i.test(cleanQuery) ||
    /(识别|提取)(.*)文字/i.test(cleanQuery);

  if (containsImagePath && isInspectionQuery) {
    return "vision";
  }

  // 2. 判定「生图任务」：明确的文生图/绘图意图
  const isGenMatch =
    /(生成|画|绘制|创建|制作|设计|出图|画个|画一只|画一张|画幅|生图|做一张|画出|渲染)\s*.*(图片|图|画|照片|插画|海报|头像|壁纸|icon|logo|配图|插图|漫画)/i.test(cleanQuery) ||
    /(文生图|ai绘图|生成图片|帮我画|画一|画张|画幅|作画)/i.test(cleanQuery) ||
    /\b(generate|draw|create|paint|render|make)\b.*(image|picture|photo|illustration|drawing|artwork|poster|wallpaper|logo|avatar|icon)/i.test(cleanQuery);

  // 排除纯分析/识别意图（如“分析这张生成的图片”）
  if (isGenMatch && !isInspectionQuery) {
    return "generation";
  }

  return null;
}

/**
 * 判定运营商接口类型是否为专用生图接口
 * 明确原则：“/v1/chat/completions”、“/v1/responses”、“Anthropic类型” 都不支持直接输出图片，
 * 必须使用 “OpenAI 兼容的 /images/generations 类型” 或 “DashScope 原生异步接口”。
 * 判定口径（与 Rust image_gen.rs 保持唯一一致）：接口类型名包含 "image"，
 * 或为 DashScope 原生异步接口（dashscope-async）。
 * @param {string} apiType
 * @returns {boolean}
 */
export function isImageGenerationApiType(apiType) {
  if (!apiType) return false;
  const t = String(apiType).trim().toLowerCase();
  return t.includes("image") || t === "dashscope-async";
}

