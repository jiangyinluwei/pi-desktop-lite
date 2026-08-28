---
name: windows-bash-compatibility
description: 当桌面端 Pi Agent 运行在 Windows 系统上调用 bash、powershell 或命令行执行工具时强制注入的运行态约束。指导命令跨平台语法替换、正斜杠路径防转义、禁用翻页器防交互卡死及 UTF-8 控制台编码规避。
---

# Windows 环境运行态 Shell 与工具调用约束 (Inner Skill)

> ⚠️ **运行态约束说明**：本 Skill 由桌面应用端在 Windows 环境下动态注入至 Pi Agent 的工具调用上下文中。Pi Agent 在规划并下发任何 Shell/终端命令（如 `bash`、`terminal`、`powershell` 工具）时，**必须严格遵守以下 5 大铁律**。

---

## 1. 路径格式规范：全域采用正斜杠 `/`

* **严禁裸写单反斜杠**：反斜杠 `\` 在转义层与 JSON 解析中极易将 `\n`, `\t`, `\r` 误识别为控制字符，导致路径被截断吞噬；
* **统一采用正斜杠**：所有文件路径、工作目录参数必须统一使用正斜杠（例如 `C:/Users/name/repo/src` 或 `./src/config.json`），Windows 内核与现代工具链完全原生支持正斜杠；
* **空格路径必加双引号**：遇到包含空格的目录（如 `C:/Program Files/...`）必须显式用双引号包裹。

---

## 2. 避免交互式卡死与翻页挂起 (Anti-Hang 铁律)

在无 PTY 或自动化执行环境中，任何等待用户键盘输入的命令都会导致 Pi 永久卡死直到超时熔断：

* **强制非交互标志**：所有初始化、安装、升级与删除命令必须显式追加自动确认参数（如 `npm init -y`, `pnpm add -y`, `npx -y`）；
* **禁用 Pager 翻页**：严禁直接执行带 Pager 的命令。执行 `git log` / `git diff` 时必须显式添加 `--no-pager`（例如 `git --no-pager log -n 5`）；
* **前置 Pager 覆盖**：在批量执行或多命令串联时，应前置覆盖环境变量 `PAGER=cat` 或 `GIT_PAGER=cat`。

---

## 3. 语法与命令跨平台转换对照

在 Windows 环境下，严禁输出未经兼容处理的 Linux 专属命令与 Shell 方言：

| ❌ 严禁使用 (Linux/Bash 惯性) | ✅ Windows 安全替换方案 | 避坑原因 |
| :--- | :--- | :--- |
| `export VAR=val && ...` | `cross-env VAR=val ...` 或在代码内部处理 | Windows 命令行/CMD/PowerShell 均不支持 `export` |
| `rm -rf <path>` | 优先使用 Node/Python 脚本删除，或 PowerShell `Remove-Item -Recurse -Force` | 原生 Windows Shell 无 `rm -rf` |
| `touch <file>` | `New-Item <file>` 或通过文件写入工具直接创建 | Windows 无原生 `touch` |
| `curl -X POST ...` (在 PS 中) | 显式调用 `curl.exe` 或使用 JS/Python 请求 | PowerShell 别名将 `curl` 映射为 `Invoke-WebRequest`，参数不兼容 |
| `cat <file> \| grep ...` | 优先使用 Agent 的专用文件检索工具 | 管道行为差异大，易导致编码损坏 |
| `$(command)` 或复杂子 Shell | 优先拆解为单步执行或通过脚本语言执行 | Windows Shell 对复杂 Bash 子 Shell 嵌套支持有限 |

---

## 4. 编码防护与输出清洁 (UTF-8 & No-Color)

* **消除 ANSI 脏字符**：执行输出富文本样式的 CLI 工具时，附带 `NO_COLOR=1` 环境变量，防止颜色控制符污染上下文；
* **控制台 UTF-8 声明**：若在 PowerShell 下执行输出包含中文或特殊字符的命令，前置声明：
  `$OutputEncoding = [System.Text.UTF8Encoding]::new($false);`
  若在 CMD 下执行，前置切换代码页为 UTF-8：`chcp 65001`。

---

## 5. 守护进程与长耗时任务处理

* 严禁在 Windows 下直接在命令行末尾追加 `&` 尝试将进程挂入后台（Windows 下无法正确脱钩，会导致挂起或孤儿进程）；
* 如需启动长期守护进程（如开发服务器 `npm run dev`），必须通过调用端提供的 `IsDaemon` / `run_in_background` 参数下发。
