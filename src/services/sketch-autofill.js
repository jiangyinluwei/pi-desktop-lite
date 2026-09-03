/**
 * 手绘草图质感自定义填表与智能联想推荐引擎 (Sketch AutoFill & Suggestion Engine)
 * 
 * 核心特性：
 * 1. 彻底消灭浏览器/Webview原生破相的表单填表下拉框与黄/蓝背景伪类变色；
 * 2. 边框、底色、字色自适应 Warm Oatmeal Paper 与 Charcoal Blackboard 双模主题；
 * 3. 180ms 快速回弹弹出微抖动动效 (Pop & Micro-Shake)；
 * 4. 内置海量运营商 (SiliconFlow, DeepSeek, Ollama, OneAPI, VolcEngine, OpenRouter, Groq 等) 与模型预设；
 * 5. 一键全表智能联动填充（自动设置 Provider ID、协议、Base URL、Dev-Role 及 Reasoning 开关）；
 * 6. 自定义填表历史记忆沉淀与模糊快速匹配检索；
 * 7. 支持键盘 ↑/↓ 方向键高亮、Enter/Tab 快速填入、Esc 与全域右键 (Step Back) 拦截收起。
 */

// ============================================================================
// 手绘 SVG 矢量图元定义（全域消除 Emoji）
// ============================================================================
const ICONS = {
  spark: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1"/></svg>`,
  clock: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v3.8l2.5 1.5"/></svg>`,
  server: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="4" rx="1"/><rect x="2" y="9" width="12" height="4" rx="1"/><circle cx="4.5" cy="5" r="0.75" fill="currentColor"/><circle cx="4.5" cy="11" r="0.75" fill="currentColor"/></svg>`,
  cube: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 L14 5.5 L8 9 L2 5.5 Z"/><path d="M2 5.5 V10.5 L8 14 V9"/><path d="M14 5.5 V10.5 L8 14"/></svg>`,
  link: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.8 9.2a3.5 3.5 0 0 0 4.9 0l2.1-2.1a3.5 3.5 0 0 0-4.9-4.9L7.8 3.3"/><path d="M9.2 6.8a3.5 3.5 0 0 0-4.9 0L2.2 8.9a3.5 3.5 0 0 0 4.9 4.9l1.1-1.1"/></svg>`,
  arrowRight: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>`,
  close: `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>`
};

// ============================================================================
// 运营商内置预设库 (Provider Presets)
// ============================================================================
export const PROVIDER_PRESETS = [
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    tag: "热门聚合",
    protocol: "openai-completions",
    baseUrl: "https://api.siliconflow.cn/v1",
    devRole: false,
    reasoningEffort: true,
    desc: "高并发聚合端点，支持 DeepSeek-V3/R1、Qwen2.5 等",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", contextWindow: 64000, maxTokens: 8192, reasoning: false },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: 64000, maxTokens: 8192, reasoning: true },
      { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", contextWindow: 32768, maxTokens: 8192, reasoning: false },
      { id: "Pro/deepseek-ai/DeepSeek-V3", name: "DeepSeek V3 (Pro)", contextWindow: 64000, maxTokens: 8192, reasoning: false },
      { id: "Pro/deepseek-ai/DeepSeek-R1", name: "DeepSeek R1 (Pro)", contextWindow: 64000, maxTokens: 8192, reasoning: true }
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek 官方 API",
    tag: "官方直连",
    protocol: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    devRole: false,
    reasoningEffort: true,
    desc: "深度求索官方标准与推理端点 (deepseek-chat / reasoner)",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3 (Chat)", contextWindow: 64000, maxTokens: 8192, reasoning: false },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (Reasoner)", contextWindow: 64000, maxTokens: 8192, reasoning: true }
    ]
  },
  {
    id: "ollama",
    name: "Ollama 本地运行",
    tag: "本地部署",
    protocol: "ollama",
    baseUrl: "http://localhost:11434/v1",
    devRole: false,
    reasoningEffort: false,
    desc: "本地私有大模型端点，无需 API Key",
    models: [
      { id: "llama3.3:latest", name: "Llama 3.3 70B", contextWindow: 32768, maxTokens: 4096, reasoning: false },
      { id: "deepseek-r1:8b", name: "DeepSeek R1 8B", contextWindow: 32768, maxTokens: 4096, reasoning: true },
      { id: "deepseek-r1:14b", name: "DeepSeek R1 14B", contextWindow: 32768, maxTokens: 4096, reasoning: true },
      { id: "qwen2.5:14b", name: "Qwen 2.5 14B", contextWindow: 32768, maxTokens: 4096, reasoning: false },
      { id: "qwen2.5-coder:14b", name: "Qwen 2.5 Coder 14B", contextWindow: 32768, maxTokens: 4096, reasoning: false }
    ]
  },
  {
    id: "oneapi",
    name: "OneAPI / NewAPI",
    tag: "中转网关",
    protocol: "openai-completions",
    baseUrl: "https://your-oneapi-host/v1",
    devRole: false,
    reasoningEffort: true,
    desc: "统一多渠道大模型分发与路由网关",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", contextWindow: 64000, maxTokens: 8192, reasoning: false },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: 64000, maxTokens: 8192, reasoning: true },
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxTokens: 4096, reasoning: false },
      { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", contextWindow: 200000, maxTokens: 8192, reasoning: true }
    ]
  },
  {
    id: "volcengine",
    name: "火山方舟 / 豆包 (VolcEngine)",
    tag: "字节跳动",
    protocol: "openai-completions",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    devRole: false,
    reasoningEffort: true,
    desc: "字节跳动火山方舟企业级模型与推理接入点",
    models: [
      { id: "doubao-pro-32k", name: "Doubao Pro 32k", contextWindow: 32768, maxTokens: 4096, reasoning: false },
      { id: "doubao-pro-128k", name: "Doubao Pro 128k", contextWindow: 128000, maxTokens: 4096, reasoning: false },
      { id: "doubao-lite-32k", name: "Doubao Lite 32k", contextWindow: 32768, maxTokens: 4096, reasoning: false }
    ]
  },
  {
    id: "openrouter",
    name: "OpenRouter 全球聚合",
    tag: "全球聚合",
    protocol: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    devRole: true,
    reasoningEffort: true,
    desc: "聚合全球主流开源与闭源前沿模型",
    models: [
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (OpenRouter)", contextWindow: 64000, maxTokens: 8192, reasoning: true },
      { id: "deepseek/deepseek-chat", name: "DeepSeek V3 (OpenRouter)", contextWindow: 64000, maxTokens: 8192, reasoning: false },
      { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", contextWindow: 200000, maxTokens: 8192, reasoning: true },
      { id: "openai/gpt-4o", name: "GPT-4o", contextWindow: 128000, maxTokens: 4096, reasoning: false }
    ]
  },
  {
    id: "dashscope",
    name: "阿里云百炼 (DashScope)",
    tag: "阿里云",
    protocol: "openai-completions",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    devRole: false,
    reasoningEffort: true,
    desc: "通义千问 Qwen2.5 / QwQ 系列模型兼容端点",
    models: [
      { id: "qwen-plus", name: "通义千问 Plus", contextWindow: 128000, maxTokens: 8192, reasoning: false },
      { id: "qwen-max", name: "通义千问 Max", contextWindow: 32768, maxTokens: 8192, reasoning: false },
      { id: "qwen-turbo", name: "通义千问 Turbo", contextWindow: 128000, maxTokens: 8192, reasoning: false },
      { id: "qwq-32b-preview", name: "QwQ 32B Preview", contextWindow: 32768, maxTokens: 8192, reasoning: true }
    ]
  },
  {
    id: "zhipu",
    name: "智谱开放平台 (BigModel)",
    tag: "智谱 AI",
    protocol: "openai-completions",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    devRole: false,
    reasoningEffort: true,
    desc: "智谱 GLM-4 / GLM-Zero 系列兼容端点",
    models: [
      { id: "glm-4-plus", name: "GLM-4 Plus", contextWindow: 128000, maxTokens: 4096, reasoning: false },
      { id: "glm-4-air", name: "GLM-4 Air", contextWindow: 128000, maxTokens: 4096, reasoning: false },
      { id: "glm-4-flash", name: "GLM-4 Flash", contextWindow: 128000, maxTokens: 4096, reasoning: false },
      { id: "glm-zero-preview", name: "GLM Zero Preview", contextWindow: 64000, maxTokens: 8192, reasoning: true }
    ]
  },
  {
    id: "groq",
    name: "Groq 极速推理",
    tag: "极速硬件",
    protocol: "openai-completions",
    baseUrl: "https://api.groq.com/openai/v1",
    devRole: false,
    reasoningEffort: false,
    desc: "LPU 硬件加速超低延迟推理端点",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128000, maxTokens: 32768, reasoning: false },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", contextWindow: 128000, maxTokens: 8192, reasoning: false },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextWindow: 32768, maxTokens: 4096, reasoning: false }
    ]
  },
  {
    id: "moonshot",
    name: "月之暗面 (Moonshot / Kimi)",
    tag: "月之暗面",
    protocol: "openai-completions",
    baseUrl: "https://api.moonshot.cn/v1",
    devRole: false,
    reasoningEffort: false,
    desc: "Kimi 长上下文与深度问答模型",
    models: [
      { id: "moonshot-v1-128k", name: "Moonshot V1 128k", contextWindow: 128000, maxTokens: 4096, reasoning: false },
      { id: "moonshot-v1-32k", name: "Moonshot V1 32k", contextWindow: 32768, maxTokens: 4096, reasoning: false },
      { id: "moonshot-v1-8k", name: "Moonshot V1 8k", contextWindow: 8192, maxTokens: 4096, reasoning: false }
    ]
  },
  {
    id: "minimax",
    name: "MiniMax 开放平台",
    tag: "MiniMax",
    protocol: "openai-completions",
    baseUrl: "https://api.minimax.chat/v1",
    devRole: false,
    reasoningEffort: false,
    desc: "MiniMax Text-01 百万超长上下文模型",
    models: [
      { id: "MiniMax-Text-01", name: "MiniMax Text 01", contextWindow: 1000000, maxTokens: 8192, reasoning: false },
      { id: "abab6.5s-chat", name: "abab6.5s Chat", contextWindow: 245760, maxTokens: 8192, reasoning: false }
    ]
  },
  {
    id: "stepfun",
    name: "阶跃星辰 (StepFun)",
    tag: "阶跃星辰",
    protocol: "openai-completions",
    baseUrl: "https://api.stepfun.com/v1",
    devRole: false,
    reasoningEffort: false,
    desc: "Step 系列长文本与多模态大模型端点",
    models: [
      { id: "step-1-128k", name: "Step 1 128k", contextWindow: 128000, maxTokens: 4096, reasoning: false },
      { id: "step-1-32k", name: "Step 1 32k", contextWindow: 32768, maxTokens: 4096, reasoning: false },
      { id: "step-2-16k", name: "Step 2 16k", contextWindow: 16384, maxTokens: 4096, reasoning: false }
    ]
  },
  {
    id: "vllm",
    name: "vLLM 本地/自建服务",
    tag: "私有部署",
    protocol: "openai-completions",
    baseUrl: "http://localhost:8000/v1",
    devRole: false,
    reasoningEffort: true,
    desc: "vLLM 高并发私有化大模型服务端点",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3 (vLLM)", contextWindow: 64000, maxTokens: 8192, reasoning: false },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1 (vLLM)", contextWindow: 64000, maxTokens: 8192, reasoning: true },
      { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B (vLLM)", contextWindow: 32768, maxTokens: 8192, reasoning: false }
    ]
  },
  {
    id: "lmstudio",
    name: "LM Studio 本地服务",
    tag: "本地部署",
    protocol: "openai-completions",
    baseUrl: "http://localhost:1234/v1",
    devRole: false,
    reasoningEffort: false,
    desc: "LM Studio 桌面本地图形化服务端点",
    models: [
      { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 32768, maxTokens: 4096, reasoning: false },
      { id: "deepseek-r1-distill-qwen-14b", name: "DeepSeek R1 14B", contextWindow: 32768, maxTokens: 4096, reasoning: true }
    ]
  },
  {
    id: "together",
    name: "Together AI 云端",
    tag: "开源云端",
    protocol: "openai-completions",
    baseUrl: "https://api.together.xyz/v1",
    devRole: false,
    reasoningEffort: true,
    desc: "Together AI 广泛开源模型推理端点",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", contextWindow: 128000, maxTokens: 8192, reasoning: false },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1 (Together)", contextWindow: 64000, maxTokens: 8192, reasoning: true }
    ]
  }
];

// 通用热门模型预设（用于任意提供商的模型 ID 联想）
export const COMMON_MODEL_PRESETS = [
  { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", contextWindow: 64000, maxTokens: 8192, reasoning: false, tag: "热门推荐", desc: "高性价比通用强模型" },
  { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: 64000, maxTokens: 8192, reasoning: true, tag: "深度推理", desc: "全尺寸强推理大模型" },
  { id: "deepseek-chat", name: "DeepSeek Chat", contextWindow: 64000, maxTokens: 8192, reasoning: false, tag: "官方标准", desc: "DeepSeek-V3 对话端点" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner", contextWindow: 64000, maxTokens: 8192, reasoning: true, tag: "官方推理", desc: "DeepSeek-R1 推理端点" },
  { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", contextWindow: 32768, maxTokens: 8192, reasoning: false, tag: "开源旗舰", desc: "通义千问开源旗舰指令模型" },
  { id: "Qwen/QwQ-32B-Preview", name: "QwQ 32B Preview", contextWindow: 32768, maxTokens: 8192, reasoning: true, tag: "深度思考", desc: "千问推理大模型" },
  { id: "qwen-plus", name: "通义千问 Plus", contextWindow: 128000, maxTokens: 8192, reasoning: false, tag: "阿里百炼", desc: "能力均衡长上下文" },
  { id: "qwen-max", name: "通义千问 Max", contextWindow: 32768, maxTokens: 8192, reasoning: false, tag: "阿里百炼", desc: "复杂任务主力模型" },
  { id: "glm-4-plus", name: "GLM-4 Plus", contextWindow: 128000, maxTokens: 4096, reasoning: false, tag: "智谱旗舰", desc: "智谱新一代旗舰模型" },
  { id: "moonshot-v1-128k", name: "Moonshot V1 128k", contextWindow: 128000, maxTokens: 4096, reasoning: false, tag: "长文本", desc: "Kimi 128k 长文本模型" },
  { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", contextWindow: 200000, maxTokens: 8192, reasoning: true, tag: "混合推理", desc: "Anthropic 旗舰混合推理模型" },
  { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxTokens: 4096, reasoning: false, tag: "全模态", desc: "OpenAI 旗舰全模态模型" },
  { id: "o3-mini", name: "o3-mini", contextWindow: 200000, maxTokens: 65536, reasoning: true, tag: "深度推理", desc: "OpenAI 高速推理模型" },
  { id: "llama3.3:latest", name: "Llama 3.3 70B", contextWindow: 32768, maxTokens: 4096, reasoning: false, tag: "Ollama", desc: "Meta 开源最新旗舰" },
  { id: "deepseek-r1:8b", name: "DeepSeek R1 8B", contextWindow: 32768, maxTokens: 4096, reasoning: true, tag: "Ollama", desc: "蒸馏版轻量推理模型" },
  { id: "deepseek-r1:14b", name: "DeepSeek R1 14B", contextWindow: 32768, maxTokens: 4096, reasoning: true, tag: "Ollama", desc: "蒸馏版中型推理模型" }
];

// ============================================================================
// 填表历史记录管理器 (Autofill History Manager)
// ============================================================================
const STORAGE_KEY = "pi_dl_autofill_history_v1";

export const getAutofillHistory = (category) => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed[category]) ? parsed[category] : [];
  } catch {
    return [];
  }
};

export const saveAutofillHistory = (category, item) => {
  if (!item || !category) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    if (!Array.isArray(data[category])) {
      data[category] = [];
    }

    const value = typeof item === "string" ? item.trim() : (item.id || item.value || "").trim();
    if (!value) return;

    // 去重并放入首位
    data[category] = data[category].filter((x) => {
      const xVal = typeof x === "string" ? x : (x.id || x.value || "");
      return xVal.toLowerCase() !== value.toLowerCase();
    });

    data[category].unshift(typeof item === "string" ? { id: value, name: value, savedAt: Date.now() } : { ...item, savedAt: Date.now() });

    // 限制单类目最多保留 20 条
    if (data[category].length > 20) {
      data[category] = data[category].slice(0, 20);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Failed to save autofill history:", err);
  }
};

export const clearAutofillHistory = (category) => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (category) {
      delete data[category];
    } else {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Failed to clear autofill history:", err);
  }
};

// ============================================================================
// 全局激活的 SketchAutoFill 实例追踪与关闭逻辑
// ============================================================================
let activeAutoFill = null;

// 点击外部关闭全局监听
document.addEventListener("pointerdown", (e) => {
  if (activeAutoFill) {
    if (!activeAutoFill.input.contains(e.target) && !activeAutoFill.dropdown.contains(e.target)) {
      activeAutoFill.close();
    }
  }
});

// 全局注册 Esc 拦截
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeAutoFill && activeAutoFill.isOpen) {
    activeAutoFill.close();
    e.stopPropagation();
  }
});

// 全局注册右键回退 (Step Back) 拦截
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    if (typeof window.__piRegisterStepBack === "function") {
      window.__piRegisterStepBack(() => {
        if (activeAutoFill && activeAutoFill.isOpen) {
          activeAutoFill.close();
          return true; // 消耗当前回退
        }
        return false;
      });
    }
  });

  window.addEventListener("pi:step-back", (e) => {
    if (activeAutoFill && activeAutoFill.isOpen) {
      activeAutoFill.close();
      e.preventDefault();
    }
  });
}

// ============================================================================
// SketchAutoFill 核心类定义
// ============================================================================
export class SketchAutoFill {
  /**
   * @param {HTMLInputElement} inputElement 目标输入框
   * @param {Object} options 配置项
   * @param {string} options.type 联想类型 ('provider' | 'model' | 'url' | 'custom')
   * @param {Array} [options.presets] 自定义预设列表
   * @param {Function} [options.getPresets] 动态获取预设的回调
   * @param {Function} [options.onSelect] 选中回调 function(item, input)
   * @param {string} [options.title] 浮层标题
   */
  constructor(inputElement, options = {}) {
    if (!inputElement || inputElement.__sketchAutoFill) {
      return inputElement?.__sketchAutoFill;
    }

    this.input = inputElement;
    this.input.__sketchAutoFill = this;
    this.options = options;
    this.type = options.type || "custom";

    this.isOpen = false;
    this.highlightedIndex = -1;
    this.currentItems = [];

    // 彻底消灭浏览器原生原生 autofill 弹窗与破相属性
    this._suppressNativeAutofill();

    this._buildUI();
    this._bindEvents();
  }

  /**
   * 抑制浏览器原生 Autofill / Autocomplete
   */
  _suppressNativeAutofill() {
    this.input.setAttribute("autocomplete", "off");
    this.input.setAttribute("autocorrect", "off");
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("spellcheck", "false");
    this.input.setAttribute("data-form-type", "other");
  }

  /**
   * 构建浮层 DOM
   */
  _buildUI() {
    this.dropdown = document.createElement("div");
    this.dropdown.className = "sketch-autofill-dropdown";
    this.dropdown.setAttribute("role", "listbox");
    this.dropdown.setAttribute("tabindex", "-1");
    this.dropdown.setAttribute("data-autofill-for", this.input.id || this.type);

    // 挂载到 body 避免被父级 overflow: hidden / drawer 裁剪
    document.body.appendChild(this.dropdown);
  }

  /**
   * 绑定事件监听
   */
  _bindEvents() {
    this.input.addEventListener("focus", () => {
      this.open();
    });

    this.input.addEventListener("click", () => {
      if (!this.isOpen) {
        this.open();
      }
    });

    this.input.addEventListener("input", () => {
      this.renderItems(this.input.value);
      if (!this.isOpen) {
        this.open();
      }
    });

    this.input.addEventListener("keydown", (e) => {
      this._onKeyDown(e);
    });

    // 监听窗口大小改变或滚动以重定位
    this._repositionHandler = () => {
      if (this.isOpen) {
        this._updatePosition();
      }
    };
    window.addEventListener("resize", this._repositionHandler);
    window.addEventListener("scroll", this._repositionHandler, true);
  }

  /**
   * 更新浮层定位 (绝对吸附在输入框下方或上方)
   */
  _updatePosition() {
    if (!this.isOpen) return;

    const rect = this.input.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.close();
      return;
    }

    const margin = 4;
    const minWidth = Math.max(rect.width, 280);
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    // 默认向下展开，若下方空间不足 220px 且上方空间更大则向上展开
    let top, maxHeight;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      maxHeight = Math.min(spaceAbove - margin * 2, 320);
      top = rect.top - margin - maxHeight;
      this.dropdown.classList.add("position-above");
    } else {
      maxHeight = Math.min(spaceBelow - margin * 2, 340);
      top = rect.bottom + margin;
      this.dropdown.classList.remove("position-above");
    }

    // 左右对齐与屏幕边缘碰撞保护
    let left = rect.left;
    const rightOverflow = left + minWidth - (window.innerWidth - 12);
    if (rightOverflow > 0) {
      left = Math.max(12, left - rightOverflow);
    }

    this.dropdown.style.top = `${top}px`;
    this.dropdown.style.left = `${left}px`;
    this.dropdown.style.width = `${minWidth}px`;
    this.dropdown.style.maxHeight = `${maxHeight}px`;
  }

  /**
   * 获取候选项数据源 (整合预设库与历史记录)
   */
  _getRawItems() {
    let presets = [];
    if (typeof this.options.getPresets === "function") {
      presets = this.options.getPresets() || [];
    } else if (Array.isArray(this.options.presets)) {
      presets = this.options.presets;
    } else if (this.type === "provider") {
      presets = PROVIDER_PRESETS;
    } else if (this.type === "model" || this.type.startsWith("model:")) {
      presets = COMMON_MODEL_PRESETS;
    }

    const history = getAutofillHistory(this.type);
    return { presets, history };
  }

  /**
   * 动态更新候选项预设列表与标题
   * @param {Array} newPresets
   * @param {string} [newTitle]
   */
  updatePresets(newPresets, newTitle) {
    if (Array.isArray(newPresets)) {
      this.options.presets = newPresets;
    }
    if (newTitle) {
      this.options.title = newTitle;
    }
    if (this.isOpen) {
      this.renderItems(this.input.value);
    }
  }

  /**
   * 渲染浮层内容
   */
  renderItems(query = "") {
    const q = (query || "").trim().toLowerCase();
    const { presets, history } = this._getRawItems();

    // 过滤与排序
    const filteredHistory = history.filter((h) => {
      const id = (h.id || h.value || "").toLowerCase();
      const name = (h.name || "").toLowerCase();
      return !q || id.includes(q) || name.includes(q);
    });

    const filteredPresets = presets.filter((p) => {
      const id = (p.id || "").toLowerCase();
      const name = (p.name || "").toLowerCase();
      const tag = (p.tag || "").toLowerCase();
      const desc = (p.desc || "").toLowerCase();
      return !q || id.includes(q) || name.includes(q) || tag.includes(q) || desc.includes(q);
    });

    this.dropdown.innerHTML = "";

    // 顶部标题栏
    const header = document.createElement("div");
    header.className = "sketch-autofill-header";
    
    let titleText = this.options.title || "手绘推荐与快速填表";
    if (this.type === "provider") titleText = "常用运营商预设与智能联动";
    if (this.type === "model" || this.type.startsWith("model:")) {
      titleText = this.options.title || "热门模型推荐与参数预填";
    }

    header.innerHTML = `
      <span class="sketch-autofill-title"><span class="sketch-autofill-icon">${ICONS.spark}</span> ${titleText}</span>
      <span class="sketch-autofill-tip">↑↓ 选择 · Enter 填入 · Esc 收起</span>
    `;
    this.dropdown.appendChild(header);

    const listContainer = document.createElement("div");
    listContainer.className = "sketch-autofill-list";

    this.currentItems = [];

    // 1. 历史记录项
    if (filteredHistory.length > 0) {
      const historyGroupTitle = document.createElement("div");
      historyGroupTitle.className = "sketch-autofill-group-title";
      historyGroupTitle.innerHTML = `<span>最近填表历史</span>`;
      listContainer.appendChild(historyGroupTitle);

      filteredHistory.forEach((h) => {
        const itemEl = this._createItemElement(h, true, q);
        listContainer.appendChild(itemEl);
        this.currentItems.push({ data: h, element: itemEl, isHistory: true });
      });
    }

    // 2. 预设项
    if (filteredPresets.length > 0) {
      if (filteredHistory.length > 0) {
        const presetsGroupTitle = document.createElement("div");
        presetsGroupTitle.className = "sketch-autofill-group-title";
        presetsGroupTitle.innerHTML = `<span>推荐与同步预设</span>`;
        listContainer.appendChild(presetsGroupTitle);
      }

      filteredPresets.forEach((p) => {
        const itemEl = this._createItemElement(p, false, q);
        listContainer.appendChild(itemEl);
        this.currentItems.push({ data: p, element: itemEl, isHistory: false });
      });
    }

    // 空状态
    if (this.currentItems.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "sketch-autofill-empty";
      emptyEl.textContent = q ? `无匹配预设 "${q}"，按 Enter 直接使用当前输入` : "暂无可用推荐预设";
      listContainer.appendChild(emptyEl);
    }

    this.dropdown.appendChild(listContainer);

    // 底部工具栏 (若有历史记录则提供清除按钮)
    if (history.length > 0) {
      const footer = document.createElement("div");
      footer.className = "sketch-autofill-footer";
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "sketch-autofill-clear-btn";
      clearBtn.innerHTML = `<span>清空历史</span>`;
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        clearAutofillHistory(this.type);
        this.renderItems(this.input.value);
      });
      footer.appendChild(clearBtn);
      this.dropdown.appendChild(footer);
    }

    // 重置高亮索引
    this.highlightedIndex = this.currentItems.length > 0 ? 0 : -1;
    this._updateHighlight();
  }

  /**
   * 生成单个条目 DOM
   */
  _createItemElement(item, isHistory, query) {
    const el = document.createElement("div");
    el.className = "sketch-autofill-item";
    el.setAttribute("role", "option");

    const itemId = item.id || item.value || "";
    const itemName = item.name || itemId;
    const itemTag = isHistory ? "历史" : (item.tag || item.protocol || "");
    const itemDesc = item.desc || (item.baseUrl ? `URL: ${item.baseUrl}` : "");

    // 高亮文本辅助函数
    const highlightMatch = (text, q) => {
      if (!q || !text) return escapeHtml(text || "");
      const lower = text.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx === -1) return escapeHtml(text);
      const before = escapeHtml(text.slice(0, idx));
      const match = escapeHtml(text.slice(idx, idx + q.length));
      const after = escapeHtml(text.slice(idx + q.length));
      return `${before}<mark class="sketch-autofill-mark">${match}</mark>${after}`;
    };

    let iconSvg = ICONS.spark;
    if (isHistory) iconSvg = ICONS.clock;
    else if (this.type === "provider") iconSvg = ICONS.server;
    else if (this.type === "model" || this.type.startsWith("model:")) iconSvg = ICONS.cube;
    else if (this.type === "url") iconSvg = ICONS.link;

    el.innerHTML = `
      <span class="sketch-autofill-item-icon">${iconSvg}</span>
      <div class="sketch-autofill-item-content">
        <div class="sketch-autofill-item-main">
          <span class="sketch-autofill-item-id">${highlightMatch(itemId, query)}</span>
          ${itemName && itemName !== itemId ? `<span class="sketch-autofill-item-name">${highlightMatch(itemName, query)}</span>` : ""}
          ${itemTag ? `<span class="sketch-autofill-item-badge ${isHistory ? 'history' : ''}">${escapeHtml(itemTag)}</span>` : ""}
        </div>
        ${itemDesc ? `<div class="sketch-autofill-item-desc">${escapeHtml(itemDesc)}</div>` : ""}
      </div>
      <span class="sketch-autofill-item-action" title="一键填入">${ICONS.arrowRight}</span>
    `;

    el.addEventListener("pointerdown", (e) => {
      // 阻止失焦并立即选择
      e.preventDefault();
      this.selectItem(item);
    });

    return el;
  }

  /**
   * 高亮当前条目
   */
  _updateHighlight() {
    this.currentItems.forEach((ci, idx) => {
      if (idx === this.highlightedIndex) {
        ci.element.classList.add("highlighted");
        ci.element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        ci.element.classList.remove("highlighted");
      }
    });
  }

  /**
   * 键盘事件处理
   */
  _onKeyDown(e) {
    if (!this.isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        this.open();
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.currentItems.length === 0) return;
      this.highlightedIndex = (this.highlightedIndex + 1) % this.currentItems.length;
      this._updateHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.currentItems.length === 0) return;
      this.highlightedIndex = (this.highlightedIndex - 1 + this.currentItems.length) % this.currentItems.length;
      this._updateHighlight();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (this.highlightedIndex >= 0 && this.highlightedIndex < this.currentItems.length) {
        e.preventDefault();
        const selected = this.currentItems[this.highlightedIndex].data;
        this.selectItem(selected);
      } else {
        this.close();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  /**
   * 选中条目并触发填表联动
   */
  selectItem(item) {
    const value = item.id || item.value || "";
    this.input.value = value;
    
    // 派发原生 change 与 input 事件
    this.input.dispatchEvent(new Event("input", { bubbles: true }));
    this.input.dispatchEvent(new Event("change", { bubbles: true }));

    // 保存到历史记忆池
    saveAutofillHistory(this.type, item);

    // 触发自定义选择回调
    if (typeof this.options.onSelect === "function") {
      this.options.onSelect(item, this.input);
    }

    this.close();
  }

  /**
   * 打开浮层
   */
  open() {
    if (activeAutoFill && activeAutoFill !== this) {
      activeAutoFill.close();
    }

    this.renderItems(this.input.value);
    this.isOpen = true;
    activeAutoFill = this;

    this.dropdown.classList.add("open");
    this._updatePosition();
  }

  /**
   * 关闭浮层
   */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.dropdown.classList.remove("open");
    if (activeAutoFill === this) {
      activeAutoFill = null;
    }
  }

  /**
   * 销毁实例
   */
  destroy() {
    this.close();
    if (this.dropdown && this.dropdown.parentNode) {
      this.dropdown.parentNode.removeChild(this.dropdown);
    }
    window.removeEventListener("resize", this._repositionHandler);
    window.removeEventListener("scroll", this._repositionHandler, true);
    delete this.input.__sketchAutoFill;
  }
}

// ============================================================================
// 便捷绑定与批量增强方法
// ============================================================================

/**
 * 增强单个输入框的手绘填表与联想能力
 * @param {HTMLInputElement|string} target 
 * @param {Object} options 
 * @returns {SketchAutoFill|null}
 */
export const enhanceInputAutoFill = (target, options = {}) => {
  const el = typeof target === "string" ? document.getElementById(target) : target;
  if (!el || !(el instanceof HTMLInputElement)) return null;
  return new SketchAutoFill(el, options);
};

/**
 * 批量扫描与增强指定容器内的输入框
 * @param {HTMLElement} [container=document]
 */
export const enhanceAllAutoFills = (container = document) => {
  // 1. 全域消灭所有 input 的原生 autofill
  const allInputs = container.querySelectorAll("input:not([type='checkbox']):not([type='radio']):not([type='file'])");
  allInputs.forEach((inp) => {
    inp.setAttribute("autocomplete", "off");
    inp.setAttribute("autocorrect", "off");
    inp.setAttribute("autocapitalize", "off");
    inp.setAttribute("spellcheck", "false");
  });
};

/**
 * HTML 转义辅助函数
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
