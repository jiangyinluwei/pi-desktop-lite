---
name: desktop-kernel-lifecycle
description: 指导桌面端 (Tauri 2 + Rust) 作为 CLI/Agent 内核宿主时的进程生命周期管控、多环境自适应寻址、Release 安装包资源打包规范与 Windows 运行时六大踩坑归因与排查治理。当涉及"内核崩溃"、"进程反复重启"、"resource_dir"、"打包后无法运行"、"子进程黑框"、"CWD权限"、"环境变量丢失"、"JobObject"时使用此技能。
---

# 桌面端内核生命周期、多环境寻址与 Release 打包避坑指南 (Desktop Kernel Lifecycle & Bundling)

本指南针对桌面端应用（以 **Tauri 2 + Rust + Web 前端** 托管 CLI/Agent 内核引擎，如 `pi.exe`）在**本地开发调试 (`npm run dev`)** 与 **正式打包分发 (`npm run build` / NSIS / MSI / 绿色版)** 全生命周期中的多环境路径寻址、子进程监督、权限隔离与 Windows 运行时六大典型踩坑归因进行系统性总结与工程规范化。

---

## 🧭 一、核心架构：多层次自适应内核寻址管道

在桌面端应用中，内核二进制文件可能存在于：
1. 本地开发仓库根目录（如 `.mytools/pi-body/pi-windows-x64/pi.exe`）；
2. NSIS/MSI 安装包释放的资源目录（`<install_dir>/resources/pi-windows-x64/pi.exe`）；
3. 绿色免安装版同级目录（`<exe_dir>/resources/...` 或 `<exe_dir>/.mytools/...`）；
4. 用户自定义环境变量指定的测试内核；
5. 系统全局 `PATH` 环境变量。

### 📌 寻址优先级铁律（严格按序，不可倒挂）

```mermaid
flowchart TD
    Start["开始寻找内核路径 find_pi_binary"] --> Step1{"1. 检查环境变量 PI_BINARY_PATH ?"}
    Step1 -- 存在且为有效文件 --> ReturnPath["✅ 返回该路径"]
    Step1 -- 无 --> Step2{"2. 检查源码/工作区相对路径 (.mytools) ?"}
    Step2 -- 存在 (开发模式优先) --> ReturnPath
    Step2 -- 无 --> Step3{"3. 检查当前 EXE 所在目录及 resources 子目录 ?"}
    Step3 -- 存在 (便携/绿色版) --> ReturnPath
    Step3 -- 无 --> Step4{"4. 检查 Tauri Resource 目录 (app.path().resource_dir()) ?"}
    Step4 -- 存在 (正式安装版) --> ReturnPath
    Step4 -- 无 --> Step5{"5. 检查系统 PATH 环境变量 ?"}
    Step5 -- 存在 --> ReturnPath
    Step5 -- 全无 --> ReturnNone["❌ 返回 None，抛出未找到内核异常"]
```

```rust
pub fn find_pi_binary(app_handle: Option<&AppHandle>) -> Option<PathBuf> {
    // 1. 显式环境变量覆盖（用于特定环境与自动化测试）
    if let Ok(env_path) = std::env::var("PI_BINARY_PATH") {
        let p = PathBuf::from(env_path);
        if p.is_file() { return Some(p); }
    }

    // 2. 优先检查当前源码与工作区目录（开发模式下 100% 优先保证加载完好的原始内核）
    if let Ok(curr_dir) = std::env::current_dir() {
        let curr_candidates = [
            curr_dir.join(".mytools/pi-body/pi-windows-x64/pi.exe"),
            curr_dir.join("../.mytools/pi-body/pi-windows-x64/pi.exe"),
            curr_dir.join("pi-windows-x64/pi.exe"),
            curr_dir.join("resources/pi-windows-x64/pi.exe"),
            curr_dir.join("pi.exe"),
        ];
        for candidate in &curr_candidates {
            if candidate.is_file() { return Some(candidate.clone()); }
        }
    }

    // 3. 检查 exe 所在目录及其 resources 子目录（便携绿色版与直接分发）
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let exe_candidates = [
                exe_dir.join("resources").join("pi-windows-x64").join("pi.exe"),
                exe_dir.join("resources").join("pi-body").join("pi-windows-x64").join("pi.exe"),
                exe_dir.join("pi-windows-x64").join("pi.exe"),
                exe_dir.join(".mytools").join("pi-body").join("pi-windows-x64").join("pi.exe"),
                exe_dir.join("pi.exe"),
            ];
            for candidate in &exe_candidates {
                if candidate.is_file() { return Some(candidate.clone()); }
            }
        }
    }

    // 4. 检查 Tauri Resource 目录（安装包标准资源目录）
    if let Some(app) = app_handle {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let resource_candidates = [
                resource_dir.join("pi-windows-x64").join("pi.exe"),
                resource_dir.join("pi-body").join("pi-windows-x64").join("pi.exe"),
                resource_dir.join("pi.exe"),
            ];
            for candidate in &resource_candidates {
                if candidate.is_file() { return Some(candidate.clone()); }
            }
        }
    }

    // 5. 检查系统 PATH 中的 pi / pi.exe
    if let Ok(path_var) = std::env::var("PATH") {
        let split_char = if cfg!(windows) { ';' } else { ':' };
        let bin_name = if cfg!(windows) { "pi.exe" } else { "pi" };
        for dir in path_var.split(split_char) {
            let full = Path::new(dir).join(bin_name);
            if full.is_file() { return Some(full); }
        }
    }

    None
}
```

---

## ⚠️ 二、Windows 运行时与打包六大踩坑归因深度复盘

### 1. 坑点一：Tauri 2 资源打包相对路径畸变 (`_up_` 陷阱)
- **故障现象**：在 `tauri.conf.json` 中配置数组 `"resources": ["../.mytools/pi-body/pi-windows-x64/**/*"]`，打包后文件被释放到 `resources/_up_/.mytools/...` 畸形目录下，导致程序按原相对路径找不到内核。
- **底层根因**：Tauri 打包器对相对上级路径 `../` 进行了路径清洗（Path Sanitization），自动转义为 `_up_`。
- **治理标准**：**必须使用对象映射字典**：
  ```json
  "bundle": {
    "resources": {
      "../.mytools/pi-body/pi-windows-x64/**/*": "pi-windows-x64"
    }
  }
  ```
  解压后精确存放在 `<install_dir>/resources/pi-windows-x64/` 下。

---

### 2. 坑点二：控制台黑框弹出与关闭触发级联崩溃 (Conhost & Accidental Reaper)
- **故障现象**：启动内核时会弹出一个独立的黑色 CMD/Console 窗口。用户手动点击关闭黑框后，前端立刻显示内核 `Crashed`。
- **底层根因**：Windows 下启动控制台子系统（Console Subsystem）程序时，若未指定 `CREATE_NO_WINDOW`（`0x08000000`），系统会强制挂载 Conhost 窗口。用户关闭窗口会向进程发送强杀信号。
- **治理标准**：所有使用 `tokio::process::Command` 或 `std::process::Command` 拉起子进程的地方，统一添加标志位：
  ```rust
  #[cfg(windows)]
  {
      cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
  }
  ```

---

### 3. 坑点三：安装目录只读权限陷阱 (Program Files CWD Read-Only Trap)
- **故障现象**：在开发环境（`npm run dev`）下运行完全正常，但通过 NSIS 安装到 `C:\Program Files` 之后，内核启动几秒后立即崩溃销毁。
- **底层根因**：子进程默认继承父进程工作目录（CWD）。`Program Files` 对普通用户是只读的，Agent/Node 引擎启动后尝试在 CWD 创建 `.pi`、写日志或缓存时抛出 `EACCES / EPERM` 未捕获异常导致退出。
- **治理标准**：显式隔离工作目录至用户目录：
  ```rust
  if let Ok(curr) = std::env::current_dir() {
      cmd.current_dir(curr);
  } else if let Some(home) = dirs::home_dir() {
      cmd.current_dir(home);
  }
  ```

---

### 4. 坑点四：Windows 环境变量大小写敏感陷阱 (Case-Sensitivity Trap)
- **故障现象**：修改子进程环境变量后，`npm run dev` 启动即秒崩，并在滑动窗口重试 2 次后熔断保持在 Crashed 状态。
- **底层根因**：Windows 操作系统底层环境变量名默认为 `"Path"`，但 Rust `HashMap<String, String>` 大小写敏感。如果使用 `env_map.get("PATH")` 会拿到空字符串，随后重新写入 `"PATH"` 导致环境块中原有的 `C:\Windows\System32`（包含系统 DLL、Socket 通信和基础系统命令）丢失，Node 引擎初始化失败秒崩。
- **治理标准**：
  - 改用 Rust 标准库 `std::env::var("PATH")`（Windows 下原生大小写不敏感）；
  - 直接使用 `cmd.env("PATH", new_path)` 追加路径，严禁全量构建 HashMap 覆盖环境块。
  ```rust
  if let Some(bin_dir) = binary_path.parent() {
      let split_char = if cfg!(windows) { ";" } else { ":" };
      let existing_path = std::env::var("PATH").unwrap_or_default();
      let bin_dir_str = bin_dir.to_string_lossy().to_string();
      if !existing_path.split(if cfg!(windows) { ';' } else { ':' }).any(|p| p == bin_dir_str) {
          let new_path = format!("{}{}{}", bin_dir_str, split_char, existing_path);
          cmd.env("PATH", new_path);
      }
  }
  ```

---

### 5. 坑点五：构建产物污染与探测优先级倒挂 (Target Debug Artifact Contamination)
- **故障现象**：执行过 `npm run build` 后再回到 `npm run dev`，开发态内核 Ready 之后反复崩溃。
- **底层根因**：`tauri build` 会在 `src-tauri/target/debug/` 下生成不完整的临时资源目录。在 `dev` 模式下 `app.path().resource_dir()` 指向了 `target/debug/`。如果探测顺序中 `resource_dir` 优先于源码工作区目录，`dev` 模式就会误载入 `target/debug` 下残缺的 `pi.exe`。
- **治理标准**：
  - 严格保持 **源码工作区相对路径优先于 Resource Dir**；
  - 在构建测试脚本中加入残缺临时资源的自动清理逻辑。

---

### 6. 坑点六：Win32 Job Object 作业对象限制与孤儿收割 (Job Object Silent Breakaway)
- **故障现象**：通过安装包向导完成页勾选“立即启动”时，子进程在派生工具（如调用 bash/git/npm）时报错或被提前终止。
- **底层根因**：NSIS 安装器本身可能运行在临时 Job Object 中。如果宿主应用创建的 Job Object 未开启静默脱离标志位，子进程在衍生下一级进程时会触发 Win32 嵌套限制错误。
- **治理标准**：在 `JobObjectManager` 初始化时设置 `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`：
  ```rust
  let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
  info.BasicLimitInformation.LimitFlags =
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
  ```

---

## 🛠️ 三、交付与排查核对清单 (Checklist)

在开发与交付包含内置内核的桌面端应用时，必须执行以下核对：

- [ ] `tauri.conf.json` 中 `bundle.resources` 是否采用对象映射（如 `"../.mytools/...": "target-dir"`）而非相对路径数组？
- [ ] 所有子进程拉起命令是否配置了 `#[cfg(windows)] cmd.creation_flags(0x08000000)`？
- [ ] 子进程工作目录（CWD）是否具备权限容错机制？
- [ ] 子进程 PATH 追加是否使用 `std::env::var("PATH")` 与 `cmd.env("PATH", ...)` 避免环境块大小写损坏？
- [ ] 内核寻址探测优先级是否将源码工作区（`.mytools`）置于 `target/debug` 之前？
- [ ] Win32 Job Object 是否配置了 `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`？
