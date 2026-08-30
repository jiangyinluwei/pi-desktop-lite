---
name: sketch-form-autofill-pattern
description: |
  指导桌面端 (Tauri 2 + Web 前端) 中新增表单的规范写法、手绘草图质感自定义填表与智能联想推荐浮窗 (SketchAutoFill) 的标准用法。涵盖彻底消除浏览器原生填表弹窗与 :-webkit-autofill 伪类变色、表单 DOM 几何布局、SketchAutoFill API 接口、海量预设库挂载、全表字段智能联动填充、填表历史沉淀记忆以及全域键盘导航与 Step Back 回退规范。当涉及"新增表单"、"表单写法"、"自定义填表"、"输入框建议"、"填表浮层"、"autofill"、"联想输入"时使用此技能。
---

# 手绘草图质感表单规范与自定义填表浮层使用指南 (Sketch Form & AutoFill Pattern)

本项目前端遵循极简手绘与工程绘图线条质感（Warm Oatmeal Paper / Charcoal Blackboard）。为保证所有表单输入体验高度统一、杜绝 WebView2 / Chromium 默认的破相弹窗与亮黄/淡蓝背景变色，所有新增表单必须遵守本指南规定的 DOM 结构、CSS 伪类覆盖与 `SketchAutoFill` 智能联想引擎使用规范。

---

## 🏛️ 1. 表单编写基础规范 (Form Engineering Specifications)

### 1.1 全域彻底消灭原生 Autofill 弹窗与属性配置
在编写任何 `<input>` 元素时，必须严格声明以下防原生态属性：

```html
<input 
  type="text" 
  id="my-custom-input" 
  class="flat-input" 
  placeholder="请输入..." 
  autocomplete="off" 
  autocorrect="off" 
  autocapitalize="off" 
  spellcheck="false" 
  data-form-type="other"
  required 
/>
```

### 1.2 WebKit 伪类全局覆盖 (`src/styles/form-widgets.css`)
确保所有输入框在被任何机制填入时，底色始终无缝融入当前主题，绝不弹出浏览器默认的亮黄色/淡青色色块：

```css
input:-webkit-autofill,
input:-webkit-autofill:hover, 
input:-webkit-autofill:focus, 
input:-webkit-autofill:active,
textarea:-webkit-autofill,
textarea:-webkit-autofill:hover,
textarea:-webkit-autofill:focus,
textarea:-webkit-autofill:active,
select:-webkit-autofill,
select:-webkit-autofill:hover,
select:-webkit-autofill:focus,
select:-webkit-autofill:active {
  -webkit-box-shadow: 0 0 0 1000px var(--bg-base) inset !important;
  box-shadow: 0 0 0 1000px var(--bg-base) inset !important;
  -webkit-text-fill-color: var(--ink-primary) !important;
  caret-color: var(--ink-primary) !important;
  border-color: var(--sketch-border-subtle) !important;
  transition: background-color 50000s ease-in-out 0s !important;
  font-family: inherit !important;
  font-size: inherit !important;
}

input:-webkit-autofill:focus,
textarea:-webkit-autofill:focus {
  border-color: var(--ink-primary) !important;
}
```

### 1.3 标准表单 DOM 几何布局模版
```html
<form class="custom-provider-form" id="my-feature-form">
  <!-- 双列栅格 -->
  <div class="form-grid-2">
    <div class="form-field">
      <label for="field-id" class="form-label">标识名称 <span class="req">*</span></label>
      <input type="text" id="field-id" class="flat-input" placeholder="如 my-service" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" required />
    </div>
    <div class="form-field">
      <label for="field-select" class="form-label">类型选择 <span class="req">*</span></label>
      <select id="field-select" class="flat-select" required>
        <option value="opt1" selected>选项一</option>
        <option value="opt2">选项二</option>
      </select>
    </div>
  </div>

  <!-- 单列全宽字段 -->
  <div class="form-field">
    <label for="field-url" class="form-label">目标地址 (URL) <span class="req">*</span></label>
    <input type="url" id="field-url" class="flat-input" placeholder="https://..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" required />
  </div>

  <!-- 复选框字段 -->
  <div class="form-grid-2" style="margin-top: 2px;">
    <div class="form-field checkbox-field">
      <label class="checkbox-label" title="详细功能解释">
        <input type="checkbox" id="field-check-feature" checked />
        <span>启用特色功能</span>
      </label>
    </div>
  </div>

  <!-- 底部操作栏 -->
  <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
    <button type="button" class="flat-btn flat-btn-secondary mini btn-cancel">取消</button>
    <button type="submit" class="flat-btn flat-btn-primary mini btn-submit">+ 保存配置</button>
  </div>
</form>
```

---

## 🧩 2. 手绘自定义填表浮层 (`SketchAutoFill`) 架构与使用

`SketchAutoFill` 封装于 [`src/services/sketch-autofill.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/sketch-autofill.js)，具备与 `SketchSelect` 一脉相承的手绘微抖动动画（`sketchDropdownPopShake` 180ms 快速回弹）、双模自适应底色、内联手绘矢量图元、历史记录记忆与键盘导航。

### 2.1 模块导入
```javascript
import {
  enhanceInputAutoFill,
  enhanceAllAutoFills,
  PROVIDER_PRESETS,
  COMMON_MODEL_PRESETS,
  saveAutofillHistory,
  getAutofillHistory,
  clearAutofillHistory
} from "./services/sketch-autofill.js";
```

### 2.2 核心 API：`enhanceInputAutoFill(target, options)`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `target` | `HTMLInputElement \| string` | 是 | - | 目标输入框元素或元素 DOM ID |
| `options.type` | `string` | 否 | `"custom"` | 联想类目：`"provider"` \| `"model"` \| `"url"` \| `"custom"` |
| `options.title` | `string` | 否 | 依类目自适应 | 浮层顶部提示文案（如 `"常用运营商预设与智能联动"`） |
| `options.presets` | `Array<Object>` | 否 | 依类目内置预设 | 静态候选预设列表 |
| `options.getPresets` | `Function` | 否 | `null` | 动态获取预设数组的回调函数 `() => Array<Object>` |
| `options.onSelect` | `Function` | 否 | `null` | 选中项触发回调 `(item, input) => void`，用于全表字段智能联动 |

---

## ⚡ 3. 实战应用场景与智能联动代码范式

### 场景 1：静态运营商输入框挂载与全表智能联动 (Provider Form Association)
用户在选择任一运营商（如 SiliconFlow / DeepSeek / Ollama / OpenRouter 等）时，自动预填 Provider ID、自动切换协议下拉框并同步 `SketchSelect`、自动预填 Base URL、自动配置 `dev-role` 与 `reasoning_effort`：

```javascript
const customProviderId = document.getElementById("custom-provider-id");
const customApiType = document.getElementById("custom-api-type");
const customBaseUrl = document.getElementById("custom-base-url");

if (customProviderId) {
  enhanceInputAutoFill(customProviderId, {
    type: "provider",
    onSelect: (preset) => {
      // 1. 同步协议下拉框并触发 SketchSelect UI 刷新
      if (customApiType) {
        customApiType.value = preset.protocol || "openai-completions";
        if (customApiType.__sketchSelect) {
          customApiType.__sketchSelect.syncOptions();
        }
      }

      // 2. 智能预填 Base URL
      if (customBaseUrl) {
        if (!customBaseUrl.value || customBaseUrl.value.includes("api.siliconflow.cn") || customBaseUrl.value.includes("localhost:11434")) {
          customBaseUrl.value = preset.baseUrl || "";
        }
      }

      // 3. 智能联动兼容性选项
      const devRoleCheck = document.getElementById("custom-supports-dev-role");
      if (devRoleCheck) {
        devRoleCheck.checked = !!preset.devRole;
      }
      const reasoningCheck = document.getElementById("custom-supports-reasoning-effort");
      if (reasoningCheck) {
        reasoningCheck.checked = preset.reasoningEffort !== undefined ? !!preset.reasoningEffort : true;
      }
    }
  });
}
```

### 场景 2：动态卡片内新增模型输入框挂载 (Dynamic Model ID & Tokens Snapping)
在动态创建的卡片内为新增模型输入框挂载推荐模型，并在选中时自动填充显示名称、上下文窗口、最大输出上限及思考参数：

```javascript
// 在卡片构建时获取元素
const inputNewModelId = inlineAddForm.querySelector(".input-new-model-id");
const inputNewModelName = inlineAddForm.querySelector(".input-new-model-name");
const inputNewContextWin = inlineAddForm.querySelector(".input-new-context-win");
const inputNewMaxTokens = inlineAddForm.querySelector(".input-new-max-tokens");
const inputNewReasoning = inlineAddForm.querySelector(".input-new-reasoning");

if (inputNewModelId) {
  // 根据当前运营商 ID 获取针对性推荐模型列表
  const matchedPreset = PROVIDER_PRESETS.find((p) => p.id.toLowerCase() === providerKey.toLowerCase());
  const modelPresets = (matchedPreset && Array.isArray(matchedPreset.models) && matchedPreset.models.length > 0)
    ? matchedPreset.models
    : COMMON_MODEL_PRESETS;

  enhanceInputAutoFill(inputNewModelId, {
    type: "model",
    title: `推荐模型与参数预填 [${providerKey.toUpperCase()}]`,
    presets: modelPresets,
    onSelect: (model) => {
      if (inputNewModelName && (!inputNewModelName.value || inputNewModelName.value === model.id)) {
        inputNewModelName.value = model.name || model.id;
      }
      if (inputNewContextWin && model.contextWindow) {
        inputNewContextWin.value = model.contextWindow;
      }
      if (inputNewMaxTokens && model.maxTokens) {
        inputNewMaxTokens.value = model.maxTokens;
      }
      if (inputNewReasoning && model.reasoning !== undefined) {
        inputNewReasoning.checked = !!model.reasoning;
      }
    }
  });
}
```

### 场景 3：表单提交成功后沉淀历史记忆 (History Retention)
在表单 `submit` 成功后，调用 `saveAutofillHistory` 将用户输入项沉淀到本地历史池。下次输入时将自动以 `[历史]` 徽章优先置顶展示：

```javascript
// 提交保存成功时触发
saveAutofillHistory("provider", { id: providerId, name: providerId, baseUrl: baseUrl });
saveAutofillHistory("url", { id: baseUrl, value: baseUrl });
saveAutofillHistory("model", {
  id: modelId,
  name: modelName,
  contextWindow: contextWin,
  maxTokens: maxTokens,
  reasoning: isReasoning
});
```

### 场景 4：容器级全量扫描增强 (`enhanceAllAutoFills`)
在动态渲染卡片或 DOM 列表插入完毕后，批量执行 `enhanceAllAutoFills`，确保所有新插入的 input 均被赋予防原生填表属性：

```javascript
customProvidersContainer.appendChild(card);
enhanceAllSelects(customProvidersContainer);
enhanceAllAutoFills(customProvidersContainer);
```

---

## ⌨️ 4. 键盘导航与 Step Back 交互闭环

1. **浮层动态定位**：`SketchAutoFill` 浮层挂载于 `document.body` 并基于 `getBoundingClientRect()` 计算绝对坐标，杜绝被外层父级容器的 `overflow: hidden` 或抽屉限制截断；当视口下方空间不足时自动翻转向上展开；
2. **方向键 `↑` / `↓` 导航**：在浮层展开态下，按上下方向键循环高亮候选项并自动平滑滚动（`scrollIntoView({ block: 'nearest' })`）；
3. **回车确认 `Enter` / `Tab`**：高亮某项时按回车或 Tab，自动拦截默认表单提交行为，执行填入并触发 `onSelect` 联动回调；若无高亮项或无匹配预设，回车直接使用当前输入值并收起浮层；
4. **全域 Esc 与右键 Step Back**：浮层内置 `window.__piRegisterStepBack` 与 `pi:step-back` 监听，在浮层打开时按 Esc 或在全域点击鼠标右键，**优先且仅消耗并关闭当前填表浮层**，不误触发底层页面回退。

---

## 📋 5. 新增表单开发交付 Checklist

在新增任何包含输入框或配置表单的功能模块时，逐项核对以下标准：
- [ ] 所有 `<input>` 元素均配置了 `autocomplete="off"`、`autocorrect="off"`、`autocapitalize="off"`、`spellcheck="false"`？
- [ ] 表单内所有原生 `<select>` 均通过 `enhanceSelect` / `enhanceAllSelects` 增强为 `SketchSelect`？
- [ ] 关键输入项（服务商标识、Base URL、Model ID 等）通过 `enhanceInputAutoFill` 挂载了手绘联想浮层？
- [ ] 选中预设项时实现了全表智能联动（协议同步切换、URL 填充、开关自动调整）？
- [ ] 表单保存成功后调用 `saveAutofillHistory` 沉淀了用户自定义历史？
- [ ] 动态创建表单卡片后调用了 `enhanceAllAutoFills(container)`？
- [ ] 键盘方向键、Enter、Esc 及全域鼠标右键均能顺畅选择与收起？
- [ ] 运行 `npm run check` 编译校验通过（Exit Code 0）？
