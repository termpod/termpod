mod local_server;

use std::ffi::CStr;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

unsafe extern "C" {
    unsafe fn proc_listpids(r#type: u32, typeinfo: u32, buffer: *mut libc::c_void, buffersize: i32) -> i32;
    unsafe fn proc_name(pid: i32, buffer: *mut libc::c_void, buffersize: u32) -> i32;
    unsafe fn proc_pidpath(pid: i32, buffer: *mut libc::c_void, buffersize: u32) -> i32;
}

const PROC_PPID_ONLY: u32 = 6;

#[tauri::command]
fn get_home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

#[tauri::command]
fn get_pid_cwd(pid: u32) -> Option<String> {
    // Use macOS proc_pidinfo to get the cwd of a process
    let mut vnode_info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as i32;
    let ret = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut vnode_info as *mut _ as *mut _,
            size,
        )
    };

    if ret <= 0 {
        return None;
    }

    let path = unsafe { CStr::from_ptr(vnode_info.pvi_cdir.vip_path.as_ptr().cast()) };

    path.to_str().ok().map(|s| s.to_string())
}

/// Returns PIDs of all child processes of the given parent PID.
fn get_child_pids(parent: u32) -> Vec<i32> {
    let mut pids = vec![0i32; 256];
    let buf_size = (pids.len() * std::mem::size_of::<i32>()) as i32;

    let bytes = unsafe { proc_listpids(PROC_PPID_ONLY, parent, pids.as_mut_ptr().cast(), buf_size) };

    if bytes <= 0 {
        return vec![];
    }

    let count = bytes as usize / std::mem::size_of::<i32>();
    pids[..count].iter().copied().filter(|&p| p > 0).collect()
}

/// Segments to skip when extracting a process name from its executable path.
const SKIP_PATH_SEGMENTS: &[&str] = &[
    "versions", "bin", "lib", "libexec", "sbin", "share", "node_modules",
    ".bin", "dist", "build", "out", "target", "release", "debug",
    "externals", "current", "default", "stable", "latest",
];

fn is_meaningful_segment(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('.')
        && !s.chars().next().unwrap_or('0').is_ascii_digit()
        && !SKIP_PATH_SEGMENTS.contains(&s)
}

fn get_process_name(pid: i32) -> Option<String> {
    // First try proc_name (fast, but can be overwritten by the process)
    let mut name_buf = [0u8; 256];
    let ret = unsafe { proc_name(pid, name_buf.as_mut_ptr().cast(), 256) };

    if ret > 0 {
        if let Ok(name) = std::str::from_utf8(&name_buf[..ret as usize]) {
            if !name.is_empty() && !name.chars().next().unwrap_or('0').is_ascii_digit() {
                return Some(name.to_string());
            }
        }
    }

    // Fallback: use proc_pidpath to get the executable path and extract the name.
    // This handles cases where proc_name was overwritten (e.g. claude → "2.1.70").
    // Path example: "/Users/x/.local/share/claude/versions/2.1.70" → "claude"
    let mut path_buf = [0u8; 4096];
    let path_ret = unsafe { proc_pidpath(pid, path_buf.as_mut_ptr().cast(), 4096) };

    if path_ret > 0 {
        if let Ok(path) = std::str::from_utf8(&path_buf[..path_ret as usize]) {
            for segment in path.rsplit('/') {
                if is_meaningful_segment(segment) {
                    return Some(segment.to_string());
                }
            }
        }
    }

    None
}

/// Returns all shell PIDs that are direct children of this app process.
/// Used to discover the real OS PIDs of PTY-spawned shells.
#[tauri::command]
fn get_shell_children() -> Vec<u32> {
    let my_pid = std::process::id();
    get_child_pids(my_pid)
        .into_iter()
        .filter(|&pid| {
            get_process_name(pid)
                .map(|n| matches!(n.as_str(), "zsh" | "bash" | "fish" | "sh" | "nu" | "pwsh"))
                .unwrap_or(false)
        })
        .map(|p| p as u32)
        .collect()
}

#[tauri::command]
fn get_foreground_process(pid: u32) -> Option<String> {
    // Find the direct child of the shell PID — that's the user-launched command
    let children = get_child_pids(pid);
    let target_pid = *children.first()?;

    get_process_name(target_pid)
}

#[tauri::command]
fn open_url(url: String) {
    let _ = std::process::Command::new("open").arg(&url).spawn();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            get_home_dir,
            get_pid_cwd,
            get_foreground_process,
            get_shell_children,
            open_url,
            local_server::start_local_server,
            local_server::stop_local_server,
            local_server::local_server_broadcast,
            local_server::local_server_send_control,
            local_server::local_server_send_to_client,
        ])
        .setup(|app| {
            let new_tab = MenuItemBuilder::with_id("new_tab", "New Tab")
                .accelerator("CmdOrCtrl+T")
                .build(app)?;
            let close_tab = MenuItemBuilder::with_id("close_tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;
            let next_tab = MenuItemBuilder::with_id("next_tab", "Next Tab")
                .accelerator("CmdOrCtrl+Shift+]")
                .build(app)?;
            let prev_tab = MenuItemBuilder::with_id("prev_tab", "Previous Tab")
                .accelerator("CmdOrCtrl+Shift+[")
                .build(app)?;

            let mut tab_items: Vec<tauri::menu::MenuItem<tauri::Wry>> = Vec::new();
            for i in 1..=9u8 {
                let item = MenuItemBuilder::with_id(
                    format!("tab_{i}"),
                    format!("Tab {i}"),
                )
                .accelerator(format!("CmdOrCtrl+{i}"))
                .build(app)?;
                tab_items.push(item);
            }

            let duplicate_tab = MenuItemBuilder::with_id("duplicate_tab", "Duplicate Tab")
                .accelerator("CmdOrCtrl+Shift+T")
                .build(app)?;

            let close_other_tabs = MenuItemBuilder::with_id("close_other_tabs", "Close Other Tabs")
                .accelerator("CmdOrCtrl+Alt+W")
                .build(app)?;

            let clear = MenuItemBuilder::with_id("clear", "Clear Scrollback")
                .accelerator("CmdOrCtrl+K")
                .build(app)?;

            let clear_screen = MenuItemBuilder::with_id("clear_screen", "Clear Screen")
                .accelerator("CmdOrCtrl+L")
                .build(app)?;

            let find = MenuItemBuilder::with_id("find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(app)?;

            let find_next = MenuItemBuilder::with_id("find_next", "Find Next")
                .accelerator("CmdOrCtrl+G")
                .build(app)?;

            let find_prev = MenuItemBuilder::with_id("find_prev", "Find Previous")
                .accelerator("CmdOrCtrl+Shift+G")
                .build(app)?;

            let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;

            let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;

            let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Reset Zoom")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;

            let command_palette = MenuItemBuilder::with_id("command_palette", "Command Palette...")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?;

            let settings = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let keybindings = MenuItemBuilder::with_id("keybindings", "Keyboard Shortcuts...")
                .accelerator("CmdOrCtrl+Shift+,")
                .build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&find)
                .item(&find_next)
                .item(&find_prev)
                .separator()
                .item(&clear_screen)
                .item(&clear)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&zoom_in)
                .item(&zoom_out)
                .item(&zoom_reset)
                .build()?;

            let mut session_menu = SubmenuBuilder::new(app, "Session")
                .item(&new_tab)
                .item(&duplicate_tab)
                .item(&close_tab)
                .item(&close_other_tabs)
                .separator()
                .item(&next_tab)
                .item(&prev_tab)
                .separator();

            for item in &tab_items {
                session_menu = session_menu.item(item);
            }

            let session_menu = session_menu.build()?;

            let menu = MenuBuilder::new(app)
                .item(&SubmenuBuilder::new(app, "Termpod")
                    .about(None)
                    .separator()
                    .item(&settings)
                    .item(&keybindings)
                    .separator()
                    .item(&command_palette)
                    .separator()
                    .quit()
                    .build()?)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&session_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("menu-event", id);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Reopen { .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
