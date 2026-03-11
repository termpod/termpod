use std::{
    collections::HashMap,
    ffi::OsString,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtyPair, PtySize};
use tauri::Manager;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct PtyState {
    next_id: AtomicU32,
    sessions: RwLock<HashMap<u32, Arc<PtySession>>>,
}

struct PtySession {
    pair: Mutex<PtyPair>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    child_killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Mutex<Box<dyn Write + Send>>,
    reader: Mutex<Box<dyn Read + Send>>,
}

/// Locate the shell-integration scripts directory.
/// In production: bundled in the app's Resources directory.
/// In development: relative to CARGO_MANIFEST_DIR (src-tauri/).
fn get_shell_integration_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let dir = resource_dir.join("shell-integration");

        if dir.is_dir() {
            return Some(dir);
        }
    }

    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("shell-integration");

    if dev_path.is_dir() {
        return Some(dev_path);
    }

    None
}

/// Inject shell integration env vars and modify args based on the shell type.
/// Uses the FinalTerm OSC 133 standard (same as Kitty, Ghostty, VS Code).
fn setup_shell_integration(
    cmd: &mut CommandBuilder,
    file: &str,
    args: &mut Vec<String>,
    app: &tauri::AppHandle,
) {
    let Some(dir) = get_shell_integration_dir(app) else {
        return;
    };

    let shell_name = std::path::Path::new(file)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    match shell_name {
        "zsh" => {
            let zsh_dir = dir.join("zsh");
            let orig_zdotdir = std::env::var("ZDOTDIR").unwrap_or_default();
            cmd.env("ZDOTDIR", zsh_dir.as_os_str());
            cmd.env("TERMPOD_ORIG_ZDOTDIR", OsString::from(orig_zdotdir));
        }

        "bash" => {
            let script = dir.join("bash").join("termpod.bash");
            args.clear();
            args.push("--init-file".into());
            args.push(script.to_string_lossy().to_string());
            args.push("-i".into());
            cmd.env("TERMPOD_BASH_LOGIN", "1");
        }

        "fish" => {
            let existing_xdg = std::env::var("XDG_DATA_DIRS")
                .unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
            cmd.env(
                "XDG_DATA_DIRS",
                OsString::from(format!("{}:{}", dir.display(), existing_xdg)),
            );
        }

        _ => {}
    }

    cmd.env("TERMPOD", "1");
}

#[tauri::command]
pub async fn pty_spawn(
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: HashMap<String, String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, PtyState>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&file);

    let mut effective_args = args;
    setup_shell_integration(&mut cmd, &file, &mut effective_args, &app);
    cmd.args(effective_args);

    if let Some(cwd) = cwd {
        cmd.cwd(OsString::from(cwd));
    }

    for (k, v) in &env {
        cmd.env(OsString::from(k), OsString::from(v));
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let child_killer = child.clone_killer();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    let session = Arc::new(PtySession {
        pair: Mutex::new(pair),
        child: Mutex::new(child),
        child_killer: Mutex::new(child_killer),
        writer: Mutex::new(writer),
        reader: Mutex::new(reader),
    });

    state.sessions.write().await.insert(id, session);

    Ok(id)
}

#[tauri::command]
pub async fn pty_write(
    pid: u32,
    data: String,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Invalid pid")?
        .clone();

    session
        .writer
        .lock()
        .map_err(|e| e.to_string())?
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn pty_read(
    pid: u32,
    state: tauri::State<'_, PtyState>,
) -> Result<Vec<u8>, String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Invalid pid")?
        .clone();

    // Use spawn_blocking so the blocking read doesn't starve the async runtime.
    // tokio's blocking thread pool can scale to 512 threads, unlike the worker
    // pool which is limited to CPU cores.
    tokio::task::spawn_blocking(move || {
        let mut guard = session.reader.lock().map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 4096];
        let n = guard.read(&mut buf).map_err(|e| e.to_string())?;

        if n == 0 {
            Err("EOF".to_string())
        } else {
            buf.truncate(n);
            Ok(buf)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pty_resize(
    pid: u32,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Invalid pid")?
        .clone();

    session
        .pair
        .lock()
        .map_err(|e| e.to_string())?
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn pty_kill(
    pid: u32,
    state: tauri::State<'_, PtyState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Invalid pid")?
        .clone();

    session
        .child_killer
        .lock()
        .map_err(|e| e.to_string())?
        .kill()
        .map_err(|e| e.to_string())?;

    state.sessions.write().await.remove(&pid);

    Ok(())
}

#[tauri::command]
pub async fn pty_exitstatus(
    pid: u32,
    state: tauri::State<'_, PtyState>,
) -> Result<u32, String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Invalid pid")?
        .clone();

    // Use spawn_blocking so child.wait() doesn't starve the async runtime
    tokio::task::spawn_blocking(move || {
        let mut guard = session.child.lock().map_err(|e| e.to_string())?;
        let status = guard.wait().map_err(|e| e.to_string())?;
        Ok(status.exit_code())
    })
    .await
    .map_err(|e| e.to_string())?
}
