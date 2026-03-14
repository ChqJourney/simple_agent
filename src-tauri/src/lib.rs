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
                
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                println!("[Python] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                eprintln!("[Python Error] {}", String::from_utf8_lossy(&line));
                            }
                            _ => {}
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
        embedded_node_dir, embedded_python_dir, embedded_runtime_envs, with_sidecar_slot,
        EMBEDDED_NODE_ENV_VAR, EMBEDDED_PYTHON_ENV_VAR,
    };
    use std::{
        path::Path,
        sync::{Arc, Mutex},
    };

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
}
