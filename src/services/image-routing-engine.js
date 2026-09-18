/**
 * 生图与多模态路由引擎 (image-routing-engine.js)
 * 负责两阶段调度：
 *   Phase 1: 自动调用配置的生图/多模态路由模型执行识图解析或图片生成
 *   Phase 2: 执行完毕后无缝回归原本的会话模型，并将额外的输出文本/产物回填输入原模型继续后续交互
 */

import { piClient } from "./pi-client.js";
import { taskManager, resolveTaskSessionIdentity } from "./task-manager.js";
import { isTaskAborted, resolveEventTaskId } from "../lib/contracts.js";
import { cleanUserPrompt } from "../lib/dom-utils.js";
import { flowStore } from "./stores/flow-store.js";
import { bus } from "../lib/event-bus.js";
import { renderMarkdown, resolveMarkdownImages } from "../lib/markdown-renderer.js";

class ImageRoutingEngine {
  constructor() {
    /** @type {Map<string, Object>} */
    this._activeRoutes = new Map();
  }

  /**
   * 清除指定任务的路由记录
   * @param {string} taskId
   */
  clearRoute(taskId) {
    this._activeRoutes.delete(taskId);
  }

  /**
   * 执行两阶段生图/多模态路由流水线
   * @param {Object} options
   * @param {string} options.query 原始提问
   * @param {string} [options.promptToSend] 常规链路的完整发送 Prompt（含附件绝对路径块与指引），
   *                 Phase 2 回填以此为基文本，杜绝路由路径丢失非图片附件上下文
   * @param {Array<any>} [options.filesToAttach=[]] 附带附件
   * @param {Array<any>} [options.imagePayloads=null] 图片 Payload
   * @param {"vision" | "generation"} options.taskType 任务类型
   * @param {Object} options.originalModel 原始会话模型 { provider, id, name }
   * @param {Object} options.routingModel 路由目标模型 { provider, modelId, name }
   * @param {Object} options.currentTask 当前任务对象
   * @param {Object} options.ctx 共享上下文 (包含 api 等)
   */
  async executeRoutedTask({
    query,
    promptToSend = null,
    filesToAttach = [],
    imagePayloads = null,
    taskType,
    originalModel,
    routingModel,
    currentTask,
    ctx,
  }) {
    const taskId = currentTask.id;
    const sessionIdentity = resolveTaskSessionIdentity(currentTask);
    const api = ctx.api;

    // 路由回填期守卫标记（铁律23）：Phase 1（识图路由模型执行）的 agent_end/agent_settled 收口帧
    // 到达时，引擎即将无缝回归原会话模型继续 Phase 2 静默续跑，TaskManager 严禁提前落地
    // completed / 触发完成通知 / 预归档半截会话；Phase 2 内核运行接管后由引擎解除本标记
    currentTask.routingHandoverActive = true;

    this._activeRoutes.set(taskId, {
      taskType,
      originalModel,
      routingModel,
      query,
      phase: "phase1",
      startedAt: Date.now(),
    });

    const isVision = taskType === "vision";
    const routingModelDisplayName = routingModel.name || routingModel.modelId || "路由模型";
    const originalModelDisplayName = originalModel.name || originalModel.id || "会话模型";

    // 提示用户路由状态
    bus.emit("ui:toast", {
      text: isVision
        ? `检测到纯文本模型，已调度多模态路由 [${routingModelDisplayName}] 识别图片...`
        : `检测到绘图需求，已调度生图路由 [${routingModelDisplayName}] 生成图片...`,
      duration: 3000,
    });

    // 构造 Phase 1 提示词。
    // 注入信封铁律（铁律23）：路由调度指令属生图/识图模型链路的内部会话信息，统一包入
    // <image_routing_handover> 信封 —— 用户原始提问以裸文本置于信封前，前后端净化层
    // （Rust clean_user_prompt / 前端 cleanUserPrompt）剥离信封后，会话流、输入历史（↑导航）、
    // 会话记录与内核历史树摘要中呈现的始终是用户真实提问，内部调度信息绝不外显。
    let phase1Prompt = "";
    if (isVision) {
      const visionInstruction = query
        ? `[任务：多模态图像识别与解析]\n请深入、细致、准确地识别并解析所附图片中的全部内容、文字、结构、代码与关键数据，并结合上述用户提问给出详尽的视觉解析报告。`
        : `[任务：多模态图像识别与解析]\n请深入、细致、准确地识别并解析所附图片中的全部内容、文字、结构、代码与关键数据，给出详尽的视觉解析报告。`;
      phase1Prompt = `${query || ""}\n\n<image_routing_handover>\n${visionInstruction}\n</image_routing_handover>`;
    } else {
      // 生图任务走 pi_generate_image 专用指令直连生图接口，不经内核，无 Phase 1 提示词
      phase1Prompt = "";
    }

    try {
      // 门禁检查：发送前是否已中止
      if (isTaskAborted(currentTask)) {
        currentTask.routingHandoverActive = false;
        this.clearRoute(taskId);
        return;
      }

      // ======================================================================
      // Phase 1: 调度路由模型执行
      // ======================================================================
      let routedOutput = "";

      if (isVision) {
        const phase1Promise = new Promise((resolve, reject) => {
          let settled = false;

          const cleanup = () => {
            settled = true;
            piClient.removeEventListener("agent-end", onAgentEnd);
            piClient.removeEventListener("agent-error", onAgentError);
          };

          const onAgentEnd = (e) => {
            // taskId 解析统一走 contracts 唯一源，缺 task_id 帧回落本任务最近发送绑定
            const eTaskId = resolveEventTaskId(e.detail, piClient.lastEventTaskId);
            if (eTaskId && eTaskId !== taskId) return;
            if (settled) return;
            cleanup();
            resolve({ status: "completed" });
          };

          const onAgentError = (e) => {
            const eTaskId = resolveEventTaskId(e.detail, piClient.lastEventTaskId);
            if (eTaskId && eTaskId !== taskId) return;
            if (settled) return;
            cleanup();
            const err = new Error(e.detail?.message || "路由模型调用异常");
            // 内核流式错误帧已由 flow-pipeline 标准 agent-error 通道渲染错误卡，
            // 打标后 catch 阶段跳过 renderErrorCard，杜绝双重错误呈现
            err.kernelStreamed = true;
            reject(err);
          };

          piClient.addEventListener("agent-end", onAgentEnd);
          piClient.addEventListener("agent-error", onAgentError);
        });

        // 发送 Phase 1 提示词至识图路由模型
        await piClient.sendPrompt(
          phase1Prompt,
          imagePayloads,
          null,
          taskId,
          sessionIdentity.sessionPath,
          sessionIdentity.sessionId,
          routingModel.provider,
          routingModel.modelId
        );

        // 等待 Phase 1 执行完成
        await phase1Promise;

        const fs = flowStore.for(taskId);
        routedOutput = fs.responseText || "";
      } else {
        // 生图任务：调用专用生图指令（OpenAI /images/generations 或 DashScope 原生异步接口）
        const imagePath = await piClient.invoke("pi_generate_image", {
          providerId: routingModel.provider,
          modelId: routingModel.modelId,
          prompt: query,
        });

        const imageMarkdown = `\n\n![生成的图像](${imagePath})\n\n`;
        const fs = flowStore.for(taskId);
        const newResponseText = (fs.responseText ? fs.responseText + "\n" : "") + imageMarkdown;
        fs.set({ responseText: newResponseText });
        routedOutput = newResponseText;

        // 同步至当前任务的当前轮次
        if (Array.isArray(currentTask.turns) && currentTask.turns.length > 0) {
          const currentTurn = currentTask.turns[currentTask.turns.length - 1];
          currentTurn.responseText = newResponseText;
          currentTurn.status = "completed";
        }

        // 封口思维切片（若有）
        if (typeof api.sealActiveThinkingStep === "function") {
          api.sealActiveThinkingStep(taskId);
        }

        // 若当前轮次正处于展示，实时渲染出图片卡片并解析图片 Data URL
        const activeRefs = ctx.flowView?.activeTurnRefs;
        if (activeRefs?.responseContentEl) {
          activeRefs.responseContentEl.innerHTML = renderMarkdown(newResponseText);
          resolveMarkdownImages(activeRefs.responseContentEl);
        }
      }

      // 检查 Phase 1 结束后是否已被手动终止
      if (isTaskAborted(currentTask)) {
        currentTask.routingHandoverActive = false;
        this.clearRoute(taskId);
        return;
      }

      // ======================================================================
      // Phase 2: 收集产物，无缝回归原模型并回填
      // ======================================================================
      const fs = flowStore.for(taskId);
      routedOutput = fs.responseText || routedOutput;

      // 更新路由记录
      const routeInfo = this._activeRoutes.get(taskId);
      if (routeInfo) {
        routeInfo.phase = "phase2";
        routeInfo.phase1Output = routedOutput;
      }

      bus.emit("ui:toast", {
        text: isVision
          ? `[${routingModelDisplayName}] 图像解析已完成，正在无缝回归 [${originalModelDisplayName}] 深度解答...`
          : `[${routingModelDisplayName}] 生图已完成，正在无缝回归 [${originalModelDisplayName}] 补充设计说明...`,
        duration: 3000,
      });

      // 构造回填提示词，输入原本的会话模型（静默回填铁律）：
      // 用户真实提问（含常规链路的附件绝对路径块与指引）裸文本在前 + 路由回填说明/产物
      // 包入 <image_routing_handover> 信封。回填基文本复用 promptToSend，保证路由路径
      // 与常规路径收到完全一致的附件与上下文；净化层剥离信封后，各展示面仅见真实提问。
      const handoverBase = promptToSend || query || "";
      const handoverBody = isVision
        ? `[多模态识图路由 (${routingModelDisplayName}) 已完成图像深度识别与结构化提取，解析结果如下]:\n${routedOutput}\n\n图片解析已就绪。请结合上述图像识别解析内容，针对上述用户提问给出全面、深入、专业的技术解答。`
        : `[生图路由 (${routingModelDisplayName}) 已成功生成图片，产物与初步说明如下]:\n${routedOutput}\n\n图片已成功生成并展示。请根据上述用户提问，结合上述生成产物继续补充设计理念与后续建议。`;
      const handoverPrompt = `${handoverBase}\n\n<image_routing_handover>\n${handoverBody}\n</image_routing_handover>`;

      // 开启静默回填轮次（铁律23）：回填 Prompt 是生图/识图路由模型向会话模型传递的内部会话信息，
      // 严禁作为提问卡在会话流展示 —— 轮次快照烙印 silentPrompt 跳过提问卡渲染，
      // 轮次 query 存净化后的真实提问，保证历史恢复、输入历史与完成通知不出现内部调度文本
      taskManager.startNewTurn(taskId, cleanUserPrompt(handoverPrompt), [], { silentPrompt: true });
      if (typeof api.resetStreamState === "function") {
        api.resetStreamState(handoverPrompt, [], true, taskId, { silentPrompt: true });
      }

      // 调度原始模型续写
      await piClient.sendPrompt(
        handoverPrompt,
        null,
        null,
        taskId,
        sessionIdentity.sessionPath,
        sessionIdentity.sessionId,
        originalModel.provider,
        originalModel.id || originalModel.modelId
      );

      // Phase 2 内核运行已正式接管（其收口帧负责真实终态结算）：解除路由回填期守卫
      currentTask.routingHandoverActive = false;

      // Phase 2 启动后清理路由状态
      this.clearRoute(taskId);
    } catch (err) {
      currentTask.routingHandoverActive = false;
      this.clearRoute(taskId);
      console.error("[ImageRoutingEngine] Routing failed:", err);
      // 若已被中止则静默忽略
      if (isTaskAborted(currentTask)) return;

      // 内核流式错误（Phase 1 识图模型执行失败）已由 flow-pipeline 标准 agent-error
      // 通道渲染错误卡，这里只做状态清退，严禁重复渲染；仅引擎自有失败
      // （生图接口调用、回填预发失败等）需要本引擎兜底呈现错误卡
      if (err?.kernelStreamed) return;

      if (typeof api.renderErrorCard === "function") {
        api.renderErrorCard({
          message: `生图/多模态路由 [${routingModelDisplayName}] 执行失败: ${err.message || err}`,
          model: routingModel.modelId,
          provider: routingModel.provider,
          taskId,
        });
      }
    }
  }
}

export const imageRoutingEngine = new ImageRoutingEngine();
