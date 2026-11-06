//! HomeCloud Storage transport. Control commands share each server's existing
//! WebSocket; bulk transfers use Go's dedicated /ws/storage channel.
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{fs::{self, File}, io::{AsyncReadExt, AsyncWriteExt}, sync::{mpsc, oneshot}};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(16);
const TRANSFER_CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const CHUNK: usize = 256 * 1024; // Go enforces <=1 MiB per binary message.

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

pub async fn request(app: &AppHandle, server_id: &str, action: &str, data: Value) -> Result<Value, String> {
    // Only explicitly implemented Storage Manager actions are exposed.
    if !matches!(action, "storage.list" | "storage.files.list" | "storage.register" |
       "storage.upload.prepare" | "storage.download.prepare" | "storage.transfer.cancel") {
        return Err("Неизвестная команда Storage Manager".into());
    }
    let channel = app.state::<StorageTransport>().channels.lock().unwrap_or_else(|e| e.into_inner())
        .get(server_id).cloned().ok_or("Сервер Offline: нет активной WebSocket-сессии")?;
    let (reply, rx) = oneshot::channel();
    channel.send(StorageRequest { action: action.to_owned(), data, reply }).await
        .map_err(|_| "Сессия сервера закрылась".to_owned())?;
    tokio::time::timeout(COMMAND_TIMEOUT, rx).await
        .map_err(|_| "Сервер не ответил на команду хранилища".to_owned())?
        .map_err(|_| "Соединение прервалось до ответа".to_owned())?
}

// The existing per-Backend command queue multiplexes Storage Manager and
// media-room control-plane commands over ONE identified WebSocket. Only the
// allowlisted actions below are reachable from the media_rooms module.
// Bulk HCM1 media bytes never pass through this queue.
pub async fn request_media(app: &AppHandle, server_id: &str, action: &str, data: Value) -> Result<Value, String> {
    if !matches!(action, "media.rooms.snapshot" | "media.room.control" |
        "media.rooms.seek" | "media.rooms.stop") {
        return Err("Неизвестная команда Media Room".into());
    }
    let channel = app.state::<StorageTransport>().channels.lock().unwrap_or_else(|e| e.into_inner())
        .get(server_id).cloned().ok_or("Сервер Offline: нет активной WebSocket-сессии")?;
    let (reply, rx) = oneshot::channel();
    channel.send(StorageRequest { action: action.to_owned(), data, reply }).await
        .map_err(|_| "Сессия сервера закрылась".to_owned())?;
    tokio::time::timeout(COMMAND_TIMEOUT, rx).await
        .map_err(|_| "Сервер не ответил на команду Media Room".to_owned())?
        .map_err(|_| "Соединение прервалось до ответа".to_owned())?
}

#[tauri::command]
pub async fn homecloud_storage_command(app: AppHandle, server_id: String, action: String, data: Value) -> Result<Value, String> {
    request(&app, &server_id, &action, data).await
}

#[derive(Serialize)]
pub struct LocalFileInfo { pub name: String, pub size_bytes: u64, pub mime_type: String }

#[tauri::command]
pub async fn homecloud_storage_local_file(file_path: String) -> Result<LocalFileInfo, String> {
    let p = Path::new(&file_path);
    let meta = fs::metadata(p).await.map_err(|e| format!("Файл: {e}"))?;
    if !meta.is_file() { return Err("Выбери обычный файл".into()); }
    let name = p.file_name().and_then(|v| v.to_str()).ok_or("Некорректное имя файла")?.to_owned();
    let mime_type = match p.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "pdf" => "application/pdf", "jpg" | "jpeg" => "image/jpeg", "png" => "image/png",
        "webp" => "image/webp", "mp4" => "video/mp4", "mp3" => "audio/mpeg",
        "txt" | "log" => "text/plain", "json" => "application/json", "zip" => "application/zip",
        _ => "application/octet-stream",
    }.to_owned();
    Ok(LocalFileInfo { name, size_bytes: meta.len(), mime_type })
}

#[derive(Clone, Deserialize)]
pub struct TransferInfo {
    transfer_id: String,
    role: String,
    size_bytes: u64,
}

#[derive(Serialize, Clone)]
struct TransferProgress<'a> {
    server_id: &'a str, transfer_id: &'a str, role: &'a str,
    completed_bytes: u64, total_bytes: u64,
}

fn emit_progress(app: &AppHandle, server_id: &str, info: &TransferInfo, completed: u64) {
    let _ = app.emit("homecloud:storage-progress", TransferProgress {
        server_id, transfer_id: &info.transfer_id, role: &info.role,
        completed_bytes: completed, total_bytes: info.size_bytes,
    });
}

fn storage_urls(app: &AppHandle, server_id: &str) -> Result<Vec<String>, String> {
    let server = app.state::<crate::server_pool::ServerPool>()
        .inner.lock().unwrap_or_else(|e| e.into_inner())
        .servers.iter().find(|s| s.entry.id == server_id).map(|s| s.entry.clone())
        .ok_or("Сервер отсутствует в пуле")?;
    Ok(crate::server_pool::addresses(&server).into_iter().map(|url| format!("{url}/storage")).collect())
}

async fn open_transfer(app: &AppHandle, server_id: &str) -> Result<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, String> {
    let urls = storage_urls(app, server_id)?;
    let mut last_error = "Не настроен адрес сервера".to_owned();
    for url in urls {
        match tokio::time::timeout(TRANSFER_CONNECT_TIMEOUT, connect_async(&url)).await {
            Ok(Ok((socket, _))) => return Ok(socket),
            Ok(Err(err)) => last_error = format!("{url}: {err}"),
            Err(_) => last_error = format!("{url}: тайм-аут подключения"),
        }
    }
    Err(last_error)
}

async fn read_text(socket: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>) -> Result<Value, String> {
    let received = tokio::time::timeout(Duration::from_secs(30), socket.next()).await
        .map_err(|_| "Тайм-аут ответа /ws/storage".to_owned())?
        .ok_or("Соединение передачи закрыто")?.map_err(|e| e.to_string())?;
    match received {
        Message::Text(text) => serde_json::from_str(text.as_str()).map_err(|e| format!("Неверный ответ хранилища: {e}")),
        _ => Err("Ожидался текстовый ответ /ws/storage".into()),
    }
}

#[tauri::command]
pub async fn homecloud_storage_transfer(app: AppHandle, server_id: String, role: String, transfer: TransferInfo, file_path: String) -> Result<Value, String> {
    if role != "upload" && role != "download" { return Err("Недопустимый тип передачи".into()); }
    if role != transfer.role { return Err("Тип передачи не совпадает с подготовленным запросом".into()); }
    if transfer.transfer_id.len() > 128 || transfer.transfer_id.is_empty() { return Err("Некорректный transfer_id".into()); }
    let path = PathBuf::from(file_path);
    // Validate BEFORE claiming one-time Go transfer token.
    if role == "upload" {
        let meta = fs::metadata(&path).await.map_err(|e| format!("Нельзя прочитать файл: {e}"))?;
        if !meta.is_file() || meta.len() != transfer.size_bytes { return Err("Размер выбранного файла изменился".into()); }
    } else if path.exists() {
        return Err("Файл назначения уже существует — выбери другое имя".into());
    }
    let mut socket = open_transfer(&app, &server_id).await?;
    let hello = json!({"v":1,"type":"storage.hello","transfer_id":transfer.transfer_id,
        "device_id":crate::device_registry::local_device_id(&app),"role":role});
    socket.send(Message::Text(hello.to_string().into())).await.map_err(|e| e.to_string())?;
    let ready = read_text(&mut socket).await?;
    if ready.get("type").and_then(Value::as_str) != Some("storage.ready") ||
       ready.get("transfer_id").and_then(Value::as_str) != Some(transfer.transfer_id.as_str()) {
        return Err(ready.get("error").and_then(Value::as_str).unwrap_or("Сервер отклонил передачу").to_owned());
    }
    if role == "upload" {
        let mut file = File::open(&path).await.map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        let mut transferred = 0u64;
        let mut chunk = vec![0u8; CHUNK];
        loop {
            let n = file.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 { break; }
            socket.send(Message::Binary(chunk[..n].to_vec().into())).await.map_err(|e| e.to_string())?;
            digest.update(&chunk[..n]);
            transferred += n as u64;
            emit_progress(&app, &server_id, &transfer, transferred);
        }
        if transferred != transfer.size_bytes { return Err("Размер файла изменился во время чтения".into()); }
        let sha = format!("{:x}", digest.finalize());
        socket.send(Message::Text(json!({"v":1,"type":"storage.end","sha256":sha}).to_string().into()))
            .await.map_err(|e| e.to_string())?;
        let reply = read_text(&mut socket).await?;
        if reply.get("type").and_then(Value::as_str) != Some("storage.complete") {
            return Err(reply.get("error").and_then(Value::as_str).unwrap_or("Ошибка завершения загрузки").to_owned());
        }
        Ok(reply)
    } else {
        // Write into an adjacent temporary file; incomplete downloads are never published.
        let partial = path.with_extension(format!("hcpart-{}", transfer.transfer_id));
        let mut file = File::create_new(&partial).await.map_err(|e| format!("Временный файл: {e}"))?;
        let result: Result<Value, String> = async {
            let mut digest = Sha256::new();
            let mut transferred = 0u64;
            loop {
                let msg = tokio::time::timeout(Duration::from_secs(120), socket.next()).await
                    .map_err(|_| "Тайм-аут передачи файла".to_owned())?
                    .ok_or("Сервер прервал загрузку")?.map_err(|e| e.to_string())?;
                match msg {
                    Message::Binary(bytes) => {
                        transferred += bytes.len() as u64;
                        if transferred > transfer.size_bytes { return Err("Передано больше заявленного размера".into()); }
                        digest.update(&bytes);
                        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
                        emit_progress(&app, &server_id, &transfer, transferred);
                    }
                    Message::Text(text) => {
                        let value: Value = serde_json::from_str(text.as_str()).map_err(|e| e.to_string())?;
                        if value.get("type").and_then(Value::as_str) != Some("storage.complete") {
                            return Err(value.get("error").and_then(Value::as_str).unwrap_or("Ошибка передачи файла").to_owned());
                        }
                        let received_hash = format!("{:x}", digest.finalize());
                        let expected_hash = value.get("sha256").and_then(Value::as_str).ok_or("Нет контрольной суммы")?;
                        if transferred != transfer.size_bytes || received_hash != expected_hash {
                            return Err("Несовпадение размера или SHA-256".into());
                        }
                        file.flush().await.map_err(|e| e.to_string())?;
                        file.sync_all().await.map_err(|e| e.to_string())?;
                        drop(file);
                        fs::rename(&partial, &path).await.map_err(|e| format!("Сохранение файла: {e}"))?;
                        return Ok(value);
                    }
                    Message::Close(_) => return Err("Сервер закрыл соединение до завершения".into()),
                    _ => {},
                }
            }
        }.await;
        if result.is_err() { let _ = fs::remove_file(&partial).await; }
        result
    }
}
