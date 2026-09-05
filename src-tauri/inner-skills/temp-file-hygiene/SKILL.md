---
name: temp-file-hygiene
description: 当桌面端 Pi Agent 涉及写文件、创建文件或执行命令行工具可能产生临时文件、探针脚本或中间输出时强制激活的运行态约束。指导临时文件严格沙盒隔离、必须集中放置于系统临时目录、严禁污染用户代码库与工作区、以及用后即删的生命周期自愈规范。
---

# 临时文件沙盒与即用即删卫生约束 (Inner Skill)

> ⚠️ **运行态约束说明**：本 Skill 由桌面应用端在 Agent 调用文件写入或命令行执行工具（如 `write`, `write_file`, `create_file`, `temp_file`, `bash`, `terminal`, `powershell`, `cmd` 等）时动态注入。Pi Agent 在涉及任何中间产物、探针脚本、重定向日志或临时文件时，**必须严格遵守以下 4 大铁律**。

---

## 1. 沙盒隔离与工作区零污染 (Zero-Pollution Sandbox 铁律)

* **严禁污染工作区与代码仓库**：严禁在当前工作区根目录、路由项目工程目录或其任何子目录下自发创建任何临时文件（如 `tmp.py`, `temp.txt`, `output.log`, `test.ps1`, `probe.js` 等）；
* **禁止未经授权的文件输出**：纯分析、审查、问答与解释任务一律直接在对话流中以 Markdown 格式输出，严禁擅自使用重定向或落盘方式导出临时说明文件；
* **Git 仓库纯洁性保证**：绝对避免因临时文件产生未跟踪变更（Untracked Files），杜绝污染 `git status`。

---

## 2. 统一运行时暂存目录 (Designated Runtime Temp Path)

当进行复杂数据提取、多行语法测试、进程探针或由于特殊原因必须落地临时脚本/文件时：

* **唯一合法临时目录**：所有临时产物**必须且仅能**存放于以下指定的统一运行时临时目录中：
  `{{PI_DL_TEMP_DIR}}`
* **命名规范与防冲突**：临时文件命名统一采用语义前缀与时间戳，如 `pidl_probe_<name>_<timestamp>.py`，避免同名文件相互覆盖或冲突；
* **路径格式规范**：在代码和命令中全域采用正斜杠 `/` 引用该临时目录，包含空格时显式使用双引号包裹。

---

## 3. 即用即删与链式清理 (Immediate Cleanup Invariance)

* **即用即删生命周期**：临时文件生命周期必须与当前单步操作严格绑定，**用完即删，绝不滞留**；
* **命令行链式清理**：在 Shell/Terminal 中运行临时脚本或生成中间输出时，必须通过链式语法确保无论执行成功还是失败均立即清理：
  * **PowerShell 方案**：
    `python "{{PI_DL_TEMP_DIR}}/probe.py" ; Remove-Item -Force -ErrorAction SilentlyContinue "{{PI_DL_TEMP_DIR}}/probe.py"`
  * **Bash 方案**：
    `python "{{PI_DL_TEMP_DIR}}/probe.py" ; rm -f "{{PI_DL_TEMP_DIR}}/probe.py"`
  * **CMD 方案**：
    `python "{{PI_DL_TEMP_DIR}}/probe.py" & del /f /q "{{PI_DL_TEMP_DIR}}\probe.py"`
* **工具写入清理闭环**：若通过 `write` / `create_file` 向临时目录写入了中转文件，在任务后续步骤中必须调用清理命令或相应工具将其彻底清除。

---

## 4. 异常自愈与脏产物清理 (Dirty State Self-Healing)

* **前置探测与清除**：若前序任务或异常中断在 `{{PI_DL_TEMP_DIR}}` 遗留了同名或相关残留文件，在本次生成前应主动予以清理；
* **任务结束清爽交付**：在向用户交付最终结果前，必须确保本次会话产生的全部临时探针文件已彻底移除。
