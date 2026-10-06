use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

struct ServerProcess(Arc<Mutex<Option<Child>>>);
struct StartupFailure(Mutex<Option<String>>);

fn backend_port(value: Option<String>) -> Result<u16, String> {
  let port = value.unwrap_or_else(|| "3000".to_string()).parse::<u16>().map_err(|_| "Invalid backend port.".to_string())?;
  if port == 0 { return Err("Invalid backend port.".to_string()); }
  let occupied = || format!("Port {} is already in use. Close the previous XBook instance or the application using that port, then restart XBook.", port);
  // A wildcard listener may coexist with a specific-address bind on macOS.
  if TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(250)).is_ok() { return Err(occupied()); }
  TcpListener::bind(("127.0.0.1", port)).map_err(|_| occupied())?;
  Ok(port)
}

fn backend_is_owned(port: u16, owner: &str) -> bool {
  let Ok(mut stream) = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(250)) else { return false; };
  let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
  let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
  if write!(stream, "GET /api/version HTTP/1.1\r\nHost: localhost:{}\r\nConnection: close\r\n\r\n", port).is_err() { return false; }
  let mut bytes = Vec::new();
  if stream.take(8192).read_to_end(&mut bytes).is_err() { return false; }
  let body = String::from_utf8_lossy(&bytes);
  let (Some(start), Some(end)) = (body.find('{'), body.rfind('}')) else { return false; };
  let Ok(identity) = serde_json::from_str::<serde_json::Value>(&body[start..=end]) else { return false; };
  identity.get("backend").and_then(|backend| backend.get("owner")).and_then(|value| value.as_str()) == Some(owner)
}

fn startup_failure<R: tauri::Runtime>(app: &tauri::AppHandle<R>, message: &str) {
  if let Ok(mut stored) = app.state::<StartupFailure>().0.lock() { *stored = Some(message.to_string()); }
  if let Some(window) = app.get_webview_window("main") {
    if let Ok(text) = serde_json::to_string(message) {
      let _ = window.eval(&format!("document.body.textContent = {}; document.body.style.padding = '24px'; document.body.setAttribute('role', 'alert');", text));
    }
  }
}

fn open_url_in_system_browser(url: &str) {
  println!("Opening URL in system browser: {}", url);
  #[cfg(target_os = "macos")]
  let _ = Command::new("open").arg(url).spawn();

  #[cfg(target_os = "windows")]
  let _ = Command::new("cmd").args(&["/C", "start", url]).spawn();

  #[cfg(target_os = "linux")]
  let _ = Command::new("xdg-open").arg(url).spawn();
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
    .manage(StartupFailure(Mutex::new(None)))
    .on_page_load(|webview, _payload| {
      let message = webview.app_handle().state::<StartupFailure>().0.lock().ok().and_then(|stored| stored.clone());
      if let Some(message) = message { startup_failure(webview.app_handle(), &message); }
    })
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
        let port = match backend_port(std::env::var("PORT").ok()) {
          Ok(port) => port,
          Err(message) => { startup_failure(app.handle(), &message); return Ok(()); }
        };
        let owner = format!("{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
        // Production mode: spawn local Next.js node server
        let resource_dir = app.path().resource_dir().expect("failed to get resource dir");
        let node_path = resource_dir.join("resources").join("bin").join("node");
        let server_path = resource_dir.join("resources").join("server").join("start-server.js");

        println!("Spawning background desktop server using node: {:?} with script: {:?}", node_path, server_path);

        let child = Command::new(node_path)
          .arg(server_path)
          .env("PORT", port.to_string())
          .env("HOSTNAME", "127.0.0.1")
          .env("XBOOK_BACKEND_OWNER", &owner)
          .env("NODE_ENV", "production")
          .spawn()
          .expect("failed to start background server");

        let state = app.state::<ServerProcess>();
        *state.0.lock().unwrap() = Some(child);

        // Wait for the server port to open, then navigate the main window
        let app_handle = app.handle().clone();
        thread::spawn(move || {
          let mut attempts = 0;
          while attempts < 120 {
            if backend_is_owned(port, &owner) {
              println!("Owned local server is ready on port {}!", port);
              if let Some(window) = app_handle.get_webview_window("main") {
                if let Ok(url) = format!("http://localhost:{}", port).parse() { let _ = window.navigate(url); }
              }
              break;
            }
            thread::sleep(Duration::from_millis(500));
            attempts += 1;
          }
          if attempts >= 120 { startup_failure(&app_handle, "XBook could not start its local backend. Restart the application after checking that its database and port are available."); }
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn refuses_invalid_or_occupied_ports() {
    assert!(backend_port(Some("0".into())).is_err());
    assert!(backend_port(Some("bad".into())).is_err());
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    assert!(backend_port(Some(listener.local_addr().unwrap().port().to_string())).is_err());
    let wildcard = TcpListener::bind(("0.0.0.0", 0)).unwrap();
    assert!(backend_port(Some(wildcard.local_addr().unwrap().port().to_string())).is_err());
  }

  #[test]
  fn verifies_owned_backend_instead_of_accepting_any_open_socket() {
    for (reported, expected) in [("owner-a", true), ("old-server", false)] {
      let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
      let port = listener.local_addr().unwrap().port();
      let responder = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        while !request.ends_with(b"\r\n\r\n") {
          let count = stream.read(&mut buffer).unwrap();
          assert!(count > 0);
          request.extend_from_slice(&buffer[..count]);
          assert!(request.len() < 8192);
        }
        assert!(request.starts_with(b"GET /api/version HTTP/1.1\r\n"));
        let body = format!("{{\"backend\":{{\"owner\":\"{}\"}}}}", reported);
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
      });
      assert_eq!(backend_is_owned(port, "owner-a"), expected);
      responder.join().unwrap();
    }
  }
}
