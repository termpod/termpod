mod local_server;

use std::ffi::CStr;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

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
