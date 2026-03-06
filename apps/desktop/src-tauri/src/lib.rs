mod local_server;

use std::ffi::CStr;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            get_home_dir,
            get_pid_cwd,
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

            let find = MenuItemBuilder::with_id("find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(app)?;

            let settings = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
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
                .build()?;

            let mut session_menu = SubmenuBuilder::new(app, "Session")
                .item(&new_tab)
                .item(&close_tab)
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
                    .separator()
                    .quit()
                    .build()?)
                .item(&edit_menu)
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
