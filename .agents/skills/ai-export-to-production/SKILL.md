---
name: ai-export-to-production
description: 将 AI 原型平台（AI Studio、v0、bolt.new、Lovable 等）导出的前端原型代码重构改造为生产上线标准的现代前端工程。覆盖工程化配置、目录规范、路由架构、API 层建设、状态管理、UI 组件库接入、多环境配置、TypeScript 严格化与构建验证。当用户提到"代码改造"、"AI 导出代码改造"、"原型转生产项目"、"aistudio/v0/lovable 导出"、"CODE 文件怎么上线"、"原型上线"时使用。
---

# AI 原型导出 → 生产项目改造规范

适用于 AI Studio、v0、bolt.new、Lovable、Claude 等导出的前端原型代码，旨在消除原型期临时代码（switch 视图、硬编码 Mock、本地 SDK），建立健壮工程体系。

---

## Step 1：项目探测

读取 `package.json`、入口文件（`main.tsx` / `main.ts`）与 `vite.config.ts`，识别现状：

| 检查项 | 判断依据 | 生产目标 |
|---|---|---|
| **框架与版本** | `react` / `vue` 版本 | 确定核心技术栈 |
| **路由系统** | 是否存在 `react-router-dom` / `vue-router` | 消除 `useState` + `switch` 方案 |
| **状态管理** | 是否存在 `zustand` / `pinia` / `redux` | 集中状态管理 |
| **UI 组件库** | 是否存在 `antd` / `element-plus` / `shadcn-ui` | 替换临时手写 Modal/Table/Form |
| **HTTP 请求** | 是否封装 `axios` / `fetch` 拦截器 | 统一请求基准与鉴权 |
| **多环境配置** | 是否有 `.env.development` / `.env.production` | 统一 `VITE_` 前缀 |
| **TS 严格模式** | `tsconfig.json` 中 `"strict": true` | 消除 `any` 与类型隐患 |
| **代码分割** | `vite.config` 含 `manualChunks` | Vendor 分包优化 |

---

## Step 2：关键决策确认

向用户快速确认（已明确项跳过）：
1. **组件库**：是否接入/沿用特定 UI 库（Ant Design / Element Plus / Tailwind CSS 等）；
2. **后端 API**：已有标准文档（OpenAPI / Swagger / ApiFox），还是先行梳理 Mock；
3. **多端适配**：是否需要移动端响应式与抽屉导航；
4. **环境划分**：目标环境规划（dev / staging / production）。

---

## Step 3：改造执行清单

仅执行尚未完成的步骤，已存在的标准配置不覆盖。

### 3.1 工程依赖与多环境配置

```bash
# 1. 移除 AI 原型临时依赖（如 @google/genai, express, better-sqlite3 等）
# 2. 按需安装生产核心依赖
# React: react-router-dom axios zustand antd dayjs
# Vue:   vue-router axios pinia element-plus dayjs
```

多环境配置（`VITE_` 前缀）：
```ini
# .env.development -> VITE_API_BASE_URL=http://dev-api.xxx.com
# .env.staging     -> VITE_API_BASE_URL=http://staging-api.xxx.com
# .env.production  -> VITE_API_BASE_URL=https://api.xxx.com
```

### 3.2 目录结构规范化

将堆砌在单文件或 `components/` 中的页面抽离到 `pages/`：

```text
src/
├── router/         # 集中路由配置
├── pages/          # 页面级组件
├── components/     # 纯 UI / 通用复用组件
├── services/       # API 请求层（按业务模块拆分）
├── stores/         # 状态管理 (Zustand / Pinia)
├── hooks/          # 自定义 Hook / Composables
├── utils/          # 通用工具函数
└── types/          # 全局 TS 类型定义
```

### 3.3 路由系统（替换 switch 视图）

**React (`react-router-dom`)**:
```tsx
// router/index.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';

export const router = createBrowserRouter([
  { path: '/', element: <Dashboard /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
```

### 3.4 HTTP 请求层封装

```ts
// services/request.ts
import axios from 'axios';

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
});

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

request.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) { /* 清理状态并重定向 */ }
    return Promise.reject(err);
  }
);

export default request;
```

### 3.5 状态管理与 API 三态

- **状态管理**：使用 Zustand/Pinia 集中管理用户信息与全局 UI 状态；
- **API 接入与数据三态**：替换所有 hardcoded Mock 为真实调用，每个数据流必须覆盖：
  - `loading`：Skeleton 骨架屏 / 加载指示器；
  - `error`：异常提示与重试触发；
  - `empty`：空数据状态与引导。

### 3.6 TS 严格化与构建验证

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noImplicitAny": true
  }
}
```

```bash
npm run build # 确保无类型错误且构建成功 (Exit Code 0)
```

---

## 避坑铁律

1. **已有配置不覆盖**：探测到已有路由或状态管理时，保持现有体系；
2. **清理 AI 专属残余**：彻底清除 Gemini SDK、硬编码 Key 及本地 express 服务；
3. **单文件拆分**：按职责将超长单文件拆分为 `pages/`、`components/` 与 `services/`。
