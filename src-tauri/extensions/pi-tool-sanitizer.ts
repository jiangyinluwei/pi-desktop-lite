/**
 * pi-tool-sanitizer — Pi 内核工具入参自愈解包与空工具过滤扩展 (Tool Call Argument Auto-Unwrap & Empty Tools Sanitizer)
 *
 * 作用机制：
 * 1. 【请求发送前防线 (before_provider_request)】：
 *    - 当会话具有工具历史但当前轮次未提供活动工具时，部分协议适配器会输出 `"tools": []`；
 *    - 某些严格校验的服务商（如 Atria-Dawn-Preview、InternLM、Groq 等）会直接报错 400：
 *      "`tools` must not be an empty array. Either provide at least one tool or omit the field entirely."；
 *    - 本扩展在 `before_provider_request` 阶段自动剔除空的 `tools` 数组与孤立的 `tool_choice`，彻底消除 400 校验阻断；
 *    - 针对 Pi 0.86.0 默认强启 strict-prefer JSON-schema 采样导致第三方/国产模型（如火山引擎 GLM/DeepSeek 等）退化拒发 tool_calls 的问题，
 *      自动防御性剥离工具定义上的 strict 限制，恢复高鲁棒性宽松工具调用。
 * 2. 【模型输出净化防线 (message_end)】：
 *    - 针对特定模型（如 DeepSeek-V4 系列）入参包裹在冗余外壳（{"arguments": {"command": "..."}} 等）；
 *    - 针对预览/推理模型（如 Atria-Dawn-Preview 等）将 XML 格式（`<invoke name="...">`）或换行指令/空格指令
 *      直接嵌入 `toolCall.name`（如 `"read path='...'</arg_value>"`、`"bash\n\ncd ..."`、`"bash的手下命令='...'"`），
 *      导致工具名未命中并丢失入参的问题；
 *    - 针对部分模型将工具调用直接输出在正文文本中（如 DeepSeek 原生 `<｜｜DSML｜｜ calls>` 标签、标准 XML `<invoke>` 标签、
 *      或在无 toolCall 情况下末尾泄漏的待执行 Markdown 命令代码块 ````bash\ncd ...\n```` 与伪造结果标记），
 *      自动从正文抽取并转换为标准 `toolCall` 块，确保收纳进工具信息框并顺畅触发底层执行，杜绝直接停止会话；
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
 * 获取当前活跃路由工作区（code-area 路由目标项目路径）
 */
function getRoutedTargetPath(): string | null {
  try {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const configPath = path.join(os.homedir(), ".pi-dl", "config.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (cfg?.workspace?.activeId === "code-area" && cfg.workspace.codeAreaRoutePath) {
        const target = String(cfg.workspace.codeAreaRoutePath).trim();
        if (target && fs.existsSync(target)) {
          return target.replace(/\\/g, "/");
        }
      }
    }
  } catch {}
  return null;
}

/**
 * 自动为 bash 命令行注入路由工作区目录切换前缀 (cd "<target>" && )，
 * 消除模型在 code-area 物理 Hub 目录下执行相对路径命令引发的 No such file or directory
 */
function anchorBashCommand(command: string, targetPath: string): string {
  if (!command || typeof command !== "string" || !targetPath) return command;
  const trimmed = command.trim();
  const normalizedTarget = targetPath.replace(/\\/g, "/");

  // 1. 若命令已经以显式切换到 targetPath 开头，不重复追加
  const targetRegex = new RegExp(
    `^cd\\s+["']?${normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*(?:&&|;)`,
    "i"
  );
  if (targetRegex.test(trimmed)) {
    return trimmed;
  }

  // 2. 若命令已经包含绝对路径的 cd（如 cd /c/Users/... 或 cd C:/...），且该路径已在 targetPath 之下，不强行覆盖
  if (/^cd\s+["']?(?:[a-zA-Z]:|\/|[~])/i.test(trimmed)) {
    return trimmed;
  }

  // 3. 自动注入 cd "${targetPath}" && 
  return `cd "${normalizedTarget}" && ${trimmed}`;
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

function cleanSimulationText(text: string): string {
  let clean = text
    .replace(/```(?:bash|sh|powershell|cmd|terminal|json)?\s*\n[\s\S]*?\n```(?:\s*-exec[^\n]*)?/gi, "")
    .replace(/<acp\s+[^>]*>[\s\S]*?<\/acp>/gi, "")
    .replace(/<bash(?:\s+[^>]*)?>[\s\S]*?<\/bash>/gi, "")
    .replace(/<invoke(?:\s+[^>]*)?>[\s\S]*?<\/invoke>/gi, "")
    .replace(/\*\*很抱歉——我在没有调用工具的情况下模拟了输出[^\n]*\*\*/gi, "")
    .replace(/(?:我需要实际调用工具而不是在文本中假装执行[^\n]*\n*)+/gi, "")
    .replace(/(?:下面实际执行代码探查[^\n]*\n*)+/gi, "")
    .replace(/(?:现在实际执行探查[^\n]*\n*)+/gi, "")
    .replace(/(?:我现在真正运行这些命令来探查代码[^\n]*\n*)+/gi, "")
    .replace(/📌\s*正在执行命令[^\n]*/gi, "")
    .replace(/-exec\s+bash[^\n]*/gi, "")
    .replace(/(?:<br>|\n)*\*\*Tool Results\*\*[\s\S]*$/gi, "")
    .replace(/让我(?:实际|真正)?(?:运行[^\n:：]{0,20}|先用[a-zA-Z\s]+工具)[^\n]*/gi, "")
    .replace(/现在正式开始[^\n]*/gi, "")
    .replace(/下面(?:实际)?执行[^\n]*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/^(?:让我(?:实际|真正)?|现在正式开始|下面(?:实际)?执行[：:]?|[：:]\s*|\s*)+$/i.test(clean)) {
    return "";
  }
  return clean;
}

/**
 * 从普通文本块中提取模型意外漏出的 DSML、XML 或独立命令行代码块工具调用
 */
function extractToolsFromText(text: string, hasExistingToolCalls: boolean = false): { toolCalls: any[]; cleanedText: string } {
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

  // 3. 匹配模型生成的 <bash>...</bash> 标签（如 <bash cmd="...">...</bash> 或 <bash m0000X>...</bash>）
  const bashTagRegex = /<bash(?:\s+cmd=["']([^"']+)["']|\s+[^>]*)?>([\s\S]*?)<\/bash>/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = bashTagRegex.exec(text)) !== null) {
    let cmd = bMatch[1] ? bMatch[1].trim() : "";
    const body = bMatch[2] ? bMatch[2].trim() : "";
    if (!cmd && body) {
      const innerCodeMatch = body.match(/```(?:bash|sh|cmd|powershell)?\s*\n([\s\S]*?)\n```/i);
      if (innerCodeMatch) {
        cmd = innerCodeMatch[1].trim();
      } else {
        const filtered = body
          .replace(/📌\s*正在执行[^\n]*/g, "")
          .replace(/→\s*entry-output-[^\n]*/g, "")
          .trim();
        if (filtered) {
          cmd = filtered;
        }
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

  // 4. 若当前消息完全没有任何工具调用（hasExistingToolCalls === false）：
  // 检查正文末尾或包含执行指示语的命令代码块（如模型因 strict 模式退化为在文本末尾吐出命令并停止）
  if (!hasExistingToolCalls) {
    const execLeadRegex = /(?:(?:现在|立即|继续|先|先来)?(?:真正)?执行[^\n:：`]{0,25}|Run(?:ning)?(?:\s+command)?|Executing(?:\s+command)?)\s*[：:]\s*(?:<br>|\n)*```(bash|sh|powershell|cmd|terminal)\s*\n([\s\S]+?)\n```(?:\s*-exec[^\n]*)?/i;
    const execMatch = text.match(execLeadRegex);

    if (execMatch) {
      const toolName = execMatch[1].toLowerCase() === "sh" ? "bash" : execMatch[1].toLowerCase();
      const command = execMatch[2].trim();
      if (command) {
        toolCalls.push({
          type: "toolCall",
          id: "md-" + Math.random().toString(36).slice(2, 10),
          name: toolName,
          arguments: { command }
        });
        cleanedText = cleanSimulationText(text);
        return { toolCalls, cleanedText };
      }
    }

    // 兜底 A：如果文本末尾紧邻单个纯代码块且包含命令特征（如 cd/grep/rg/ls/git 等，支持尾随 -exec 标识）
    const tailCodeRegex = /```(bash|sh|powershell|cmd|terminal)\s*\n([\s\S]+?)\n```(?:\s*-exec[^\n]*|\s*<br>\s*|\s*|\s*\*\*Tool Results\*\*[\s\S]*)*$/i;
    const tailMatch = text.match(tailCodeRegex);
    if (tailMatch) {
      const toolName = tailMatch[1].toLowerCase() === "sh" ? "bash" : tailMatch[1].toLowerCase();
      const command = tailMatch[2].trim();
      if (command && (command.startsWith("cd ") || command.includes("grep") || command.includes("rg ") || command.includes("ls ") || command.includes("git ") || command.includes("find "))) {
        toolCalls.push({
          type: "toolCall",
          id: "tail-" + Math.random().toString(36).slice(2, 10),
          name: toolName,
          arguments: { command }
        });
        cleanedText = cleanSimulationText(text);
        return { toolCalls, cleanedText };
      }
    }

    // 兜底 B：普适匹配文本中的任意独立命令行代码块（即使其前置或后置有额外说明文字）
    const generalCodeRegex = /```(bash|sh|powershell|cmd|terminal)\s*\n([\s\S]+?)\n```(?:\s*-exec[^\n]*)?/gi;
    let gMatch: RegExpExecArray | null;
    let lastMatchedCommand: { toolName: string; command: string; fullMatch: string } | null = null;
    while ((gMatch = generalCodeRegex.exec(text)) !== null) {
      const toolName = gMatch[1].toLowerCase() === "sh" ? "bash" : gMatch[1].toLowerCase();
      const rawCmd = gMatch[2].trim();
      if (rawCmd && (rawCmd.startsWith("cd ") || rawCmd.includes("grep") || rawCmd.includes("rg ") || rawCmd.includes("ls ") || rawCmd.includes("git ") || rawCmd.includes("find ") || rawCmd.includes("dotnet ") || rawCmd.includes("npm ") || rawCmd.includes("cargo "))) {
        lastMatchedCommand = { toolName, command: rawCmd, fullMatch: gMatch[0] };
      }
    }
    if (lastMatchedCommand) {
      toolCalls.push({
        type: "toolCall",
        id: "cmd-" + Math.random().toString(36).slice(2, 10),
        name: lastMatchedCommand.toolName,
        arguments: { command: lastMatchedCommand.command }
      });
      cleanedText = cleanSimulationText(text);
      return { toolCalls, cleanedText };
    }
  }

  return { toolCalls, cleanedText };
}

export default function (pi: any) {
  if (!pi || typeof pi.on !== "function") {
    return;
  }

  // 阶段 0：在请求发送给 Provider 前（before_provider_request）
  // 1. 剔除空的 tools 数组与孤立的 tool_choice，彻底杜绝 Atria / InternLM / Groq 等服务商
  //    报 400："`tools` must not be an empty array. Either provide at least one tool or omit the field entirely."
  // 2. 针对 Pi 0.86.0 默认强启 strict-prefer JSON-schema 采样导致第三方/国产模型（如火山引擎 GLM/DeepSeek 等）退化拒发 tool_calls 的问题，
  //    自动防御性剥离工具定义上的 strict 限制，恢复高鲁棒性宽松工具调用。
  pi.on("before_provider_request", async (event: any) => {
    try {
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") return;



      if (Array.isArray(payload.tools)) {
        if (payload.tools.length === 0) {
          delete payload.tools;
          if (payload.tool_choice) {
            delete payload.tool_choice;
          }
          try {
            console.log(
              "[pi-tool-sanitizer] Omitted empty `tools` array from provider request to prevent API rejection"
            );
          } catch {}
        } else {
          // 针对非严格模式友好的兼容层，防御性剔除工具定义上的 strict 字段，保持宽松容错
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

      // 0. 判断当前消息是否已包含原生 toolCall / tool_use 块
      const hasExistingToolCalls = message.content.some(
        (b: any) => b && (b.type === "toolCall" || b.type === "tool_use")
      );

      // 若助手正文中包含模型直接输出的 DSML / XML / 待执行 Markdown 代码块，自动转换为标准 toolCall 块
      const extractedCalls: any[] = [];
      for (const block of message.content) {
        if (block && block.type === "text" && typeof block.text === "string") {
          const { toolCalls: extracted, cleanedText } = extractToolsFromText(block.text, hasExistingToolCalls);
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

      // 3. 针对 code-area 路由工作区，自动锚定命令与文件路径到目标项目目录（消灭 No such file or directory）
      const routedTarget = getRoutedTargetPath();
      if (routedTarget && event && event.input && typeof event.input === "object") {
        const normTool = String(event.toolName || "").toLowerCase();
        // A. 命令行工具自动注入 cd "${routedTarget}" &&
        if (["bash", "powershell", "cmd", "sh", "terminal", "run_command"].includes(normTool)) {
          if (typeof event.input.command === "string") {
            const anchored = anchorBashCommand(event.input.command, routedTarget);
            if (anchored !== event.input.command) {
              event.input.command = anchored;
              try {
                console.log(`[pi-tool-sanitizer] Anchored ${normTool} command to routed target: ${routedTarget}`);
              } catch {}
            }
          }
        }
        // B. 文件操作工具将相对路径解析为目标工程绝对路径
        if (["read", "write", "edit", "grep", "find", "ls"].includes(normTool)) {
          if (typeof event.input.path === "string") {
            const rawPath = event.input.path.trim();
            // 若不是绝对路径（Windows 驱动器盘符 C:/ 或 UNC 或正斜杠根路径）
            if (rawPath && !/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(rawPath)) {
              const pathModule = require("path");
              const resolved = pathModule.resolve(routedTarget, rawPath).replace(/\\/g, "/");
              event.input.path = resolved;
              try {
                console.log(`[pi-tool-sanitizer] Anchored ${normTool} path "${rawPath}" -> "${resolved}"`);
              } catch {}
            }
          }
        }
      }
    } catch {
      // 容错降级
    }
  });
}
