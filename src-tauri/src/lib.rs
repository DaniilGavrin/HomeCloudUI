mod homecloud_ws;
mod server_pool;
mod device_registry;
mod storage;
mod media_rooms;
mod media_source;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(homecloud_ws::ConnectionManager::default())
        .manage(storage::StorageTransport::default())
        .manage(media_rooms::MediaRooms::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            homecloud_ws::homecloud_connection_status,
            homecloud_ws::homecloud_devices_status,
            homecloud_ws::homecloud_devices_refresh,
            homecloud_ws::homecloud_server_status,
            homecloud_ws::homecloud_server_refresh,
            server_pool::homecloud_pool_status,
            server_pool::homecloud_pool_add,
            server_pool::homecloud_pool_update,
            server_pool::homecloud_pool_delete,
            server_pool::homecloud_pool_refresh,
            device_registry::homecloud_device_registry_status,
            device_registry::homecloud_device_forget,
            device_registry::homecloud_device_refresh,
            device_registry::homecloud_device_send,
            storage::homecloud_storage_command,
            media_rooms::homecloud_media_status,
            media_rooms::homecloud_media_refresh,
            media_rooms::homecloud_media_command,
            media_source::homecloud_hcss_sources,
            media_source::homecloud_hcss_browse,
            media_source::homecloud_hcss_play,
            storage::homecloud_storage_local_file,
            storage::homecloud_storage_transfer,
        ])
        .setup(|app| {
            server_pool::initialize(app.handle()).map_err(std::io::Error::other)?;
            device_registry::initialize(app.handle()).map_err(std::io::Error::other)?;
            homecloud_ws::start(app.handle().clone());
            server_pool::start_all(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
