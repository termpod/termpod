mod local_server;
mod pty;

use std::ffi::CStr;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
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
fn check_full_disk_access() -> bool {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let tcc_path = format!("{home}/Library/Application Support/com.apple.TCC/TCC.db");
    std::fs::metadata(&tcc_path).is_ok()
}

#[tauri::command]
fn copy_to_clipboard(text: String) {
    use std::io::Write;
    if let Ok(mut child) = std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
    }
}

#[tauri::command]
fn open_url(url: String) {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return;
    }

    let _ = std::process::Command::new("open").arg(&url).spawn();
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    // Read file as bytes first to handle non-UTF-8 content (e.g., shell history with binary data)
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| e.to_string())?;
    
    // Convert to string lossily, replacing invalid UTF-8 sequences with replacement character
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
async fn list_directory_entries(path: String) -> Result<Vec<String>, String> {
    let mut reader = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| e.to_string())?;

    let mut entries: Vec<String> = Vec::new();

    while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
        let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        if name.is_empty() || name == "." || name == ".." {
            continue;
        }

        if file_type.is_dir() {
            entries.push(format!("{name}/"));
        } else if file_type.is_file() {
            entries.push(name);
        }
    }

    entries.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(entries)
}

/// Positions the macOS traffic light buttons (close, minimize, zoom) at the given coordinates.
/// The config-based `trafficLightPosition` is unreliable in release builds, so we set it
/// programmatically via the NSWindow API and re-apply on window events that can reset it.
#[cfg(target_os = "macos")]
fn position_traffic_lights_raw(ns_window_ptr: *mut std::ffi::c_void, x: f64, y: f64) {
    use objc2_app_kit::NSWindowButton;
    use objc2_foundation::NSPoint;

    let ns_window = ns_window_ptr as *mut objc2_app_kit::NSWindow;

    let buttons = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    unsafe {
        for (i, button_type) in buttons.iter().enumerate() {
            let button = (*ns_window).standardWindowButton(*button_type);
            if let Some(button) = button {
                let origin = NSPoint::new(x + (i as f64 * 20.0), y);
                button.setFrameOrigin(origin);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_home_dir,
            get_pid_cwd,
            get_foreground_process,
            get_shell_children,
            check_full_disk_access,
            copy_to_clipboard,
            open_url,
            read_file,
            list_directory_entries,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_read,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_exitstatus,
            local_server::start_local_server,
            local_server::stop_local_server,
            local_server::get_local_auth_secret,
            local_server::local_server_broadcast,
            local_server::local_server_broadcast_raw,
            local_server::local_server_send_control,
            local_server::local_server_send_to_client,
            local_server::update_local_sessions,
        ])
        .manage(pty::PtyState::default())
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

            let rename_tab = MenuItemBuilder::with_id("rename_tab", "Rename Tab\u{2026}")
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

            let termify = MenuItemBuilder::with_id("termify", "Termify Session")
                .accelerator("CmdOrCtrl+Shift+I")
                .build(app)?;

            let share_session = MenuItemBuilder::with_id("share_session", "Share Session\u{2026}")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;

            let record_session = MenuItemBuilder::with_id("record_session", "Record Session")
                .accelerator("CmdOrCtrl+Shift+R")
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

            let workflows = MenuItemBuilder::with_id("workflows", "Workflows...")
                .accelerator("CmdOrCtrl+Shift+W")
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

            let themes: Vec<(&str, &str)> = vec![
                ("tokyo-night", "Tokyo Night"),
                ("dracula", "Dracula"),
                ("catppuccin-mocha", "Catppuccin Mocha"),
                ("github-dark", "GitHub Dark"),
                ("one-dark", "One Dark"),
                ("solarized-dark", "Solarized Dark"),
                ("nord", "Nord"),
                ("gruvbox-dark", "Gruvbox Dark"),
                ("cobalt2", "Cobalt2"),
                ("synthwave-84", "Synthwave '84"),
                ("ayu-dark", "Ayu Dark"),
                ("night-owl", "Night Owl"),
                ("rose-pine", "Rose Pine"),
                ("kanagawa", "Kanagawa"),
                ("everforest-dark", "Everforest Dark"),
                ("poimandres", "Poimandres"),
                ("vesper", "Vesper"),
                ("material-ocean", "Material Ocean"),
                ("aura", "Aura"),
                ("moonlight", "Moonlight"),
                ("github-light", "GitHub Light"),
                ("catppuccin-latte", "Catppuccin Latte"),
                ("solarized-light", "Solarized Light"),
                ("one-light", "One Light"),
                ("rose-pine-dawn", "Rose Pine Dawn"),
                ("ayu-light", "Ayu Light"),
                ("night-owl-light", "Night Owl Light"),
                ("everforest-light", "Everforest Light"),
                ("catppuccin-frappe", "Catppuccin Frappe"),
                ("tokyo-night-light", "Tokyo Night Light"),
                ("kanagawa-lotus", "Kanagawa Lotus"),
                ("gruvbox-light", "Gruvbox Light"),
                ("poimandres-light", "Poimandres Light"),
                ("moonlight-light", "Moonlight Light"),
                ("paper", "Paper"),
                ("winter-light", "Winter Light"),
                ("horizon-light", "Horizon Light"),
                ("vitesse-light", "Vitesse Light"),
            ];

            let mut theme_submenu = SubmenuBuilder::new(app, "Theme");
            for (id, label) in &themes {
                let item = CheckMenuItemBuilder::with_id(format!("theme_{id}"), *label)
                    .build(app)?;
                theme_submenu = theme_submenu.item(&item);
            }
            let theme_submenu = theme_submenu.build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&zoom_in)
                .item(&zoom_out)
                .item(&zoom_reset)
                .separator()
                .item(&theme_submenu)
                .build()?;

            let mut session_menu = SubmenuBuilder::new(app, "Session")
                .item(&new_tab)
                .item(&duplicate_tab)
                .item(&rename_tab)
                .item(&close_tab)
                .item(&close_other_tabs)
                .separator()
                .item(&workflows)
                .item(&termify)
                .item(&share_session)
                .item(&record_session)
                .separator()
                .item(&next_tab)
                .item(&prev_tab)
                .separator();

            for item in &tab_items {
                session_menu = session_menu.item(item);
            }

            let session_menu = session_menu.build()?;

            let minimize = MenuItemBuilder::with_id("minimize", "Minimize")
                .accelerator("CmdOrCtrl+M")
                .build(app)?;
            let zoom_window = MenuItemBuilder::with_id("zoom_window", "Zoom")
                .build(app)?;
            let bring_all_to_front = MenuItemBuilder::with_id("bring_all_to_front", "Bring All to Front")
                .build(app)?;
            let toggle_fullscreen = MenuItemBuilder::with_id("toggle_fullscreen", "Toggle Full Screen")
                .accelerator("Ctrl+CmdOrCtrl+F")
                .build(app)?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .item(&minimize)
                .item(&zoom_window)
                .separator()
                .item(&bring_all_to_front)
                .separator()
                .item(&toggle_fullscreen)
                .build()?;

            let termpod_help = MenuItemBuilder::with_id("termpod_help", "TermPod Help")
                .build(app)?;
            let report_issue = MenuItemBuilder::with_id("report_issue", "Report an Issue\u{2026}")
                .build(app)?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&termpod_help)
                .item(&report_issue)
                .build()?;

            let check_updates = MenuItemBuilder::with_id("check_updates", "Check for Updates\u{2026}")
                .build(app)?;

            let about = MenuItemBuilder::with_id("about", "About TermPod")
                .build(app)?;

            #[allow(unused_mut)]
            let mut menu_builder = MenuBuilder::new(app)
                .item(&SubmenuBuilder::new(app, "TermPod")
                    .item(&about)
                    .separator()
                    .item(&check_updates)
                    .separator()
                    .item(&settings)
                    .item(&keybindings)
                    .separator()
                    .item(&command_palette)
                    .separator()
                    .item(&PredefinedMenuItem::quit(app, Some("Quit TermPod"))?)
                    .build()?)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&session_menu)
                .item(&window_menu);

            #[cfg(debug_assertions)]
            {
                let toggle_inspector = MenuItemBuilder::with_id("toggle_inspector", "Toggle Web Inspector")
                    .accelerator("CmdOrCtrl+Alt+I")
                    .build(app)?;

                let develop_menu = SubmenuBuilder::new(app, "Develop")
                    .item(&toggle_inspector)
                    .build()?;

                menu_builder = menu_builder.item(&develop_menu);
            }

            let menu = menu_builder.item(&help_menu).build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();

                #[cfg(debug_assertions)]
                if id == "toggle_inspector" {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if window.is_devtools_open() {
                            window.close_devtools();
                        } else {
                            window.open_devtools();
                        }
                    }
                    return;
                }

                match id {
                    "minimize" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.minimize();
                        }
                        return;
                    }
                    "zoom_window" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.maximize();
                        }
                        return;
                    }
                    "bring_all_to_front" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.set_focus();
                        }
                        return;
                    }
                    "toggle_fullscreen" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let is_fullscreen = window.is_fullscreen().unwrap_or(false);
                            let _ = window.set_fullscreen(!is_fullscreen);
                        }
                        return;
                    }
                    _ => {}
                }

                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("menu-event", id);
                }
            });

            // Programmatically set traffic light position (config value alone is unreliable in release builds)
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(ns_window) = window.ns_window() {
                    position_traffic_lights_raw(ns_window, 16.0, 10.0);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Re-apply traffic light position on events that can reset it
                #[cfg(target_os = "macos")]
                WindowEvent::Resized(_) | WindowEvent::ThemeChanged(_) | WindowEvent::Focused(true) => {
                    if let Ok(ns_window) = window.ns_window() {
                        position_traffic_lights_raw(ns_window, 16.0, 10.0);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Reopen { .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("app-reopen", ());
                }
            }
        });
}
