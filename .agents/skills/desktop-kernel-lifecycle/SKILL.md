---
name: desktop-kernel-lifecycle
description: 指导桌面端 (Tauri 2 + Rust) 作为 CLI/Agent 内核宿主时的进程生命周期管控、多环境自适应寻址、Release 安装包资源打包规范与 Windows 运行时六大踩坑归因与排查治理。当涉及"内核崩溃"、"进程反复重启"、"resource_dir"、"打包后无法运行"、"子进程黑框"、"CWD权限"、"环境变量丢失"、"JobObject"时使用此技能。
---

# 桌面端内核生命周期、寻址与打包治理规范 (Desktop Kernel Lifecycle)

规范 Tauri 2 + Rust 托管 CLI 内核（如 `pi.exe`）在开发调试与正式打包中的多层寻址、进程管控与 Windows 运行时踩坑治理。

---

## 🧭 多层次自适应内核寻址管道 (`find_pi_binary`)

严格按以下优先级寻址，不可倒挂：

```text
1. 环境变量覆盖 (`PI_BINARY_PATH`)
     ↓
2. 用户级一键更新目录 (`~/.pi-dl/kernel/pi-windows-x64/pi.exe`)
     ↓
3. 源码开发相对路径 (`.mytools/pi-body/pi-windows-x64/pi.exe`)
     ↓
4. 当前 EXE 同级及 resources 子目录 (便携/绿色版)
     ↓
5. Tauri Resource 目录 (`app.path().resource_dir()`)
     ↓
6. 系统 PATH 环境变量 (`pi.exe`)
```

---

## ⚠️ Windows 运行时八大踩坑归因与治理

### 1. Tauri 2 资源打包相对路径畸变 (`_up_` 陷阱)
- **根因**：`resources: ["../.../**/*"]` 相对路径会被 Tauri 自动清洗转义为 `_up_` 畸形目录；
- **治理**：必须使用**目录对象映射字典**：
  ```json
  "bundle": {
    "resources": {
      "../.mytools/pi-body/pi-windows-x64": "pi-windows-x64"
    }
  }
  ```

### 2. 控制台黑框弹出与误关级联崩溃
- **根因**：Windows 下启动控制台程序未指定无窗口标志，导致挂载独立 CMD 窗口；
- **治理**：所有子进程拉起命令必须添加标志位：
  ```rust
  #[cfg(windows)]
  { cmd.creation_flags(0x08000000); } // CREATE_NO_WINDOW
  ```

### 3. 工作区双轨隔离模型（模板 ➔ 运行时副本）
- **根因**：若未隔离工作区，内核会读取源码根目录规则或因只读目录抛出权限异常；
- **治理**：
  - 内置预设为**只读模板**（打包进资源目录），首次使用整目录复制到 `~/.pi-dl/workspaces/<id>/` 作为**用户可写副本**（已存在绝不覆盖）；
  - `SessionHost::start(workspace: PathBuf)` 动态传入当前生效工作区并锁定 CWD。

### 4. Windows 环境变量大小写敏感陷阱
- **根因**：Windows 系统环境变量为 `"Path"`，直接用大小写敏感的 `env_map.get("PATH")` 会抹除系统默认路径（导致缺失 DLL 秒崩）；
- **治理**：改用 `std::env::var("PATH")`，并用 `cmd.env("PATH", new_path)` 追加路径。

### 5. 构建产物污染与探测优先级倒挂
- **根因**：`target/debug` 临时残缺资源若被优先探测会导致 dev 模式循环崩溃；
- **治理**：寻址优先级必须将**源码工作区（`.mytools`）置于 `target/debug` 之前**。

### 6. Win32 Job Object 作业对象孤儿收割
- **根因**：NSIS 安装器衍生进程未开启脱离标志，引发 Win32 嵌套作业限制错误；
- **治理**：初始化 Job Object 时必须设置 `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`：
  ```rust
  info.BasicLimitInformation.LimitFlags =
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
  ```

### 7. 大文件流式下载超时与断流自愈
- **根因**：全局 60s 超时在跨国或弱网下截断 45MB 内核包；
- **治理**：
  - 流式下载超时放宽至 `600s`，设置 `Accept-Encoding: identity`；
  - 接入多源镜像候选链（GitHub Direct ➔ `ghproxy.net` ➔ `gh-proxy.com`），断流自动切换重试。

### 8. 内核热更新中断与原子取消
- **治理**：暴露 `pi_cancel_kernel_update` 指令，取消时通过 `AtomicBool` 信号安全退出并删除临时文件，保持运行中内核不中断；支持“不再提醒更新”持久化（`~/.pi-dl/config.json`）。

---

## 🛠️ 内核保险与自愈重连机制

- **自动平滑重连**：后台检测内核 `crashed` 状态由 Rust 监督器自动平滑重连最多 **5 次**（间隔 2s，每次重连前二次校验 `is_stopping` 防止竞态）；
- **失败报警**：5 次均失败落入终态 Crashed 并广播 `pi:kernel-reconnect-failed`，前端左上角触发红色抖动小闪电提醒（点击可手动重启），内核恢复后自动隐藏。

---

## 📋 交付与排查 Checklist

- [ ] `tauri.conf.json` 中 `bundle.resources` 使用对象映射；
- [ ] 所有子进程均配置了 `creation_flags(0x08000000)`；
- [ ] 环境变量追加使用 `std::env::var("PATH")` 防大小写损坏；
- [ ] Win32 Job Object 配置了 `SILENT_BREAKAWAY_OK`；
- [ ] 内核重连最多 5 次（间隔 2s），失败触发左上角闪电提醒。
