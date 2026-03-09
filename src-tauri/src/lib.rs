use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub struct PythonSidecar(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PythonSidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![greet])
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
                let sidecar_command = shell.sidecar("python_backend").expect("Failed to create sidecar command");
                
                let (mut rx, child) = sidecar_command.spawn().expect("Failed to spawn Python sidecar");
                
                let sidecar = _app.state::<PythonSidecar>();
                *sidecar.0.lock().unwrap() = Some(child);
                
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
                let app = window.app_handle();
                let sidecar = app.state::<PythonSidecar>();
                if let Some(child) = sidecar.0.lock().unwrap().take() {
                    let _ = child.kill();
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}