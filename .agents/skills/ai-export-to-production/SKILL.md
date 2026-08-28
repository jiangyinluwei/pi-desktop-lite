---
name: ai-export-to-production
description: 将 AI 原型平台（AI Studio、v0、bolt.new、Lovable 等）导出的前端原型代码重构改造为生产上线标准的现代前端工程。覆盖工程化配置、目录规范、路由架构、API 层建设、状态管理、UI 组件库接入、多环境配置、TypeScript 严格化与构建验证。当用户提到"代码改造"、"AI 导出代码改造"、"原型转生产项目"、"aistudio/v0/lovable 导出"、"CODE 文件怎么上线"、"原型上线"时使用。
---

# AI 原型导出 → 生产项目改造

> 适用于 AI Studio、v0、bolt.new、Lovable、Claude/ChatGPT 等工具导出的前端原型代码。  
> 帮助快速消除原型期临时代码（如 switch 视图切换、硬编码 Mock、AI 专属 SDK 等），建立健壮工程体系。

---

## Step 1：项目探测

读取项目根目录结构、`package.json`、入口文件（`main.tsx` / `main.ts`）、`vite.config.ts`（或 `vite.config.js`）。

判断以下现有状态，**已有则后续跳过对应步骤**：

| 检查项 | 判断方式 |
|---|---|
| 框架 | `package.json` 中 `react` / `vue` 版本 |
| 路由 | 是否已有 `react-router-dom` / `vue-router` |
| 状态管理 | 是否已有 `zustand` / `pinia` / `redux` |
| UI 组件库 | 是否已有 `antd` / `element-plus` / `shadcn-ui` 等 |
| HTTP 请求 | 是否已有 `axios` / `fetch` 封装 |
| 多环境配置 | 是否已有 `.env.development` + `.env.production` |
| TypeScript 严格模式 | `tsconfig.json` 中 `"strict": true` |
| 代码分割 | `vite.config` 中含 `manualChunks` |

---

## Step 2：确认关键决策

根据项目探测结果，向用户确认关键技术栈与改造范围（已确定的项可跳过）：

1. **UI 组件库**：是否需要接入或沿用已有组件库（Ant Design / Element Plus / Tailwind CSS 等）；
2. **后端 API**：是否有标准 API 文档（OpenAPI / Swagger / ApiFox / Markdown），还是需先行梳理 Mock；
3. **响应式与多端**：是否需要移动端响应式适配与抽屉导航；
4. **环境划分**：目标环境配置（dev / staging / production）。

---

## Step 3：改造执行清单

根据探测与确认结果，**只执行尚未完成的步骤**，已存在的标准配置不覆盖。

### 3.1 工程基础

```
[ ] 移除 AI 原型专属临时依赖（如 @google/genai、express、better-sqlite3 等本地临时服务）
[ ] 安装核心生产依赖（缺什么装什么）：
    React: react-router-dom  axios  zustand  antd  dayjs
    Vue:   vue-router  axios  pinia  element-plus  dayjs
[ ] 多环境配置文件（所有变量统一用 VITE_ 前缀）：
    .env.development  → VITE_API_BASE_URL=http://dev-api.xxx.com
    .env.staging      → VITE_API_BASE_URL=http://staging-api.xxx.com
    .env.production   → VITE_API_BASE_URL=https://api.xxx.com
[ ] Vite 配置升级：
    resolve.alias: { '@': path.resolve('./src') }
    envPrefix: 'VITE_'
    build.rollupOptions.manualChunks:
      react-vendor / vue-vendor: [框架核心]
      chart-vendor: [recharts / echarts]
      ui-vendor: [antd / element-plus]（如有）
    optimizeDeps.include 预构建优化
    移除 AI 原型特有配置（如 GEMINI_API_KEY 注入、DISABLE_HMR）
```

### 3.2 目录结构规范化

将原型项目中混在 `components/` 或单文件中的页面级组件提取到 `pages/`：

```
src/
├── router/         # 集中路由配置
├── pages/          # 页面级组件（原 components/ 中的"页面"）
├── components/     # 纯 UI / 通用可复用组件
├── services/       # API 层（按业务模块拆分文件）
├── stores/         # 状态管理（Zustand store / Pinia store）
├── hooks/          # 自定义 Hook（React）/ Composables（Vue）
├── utils/          # 工具函数
├── contexts/       # React Context / 共享上下文
└── types/          # 全局 TypeScript 类型定义
```

### 3.3 路由系统

替换 AI 导出代码中常见的 `useState` + `switch` 视图切换方案：

**React**：
```tsx
// router/index.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';

export const router = createBrowserRouter([
  { path: '/', element: <Dashboard /> },
  // ... 其他路由
  { path: '*', element: <Navigate to="/" replace /> },
]);

// main.tsx: <RouterProvider router={router} />
```

**Vue**：
```ts
// router/index.ts
import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from '@/pages/Dashboard.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: Dashboard }],
});
// main.ts: app.use(router)
```

### 3.4 UI 组件库规范化（按需）

| 原型临时实现 | 推荐生产组件替换 |
|---|---|
| 自制临时 Modal / Dialog | UI 库 `Modal` / `Dialog` 组件 |
| 手写 Table 结构 | UI 库带分页、排序与过滤的 `Table` |
| 手写表单验证 | UI 库 `Form` 表单验证体系 |
| 图标库混用 / 复制 svg | 统一图标库体系（如 Lucide / `@ant-design/icons`） |

### 3.5 HTTP 请求层封装

```ts
// services/request.ts
import axios from 'axios';

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
});

// 请求拦截：注入 Token
request.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截：统一错误处理与数据解包
request.interceptors.response.use(
  res => res.data,
  err => {
    const status = err.response?.status;
    if (status === 401) {
      // 处理登录重定向或状态清理
    }
    return Promise.reject(err);
  }
);

export default request;
```

### 3.6 状态管理收敛

```ts
// React: stores/useAppStore.ts (Zustand)
import { create } from 'zustand';

interface AppState {
  user: UserInfo | null;
  setUser: (user: UserInfo | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
```

### 3.7 API 层对接与数据三态

```
[ ] 根据接口文档逐模块创建 services/*.ts
[ ] 统一 TypeScript 类型定义（接口入参/出参 interface）
[ ] 替换所有 mock 数据为真实接口调用
[ ] 为每个数据加载场景添加三态处理：
    loading: Skeleton 骨架屏 / Spin
    error:   异常提示与重试按钮
    empty:   空状态 Empty 说明与引导
```

### 3.8 TypeScript 严格化

```json
// tsconfig.json compilerOptions：
{
  "strict": true,
  "noUnusedLocals": true,
  "noImplicitAny": true
}
```

开启后修复所有编译报错，消除 `any` 类型。

### 3.9 构建验证

```bash
# 确认无类型报错、构建成功
npm run build
```

---

## Step 4：生成改造报告

改造完成后，可在项目根目录生成 `MIGRATION_REPORT.md`，记录改造前后的状态对比、模块划分与遗留技术债务。

---

## 注意事项

- **已有配置不覆盖**：探测到已有路由/状态管理等，跳过对应步骤；
- **AI 导出常见陷阱**：移除 Gemini AI SDK 及 express/sqlite 等仅用于原型环境的依赖；
- **单文件代码拆分**：AI 导出项目常将大量逻辑与组件堆在单一文件，按职责拆分到 `pages/`、`components/` 与 `services/`。
