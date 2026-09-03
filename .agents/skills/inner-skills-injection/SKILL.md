---
name: inner-skills-injection
description: 指导 Pi Desktop Lite 桌面端作为 Pi Agent 宿主代理时，运行态内置约束（Inner-Skills / RULES.md）的“基于映射按需注入 (Mapping-Driven Injection)”核心开发原则、拓扑架构、三步标准 SOP、生命周期流水线与前端反馈规范。当涉及"运行态技能"、"上下文注入"、"inner-skill"、"RULES.md"、"映射注入"、"新增inner-skill"、"bash兼容注入"、"文档OCR注入"时使用。
---

# 运行态 Inner-Skills 基于映射按需注入体系规范

规范桌面端（作为 Pi Agent 宿主与监管代理）对底层 Agent 实施**基于映射按需注入、低 Token 损耗、高注意力保持且杜绝过拟合**的运行态约束机制。

---

## 📌 核心开发铁律

1. **`RULES.md` 仅为极简映射总纲**：体积严格控制在 `< 100` Tokens，纯英文书写，作为映射关系的唯一事实来源（Single Source of Truth），严禁堆砌具体长篇规则；
2. **具体规则独立封装**：每个特定领域规则独立存放于 `src-tauri/inner-skills/<skill-name>/SKILL.md`；
3. **按需命中精准激活**：日常问答（如 `hello`）保持 100% 原始提问零注入零消耗；当且仅当底层 Agent 触发调用命中映射项的工具时，才动态激活对应 Skill。

---

## 🧭 系统全链路拓扑

```mermaid
flowchart TD
    subgraph Frontend ["🖥️ Webview 前端"]
        UserInput["用户提问"] --> ClientSend["piClient.sendPrompt"]
        EventSkill["Tauri 事件: pi:inner-skill-activated"] --> NoticeItem["「注入提示」框条目: Inner-Skill xxx (路由胶囊下方，动态累积)]
        NoticeCtx["Tauri 事件: pi:context_injected"] --> NoticeItem
        NoticeItem --> NoticeBox["「注入提示」信息框 (路由目标项目胶囊下方；直角简洁风，默认收起显示「注入提示」与注入数量，点击展开；kind+name 去重跨轮累积)]
    end

    subgraph RustSupervisor ["🛡️ Rust 宿主监督器"]
        ClientSend --> CmdPrompt["pi_send_prompt (无待注入项则 0 Token 直通)"]
        ToolHook["底层 tool_execution_start 事件"] --> HookCheck{"命中 RULES.md 映射表?"}
        HookCheck -- 命中 & 当轮首次 --> DoSteer["动态下发 steer 注入指令<br/>&lt;runtime_inner_skill name=...&gt;"]
        DoSteer --> EmitEvent["每次真实注入后广播 pi:inner-skill-activated<br/>(steer 即时注入或兑底入队均上报)"]
        EmitEvent --> EventSkill
        DoSteer -- 异常兜底 --> QueuePrompt["暂存 pending_skills 随下次 Prompt 注入"]
    end

    subgraph PiProcess ["🤖 底层 Pi Agent"]
        DoSteer -.->|即时约束| PiEngine["工具执行严格受控"]
    end
```

---

## 🗂️ 运行态 Inner-Skills 目录拓扑

```text
src-tauri/inner-skills/
├── RULES.md                                  # 映射总纲 (唯一事实来源, < 100 Tokens)
├── windows-bash-compatibility/               # 独立 Skill 1: Windows 命令行与终端兼容
├── document-multimodal-inspection/           # 独立 Skill 2: 多格式文档深度遍历与 OCR 解析
├── multi-agent-orchestration/                # 独立 Skill 3: 多智能体并行与子任务协作
├── web-search-silent-access/                 # 独立 Skill 4: 静默后台联网搜索与自动摘要
├── persistent-memory-retrieval/              # 独立 Skill 5: 持久化记忆与跨会话检索
├── dynamic-workflows-orchestration/          # 独立 Skill 6: 动态工作流与流水线编排
└── active-context-pruning/                   # 独立 Skill 7: 主动上下文修剪与长会话压缩
```

---

## 🛠️ 新增 Inner-Skill 三步标准流水线 (SOP)

### Step 1: 建立独立模块目录与 `SKILL.md`
在 `src-tauri/inner-skills/<skill-name>/` 下创建 `SKILL.md`：
```markdown
---
name: your-new-skill-name
description: 描述运行态技能在何种场景下被触发与主要约束。
---

# 技能标题 (Inner Skill)
> ⚠️ 运行态约束：本 Skill 在 Agent 触发相应工具时由桌面端动态激活生效。

## 1. 核心铁律
...
```

### Step 2: 在 `RULES.md` 注册映射关系
在 [`src-tauri/inner-skills/RULES.md`](file:///c:/Users/l4w/source/repos/pi-desktop-lite/src-tauri/inner-skills/RULES.md) 的映射表格中追加：
```markdown
| `your_tool_1`, `your_tool_2`, `intent_keyword` | `your-new-skill-name` | **Mandatory** |
```

### Step 3: 后端内嵌与前端「注入提示」框条目挂载
1. **Rust 后端 (`src-tauri/src/pi_runner/inner_skills.rs`)**：
   - 增加 `const EMBEDDED_YOUR_SKILL_MD: &str = include_str!("../../inner-skills/your-new-skill-name/SKILL.md");`；
   - 在 `get_skill_detail` 中增加匹配分支并补充单元测试。
2. **前端模块 (`src/modules/flow-pipeline.js`)**：
   - 在 `getSkillDisplayName` 注册中文友好标签（注入提示条目展示用，inner_skill 条目自动拼装展示名）；
   - 每段注入提醒：后端每次真实注入均广播一次 `pi:inner-skill-activated`，前端监听后调用 `addInjectionNoticeItem("inner_skill", skillName)` 在路由目标项目胶囊下方的「注入提示」信息框中追加条目（kind+name 去重，跨轮累积，默认收起显示「注入提示」与注入数量，全新会话重置）；
   - 路由上下文注入上报：`inject_prompt`（`src-tauri/src/pi_runner/supervisor.rs`）在兑底 Inner-Skill 与 code-area 路由上下文（`build_code_area_routing_context_with_items`）注入后广播 `pi:context_injected`（payload 携带 `items: [{kind, name}]`，kind ∈ inner_skill / agents_md / readme_md / routed_skill / routing_context），前端监听 `context-injected` 逐条追加至「注入提示」框；
   - 同步在 `src/styles/flow.css` 保留 `.flow-injection-notice` 信息框样式（直角矩形简洁风头部 + 可点击展开的条目清单，默认收起显示「注入提示」与注入数量）；
3. **构建验证**：
   - 运行 `npm run check` 确保前端 AST 与 Rust 编译均通过。

---

## ⚠️ 核心避坑准则

1. **唯一来源**：严禁在代码中写死工具映射，一律由 `RULES.md` 解析驱动；
2. **消灭假阳性**：未命中的工具绝不误触胶囊；
3. **英文精简**：`RULES.md` 必须保持纯英文且极简，压低基础 Token 开销；
4. **信封包裹**：注入必须使用 `<runtime_inner_skill>` 标签，声明仅对工具阶段生效，防止日常回答生硬复述规则。
