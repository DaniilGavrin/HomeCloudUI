//! HomeCloud's single control WebSocket: heartbeat, device catalogue and events.
//! Rust owns the transport. React uses Tauri events and read-only state snapshots.

use futures_util::{Sink, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const DEFAULT_WS_URL: &str = "ws://127.0.0.1:8080/ws";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
const RECONNECT_DELAY: Duration = Duration::from_secs(5);
const PING_INTERVAL: Duration = Duration::from_secs(1);
const PONG_TIMEOUT: Duration = Duration::from_secs(3);
const LIST_TIMEOUT: Duration = Duration::from_secs(8);
const DEVICE_RESYNC_INTERVAL: Duration = Duration::from_secs(30);
const SERVER_RESYNC_INTERVAL: Duration = Duration::from_secs(15);
const SERVER_TIMEOUT: Duration = Duration::from_secs(8);
const STATUS_EVENT: &str = "homecloud:connection-status";
const DEVICES_EVENT: &str = "homecloud:devices-updated";
const SERVER_EVENT: &str = "homecloud:server-status";

#[derive(Clone, Serialize)]
pub struct ConnectionStatus {
    pub phase: String,
    pub latency_ms: Option<u64>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectedDevice {
    pub device_id: String,
    pub client_type: String,
}

#[derive(Clone, Serialize)]
pub struct DeviceSnapshot {
    // "offline", "loading", "ready", "error"
    pub phase: String,
    pub devices: Vec<ConnectedDevice>,
    pub error: Option<String>,
    pub revision: u64,
}

#[derive(Clone, Serialize)]
pub struct ServerSnapshot {
    // offline / loading / ready / error. Data is the exact system.status payload.
    pub phase: String,
    pub data: Option<Value>,
    pub error: Option<String>,
    pub revision: u64,
}

pub struct DeviceDelivery {
    pub device_id: String,
    pub payload: Value,
    pub reply: oneshot::Sender<Result<String, String>>,
}

pub struct ConnectionManager {
    status: Mutex<ConnectionStatus>,
    devices: Mutex<DeviceSnapshot>,
    refresh: Mutex<Option<mpsc::Sender<()>>>,
    server: Mutex<ServerSnapshot>,
    server_refresh: Mutex<Option<mpsc::Sender<()>>>,
    delivery: Mutex<Option<mpsc::Sender<DeviceDelivery>>>,

}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self {
            status: Mutex::new(ConnectionStatus {
                phase: "connecting".to_owned(),
                latency_ms: None,
                revision: 0,
            }),
            devices: Mutex::new(DeviceSnapshot {
                phase: "offline".to_owned(),
                devices: Vec::new(),
                error: None,
                revision: 0,
            }),
            refresh: Mutex::new(None),
            server: Mutex::new(ServerSnapshot {
                phase: "offline".to_owned(),
                data: None,
                error: None,
                revision: 0,
            }),
            server_refresh: Mutex::new(None),
            delivery: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn homecloud_connection_status(manager: State<'_, ConnectionManager>) -> ConnectionStatus {
    manager.status.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn homecloud_devices_status(manager: State<'_, ConnectionManager>) -> DeviceSnapshot {
    manager.devices.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn homecloud_devices_refresh(manager: State<'_, ConnectionManager>) -> Result<(), String> {
    let channel = manager.refresh.lock().unwrap_or_else(|e| e.into_inner()).clone();
    channel
        .ok_or_else(|| "Нет соединения с HomeCloudBackend".to_owned())?
        .try_send(())
        .map_err(|error| format!("Не удалось запросить список устройств: {error}"))
}

pub fn refresh_devices(manager: &ConnectionManager) -> Result<(), String> {
    let channel = manager.refresh.lock().unwrap_or_else(|e| e.into_inner()).clone();
    channel.ok_or("Нет подключения к основному серверу")?
        .try_send(()).map_err(|e| e.to_string())
}

pub async fn send_to_device(app: &AppHandle, device_id: String, payload: Value) -> Result<String, String> {
    let sender = app.state::<ConnectionManager>().delivery.lock().unwrap_or_else(|e| e.into_inner()).clone()
        .ok_or("Нет подключения к основному серверу")?;
    let (reply, receive) = oneshot::channel();
    sender.send(DeviceDelivery { device_id, payload, reply }).await.map_err(|_| "Соединение было закрыто")?;
    tokio::time::timeout(Duration::from_secs(10), receive).await
        .map_err(|_| "Тайм-аут подтверждения отправки")?
        .map_err(|_| "Соединение прервалось до подтверждения")?
}

#[tauri::command]
pub fn homecloud_server_status(manager: State<'_, ConnectionManager>) -> ServerSnapshot {
    manager.server.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn homecloud_server_refresh(manager: State<'_, ConnectionManager>) -> Result<(), String> {
    let channel = manager.server_refresh.lock().unwrap_or_else(|e| e.into_inner()).clone();
    channel
        .ok_or_else(|| "Нет соединения с HomeCloudBackend".to_owned())?
        .try_send(())
        .map_err(|error| format!("Не удалось обновить сведения о сервере: {error}"))
}

// A server is a known infrastructure node, not an ephemeral WebSocket client.
// Keep its last successful system.status snapshot when the connection drops or
// during reconnection. Device snapshots have separate, intentionally ephemeral
// semantics and continue to be cleared on disconnect.
fn apply_server_update(state: &mut ServerSnapshot, phase: &str, data: Option<Value>, error: Option<String>) {
    state.phase = phase.to_owned();
    if let Some(fresh_data) = data {
        state.data = Some(fresh_data);
    }
    state.error = error;
    state.revision += 1;
}

fn publish_server(app: &AppHandle, phase: &str, data: Option<Value>, error: Option<String>) {
    let snapshot = {
        let manager = app.state::<ConnectionManager>();
        let mut state = manager.server.lock().unwrap_or_else(|e| e.into_inner());
        apply_server_update(&mut state, phase, data, error);
        state.clone()
    };
    if let Err(error) = app.emit(SERVER_EVENT, snapshot) {
        eprintln!("[HomeCloud WS] Failed to emit server status: {error}");
    }
}

async fn send_system_status<S>(socket: &mut S, counter: &mut u64) -> Result<String, String>
where
    S: Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    *counter = counter.wrapping_add(1);
    let id = format!("homecloud-server-status-{}", *counter);
    let request = json!({"v":1,"id":id,"type":"command","action":"system.status"});
    tokio::time::timeout(PONG_TIMEOUT, socket.send(Message::Text(request.to_string().into())))
        .await
        .map_err(|_| "system.status write timed out".to_owned())?
        .map_err(|e| format!("system.status write failed: {e}"))?;
    Ok(id)
}

fn publish_status(app: &AppHandle, phase: &str, latency_ms: Option<u64>) {
    let current = {
        let manager = app.state::<ConnectionManager>();
        let mut state = manager.status.lock().unwrap_or_else(|e| e.into_inner());
        state.phase = phase.to_owned();
        state.latency_ms = latency_ms;
        state.revision += 1;
        state.clone()
    };
    if let Err(error) = app.emit(STATUS_EVENT, current) {
        eprintln!("[HomeCloud WS] Failed to emit status: {error}");
    }
}

fn publish_devices(app: &AppHandle, phase: &str, mut devices: Vec<ConnectedDevice>, error: Option<String>) {
    devices.sort_by(|a, b| a.device_id.cmp(&b.device_id));
    devices.dedup_by(|a, b| a.device_id == b.device_id);
    let snapshot = {
        let manager = app.state::<ConnectionManager>();
        let mut state = manager.devices.lock().unwrap_or_else(|e| e.into_inner());
        state.phase = phase.to_owned();
        state.devices = devices;
        state.error = error;
        state.revision += 1;
        state.clone()
    };
    if phase == "ready" {
        let active: Vec<(String, String)> = snapshot.devices.iter()
            .map(|d| (d.device_id.clone(), d.client_type.clone())).collect();
        crate::device_registry::reconcile(app, "primary", &active);
    } else if phase == "offline" {
        crate::device_registry::disconnected(app, "primary");
    }
    if let Err(error) = app.emit(DEVICES_EVENT, snapshot) {
        eprintln!("[HomeCloud WS] Failed to emit devices: {error}");
    }
}

fn apply_device_change(devices: &mut Vec<ConnectedDevice>, connected: bool, device: ConnectedDevice) {
    devices.retain(|item| item.device_id != device.device_id);
    if connected {
        devices.push(device);
    }
}

pub(crate) fn parse_device_event(message: &Value) -> Option<(bool, ConnectedDevice)> {
    if message.get("type")?.as_str()? != "event" {
        return None;
    }
    let connected = match message.get("topic")?.as_str()? {
        "clients.connected" => true,
        "clients.disconnected" => false,
        _ => return None,
    };
    let device = serde_json::from_value::<ConnectedDevice>(message.pointer("/data/payload")?.clone()).ok()?;
    if device.device_id.is_empty() {
        return None;
    }
    Some((connected, device))
}

async fn send_device_list<S>(socket: &mut S, request_counter: &mut u64) -> Result<String, String>
where
    S: Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    *request_counter = request_counter.wrapping_add(1);
    let id = format!("homecloud-devices-list-{}", *request_counter);
    let request = json!({ "v": 1, "id": id, "type": "command", "action": "clients.list" });
    tokio::time::timeout(PONG_TIMEOUT, socket.send(Message::Text(request.to_string().into())))
        .await
        .map_err(|_| "clients.list write timed out".to_owned())?
        .map_err(|e| format!("clients.list write failed: {e}"))?;
    Ok(id)
}

fn is_matching_pong(message: &Value, id: &str) -> bool {
    message.get("v").and_then(Value::as_i64) == Some(1)
        && message.get("type").and_then(Value::as_str) == Some("pong")
        && message.get("id").and_then(Value::as_str) == Some(id)
}

/// Starts once during Tauri setup. No React component creates a WebSocket.
pub fn reset_primary_server(app: &AppHandle) {
    let snapshot = {
        let manager = app.state::<ConnectionManager>();
        let mut state = manager.server.lock().unwrap_or_else(|e| e.into_inner());
        state.phase = "offline".to_owned();
        state.data = None; // A different IP must not inherit another server's metrics.
        state.error = None;
        state.revision += 1;
        state.clone()
    };
    let _ = app.emit(SERVER_EVENT, snapshot);
}

pub fn start(app: AppHandle) {
    let device_id = crate::device_registry::local_device_id(&app);
    let mut changed = crate::server_pool::primary_updates(&app);

    tauri::async_runtime::spawn(async move {
        loop {
            publish_status(&app, "connecting", None);
            let server = crate::server_pool::primary(&app);
            let endpoints = crate::server_pool::addresses(&server);
            let mut changed_config = false;
            for url in endpoints {
                println!("[HomeCloud WS] Connecting to {url} ...");
                tokio::select! {
                    result = connect_and_listen(&app, &url, &device_id) => {
                        if let Err(error) = result { eprintln!("[HomeCloud WS] Disconnected: {error}"); }
                        // The next IPv4/IPv6 attempt is a NEW session. Never keep
                        // clients from a dead session marked Online during failover.
                        crate::storage::disconnected(&app, "primary");
                        *app.state::<ConnectionManager>().delivery.lock().unwrap_or_else(|e| e.into_inner()) = None;
                        publish_devices(&app, "offline", Vec::new(), None);
                        publish_status(&app, "offline", None);
                    }
                    _ = changed.changed() => {
                        println!("[HomeCloud WS] Primary address changed: switching endpoint");
                        changed_config = true;
                    }
                }
                if changed_config { break; }
            }
            crate::storage::disconnected(&app, "primary");
            *app.state::<ConnectionManager>().refresh.lock().unwrap_or_else(|e| e.into_inner()) = None;
            *app.state::<ConnectionManager>().server_refresh.lock().unwrap_or_else(|e| e.into_inner()) = None;
            *app.state::<ConnectionManager>().delivery.lock().unwrap_or_else(|e| e.into_inner()) = None;
            publish_server(&app, "offline", None, None);
            publish_devices(&app, "offline", Vec::new(), None);
            publish_status(&app, "offline", None);
            if !changed_config {
                tokio::select! {
                    _ = tokio::time::sleep(RECONNECT_DELAY) => {},
                    _ = changed.changed() => {},
                }
            }
        }
    });
}

async fn connect_and_listen(app: &AppHandle, url: &str, device_id: &str) -> Result<(), String> {
    let (mut socket, _) = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(url))
        .await
        .map_err(|_| "connection timed out".to_owned())?
        .map_err(|error| format!("WebSocket connection failed: {error}"))?;

    let hello = json!({
        "v": 1, "id": "homecloud-ui-hello", "type": "hello",
        "device_id": device_id, "client_type": "desktop"
    });
    tokio::time::timeout(HELLO_TIMEOUT, socket.send(Message::Text(hello.to_string().into())))
        .await
        .map_err(|_| "hello write timed out".to_owned())?
        .map_err(|error| format!("failed to send hello: {error}"))?;

    let first = tokio::time::timeout(HELLO_TIMEOUT, socket.next())
        .await
        .map_err(|_| "hello response timed out".to_owned())?
        .ok_or_else(|| "connection closed before hello response".to_owned())?
        .map_err(|error| format!("hello read error: {error}"))?;
    let Message::Text(reply) = first else {
        return Err("expected a JSON text response to hello".to_owned());
    };
    let response: Value = serde_json::from_str(reply.as_str())
        .map_err(|error| format!("invalid hello JSON: {error}"))?;
    if response.get("v").and_then(Value::as_i64) != Some(1)
        || response.get("type").and_then(Value::as_str) != Some("identified")
        || response.get("id").and_then(Value::as_str) != Some("homecloud-ui-hello")
    {
        return Err(format!("unexpected hello response: {}", response.get("type").and_then(Value::as_str).unwrap_or("missing")));
    }

    publish_status(app, "online", None);
    publish_devices(app, "loading", Vec::new(), None);
    publish_server(app, "loading", None, None);
    println!("[HomeCloud WS] Connected and identified: {device_id}");

    // Subscriptions precede the first snapshot on the SAME WebSocket.
    for (id, topic) in [
        ("homecloud-sub-connected", "clients.connected"),
        ("homecloud-sub-disconnected", "clients.disconnected"),
    ] {
        let request = json!({ "v": 1, "id": id, "type": "subscribe", "topic": topic });
        socket.send(Message::Text(request.to_string().into())).await
            .map_err(|error| format!("could not subscribe to {topic}: {error}"))?;
    }

    let (server_refresh_tx, mut server_refresh_rx) = mpsc::channel::<()>(4);
    *app.state::<ConnectionManager>().server_refresh.lock().unwrap_or_else(|e| e.into_inner()) = Some(server_refresh_tx);

    let (refresh_tx, mut refresh_rx) = mpsc::channel::<()>(4);
    *app.state::<ConnectionManager>().refresh.lock().unwrap_or_else(|e| e.into_inner()) = Some(refresh_tx);

    let (delivery_tx, mut delivery_rx) = mpsc::channel::<DeviceDelivery>(16);
    *app.state::<ConnectionManager>().delivery.lock().unwrap_or_else(|e| e.into_inner()) = Some(delivery_tx);
    let (storage_tx, mut storage_rx) = mpsc::channel::<crate::storage::StorageRequest>(16);
    crate::storage::connected(app, "primary", storage_tx.clone());
    let mut pending_storage: HashMap<String, oneshot::Sender<Result<Value, String>>> = HashMap::new();
    let mut storage_counter = 0u64;
    let mut pending_deliveries: HashMap<String, oneshot::Sender<Result<String, String>>> = HashMap::new();
    let mut delivery_counter = 0u64;

    let mut request_counter = 0u64;
    let first_id = send_device_list(&mut socket, &mut request_counter).await?;
    let mut list_pending: Option<(String, tokio::time::Instant)> = Some((first_id, tokio::time::Instant::now()));
    let mut deferred_events: Vec<(bool, ConnectedDevice)> = Vec::new();

    let mut server_counter = 0u64;
    let server_id = send_system_status(&mut socket, &mut server_counter).await?;
    let mut server_pending: Option<(String, tokio::time::Instant)> = Some((server_id, tokio::time::Instant::now()));
    let mut server_refresh_queued = false;
    let mut refresh_queued = false;

    let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + PING_INTERVAL, PING_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut resync = tokio::time::interval_at(tokio::time::Instant::now() + DEVICE_RESYNC_INTERVAL, DEVICE_RESYNC_INTERVAL);
    resync.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut server_resync = tokio::time::interval_at(tokio::time::Instant::now() + SERVER_RESYNC_INTERVAL, SERVER_RESYNC_INTERVAL);
    server_resync.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut next_ping_id = 0u64;
    let mut pending_ping: Option<(String, tokio::time::Instant)> = None;
    // Go dispatches system.status synchronously. Allow heartbeats to wait while
    // telemetry is being collected so a busy server is not falsely Offline.
    let mut ping_grace_until = tokio::time::Instant::now();

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                pending_deliveries.retain(|_, reply| !reply.is_closed());
                pending_storage.retain(|_, reply| !reply.is_closed());
                if let Some((_, sent)) = &pending_ping {
                    if sent.elapsed() >= PONG_TIMEOUT
                        && server_pending.is_none()
                        && pending_storage.is_empty()
                        && tokio::time::Instant::now() >= ping_grace_until
                    {
                        return Err(format!("pong timeout after {} seconds", PONG_TIMEOUT.as_secs()));
                    }
                } else {
                    next_ping_id = next_ping_id.wrapping_add(1);
                    let id = format!("homecloud-ping-{next_ping_id}");
                    let ping = json!({ "v": 1, "type": "ping", "id": id });
                    tokio::time::timeout(PONG_TIMEOUT, socket.send(Message::Text(ping.to_string().into())))
                        .await
                        .map_err(|_| "ping write timed out".to_owned())?
                        .map_err(|error| format!("ping write failed: {error}"))?;
                    pending_ping = Some((id, tokio::time::Instant::now()));
                }

                if let Some((_, sent)) = &server_pending {
                    if sent.elapsed() >= SERVER_TIMEOUT {
                        server_pending = None;
                        ping_grace_until = tokio::time::Instant::now() + PONG_TIMEOUT;
                        let previous = app.state::<ConnectionManager>().server.lock().unwrap_or_else(|e| e.into_inner()).data.clone();
                        publish_server(app, "error", previous, Some("HomeCloudBackend не ответил на system.status".to_owned()));
                    }
                }
                if let Some((_, sent)) = &list_pending {
                    if sent.elapsed() >= LIST_TIMEOUT {
                        list_pending = None;
                        deferred_events.clear();
                        let old = app.state::<ConnectionManager>().devices.lock().unwrap_or_else(|e| e.into_inner()).devices.clone();
                        publish_devices(app, "error", old, Some("HomeCloudBackend не ответил на clients.list".to_owned()));
                    }
                }
            }
            _ = resync.tick() => {
                if list_pending.is_some() {
                    refresh_queued = true;
                } else {
                    let id = send_device_list(&mut socket, &mut request_counter).await?;
                    list_pending = Some((id, tokio::time::Instant::now()));
                }
            }
            _ = server_resync.tick() => {
                if server_pending.is_some() {
                    server_refresh_queued = true;
                } else {
                    let id = send_system_status(&mut socket, &mut server_counter).await?;
                    server_pending = Some((id, tokio::time::Instant::now()));
                    server_refresh_queued = false;
                }
            }
            refresh_server = server_refresh_rx.recv() => {
                if refresh_server.is_none() {
                    return Err("server refresh channel closed".to_owned());
                }
                if server_pending.is_some() {
                    server_refresh_queued = true;
                } else {
                    let id = send_system_status(&mut socket, &mut server_counter).await?;
                    server_pending = Some((id, tokio::time::Instant::now()));
                }
            }
            refresh = refresh_rx.recv() => {
                if refresh.is_none() {
                    // Sender went away. This should not happen while connected.
                    return Err("device refresh channel closed".to_owned());
                }
                if list_pending.is_some() {
                    refresh_queued = true;
                } else {
                    let id = send_device_list(&mut socket, &mut request_counter).await?;
                    list_pending = Some((id, tokio::time::Instant::now()));
                }
            }
            storage_command = storage_rx.recv() => {
                let Some(command) = storage_command else { return Err("storage channel closed".into()); };
                storage_counter = storage_counter.wrapping_add(1);
                let id = format!("hc-storage-primary-{storage_counter}");
                let packet = json!({"v":1,"type":"command","id":id,"action":command.action,"data":command.data});
                if let Err(e) = socket.send(Message::Text(packet.to_string().into())).await {
                    let _ = command.reply.send(Err(e.to_string()));
                    return Err(e.to_string());
                }
                pending_storage.insert(id, command.reply);
            }
            delivery = delivery_rx.recv() => {
                let Some(delivery) = delivery else { return Err("delivery channel closed".into()); };
                if pending_deliveries.len() >= 64 {
                    let _ = delivery.reply.send(Err("Слишком много неподтверждённых сообщений".into()));
                    continue;
                }
                delivery_counter = delivery_counter.wrapping_add(1);
                let id = format!("homecloud-delivery-{delivery_counter}");
                let msg = json!({"v":1,"id":id,"type":"command","action":"clients.send","data":{"target":delivery.device_id,"payload":delivery.payload}});
                if let Err(e) = socket.send(Message::Text(msg.to_string().into())).await {
                    let _ = delivery.reply.send(Err(e.to_string()));
                    return Err(format!("clients.send failed: {e}"));
                }
                pending_deliveries.insert(id, delivery.reply);
            }
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(message) = serde_json::from_str::<Value>(text.as_str()) else {
                            continue;
                        };
                        if let Some((id, sent)) = &pending_ping {
                            if is_matching_pong(&message, id) {
                                let latency_ms = sent.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                                publish_status(app, "online", Some(latency_ms));
                                pending_ping = None;
                                continue;
                            }
                        }

                        if let Some((connected, device)) = parse_device_event(&message) {
                            if list_pending.is_some() {
                                // Never allow a slightly older list snapshot to overwrite newer events.
                                if deferred_events.len() >= 2048 {
                                    return Err("too many device events during sync".to_owned());
                                }
                                deferred_events.push((connected, device));
                            } else {
                                let current = app.state::<ConnectionManager>().devices.lock().unwrap_or_else(|e| e.into_inner()).clone();
                                if current.phase == "ready" {
                                    let mut devices = current.devices;
                                    apply_device_change(&mut devices, connected, device);
                                    publish_devices(app, "ready", devices, None);
                                } else {
                                    refresh_queued = true;
                                }
                            }
                            continue;
                        }

                        let response_id = message.get("id").and_then(Value::as_str).unwrap_or("");
                        if let Some(reply) = pending_storage.remove(response_id) {
                            let result = if message.get("type").and_then(Value::as_str) == Some("result") {
                                Ok(message.get("data").cloned().unwrap_or(Value::Null))
                            } else {
                                Err(message.get("error").and_then(Value::as_str).unwrap_or("Ошибка команды Storage Manager").to_owned())
                            };
                            let _ = reply.send(result);
                            continue;
                        }
                        if let Some(reply) = pending_deliveries.remove(response_id) {
                            let success = message.get("type").and_then(Value::as_str) == Some("result")
                                && message.get("action").and_then(Value::as_str) == Some("clients.send")
                                && message.pointer("/data/status").and_then(Value::as_str) == Some("queued");
                            let outcome = if success { Ok("Сообщение помещено в очередь устройства".to_owned()) }
                                else { Err(message.get("error").and_then(Value::as_str).unwrap_or("Ошибка clients.send").to_owned()) };
                            let _ = reply.send(outcome);
                            continue;
                        }

                        if let Some((id, _)) = &server_pending {
                            if response_id == id {
                                let valid = message.get("v").and_then(Value::as_i64) == Some(1)
                                    && message.get("type").and_then(Value::as_str) == Some("result")
                                    && message.get("action").and_then(Value::as_str) == Some("system.status")
                                    && message.get("data").map(Value::is_object) == Some(true);
                                if valid {
                                    publish_server(app, "ready", message.get("data").cloned(), None);
                                } else {
                                    let error = message.get("error").and_then(Value::as_str)
                                        .unwrap_or("Некорректный ответ system.status");
                                    let previous = app.state::<ConnectionManager>().server.lock().unwrap_or_else(|e| e.into_inner()).data.clone();
                                    publish_server(app, "error", previous, Some(error.to_owned()));
                                }
                                server_pending = None;
                                ping_grace_until = tokio::time::Instant::now() + PONG_TIMEOUT;
                                if server_refresh_queued {
                                    server_refresh_queued = false;
                                    let next_id = send_system_status(&mut socket, &mut server_counter).await?;
                                    server_pending = Some((next_id, tokio::time::Instant::now()));
                                }
                                continue;
                            }
                        }
                        if let Some((id, _)) = &list_pending {
                            if response_id == id {
                                let valid_result = message.get("v").and_then(Value::as_i64) == Some(1)
                                    && message.get("type").and_then(Value::as_str) == Some("result")
                                    && message.get("action").and_then(Value::as_str) == Some("clients.list");
                                if valid_result {
                                    match serde_json::from_value::<Vec<ConnectedDevice>>(message.get("data").cloned().unwrap_or(Value::Null)) {
                                        Ok(mut devices) => {
                                            for (connected, device) in deferred_events.drain(..) {
                                                apply_device_change(&mut devices, connected, device);
                                            }
                                            publish_devices(app, "ready", devices, None);
                                            println!("[HomeCloud WS] Devices synchronized");
                                        }
                                        Err(error) => {
                                            deferred_events.clear();
                                            publish_devices(app, "error", Vec::new(), Some(format!("Неверный ответ clients.list: {error}")));
                                        }
                                    }
                                } else {
                                    deferred_events.clear();
                                    let reason = message.get("error").and_then(Value::as_str).unwrap_or("Некорректный ответ сервера");
                                    publish_devices(app, "error", Vec::new(), Some(reason.to_owned()));
                                }
                                list_pending = None;
                                if refresh_queued {
                                    refresh_queued = false;
                                    let id = send_device_list(&mut socket, &mut request_counter).await?;
                                    list_pending = Some((id, tokio::time::Instant::now()));
                                }
                                continue;
                            }
                        }
                        if message.get("type").and_then(Value::as_str) == Some("error") {
                            eprintln!("[HomeCloud WS] Server error: {}", message.get("error").and_then(Value::as_str).unwrap_or("unknown"));
                        }
                    }
                    Some(Ok(Message::Close(_))) => return Err("server closed the connection".to_owned()),
                    Some(Err(error)) => return Err(format!("WebSocket read error: {error}")),
                    None => return Err("connection ended".to_owned()),
                    Some(Ok(_)) => {}, // protocol-level ping/pong are driven by tungstenite
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_device_change, apply_server_update, is_matching_pong, parse_device_event, ConnectedDevice, ServerSnapshot};
    use serde_json::json;

    #[test]
    fn pong_must_have_matching_id_and_version() {
        let message = json!({"v":1,"type":"pong","id":"homecloud-ping-1"});
        assert!(is_matching_pong(&message, "homecloud-ping-1"));
        assert!(!is_matching_pong(&message, "homecloud-ping-2"));
        assert!(!is_matching_pong(&json!({"v":2,"type":"pong","id":"homecloud-ping-1"}), "homecloud-ping-1"));
    }

    #[test]
    fn server_snapshot_survives_disconnect_and_reconnect() {
        let mut status = ServerSnapshot {
            phase: "offline".into(), data: None, error: None, revision: 0,
        };
        let first = json!({"system": {"hostname": "homecloud-host"}, "collected_at": "2026-10-25T12:00:00Z"});
        apply_server_update(&mut status, "ready", Some(first.clone()), None);
        assert_eq!(status.data, Some(first.clone()));
        apply_server_update(&mut status, "offline", None, None);
        assert_eq!(status.phase, "offline");
        assert_eq!(status.data, Some(first.clone()));
        apply_server_update(&mut status, "loading", None, None);
        assert_eq!(status.data, Some(first.clone()));
        apply_server_update(&mut status, "error", None, Some("status timeout".into()));
        assert_eq!(status.data, Some(first.clone()));
        let second = json!({"system": {"hostname": "homecloud-host"}, "collected_at": "2026-10-25T12:00:15Z"});
        apply_server_update(&mut status, "ready", Some(second.clone()), None);
        assert_eq!(status.data, Some(second));
        assert!(status.error.is_none());
        assert_eq!(status.revision, 5);
    }

    #[test]
    fn events_insert_and_remove_devices_without_duplicates() {
        let event = json!({"v":1,"type":"event","topic":"clients.connected", "data": {"from":"backend", "payload": {"device_id":"tv-main","client_type":"tv"}}});
        let (connected, device) = parse_device_event(&event).unwrap();
        assert!(connected);
        let mut devices = vec![ConnectedDevice { device_id: "tv-main".into(), client_type: "desktop".into() }];
        apply_device_change(&mut devices, connected, device);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].client_type, "tv");
        let removed = devices[0].clone();
        apply_device_change(&mut devices, false, removed);
        assert!(devices.is_empty());
    }
}
