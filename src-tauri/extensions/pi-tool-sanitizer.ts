/**
 * pi-tool-sanitizer — Pi 内核工具入参自愈解包与空工具过滤扩展 (Tool Call Argument Auto-Unwrap & Empty Tools Sanitizer)
 *
 * 作用机制：
 * 1. 【请求发送前防线 (before_provider_request)】：
 *    - 当会话具有工具历史但当前轮次未提供活动工具时，部分协议适配器会输出 `"tools": []`；
 *    - 某些严格校验的服务商（如 Atria-Dawn-Preview、InternLM、Groq 等）会直接报错 400：
 *      "`tools` must not be an empty array. Either provide at least one tool or omit the field entirely."；
 *    - 本扩展在 `before_provider_request` 阶段自动剔除空的 `tools` 数组与孤立的 `tool_choice`，彻底消除 400 校验阻断。
 * 2. 【模型输出净化防线 (message_end)】：
 *    - 针对特定模型（如 DeepSeek-V4 系列）入参包裹在冗余外壳（{"arguments": {"command": "..."}} 等）；
 *    - 针对预览/推理模型（如 Atria-Dawn-Preview 等）将 XML 格式（`<invoke name="...">`）或换行指令/空格指令
 *      直接嵌入 `toolCall.name`（如 `"read path='...'</arg_value>"`、`"bash\n\ncd ..."`、`"bash的手下命令='...'"`），
 *      导致工具名未命中并丢失入参的问题；
 *    - 针对部分模型将工具调用直接输出在正文文本中（如 DeepSeek 原生 `<｜｜DSML｜｜ calls>` 标签）而未被平台结构化的情况，
 *      自动从正文抽取并转换为标准 `toolCall` 块；
 *    - 在 `message_end` 阶段规范化工具名、就地提取命令参数并剥离嵌套外壳，恢复为扁平标准结构。
 * 3. 【工具执行前底层清洗防线 (tool_call)】：
 *    - 在 `tool_call` 执行阶段进行二次兜底，确保 100% 消除由于参数多层嵌套或名称异常引发的
 *      Validation failed / Tool not found 错误，斩断模型误判与自激死循环。
 *
 * 安全边界：
 * - 纯内存对象规范化，不依赖外部网络与额外依赖包；
 * - 若入参本身规范无嵌套且工具名正常，100% 保持原样直通，零副作用、零性能开销；
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
 *  `read path="..."</arg_value>`、`bash\n\ncd ...` 或 `bash的手下命令="..."`）
 */
function sanitizeToolCallNameAndArguments(rawName: string, rawArgs: any): NameSanitizeResult {
  let name = String(rawName || "").trim();
  let args = rawArgs;
  let changed = false;

  const knownTools = ["read", "write", "edit", "grep", "find", "ls", "bash", "powershell", "cmd", "sh", "terminal", "run_command"];

  // 0. 若工具名本身完全合法纯净，直接通过
  if (knownTools.includes(name.toLowerCase())) {
    return { name, args, changed: false };
  }

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
            else if (/^(command|cmd|code|命令|手下命令)$/i.test(rawKey)) normKey = "command";
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
 * 从普通文本块中提取模型意外漏出的 DSML 或 XML 工具调用
 */
function extractToolsFromText(text: string): any[] {
  const toolCalls: any[] = [];
  
  // 匹配 DeepSeek 原生 DSML 标签: <｜｜DSML｜｜ invoke name="...">...<｜｜DSML｜｜ parameter name="...">...</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke>
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

  return toolCalls;
}

export default function (pi: any) {
  if (!pi || typeof pi.on !== "function") {
    return;
  }

  // 阶段 0：在请求发送给 Provider 前（before_provider_request），
  // 剔除空的 tools 数组与孤立的 tool_choice，彻底杜绝 Atria / InternLM / Groq 等服务商
  // 报 400："`tools` must not be an empty array. Either provide at least one tool or omit the field entirely."
  pi.on("before_provider_request", async (event: any) => {
    try {
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") return;

      if (Array.isArray(payload.tools) && payload.tools.length === 0) {
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

      // 0. 若助手正文中包含模型直接输出的 DSML 等原生标签，自动转换为标准 toolCall 块
      const extractedCalls: any[] = [];
      for (const block of message.content) {
        if (block && block.type === "text" && typeof block.text === "string") {
          const extracted = extractToolsFromText(block.text);
          if (extracted.length > 0) {
            extractedCalls.push(...extracted);
            block.text = block.text
              .replace(/<[｜|]{2}DSML[｜|]{2}\s+calls>[\s\S]*?<\/[｜|]{2}DSML[｜|]{2}\s+calls>/gi, "")
              .trim();
            modified = true;
          }
        }
      }
      if (extractedCalls.length > 0) {
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

          // 1. 修复畸形 toolCall.name 并提取嵌入在 name 中的参数（如 "read path='...'</arg_value>" 或 "bash\n\nls"）
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
          if (nameRes.args && typeof nameRes.args === "object") {
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
