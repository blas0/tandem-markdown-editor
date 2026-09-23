use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

type Replies = Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>;
struct Helper {
    child: Child,
    input: ChildStdin,
    replies: Replies,
}
struct Backend {
    helper: Mutex<Option<Helper>>,
    grants: Mutex<HashMap<String, (String, std::time::Instant)>>,
    open_requests: Mutex<VecDeque<OpenRequest>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    id: String,
    path: String,
    kind: OpenRequestKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum OpenRequestKind {
    Document,
    Folder,
}

fn open_path(value: &str, cwd: &Path) -> Option<(String, OpenRequestKind)> {
    let supplied = if let Ok(url) = tauri::Url::parse(value) {
        if url.scheme() != "file" {
            return None;
        }
        url.to_file_path().ok()?
    } else {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        }
    };
    let path = supplied.canonicalize().ok()?;
    let kind = if path.is_dir() {
        OpenRequestKind::Folder
    } else if path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        OpenRequestKind::Document
    } else {
        return None;
    };
    Some((path.to_string_lossy().into_owned(), kind))
}

fn requests_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<OpenRequest> {
    let mut requests = Vec::new();
    for arg in args {
        let Some((path, kind)) = open_path(&arg, cwd) else {
            continue;
        };
        if requests
            .iter()
            .any(|request: &OpenRequest| request.path == path)
        {
            continue;
        }
        requests.push(OpenRequest {
            id: uuid::Uuid::new_v4().to_string(),
            path,
            kind,
        });
    }
    requests
}

fn queue_open_requests(
    pending: &mut VecDeque<OpenRequest>,
    requests: Vec<OpenRequest>,
) -> Vec<OpenRequest> {
    let mut added = Vec::new();
    for request in requests {
        if let Some(index) = pending
            .iter()
            .position(|queued| queued.path == request.path)
        {
            pending.remove(index);
        }
        pending.push_back(request.clone());
        if let Some(index) = added
            .iter()
            .position(|queued: &OpenRequest| queued.path == request.path)
        {
            added[index] = request;
        } else {
            added.push(request);
        }
    }
    added
}

fn enqueue_open_requests(app: &tauri::AppHandle, requests: Vec<OpenRequest>) {
    let added = if let Ok(mut pending) = app.state::<Backend>().open_requests.lock() {
        queue_open_requests(&mut pending, requests)
    } else {
        Vec::new()
    };
    for request in added {
        if let Ok(mut grants) = app.state::<Backend>().grants.lock() {
            grants.insert(
                request.id.clone(),
                (request.path.clone(), std::time::Instant::now()),
            );
        }
        let _ = app.emit("tandem-open-request", request);
    }
}
impl Helper {
    fn start(app: &tauri::AppHandle) -> Result<Self, String> {
        let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let (node, entry) = if cfg!(debug_assertions) {
            (
                std::env::var("TANDEM_NODE").unwrap_or_else(|_| "/opt/homebrew/bin/node".into()),
                format!("{}/../.tandem-dev/helper.mjs", env!("CARGO_MANIFEST_DIR")),
            )
        } else {
            let r = app
                .path()
                .resource_dir()
                .map_err(|e| e.to_string())?
                .join("resources");
            (
                r.join("node/bin/node").to_string_lossy().into(),
                r.join("helper.mjs").to_string_lossy().into(),
            )
        };
        let mut child = Command::new(node)
            .arg(entry)
            .arg(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not start the local library: {e}"))?;
        let input = child.stdin.take().ok_or("Missing helper input")?;
        let output = child.stdout.take().ok_or("Missing helper output")?;
        let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
        let map = replies.clone();
        let handle = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                if line.len() > 32 * 1024 * 1024 {
                    break;
                }
                let Ok(v) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if v["method"] == "event" {
                    let _ = handle.emit("tandem-event", v["params"].clone());
                } else if let Some(id) = v["id"].as_str() {
                    if let Ok(mut pending) = map.lock() {
                        if let Some(tx) = pending.remove(id) {
                            let _ = tx.send(v);
                        }
                    }
                }
            }
            if let Ok(mut pending) = map.lock() {
                pending.clear();
            }
            let _ = handle.emit("tandem-disconnected", ());
        });
        Ok(Self {
            child,
            input,
            replies,
        })
    }
    fn send(&mut self, method: &str, params: Value) -> Result<PendingReply, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.replies
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), tx);
        let line = serde_json::to_string(
            &json!({"jsonrpc":"2.0","version":1,"id":id,"method":method,"params":params}),
        )
        .map_err(|e| e.to_string())?;
        if let Err(e) = writeln!(self.input, "{line}") {
            self.replies.lock().map_err(|e| e.to_string())?.remove(&id);
            return Err(format!("Local library disconnected: {e}"));
        }
        Ok(PendingReply {
            id,
            rx,
            replies: self.replies.clone(),
        })
    }
}
struct PendingReply {
    id: String,
    rx: mpsc::Receiver<Value>,
    replies: Replies,
}
impl PendingReply {
    fn wait(self) -> Result<Value, String> {
        let result = self.rx.recv_timeout(Duration::from_secs(240)).map_err(|_| {
            "The local library did not respond. Your pending edits are retained. Please retry."
                .to_string()
        });
        self.replies
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&self.id);
        let value = result?;
        if !value["error"].is_null() {
            Err(value["error"]["message"]
                .as_str()
                .unwrap_or("Local operation failed")
                .into())
        } else {
            Ok(value["result"].clone())
        }
    }
}
fn call(app: &tauri::AppHandle, method: &str, params: Value) -> Result<Value, String> {
    request(
        &app.state::<Backend>().helper,
        || Helper::start(app),
        method,
        params,
    )
}
fn request(
    helper: &Mutex<Option<Helper>>,
    start: impl FnOnce() -> Result<Helper, String>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut slot = helper.lock().map_err(|e| e.to_string())?;
    let dead = match slot.as_mut() {
        Some(h) => h.child.try_wait().map_err(|e| e.to_string())?.is_some(),
        None => true,
    };
    if dead {
        *slot = Some(start()?);
    }
    let pending = slot
        .as_mut()
        .ok_or("Library unavailable")?
        .send(method, params)?;
    drop(slot);
    pending.wait()
}

fn validate_renderer_request(method: &str, params: &Value) -> Result<(), String> {
    let protocol: Value =
        serde_json::from_str(include_str!("../protocol.json")).map_err(|e| e.to_string())?;
    if !protocol["methods"].as_array().is_some_and(|methods| {
        methods
            .iter()
            .any(|candidate| candidate.as_str() == Some(method))
    }) {
        return Err("This operation is not available through the document bridge".into());
    }
    if !params.is_object() {
        return Err("Request parameters must be an object".into());
    }
    if serde_json::to_vec(params).map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 - 1024 {
        return Err("Request exceeds 32 MB".into());
    }
    Ok(())
}
/// The Dock icon follows Tandem's Appearance setting, not the system appearance.
fn appearance_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("icon-appearance"))
}
#[cfg(target_os = "macos")]
fn apply_app_icon(theme: &str) {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let bytes: &[u8] = if theme == "dark" {
        include_bytes!("../icons/appearance/dark.png")
    } else {
        include_bytes!("../icons/appearance/light.png")
    };
    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)) {
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image)) };
    }
}
#[cfg(not(target_os = "macos"))]
fn apply_app_icon(_theme: &str) {}
#[tauri::command]
fn set_app_icon(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    if theme != "light" && theme != "dark" {
        return Err("Unknown appearance".into());
    }
    if let Some(path) = appearance_file(&app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, &theme);
    }
    app.run_on_main_thread(move || apply_app_icon(&theme))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn rpc(app: tauri::AppHandle, method: String, params: Value) -> Result<Value, String> {
    validate_renderer_request(&method, &params)?;
    tauri::async_runtime::spawn_blocking(move || call(&app, &method, params))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn drain_open_requests(app: tauri::AppHandle) -> Result<Vec<OpenRequest>, String> {
    Ok(app
        .state::<Backend>()
        .open_requests
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .cloned()
        .collect())
}

#[tauri::command]
async fn open_import_request(
    app: tauri::AppHandle,
    id: String,
    encoding: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = {
            let state = app.state::<Backend>();
            let mut grants = state.grants.lock().map_err(|e| e.to_string())?;
            grants.retain(|_, (_, created)| created.elapsed() < Duration::from_secs(900));
            grants
                .get(&id)
                .map(|(path, _)| path.clone())
                .ok_or("Open request expired")?
        };
        let mut params = json!({"path": path});
        if let Some(encoding) = encoding {
            params["encoding"] = json!(encoding);
        }
        let result = call(&app, "files.open", params)?;
        if result["needsEncoding"] == true || result["needsConfirmation"] == true {
            return Ok(result);
        }
        app.state::<Backend>()
            .open_requests
            .lock()
            .map_err(|e| e.to_string())?
            .retain(|request| request.id != id);
        app.state::<Backend>()
            .grants
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pick_import_folder(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app.dialog().file().blocking_pick_folder() else {
            return Ok(Value::Null);
        };
        let path = folder.into_path().map_err(|e| e.to_string())?;
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        let request = OpenRequest {
            id: uuid::Uuid::new_v4().to_string(),
            path: canonical.to_string_lossy().into_owned(),
            kind: OpenRequestKind::Folder,
        };
        app.state::<Backend>()
            .grants
            .lock()
            .map_err(|e| e.to_string())?
            .insert(
                request.id.clone(),
                (request.path.clone(), std::time::Instant::now()),
            );
        serde_json::to_value(request).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_file(
    app: tauri::AppHandle,
    asset: bool,
    grant: Option<String>,
    encoding: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = if let Some(ref token) = grant {
            let state = app.state::<Backend>();
            let mut grants = state.grants.lock().map_err(|e| e.to_string())?;
            grants.retain(|_, (_, created)| created.elapsed() < Duration::from_secs(900));
            grants
                .get(token)
                .map(|(path, _)| path.clone())
                .ok_or("Import selection expired")?
        } else {
            let extensions = if asset {
                vec!["png", "jpg", "jpeg", "gif", "webp"]
            } else {
                vec!["md"]
            };
            let Some(file) = app
                .dialog()
                .file()
                .add_filter(if asset { "Images" } else { "Documents" }, &extensions)
                .blocking_pick_file()
            else {
                return Ok(Value::Null);
            };
            file.into_path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into()
        };
        let token = grant
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let result = call(
            &app,
            if asset {
                "assets.import"
            } else {
                "files.import"
            },
            if asset {
                json!({"path":path})
            } else {
                {
                    let mut params =
                        json!({"path":path,"confirm":grant.is_some(),"importId":token});
                    if let Some(encoding) = encoding {
                        params["encoding"] = json!(encoding);
                    }
                    params
                }
            },
        )?;
        if result["needsConfirmation"] == true || result["needsEncoding"] == true {
            app.state::<Backend>()
                .grants
                .lock()
                .map_err(|e| e.to_string())?
                .insert(token.clone(), (path, std::time::Instant::now()));
            let mut response = result;
            response["grant"] = json!(token);
            Ok(response)
        } else {
            Ok(result)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
/// The configured export location, falling back to the Desktop and then the home folder.
fn export_directory(app: &tauri::AppHandle, configured: Option<String>) -> Result<PathBuf, String> {
    if let Some(directory) = configured.filter(|value| !value.trim().is_empty()) {
        return Ok(PathBuf::from(directory));
    }
    app.path()
        .desktop_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())
}
/// Exports the Markdown document without a save dialog. An existing file is never
/// overwritten; the copy is numbered instead.
#[tauri::command]
async fn export_file(
    app: tauri::AppHandle,
    id: String,
    name: String,
    directory: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = export_directory(&app, directory)?;
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let safe = name.replace(['/', '\\', ':'], "-");
        let safe = safe.strip_suffix(".md").unwrap_or(&safe).trim().to_string();
        let stem = if safe.is_empty() { "Untitled" } else { &safe };
        let mut path = root.join(format!("{stem}.md"));
        let mut attempt = 2;
        while path.exists() {
            path = root.join(format!("{stem} ({attempt}).md"));
            attempt += 1;
            if attempt > 1000 {
                return Err("Too many exported copies of this document".into());
            }
        }
        call(&app, "files.export", json!({"id":id,"path":path}))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Chooses the folder Tandem exports documents into.
#[tauri::command]
async fn pick_export_directory(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app.dialog().file().blocking_pick_folder() else {
            return Ok(Value::Null);
        };
        let path = folder.into_path().map_err(|e| e.to_string())?;
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        Ok(json!(canonical.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// The export location shown in settings before one has been chosen.
#[tauri::command]
async fn default_export_directory(app: tauri::AppHandle) -> Result<String, String> {
    Ok(export_directory(&app, None)?.to_string_lossy().into_owned())
}
#[tauri::command]
async fn link_file(
    app: tauri::AppHandle,
    grant: Option<String>,
    encoding: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = if let Some(ref token) = grant {
            let state = app.state::<Backend>();
            let grants = state.grants.lock().map_err(|e| e.to_string())?;
            grants
                .get(token)
                .filter(|(_, created)| created.elapsed() < Duration::from_secs(900))
                .map(|(path, _)| path.clone())
                .ok_or("File selection expired")?
        } else {
            let Some(file) = app
                .dialog()
                .file()
                .add_filter("Documents", &["md"])
                .blocking_pick_file()
            else {
                return Ok(Value::Null);
            };
            file.into_path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned()
        };
        let token = grant
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut params = json!({"path":path,"confirm":grant.is_some(),"importId":token});
        if let Some(encoding) = encoding {
            params["encoding"] = json!(encoding);
        }
        let mut result = call(&app, "files.link", params)?;
        if result["needsConfirmation"] == true || result["needsEncoding"] == true {
            app.state::<Backend>()
                .grants
                .lock()
                .map_err(|e| e.to_string())?
                .insert(token.clone(), (path, std::time::Instant::now()));
            result["grant"] = json!(token);
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn backup_library(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name("Tandem-library.zip")
            .add_filter("ZIP archive", &["zip"])
            .blocking_save_file()
        else {
            return Ok(Value::Null);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        call(&app, "files.backup", json!({"path":path}))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Reveals the Tandem-owned library directory so its files and folders can be inspected.
#[tauri::command]
async fn open_library_directory(app: tauri::AppHandle) -> Result<String, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.to_string_lossy().into_owned();
    open_directory(&root)?;
    Ok(path)
}
/// The bundle identifier ends in `.app`, so the data directory looks like an application
/// bundle to `open`. Naming the file manager opens it as the folder it is.
fn open_directory(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let launcher = Some("Finder");
    #[cfg(not(target_os = "macos"))]
    let launcher = None::<&str>;
    tauri_plugin_opener::open_path(path, launcher).map_err(|e| e.to_string())
}
#[tauri::command]
async fn open_setup(provider: String) -> Result<(), String> {
    let url = match provider.as_str() {
        "codex" => "https://developers.openai.com/codex/cli/",
        "claude" => "https://code.claude.com/docs/en/setup",
        _ => return Err("Unknown provider".into()),
    };
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}
fn checked_document_link(value: &str) -> Result<tauri::Url, String> {
    if value.len() > 8192 {
        return Err("This link is too long to open".into());
    }
    let url = tauri::Url::parse(value).map_err(|_| "Relative links are preserved in your document. Export the document to use its relative links.".to_string())?;
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return Err("Only web and email links can be opened".into());
    }
    Ok(url)
}
#[tauri::command]
async fn open_document_link(url: String) -> Result<(), String> {
    let checked = checked_document_link(&url)?;
    tauri_plugin_opener::open_url(checked.as_str(), None::<&str>).map_err(|e| e.to_string())
}
fn write_recovery(path: &std::path::Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Choose a recovery location")?;
    let temp = parent.join(format!(".tandem-recovery-{}", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}
#[tauri::command]
async fn save_recovery(
    app: tauri::AppHandle,
    name: String,
    content: String,
    journal: String,
) -> Result<Value, String> {
    if content.len() > 32 * 1024 * 1024 || journal.len() > 32 * 1024 * 1024 {
        return Err("Recovery copy exceeds 32 MB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let safe: String = name
            .replace(['/', '\\', ':'], "-")
            .chars()
            .take(120)
            .collect();
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(format!("{safe}-recovery.md"))
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
        else {
            return Ok(Value::Null);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        write_recovery(&path, &content)?;
        if !journal.is_empty() {
            let mut sidecar = path.as_os_str().to_owned();
            sidecar.push(".recovery.json");
            write_recovery(std::path::Path::new(&sidecar), &journal)?;
        }
        Ok(json!({"path":path}))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    let startup_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let startup_requests = requests_from_args(std::env::args().skip(1), &startup_cwd);
    let startup_grants = startup_requests
        .iter()
        .map(|request| {
            (
                request.id.clone(),
                (request.path.clone(), std::time::Instant::now()),
            )
        })
        .collect();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            enqueue_open_requests(
                app,
                requests_from_args(args.into_iter().skip(1), Path::new(&cwd)),
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .menu(|app| {
            let item = |id: &str, label: &str, key: &str| {
                MenuItemBuilder::with_id(id, label)
                    .accelerator(key)
                    .build(app)
            };
            let about = PredefinedMenuItem::about(
                app,
                Some("About Tandem"),
                Some(
                    AboutMetadataBuilder::new()
                        .name(Some("Tandem"))
                        .version(Some(app.package_info().version.to_string()))
                        // Without an explicit icon the panel shows the appearance-driven app icon.
                        .build(),
                ),
            )?;
            let app_menu = SubmenuBuilder::new(app, "Tandem")
                .item(&about)
                .separator()
                .item(&item("settings", "Settings…", "CmdOrCtrl+,")?)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&item("quit", "Quit Tandem", "CmdOrCtrl+Q")?)
                .build()?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&item("new", "New document", "CmdOrCtrl+N")?)
                .item(&item("import", "Import…", "CmdOrCtrl+O")?)
                .item(&item("export", "Export…", "CmdOrCtrl+Shift+E")?)
                .separator()
                .item(&item("save", "Save", "CmdOrCtrl+S")?)
                .item(&item("close", "Close pane", "CmdOrCtrl+W")?)
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&item("undo", "Undo", "CmdOrCtrl+Z")?)
                .item(&item("redo", "Redo", "CmdOrCtrl+Shift+Z")?)
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&item("find", "Find…", "CmdOrCtrl+F")?)
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&item("split-right", "Split right", "CmdOrCtrl+D")?)
                .item(&item("split-down", "Split down", "CmdOrCtrl+Shift+D")?)
                .build()?;
            let review_menu = SubmenuBuilder::new(app, "Review")
                .item(&item("review", "Annotate", "CmdOrCtrl+Shift+Enter")?)
                .build()?;
            MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &review_menu])
                .build()
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("tandem-menu", event.id().as_ref());
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(Backend {
            helper: Mutex::new(None),
            grants: Mutex::new(startup_grants),
            open_requests: Mutex::new(startup_requests.into()),
        })
        .invoke_handler(tauri::generate_handler![
            rpc,
            drain_open_requests,
            open_import_request,
            pick_import_folder,
            import_file,
            export_file,
            pick_export_directory,
            default_export_directory,
            link_file,
            backup_library,
            open_library_directory,
            save_recovery,
            open_setup,
            open_document_link,
            set_app_icon
        ])
        .build(tauri::generate_context!())
        .expect("Could not launch Tandem")
        .run(|app, event| {
            // Restore the last chosen appearance before the renderer loads its preferences.
            if let tauri::RunEvent::Ready = event {
                if let Some(theme) = appearance_file(app).and_then(|p| std::fs::read_to_string(p).ok()) {
                    apply_app_icon(theme.trim());
                }
            }
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                enqueue_open_requests(
                    app,
                    requests_from_args(urls.iter().map(ToString::to_string), &cwd),
                );
            }
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                if app.get_webview_window("main").is_some() {
                    api.prevent_exit();
                    let _ = app.emit("tandem-menu", "quit");
                }
            }
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut helper) = app.state::<Backend>().helper.lock() {
                    if let Some(h) = helper.take() {
                        let Helper {
                            mut child, input, ..
                        } = h;
                        drop(input);
                        for _ in 0..40 {
                            if matches!(child.try_wait(), Ok(Some(_))) {
                                return;
                            }
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_open_requests_accept_markdown_urls_relative_paths_and_folders() {
        let root =
            std::env::temp_dir().join(format!("tandem-native-open-test-{}", uuid::Uuid::new_v4()));
        let folder = root.join("Notes");
        let markdown = root.join("Read me.md");
        let ignored = root.join("Read me.txt");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(&markdown, "# Note").unwrap();
        std::fs::write(&ignored, "Note").unwrap();
        let file_url = tauri::Url::from_file_path(&markdown).unwrap().to_string();
        let requests = requests_from_args(
            [
                "Read me.md".into(),
                file_url,
                folder.to_string_lossy().into_owned(),
                ignored.to_string_lossy().into_owned(),
                "https://example.com/note.md".into(),
            ],
            &root,
        );
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].kind, OpenRequestKind::Document);
        assert_eq!(
            requests[0].path,
            markdown.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(requests[1].kind, OpenRequestKind::Folder);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn queued_open_requests_are_deduplicated_until_drained() {
        let request = OpenRequest {
            id: "first".into(),
            path: "/tmp/Note.md".into(),
            kind: OpenRequestKind::Document,
        };
        let duplicate = OpenRequest {
            id: "second".into(),
            ..request.clone()
        };
        let mut queue = VecDeque::new();
        let added = queue_open_requests(&mut queue, vec![request.clone(), duplicate.clone()]);
        assert_eq!(added, vec![duplicate.clone()]);
        assert_eq!(queue.drain(..).collect::<Vec<_>>(), vec![duplicate]);
        assert_eq!(
            queue_open_requests(&mut queue, vec![request.clone()]),
            vec![request]
        );
    }

    #[test]
    fn bundle_registers_markdown_as_an_editable_file_association() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["bundle"]["fileAssociations"][0]["ext"],
            json!(["md"])
        );
        assert_eq!(
            config["bundle"]["fileAssociations"][0]["mimeType"],
            "text/markdown"
        );
        assert_eq!(config["bundle"]["fileAssociations"][0]["role"], "Editor");
    }

    #[test]
    fn renderer_bridge_rejects_unknown_methods_paths_and_oversized_frames() {
        assert!(validate_renderer_request("documents.open", &json!({"id":"doc"})).is_ok());
        for method in [
            "shell.exec",
            "files.import",
            "files.open",
            "assets.import",
            "unknown",
        ] {
            assert!(validate_renderer_request(method, &json!({})).is_err());
        }
        assert!(validate_renderer_request("documents.open", &json!([])).is_err());
        assert!(validate_renderer_request(
            "documents.open",
            &json!({"id":"x".repeat(32*1024*1024)})
        )
        .is_err());
    }
    #[test]
    fn document_links_only_open_web_and_email_destinations() {
        for link in [
            "https://example.com/guide",
            "http://example.com",
            "mailto:user@example.com",
        ] {
            assert!(checked_document_link(link).is_ok());
        }
        for link in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tandem://quit",
            "./guide.md",
            "data:text/html,test",
        ] {
            assert!(checked_document_link(link).is_err());
        }
    }
    #[test]
    fn recovery_replaces_a_selected_file_with_utf8_content() {
        let path =
            std::env::temp_dir().join(format!("tandem-recovery-test-{}.md", uuid::Uuid::new_v4()));
        std::fs::write(&path, "old").unwrap();
        write_recovery(&path, "café 日本語 🌱").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "café 日本語 🌱");
    }
    #[test]
    fn a_long_request_does_not_delay_an_edit() {
        // Deliberately slow startup must not consume the edit-latency budget.
        let fixture = r#"
            setTimeout(() => {
                require('readline').createInterface({input: process.stdin}).on('line', line => {
                    const p = JSON.parse(line);
                    if (p.method === 'slow') console.log(JSON.stringify({started: true}));
                    setTimeout(() => console.log(JSON.stringify({id: p.id, result: p.method})),
                        p.method === 'slow' ? 1000 : 0);
                });
            }, 700);
        "#;
        let mut child = Command::new("node")
            .args(["-e", fixture])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
        let map = replies.clone();
        let (started_tx, started_rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                let v: Value = serde_json::from_str(&line).unwrap();
                if v["started"] == true {
                    let _ = started_tx.send(());
                    continue;
                }
                let id = v["id"].as_str().unwrap().to_owned();
                if let Some(tx) = map.lock().unwrap().remove(&id) {
                    let _ = tx.send(v);
                }
            }
        });
        let helper = Arc::new(Mutex::new(Some(Helper {
            child,
            input,
            replies,
        })));
        let other = helper.clone();
        let slow = std::thread::spawn(move || {
            request(&other, || unreachable!(), "slow", json!({})).unwrap()
        });
        started_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("The helper did not start the slow request");
        let began = std::time::Instant::now();
        let quick = request(&helper, || unreachable!(), "edit", json!({})).unwrap();
        let elapsed = began.elapsed();
        slow.join().unwrap();
        let mut lock = helper.lock().unwrap();
        let h = lock.as_mut().unwrap();
        let _ = h.child.kill();
        let _ = h.child.wait();
        assert_eq!(quick, json!("edit"));
        assert!(
            elapsed < Duration::from_millis(300),
            "An edit waited behind a long request: {:?}",
            elapsed
        );
    }
}
