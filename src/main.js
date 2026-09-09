/**
 * pi-dl 前端入口 (Orchestrator)
 *
 * 职责边界：本文件只负责两件事
 * 1. 构建共享上下文（flowDom / stores / api）
 * 2. 按依赖顺序初始化 src/modules/ 下的各功能模块
 *
 * DOM 引用（阶段 7 批次 B）：本文件不再一次性收集 DOM id 进 ctx.el ——
 * 各模块经 src/lib/el-binder.js 的 bindAll 按需自绑定自己的 id 子集，
 * Flow 域经 flow-dom.js（内部 bindAll）统一取用。具体业务逻辑一律存放在
 * src/modules/ 与 src/services/ 中。
 */
import { initViewMode } from "./modules/view-mode.js";
import { initPreferences } from "./modules/preferences.js";
import { initSettingsNavigation } from "./modules/settings-navigation.js";
import { initModelPanel } from "./modules/model-panel.js";
import { initCustomProviderPanel } from "./modules/custom-provider-panel.js";
import { initKernelPanel } from "./modules/kernel-panel.js";
import { initSessionsPanel } from "./modules/sessions-panel.js";
import { initWorkspacePanel } from "./modules/workspace-panel.js";
import { initWindowControls } from "./modules/window-controls.js";
import { viewStore } from "./services/stores/view-store.js";
import { settingsStore } from "./services/stores/settings-store.js";
import { attachmentsStore } from "./services/stores/attachments-store.js";
import { flowStore } from "./services/stores/flow-store.js";
import { initFlowUi } from "./modules/flow-ui.js";
import { createFlowDom } from "./modules/flow-dom.js";
import { flowView } from "./modules/flow-state-view.js";
import { initFlowStream } from "./modules/flow-stream.js";
import { initFlowPipeline } from "./modules/flow-pipeline.js";
import { initHumanInput } from "./modules/flow-human-input.js";
import { initFileChanges } from "./modules/flow-file-changes.js";
import { initFlowRollback } from "./modules/flow-rollback.js";
import { initTaskPanel } from "./modules/task-panel.js";
import { initFileAttachments } from "./modules/file-attachments.js";
import { initSearchInput } from "./modules/search-input.js";
import { initPackagesPanel } from "./modules/packages-panel.js";
import { initGlobalInteractions } from "./modules/global-interactions.js";

window.addEventListener("DOMContentLoaded", () => {
  /**
   * 模块共享上下文（阶段 2 起：状态收敛到 stores，ctx 不再承载裸可变状态对象）
   * - viewStore:      四态界面状态机唯一属主（morph/set，控制流命令，禁上总线）
   * - settingsStore:  设置页跨模块共享状态唯一属主（通道抽屉/官方目录/认证缓存/激活工作区）
   * - attachmentsStore: 输入框附件胶囊状态唯一属主（addFiles/removeAt/clear）
   * - flowStore:      Flow 纯数据状态唯一属主（按 taskId 分仓；流式热路径经 resolveStreamTaskId 取键）
   * - flowView:       Flow 视图派生缓存唯一属主（阶段 7 批次 A 落地，源自 flow-state-view.js：
   *                   renderedToolCards / currentSteps / active*Step / activeTurnRefs / 计时器 / followBottom。
   *                   按铁律热区清单严禁入 store；纯数据一律走 flowStore.for(taskId)，flowView 已 seal 防幽灵字段）
   * - flowDom:        Flow 域只读 DOM 引用层（内部经 el-binder.bindAll 自取，见 flow-dom.js）
   * - api:            各模块按需注册的跨模块函数调用面（阶段 3 已把 flow-render 纯渲染槽清退为显式 import，其余批次 C/D 显式化）
   */
  const ctx = {
    flowDom: createFlowDom(),
    viewStore,
    settingsStore,
    attachmentsStore,
    flowStore,
    flowView,
    api: {},
  };

  initViewMode(ctx);
  initPreferences(ctx);
  initSettingsNavigation(ctx);
  initModelPanel(ctx);
  initCustomProviderPanel(ctx);
  initKernelPanel(ctx);
  initSessionsPanel(ctx);
  initWorkspacePanel(ctx);
  initWindowControls(ctx);
  initFlowUi(ctx);
  initFlowStream(ctx);
  initFlowPipeline(ctx);
  initHumanInput(ctx);
  initFileChanges(ctx);
  initTaskPanel(ctx);
  initFlowRollback(ctx);
  initFileAttachments(ctx);
  initSearchInput(ctx);
  initPackagesPanel(ctx);
  initGlobalInteractions(ctx);
});

