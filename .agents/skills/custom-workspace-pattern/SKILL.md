---
name: custom-workspace-pattern
description: 指导面向企业客户、甲方或特定垂直领域开发与交付"私人定制工作区 (Custom / Private Workspace)"的设计规范、目录拓扑、防泄密物理隔离、5大资产标准件、多能力组合编排与线下交付流水线。
---

# 私人定制工作区设计与交付规范 (Custom Workspace Pattern)

通用客户端底座 + 私人定制工作区 = 垂直行业专属 Agent 解决方案。

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Pi Desktop Lite 体系分层                        │
├────────────────────────────────────────────────────────────────────────┤
│ 通用客户端底座 (Host Client)  : Tauri 2 + 原生 Web 前端 (通用宿主/流式交互) │
│ 运行时内核 (Pi Kernel Engine) : Rust 监督器 + 执行引擎                  │
├────────────────────────────────────────────────────────────────────────┤
│ 公共内置预设 (Public Presets) : default-area, code-area, research-area  │
│                                随安装包公开发布 (打包进 bundle.resources) │
├────────────────────────────────────────────────────────────────────────┤
│ ★ 私人定制工作区 (Custom Area): enterprise-consulting-area 等专有资产    │
│   (垂直专属 Agent 解决方案)     线下定向交付，严禁随安装包打包发布           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 隔离与防泄密四大铁律

1. **专有目录隔离**：统一放置于仓库根目录下的 `custom-workspaces/<workspace-id>/`，严禁与公共预设混放在 `workspaces/` 中；
2. **Git 忽略保护**：根目录 `.gitignore` 必须显式添加 `custom-workspaces/` 与 `custom-workspaces/*`；
3. **禁止打包资源**：`src-tauri/tauri.conf.json` 的 `bundle.resources` 严禁添加任何 `custom-workspaces/` 路径；
4. **清理构建缓存**：本地联调后确认清理 `src-tauri/target/debug/<workspace-id>` 残留。

---

## 📦 定制工作区 5 大核心资产标准件

```text
custom-workspaces/<workspace-id>/
├── workspace.json                     # 【标准件 1】工作区元数据声明 (id, name, description, icon)
├── AGENTS.md                          # 【标准件 2】工作区主控大脑 (4+1 架构、前置门禁、数据契约)
├── README.md                          # 用户场景说明与交付指引
├── scripts/
│   └── create_desktop_shortcut.ps1    # 【标准件 5】Windows 桌面交付快捷方式直达脚本
├── .agents/skills/                    # 【标准件 3】私有领域技能库 (JIT 按需唤醒 + 合规 Gate 技能)
├── templates/                         # 【标准件 4】行业实战模板与深度底稿库
├── input_materials/                   # 业务输入材料区
└── output_artifacts/                  # 成果归档区 (01~05 阶段骨架)
```

### 1. 工作区元数据 (`workspace.json`)

```json
{
  "id": "enterprise-consulting-area",
  "name": "综合申报与咨询区",
  "description": "面向科技项目审查、高企认证归集与申报的复合工作区：动态编排、前置材料门禁与桌面成果直达。",
  "icon": "document"
}
```

### 2. 主控大脑 (`AGENTS.md`) 核心契约

- **原子能力抽象**：业务解耦为独立能力单元 + 终审 Gate；
- **前置材料门禁 (Prerequisite Gate)**：首节点材料完备性校验，材料缺失输出自查清单，严禁脑补；
- **事实锁死 (Fact-Lock)**：跨表勾稽一致，严守行业合规红线；
- **开场协议**：意图嗅探 ➔ 前置自检 ➔ 执行 ➔ 终审定稿与桌面直达。

---

## 🚀 交付与部署流程

```text
[1. 资产打包] custom-workspaces/<id>/ 压制为 zip
     ↓
[2. 定向传输] 线下加密传输给客户/乙方
     ↓
[3. 客户部署] 解压至 ~/.pi-dl/workspaces/<id>/
     ↓
[4. 激活使用] Pi Desktop Lite -> 设置 -> 工作区 -> 点击切换
```

---

## 📋 交付验收清单

- [ ] `custom-workspaces/` 已被 `.gitignore` 忽略；
- [ ] `tauri.conf.json` 中无私有工作区路径；
- [ ] `workspace.json` 元数据完整无误；
- [ ] `AGENTS.md` 具备前置门禁与数据契约；
- [ ] `.agents/skills/` 包含全套业务与合规 Gate 技能；
- [ ] `output_artifacts/` 与快捷方式脚本已就绪。
