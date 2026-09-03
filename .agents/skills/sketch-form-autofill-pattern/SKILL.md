---
name: sketch-form-autofill-pattern
description: |
  指导桌面端 (Tauri 2 + Web 前端) 中新增表单的规范写法、手绘草图质感自定义填表与智能联想推荐浮窗 (SketchAutoFill) 的标准用法。涵盖彻底消除浏览器原生填表弹窗与 :-webkit-autofill 伪类变色、表单 DOM 几何布局、SketchAutoFill API 接口、海量预设库挂载、全表字段智能联动填充、填表历史沉淀记忆以及全域键盘导航与 Step Back 回退规范。当涉及"新增表单"、"表单写法"、"自定义填表"、"输入框建议"、"填表浮层"、"autofill"、"联想输入"时使用此技能。
---

# 手绘表单与自定义填表浮层规范 (Sketch Form & AutoFill)

规范表单 DOM 结构、WebKit 原生填表变色伪类覆盖与 `SketchAutoFill` 智能联想引擎使用。

---

## 🏛️ 1. 表单编写基础与原生消灭铁律

### 1.1 输入框基础防原生声明
所有 `<input>` 必须显式声明防浏览器原生态属性：
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

### 1.2 WebKit 填表变色全局覆盖
```css
input:-webkit-autofill,
input:-webkit-autofill:hover, 
input:-webkit-autofill:focus, 
textarea:-webkit-autofill,
select:-webkit-autofill {
  -webkit-box-shadow: 0 0 0 1000px var(--bg-base) inset !important;
  box-shadow: 0 0 0 1000px var(--bg-base) inset !important;
  -webkit-text-fill-color: var(--ink-primary) !important;
  caret-color: var(--ink-primary) !important;
  border-color: var(--sketch-border-subtle) !important;
  transition: background-color 50000s ease-in-out 0s !important;
  font-family: inherit !important;
}
input:-webkit-autofill:focus {
  border-color: var(--ink-primary) !important;
}
```

---

## 🧩 2. `SketchAutoFill` 架构与 API

位于 [`src/services/sketch-autofill.js`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src/services/sketch-autofill.js)，具备 180ms 回弹微抖动、双模适配与历史记忆。

### 核心 API：`enhanceInputAutoFill(target, options)`

| 参数 | 类型 | 默认值 | 作用说明 |
|---|---|---|---|
| `target` | `HTMLInputElement \| string` | - | 目标输入框元素或 ID |
| `options.type` | `string` | `"custom"` | 类目：`"provider"` \| `"model"` \| `"url"` \| `"custom"` |
| `options.title` | `string` | 自适应 | 浮层顶部提示文案 |
| `options.presets` | `Array<Object>` | 内置预设 | 静态候选预设列表 |
| `options.onSelect` | `Function` | `null` | 选中触发回调 `(item, input) => void`，用于全表字段联动 |

---

## ⚡ 3. 智能联动与历史沉淀范式

### 3.1 运营商预设全表联动
```javascript
enhanceInputAutoFill(customProviderId, {
  type: "provider",
  onSelect: (preset) => {
    // 1. 同步协议并刷新 SketchSelect
    if (customApiType) {
      customApiType.value = preset.protocol || "openai-completions";
      customApiType.__sketchSelect?.syncOptions();
    }
    // 2. 预填 Base URL 与兼容开关
    if (customBaseUrl && !customBaseUrl.value) customBaseUrl.value = preset.baseUrl || "";
    if (devRoleCheck) devRoleCheck.checked = !!preset.devRole;
  }
});
```

### 3.2 表单保存沉淀历史
```javascript
// 提交保存成功后沉淀，下次以 [历史] 徽章置顶展示
saveAutofillHistory("provider", { id: providerId, name: providerId, baseUrl });
saveAutofillHistory("model", { id: modelId, name: modelName, contextWindow, maxTokens, reasoning });
```

### 3.3 容器全量批量增强
```javascript
container.appendChild(card);
enhanceAllSelects(container);
enhanceAllAutoFills(container);
```

---

## ⌨️ 4. 键盘导航与 Step Back 闭环

1. **绝对坐标与边界自适应**：浮层挂载于 `document.body`，下方空间不足时自动翻转向上展开；
2. **方向键 `↑` / `↓`**：循环高亮候选项并自动滚动至可视区；
3. **确认 `Enter` / `Tab`**：高亮时填入并触发 `onSelect` 联动；
4. **全域 Esc 与右键 Step Back**：浮层打开时按 Esc 或右键，**优先且仅关闭填表浮层**，不误触发底层页面回退。

---

## 📋 交付 Checklist

- [ ] 所有 `<input>` 声明 `autocomplete="off"` 及防原生态属性；
- [ ] 表单原生 `<select>` 增强为 `SketchSelect`；
- [ ] 关键输入项通过 `enhanceInputAutoFill` 挂载手绘联想浮层；
- [ ] 选中预设项实现全表智能联动；
- [ ] 保存成功后调用 `saveAutofillHistory`；
- [ ] 动态插入 DOM 后执行 `enhanceAllAutoFills(container)`；
- [ ] 方向键、Enter、Esc 与右键回退顺畅。
