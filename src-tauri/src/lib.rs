use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;

struct ServerProcess(Arc<Mutex<Option<Child>>>);

fn open_url_in_system_browser(url: &str) {
  if let Ok(parsed) = tauri::Url::parse(url) {
    if matches!(parsed.scheme(), "http" | "https") {
      if let Err(error) = tauri_plugin_opener::open_url(url, None::<&str>) {
        eprintln!("Failed to open browser: {}", error);
      }
    }
  }
}

fn is_local_app_url(url: &tauri::Url) -> bool {
  matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
}

fn external_nav_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
  tauri::plugin::Builder::new("external-nav")
    .on_navigation(|_webview, url| {
      if is_local_app_url(url) {
        return true;
      }
      if url.scheme() == "http" || url.scheme() == "https" {
        open_url_in_system_browser(url.as_str());
        return false;
      }
      true
    })
    .build()
}

#[tauri::command]
fn open_in_browser(url: String) {
  open_url_in_system_browser(&url);
}

#[tauri::command]
fn relaunch_app(app_handle: tauri::AppHandle) {
  println!("Relaunching application...");
  app_handle.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let server_process = ServerProcess(Arc::new(Mutex::new(None)));

  tauri::Builder::default()
    .manage(server_process)
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_window_state::Builder::new().build())
    .plugin(external_nav_plugin())
    .invoke_handler(tauri::generate_handler![open_in_browser, relaunch_app])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      } else {
        // Production mode: spawn local Next.js node server
        let resource_dir = app.path().resource_dir().expect("failed to get resource dir");
        let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
        let node_path = resource_dir.join("resources").join("bin").join(node_name);
        let server_path = resource_dir.join("resources").join("server").join("start-server.js");

        println!("Spawning background desktop server using node: {:?} with script: {:?}", node_path, server_path);

        let mut command = Command::new(node_path);
        command.arg(server_path)
          .env("PORT", "3000")
          .env("NODE_ENV", "production");
        #[cfg(target_os = "windows")]
        {
          use std::os::windows::process::CommandExt;
          command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let child = command.spawn()
          .expect("failed to start background server");

        let state = app.state::<ServerProcess>();
        *state.0.lock().unwrap() = Some(child);

        // Wait for the server port to open, then navigate the main window
        let app_handle = app.handle().clone();
        thread::spawn(move || {
          let mut attempts = 0;
          while attempts < 30 {
            if TcpStream::connect("127.0.0.1:3000").is_ok() {
              println!("Local server is ready on port 3000!");
              if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.navigate("http://localhost:3000".parse().unwrap());
              }
              break;
            }
            thread::sleep(Duration::from_millis(500));
            attempts += 1;
          }
        });
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| match event {
      tauri::RunEvent::Exit => {
        let state = app_handle.state::<ServerProcess>();
        let mut maybe_child = state.0.lock().unwrap();
        if let Some(mut child) = maybe_child.take() {
          match child.kill() {
            Ok(_) => println!("Background server process killed successfully."),
            Err(e) => eprintln!("Failed to kill background server process: {}", e),
          }
        }
      }
      _ => {}
    });
}
