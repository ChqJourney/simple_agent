use std::{path::Path, sync::Mutex};
use tauri::Manager;

mod workspace_paths;

const EMBEDDED_PYTHON_ENV_VAR: &str = "TAURI_AGENT_EMBEDDED_PYTHON";
const EMBEDDED_NODE_ENV_VAR: &str = "TAURI_AGENT_EMBEDDED_NODE";

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn prepare_workspace_path(
    app: tauri::AppHandle,
    selected_path: String,
    existing_paths: Vec<String>,
) -> Result<workspace_paths::WorkspacePrepareOutcome, String> {
    let outcome = workspace_paths::prepare_workspace_path(Path::new(&selected_path), &existing_paths)
        .map_err(|error| error.to_string())?;

    let canonical_path = match &outcome {
        workspace_paths::WorkspacePrepareOutcome::Existing { canonical_path, .. }
        | workspace_paths::WorkspacePrepareOutcome::Created { canonical_path } => canonical_path,
    };

    workspace_paths::authorize_workspace_path(&app, Path::new(canonical_path))
        .map_err(|error| error.to_string())?;

    Ok(outcome)
}

#[tauri::command]
fn authorize_workspace_path(
    app: tauri::AppHandle,
    selected_path: String,
) -> Result<workspace_paths::AuthorizedWorkspacePath, String> {
    workspace_paths::authorize_workspace_path(&app, Path::new(&selected_path))
        .map_err(|error| error.to_string())
}

pub struct PythonSidecar(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

fn sidecar_event_log_entry(
    event: &tauri_plugin_shell::process::CommandEvent,
) -> Option<(bool, String)> {
    use tauri_plugin_shell::process::CommandEvent;

    match event {
        CommandEvent::Stdout(line) => Some((false, format!("[Python] {}", String::from_utf8_lossy(line)))),
        CommandEvent::Stderr(line) => Some((true, format!("[Python Error] {}", String::from_utf8_lossy(line)))),
        CommandEvent::Error(error) => Some((true, format!("[Python Sidecar Error] {error}"))),
        CommandEvent::Terminated(payload) => Some((
            payload.code.unwrap_or_default() != 0 || payload.signal.is_some(),
            format!(
                "[Python sidecar terminated] code={:?} signal={:?}",
                payload.code, payload.signal
            ),
        )),
        _ => None,
    }
}

fn with_sidecar_slot<T, F, R>(mutex: &Mutex<Option<T>>, action: F) -> Result<R, String>
where
    F: FnOnce(&mut Option<T>) -> R,
{
    let mut guard = mutex
        .lock()
        .map_err(|_| "Python sidecar state lock poisoned".to_string())?;
    Ok(action(&mut *guard))
}

fn embedded_python_dir(resource_dir: &Path) -> std::path::PathBuf {
    resource_dir.join("runtimes").join("python")
}

fn embedded_node_dir(resource_dir: &Path) -> std::path::PathBuf {
    resource_dir.join("runtimes").join("node")
}

fn embedded_runtime_envs(resource_dir: &Path) -> [(String, String); 2] {
    [
        (
            EMBEDDED_PYTHON_ENV_VAR.to_string(),
            embedded_python_dir(resource_dir).display().to_string(),
        ),
        (
            EMBEDDED_NODE_ENV_VAR.to_string(),
            embedded_node_dir(resource_dir).display().to_string(),
        ),
    ]
}

#[cfg(all(windows, not(debug_assertions)))]
mod sidecar_job {
    //! Windows Job Object that auto-kills the sidecar when the host process exits.
    //!
    //! The Job Object handle is intentionally kept alive for the entire process
    //! lifetime (stored in a `Box` that is leaked). When the host process exits
    //! for any reason, the OS closes all handles, which triggers
    //! JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and terminates every process in the job.

    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{OpenProcess, PROCESS_ALL_ACCESS},
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
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Creates a Job Object with KILL_ON_JOB_CLOSE set.
    /// Returns `None` if any Win32 API call fails (non-fatal; caller falls back gracefully).
    pub fn create_kill_on_close_job() -> Option<JobObject> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                eprintln!("[JobObject] CreateJobObjectW failed");
                return None;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &raw const info as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                eprintln!("[JobObject] SetInformationJobObject failed");
                CloseHandle(job);
                return None;
            }

            Some(JobObject(job))
        }
    }

    /// Opens a handle to the process with the given PID and assigns it to the job.
    /// Logs on failure but does not propagate error (non-fatal).
    pub fn bind_pid_to_job(job: &JobObject, pid: u32) {
        unsafe {
            let proc = OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
            if proc.is_null() {
                eprintln!("[JobObject] OpenProcess failed for PID {pid}");
                return;
            }

            if AssignProcessToJobObject(job.0, proc) == 0 {
                eprintln!("[JobObject] AssignProcessToJobObject failed for PID {pid}");
            } else {
                println!("[JobObject] Sidecar PID {pid} bound to kill-on-close Job Object");
            }

            CloseHandle(proc);
        }
    }
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PythonSidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            greet,
            prepare_workspace_path,
            authorize_workspace_path
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                println!("[Dev Mode] Python backend should be started manually:");
                println!("[Dev Mode] cd python_backend && python main.py");
                return Ok(());
            }
            
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_shell::ShellExt;
                
                let shell = _app.shell();
                let resource_dir = _app
                    .path()
                    .resource_dir()
                    .map_err(|error| std::io::Error::other(format!("Failed to resolve Tauri resource directory: {error}")))?;
                let sidecar_command = shell
                    .sidecar("python_backend")
                    .map_err(|error| std::io::Error::other(format!("Failed to create Python sidecar command: {error}")))?
                    .envs(embedded_runtime_envs(&resource_dir));
                
                let (mut rx, child) = sidecar_command
                    .spawn()
                    .map_err(|error| std::io::Error::other(format!("Failed to spawn Python sidecar: {error}")))?;
                
                let sidecar = _app.state::<PythonSidecar>();
                with_sidecar_slot(&sidecar.0, |slot| *slot = Some(child))
                    .map_err(std::io::Error::other)?;

                // Windows: bind sidecar to a Job Object so the OS kills it when host exits.
                #[cfg(windows)]
                {
                    use sidecar_job::{bind_pid_to_job, create_kill_on_close_job};
                    if let Some(job) = create_kill_on_close_job() {
                        // Read PID from the slot without taking it
                        let pid = _app
                            .state::<PythonSidecar>()
                            .0
                            .lock()
                            .ok()
                            .and_then(|guard| guard.as_ref().map(|c| c.pid()));
                        if let Some(pid) = pid {
                            bind_pid_to_job(&job, pid);
                        }
                        // Leak the Job Object — its handle must outlive the process.
                        Box::leak(Box::new(job));
                    }
                }

                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        if let Some((is_error, message)) = sidecar_event_log_entry(&event) {
                            if is_error {
                                eprintln!("{message}");
                            } else {
                                println!("{message}");
                            }
                        }
                    }
                });
                
                Ok(())
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                kill_sidecar(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to build Tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                kill_sidecar(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        embedded_node_dir, embedded_python_dir, embedded_runtime_envs, sidecar_event_log_entry, with_sidecar_slot,
        EMBEDDED_NODE_ENV_VAR, EMBEDDED_PYTHON_ENV_VAR,
    };
    use std::{
        path::Path,
        sync::{Arc, Mutex},
    };
    use tauri_plugin_shell::process::{CommandEvent, TerminatedPayload};

    #[test]
    fn with_sidecar_slot_updates_healthy_mutex() {
        let state = Mutex::new(Some(1_u8));

        let value = with_sidecar_slot(&state, |slot| slot.take()).expect("slot mutation should succeed");

        assert_eq!(Some(1_u8), value);
    }

    #[test]
    fn with_sidecar_slot_returns_error_for_poisoned_mutex() {
        let state = Arc::new(Mutex::new(None::<u8>));
        let cloned = Arc::clone(&state);

        let _ = std::panic::catch_unwind(move || {
            let _guard = cloned.lock().expect("poison test lock");
            panic!("poison sidecar state");
        });

        let result = with_sidecar_slot(&state, |slot| slot.take());

        assert!(result.is_err());
    }

    #[test]
    fn embedded_runtime_helpers_use_resource_dir_without_product_name_assumptions() {
        let resource_dir = Path::new(r"C:\release-root\custom-product\resources");

        assert_eq!(
            resource_dir.join("runtimes").join("python"),
            embedded_python_dir(resource_dir)
        );
        assert_eq!(
            resource_dir.join("runtimes").join("node"),
            embedded_node_dir(resource_dir)
        );
    }

    #[test]
    fn embedded_runtime_envs_include_python_and_node_variables() {
        let resource_dir = Path::new(r"C:\release-root\resources");

        let envs = embedded_runtime_envs(resource_dir);

        assert_eq!(EMBEDDED_PYTHON_ENV_VAR, envs[0].0);
        assert_eq!(
            resource_dir.join("runtimes").join("python").display().to_string(),
            envs[0].1
        );
        assert_eq!(EMBEDDED_NODE_ENV_VAR, envs[1].0);
        assert_eq!(
            resource_dir.join("runtimes").join("node").display().to_string(),
            envs[1].1
        );
    }

    #[test]
    fn sidecar_event_log_entry_reports_termination_events() {
        let event = CommandEvent::Terminated(TerminatedPayload {
            code: Some(1),
            signal: None,
        });

        let entry = sidecar_event_log_entry(&event).expect("termination events should log");

        assert!(entry.0);
        assert!(entry.1.contains("terminated"));
        assert!(entry.1.contains("Some(1)"));
    }

    #[test]
    fn sidecar_event_log_entry_reports_errors() {
        let event = CommandEvent::Error("failed to read stdout".to_string());

        let entry = sidecar_event_log_entry(&event).expect("error events should log");

        assert!(entry.0);
        assert!(entry.1.contains("failed to read stdout"));
    }
}
