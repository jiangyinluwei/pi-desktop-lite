---
name: custom-workspace-pattern
description: 指导面向企业客户、甲方或特定垂直领域开发与交付"私人定制工作区 (Custom / Private Workspace)"的设计规范、目录拓扑、防泄密物理隔离、5大资产标准件、多能力组合编排与线下交付流水线。
---

# 私人定制工作区设计与交付规范 (Custom Workspace Pattern)

## 1. 概念定位与架构哲学

在 **Pi Desktop Lite** 体系中，桌面软件本身是通用底座与可视化宿主（Host），而真正赋予软件垂直行业专家能力的是**工作区（Workspace）**。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Pi Desktop Lite 体系分层                        │
├────────────────────────────────────────────────────────────────────────┤
│ 通用客户端底座 (Host Client)  : Tauri 2 + 原生 Web 前端 (通用外壳/流式交互)  │
│ 运行时内核 (Pi Kernel Engine) : Rust 监督器 + Node/Python 执行引擎       │
├────────────────────────────────────────────────────────────────────────┤
│ 公共内置预设 (Public Presets) : default-area, code-area, research-area  │
│                                随安装包公开发布 (打包进 bundle.resources) │
├────────────────────────────────────────────────────────────────────────┤
│ ★ 私人定制工作区 (Custom Area): enterprise-consulting-area 等专有资产    │
│   (垂直专属 Agent 解决方案)     线下定向交付给乙方/客户，绝不公开打包发布   │
└────────────────────────────────────────────────────────────────────────┘
```

> 💡 **核心定义**：**通用客户端底座 + 私人定制工作区 = 垂直行业专属 Agent 解决方案**。  
> 私人定制工作区承载了高价值商业咨询方法论、私有行业技能、深度底稿模板与合规逻辑，必须与开源/公共代码库实行**物理隔离与安全防泄密管控**。

---

## 2. 隔离与防泄密四大工程铁律

1. **专有目录物理隔离**：
   所有非公开发布的私人定制工作区统一放置于仓库根目录下的 `custom-workspaces/<workspace-id>/`，严禁与公共预设混放在 `workspaces/` 中；
2. **Git 版本控制显式忽略**：
   必须在根目录 `.gitignore` 中显式添加：
   ```gitignore
   # 私人定制与专有交付工作区 (Custom / Private Workspaces)
   custom-workspaces/
   custom-workspaces/*
   ```
   严禁将定制工作区代码、商业模板或客户敏感数据提交到公共代码仓库；
3. **严禁写入打包资源列表 (`bundle.resources`)**：
   `src-tauri/tauri.conf.json` 的 `bundle.resources` 仅允许注册公共开源预设，严禁添加任何 `custom-workspaces/` 路径，彻底防止正式 Release 安装包中泄漏私有资产；
4. **构建缓存及时清理**：
   若在本地开发调试阶段曾将定制工作区引入进行联调，在发布或切换前应确认清理 `src-tauri/target/debug/<workspace-id>` 残留，避免本地多层寻址机制在 UI 中展示历史构建缓存。

---

## 3. 定制工作区 5 大核心资产标准件

一个标准的定制工作区目录结构必须包含以下 5 大标准件：

```text
custom-workspaces/<workspace-id>/
│
├── workspace.json                     # 【标准件 1】工作区元数据声明
├── AGENTS.md                          # 【标准件 2】工作区主控大脑与调度规程
├── README.md                          # 用户指引与业务场景说明
├── scripts/
│   └── create_desktop_shortcut.ps1    # 【标准件 5】Windows 桌面交付直达脚本
│
├── .agents/skills/                    # 【标准件 3】私有领域技能库 (JIT 按需唤醒)
│   ├── 01-domain-core-skill/          # 核心领域业务分析/测算技能
│   ├── ...                            # 其他专项业务技能
│   ├── 04-writing-humanizer/          # 去 AI 机械感专业润色技能
│   └── 05-compliance-audit/           # [Gate] 终审合规与红线复核兜底技能
│
├── templates/                         # 【标准件 4】行业级实战模板与深度底稿库
├── input_materials/                   # 输入材料区（按业务分类预置空目录）
└── output_artifacts/                  # 成果归档区（按阶段预置 01~05 子目录骨架）
```

### 标准件 1：工作区元数据 (`workspace.json`)
```json
{
  "id": "enterprise-consulting-area",
  "name": "综合申报与咨询区",
  "description": "面向企业科技项目审查、专利挖掘交底、高企认证归集与专项申报的复合工作区：支持四大能力 15 种幂集动态编排、前置材料门禁、终审合规兜底与桌面成果直达。",
  "icon": "document"
}
```

### 标准件 2：主控大脑 (`AGENTS.md`)
必须具备以下调度与安全约束体系：
- **角色定位与业务抽象**：将垂直业务抽象为解耦的原子能力单元 + 终审 Gate；
- **动态幂集 DAG 组合调度器**：支持单点专项、双能力协同、多链条贯通的动态拓扑编排；
- **前置材料完备性检查门禁 (Prerequisite Gate)**：首节点与跳跃节点自检，材料不足输出《前置关联材料自查与补充清单》，绝不脑补虚构；
- **阶段数据契约表 (Data Contracts)**：明确各阶段输入、输出相对路径与流转硬指标（如比例阶梯、评分门限、唯一映射）；
- **核心防虚构与合规红线 (Fact-Lock & Anti-Hallucination)**：100% 事实锁死、跨表勾稽一致、行业法律法规/审查红线防范；
- **会话开场协议 (Session Kickoff Protocol)**：意图嗅探 ➔ 前置自检 ➔ 门禁拦截/执行 ➔ 终审定稿与桌面直达交付。

### 标准件 3：私有领域技能库 (`.agents/skills/`)
- 按需唤醒（JIT Loading），避免无谓占用 Agent 上下文窗口；
- 必须配备终审合规技能（如 `05-compliance-audit`）及对应的自动化静态检验脚本（`validate_final_package.py`）。

### 标准件 4：实战深度模板库 (`templates/`)
- 严禁仅提供空洞占位符模板，必须沉淀行业级实战范式（如 SCQA 叙事、因果链推演、三表勾稽表、八大科目归集底稿、权利要求树）；
- 命名保持语义清晰，与主控 `AGENTS.md` 的阶段契约无缝映射。

### 标准件 5：自动化交付脚本 (`scripts/create_desktop_shortcut.ps1`)
- 首次向 `output_artifacts/` 输出文档时自动在用户 Windows 桌面创建 `.lnk` 快捷方式，直达交付成果库。

---

## 4. 私有化封装与乙方交付部署流程

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      定制工作区私有化交付全链路                        │
 └────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
             [步骤 1: 资产打包] 将 custom-workspaces/<id>/ 压制为 zip
                                      │
                                      ▼
             [步骤 2: 定向传输] 线下加密传输给乙方/客户团队
                                      │
                                      ▼
             [步骤 3: 乙方导入] 解压部署至 ~/.pi-dl/workspaces/<id>/
                                      │
                                      ▼
             [步骤 4: 激活使用] 打开 Pi Desktop Lite -> 设置 -> 工作区切换
                                      │
                                      ▼
             [步骤 5: 成果直达] Agent 运行沉淀成果，桌面快捷方式一键直达
```

### 4.1 交付打包命令示例
```powershell
# 在开发端将定制工作区打包
Compress-Archive -Path "custom-workspaces/enterprise-consulting-area" -DestinationPath "enterprise-consulting-area.zip" -Force
```

### 4.2 乙方部署与激活指引
1. **解压放置**：
   乙方解压该压缩包，将文件夹放置于用户运行时目录：
   ```text
   C:\Users\<用户名>\.pi-dl\workspaces\enterprise-consulting-area\
   ```
2. **启动软件与切换**：
   启动 **Pi Desktop Lite**，进入「设置 ➔ 工作区」，在列表中点击切换至「综合申报与咨询区」；
3. **即刻生效**：
   软件自动重载并以该定制工作区的 `AGENTS.md`、专属技能库与实战模板为 Agent 主脑运行。

---

## 5. 验收与交付检查清单 (Checklist)

在向乙方交付定制工作区前，执行以下最终审查：

- [ ] **物理隔离检查**：工作区位于 `custom-workspaces/`，且已被 `.gitignore` 忽略；
- [ ] **打包配置审查**：`src-tauri/tauri.conf.json` 中无私有工作区路径；
- [ ] **元数据完整性**：`workspace.json` 中的 `id`、`name`、`description` 准确无误；
- [ ] **主脑闭环审查**：`AGENTS.md` 包含 4+1 架构、幂集组合、前置门禁、数据契约表与开场协议；
- [ ] **技能库齐备性**：`.agents/skills/` 包含全套业务技能与终审合规 Gate 技能；
- [ ] **模板深度审查**：`templates/` 包含行业级实战模板，非极简空占位符；
- [ ] **目录拓扑就绪**：`output_artifacts/` 预置 01~05 阶段子目录骨架；
- [ ] **交付脚本验证**：`scripts/create_desktop_shortcut.ps1` 路径与桌面快捷方式名称正确。
