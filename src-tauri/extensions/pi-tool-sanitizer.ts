/**
 * pi-tool-sanitizer — Pi 内核工具调用全链路自愈扩展 (Tool Call Full-Chain Sanitizer)
 *
 * 作用机制：
 * 1. 【请求发送前防线 (before_provider_request)】：
 *    - 当会话具有工具历史但当前轮次未提供活动工具时，部分协议适配器会输出 `"tools": []`；
 *    - 某些严格校验的服务商（如 Atria-Dawn-Preview、InternLM、Groq 等）会直接报错 400：
 *      "`tools` must not be an empty array. Either provide at least one tool or omit the field entirely."；
 *    - 本扩展自动剔除空的 `tools` 数组与孤立的 `tool_choice`，彻底消除 400 校验阻断；
 *    - 针对 Pi 0.86.0 的 transcript 工具锚定机制被第三方上下文扩展破坏的情形
 *      （典型：pai-acp 的 `context` 钩子重建消息时丢弃 system 消息及其 `toolsAdded` 工具声明，
 *      导致 provider 请求整体缺失 `tools` 字段，模型无法发起结构化工具调用，
 *      只能以正文模拟命令或空响应收场且 stopReason=stop，会话"一到工具调用就自己结束"），
 *      本扩展在请求发出前从会话 system 条目读回 `toolsAdded` 锚定声明，
 *      按当前 provider 协议形状（OpenAI Completions / Anthropic Messages）重新注入 `tools`，
 *      每请求自愈，且不干预任何已正常携带 `tools` 的请求；
 *    - 防御性剥离工具定义上的 `strict` 字段，保持宽松容错采样。
 * 2. 【模型输出净化防线 (message_end)】：
 *    - 针对特定模型（如 DeepSeek-V4 系列）入参包裹在冗余外壳（{"arguments": {"command": "..."}} 等）；
 *    - 针对预览/推理模型将 XML 格式（`<invoke name="...">`）或换行指令直接嵌入 `toolCall.name` 的问题；
 *    - 针对部分模型将工具调用以私有协议标签直接输出在正文文本中（如 DeepSeek 原生 `<｜｜DSML｜｜ calls>` 标签、
 *      标准 XML `<invoke>` 标签、`<bash>` 标签）而未被平台结构化的情况，自动从正文抽取并转换为标准 `toolCall` 块；
 *    - 在 `message_end` 阶段规范化工具名、就地提取命令参数并剥离嵌套外壳，恢复为扁平标准结构。
 *    - 注意：不对正文中普通 Markdown 命令代码块做提取——那可能是模型展示给用户的合法示例，
 *      贸然转为真实执行会劫持回答语义；私有协议标签才是可靠的"泄漏工具调用"信号。
 * 3. 【工具执行前底层清洗防线 (tool_call)】：
 *    - 在 `tool_call` 执行阶段进行二次兜底，消除由于参数多层嵌套或名称异常引发的
 *      Validation failed / Tool not found 错误，斩断模型误判与自激死循环。
 *
 * 安全边界：
 * - 纯内存对象规范化；工具锚定修复仅在 `payload.tools` 缺失或为空且会话确有锚定声明时介入；
 * - 工具名修复仅对真正畸形的名称（含空白/尖括号等非法字符）生效，纯净名称 100% 原样直通；
 * - 全流程 try-catch 保护，任何异常均安全降级，绝不阻塞或中断正常会话。
 */

interface UnwrapResult {
  unwrapped: any;
  changed: boolean;
  layers: number;
}

interface NameSanitizeResult {
  name: string;
  args: any;
  changed: boolean;
}

/**
 * 递归剥离冗余的 arguments / parameters / args 包装外壳
 */
function unwrapToolCallArguments(args: any): UnwrapResult {
  let current = args;
  let changed = false;
  let layers = 0;

  // 1. 若入参为 JSON 字符串，尝试解析为对象
  if (typeof current === "string") {
    const trimmed = current.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        current = JSON.parse(trimmed);
        changed = true;
      } catch {
        return { unwrapped: args, changed: false, layers: 0 };
      }
    } else {
      return { unwrapped: args, changed: false, layers: 0 };
    }
  }

  // 2. 循环解包常见的外壳结构
  while (current && typeof current === "object" && !Array.isArray(current)) {
    const keys = Object.keys(current);
    if (keys.length === 0) break;

    // 情况 A：顶级单键为 arguments / parameters / args
    if (
      keys.length === 1 &&
      (keys[0] === "arguments" || keys[0] === "parameters" || keys[0] === "args") &&
      current[keys[0]] &&
      typeof current[keys[0]] === "object" &&
      !Array.isArray(current[keys[0]])
    ) {
      current = current[keys[0]];
      changed = true;
      layers++;
      continue;
    }

    // 情况 B：参数被错误地嵌套在参数自身同名属性下（如 path: { path: "..." } 或 path: { arguments: { ... } }）
    if (
      keys.length === 1 &&
      current[keys[0]] &&
      typeof current[keys[0]] === "object" &&
      !Array.isArray(current[keys[0]])
    ) {
      const subObj = current[keys[0]];
      if (
        subObj[keys[0]] !== undefined ||
        subObj.arguments ||
        subObj.parameters ||
        subObj.args ||
        subObj.command ||
        subObj.path
      ) {
        current = subObj;
        changed = true;
        layers++;
        continue;
      }
    }

    // 情况 C：对象中存在 arguments / parameters / args 子对象，且当前顶级不包含常规参数键
    const hasCommonParams =
      Boolean(current.command) ||
      Boolean(current.query) ||
      Boolean(current.pattern) ||
      typeof current.path === "string";

    if (!hasCommonParams) {
      if (
        current.arguments &&
        typeof current.arguments === "object" &&
        !Array.isArray(current.arguments)
      ) {
        current = current.arguments;
        changed = true;
        layers++;
        continue;
      }
      if (
        current.parameters &&
        typeof current.parameters === "object" &&
        !Array.isArray(current.parameters)
      ) {
        current = current.parameters;
        changed = true;
        layers++;
        continue;
      }
      if (
        current.args &&
        typeof current.args === "object" &&
        !Array.isArray(current.args)
      ) {
        current = current.args;
        changed = true;
        layers++;
        continue;
      }
    }

    break;
  }

  return { unwrapped: current, changed, layers };
}

/**
 * 规范化畸形 toolCall.name，并从中提取泄漏的命令或参数
 * （例如模型生成 `<invoke name="bash"><parameter name="command">...</parameter></invoke>`、
 *  `read path="..."</arg_value>` 或 `bash\n\ncd ...`）
 *
 * 仅当名称真正畸形（含空白、尖括号、换行等非法字符）时才进入修复分支；
 * 纯净合法的名称（如第三方扩展注册的 "finder" 等）100% 原样直通，杜绝前缀误改。
 */
function sanitizeToolCallNameAndArguments(rawName: string, rawArgs: any): NameSanitizeResult {
  let name = String(rawName || "").trim();
  let args = rawArgs;
  let changed = false;

  // 0. 名称纯净（仅合法标识符字符）且不含标签结构时，直接通过
  if (/^[a-zA-Z0-9_\-]+$/.test(name) && name.indexOf("<") < 0) {
    return { name, args, changed: false };
  }

  const knownTools = ["read", "write", "edit", "grep", "find", "ls", "bash", "powershell", "cmd", "sh", "terminal", "run_command"];

  // 1. 针对模型将 XML 标签嵌入工具名的模式（如 `<invoke name="bash">`）
  const invokeMatch = name.match(/<invoke\s+name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)(?:<\/invoke>|$)/i);
  if (invokeMatch) {
    const realName = invokeMatch[1].trim();
    const innerContent = invokeMatch[2];
    name = realName;
    changed = true;

    const paramRegex = /<parameter\s+name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)(?:<\/parameter>|$)/gi;
    let match: RegExpExecArray | null;
    const extractedParams: Record<string, any> = {};
    while ((match = paramRegex.exec(innerContent)) !== null) {
      extractedParams[match[1].trim()] = match[2].trim();
    }
    if (Object.keys(extractedParams).length > 0) {
      args = { ...(typeof args === "object" && args !== null ? args : {}), ...extractedParams };
    }
  }

  // 2. 针对模型在工具名后跟非标准字符（如 `bash</arg_key>><parameter name="command">...` 或 `read path="..."`）
  if (!invokeMatch) {
    // 检查是否有 <parameter name="...">...</parameter> 或 <arg_value>...</arg_value> 等标签
    const paramRegex = /<parameter\s+name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)(?:<\/parameter>|$)/gi;
    let paramMatch: RegExpExecArray | null;
    const extractedParams: Record<string, any> = {};
    while ((paramMatch = paramRegex.exec(name)) !== null) {
      extractedParams[paramMatch[1].trim()] = paramMatch[2].trim();
    }

    // 提取工具名前缀（开头的字母数字下划线连字符）
    const prefixMatch = name.match(/^([a-zA-Z0-9_\-]+)([\s\S]*)$/);
    if (prefixMatch) {
      const baseCandidate = prefixMatch[1].toLowerCase();
      const matchedTool = knownTools.find(t => baseCandidate === t || baseCandidate.startsWith(t));
      if (matchedTool) {
        name = matchedTool;
        changed = true;

        if (Object.keys(extractedParams).length > 0) {
          args = { ...(typeof args === "object" && args !== null ? args : {}), ...extractedParams };
        } else {
          const rest = prefixMatch[2];
          const kvRegex = /([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*=\s*(["'])([\s\S]*?)\2/g;
          let kvMatch: RegExpExecArray | null;
          const kvParams: Record<string, any> = {};
          while ((kvMatch = kvRegex.exec(rest)) !== null) {
            const rawKey = kvMatch[1];
            const val = kvMatch[3];
            let normKey = rawKey;
            if (/^(path|file|filepath|target)$/i.test(rawKey)) normKey = "path";
            else if (/^(command|cmd|code|命令)$/i.test(rawKey)) normKey = "command";
            kvParams[normKey] = val;
          }
          if (Object.keys(kvParams).length > 0) {
            args = kvParams;
          } else {
            const cleanRest = rest.replace(/<\/?[^>]+>/g, "").trim();
            if (cleanRest) {
              if (/^(bash|powershell|cmd|sh|terminal|run_command)$/i.test(name)) {
                args = { command: cleanRest };
              } else if (/^(read|write|edit|grep|find|ls)$/i.test(name)) {
                args = { path: cleanRest };
              }
            }
          }
        }
      }
    }
  }

  name = name.replace(/[^a-zA-Z0-9_\-]/g, "");

  return { name, args, changed };
}

/**
 * 从普通文本块中提取模型以私有协议标签泄漏的工具调用
 * （DeepSeek DSML 原生标签 / 标准 XML <invoke> 标签 / <bash> 标签）
 */
function extractToolsFromText(text: string): { toolCalls: any[]; cleanedText: string } {
  const toolCalls: any[] = [];
  let cleanedText = text;

  // 1. 匹配 DeepSeek 原生 DSML 标签: <｜｜DSML｜｜ invoke name="...">...<｜｜DSML｜｜ parameter name="...">...</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke>
  const dsmlInvokeRegex = /<[｜|]{2}DSML[｜|]{2}\s+invoke\s+name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/[｜|]{2}DSML[｜|]{2}\s+invoke>/gi;
  let match: RegExpExecArray | null;
  while ((match = dsmlInvokeRegex.exec(text)) !== null) {
    const toolName = match[1].trim();
    const body = match[2];
    const paramRegex = /<[｜|]{2}DSML[｜|]{2}\s+parameter\s+name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/[｜|]{2}DSML[｜|]{2}\s+parameter>/gi;
    let pMatch: RegExpExecArray | null;
    const args: Record<string, any> = {};
    while ((pMatch = paramRegex.exec(body)) !== null) {
      args[pMatch[1].trim()] = pMatch[2].trim();
    }
    toolCalls.push({
      type: "toolCall",
      id: "dsml-" + Math.random().toString(36).slice(2, 10),
      name: toolName,
      arguments: args
    });
  }
  if (toolCalls.length > 0) {
    cleanedText = cleanedText
      .replace(/<[｜|]{2}DSML[｜|]{2}\s+calls>[\s\S]*?<\/[｜|]{2}DSML[｜|]{2}\s+calls>/gi, "")
      .replace(/<[｜|]{2}DSML[｜|]{2}\s+invoke[\s\S]*?<\/[｜|]{2}DSML[｜|]{2}\s+invoke>/gi, "")
      .trim();
    return { toolCalls, cleanedText };
  }

  // 2. 匹配标准 XML <invoke name="..."> 标签
  const xmlInvokeRegex = /<invoke\s+name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/invoke>/gi;
  while ((match = xmlInvokeRegex.exec(text)) !== null) {
    const toolName = match[1].trim();
    const body = match[2];
    const paramRegex = /<parameter\s+name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/parameter>/gi;
    let pMatch: RegExpExecArray | null;
    const args: Record<string, any> = {};
    while ((pMatch = paramRegex.exec(body)) !== null) {
      args[pMatch[1].trim()] = pMatch[2].trim();
    }
    if (Object.keys(args).length === 0 && body.trim()) {
      if (/^(bash|powershell|cmd|sh|terminal|run_command)$/i.test(toolName)) {
        args.command = body.trim();
      } else if (/^(read|write|edit|grep|find|ls)$/i.test(toolName)) {
        args.path = body.trim();
      }
    }
    toolCalls.push({
      type: "toolCall",
      id: "xml-" + Math.random().toString(36).slice(2, 10),
      name: toolName,
      arguments: args
    });
  }
  if (toolCalls.length > 0) {
    cleanedText = cleanedText.replace(/<invoke[\s\S]*?<\/invoke>/gi, "").trim();
    return { toolCalls, cleanedText };
  }

  // 3. 匹配模型生成的 <bash>...</bash> 标签（如 <bash cmd="...">...</bash>）
  const bashTagRegex = /<bash(?:\s+cmd=["']([^"']+)["']|\s+[^>]*)?>([\s\S]*?)<\/bash>/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = bashTagRegex.exec(text)) !== null) {
    let cmd = bMatch[1] ? bMatch[1].trim() : "";
    const body = bMatch[2] ? bMatch[2].trim() : "";
    if (!cmd && body) {
      const innerCodeMatch = body.match(/```(?:bash|sh|cmd|powershell)?\s*\n([\s\S]*?)\n```/i);
      if (innerCodeMatch) {
        cmd = innerCodeMatch[1].trim();
      } else if (body) {
        cmd = body;
      }
    }
    if (cmd) {
      toolCalls.push({
        type: "toolCall",
        id: "bash-tag-" + Math.random().toString(36).slice(2, 10),
        name: "bash",
        arguments: { command: cmd }
      });
    }
  }
  if (toolCalls.length > 0) {
    cleanedText = cleanedText
      .replace(/<bash(?:\s+[^>]*)?>[\s\S]*?<\/bash>/gi, "")
      .replace(/<acp\s+[^>]*>[\s\S]*?<\/acp>/gi, "")
      .trim();
    return { toolCalls, cleanedText };
  }

  return { toolCalls, cleanedText };
}

/**
 * 从会话条目中恢复当前上下文的工具锚定声明
 *
 * Pi 0.86.0 将工具声明以 `toolsAdded` / `toolsRemoved` 形式锚定在会话的 system 消息上，
 * provider 适配器请求时经 getCurrentTools() 解析。第三方上下文扩展（pai-acp）重建消息
 * 丢弃 system 消息后该锚定即丢失。这里镜像内核 getCurrentTools 的合并语义
 * （逐条目先删后增），从活动分支条目中恢复最终生效的工具声明列表。
 */
function getAnchoredToolDeclarations(ctx: any): any[] {
  try {
    const sm = ctx?.sessionManager;
    if (!sm || typeof sm !== "object") return [];
    let entries: any[] | undefined;
    // 优先活动分支 + compaction 后的上下文条目（与请求构建所见完全一致）
    if (typeof sm.buildContextEntries === "function") {
      entries = sm.buildContextEntries();
    } else if (typeof sm.getBranch === "function") {
      entries = sm.getBranch();
    } else if (typeof sm.getEntries === "function") {
      entries = sm.getEntries();
    }
    if (!Array.isArray(entries)) return [];

    const tools = new Map<string, any>();
    for (const entry of entries) {
      const message = entry && entry.type === "message" ? entry.message : entry;
      if (!message || message.role !== "system") continue;
      for (const removed of message.toolsRemoved ?? []) {
        if (removed && removed.name) tools.delete(removed.name);
      }
      for (const added of message.toolsAdded ?? []) {
        if (added && added.name) tools.set(added.name, added);
      }
    }
    return [...tools.values()];
  } catch {
    return [];
  }
}

/**
 * 将内核工具声明（{ name, description, parameters }）转换为当前请求 payload 的 provider 协议形状
 */
function convertDeclarationsToProviderTools(declarations: any[], payload: any): any[] {
  const toParameters = (decl: any) => {
    const params = decl.parameters && typeof decl.parameters === "object" ? decl.parameters : { type: "object", properties: {} };
    try {
      return JSON.parse(JSON.stringify(params));
    } catch {
      return { type: "object", properties: {} };
    }
  };

  // Anthropic Messages 协议：system 位于顶层字段
  const isAnthropicStyle = payload.system !== undefined;
  if (isAnthropicStyle) {
    return declarations.map((decl) => ({
      name: String(decl.name),
      description: String(decl.description ?? ""),
      input_schema: toParameters(decl)
    }));
  }

  // 默认 OpenAI 兼容（Chat Completions）协议
  return declarations.map((decl) => ({
    type: "function",
    function: {
      name: String(decl.name),
      description: String(decl.description ?? ""),
      parameters: toParameters(decl)
    }
  }));
}

export default function (pi: any) {
  if (!pi || typeof pi.on !== "function") {
    return;
  }

  // 阶段 0：在请求发送给 Provider 前（before_provider_request）
  // 1. 剔除空的 tools 数组与孤立的 tool_choice，彻底杜绝 Atria / InternLM / Groq 等服务商
  //    报 400："`tools` must not be an empty array. Either provide at least one tool or omit the field entirely."
  // 2. Pi 0.86.0 工具锚定修复：第三方上下文扩展（pai-acp context 钩子）重建消息丢弃 system 的
  //    toolsAdded 后，请求整体缺失 tools 字段导致模型无法发起结构化工具调用——
  //    从会话锚定声明恢复并按 provider 形状重新注入，每请求自愈。
  // 3. 防御性剥离工具定义上的 strict 字段，保持宽松容错采样。
  pi.on("before_provider_request", async (event: any, ctx: any) => {
    try {
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") return;

      if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
        // 缺失或空工具：优先尝试从会话锚定声明恢复（0.86.0 工具锚定修复）
        const anchored = getAnchoredToolDeclarations(ctx);
        if (anchored.length > 0) {
          payload.tools = convertDeclarationsToProviderTools(anchored, payload);
          try {
            console.log(
              `[pi-tool-sanitizer] Restored ${anchored.length} anchored tool declaration(s) to provider request (transcript tool anchoring was lost)`
            );
          } catch {}
        } else {
          // 会话确无工具（如纯聊天上下文）：剔除空数组与孤立 tool_choice，杜绝 400 校验阻断
          delete payload.tools;
          if (payload.tool_choice) {
            delete payload.tool_choice;
          }
          try {
            console.log(
              "[pi-tool-sanitizer] Omitted empty `tools` array from provider request to prevent API rejection"
            );
          } catch {}
        }
      } else {
        // 工具本就存在：仅防御性剥离 strict 字段
        let strictCleaned = false;
        for (const tool of payload.tools) {
          if (tool && typeof tool === "object") {
            if (tool.strict !== undefined) {
              delete tool.strict;
              strictCleaned = true;
            }
            if (tool.function && typeof tool.function === "object" && tool.function.strict !== undefined) {
              delete tool.function.strict;
              strictCleaned = true;
            }
          }
        }
        if (strictCleaned) {
          try {
            console.log(
              "[pi-tool-sanitizer] Stripped strict mode constraint from provider tools to ensure robust tool calling"
            );
          } catch {}
        }
      }

      return payload;
    } catch {
      // 容错降级，不阻断主流程
    }
  });

  // 阶段 1：在 message_end 阶段（工具 Schema 验证之前）对 assistant 消息中的 toolCall 进行工具名修复与入参净化
  pi.on("message_end", async (event: any) => {
    try {
      const message = event?.message;
      if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
        return;
      }

      let modified = false;

      // 0. 若助手正文中包含模型以私有协议标签直接输出的工具调用（DSML / XML / <bash>），自动转换为标准 toolCall 块
      const extractedCalls: any[] = [];
      for (const block of message.content) {
        if (block && block.type === "text" && typeof block.text === "string") {
          const { toolCalls: extracted, cleanedText } = extractToolsFromText(block.text);
          if (extracted.length > 0) {
            extractedCalls.push(...extracted);
            block.text = cleanedText;
            modified = true;
          }
        }
      }

      if (extractedCalls.length > 0) {
        // 过滤由于提取工具而彻底变为空白的无意义文本块
        message.content = message.content.filter((b: any) => {
          if (b && b.type === "text") {
            return typeof b.text === "string" && b.text.trim().length > 0;
          }
          return true;
        });
        message.content.push(...extractedCalls);
        modified = true;
      }

      for (const block of message.content) {
        if (!block || typeof block !== "object") continue;

        // 兼容 toolCall (OpenAI/Pi) 及 tool_use (Anthropic)
        if (block.type === "toolCall" || block.type === "tool_use") {
          const targetKey =
            block.arguments !== undefined
              ? "arguments"
              : block.input !== undefined
              ? "input"
              : "arguments";

          let rawArgs = block[targetKey];

          // 1. 修复畸形 toolCall.name 并提取嵌入在 name 中的参数
          if (typeof block.name === "string") {
            const nameRes = sanitizeToolCallNameAndArguments(block.name, rawArgs);
            if (nameRes.changed) {
              block.name = nameRes.name;
              rawArgs = nameRes.args;
              block[targetKey] = rawArgs;
              modified = true;
              try {
                console.log(
                  `[pi-tool-sanitizer] Repaired tool name to "${block.name}" and recovered extracted arguments`
                );
              } catch {}
            }
          }

          // 2. 解包多层嵌套的 arguments / parameters / args 外壳
          if (rawArgs !== undefined && rawArgs !== null) {
            const { unwrapped, changed, layers } = unwrapToolCallArguments(rawArgs);
            if (changed) {
              block[targetKey] = unwrapped;
              modified = true;
              try {
                console.log(
                  `[pi-tool-sanitizer] Auto-unwrapped ${layers} layer(s) of arguments for tool "${
                    block.name || block.id || "unknown"
                  }"`
                );
              } catch {}
            }
          }
        }
      }

      if (modified) {
        return { message };
      }
    } catch {
      // 容错降级，不阻断主流程
    }
  });

  // 阶段 2：在 tool_call 执行前（二次兜底清洗已校验入参与工具名）
  pi.on("tool_call", async (event: any) => {
    try {
      // 1. 工具名二次兜底
      if (typeof event?.toolName === "string") {
        const nameRes = sanitizeToolCallNameAndArguments(event.toolName, event.input);
        if (nameRes.changed) {
          event.toolName = nameRes.name;
          if (nameRes.args && typeof nameRes.args === "object" && event.input && typeof event.input === "object") {
            Object.assign(event.input, nameRes.args);
          }
        }
      }

      // 2. 入参二次兜底清洗
      if (event && event.input && typeof event.input === "object" && !Array.isArray(event.input)) {
        const { unwrapped, changed, layers } = unwrapToolCallArguments(event.input);
        if (changed && unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
          for (const key of Object.keys(event.input)) {
            delete event.input[key];
          }
          Object.assign(event.input, unwrapped);
          try {
            console.log(
              `[pi-tool-sanitizer] Fallback-unwrapped ${layers} layer(s) for tool_call "${
                event.toolName || "unknown"
              }"`
            );
          } catch {}
        }
      }
    } catch {
      // 容错降级
    }
  });
}
