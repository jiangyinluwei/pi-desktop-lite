---
name: api-integration
description: 根据 API 文档（Markdown / OpenAPI / Swagger / ApiFox 等），以模块化、强类型、包含完整加载/异常状态的标准流程为前端页面与组件接入接口。当用户提到"接接口"、"对接API"、"接口联调"、"页面接口"、"添加接口"、"看看文档接一下"时使用此技能。
---

# API 接口接入技能

## 执行流程（按顺序完成，不跳步）

### Step 1 — 检查 API 文档

**1.1 查找文档目录**

依次扫描以下候选目录（取命中的文档）：
```
doc/*.md
docs/*.md
document/*.md
documents/*.md
api-doc/*.md
apidoc/*.md
openapi.json / swagger.json
```

**1.2 判断逻辑**

- **情况 A：找到 1 份文档**：读取文件头部，确认包含 API 特征（Method、Path、请求参数、返回结构）后直接使用；
- **情况 B：找到多份文档**：提取文档标题或文件名，向用户确认本次接入使用的具体文档；
- **情况 C：未找到文档**：提示用户将 Markdown/OpenAPI 文档放入 `doc/` 或直接提供接口说明。

---

### Step 2 — 检查目标页面与组件

检查需要接入接口的目标页面或组件文件（如 `src/pages/Xxx.tsx` 或 Vue 文件）。
读取文件内容，识别数据源、触发点与交互逻辑。

---

### Step 3 — 分析页面，识别所需接口

读取页面文件，找出以下线索：
- 已有的 `TODO` / `mock` / `// 待接口` 注释；
- `fetch`、`axios`、`useEffect`、`onMounted` 等数据加载位置；
- 表格、列表、表单的数据源变量；
- 提交、查询、删除等操作函数。

同时在 API 文档中搜索匹配的接口（按资源名、业务操作）。

---

### Step 4 — 展示接入计划并确认

以表格形式向用户展示接口接入计划：

```markdown
## 接入计划

| # | 接口功能 | Method | Path | 对应页面位置 |
|---|---------|--------|------|------------|
| 1 | 获取列表 | GET    | /api/xxx/list | 表格数据加载 |
| 2 | 新增记录 | POST   | /api/xxx      | 表单提交 |

**拟创建/修改文件：**
- `src/services/modules/xxx.ts`（新建/更新 API 模块）
- `src/pages/XxxPage.tsx`（替换 mock 数据，接入真实接口）
```

确认计划符合预期后继续执行。

---

### Step 5 — 研究项目现有接口风格

在动手前，先读取现有 API 封装与类型定义：

```
src/services/request.ts 或 src/api/index.ts   // 请求实例来源
src/types/api.ts 或 src/api/types.ts         // 通用响应结构（ApiResponse、PageResult 等）
src/services/modules/*.ts                    // 参考相近业务模块的编码风格
```

规范要点：
- 请求实例与 baseURL 配置；
- 函数命名风格（如 `getXxxList`、`createXxx`、`deleteXxx`）；
- 类型定义（入参/出参 Interface）；
- 导出方式（具名导出 `export const`）。

---

### Step 6 — 执行接入

#### 6.1 新建或更新 API 模块文件（`src/services/modules/xxx.ts`）

```typescript
import request from '@/services/request';
import type { PageParams, PageResult } from '@/types/api';

// 1. 定义入参/出参类型
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

// 2. 导出类型安全的接口函数
export const getXxxList = (params: PageParams & { keyword?: string }) =>
  request.get<PageResult<XxxItem>>('/api/xxx/list', { params });

export const createXxx = (data: CreateXxxParams) =>
  request.post<XxxItem>('/api/xxx', data);

export const deleteXxx = (id: string) =>
  request.delete<void>(`/api/xxx/${id}`);
```

#### 6.2 更新页面文件

- 移除硬编码 Mock 数据，替换为真实接口调用；
- 添加 Loading 状态（骨架屏 / 加载动画）；
- 添加异常捕获与友好错误提示；
- 处理空状态（Empty）；
- 保持页面原有 UI 结构与交互流程，仅变更数据流通路。

---

### Step 7 — 完成后汇报

输出操作摘要与注意事项：
- 新建/更新的 API 模块及接口列表；
- 页面数据绑定的替换点；
- 接口文档中若有模糊字段的处理说明。

---

## 规范约束

- **不捏造字段**：类型定义与传参严格以文档为准，不确定的声明为可选 `?`；
- **保持风格一致**：新模块严格对齐项目已有请求模块的组织结构与命名习惯；
- **完善错误与加载三态**：真实接口调用必须兼顾 loading、empty、error 三种状态。
