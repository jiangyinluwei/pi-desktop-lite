---
name: api-integration
description: 根据 API 文档（Markdown / OpenAPI / Swagger / ApiFox 等），以模块化、强类型、包含完整加载/异常状态的标准流程为前端页面与组件接入接口。当用户提到"接接口"、"对接API"、"接口联调"、"页面接口"、"添加接口"、"看看文档接一下"时使用此技能。
---

# API 接口接入规范

本技能规范根据 API 文档为前端工程接入强类型、模块化与数据三态完备的接口。

---

## 执行流水线

```text
Step 1: 文档扫描 ➔ Step 2: 目标识别 ➔ Step 3: 计划确认 ➔ Step 4: 风格对齐 ➔ Step 5: 执行接入 ➔ Step 6: 构建自愈
```

### Step 1：检查与定位 API 文档

扫描候选路径：`doc/*.md`, `docs/*.md`, `document/*.md`, `api-doc/*.md`, `openapi.json`, `swagger.json`。
- **单文档命中**：读取接口特征（Method, Path, Params, Response）直接使用；
- **多文档命中**：列出标题，向用户确认接入目标；
- **未命中**：提示将文档放置于 `doc/` 或直接提供接口说明。

### Step 2：分析页面与所需接口

1. 检查目标页面（如 `src/pages/Xxx.tsx` 或 Vue 文件），定位 `mock`、`TODO`、数据加载 Hook（`useEffect` / `onMounted`）及操作函数；
2. 在 API 文档中按资源和操作检索匹配接口。

### Step 3：展示接入计划并确认

输出计划表格供用户确认：

| # | 接口功能 | Method | Path | 对应页面位置 |
|---|---|---|---|---|
| 1 | 获取列表 | GET | `/api/xxx/list` | 表格数据加载 |
| 2 | 新增记录 | POST | `/api/xxx` | 表单提交 |

拟修改/新增文件清单：`src/services/modules/xxx.ts`、`src/pages/XxxPage.tsx`。

### Step 4：对齐现有接口风格

参考现有请求模块（`src/services/request.ts`、`src/types/api.ts`），遵循项目命名规范（`getXxxList` / `createXxx` / `deleteXxx`）与具名导出。

### Step 5：编码执行

#### 5.1 创建/更新 API 模块 (`src/services/modules/xxx.ts`)

```typescript
import request from '@/services/request';
import type { PageParams, PageResult } from '@/types/api';

export interface XxxItem {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface CreateXxxParams {
  name: string;
  status?: 'active' | 'inactive';
}

export const getXxxList = (params: PageParams & { keyword?: string }) =>
  request.get<PageResult<XxxItem>>('/api/xxx/list', { params });

export const createXxx = (data: CreateXxxParams) =>
  request.post<XxxItem>('/api/xxx', data);

export const deleteXxx = (id: string) =>
  request.delete<void>(`/api/xxx/${id}`);
```

#### 5.2 更新页面组件与数据三态

- 移除硬编码 Mock，接入真实 API；
- **完备数据三态**：
  - `Loading`：骨架屏 / 加载指示器；
  - `Error`：捕获异常并提供错误提示与重试按钮；
  - `Empty`：无数据引导。

---

## 核心约束

1. **严格依据文档**：严禁捏造字段，不确定的参数声明为可选 `?`；
2. **架构一致性**：新模块严格对齐现有 API 结构与错误拦截；
3. **交付三态闭环**：真实调用必须处理 loading、empty、error 三种状态。
