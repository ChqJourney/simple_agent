# Sidecar Lifecycle Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变现有功能的前提下，让 Python sidecar 在所有退出场景下（包括强制 kill 主进程）都不会以孤儿进程残留。

**Architecture:**
三个独立的防线，互相补充：
1. **Windows Job Object**（`#[cfg(windows)]`）：在 OS 层将 sidecar 绑定到主进程，主进程句柄关闭时 OS 自动终止 sidecar，无论主进程如何死亡均有效。
2. **`RunEvent::Exit` 兜底**：将现有 `on_window_event` 的 kill 逻辑提取为共享函数，并在应用级事件循环结束时再次调用，覆盖 `CloseRequested` 未触发的边缘情况。
3. **Python 侧 `lifespan` shutdown hook**（最小改动）：在 FastAPI lifespan 中注册 shutdown 动作，取消 active agents 的 pending tasks，让 uvicorn 的 graceful shutdown 能正常完成。

**Tech Stack:** Rust (`windows-sys 0.60` 已在依赖树中，直接用), Tauri v2 `RunEvent`, Python FastAPI `lifespan`

---

## 整改范围与约束

- **只动** `src-tauri/src/lib.rs` 和 `python_backend/main.py`
- **不新增** Cargo 依赖（`windows-sys 0.60.2` 已由 `shared_child` 引入，可直接用）
- **不修改** Tauri 配置、capabilities、workspace_paths.rs、任何前端代码
- **测试** 每个 task 完成后跑 `cargo test`，最终手动验证

---

## Task 1: 提取 `kill_sidecar` 公共函数，消除重复逻辑

### 目标
当前 kill 逻辑只在 `on_window_event` 里。后续 Task 2 要在 `RunEvent::Exit` 里复用同一逻辑。先把它提取成独立函数，让两处都能调用。

**Files:**
- Modify: `src-tauri/src/lib.rs`

### Step 1: 提取函数

在 `lib.rs` 中，将 `on_window_event` 里的 kill 逻辑提取为 `kill_sidecar(app: &tauri::AppHandle)` 函数。

现有代码（`lib.rs:137-151`）：
```rust
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { .. } = event {
        let app = window.app_handle();
        let sidecar = app.state::<PythonSidecar>();
        match with_sidecar_slot(&sidecar.0, |slot| slot.take()) {
            Ok(Some(child)) => {
                if let Err(error) = child.kill() {
                    eprintln!("Failed to stop Python sidecar: {error}");
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("{error}"),
        }
    }
})
```

替换后的目标代码：

```rust
// 新增函数（放在 run() 函数之前）
fn kill_sidecar(app: &tauri::AppHandle) {
    let sidecar = app.state::<PythonSidecar>();
    match with_sidecar_slot(&sidecar.0, |slot| slot.take()) {
        Ok(Some(child)) => {
            if let Err(error) = child.kill() {
                eprintln!("Failed to stop Python sidecar: {error}");
            }
        }
        Ok(None) => {}
        Err(error) => eprintln!("{error}"),
    }
}

// on_window_event 改为调用该函数
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { .. } = event {
        kill_sidecar(window.app_handle());
    }
})
```

### Step 2: 验证测试仍然通过

```
cargo test
```

期望：`7 passed; 0 failed`

### Step 3: Commit

```
git add src-tauri/src/lib.rs
git commit -m "refactor: extract kill_sidecar helper to eliminate duplication"
```

---

## Task 2: 添加 `RunEvent::Exit` 兜底清理

### 目标
将 `.run(context)` 改为 `.build(context)?.run(handler)` 的两参数形式，在 `RunEvent::Exit` 里再次调用 `kill_sidecar`，作为 `CloseRequested` 的兜底。

**Files:**
- Modify: `src-tauri/src/lib.rs`

### Step 1: 理解 Tauri v2 RunEvent API

Tauri v2 的 `AppBuilder::run` 签名：
```rust
pub fn run<F>(self, context: Context, handler: F) -> Result<(), Error>
where
    F: Fn(&AppHandle, RunEvent) + 'static,
```

在 `RunEvent::Exit` 里调用 `kill_sidecar` 即可作为兜底。注意 `slot.take()` 是幂等的：若 `CloseRequested` 已经取走了 child，这里拿到的是 `None`，静默跳过。

### Step 2: 修改 run() 调用

把：
```rust
.run(tauri::generate_context!())
.unwrap_or_else(|error| eprintln!("error while running tauri application: {error}"));
```

改为：
```rust
.build(tauri::generate_context!())
.expect("Failed to build Tauri application")
.run(|app, event| {
    if let tauri::RunEvent::Exit = event {
        kill_sidecar(app);
    }
});
```

> 注：`.build().run()` 与 `.run()` 在功能上等价，只是分离了构建和运行阶段，`.unwrap_or_else` 改为 `.expect` 保持一致的 panic 行为。

### Step 3: 验证编译与测试

```
cargo test
```

期望：`7 passed; 0 failed`

### Step 4: Commit

```
git add src-tauri/src/lib.rs
git commit -m "feat: add RunEvent::Exit fallback to guarantee sidecar cleanup"
```

---

## Task 3: Windows Job Object —— OS 层保障（主进程被强杀时 sidecar 不残留）

### 目标
在 Windows release build 中，spawn sidecar 后立即将其加入一个 Job Object，并在 Job Object 上设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。当主进程以任何方式退出（包括 `TerminateProcess`、未处理异常、任务管理器强杀），Job Object 的内核句柄随主进程关闭，OS 自动 kill Job 中的所有进程。

**Files:**
- Modify: `src-tauri/src/lib.rs`

### Step 1: 确认 windows-sys 已可用

`Cargo.lock` 中已有 `windows-sys 0.60.2`（由 `shared_child` 引入）。在 `Cargo.toml` 中为本 crate 添加依赖，指定所需 features：

在 `[dependencies]` 下追加：
```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.60", features = [
    "Win32_Foundation",
    "Win32_System_JobObjects",
    "Win32_System_Threading",
] }
```

> 注：`version = "0.60"` 匹配 lockfile 中 `0.60.2`，不会引入新版本。

### Step 2: 新增 `sidecar_job` 模块

在 `src-tauri/src/lib.rs` 顶部的 `mod workspace_paths;` 下方，添加一个条件编译的模块：

```rust
#[cfg(all(windows, not(debug_assertions)))]
mod sidecar_job {
    //! Windows Job Object that auto-kills the sidecar when the host process exits.
    //!
    //! The Job Object handle is intentionally kept alive for the entire process
    //! lifetime (stored in a `Box` that is leaked). When the host process exits
    //! for any reason, the OS closes all handles, which triggers
    //! JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and terminates every process in the job.

    use windows_sys::Win32::{
        Foundation::HANDLE,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::GetCurrentProcess,
        },
    };

    pub struct JobObject(HANDLE);

    // SAFETY: The HANDLE is valid as long as JobObject is alive.
    // We only store it in a global-lifetime Box (via Box::leak), so Send is safe.
    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl Drop for JobObject {
        fn drop(&mut self) {
            // Normally never called (we leak the Box), but correct to implement.
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }

    /// Creates a Job Object with KILL_ON_JOB_CLOSE and returns a handle to it.
    /// Returns `None` if any Win32 API call fails (non-fatal; fall back gracefully).
    pub fn create_kill_on_close_job() -> Option<JobObject> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job == 0 {
                eprintln!("[JobObject] CreateJobObjectW failed");
                return None;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION =
                std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                eprintln!("[JobObject] SetInformationJobObject failed");
                windows_sys::Win32::Foundation::CloseHandle(job);
                return None;
            }

            Some(JobObject(job))
        }
    }

    /// Assigns the given raw process handle to a Job Object.
    /// Returns `true` on success.
    pub fn assign_process_to_job(job: &JobObject, process_handle: HANDLE) -> bool {
        unsafe { AssignProcessToJobObject(job.0, process_handle) != 0 }
    }

    /// Returns the raw HANDLE of the current (host) process.
    /// Used to verify that the host is itself not already in a Job Object
    /// (nested Jobs require Windows 8+, which we target; this is informational only).
    pub fn current_process_handle() -> HANDLE {
        unsafe { GetCurrentProcess() }
    }
}
```

### Step 3: 在 spawn 后将 sidecar 加入 Job Object

在 `setup` 闭包内，spawn sidecar 之后添加 Job Object 绑定逻辑。

找到现有代码（`lib.rs` release build 段落）：
```rust
let (mut rx, child) = sidecar_command
    .spawn()
    .map_err(|error| std::io::Error::other(format!("Failed to spawn Python sidecar: {error}")))?;

let sidecar = _app.state::<PythonSidecar>();
with_sidecar_slot(&sidecar.0, |slot| *slot = Some(child))
    .map_err(std::io::Error::other)?;
```

在 `with_sidecar_slot` 调用之后，紧接着插入（`#[cfg(windows)]`）：

```rust
// Windows: bind sidecar to a Job Object so the OS kills it when host exits.
#[cfg(windows)]
{
    use sidecar_job::{assign_process_to_job, create_kill_on_close_job};
    use windows_sys::Win32::System::Threading::OpenProcess;
    use windows_sys::Win32::Foundation::PROCESS_ALL_ACCESS;

    if let Some(job) = create_kill_on_close_job() {
        // Obtain the sidecar's PID via the stored CommandChild, then open a handle.
        let pid = _app
            .state::<PythonSidecar>()
            .0
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|c| c.pid()));

        if let Some(pid) = pid {
            let proc_handle = unsafe {
                OpenProcess(PROCESS_ALL_ACCESS, 0, pid)
            };
            if proc_handle != 0 {
                if assign_process_to_job(&job, proc_handle) {
                    println!("[JobObject] Sidecar PID {pid} bound to kill-on-close Job Object");
                } else {
                    eprintln!("[JobObject] AssignProcessToJobObject failed for PID {pid}");
                }
                unsafe { windows_sys::Win32::Foundation::CloseHandle(proc_handle); }
            }
        }

        // Leak the Job Object — its handle must outlive the process.
        Box::leak(Box::new(job));
    }
}
```

> `CommandChild::pid()` 返回 `u32`，是 tauri-plugin-shell 的公开 API。

### Step 4: 验证编译

```
cargo build 2>&1
```

期望：编译通过，无 error（warning 可接受）。

```
cargo test
```

期望：`7 passed; 0 failed`

### Step 5: Commit

```
git add src-tauri/src/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat(windows): bind sidecar to Job Object to prevent orphan on host crash"
```

---

## Task 4: Python 侧 lifespan shutdown hook（最小改动）

### 目标
在 FastAPI `app` 上注册 `lifespan` context manager，shutdown 阶段取消所有 active agent tasks，确保 uvicorn 的 graceful shutdown 能完成而不是被 pending task 阻塞。

改动极小：只在 `main.py` 中修改 `app = FastAPI(...)` 的创建方式。

**Files:**
- Modify: `python_backend/main.py`

### Step 1: 理解现有代码

当前 `main.py` 创建 app：
```python
app = FastAPI()
```

并在模块末尾：
```python
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
```

`runtime_state.active_agents` 是 `dict[str, Agent]`，`Agent` 有 `_interrupt_event: asyncio.Event`，调用 `agent.interrupt()` 会 set 该 event，从而让 agent loop 在下一个检查点退出。

### Step 2: 修改代码

把：
```python
app = FastAPI()
```

改为：
```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: nothing to do here
    yield
    # shutdown: cancel all active agent runs so uvicorn can exit cleanly
    for agent in list(runtime_state.active_agents.values()):
        try:
            agent.interrupt()
        except Exception:
            pass

app = FastAPI(lifespan=lifespan)
```

> 注：`asynccontextmanager` 已在 Python 标准库中，不引入新依赖。`agent.interrupt()` 已存在于 `python_backend/core/agent.py`，直接调用即可。

### Step 3: 手动验证（无自动化测试）

启动 backend，开始一次 agent run（让它处于工具执行阶段），然后：
```bash
# 发送 SIGTERM 给 Python 进程（模拟 uvicorn graceful shutdown）
kill -SIGTERM <uvicorn-pid>
```

期望：进程在几秒内退出，不卡死。

### Step 4: Commit

```
git add python_backend/main.py
git commit -m "feat: add FastAPI lifespan hook to cancel active agents on shutdown"
```

---

## Task 5: 验证整体效果

### Step 1: Release build 编译通过

```
cargo build --release 2>&1 | tail -5
```

期望：无 error。

### Step 2: 所有 Rust 测试通过

```
cargo test
```

期望：`7 passed; 0 failed`

### Step 3: 手动验证 Job Object 效果（Windows）

1. 用 release binary 启动应用（或用 `cargo run --release`）
2. 打开任务管理器，确认 `python_backend.exe` 出现
3. 在任务管理器中找到 Tauri 主进程，右键 "结束任务"
4. 观察 `python_backend.exe` 是否**同时消失**

期望：sidecar 随主进程消失，不残留。

### Step 4: 手动验证正常关闭路径不受影响

1. 正常启动应用
2. 点击窗口 X 关闭
3. 确认 `python_backend.exe` 消失

期望：正常关闭路径依然工作。

---

## 防线总结

完成后，三道防线覆盖所有退出场景：

| 场景 | 防线 1: CloseRequested | 防线 2: RunEvent::Exit | 防线 3: Job Object |
|---|---|---|---|
| 用户点 X | ✅ | ✅ (幂等) | ✅ (幂等) |
| 任务管理器强杀 | ❌ | ❌ | ✅ |
| Rust panic/crash | ❌ | ❌ | ✅ |
| Mutex 中毒 | ❌ | ❌ | ✅ |
| 系统注销/重启 | - | - | ✅ |
