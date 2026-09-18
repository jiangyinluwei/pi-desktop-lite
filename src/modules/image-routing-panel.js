import { configService } from "../services/config-service.js";
import { settingsStore } from "../services/stores/settings-store.js";
import { enhanceSelect } from "../services/sketch-select.js";
import { bindAll } from "../lib/el-binder.js";
import { isModelMultimodal, isImageGenerationApiType } from "../services/multimodal-detector.js";

/**
 * 初始化独立生图与多模态路由面板 (pane-image-routing)
 * @param {Object} ctx 共享应用上下文
 */
export function initImageRoutingPanel(ctx) {
  const api = ctx.api;

  const el = bindAll({
    imageRoutingSwitch: "image-routing-switch",
    imageRoutingBody: "image-routing-body",
    imageRoutingModelSelect: "image-routing-model-select",
    visionRoutingModelSelect: "vision-routing-model-select",
    btnGotoCustomProviders: "btn-goto-custom-providers",
  });

  const imageRoutingSwitch = el.imageRoutingSwitch;
  const imageRoutingBody = el.imageRoutingBody;
  const imageRoutingModelSelect = el.imageRoutingModelSelect;
  const visionRoutingModelSelect = el.visionRoutingModelSelect;
  const btnGotoCustomProviders = el.btnGotoCustomProviders;

  /**
   * 填充生图与识图模型下拉框
   * 遵循严格原则：生图下拉框仅列出支持专用生图协议的自定义模型；聊天补全模型绝不可选
   */
  const populateImageRoutingModels = async () => {
    if (!imageRoutingModelSelect) return;
    const currentConfig = configService.getImageRoutingConfig();
    const selectedGenKey = currentConfig.routingModel
      ? `${currentConfig.routingModel.provider}::${currentConfig.routingModel.modelId}`
      : "";
    const selectedVisionKey = currentConfig.visionModel
      ? `${currentConfig.visionModel.provider}::${currentConfig.visionModel.modelId}`
      : "";

    // 1. 获取最新自定义运营商配置 (优先内存缓存，未就绪时异步读取)
    let customConf = configService.getCustomModelsSync();
    if (!customConf?.providers || Object.keys(customConf.providers).length === 0) {
      try {
        customConf = (await configService.getCustomModels()) || { providers: {} };
      } catch (err) {
        console.warn("[ImageRouting] Failed to fetch custom models:", err);
      }
    }
    const providers = customConf?.providers || {};

    // 2. 聚合专用生图模型 (必须使用 openai-images 或 dashscope-async-image 协议)
    const imageGenCandidates = [];
    Object.entries(providers).forEach(([provId, prov]) => {
      const provApi = prov.api || "";
      if (isImageGenerationApiType(provApi)) {
        if (Array.isArray(prov.models)) {
          prov.models.forEach((m) => {
            imageGenCandidates.push({
              provider: provId,
              id: m.id,
              name: m.name || m.id,
              apiType: provApi,
            });
          });
        }
      }
    });

    // 3. 聚合多模态识图模型 (支持白名单 + 官方目录 + 自定义模型中具备 vision 能力的模型)
    const visionCandidates = [];
    const seenVision = new Set();

    const addVisionCandidate = (m) => {
      if (!m || !m.provider || !m.id) return;
      const key = `${m.provider.toLowerCase()}::${m.id.toLowerCase()}`;
      if (seenVision.has(key)) return;
      seenVision.add(key);
      const isMulti = isModelMultimodal(m);
      visionCandidates.push({
        provider: m.provider,
        id: m.id,
        name: m.name || m.id,
        isMultimodal: isMulti,
      });
    };

    const whitelist = configService.loadModelWhitelist() || [];
    whitelist.forEach(addVisionCandidate);

    const catalog = settingsStore.officialCatalog || [];
    catalog.forEach((prov) => {
      if (Array.isArray(prov.models)) {
        prov.models.forEach((m) => addVisionCandidate({ ...m, provider: prov.id }));
      }
    });

    Object.entries(providers).forEach(([provId, prov]) => {
      // 专用生图协议模型不具备对话补全能力，严禁混入识图候选
      if (isImageGenerationApiType(prov.api || "")) return;
      if (Array.isArray(prov.models)) {
        prov.models.forEach((m) => addVisionCandidate({ ...m, provider: provId }));
      }
    });

    // 识图模型排序：具备多模态的排在前面
    visionCandidates.sort((a, b) => {
      if (a.isMultimodal && !b.isMultimodal) return -1;
      if (!a.isMultimodal && b.isMultimodal) return 1;
      return a.name.localeCompare(b.name);
    });

    // 3. 填充生图路由下拉框 (严格受限)
    imageRoutingModelSelect.innerHTML = "";
    if (imageGenCandidates.length === 0) {
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "-- 暂无可用的专用生图模型（请在自定义通道中配置） --";
      imageRoutingModelSelect.appendChild(emptyOpt);
    } else {
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "-- 请选择专用生图模型 --";
      imageRoutingModelSelect.appendChild(defaultOpt);

      imageGenCandidates.forEach((m) => {
        const opt = document.createElement("option");
        const key = `${m.provider}::${m.id}`;
        opt.value = key;
        const typeTag = m.apiType.includes("dashscope") ? " [DashScope 异步生图]" : " [/images/generations 生图]";
        opt.textContent = `${m.provider.toUpperCase()} - ${m.name}${typeTag}`;
        if (selectedGenKey && key.toLowerCase() === selectedGenKey.toLowerCase()) {
          opt.selected = true;
        }
        imageRoutingModelSelect.appendChild(opt);
      });
    }

    // 4. 填充独立识图路由下拉框
    if (visionRoutingModelSelect) {
      visionRoutingModelSelect.innerHTML = `<option value="">不单独指定（识图任务走会话模型常规链路）</option>`;
      visionCandidates.forEach((m) => {
        const opt = document.createElement("option");
        const key = `${m.provider}::${m.id}`;
        opt.value = key;
        const multiTag = m.isMultimodal ? " ⚡ [多模态识图]" : "";
        opt.textContent = `${m.provider.toUpperCase()} - ${m.name}${multiTag}`;
        if (selectedVisionKey && key.toLowerCase() === selectedVisionKey.toLowerCase()) {
          opt.selected = true;
        }
        visionRoutingModelSelect.appendChild(opt);
      });
    }

    // 5. 增强 SketchSelect 手绘下拉控件
    if (imageRoutingModelSelect.__sketchSelect) {
      imageRoutingModelSelect.__sketchSelect.syncOptions();
    } else {
      enhanceSelect(imageRoutingModelSelect);
    }

    if (visionRoutingModelSelect) {
      if (visionRoutingModelSelect.__sketchSelect) {
        visionRoutingModelSelect.__sketchSelect.syncOptions();
      } else {
        enhanceSelect(visionRoutingModelSelect);
      }
    }
  };

  /**
   * 同步界面状态与持久化配置
   */
  const syncImageRoutingUI = () => {
    const routingConfig = configService.getImageRoutingConfig();
    if (imageRoutingSwitch) {
      imageRoutingSwitch.checked = Boolean(routingConfig.enabled);
    }
    if (imageRoutingBody) {
      imageRoutingBody.classList.toggle("disabled-routing", !routingConfig.enabled);
    }
    populateImageRoutingModels();
  };

  // 绑定开关事件
  if (imageRoutingSwitch) {
    imageRoutingSwitch.addEventListener("change", () => {
      const enabled = imageRoutingSwitch.checked;
      if (imageRoutingBody) {
        imageRoutingBody.classList.toggle("disabled-routing", !enabled);
      }
      configService.saveImageRoutingConfig({ enabled });
    });
  }

  // 绑定生图模型选择事件
  if (imageRoutingModelSelect) {
    imageRoutingModelSelect.addEventListener("change", () => {
      const val = imageRoutingModelSelect.value;
      if (!val) {
        configService.saveImageRoutingConfig({ routingModel: null });
        return;
      }
      const [provider, modelId] = val.split("::");
      const selectedOption = imageRoutingModelSelect.options[imageRoutingModelSelect.selectedIndex];
      const modelName = selectedOption ? selectedOption.textContent.replace(/ \[[^\]]+\]$/, "") : modelId;
      configService.saveImageRoutingConfig({
        routingModel: { provider, modelId, name: modelName },
      });
    });
  }

  // 绑定识图模型选择事件
  if (visionRoutingModelSelect) {
    visionRoutingModelSelect.addEventListener("change", () => {
      const val = visionRoutingModelSelect.value;
      if (!val) {
        configService.saveImageRoutingConfig({ separateVisionModel: false, visionModel: null });
        return;
      }
      const [provider, modelId] = val.split("::");
      const selectedOption = visionRoutingModelSelect.options[visionRoutingModelSelect.selectedIndex];
      const modelName = selectedOption ? selectedOption.textContent.replace(/ ⚡.*$/, "") : modelId;
      configService.saveImageRoutingConfig({
        separateVisionModel: true,
        visionModel: { provider, modelId, name: modelName },
      });
    });
  }

  // 快捷跳转到自定义运营商配置 (在 Page 内平滑切回「模型配置」子 tab 并展开自定义抽屉)
  if (btnGotoCustomProviders) {
    btnGotoCustomProviders.addEventListener("click", (e) => {
      e.preventDefault();
      switchModelSubtab("subpane-models-list");
      const btnCustom = document.getElementById("btn-toggle-custom");
      if (btnCustom) {
        btnCustom.click();
      }
    });
  }

  // 绑定「模型配置」Page 内部顶部并列 Sub-Tab 切换交互
  const switchModelSubtab = (targetSubtabId) => {
    if (!targetSubtabId) return;
    const subtabBtns = document.querySelectorAll(".model-subtab-btn");
    const subpanes = document.querySelectorAll(".model-subpane");

    subtabBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-subtab") === targetSubtabId);
    });
    subpanes.forEach((pane) => {
      pane.classList.toggle("active", pane.id === targetSubtabId);
    });

    if (targetSubtabId === "subpane-image-routing") {
      syncImageRoutingUI();
    }
  };

  const subtabBtns = document.querySelectorAll(".model-subtab-btn");
  subtabBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetSubtab = btn.getAttribute("data-subtab");
      switchModelSubtab(targetSubtab);
    });
  });

  // 监听配置变更外部广播
  configService.addEventListener("image-routing-change", () => {
    syncImageRoutingUI();
  });

  configService.addEventListener("custom-models-change", () => {
    populateImageRoutingModels();
  });

  // 暴露 API 槽供设置页切换与模型变更联动调用
  // （populateImageRoutingModels 保持模块内部函数：变更联动统一走 custom-models-change
  //   事件驱动 + syncImageRoutingUI 内部调用，不设外部槽位）
  api.syncImageRoutingUI = syncImageRoutingUI;

  // 首次初始化
  syncImageRoutingUI();
}

