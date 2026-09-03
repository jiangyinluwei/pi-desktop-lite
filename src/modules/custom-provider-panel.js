import { escapeHtml } from "../lib/dom-utils.js";
import { ICONS } from "../lib/icons.js";
import { piClient } from "../services/pi-client.js";
import { configService } from "../services/config-service.js";
import { enhanceAllSelects } from "../services/sketch-select.js";
import { enhanceInputAutoFill, enhanceAllAutoFills, PROVIDER_PRESETS, COMMON_MODEL_PRESETS, saveAutofillHistory } from "../services/sketch-autofill.js";
import { sketchAlert, sketchConfirm } from "../services/sketch-modal.js";

/**
 * 两步式自定义通道配置与模型管理
 */
export function initCustomProviderPanel(ctx) {
  const el = ctx.el;
  const api = ctx.api;
  const view = ctx.view;
  const settings = ctx.settings;
  const flow = ctx.flow;
  const attachments = ctx.attachments;

  const officialProviderSelect = el.officialProviderSelect;
  const customProviderForm = el.customProviderForm;
  const customProviderId = el.customProviderId;
  const customApiType = el.customApiType;
  const customBaseUrl = el.customBaseUrl;
  const customApiKey = el.customApiKey;
  const customProvidersContainer = el.customProvidersContainer;

  // ==========================================================================
  // 5. 自定义通道两步式配置 (Step 1: 新增运营商, Step 2: 运营商内添加/管理模型)
  // ==========================================================================
  const loadCustomProvidersConfig = async () => {
    if (!customProvidersContainer) return;
    try {
      const customConfig = await configService.getCustomModels();
      const providers = customConfig?.providers || {};

      const providerKeys = Object.keys(providers);
      if (providerKeys.length === 0) {
        customProvidersContainer.innerHTML = `<div class="empty-sessions">暂无已配置的运营商，请在上方“步骤 1”中添加第一个运营商。</div>`;
        return;
      }

      customProvidersContainer.innerHTML = "";

      providerKeys.forEach((pKey) => {
        const provData = providers[pKey];
        const models = provData.models || [];

        const card = document.createElement("div");
        card.className = "custom-provider-card";

        const hasKey = provData.apiKey && provData.apiKey.trim().length > 0;
        const keyTag = hasKey
          ? `<span class="flat-badge" style="color: #10b981; border-color: #10b981;">Key: 已配置</span>`
          : `<span class="flat-badge" style="color: var(--ink-muted);">Key: 无</span>`;

        const compat = provData.compat || {};
        const supportsDeveloperRole = compat.supportsDeveloperRole !== undefined
          ? !!compat.supportsDeveloperRole
          : (provData.api === "openai-responses");
        const supportsReasoningEffort = compat.supportsReasoningEffort !== undefined
          ? !!compat.supportsReasoningEffort
          : false;

        const devRoleBadge = supportsDeveloperRole
          ? `<span class="flat-badge" style="color: #f59e0b; border-color: #f59e0b;" title="启用了 developer 消息角色">dev-role: 开</span>`
          : `<span class="flat-badge" style="color: #10b981; border-color: #10b981;" title="使用兼容的 system 消息角色 (安全)">system-role</span>`;

        card.innerHTML = `
          <div class="custom-provider-header">
            <div class="provider-info-left">
              <span class="flat-badge" style="color: #6366f1; border-color: #6366f1;">${escapeHtml(pKey.toUpperCase())}</span>
              <span class="flat-badge">${escapeHtml(provData.api || "openai-completions")}</span>
              ${keyTag}
              ${devRoleBadge}
              <span class="provider-url-meta" title="${escapeHtml(provData.baseUrl || "")}">URL: ${escapeHtml(provData.baseUrl || "")}</span>
            </div>
            <div class="provider-card-actions">
              <button type="button" class="flat-btn flat-btn-secondary mini btn-edit-provider" title="修改运营商接口协议、Base URL、Key 与兼容性配置" style="display: inline-flex; align-items: center; gap: 4px;"><span class="btn-icon">${ICONS.edit}</span> 修改配置</button>
              <button type="button" class="flat-btn flat-btn-primary mini btn-toggle-add-model">+ 新增模型</button>
              <button type="button" class="flat-btn flat-btn-secondary mini btn-delete-provider" style="color: #ef4444;" title="删除此运营商及所有模型">删除运营商</button>
            </div>
          </div>

          <!-- 折叠修改运营商配置表单 -->
          <div class="inline-edit-provider-box hidden" id="inline-edit-prov-${pKey}">
            <div style="font-size: 12px; font-weight: 600; color: var(--ink-primary); display: flex; align-items: center; justify-content: space-between;">
              <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="header-icon">${ICONS.edit}</span> 修改运营商配置 [${escapeHtml(pKey.toUpperCase())}]</span>
              <span style="font-size: 11px; color: var(--ink-muted); font-weight: normal;">修改后自动热加载并写入 ~/.pi/agent/models.json</span>
            </div>
            <div class="form-grid-2">
              <div class="form-field">
                <label class="form-label">接口类型 (API Protocol) <span class="req">*</span></label>
                <select class="flat-select input-edit-api-type">
                  <option value="openai-completions" ${provData.api === "openai-completions" ? "selected" : ""}>openai-completions</option>
                  <option value="openai-responses" ${provData.api === "openai-responses" ? "selected" : ""}>openai-responses</option>
                  <option value="anthropic" ${(provData.api === "anthropic" || provData.api === "anthropic-messages") ? "selected" : ""}>anthropic</option>
                  <option value="ollama" ${provData.api === "ollama" ? "selected" : ""}>ollama</option>
                </select>
              </div>
              <div class="form-field">
                <label class="form-label">接口地址 (Base URL) <span class="req">*</span></label>
                <input type="url" class="flat-input input-edit-base-url" value="${escapeHtml(provData.baseUrl || "")}" placeholder="如 https://api.siliconflow.cn/v1" required />
              </div>
            </div>
            <div class="form-field">
              <label class="form-label">API Key (留空表示清除，支持 $ENV_VAR 环境变量插值)</label>
              <input type="password" class="flat-input input-edit-api-key" value="${escapeHtml(provData.apiKey || "")}" placeholder="sk-... 或留空" />
            </div>
            <div class="form-grid-2" style="margin-top: 2px;">
              <div class="form-field checkbox-field">
                <label class="checkbox-label" title="开启后以 developer role 发送系统提示词。国内/聚合平台（DeepSeek、火山方舟等）不支持此角色，会导致 400 报错，请保持未勾选。">
                  <input type="checkbox" class="input-edit-developer-role" ${supportsDeveloperRole ? "checked" : ""} />
                  <span>启用 developer 角色 (兼容端点请勿勾)</span>
                </label>
              </div>
              <div class="form-field checkbox-field">
                <label class="checkbox-label" title="是否支持 reasoning_effort 思考参数">
                  <input type="checkbox" class="input-edit-reasoning-effort" ${supportsReasoningEffort ? "checked" : ""} />
                  <span>支持 reasoning_effort 思考参数</span>
                </label>
              </div>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
              <button type="button" class="flat-btn flat-btn-secondary mini btn-cancel-edit-prov">取消</button>
              <button type="button" class="flat-btn flat-btn-primary mini btn-save-edit-prov">保存修改</button>
            </div>
          </div>

          <!-- 折叠添加模型表单 -->
          <div class="inline-add-model-box hidden" id="inline-form-${pKey}">
            <div style="font-size: 12px; font-weight: 600; color: var(--ink-primary); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span>新增模型到运营商 [${escapeHtml(pKey.toUpperCase())}]</span>
              <button type="button" class="flat-btn flat-btn-secondary mini btn-fetch-custom-models" title="从该运营商端点获取在线可用模型列表并更新推荐表单" style="display: inline-flex; align-items: center; gap: 4px;">
                <svg class="icon-fetch-custom-models" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c2.3 0 4.3 1.4 5.1 3.5M13.5 2.5v3.5H10" />
                </svg>
                <span class="btn-fetch-text">获取模型列表</span>
              </button>
            </div>
            <div class="form-grid-2">
              <div class="form-field">
                <label class="form-label">模型标识 (Model ID) <span class="req">*</span></label>
                <input type="text" class="flat-input input-new-model-id" placeholder="如 deepseek-ai/DeepSeek-V3, gpt-4o" required />
              </div>
              <div class="form-field">
                <label class="form-label">显示名称 (Display Name)</label>
                <input type="text" class="flat-input input-new-model-name" placeholder="可选，如 DeepSeek V3" />
              </div>
            </div>
            <div class="form-grid-3">
              <div class="form-field">
                <label class="form-label">上下文 (Tokens)</label>
                <input type="number" class="flat-input input-new-context-win" value="64000" min="1000" step="1000" />
              </div>
              <div class="form-field">
                <label class="form-label">输出上限 (Tokens)</label>
                <input type="number" class="flat-input input-new-max-tokens" value="4096" min="256" step="256" />
              </div>
              <div class="form-field checkbox-field">
                <label class="checkbox-label">
                  <input type="checkbox" class="input-new-reasoning" checked />
                  <span>支持思考/推理</span>
                </label>
              </div>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button type="button" class="flat-btn flat-btn-secondary mini btn-cancel-add-model">取消</button>
              <button type="button" class="flat-btn flat-btn-primary mini btn-confirm-add-model">保存并添加到列表</button>
            </div>
          </div>

          <!-- 运营商下的模型列表 -->
          <div class="provider-models-wrapper">
            <div class="provider-models-title">
              <span>已挂载模型 (${models.length})</span>
            </div>
            <div class="provider-models-list">
              ${
                models.length === 0
                  ? `<div style="font-size: 11px; color: var(--ink-muted); padding: 4px 0;">暂无模型，点击右上角「+ 新增模型」添加。</div>`
                  : ""
              }
            </div>
          </div>
        `;

        // 绑定修改运营商配置
        const inlineEditForm = card.querySelector(".inline-edit-provider-box");
        const btnEditProvider = card.querySelector(".btn-edit-provider");
        const btnCancelEditProv = card.querySelector(".btn-cancel-edit-prov");
        const btnSaveEditProv = card.querySelector(".btn-save-edit-prov");
        const inlineAddForm = card.querySelector(".inline-add-model-box");

        // 绑定新增模型输入框输出上限自动规范吸附
        if (inlineAddForm) {
          const inputNewMaxTokens = inlineAddForm.querySelector(".input-new-max-tokens");
          api.setupOutputTokensAutoSnap(inputNewMaxTokens);

          // 增强新增模型 Model ID 的手绘智能联想与参数全表联动 (按运营商隔离记忆与预设)
          const inputNewModelId = inlineAddForm.querySelector(".input-new-model-id");
          const inputNewModelName = inlineAddForm.querySelector(".input-new-model-name");
          const inputNewContextWin = inlineAddForm.querySelector(".input-new-context-win");
          const inputNewReasoning = inlineAddForm.querySelector(".input-new-reasoning");
          const btnFetchCustomModels = inlineAddForm.querySelector(".btn-fetch-custom-models");
          const btnFetchText = inlineAddForm.querySelector(".btn-fetch-text");

          const providerCategory = `model:${pKey.toLowerCase()}`;

          // 读取已缓存的该运营商在线模型列表或内置预设
          const getInitialModelPresets = () => {
            try {
              const cachedRaw = localStorage.getItem(`pi_dl_custom_models_${pKey.toLowerCase()}`);
              if (cachedRaw) {
                const parsed = JSON.parse(cachedRaw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
              }
            } catch {}

            const matchedPreset = PROVIDER_PRESETS.find((p) => p.id.toLowerCase() === pKey.toLowerCase());
            return (matchedPreset && Array.isArray(matchedPreset.models) && matchedPreset.models.length > 0)
              ? matchedPreset.models
              : COMMON_MODEL_PRESETS;
          };

          if (inputNewModelId) {
            enhanceInputAutoFill(inputNewModelId, {
              type: providerCategory,
              title: `推荐模型与参数预填 [${pKey.toUpperCase()}]`,
              presets: getInitialModelPresets(),
              onSelect: (model) => {
                // 覆盖填入原表单
                inputNewModelId.value = model.id || "";
                inputNewModelName.value = model.name || model.id || "";
                if (inputNewContextWin && (model.contextWindow || model.context_window)) {
                  inputNewContextWin.value = model.contextWindow || model.context_window;
                }
                if (inputNewMaxTokens && (model.maxTokens || model.max_tokens)) {
                  inputNewMaxTokens.value = api.snapToClosestStandardTokens(model.maxTokens || model.max_tokens);
                }
                if (inputNewReasoning && model.reasoning !== undefined) {
                  inputNewReasoning.checked = !!model.reasoning;
                }
              }
            });
          }

          // 绑定「获取模型列表」按钮：从该运营商端点在线拉取最新模型
          if (btnFetchCustomModels) {
            btnFetchCustomModels.addEventListener("click", async () => {
              btnFetchCustomModels.disabled = true;
              if (btnFetchText) btnFetchText.textContent = "正在获取...";

              try {
                const fetched = await configService.fetchCustomProviderModels({
                  providerId: pKey,
                  baseUrl: provData.baseUrl,
                  apiKey: provData.apiKey,
                  apiType: provData.api,
                });

                if (Array.isArray(fetched) && fetched.length > 0) {
                  const formatted = fetched.map((m) => ({
                    id: m.id,
                    name: m.name || m.id,
                    contextWindow: m.context_window || 64000,
                    maxTokens: m.max_tokens || 4096,
                    reasoning: !!m.reasoning,
                    tag: "在线拉取",
                    desc: m.context_window ? `${(m.context_window / 1000).toFixed(0)}k context` : ""
                  }));

                  // 缓存至该运营商的专属缓存中
                  try {
                    localStorage.setItem(`pi_dl_custom_models_${pKey.toLowerCase()}`, JSON.stringify(formatted));
                  } catch {}

                  // 更新 AutoFill 实例的预设并展开浮层
                  if (inputNewModelId && inputNewModelId.__sketchAutoFill) {
                    inputNewModelId.__sketchAutoFill.updatePresets(
                      formatted,
                      `在线可用模型 [${pKey.toUpperCase()}] (${formatted.length} 个)`
                    );
                    inputNewModelId.focus();
                    inputNewModelId.__sketchAutoFill.open();
                  }

                  api.scrollElementIntoViewBottom(inlineAddForm, 24, true);
                  await sketchAlert(`成功从运营商 [${pKey.toUpperCase()}] 获取 ${formatted.length} 个在线模型！已更新至表单推荐列表，请点击选择填入。`, {
                    type: "success",
                    title: "获取成功"
                  });
                  if (inputNewModelId && inputNewModelId.__sketchAutoFill) {
                    inputNewModelId.focus();
                    inputNewModelId.__sketchAutoFill.open();
                  }
                } else {
                  await sketchAlert(`未从该运营商端点获取到模型，已保留当前推荐列表。`, { type: "info", title: "获取完成" });
                }
              } catch (err) {
                console.error("[Main] Fetch custom models failed:", err);
                await sketchAlert(`获取模型列表失败: ${err}`, { type: "error", title: "获取失败" });
              } finally {
                btnFetchCustomModels.disabled = false;
                if (btnFetchText) btnFetchText.textContent = "获取模型列表";
              }
            });
          }
        }

        if (btnEditProvider && inlineEditForm) {
          // 增强修改运营商的 Base URL 手绘智能联想
          const inputEditBaseUrl = inlineEditForm.querySelector(".input-edit-base-url");
          if (inputEditBaseUrl) {
            enhanceInputAutoFill(inputEditBaseUrl, {
              type: "url",
              title: `接口地址建议 [${pKey.toUpperCase()}]`,
              presets: [
                { id: provData.baseUrl || "https://api.siliconflow.cn/v1", name: `${pKey.toUpperCase()} 当前地址` },
                { id: "https://api.siliconflow.cn/v1", name: "硅基流动 (SiliconFlow)", tag: "推荐聚合" },
                { id: "https://api.deepseek.com/v1", name: "DeepSeek 官方 API", tag: "官方直连" },
                { id: "http://localhost:11434/v1", name: "Ollama 本地服务", tag: "本地部署" },
                { id: "https://openrouter.ai/api/v1", name: "OpenRouter 全球聚合", tag: "全球聚合" }
              ]
            });
          }

          btnEditProvider.addEventListener("click", () => {
            const willOpen = inlineEditForm.classList.contains("hidden");
            inlineEditForm.classList.toggle("hidden");
            if (!inlineEditForm.classList.contains("hidden") && inlineAddForm) {
              inlineAddForm.classList.add("hidden");
            }
            if (willOpen) {
              api.scrollElementIntoViewBottom(inlineEditForm, 24, true);
            }
          });
        }

        if (btnCancelEditProv && inlineEditForm) {
          btnCancelEditProv.addEventListener("click", () => {
            inlineEditForm.classList.add("hidden");
          });
        }

        if (btnSaveEditProv && inlineEditForm) {
          btnSaveEditProv.addEventListener("click", async () => {
            btnSaveEditProv.disabled = true;
            try {
              const inputApiType = inlineEditForm.querySelector("select.input-edit-api-type") || inlineEditForm.querySelector(".input-edit-api-type");
              const inputBaseUrl = inlineEditForm.querySelector(".input-edit-base-url");
              const inputApiKey = inlineEditForm.querySelector(".input-edit-api-key");
              const inputDevRole = inlineEditForm.querySelector(".input-edit-developer-role");
              const inputReasoningEffort = inlineEditForm.querySelector(".input-edit-reasoning-effort");

              const newApiType = (inputApiType?.value || "").trim() || "openai-completions";
              const newBaseUrl = (inputBaseUrl?.value || "").trim();
              if (!newBaseUrl) {
                await sketchAlert("接口地址 (Base URL) 不能为空", { type: "warning", title: "参数缺失" });
                inputBaseUrl?.focus();
                return;
              }
              const newApiKey = (inputApiKey?.value || "").trim() || null;
              const newDevRole = !!inputDevRole?.checked;
              const newReasoningEffort = !!inputReasoningEffort?.checked;

              await configService.saveCustomProvider({
                provider_id: pKey,
                api_type: newApiType,
                base_url: newBaseUrl,
                api_key: newApiKey,
                supports_developer_role: newDevRole,
                supports_reasoning_effort: newReasoningEffort,
              });

              // 保存至 URL 历史沉淀
              saveAutofillHistory("url", { id: newBaseUrl, value: newBaseUrl });

              await sketchAlert(`运营商 [${pKey.toUpperCase()}] 配置已成功更新！`, { type: "success", title: "更新成功" });
              loadCustomProvidersConfig();
            } catch (err) {
              console.error("Save custom provider failed:", err);
              await sketchAlert(`更新运营商配置失败: ${err}`, { type: "error", title: "更新失败" });
            } finally {
              btnSaveEditProv.disabled = false;
            }
          });
        }

        // 绑定删除运营商
        const btnDeleteProvider = card.querySelector(".btn-delete-provider");
        if (btnDeleteProvider) {
          btnDeleteProvider.addEventListener("click", async () => {
            const confirmed = await sketchConfirm(`确定要删除运营商 [${pKey.toUpperCase()}] 及其全部模型配置吗？`, {
              title: "删除运营商确认",
              isDanger: true
            });
            if (confirmed) {
              await configService.deleteCustomProvider(pKey);
              // 清理白名单中该运营商的模型
              models.forEach((m) => configService.removeModelFromWhitelist(pKey, m.id));
              loadCustomProvidersConfig();
              api.renderWhitelistModels(piClient.currentModel);
            }
          });
        }

        // 绑定新增模型折叠切换
        const btnToggleAddModel = card.querySelector(".btn-toggle-add-model");
        const btnCancelAddModel = card.querySelector(".btn-cancel-add-model");

        if (btnToggleAddModel && inlineAddForm) {
          btnToggleAddModel.addEventListener("click", () => {
            const willOpen = inlineAddForm.classList.contains("hidden");
            inlineAddForm.classList.toggle("hidden");
            if (!inlineAddForm.classList.contains("hidden") && inlineEditForm) {
              inlineEditForm.classList.add("hidden");
            }
            if (willOpen) {
              api.scrollElementIntoViewBottom(inlineAddForm, 24, true);
            }
          });
        }

        if (btnCancelAddModel && inlineAddForm) {
          btnCancelAddModel.addEventListener("click", () => {
            inlineAddForm.classList.add("hidden");
          });
        }

        // 提交添加模型
        const btnConfirmAddModel = card.querySelector(".btn-confirm-add-model");
        if (btnConfirmAddModel && inlineAddForm) {
          btnConfirmAddModel.addEventListener("click", async () => {
            const inputModelId = inlineAddForm.querySelector(".input-new-model-id");
            const inputModelName = inlineAddForm.querySelector(".input-new-model-name");
            const inputContextWin = inlineAddForm.querySelector(".input-new-context-win");
            const inputMaxTokens = inlineAddForm.querySelector(".input-new-max-tokens");
            const inputReasoning = inlineAddForm.querySelector(".input-new-reasoning");

            const modelIdVal = inputModelId?.value.trim();
            if (!modelIdVal) {
              await sketchAlert("请输入模型标识 (Model ID)", { type: "warning", title: "参数缺失" });
              inputModelId?.focus();
              return;
            }

            const modelNameVal = inputModelName?.value.trim() || modelIdVal;
            const contextWinVal = parseInt(inputContextWin?.value, 10) || 64000;
            const maxTokensVal = api.snapToClosestStandardTokens(inputMaxTokens?.value);
            if (inputMaxTokens) {
              inputMaxTokens.value = maxTokensVal.toString();
            }
            const reasoningVal = !!inputReasoning?.checked;

            btnConfirmAddModel.disabled = true;
            try {
              await configService.addCustomProviderModel({
                provider_id: pKey,
                model_id: modelIdVal,
                model_name: modelNameVal,
                context_window: contextWinVal,
                max_tokens: maxTokensVal,
                reasoning: reasoningVal,
              });

              // 自动添加到白名单 (首位固定为当前选中模型，新模型插入其后)
              configService.addModelToWhitelist({
                id: modelIdVal,
                name: modelNameVal,
                provider: pKey,
                contextWindow: contextWinVal,
                maxTokens: maxTokensVal,
                reasoning: reasoningVal,
                isCustom: true,
              });

              // 沉淀至该运营商专有的模型历史池 (隔离记忆)
              const providerCategory = `model:${pKey.toLowerCase()}`;
              saveAutofillHistory(providerCategory, {
                id: modelIdVal,
                name: modelNameVal,
                contextWindow: contextWinVal,
                maxTokens: maxTokensVal,
                reasoning: reasoningVal
              });

              await sketchAlert(`模型 [${modelNameVal}] 已成功添加至运营商 [${pKey.toUpperCase()}] 并加入当前模型列表！`, { type: "success", title: "添加成功" });
              loadCustomProvidersConfig();
              api.renderWhitelistModels(piClient.currentModel);
            } catch (err) {
              console.error("Add model failed:", err);
              await sketchAlert(`添加模型失败: ${err}`, { type: "error", title: "添加失败" });
            } finally {
              btnConfirmAddModel.disabled = false;
            }
          });
        }

        // 渲染此运营商下的模型条目
        const modelsListEl = card.querySelector(".provider-models-list");
        if (modelsListEl && models.length > 0) {
          models.forEach((m) => {
            const chip = document.createElement("div");
            chip.className = "official-model-chip";

            const isInWhitelist = configService.isModelInWhitelist(pKey, m.id);
            const contextWin = m.contextWindow
              ? `${(m.contextWindow / 1000).toFixed(0)}k context`
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
                  ${m.maxTokens ? `<span>· max ${m.maxTokens} tokens</span>` : ""}
                </div>
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <button type="button" class="flat-btn flat-btn-secondary mini btn-edit-custom-model" title="修改模型参数" style="display: inline-flex; align-items: center; gap: 4px;"><span class="btn-icon">${ICONS.edit}</span> 编辑</button>
                <button type="button" class="flat-btn ${isInWhitelist ? "flat-btn-secondary" : "flat-btn-primary"} mini btn-add-custom-whitelist" ${isInWhitelist ? "disabled" : ""} style="display: inline-flex; align-items: center; gap: 4px;">
                  ${isInWhitelist ? `<span class="btn-icon">${ICONS.check}</span> 已添加` : "+ 添加到当前列表"}
                </button>
                <button type="button" class="flat-btn flat-btn-danger mini btn-delete-custom-model" title="删除模型">删除</button>
              </div>
            `;

            // 模型行内编辑面板
            const modelEditBox = document.createElement("div");
            modelEditBox.className = "inline-add-model-box hidden";
            modelEditBox.innerHTML = `
              <div style="font-size: 11px; font-weight: 600; color: var(--ink-primary); display: flex; align-items: center; gap: 4px;"><span class="header-icon">${ICONS.edit}</span> 编辑模型 [${escapeHtml(m.id)}]</div>
              <div class="form-grid-2">
                <div class="form-field">
                  <label class="form-label">模型标识 (Model ID)</label>
                  <input type="text" class="flat-input input-edit-model-id" value="${escapeHtml(m.id)}" readonly style="opacity: 0.75; cursor: not-allowed;" />
                </div>
                <div class="form-field">
                  <label class="form-label">显示名称 (Display Name)</label>
                  <input type="text" class="flat-input input-edit-model-name" value="${escapeHtml(m.name || m.id)}" />
                </div>
              </div>
              <div class="form-grid-3">
                <div class="form-field">
                  <label class="form-label">上下文 (Tokens)</label>
                  <input type="number" class="flat-input input-edit-context-win" value="${m.contextWindow || 64000}" min="1000" step="1000" />
                </div>
                <div class="form-field">
                  <label class="form-label">输出上限 (Tokens)</label>
                  <input type="number" class="flat-input input-edit-max-tokens" value="${m.maxTokens || 4096}" min="256" step="256" />
                </div>
                <div class="form-field checkbox-field">
                  <label class="checkbox-label">
                    <input type="checkbox" class="input-edit-reasoning" ${m.reasoning ? "checked" : ""} />
                    <span>支持思考/推理</span>
                  </label>
                </div>
              </div>
              <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button type="button" class="flat-btn flat-btn-secondary mini btn-cancel-edit-model">取消</button>
                <button type="button" class="flat-btn flat-btn-primary mini btn-save-edit-model">保存模型修改</button>
              </div>
            `;

            // 绑定编辑模型输入框输出上限自动规范吸附
            const inputEditMaxTokens = modelEditBox.querySelector(".input-edit-max-tokens");
            api.setupOutputTokensAutoSnap(inputEditMaxTokens);

            // 绑定编辑模型按钮
            const btnEditModel = chip.querySelector(".btn-edit-custom-model");
            const btnCancelEditModel = modelEditBox.querySelector(".btn-cancel-edit-model");
            const btnSaveEditModel = modelEditBox.querySelector(".btn-save-edit-model");

            if (btnEditModel) {
              btnEditModel.addEventListener("click", () => {
                const willOpen = modelEditBox.classList.contains("hidden");
                modelEditBox.classList.toggle("hidden");
                if (willOpen) {
                  api.scrollElementIntoViewBottom(modelEditBox, 24, true);
                }
              });
            }

            if (btnCancelEditModel) {
              btnCancelEditModel.addEventListener("click", () => {
                modelEditBox.classList.add("hidden");
              });
            }

            if (btnSaveEditModel) {
              btnSaveEditModel.addEventListener("click", async () => {
                const inputName = modelEditBox.querySelector(".input-edit-model-name");
                const inputContext = modelEditBox.querySelector(".input-edit-context-win");
                const inputMax = modelEditBox.querySelector(".input-edit-max-tokens");
                const inputReas = modelEditBox.querySelector(".input-edit-reasoning");

                const updatedName = inputName?.value.trim() || m.id;
                const updatedContext = parseInt(inputContext?.value, 10) || 64000;
                const updatedMax = api.snapToClosestStandardTokens(inputMax?.value);
                if (inputMax) {
                  inputMax.value = updatedMax.toString();
                }
                const updatedReas = !!inputReas?.checked;

                btnSaveEditModel.disabled = true;
                try {
                  await configService.addCustomProviderModel({
                    provider_id: pKey,
                    model_id: m.id,
                    model_name: updatedName,
                    context_window: updatedContext,
                    max_tokens: updatedMax,
                    reasoning: updatedReas,
                  });

                  // 如果该模型已在白名单中，同步更新白名单
                  if (configService.isModelInWhitelist(pKey, m.id)) {
                    configService.addModelToWhitelist({
                      id: m.id,
                      name: updatedName,
                      provider: pKey,
                      contextWindow: updatedContext,
                      maxTokens: updatedMax,
                      reasoning: updatedReas,
                      isCustom: true,
                    });
                  }

                  await sketchAlert(`模型 [${updatedName}] 配置已成功更新！`, { type: "success", title: "更新成功" });
                  loadCustomProvidersConfig();
                  api.renderWhitelistModels(piClient.currentModel);
                } catch (err) {
                  console.error("Update model failed:", err);
                  await sketchAlert(`更新模型失败: ${err}`, { type: "error", title: "更新失败" });
                } finally {
                  btnSaveEditModel.disabled = false;
                }
              });
            }

            // 添加到当前列表
            const addBtn = chip.querySelector(".btn-add-custom-whitelist");
            if (addBtn && !isInWhitelist) {
              addBtn.addEventListener("click", () => {
                configService.addModelToWhitelist({
                  id: m.id,
                  name: m.name || m.id,
                  provider: pKey,
                  contextWindow: m.contextWindow || 64000,
                  maxTokens: m.maxTokens || 4096,
                  reasoning: !!m.reasoning,
                  isCustom: true,
                });
                addBtn.innerHTML = `<span class="btn-icon">${ICONS.check}</span> 已添加`;
                addBtn.className = "flat-btn flat-btn-secondary mini";
                addBtn.disabled = true;
                api.renderWhitelistModels(piClient.currentModel);
                if (typeof api.renderOfficialProviderDetails === "function" && officialProviderSelect?.value) {
                  api.renderOfficialProviderDetails(officialProviderSelect.value);
                }
              });
            }

            // 删除单个模型
            const delBtn = chip.querySelector(".btn-delete-custom-model");
            if (delBtn) {
              delBtn.addEventListener("click", async () => {
                const confirmed = await sketchConfirm(`确定要删除模型 [${m.name || m.id}] 吗？`, {
                  title: "删除模型确认",
                  isDanger: true
                });
                if (confirmed) {
                  await configService.deleteCustomModel(pKey, m.id);
                  configService.removeModelFromWhitelist(pKey, m.id);
                  loadCustomProvidersConfig();
                  api.renderWhitelistModels(piClient.currentModel);
                }
              });
            }

            modelsListEl.appendChild(chip);
            modelsListEl.appendChild(modelEditBox);
          });
        }

        customProvidersContainer.appendChild(card);
      });
      enhanceAllSelects(customProvidersContainer);
      enhanceAllAutoFills(customProvidersContainer);
    } catch (e) {
      console.warn("[Main] Load custom providers failed:", e);
    }
  };

  // 增强静态自定义运营商表单输入框
  if (customProviderId) {
    enhanceInputAutoFill(customProviderId, {
      type: "provider",
      onSelect: (preset) => {
        if (customApiType) {
          customApiType.value = preset.protocol || "openai-completions";
          if (customApiType.__sketchSelect) {
            customApiType.__sketchSelect.syncOptions();
          }
        }
        if (customBaseUrl) {
          if (!customBaseUrl.value || customBaseUrl.value.includes("api.siliconflow.cn") || customBaseUrl.value.includes("localhost:11434") || customBaseUrl.value.includes("api.deepseek.com")) {
            customBaseUrl.value = preset.baseUrl || "";
          }
        }
        const customDevRole = document.getElementById("custom-supports-dev-role");
        if (customDevRole) {
          customDevRole.checked = !!preset.devRole;
        }
        const customReasoningEffort = document.getElementById("custom-supports-reasoning-effort");
        if (customReasoningEffort) {
          customReasoningEffort.checked = preset.reasoningEffort !== undefined ? !!preset.reasoningEffort : true;
        }
      }
    });
  }

  if (customBaseUrl) {
    enhanceInputAutoFill(customBaseUrl, {
      type: "url",
      title: "常用接口地址与历史推荐",
      presets: [
        { id: "https://api.siliconflow.cn/v1", name: "硅基流动 (SiliconFlow)", tag: "推荐聚合" },
        { id: "https://api.deepseek.com/v1", name: "DeepSeek 官方 API", tag: "官方直连" },
        { id: "http://localhost:11434/v1", name: "Ollama 本地服务", tag: "本地部署" },
        { id: "https://openrouter.ai/api/v1", name: "OpenRouter 全球聚合", tag: "全球聚合" },
        { id: "https://dashscope.aliyuncs.com/compatible-mode/v1", name: "阿里云百炼 (DashScope)", tag: "通义千问" },
        { id: "https://open.bigmodel.cn/api/paas/v4", name: "智谱开放平台 (BigModel)", tag: "智谱 GLM" },
        { id: "https://api.groq.com/openai/v1", name: "Groq 极速端点", tag: "极速硬件" },
        { id: "https://api.moonshot.cn/v1", name: "月之暗面 (Moonshot / Kimi)", tag: "Kimi" },
        { id: "https://ark.cn-beijing.volces.com/api/v3", name: "火山方舟 / 豆包 (VolcEngine)", tag: "字节跳动" },
        { id: "http://localhost:8000/v1", name: "vLLM 本地服务", tag: "私有部署" },
        { id: "http://localhost:1234/v1", name: "LM Studio 本地服务", tag: "本地部署" }
      ]
    });
  }

  // 全局消灭原生 autofill 破相弹窗
  enhanceAllAutoFills(document);

  // 第一步：保存/更新自定义运营商
  if (customProviderForm) {
    customProviderForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const providerId = customProviderId.value.trim();
      const apiType = customApiType.value.trim();
      const baseUrl = customBaseUrl.value.trim();
      const apiKey = customApiKey.value.trim() || null;
      const customDevRole = document.getElementById("custom-supports-dev-role");
      const customReasoningEffort = document.getElementById("custom-supports-reasoning-effort");

      const saveBtn = document.getElementById("btn-save-custom-provider");
      if (saveBtn) saveBtn.disabled = true;

      try {
        await configService.saveCustomProvider({
          provider_id: providerId,
          api_type: apiType,
          base_url: baseUrl,
          api_key: apiKey,
          supports_developer_role: customDevRole ? !!customDevRole.checked : (apiType === "openai-responses"),
          supports_reasoning_effort: customReasoningEffort ? !!customReasoningEffort.checked : false,
        });

        // 沉淀至运营商与 URL 历史池
        saveAutofillHistory("provider", { id: providerId, name: providerId, baseUrl });
        saveAutofillHistory("url", { id: baseUrl, value: baseUrl });

        customProviderId.value = "";
        customBaseUrl.value = "";
        customApiKey.value = "";

        // 保存后自动进入步骤 2：运营商列表与模型管理
        api.switchInnerTab("inner-step2");
        loadCustomProvidersConfig();
        api.scrollSettingsToBottom(true);

        await sketchAlert(`运营商 [${providerId.toUpperCase()}] 已成功保存！已自动切换至“步骤 2”，可在此为该运营商添加具体模型或管理配置。`, { type: "success", title: "保存成功" });
        api.scrollSettingsToBottom(true);
      } catch (err) {
        console.error("Save custom provider failed:", err);
        await sketchAlert(`保存运营商失败: ${err}`, { type: "error", title: "保存失败" });
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  // 初始加载
  api.loadModelsAndState();

  api.loadCustomProvidersConfig = loadCustomProvidersConfig;
}
