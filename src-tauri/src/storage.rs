//! Identified Backend control-plane request transport shared by media rooms
//! and HC Storage Service. Large file/media bytes never use this WS channel.
use serde_json::Value;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, oneshot};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(16);

pub struct StorageRequest {
    pub action: String,
    pub data: Value,
    pub reply: oneshot::Sender<Result<Value, String>>,
}

#[derive(Default)]
pub struct StorageTransport {
    channels: Mutex<HashMap<String, mpsc::Sender<StorageRequest>>>,
}

pub fn connected(app: &AppHandle, server_id: &str, channel: mpsc::Sender<StorageRequest>) {
    app.state::<StorageTransport>().channels.lock().unwrap_or_else(|e| e.into_inner())
        .insert(server_id.to_owned(), channel);
}

pub fn disconnected(app: &AppHandle, server_id: &str) {
    app.state::<StorageTransport>().channels.lock().unwrap_or_else(|e| e.into_inner()).remove(server_id);
}

pub fn disconnect_if_same(app: &AppHandle, server_id: &str, channel: &mpsc::Sender<StorageRequest>) {
    let state = app.state::<StorageTransport>();
    let mut channels = state.channels.lock().unwrap_or_else(|e| e.into_inner());
    if channels.get(server_id).is_some_and(|old| old.same_channel(channel)) {
        channels.remove(server_id);
    }
}

/// Explicit control-plane allowlist. The legacy Backend Storage Manager commands
/// and its /ws/storage bulk-transfer endpoint are intentionally not exposed.
pub async fn request_media(app: &AppHandle, server_id: &str, action: &str, data: Value) -> Result<Value, String> {
    if !matches!(action,
        "media.rooms.snapshot" | "media.room.control" |
        "media.rooms.seek" | "media.rooms.stop" | "media.rooms.play" |
        "storage.agent.status" | "storage.fs.list" | "cluster.status"
    ) {
        return Err("Команда не разрешена для HC SS или Media Room".into());
    }
    let channel = app.state::<StorageTransport>().channels.lock().unwrap_or_else(|e| e.into_inner())
        .get(server_id).cloned().ok_or("Backend Offline: нет активной WebSocket-сессии")?;
    let (reply, rx) = oneshot::channel();
    channel.send(StorageRequest { action: action.to_owned(), data, reply }).await
        .map_err(|_| "Сессия Backend закрылась".to_owned())?;
    tokio::time::timeout(COMMAND_TIMEOUT, rx).await
        .map_err(|_| "Backend не ответил на команду HC SS / Media Room".to_owned())?
        .map_err(|_| "Соединение прервалось до ответа".to_owned())?
}
