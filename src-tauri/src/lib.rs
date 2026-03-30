use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use serde::Serialize;
use tauri::Manager;

mod session_storage;
mod skill_catalog;
mod workspace_paths;

#[cfg_attr(debug_assertions, allow(dead_code))]
const EMBEDDED_PYTHON_ENV_VAR: &str = "TAURI_AGENT_EMBEDDED_PYTHON";
#[cfg_attr(debug_assertions, allow(dead_code))]
const EMBEDDED_NODE_ENV_VAR: &str = "TAURI_AGENT_EMBEDDED_NODE";
#[cfg_attr(debug_assertions, allow(dead_code))]
const STRICT_RUNTIME_ENV_VAR: &str = "TAURI_AGENT_RUNTIME_STRICT";
#[cfg_attr(debug_assertions, allow(dead_code))]
const APP_DATA_DIR_ENV_VAR: &str = "TAURI_AGENT_APP_DATA_DIR";
#[cfg_attr(debug_assertions, allow(dead_code))]
const APP_DIR_ENV_VAR: &str = "TAURI_AGENT_APP_DIR";
const AUTH_TOKEN_ENV_VAR: &str = "TAURI_AGENT_AUTH_TOKEN";
const OCR_SIDECAR_RELATIVE_DIR: &str = "ocr-sidecar/current";

#[tauri::command]
fn prepare_workspace_path(
    app: tauri::AppHandle,
    selected_path: String,
    existing_paths: Vec<String>,
) -> Result<workspace_paths::WorkspacePrepareOutcome, String> {
    let outcome =
        workspace_paths::prepare_workspace_path(Path::new(&selected_path), &existing_paths)
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

#[tauri::command]
fn scan_workspace_sessions(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<Vec<session_storage::SessionMetaPayload>, String> {
    session_storage::scan_workspace_sessions(&app, &workspace_path)
}

#[tauri::command]
fn read_session_history(
    app: tauri::AppHandle,
    workspace_path: String,
    session_id: String,
) -> Result<session_storage::SessionHistoryPayload, String> {
    session_storage::read_session_history(&app, &workspace_path, &session_id)
}

#[tauri::command]
fn delete_session_history(
    app: tauri::AppHandle,
    workspace_path: String,
    session_id: String,
) -> Result<(), String> {
    session_storage::delete_session_history(&app, &workspace_path, &session_id)
}

#[tauri::command]
fn open_workspace_folder(selected_path: String) -> Result<(), String> {
    let workspace_path = Path::new(&selected_path);
    if !workspace_path.exists() {
        return Err(format!("Workspace path does not exist: {selected_path}"));
    }

    if !workspace_path.is_dir() {
        return Err(format!(
            "Workspace path is not a directory: {selected_path}"
        ));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(&selected_path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(&selected_path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(&selected_path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open workspace folder: {error}"))
}

#[tauri::command]
fn scan_system_skills(app: tauri::AppHandle) -> Result<skill_catalog::SkillCatalogPayload, String> {
    skill_catalog::scan_system_skills(&app)
}

#[tauri::command]
fn scan_workspace_skills(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<skill_catalog::SkillCatalogPayload, String> {
    skill_catalog::scan_workspace_skills(&app, &workspace_path)
}

pub struct BackendAuthToken(Mutex<Option<String>>);
pub struct PythonSidecar(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct OcrSidecarInstallPayload {
    app_dir: String,
    install_dir: String,
    installed: bool,
    version: Option<String>,
}

fn ocr_install_root(app_dir: &Path) -> PathBuf {
    app_dir.join(OCR_SIDECAR_RELATIVE_DIR)
}

fn read_ocr_manifest_version(root: &Path) -> Option<String> {
    let manifest_path = root.join("manifest.json");
    let contents = fs::read_to_string(manifest_path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&contents).ok()?;
    value
        .get("version")
        .and_then(|candidate| candidate.as_str())
        .map(str::to_string)
}

fn resolve_ocr_source_root(selected_path: &Path) -> Result<PathBuf, String> {
    let direct_manifest = selected_path.join("manifest.json");
    let nested_manifest = selected_path.join("current").join("manifest.json");

    let root = if direct_manifest.is_file() {
        selected_path.to_path_buf()
    } else if nested_manifest.is_file() {
        selected_path.join("current")
    } else {
        return Err(format!(
            "Selected folder does not look like an OCR sidecar package: {}",
            selected_path.display()
        ));
    };

    let manifest_contents = fs::read_to_string(root.join("manifest.json"))
        .map_err(|error| format!("Failed to read OCR manifest: {error}"))?;
    let manifest_value = serde_json::from_str::<serde_json::Value>(&manifest_contents)
        .map_err(|error| format!("Failed to parse OCR manifest: {error}"))?;
    let entry = manifest_value
        .get("entry")
        .and_then(|candidate| candidate.as_str())
        .unwrap_or("ocr-server.exe");
    let entry_path = root.join(entry);
    if !entry_path.is_file() {
        return Err(format!(
            "OCR sidecar executable not found in selected folder: {}",
            entry_path.display()
        ));
    }

    Ok(root)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create directory {}: {error}", destination.display()))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read directory {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", source_path.display()))?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy {} to {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }

    Ok(())
}

fn inspect_ocr_sidecar_impl() -> Result<OcrSidecarInstallPayload, String> {
    let app_dir = executable_dir().ok_or_else(|| {
        "Failed to resolve the application executable directory for OCR installation lookup"
            .to_string()
    })?;
    let install_dir = ocr_install_root(app_dir.as_path());
    let installed = install_dir.is_dir() && install_dir.join("manifest.json").is_file();

    Ok(OcrSidecarInstallPayload {
        app_dir: app_dir.display().to_string(),
        install_dir: install_dir.display().to_string(),
        installed,
        version: if installed {
            read_ocr_manifest_version(&install_dir)
        } else {
            None
        },
    })
}

#[tauri::command]
fn get_backend_auth_token(
    auth_token: tauri::State<'_, BackendAuthToken>,
) -> Result<String, String> {
    let guard = auth_token
        .0
        .lock()
        .map_err(|_| "Backend auth token state lock poisoned".to_string())?;
    guard
        .clone()
        .ok_or_else(|| "Backend auth token unavailable from host".to_string())
}

#[tauri::command]
fn inspect_ocr_sidecar_installation() -> Result<OcrSidecarInstallPayload, String> {
    inspect_ocr_sidecar_impl()
}

#[tauri::command]
fn install_ocr_sidecar(source_dir: String) -> Result<OcrSidecarInstallPayload, String> {
    let app_dir = executable_dir().ok_or_else(|| {
        "Failed to resolve the application executable directory for OCR installation".to_string()
    })?;
    let resolved_source = resolve_ocr_source_root(Path::new(&source_dir))?;
    let ocr_root = app_dir.join("ocr-sidecar");
    let install_dir = ocr_install_root(app_dir.as_path());
    let staging_dir = ocr_root.join(format!(".staging-{}", uuid::Uuid::new_v4().as_simple()));

    fs::create_dir_all(&ocr_root)
        .map_err(|error| format!("Failed to prepare OCR install root {}: {error}", ocr_root.display()))?;

    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(|error| {
            format!("Failed to clean OCR staging directory {}: {error}", staging_dir.display())
        })?;
    }

    copy_dir_recursive(&resolved_source, &staging_dir)?;

    if install_dir.exists() {
        fs::remove_dir_all(&install_dir).map_err(|error| {
            format!(
                "Failed to replace existing OCR installation {}: {error}",
                install_dir.display()
            )
        })?;
    }

    fs::rename(&staging_dir, &install_dir).map_err(|error| {
        format!(
            "Failed to activate OCR installation from {} to {}: {error}",
            staging_dir.display(),
            install_dir.display()
        )
    })?;

    inspect_ocr_sidecar_impl()
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn sidecar_event_log_entry(
    event: &tauri_plugin_shell::process::CommandEvent,
) -> Option<(bool, String)> {
    use tauri_plugin_shell::process::CommandEvent;

    match event {
        CommandEvent::Stdout(line) => {
            Some((false, format!("[Python] {}", String::from_utf8_lossy(line))))
        }
        CommandEvent::Stderr(line) => Some((
            true,
            format!("[Python Error] {}", String::from_utf8_lossy(line)),
        )),
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

#[cfg_attr(debug_assertions, allow(dead_code))]
fn executable_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn runtime_dir_candidates(
    resource_dir: &Path,
    executable_dir: Option<&Path>,
    runtime_name: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(dir) = executable_dir {
        candidates.push(dir.join("runtimes").join(runtime_name));
    }

    let resource_candidate = resource_dir.join("runtimes").join(runtime_name);
    if !candidates
        .iter()
        .any(|candidate| candidate == &resource_candidate)
    {
        candidates.push(resource_candidate);
    }

    candidates
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn python_runtime_root_has_executable(root: &Path) -> bool {
    if cfg!(windows) {
        root.join("python.exe").is_file()
    } else {
        root.join("bin").join("python3").is_file() || root.join("bin").join("python").is_file()
    }
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn node_runtime_root_has_executables(root: &Path) -> bool {
    if cfg!(windows) {
        root.join("node.exe").is_file()
            && root.join("npm.cmd").is_file()
            && root.join("npx.cmd").is_file()
    } else {
        root.join("bin").join("node").is_file()
            && root.join("bin").join("npm").is_file()
            && root.join("bin").join("npx").is_file()
    }
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn resolve_runtime_root(
    resource_dir: &Path,
    executable_dir: Option<&Path>,
    runtime_name: &str,
    is_valid_root: impl Fn(&Path) -> bool,
) -> Result<PathBuf, std::io::Error> {
    let candidates = runtime_dir_candidates(resource_dir, executable_dir, runtime_name);

    for candidate in &candidates {
        if is_valid_root(candidate) {
            return Ok(candidate.clone());
        }
    }

    let checked = candidates
        .iter()
        .map(|candidate| candidate.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(std::io::Error::other(format!(
        "Embedded {runtime_name} runtime not found. Checked: {checked}"
    )))
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn embedded_python_dir(
    resource_dir: &Path,
    executable_dir: Option<&Path>,
) -> Result<PathBuf, std::io::Error> {
    resolve_runtime_root(
        resource_dir,
        executable_dir,
        "python",
        python_runtime_root_has_executable,
    )
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn embedded_node_dir(
    resource_dir: &Path,
    executable_dir: Option<&Path>,
) -> Result<PathBuf, std::io::Error> {
    resolve_runtime_root(
        resource_dir,
        executable_dir,
        "node",
        node_runtime_root_has_executables,
    )
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn embedded_runtime_envs(
    resource_dir: &Path,
    executable_dir: Option<&Path>,
) -> Result<[(String, String); 2], std::io::Error> {
    Ok([
        (
            EMBEDDED_PYTHON_ENV_VAR.to_string(),
            embedded_python_dir(resource_dir, executable_dir)?
                .display()
                .to_string(),
        ),
        (
            EMBEDDED_NODE_ENV_VAR.to_string(),
            embedded_node_dir(resource_dir, executable_dir)?
                .display()
                .to_string(),
        ),
    ])
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
    let initial_auth_token = std::env::var(AUTH_TOKEN_ENV_VAR).ok().and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(BackendAuthToken(Mutex::new(initial_auth_token)))
        .manage(PythonSidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            prepare_workspace_path,
            authorize_workspace_path,
            scan_workspace_sessions,
            read_session_history,
            delete_session_history,
            open_workspace_folder,
            scan_system_skills,
            scan_workspace_skills,
            get_backend_auth_token,
            inspect_ocr_sidecar_installation,
            install_ocr_sidecar
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

                let auth_token = {
                    let state = _app.state::<BackendAuthToken>();
                    let mut guard = state.0.lock().map_err(|_| {
                        std::io::Error::other("Backend auth token state lock poisoned")
                    })?;
                    if let Some(existing) = guard.clone() {
                        existing
                    } else {
                        let generated = uuid::Uuid::new_v4().as_simple().to_string();
                        *guard = Some(generated.clone());
                        generated
                    }
                };

                let shell = _app.shell();
                let resource_dir = _app.path().resource_dir().map_err(|error| {
                    std::io::Error::other(format!(
                        "Failed to resolve Tauri resource directory: {error}"
                    ))
                })?;
                let executable_dir = executable_dir().ok_or_else(|| {
                    std::io::Error::other(
                        "Failed to resolve the application executable directory for runtime lookup",
                    )
                })?;
                let app_data_dir = _app.path().app_data_dir().map_err(|error| {
                    std::io::Error::other(format!(
                        "Failed to resolve Tauri app data directory: {error}"
                    ))
                })?;
                let sidecar_command = shell
                    .sidecar("core")
                    .map_err(|error| {
                        std::io::Error::other(format!(
                            "Failed to create Python sidecar command: {error}"
                        ))
                    })?
                    .envs(embedded_runtime_envs(
                        &resource_dir,
                        Some(executable_dir.as_path()),
                    )?)
                    .env(STRICT_RUNTIME_ENV_VAR, "1")
                    .env(AUTH_TOKEN_ENV_VAR, auth_token)
                    .env(APP_DIR_ENV_VAR, executable_dir.display().to_string())
                    .env(APP_DATA_DIR_ENV_VAR, app_data_dir.display().to_string());

                let (mut rx, child) = sidecar_command.spawn().map_err(|error| {
                    std::io::Error::other(format!("Failed to spawn Python sidecar: {error}"))
                })?;

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
        embedded_node_dir, embedded_python_dir, embedded_runtime_envs, sidecar_event_log_entry,
        with_sidecar_slot, APP_DATA_DIR_ENV_VAR, APP_DIR_ENV_VAR, EMBEDDED_NODE_ENV_VAR,
        EMBEDDED_PYTHON_ENV_VAR,
    };
    use std::{
        fs,
        path::Path,
        sync::{Arc, Mutex},
    };
    use tauri_plugin_shell::process::{CommandEvent, TerminatedPayload};
    use tempfile::tempdir;

    fn create_python_runtime(root: &Path) {
        if cfg!(windows) {
            fs::create_dir_all(root).expect("python runtime dir should be created");
            fs::write(root.join("python.exe"), b"")
                .expect("python runtime executable should be created");
        } else {
            fs::create_dir_all(root.join("bin")).expect("python runtime bin dir should be created");
            fs::write(root.join("bin").join("python3"), b"")
                .expect("python runtime executable should be created");
        }
    }

    fn create_node_runtime(root: &Path) {
        if cfg!(windows) {
            fs::create_dir_all(root).expect("node runtime dir should be created");
            fs::write(root.join("node.exe"), b"").expect("node executable should be created");
            fs::write(root.join("npm.cmd"), b"").expect("npm command should be created");
            fs::write(root.join("npx.cmd"), b"").expect("npx command should be created");
        } else {
            fs::create_dir_all(root.join("bin")).expect("node runtime bin dir should be created");
            fs::write(root.join("bin").join("node"), b"")
                .expect("node executable should be created");
            fs::write(root.join("bin").join("npm"), b"").expect("npm command should be created");
            fs::write(root.join("bin").join("npx"), b"").expect("npx command should be created");
        }
    }

    #[test]
    fn with_sidecar_slot_updates_healthy_mutex() {
        let state = Mutex::new(Some(1_u8));

        let value =
            with_sidecar_slot(&state, |slot| slot.take()).expect("slot mutation should succeed");

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
    fn embedded_runtime_helpers_prefer_executable_sibling_runtimes_when_present() {
        let temp = tempdir().expect("temp dir should be created");
        let executable_dir = temp.path().join("portable-root");
        let resource_dir = executable_dir.join("resources");

        create_python_runtime(&executable_dir.join("runtimes").join("python"));
        create_node_runtime(&executable_dir.join("runtimes").join("node"));
        create_python_runtime(&resource_dir.join("runtimes").join("python"));
        create_node_runtime(&resource_dir.join("runtimes").join("node"));

        assert_eq!(
            executable_dir.join("runtimes").join("python"),
            embedded_python_dir(resource_dir.as_path(), Some(executable_dir.as_path()))
                .expect("portable python runtime should be preferred")
        );
        assert_eq!(
            executable_dir.join("runtimes").join("node"),
            embedded_node_dir(resource_dir.as_path(), Some(executable_dir.as_path()))
                .expect("portable node runtime should be preferred")
        );
    }

    #[test]
    fn embedded_runtime_helpers_fallback_to_resource_dir_when_sibling_runtimes_are_missing() {
        let temp = tempdir().expect("temp dir should be created");
        let executable_dir = temp.path().join("portable-root");
        let resource_dir = executable_dir.join("resources");

        create_python_runtime(&resource_dir.join("runtimes").join("python"));
        create_node_runtime(&resource_dir.join("runtimes").join("node"));

        assert_eq!(
            resource_dir.join("runtimes").join("python"),
            embedded_python_dir(resource_dir.as_path(), Some(executable_dir.as_path()))
                .expect("resource python runtime should be used as fallback")
        );
        assert_eq!(
            resource_dir.join("runtimes").join("node"),
            embedded_node_dir(resource_dir.as_path(), Some(executable_dir.as_path()))
                .expect("resource node runtime should be used as fallback")
        );
    }

    #[test]
    fn embedded_runtime_envs_include_python_and_node_variables() {
        let temp = tempdir().expect("temp dir should be created");
        let executable_dir = temp.path().join("portable-root");
        let resource_dir = executable_dir.join("resources");

        create_python_runtime(&executable_dir.join("runtimes").join("python"));
        create_node_runtime(&executable_dir.join("runtimes").join("node"));

        let envs = embedded_runtime_envs(resource_dir.as_path(), Some(executable_dir.as_path()))
            .expect("runtime envs should resolve");

        assert_eq!(EMBEDDED_PYTHON_ENV_VAR, envs[0].0);
        assert_eq!(
            executable_dir
                .join("runtimes")
                .join("python")
                .display()
                .to_string(),
            envs[0].1
        );
        assert_eq!(EMBEDDED_NODE_ENV_VAR, envs[1].0);
        assert_eq!(
            executable_dir
                .join("runtimes")
                .join("node")
                .display()
                .to_string(),
            envs[1].1
        );
        assert_eq!("TAURI_AGENT_APP_DATA_DIR", APP_DATA_DIR_ENV_VAR);
        assert_eq!("TAURI_AGENT_APP_DIR", APP_DIR_ENV_VAR);
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
