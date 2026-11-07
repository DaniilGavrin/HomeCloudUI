//! Persistent HomeCloud server pool. A configured server is NOT an ephemeral device.
//! React never opens sockets: each additional server is monitored by Rust/Tauri.
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, net::{Ipv4Addr, Ipv6Addr}, path::PathBuf, sync::Mutex, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot, watch};
use tauri::async_runtime::JoinHandle;
use tokio_tungstenite::{connect_async, tungstenite::Message};


pub const POOL_EVENT: &str = "homecloud:server-pool";
const PORT: u16 = 8080;
const RETRY: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const STATUS_TIMEOUT: Duration = Duration::from_secs(9);
const STATUS_INTERVAL: Duration = Duration::from_secs(15);
const PING_INTERVAL: Duration = Duration::from_secs(1);
const PONG_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ServerEntry {
    pub id: String,
    pub name: String,
    pub ipv4: Option<String>,
    pub ipv6: Option<String>,
    pub builtin: bool,
}

#[derive(Clone, Deserialize)]
pub struct ServerInput {
    name: String,
    ipv4: Option<String>,
    ipv6: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct PoolNode {
    #[serde(flatten)]
    pub entry: ServerEntry,
    pub phase: String, // offline, connecting, ready, error
    pub latency_ms: Option<u64>,
    pub data: Option<Value>,
    pub error: Option<String>,
}

impl PoolNode {
    fn new(entry: ServerEntry) -> Self {
        Self { entry, phase: "offline".into(), latency_ms: None, data: None, error: None }
    }
}

#[derive(Clone, Serialize)]
pub struct PoolSnapshot {
    pub servers: Vec<PoolNode>,
    pub revision: u64,
}

pub struct ServerPool {
    file: PathBuf,
    pub(crate) inner: Mutex<PoolSnapshot>,
    tasks: Mutex<HashMap<String, JoinHandle<()>>>,
    refreshes: Mutex<HashMap<String, mpsc::Sender<()>>>,
    device_refreshes: Mutex<HashMap<String, mpsc::Sender<()>>>,
    deliveries: Mutex<HashMap<String, mpsc::Sender<crate::homecloud_ws::DeviceDelivery>>>,
    primary_changes: watch::Sender<u64>,
}

fn default_primary() -> ServerEntry {
    // Respect a simple IP-based HOMECLOUD_WS_URL on first launch only.
    let raw = std::env::var("HOMECLOUD_WS_URL").unwrap_or_default();
    let authority = raw.strip_prefix("ws://")
        .and_then(|v| v.split('/').next()).unwrap_or("");
    let host = if authority.starts_with('[') {
        authority.split(']').next().unwrap_or("").trim_start_matches('[')
    } else {
        authority.split(':').next().unwrap_or("")
    };
    let ipv4 = host.parse::<Ipv4Addr>().ok().map(|ip| ip.to_string());
    let ipv6 = host.parse::<Ipv6Addr>().ok().map(|ip| ip.to_string());
    ServerEntry {
        id: "node-bootstrap".into(), name: "HomeCloudBackend".into(),
        ipv4, ipv6, builtin: false,
    }
}

fn normalize(input: ServerInput) -> Result<(String, Option<String>, Option<String>), String> {
    let name = input.name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
        return Err("Название сервера должно содержать от 1 до 64 символов".into());
    }
    let ipv4 = input.ipv4.as_deref().map(str::trim).filter(|s| !s.is_empty())
        .map(|s| s.parse::<Ipv4Addr>().map(|v| v.to_string()).map_err(|_| "Некорректный IPv4 (укажи адрес без порта)".to_owned())).transpose()?;
    let ipv6 = input.ipv6.as_deref().map(str::trim).filter(|s| !s.is_empty())
        .map(|s| s.parse::<Ipv6Addr>().map(|v| v.to_string()).map_err(|_| "Некорректный IPv6 (без квадратных скобок и порта)".to_owned())).transpose()?;
    if ipv4.is_none() && ipv6.is_none() { return Err("Нужно указать IPv4, IPv6 или оба адреса".into()); }
    Ok((name, ipv4, ipv6))
}

fn unique_addr(nodes: &[PoolNode], skip: Option<&str>, ipv4: &Option<String>, ipv6: &Option<String>) -> Result<(), String> {
    if nodes.iter().any(|n| Some(n.entry.id.as_str()) != skip &&
        ((ipv4.is_some() && &n.entry.ipv4 == ipv4) || (ipv6.is_some() && &n.entry.ipv6 == ipv6))) {
        return Err("Этот адрес уже присутствует в пуле".into());
    }
    Ok(())
}

fn publish(app: &AppHandle) {
    let snapshot = app.state::<ServerPool>().inner.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Err(e) = app.emit(POOL_EVENT, snapshot) { eprintln!("[ServerPool] emit failed: {e}"); }
}

fn save(file: &PathBuf, servers: &[PoolNode]) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&servers.iter().map(|n| &n.entry).collect::<Vec<_>>())
        .map_err(|e| e.to_string())?;
    let dir = file.parent().ok_or("Invalid configuration directory")?;
    fs::create_dir_all(dir).map_err(|e| format!("Каталог настроек: {e}"))?;
    // Atomic-ish replacement with rollback on platforms that cannot rename over existing files.
    let tmp = file.with_extension("json.tmp");
    let bak = file.with_extension("json.bak");
    fs::write(&tmp, json).map_err(|e| format!("Запись настроек: {e}"))?;
    if file.exists() {
        let _ = fs::remove_file(&bak);
        if let Err(e) = fs::rename(file, &bak) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("Резервное копирование настроек: {e}"));
        }
    }
    if let Err(e) = fs::rename(&tmp, file) {
        if bak.exists() { let _ = fs::rename(&bak, file); }
        return Err(format!("Сохранение настроек: {e}"));
    }
    let _ = fs::remove_file(&bak);
    Ok(())
}

/// Move old fixed primary into the ordinary removable pool. The generated
/// localhost stub is discarded, but explicit remote primary addresses survive.
fn migrate_legacy_primary(entries: Vec<ServerEntry>) -> (Vec<ServerEntry>, bool) {
    let mut changed = false;
    let ids: Vec<String> = entries.iter().map(|s| s.id.clone()).collect();
    let mut out = Vec::with_capacity(entries.len());
    for mut server in entries {
        if server.id == "primary" {
            changed = true;
            if server.ipv4.as_deref() == Some("127.0.0.1") && server.ipv6.is_none() {
                continue;
            }
            let mut id = "node-migrated-primary".to_string();
            let mut counter = 1;
            while ids.contains(&id) || out.iter().any(|n: &ServerEntry| n.id == id) {
                id = format!("node-migrated-primary-{counter}");
                counter += 1;
            }
            server.id = id;
        }
        if server.builtin {
            changed = true;
            server.builtin = false;
        }
        out.push(server);
    }
    (out, changed)
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = dir.join("server-pool.json");
    // Recover configuration if interrupted during an existing-file replacement.
    let bak = file.with_extension("json.bak");
    if !file.exists() && bak.exists() {
        fs::copy(&bak, &file).map_err(|e| format!("Восстановление настроек пула: {e}"))?;
    }
    let existed = file.exists();
    let entries: Vec<ServerEntry> = if existed {
        let body = fs::read_to_string(&file).map_err(|e| format!("Чтение пула: {e}"))?;
        serde_json::from_str(&body).map_err(|e| format!("Ошибка формата пула серверов: {e}"))?
    } else {
        // Only an EXPLICIT environment endpoint creates a first-launch server.
        let bootstrap = default_primary();
        if bootstrap.ipv4.is_some() || bootstrap.ipv6.is_some() { vec![bootstrap] } else { Vec::new() }
    };
    let (entries, migrated) = migrate_legacy_primary(entries);
    // Persist once before connecting, so the removed loopback stub cannot
    // return after reboot. save() retains a .bak during the atomic swap.
    if migrated || !existed {
        let nodes: Vec<PoolNode> = entries.iter().cloned().map(PoolNode::new).collect();
        save(&file, &nodes)?;
    }
    let (tx, _) = watch::channel(0u64);
    let manager = ServerPool {
        file, inner: Mutex::new(PoolSnapshot { servers: entries.into_iter().map(PoolNode::new).collect(), revision: 0 }),
        tasks: Mutex::new(HashMap::new()), refreshes: Mutex::new(HashMap::new()),
        device_refreshes: Mutex::new(HashMap::new()), deliveries: Mutex::new(HashMap::new()), primary_changes: tx,
    };
    app.manage(manager);
    Ok(())
}

pub fn primary(app: &AppHandle) -> ServerEntry {
    app.state::<ServerPool>().inner.lock().unwrap_or_else(|e| e.into_inner())
        .servers.iter().find(|n| n.entry.id == "primary").map(|n| n.entry.clone()).unwrap_or_else(default_primary)
}

pub fn primary_updates(app: &AppHandle) -> watch::Receiver<u64> {
    app.state::<ServerPool>().primary_changes.subscribe()
}

pub fn addresses(server: &ServerEntry) -> Vec<String> {
    let mut result = Vec::new();
    if let Some(ip) = &server.ipv4 { result.push(format!("ws://{ip}:{PORT}/ws")); }
    if let Some(ip) = &server.ipv6 { result.push(format!("ws://[{ip}]:{PORT}/ws")); }
    result
}

#[tauri::command]
pub fn homecloud_pool_status(app: AppHandle) -> PoolSnapshot {
    app.state::<ServerPool>().inner.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn homecloud_pool_add(app: AppHandle, input: ServerInput) -> Result<PoolSnapshot, String> {
    let (name, ipv4, ipv6) = normalize(input)?;
    let id = format!("node-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    let snapshot = {
        let p = app.state::<ServerPool>();
        let mut state = p.inner.lock().unwrap_or_else(|e| e.into_inner());
        unique_addr(&state.servers, None, &ipv4, &ipv6)?;
        if state.servers.len() >= 64 { return Err("В пуле может быть не больше 64 серверов".into()); }
        let entry = ServerEntry { id: id.clone(), name, ipv4, ipv6, builtin: false };
        let mut next = state.servers.clone(); next.push(PoolNode::new(entry));
        save(&p.file, &next)?;
        state.servers = next; state.revision += 1; state.clone()
    };
    publish(&app);
    start_secondary(app, id);
    Ok(snapshot)
}

#[tauri::command]
pub fn homecloud_pool_update(app: AppHandle, id: String, input: ServerInput) -> Result<PoolSnapshot, String> {
    let (name, ipv4, ipv6) = normalize(input)?;
    let (snapshot, address_changed) = {
        let p = app.state::<ServerPool>();
        let mut state = p.inner.lock().unwrap_or_else(|e| e.into_inner());
        unique_addr(&state.servers, Some(&id), &ipv4, &ipv6)?;
        let index = state.servers.iter().position(|n| n.entry.id == id).ok_or("Сервер не найден")?;
        let old = &state.servers[index].entry;
        let changed = old.ipv4 != ipv4 || old.ipv6 != ipv6;
        let mut next = state.servers.clone();
        next[index].entry.name = name;
        next[index].entry.ipv4 = ipv4;
        next[index].entry.ipv6 = ipv6;
        if changed { next[index].phase = "connecting".into(); next[index].latency_ms = None; next[index].data = None; next[index].error = None; }
        save(&p.file, &next)?;
        state.servers = next; state.revision += 1;
        (state.clone(), changed)
    };
    publish(&app);
    if address_changed {
        if let Err(e) = crate::device_registry::forget_server(&app, &id) { eprintln!("[ServerPool] Device cleanup failed: {e}"); }
        start_secondary(app, id);
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn homecloud_pool_delete(app: AppHandle, id: String) -> Result<PoolSnapshot, String> {
    let snapshot = {
        let p = app.state::<ServerPool>();
        let mut state = p.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !state.servers.iter().any(|n| n.entry.id == id) { return Err("Сервер не найден".into()); }
        let next: Vec<_> = state.servers.iter().filter(|n| n.entry.id != id).cloned().collect();
        save(&p.file, &next)?;
        state.servers = next; state.revision += 1; state.clone()
    };
    let p = app.state::<ServerPool>();
    if let Some(task) = p.tasks.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) { task.abort(); }
    p.refreshes.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    p.device_refreshes.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    p.deliveries.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    crate::storage::disconnected(&app, &id);
    if let Err(e) = crate::device_registry::forget_server(&app, &id) { eprintln!("[ServerPool] Device cleanup failed: {e}"); }
    publish(&app);
    Ok(snapshot)
}

#[tauri::command]
pub fn homecloud_pool_refresh(app: AppHandle, id: String) -> Result<(), String> {
    let p = app.state::<ServerPool>();
    let sender = p.refreshes.lock().unwrap_or_else(|e| e.into_inner()).get(&id).cloned();
    sender.ok_or("Сервер сейчас не подключён")?.try_send(()).map_err(|e| e.to_string())
}

pub fn refresh_devices(app: &AppHandle, id: &str) -> Result<(), String> {
    let p = app.state::<ServerPool>();
    let sender = p.device_refreshes.lock().unwrap_or_else(|e| e.into_inner()).get(id).cloned();
    sender.ok_or("Этот сервер сейчас не подключён")?
        .try_send(()).map_err(|e| e.to_string())
}

pub async fn send_to_device(app: &AppHandle, server_id: &str, device_id: String, payload: Value) -> Result<String, String> {
    let p = app.state::<ServerPool>();
    let sender = p.deliveries.lock().unwrap_or_else(|e| e.into_inner()).get(server_id).cloned()
        .ok_or("Этот сервер сейчас не подключён")?;
    let (reply, receiver) = oneshot::channel();
    sender.send(crate::homecloud_ws::DeviceDelivery { device_id, payload, reply }).await
        .map_err(|_| "Сессия сервера закрылась")?;
    tokio::time::timeout(Duration::from_secs(10), receiver).await
        .map_err(|_| "Тайм-аут подтверждения отправки")?
        .map_err(|_| "Соединение прервалось до подтверждения")?
}

fn update_node(app: &AppHandle, id: &str, phase: &str, latency: Option<u64>, data: Option<Value>, error: Option<String>) {
    let changed = {
        let p = app.state::<ServerPool>();
        let mut state = p.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(node) = state.servers.iter_mut().find(|n| n.entry.id == id) {
            node.phase = phase.into();
            node.latency_ms = latency;
            if let Some(data) = data { node.data = Some(data); }
            node.error = error;
            state.revision += 1;
            true
        } else { false }
    };
    if changed { publish(app); }
}

fn start_secondary(app: AppHandle, id: String) {
    let p = app.state::<ServerPool>();
    if let Some(old) = p.tasks.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) { old.abort(); }
    p.refreshes.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    p.device_refreshes.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    p.deliveries.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    crate::media_rooms::disconnected(&app, &id);
    let entry = {
        let state = p.inner.lock().unwrap_or_else(|e| e.into_inner());
        state.servers.iter().find(|n| n.entry.id == id).map(|n| n.entry.clone())
    };
    if let Some(entry) = entry {
        let cloned_app = app.clone();
        let task = tauri::async_runtime::spawn(async move { monitor(cloned_app, entry).await; });
        p.tasks.lock().unwrap_or_else(|e| e.into_inner()).insert(id, task);
    }
}

pub fn start_all(app: AppHandle) {
    let ids: Vec<String> = app.state::<ServerPool>().inner.lock().unwrap_or_else(|e| e.into_inner())
        .servers.iter().map(|n| n.entry.id.clone()).collect();
    for id in ids { start_secondary(app.clone(), id); }
}

async fn monitor(app: AppHandle, entry: ServerEntry) {
    let mut last_rtt = None;
    loop {
        update_node(&app, &entry.id, "connecting", None, None, None);
        let mut last_err = "Не удалось подключиться".to_owned();
        for url in addresses(&entry) {
            match run_secondary_session(&app, &entry, &url, &mut last_rtt).await {
                Ok(()) => last_err = "Соединение закрыто сервером".into(),
                Err(error) => last_err = error,
            }
            // Each address attempt owns a distinct socket. Mark the observed
            // devices offline before trying a fallback address.
            crate::storage::disconnected(&app, &entry.id);
            crate::media_rooms::disconnected(&app, &entry.id);
            crate::device_registry::disconnected(&app, &entry.id);
            let state = app.state::<ServerPool>();
            state.device_refreshes.lock().unwrap_or_else(|e| e.into_inner()).remove(&entry.id);
            state.deliveries.lock().unwrap_or_else(|e| e.into_inner()).remove(&entry.id);
            // If the active session dropped, retry that address, instead of
            // jumping immediately to another IP of the same node.
            if last_err.starts_with("session ended:") { break; }
        }
        app.state::<ServerPool>().refreshes.lock().unwrap_or_else(|e| e.into_inner()).remove(&entry.id);
        app.state::<ServerPool>().device_refreshes.lock().unwrap_or_else(|e| e.into_inner()).remove(&entry.id);
        app.state::<ServerPool>().deliveries.lock().unwrap_or_else(|e| e.into_inner()).remove(&entry.id);
        crate::storage::disconnected(&app, &entry.id);
        crate::device_registry::disconnected(&app, &entry.id);
        update_node(&app, &entry.id, "offline", None, None, Some(last_err));
        last_rtt = None;
        tokio::time::sleep(RETRY).await;
    }
}

async fn run_secondary_session(app: &AppHandle, entry: &ServerEntry, url: &str, last_rtt: &mut Option<u64>) -> Result<(), String> {
    let (mut socket, _) = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(url)).await
        .map_err(|_| format!("Тайм-аут подключения к {url}"))?
        .map_err(|e| format!("{url}: {e}"))?;
    let hello_id = format!("hc-pool-hello-{}", entry.id);
    let hello = json!({"v":1,"id":hello_id,"type":"hello", "device_id":crate::device_registry::local_device_id(app),"client_type":"desktop"});
    socket.send(Message::Text(hello.to_string().into())).await.map_err(|e| e.to_string())?;
    let response = tokio::time::timeout(CONNECT_TIMEOUT, socket.next()).await
        .map_err(|_| "Тайм-аут идентификации".to_owned())?
        .ok_or("Сервер закрыл соединение до идентификации")?
        .map_err(|e| e.to_string())?;
    let value: Value = match response { Message::Text(t) => serde_json::from_str(t.as_str()).map_err(|e| e.to_string())?, _ => return Err("Неверный ответ идентификации".into()) };
    if value.get("type").and_then(Value::as_str) != Some("identified")
        || value.get("id").and_then(Value::as_str) != Some(hello_id.as_str()) {
        return Err("Сервер не подтвердил идентификацию".into());
    }
    // Subscribe before clients.list, so updates during the initial snapshot
    // are not lost. This is the SAME secondary WebSocket used for telemetry.
    for (suffix, topic) in [("connected", "clients.connected"), ("disconnected", "clients.disconnected"),
        ("media-changed", "media.room.changed"), ("media-closed", "media.room.closed")] {
        let msg = json!({"v":1,"id":format!("hc-pool-sub-{}-{suffix}", entry.id),"type":"subscribe","topic":topic});
        socket.send(Message::Text(msg.to_string().into())).await.map_err(|e| format!("subscribe failed: {e}"))?;
    }
    let (device_tx, mut device_rx) = mpsc::channel::<()>(4);
    app.state::<ServerPool>().device_refreshes.lock().unwrap_or_else(|e| e.into_inner()).insert(entry.id.clone(), device_tx);
    let (delivery_tx, mut delivery_rx) = mpsc::channel::<crate::homecloud_ws::DeviceDelivery>(16);
    app.state::<ServerPool>().deliveries.lock().unwrap_or_else(|e| e.into_inner()).insert(entry.id.clone(), delivery_tx);
    let mut pending_deliveries: HashMap<String, oneshot::Sender<Result<String,String>>> = HashMap::new();
    let mut delivery_counter = 0u64;
    let mut list_counter = 0u64;
    let mut pending_list: Option<(String, tokio::time::Instant)> = None;
    let mut queued_list = true;
    let mut deferred_events: Vec<(bool, crate::homecloud_ws::ConnectedDevice)> = Vec::new();
    let (storage_tx, mut storage_rx) = mpsc::channel::<crate::storage::StorageRequest>(16);
    crate::storage::connected(app, &entry.id, storage_tx.clone());
    crate::media_rooms::connected(app, &entry.id);
    let mut pending_storage: HashMap<String, oneshot::Sender<Result<Value, String>>> = HashMap::new();
    let mut storage_counter = 0u64;
    let mut list_resync = tokio::time::interval_at(tokio::time::Instant::now() + Duration::from_secs(30), Duration::from_secs(30));
    list_resync.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let (tx, mut rx) = mpsc::channel::<()>(4);
    app.state::<ServerPool>().refreshes.lock().unwrap_or_else(|e| e.into_inner()).insert(entry.id.clone(), tx);
    update_node(app, &entry.id, "connecting", None, None, None);
    let mut status_counter = 0u64;
    let mut ping_counter = 0u64;
    let mut pending_status: Option<(String, tokio::time::Instant)> = None;
    let mut pending_ping: Option<(String, tokio::time::Instant)> = None;
    let mut status_next = tokio::time::interval_at(tokio::time::Instant::now(), STATUS_INTERVAL);
    status_next.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut ping_next = tokio::time::interval_at(tokio::time::Instant::now() + PING_INTERVAL, PING_INTERVAL);
    ping_next.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut grace = tokio::time::Instant::now();
    let mut status_queued = false;
    loop {
        tokio::select! {
            _ = list_resync.tick() => { queued_list = true; }
            refresh = device_rx.recv() => {
                if refresh.is_none() { return Err("session ended: device refresh channel closed".into()); }
                queued_list = true;
            }
            storage_command = storage_rx.recv() => {
                let Some(command) = storage_command else { return Err("session ended: storage channel closed".into()); };
                storage_counter = storage_counter.wrapping_add(1);
                let id = format!("hc-storage-{}-{storage_counter}", entry.id);
                let packet = json!({"v":1,"type":"command","id":id,"action":command.action,"data":command.data});
                if let Err(e) = socket.send(Message::Text(packet.to_string().into())).await {
                    let _ = command.reply.send(Err(e.to_string()));
                    return Err(format!("session ended: {e}"));
                }
                pending_storage.insert(id, command.reply);
            }
            delivery = delivery_rx.recv() => {
                let Some(delivery) = delivery else { return Err("session ended: delivery channel closed".into()); };
                if pending_deliveries.len() >= 64 {
                    let _ = delivery.reply.send(Err("Слишком много неподтверждённых сообщений".into()));
                    continue;
                }
                delivery_counter = delivery_counter.wrapping_add(1);
                let id = format!("hc-pool-delivery-{delivery_counter}");
                let request = json!({"v":1,"id":id,"type":"command","action":"clients.send","data":{"target":delivery.device_id,"payload":delivery.payload}});
                if let Err(e) = socket.send(Message::Text(request.to_string().into())).await {
                    let _ = delivery.reply.send(Err(e.to_string()));
                    return Err(format!("session ended: send error: {e}"));
                }
                pending_deliveries.insert(id, delivery.reply);
            }
            _ = status_next.tick() => { status_queued = true; }
            refresh = rx.recv() => {
                if refresh.is_none() { return Err("session ended: refresh channel closed".into()); }
                status_queued = true;
            }
            _ = ping_next.tick() => {
                pending_deliveries.retain(|_, reply| !reply.is_closed());
                pending_storage.retain(|_, reply| !reply.is_closed());
                if let Some((_, time)) = &pending_ping {
                    if time.elapsed() >= PONG_TIMEOUT && pending_status.is_none() && pending_storage.is_empty() && tokio::time::Instant::now() >= grace {
                        return Err("session ended: ping/pong timeout".into());
                    }
                } else {
                    ping_counter += 1;
                    let id = format!("hc-pool-ping-{ping_counter}");
                    socket.send(Message::Text(json!({"v":1,"type":"ping","id":id}).to_string().into())).await.map_err(|e| format!("session ended: {e}"))?;
                    pending_ping = Some((id, tokio::time::Instant::now()));
                }
                if let Some((_, sent)) = &pending_list {
                    if sent.elapsed() >= Duration::from_secs(8) {
                        pending_list = None;
                        deferred_events.clear();
                        queued_list = true;
                    }
                }
                if let Some((_, time)) = &pending_status {
                    if time.elapsed() >= STATUS_TIMEOUT {
                        pending_status = None;
                        grace = tokio::time::Instant::now() + PONG_TIMEOUT;
                        update_node(app, &entry.id, "error", *last_rtt, None, Some("Не получен ответ system.status".into()));
                    }
                }
            }
            incoming = socket.next() => {
                let raw = match incoming {
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(Message::Close(_))) | None => return Err("session ended: connection closed".into()),
                    Some(Err(e)) => return Err(format!("session ended: {e}")),
                    Some(Ok(_)) => continue,
                };
                let Ok(payload) = serde_json::from_str::<Value>(raw.as_str()) else { continue; };
                crate::media_rooms::on_event(app, &entry.id, &payload);
                if let Some((connected, device)) = crate::homecloud_ws::parse_device_event(&payload) {
                    if pending_list.is_some() {
                        if deferred_events.len() < 2048 { deferred_events.push((connected, device)); }
                        else { return Err("session ended: too many device events during sync".into()); }
                    } else {
                        crate::device_registry::event(app, &entry.id, &device.device_id, &device.client_type, connected);
                    }
                    continue;
                }
                let id = payload.get("id").and_then(Value::as_str).unwrap_or("");
                if let Some(reply) = pending_storage.remove(id) {
                    let result = if payload.get("type").and_then(Value::as_str) == Some("result") {
                        Ok(payload.get("data").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(payload.get("error").and_then(Value::as_str).unwrap_or("Ошибка команды Backend").to_owned())
                    };
                    let _ = reply.send(result);
                    continue;
                }
                if let Some(reply) = pending_deliveries.remove(id) {
                    let ok = payload.get("type").and_then(Value::as_str) == Some("result")
                        && payload.get("action").and_then(Value::as_str) == Some("clients.send")
                        && payload.pointer("/data/status").and_then(Value::as_str) == Some("queued");
                    let response = if ok { Ok("Сообщение помещено в очередь устройства".into()) }
                        else { Err(payload.get("error").and_then(Value::as_str).unwrap_or("Ошибка clients.send").to_owned()) };
                    let _ = reply.send(response);
                    continue;
                }
                if let Some((list_id, _)) = &pending_list {
                    if id == list_id {
                        if payload.get("type").and_then(Value::as_str) == Some("result")
                            && payload.get("action").and_then(Value::as_str) == Some("clients.list") {
                            if let Ok(mut devices) = serde_json::from_value::<Vec<crate::homecloud_ws::ConnectedDevice>>(payload.get("data").cloned().unwrap_or(Value::Null)) {
                                for (connected, device) in deferred_events.drain(..) {
                                    devices.retain(|item| item.device_id != device.device_id);
                                    if connected { devices.push(device); }
                                }
                                let active: Vec<(String, String)> = devices.into_iter().map(|d| (d.device_id, d.client_type)).collect();
                                crate::device_registry::reconcile(app, &entry.id, &active);
                            } else { deferred_events.clear(); }
                        } else { deferred_events.clear(); }
                        pending_list = None;
                        continue;
                    }
                }

                if let Some((ping_id, started)) = &pending_ping {
                    if payload.get("type").and_then(Value::as_str) == Some("pong") && id == ping_id {
                        *last_rtt = Some(started.elapsed().as_millis().min(u64::MAX as u128) as u64);
                        pending_ping = None;
                        let p = app.state::<ServerPool>();
                        let old = p.inner.lock().unwrap_or_else(|e| e.into_inner())
                            .servers.iter().find(|n| n.entry.id == entry.id).map(|n| n.phase.clone());
                        if old.as_deref() == Some("ready") { update_node(app, &entry.id, "ready", *last_rtt, None, None); }
                        continue;
                    }
                }
                if let Some((pending_id, _)) = &pending_status {
                    if id == pending_id {
                        let valid = payload.get("type").and_then(Value::as_str) == Some("result")
                            && payload.get("action").and_then(Value::as_str) == Some("system.status")
                            && payload.get("data").map(Value::is_object) == Some(true);
                        if valid {
                            update_node(app, &entry.id, "ready", *last_rtt, payload.get("data").cloned(), None);
                        } else {
                            update_node(app, &entry.id, "error", *last_rtt, None, Some(payload.get("error").and_then(Value::as_str).unwrap_or("Неверный ответ system.status").into()));
                        }
                        pending_status = None;
                        grace = tokio::time::Instant::now() + PONG_TIMEOUT;
                    }
                }
            }
        }
        if queued_list && pending_list.is_none() {
            list_counter = list_counter.wrapping_add(1);
            let id = format!("hc-pool-list-{list_counter}");
            socket.send(Message::Text(json!({"v":1,"id":id,"type":"command","action":"clients.list"}).to_string().into()))
                .await.map_err(|e| format!("session ended: {e}"))?;
            pending_list = Some((id, tokio::time::Instant::now()));
            queued_list = false;
        }
        if status_queued && pending_status.is_none() {
            status_counter += 1;
            let id = format!("hc-pool-status-{status_counter}");
            socket.send(Message::Text(json!({"v":1,"id":id,"type":"command","action":"system.status"}).to_string().into()))
                .await.map_err(|e| format!("session ended: {e}"))?;
            pending_status = Some((id, tokio::time::Instant::now()));
            status_queued = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn address_validation() {
        assert!(normalize(ServerInput{name:" A ".into(),ipv4:Some("192.168.1.1".into()),ipv6:Some("::1".into())}).is_ok());
        assert!(normalize(ServerInput{name:"A".into(),ipv4:Some("192.168.1.1:8080".into()),ipv6:None}).is_err());
        assert!(normalize(ServerInput{name:"A".into(),ipv4:None,ipv6:None}).is_err());
    }
    #[test]
    fn addresses_uses_ipv6_brackets() {
        let e = ServerEntry{id:"a".into(),name:"A".into(),ipv4:Some("1.2.3.4".into()),ipv6:Some("2001:db8::1".into()),builtin:false};
        assert_eq!(addresses(&e), ["ws://1.2.3.4:8080/ws", "ws://[2001:db8::1]:8080/ws"]);
    }
    #[test]
    fn no_implicit_localhost_and_removable_primary_migration() {
        let (empty, changed) = migrate_legacy_primary(vec![
            ServerEntry { id: "primary".into(), name: "Default".into(),
                ipv4: Some("127.0.0.1".into()), ipv6: None, builtin: true },
            ServerEntry { id: "node-a".into(), name: "Home".into(),
                ipv4: Some("192.168.0.147".into()), ipv6: None, builtin: false },
        ]);
        assert!(changed);
        assert_eq!(empty.len(), 1);
        assert_eq!(empty[0].id, "node-a");
        let (migrated, changed) = migrate_legacy_primary(vec![
            ServerEntry { id: "primary".into(), name: "Remote".into(),
                ipv4: Some("192.168.0.147".into()), ipv6: None, builtin: true },
        ]);
        assert!(changed);
        assert_eq!(migrated[0].id, "node-migrated-primary");
        assert!(!migrated[0].builtin);
        assert_eq!(migrated[0].ipv4.as_deref(), Some("192.168.0.147"));
    }

}
