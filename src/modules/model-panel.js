import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { configService } from "../services/config-service.js";
import { enhanceSelect } from "../services/sketch-select.js";
import { sketchAlert } from "../services/sketch-modal.js";

/**
 * 当前模型列表、白名单 MRU 与官方通道配置
 */
export function initModelPanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const flowModelName = el.flowModelName;
  const flowModelTag = el.flowModelTag;
  const currentModelProvider = el.currentModelProvider;
  const currentModelName = el.currentModelName;
  const currentModelInfo = el.currentModelInfo;
  const thinkingSelectDropdown = el.thinkingSelectDropdown;
  const whitelistModelsList = el.whitelistModelsList;
  const autoReconnectSwitch = el.autoReconnectSwitch;
  const officialProviderSelect = el.officialProviderSelect;
  const officialProviderTitle = el.officialProviderTitle;
  const officialProviderDesc = el.officialProviderDesc;
  const officialProviderDoc = el.officialProviderDoc;
  const officialApiKeyInput = el.officialApiKeyInput;
  const btnToggleKeyVisibility = el.btnToggleKeyVisibility;
  const btnSaveOfficialKey = el.btnSaveOfficialKey;
  const officialKeyStatus = el.officialKeyStatus;
  const officialModelsGrid = el.officialModelsGrid;
  const btnFetchOfficialModels = el.btnFetchOfficialModels;
  const btnFetchOfficialModelsText = el.btnFetchOfficialModelsText;

  // ==========================================================================
  // 3. 当前模型列表与白名单机制 (最近选用 MRU 自动排序 + 选中模型禁止删除保护)
  // ==========================================================================

  const updateModelUI = (model, thinkingLevel = null) => {
    if (!piClient.hasKernel()) {
      if (flowModelName) flowModelName.textContent = "未检测到pi内核";
      if (flowModelTag) flowModelTag.classList.add("kernel-missing");
      if (typeof document !== "undefined" && document.body) {
        document.body.classList.add("kernel-missing");
      }
      if (currentModelProvider) currentModelProvider.textContent = "未检测到内核";
      if (currentModelName) currentModelName.textContent = "未安装";
      if (currentModelInfo) currentModelInfo.textContent = "请前往「设置 ➔ 内核」面板一键下载安装";
      return;
    }

    if (flowModelTag) flowModelTag.classList.remove("kernel-missing");
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("kernel-missing");
    }

    if (!model) return;
    const provider = model.provider || "anthropic";
    const name = model.name || model.id || "Unknown Model";
    const contextWin = model.contextWindow
      ? `${(model.contextWindow / 1000).toFixed(0)}k context`
      : "";
    const reasoningText = model.reasoning ? "支持深度推理 (Reasoning)" : "标准对话";

    if (currentModelProvider) currentModelProvider.textContent = provider.toUpperCase();
    if (currentModelName) currentModelName.textContent = name;
    if (currentModelInfo) {
      currentModelInfo.textContent = `${contextWin} · ${reasoningText}`;
    }
    if (flowModelName) {
      flowModelName.textContent = name;
    }

    if (thinkingLevel && thinkingSelectDropdown) {
      thinkingSelectDropdown.value = thinkingLevel;
    }
  };

  const renderWhitelistModels = (activeModel) => {
    if (!whitelistModelsList) return;

    if (settings.expandedChannel) {
      whitelistModelsList.classList.add("collapsed-single");
    } else {
      whitelistModelsList.classList.remove("collapsed-single");
    }

    let whitelist = configService.loadModelWhitelist();

    if (!whitelist || whitelist.length === 0) {
      whitelistModelsList.innerHTML = `<div class="empty-sessions">暂无已添加的模型，请展开下方“官方通道”或“自定义通道”添加模型。</div>`;
      return;
    }

    // 确保当前选中的激活模型始终固定在第一行 (index 0)
    const curActive = activeModel || piClient.currentModel || (configService.getSelectedModel() ? {
      id: configService.getSelectedModel().modelId,
      provider: configService.getSelectedModel().provider
    } : null);

    if (curActive && curActive.id && curActive.provider) {
      const activeIdx = whitelist.findIndex(
        (m) =>
          m.id?.toLowerCase() === curActive.id?.toLowerCase() &&
          m.provider?.toLowerCase() === curActive.provider?.toLowerCase()
      );
      if (activeIdx > 0) {
        const [activeItem] = whitelist.splice(activeIdx, 1);
        whitelist.unshift(activeItem);
        configService.saveModelWhitelist(whitelist);
      }
    }

    whitelistModelsList.innerHTML = "";

    whitelist.forEach((m, index) => {
      const item = document.createElement("div");
      item.className = "whitelist-model-item";
      item.setAttribute("data-index", index.toString());

      const isActive =
        curActive &&
        curActive.id?.toLowerCase() === m.id?.toLowerCase() &&
        curActive.provider?.toLowerCase() === m.provider?.toLowerCase();

      if (isActive) {
        item.classList.add("active");
      }

      const contextWin = m.contextWindow
        ? `${(m.contextWindow / 1000).toFixed(0)}k context`
        : "";
      const reasoningTag = m.reasoning
        ? `<span class="flat-badge flat-badge-reasoning" style="display: inline-flex; align-items: center; gap: 4px;"><span class="badge-icon">${ICONS.sparkle}</span> 思考模型</span>`
        : "";
      const customTag = m.isCustom
        ? `<span class="flat-badge flat-badge-custom">自定义端点</span>`
        : "";

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
          <div class="model-item-info">
            <div class="model-item-header">
              <span class="flat-badge">${escapeHtml(m.provider?.toUpperCase() || "OTHER")}</span>
              <span class="model-item-name">${escapeHtml(m.name || m.id)}</span>
              ${reasoningTag}
              ${customTag}
            </div>
            <div class="model-item-meta">
              <span>ID: ${escapeHtml(m.id)}</span>
              ${contextWin ? `<span>· ${contextWin}</span>` : ""}
              ${m.maxTokens ? `<span>· max ${m.maxTokens} tokens</span>` : ""}
            </div>
          </div>
        </div>
        <div class="model-item-actions">
          ${
            isActive
              ? `<span class="flat-badge flat-badge-active">使用中</span>
                 <button type="button" class="flat-btn flat-btn-secondary mini btn-remove-model" disabled style="opacity: 0.35; cursor: not-allowed; display: inline-flex; align-items: center; gap: 4px;" title="当前使用中的模型禁止删除"><span class="btn-icon">${ICONS.lock}</span> 锁定</button>`
              : `<button type="button" class="flat-btn flat-btn-secondary mini btn-select-model">选用</button>
                 <button type="button" class="flat-btn flat-btn-secondary mini btn-remove-model" title="从列表移除" aria-label="从列表移除" style="display: inline-flex; align-items: center; justify-content: center; padding: 4px 6px;">${ICONS.close}</button>`
          }
        </div>
      `;

      // 选用按钮点击 -> 切换模型并将选用模型自动移到列表首位 (MRU)
      const selectBtn = item.querySelector(".btn-select-model");
      if (selectBtn) {
        selectBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          selectBtn.disabled = true;
          try {
            const switched = await piClient.setModel(m.provider, m.id);
            if (switched) {
              configService.saveSelectedModel(m.provider, m.id);
              updateModelUI(switched);
              renderWhitelistModels(switched);
            }
          } catch (err) {
            console.error("Failed to switch model:", err);
            await sketchAlert(`切换模型失败: ${err}`, { type: "error", title: "切换模型失败" });
          } finally {
            selectBtn.disabled = false;
          }
        });
      }

      // 移除按钮点击（激活中的模型已禁止删除）
      const removeBtn = item.querySelector(".btn-remove-model");
      if (removeBtn && !isActive) {
        removeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (isActive) {
            await sketchAlert("当前模型正在使用中，禁止删除！", { type: "warning", title: "模型保护" });
            return;
          }
          configService.removeModelFromWhitelist(m.provider, m.id);
          renderWhitelistModels(piClient.currentModel);
          if (typeof api.loadCustomProvidersConfig === "function") {
            api.loadCustomProvidersConfig();
          }
          if (typeof api.renderOfficialProviderDetails === "function" && officialProviderSelect?.value) {
            renderOfficialProviderDetails(officialProviderSelect.value);
          }
        });
      }

      whitelistModelsList.appendChild(item);
    });
  };

  const loadModelsAndState = async () => {
    try {
      // 同步「自动重连切换」勾选状态至设置页 UI
      if (autoReconnectSwitch) {
        autoReconnectSwitch.checked = configService.getAutoReconnectSwitch();
      }

      if (!piClient.hasKernel()) {
        if (flowModelName) flowModelName.textContent = "未检测到pi内核";
        updateModelUI(null);
        return;
      }

      const [state, catalog] = await Promise.all([
        piClient.getState(),
        configService.getOfficialModelsCatalog(),
      ]);

      settings.officialCatalog = catalog || [];

      // 检查白名单是否已存在，不存在则初始化
      let whitelist = configService.loadModelWhitelist();
      if (!whitelist || whitelist.length === 0) {
        if (state?.model) {
          configService.addModelToWhitelist(state.model);
        }
        settings.officialCatalog.forEach((p) => {
          p.models
            .filter((m) => m.is_default)
            .forEach((m) => {
              configService.addModelToWhitelist(m);
            });
        });
      }

      // 检查本地持久化的用户所选模型
      const savedModel = configService.getSelectedModel();
      let currentActiveModel = state?.model || null;

      if (
        savedModel &&
        savedModel.provider &&
        savedModel.modelId &&
        (!currentActiveModel ||
          currentActiveModel.id?.toLowerCase() !== savedModel.modelId.toLowerCase() ||
          currentActiveModel.provider?.toLowerCase() !== savedModel.provider.toLowerCase())
      ) {
        try {
          const switched = await piClient.setModel(savedModel.provider, savedModel.modelId);
          if (switched) currentActiveModel = switched;
        } catch (e) {
          console.warn("[Main] Auto-switch to saved model failed:", e);
        }
      }

      const savedThinking = configService.getDefaultThinkingLevel();
      if (savedThinking && state?.thinkingLevel !== savedThinking) {
        try {
          await piClient.setThinkingLevel(savedThinking);
        } catch (e) {
          console.warn("[Main] Auto-set saved thinking level failed:", e);
        }
      }

      updateModelUI(currentActiveModel, savedThinking || state?.thinkingLevel);
      renderWhitelistModels(currentActiveModel);
    } catch (err) {
      console.warn("[Main] Failed to load models and state:", err);
    }
  };

  if (thinkingSelectDropdown) {
    thinkingSelectDropdown.addEventListener("change", async () => {
      const level = thinkingSelectDropdown.value;
      try {
        await piClient.setThinkingLevel(level);
        configService.saveDefaultThinkingLevel(level);
        await configService.saveSettingsConfig({ defaultThinkingLevel: level });
      } catch (err) {
        console.error("Failed to change thinking level:", err);
      }
    });
  }

  piClient.addEventListener("model-change", (e) => {
    if (e.detail?.provider && e.detail?.id) {
      configService.touchModelAsRecentlyUsed(e.detail.provider, e.detail.id);
    }
    updateModelUI(e.detail);
    renderWhitelistModels(e.detail);
  });

  piClient.addEventListener("kernel-status-change", (e) => {
    if (e.detail?.hasKernel) {
      loadModelsAndState();
    } else {
      if (flowModelName) flowModelName.textContent = "未检测到pi内核";
      updateModelUI(null);
    }
  });

  // ==========================================================================
  // 4. 官方通道配置与自动拉取模型逻辑
  // ==========================================================================

  const renderOfficialProviderDetails = (providerId) => {
    const provMeta = settings.officialCatalog.find((p) => p.id === providerId);
    if (!provMeta) return;

    if (officialProviderTitle) officialProviderTitle.textContent = provMeta.name;
    if (officialProviderDesc) officialProviderDesc.textContent = provMeta.desc;
    if (officialProviderDoc) {
      officialProviderDoc.href = provMeta.doc_url || "#";
      officialProviderDoc.style.display = provMeta.doc_url ? "inline" : "none";
    }

    const authEntry =
      settings.currentOfficialAuth[provMeta.id] ||
      (provMeta.id.startsWith("opencode")
        ? settings.currentOfficialAuth["opencode-zen"] ||
          settings.currentOfficialAuth["opencode-go"] ||
          settings.currentOfficialAuth["opencode"]
        : null);
    const existingKey = typeof authEntry === "string" ? authEntry : authEntry?.key || "";

    if (officialApiKeyInput) {
      officialApiKeyInput.value = existingKey;
      officialApiKeyInput.placeholder = provMeta.placeholder || "输入 API Key";
    }

    if (officialKeyStatus) {
      if (existingKey) {
        officialKeyStatus.textContent = "● 已在 ~/.pi/agent/auth.json 中配置有效 Key";
        officialKeyStatus.style.color = "#10b981";
      } else {
        officialKeyStatus.textContent = "○ 未配置 API Key";
        officialKeyStatus.style.color = "var(--ink-muted)";
      }
    }

    if (officialModelsGrid) {
      officialModelsGrid.innerHTML = "";
      provMeta.models.forEach((m) => {
        const chip = document.createElement("div");
        chip.className = "official-model-chip";

        const isInWhitelist = configService.isModelInWhitelist(m.provider, m.id);
        const contextWin = m.context_window
          ? `${(m.context_window / 1000).toFixed(0)}k context`
          : "";
        const reasoningTag = m.reasoning
          ? `<span class="flat-badge flat-badge-reasoning" style="display: inline-flex; align-items: center; gap: 4px;"><span class="badge-icon">${ICONS.sparkle}</span> 思考</span>`
          : "";

        chip.innerHTML = `
          <div class="model-item-info">
            <div class="model-item-header">
              <span class="model-item-name">${escapeHtml(m.name || m.id)}</span>
              ${reasoningTag}
            </div>
            <div class="model-item-meta">
              <span>ID: ${escapeHtml(m.id)}</span>
              ${contextWin ? `<span>· ${contextWin}</span>` : ""}
            </div>
          </div>
          <button type="button" class="flat-btn ${isInWhitelist ? "flat-btn-secondary" : "flat-btn-primary"} mini btn-add-official-model" ${isInWhitelist ? "disabled" : ""} style="display: inline-flex; align-items: center; gap: 4px;">
            ${isInWhitelist ? `<span class="btn-icon">${ICONS.check}</span> 已添加` : "+ 添加到当前列表"}
          </button>
        `;

        const addBtn = chip.querySelector(".btn-add-official-model");
        if (addBtn && !isInWhitelist) {
          addBtn.addEventListener("click", () => {
            configService.addModelToWhitelist({
              id: m.id,
              name: m.name,
              provider: m.provider,
              contextWindow: m.context_window,
              maxTokens: m.max_tokens,
              reasoning: m.reasoning,
              isCustom: false,
            });
            addBtn.innerHTML = `<span class="btn-icon">${ICONS.check}</span> 已添加`;
            addBtn.className = "flat-btn flat-btn-secondary mini";
            addBtn.disabled = true;
            renderWhitelistModels(piClient.currentModel);
            if (typeof api.loadCustomProvidersConfig === "function") {
              api.loadCustomProvidersConfig();
            }
          });
        }

        officialModelsGrid.appendChild(chip);
      });
    }
  };

  const loadOfficialProvidersConfig = async () => {
    try {
      const [authConfig, catalog] = await Promise.all([
        configService.getAuthConfig(),
        configService.getOfficialModelsCatalog(),
      ]);

      settings.currentOfficialAuth = authConfig || {};
      settings.officialCatalog = catalog || [];

      if (officialProviderSelect) {
        officialProviderSelect.innerHTML = "";
        settings.officialCatalog.forEach((p, idx) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.models.length} 个模型)`;
          if (idx === 0) opt.selected = true;
          officialProviderSelect.appendChild(opt);
        });

        if (settings.officialCatalog.length > 0) {
          officialProviderSelect.value = settings.officialCatalog[0].id;
          renderOfficialProviderDetails(settings.officialCatalog[0].id);
        }

        if (officialProviderSelect.__sketchSelect) {
          officialProviderSelect.__sketchSelect.syncOptions();
        } else {
          enhanceSelect(officialProviderSelect);
        }
      }
    } catch (e) {
      console.warn("[Main] Load official config failed:", e);
    }
  };

  if (officialProviderSelect) {
    officialProviderSelect.addEventListener("change", () => {
      renderOfficialProviderDetails(officialProviderSelect.value);
      api.scrollSettingsToBottom(true);
    });
  }

  if (btnToggleKeyVisibility && officialApiKeyInput) {
    btnToggleKeyVisibility.addEventListener("click", () => {
      const isPwd = officialApiKeyInput.type === "password";
      officialApiKeyInput.type = isPwd ? "text" : "password";
      btnToggleKeyVisibility.innerHTML = isPwd ? ICONS.eye : ICONS.eyeOff;
    });
  }

  if (btnSaveOfficialKey && officialProviderSelect && officialApiKeyInput) {
    btnSaveOfficialKey.addEventListener("click", async () => {
      const provider = officialProviderSelect.value;
      const key = officialApiKeyInput.value.trim();
      btnSaveOfficialKey.disabled = true;

      try {
        await configService.saveProviderApiKey(provider, key);
        settings.currentOfficialAuth = await configService.getAuthConfig();
        renderOfficialProviderDetails(provider);
        await sketchAlert(`官方通道 [${provider}] API Key 已成功保存至 ~/.pi/agent/auth.json！`, { type: "success", title: "保存成功" });
      } catch (err) {
        console.error("Save API Key failed:", err);
        await sketchAlert(`保存失败: ${err}`, { type: "error", title: "保存失败" });
      } finally {
        btnSaveOfficialKey.disabled = false;
      }
    });
  }

  if (btnFetchOfficialModels && officialProviderSelect) {
    btnFetchOfficialModels.addEventListener("click", async () => {
      const provider = officialProviderSelect.value;
      if (!provider) return;

      btnFetchOfficialModels.disabled = true;
      if (btnFetchOfficialModelsText) {
        btnFetchOfficialModelsText.textContent = "正在拉取...";
      }

      try {
        const fetchedModels = await configService.fetchOfficialModels(provider);
        if (Array.isArray(fetchedModels) && fetchedModels.length > 0) {
          const provMeta = settings.officialCatalog.find((p) => p.id === provider);
          if (provMeta) {
            provMeta.models = fetchedModels;
          }
          renderOfficialProviderDetails(provider);
          api.scrollSettingsToBottom(true);
          if (officialKeyStatus) {
            officialKeyStatus.textContent = `● 成功从官网/内核拉取并同步 ${fetchedModels.length} 个最新可用模型`;
            officialKeyStatus.style.color = "#10b981";
          }
        } else {
          await sketchAlert(`未从官网拉取到新模型，已保持当前目录。`, { type: "info", title: "拉取完成" });
        }
      } catch (err) {
        console.error("[Main] Fetch official models failed:", err);
        await sketchAlert(`从官网拉取模型失败: ${err}`, { type: "error", title: "拉取失败" });
      } finally {
        btnFetchOfficialModels.disabled = false;
        if (btnFetchOfficialModelsText) {
          btnFetchOfficialModelsText.textContent = "从官网拉取最新模型";
        }
      }
    });
  }

  api.renderWhitelistModels = renderWhitelistModels;
  api.loadModelsAndState = loadModelsAndState;
  api.renderOfficialProviderDetails = renderOfficialProviderDetails;
  api.loadOfficialProvidersConfig = loadOfficialProvidersConfig;
}
