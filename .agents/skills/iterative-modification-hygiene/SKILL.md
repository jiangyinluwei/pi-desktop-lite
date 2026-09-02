---
name: iterative-modification-hygiene
description: |
  指导在同一任务或连续多轮修改代码时，防范并清理代码残余、重复声明、未闭合语法结构、旧接口遗留与失效变量的清理规范与验证流水线。当涉及"清理冗余"、"多次修改代码"、"残余代码"、"代码清理"、"防止重复代码"、"语法残余"、"代码卫生"、"重构清理"时使用此技能。
---

# 连续修改与迭代重构代码卫生规范 (Iterative Modification Hygiene)

在连续多轮修改或分步重构中，防止因局部替换偏差产生幽灵代码片段（Dangling Snippets）、未闭合语法结构、重复变量声明与僵尸事件监听。

---

## ⚠️ 多次修改的四大高危病灶

| 病灶 | 典型场景 | 严重后果 |
|---|---|---|
| **幽灵函数头与未闭合残余** | 替换新函数时，旧函数的声明头或未闭合大括号未框入区间。 | JS 抽象语法树（AST）解析阻塞，应用冷启动白屏、卡死。 |
| **标识符重复声明** | 多次迭代中在不同位置重复声明全局/模块级状态（如 `let activeTurn`）。 | `Identifier 'xxx' has already been declared` 致命语法错误。 |
| **僵尸事件监听** | 重构组件交互后，旧的全局 DOM 监听器未解绑。 | 双重响应、事件穿透或空指针异常。 |
| **孤儿 DOM 选择器** | 动态 DOM 已升级，旧代码残留对已销毁占位 ID 的直接操作。 | 运行时静默报错或视图错乱。 |

---

## 🛡️ 五大黄金清理铁律

### 铁律 1：修改前必须重新对齐真实行号 (View Before Replace)
严禁凭历史记忆下发替换指令。在修改前**必须先用 `view_file` 对齐目标文件前后的真实代码切片与行号**。

### 铁律 2：除旧布新必须原子化闭环 (Clean-as-you-go)
重构方法时，新逻辑的写入与旧逻辑的删除必须在**同一个替换事务中原子完成**。替换区间必须完整包含旧函数定义及顶部注释。

### 铁律 3：替换后必须执行排重扫描 (Duplicate Grep Check)
修改核心函数/状态后，立即执行搜索，确保声明仅 1 处：
```bash
grep "const expandToolCard" src/modules/flow-ui.js
grep "activeTurnRefs" src/main.js src/modules/*.js
```

### 铁律 4：强制执行极速 AST 静态门禁 (`node -c`)
修改 JavaScript 代码后，**必须立即运行 Node.js 静态语法编译检查**（0.05秒极速完成）：
```bash
node -c src/main.js
node -c src/modules/flow-ui.js
node -c src/modules/flow-stream.js
node -c src/modules/flow-pipeline.js
node -c src/modules/task-panel.js
node -c src/services/task-manager.js
```

### 铁律 5：多轮数据结构的幂等迁移
改造核心数据结构时，同步清理旧字段（如单值 `query` 与数组 `turns`），防止脏数据互锁。

---

## 📋 标准重构清理流水线

```text
[1. view_file] 对齐真实代码切片与行号
     ↓
[2. 原子替换] 一次性替换并彻底抹除旧代码
     ↓
[3. node -c] 极速执行 JS AST 语法扫描（秒级自愈语法报错）
     ↓
[4. grep 扫描] 验证无重复声明与幽灵残余
     ↓
[5. npm run check] 验证全工程集成编译
```

---

## 📎 检查工具速查

| 检查场景 | 推荐命令 | 作用 |
|---|---|---|
| **JS 语法与 AST 完整性** | `node -c <filePath>` | 静态解析 JS 语法，秒级捕获未闭合括号与语法错误 |
| **重复声明与残余检索** | `grep_search` / `grep` | 检查关键符号声明次数，杜绝重复副本 |
| **全工程集成编译** | `npm run check` | 验证 Rust 与前端类型系统完整性 |
