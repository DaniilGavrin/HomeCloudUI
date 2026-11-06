//! Media-room control plane. All media packets stay on Media Gateway / HCM1.
//! One view per Backend; room events are fenced by instance_id and sequence.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};
const EVENT: &str = "homecloud:media-rooms";
const MAX_PENDING: usize = 512;
const MAX_SEEK_MS: i64 = 7 * 24 * 60 * 60 * 1000;
static COMMAND_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct MediaTarget {
    pub node_id: String,
    pub device_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MediaRoom {
    pub room_id: String,
    pub playback_id: String,
    pub generation: u32,
    pub instance_id: String,
    pub sequence: u64,
    pub revision: u64,
    pub target: MediaTarget,
    pub room_state: String,
    pub playback_state: String,
    pub tv_attach: String,
    pub position_ms: i64,
    #[serde(default)]
    pub volume: Option<i32>,
    #[serde(default)]
    pub muted: Option<bool>,
    #[serde(default)]
    pub seek_target_ms: Option<i64>,
    #[serde(default)]
    pub control_status: Option<String>,
    #[serde(default)]
    pub control_action: Option<String>,
    #[serde(default)]
    pub control_error_code: Option<String>,
}

#[derive(Deserialize)]
struct RoomBundle {
    schema_version: u32,
    instance_id: String,
    sequence: u64,
    rooms: Vec<MediaRoom>,
}

#[derive(Clone, Serialize)]
pub struct MediaServerView {
    pub server_id: String,
    pub phase: String,
    pub instance_id: Option<String>,
    pub sequence: u64,
    pub rooms: Vec<MediaRoom>,
    pub error: Option<String>,
    pub revision: u64,
}

struct ServerState {
    view: MediaServerView,
    pending: Vec<(String, MediaRoom)>,
    syncing: bool,
    epoch: u64,
}
impl ServerState {
    fn new(id: &str) -> Self {
        Self {
            view: MediaServerView {
                server_id: id.to_owned(), phase: "offline".into(),
                instance_id: None, sequence: 0, rooms: Vec::new(),
                error: None, revision: 0,
            },
            pending: Vec::new(), syncing: false, epoch: 0,
        }
    }
    fn reset(&mut self, phase: &str) {
        self.epoch = self.epoch.wrapping_add(1);
        self.pending.clear();
        self.syncing = false;
        self.view.phase = phase.into();
        self.view.instance_id = None;
        self.view.sequence = 0;
        self.view.rooms.clear();
        self.view.error = None;
        self.view.revision = self.view.revision.wrapping_add(1);
    }
}

#[derive(Default)]
pub struct MediaRooms {
    inner: Mutex<HashMap<String, ServerState>>,
}

#[tauri::command]
pub fn homecloud_media_status(app: AppHandle, server_id: String) -> MediaServerView {
    app.state::<MediaRooms>().inner.lock().unwrap_or_else(|e| e.into_inner())
        .get(&server_id).map(|s| s.view.clone())
        .unwrap_or_else(|| ServerState::new(&server_id).view)
}

fn emit(app: &AppHandle, view: MediaServerView) {
    let _ = app.emit(EVENT, view);
}

pub fn connected(app: &AppHandle, server_id: &str) {
    let view = {
        let state = app.state::<MediaRooms>();
        let mut all = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.entry(server_id.into()).or_insert_with(|| ServerState::new(server_id));
        entry.reset("loading");
        entry.view.clone()
    };
    emit(app, view);
    request_snapshot(app.clone(), server_id.to_owned());
}

pub fn disconnected(app: &AppHandle, server_id: &str) {
    let view = {
        let state = app.state::<MediaRooms>();
        let mut all = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.entry(server_id.into()).or_insert_with(|| ServerState::new(server_id));
        entry.reset("offline");
        entry.view.clone()
    };
    emit(app, view);
}

// All snapshots travel through the EXISTING control WS via a bounded request
// queue. Never create a second untracked media-control WebSocket.
fn request_snapshot(app: AppHandle, server_id: String) {
    let epoch = {
        let state = app.state::<MediaRooms>();
        let mut all = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.entry(server_id.clone()).or_insert_with(|| ServerState::new(&server_id));
        if entry.view.phase == "offline" || entry.syncing { return; }
        entry.syncing = true;
        entry.epoch
    };
    tauri::async_runtime::spawn(async move {
        let result = crate::storage::request_media(&app, &server_id, "media.rooms.snapshot", json!({})).await;
        let view = {
            let state = app.state::<MediaRooms>();
            let mut all = state.inner.lock().unwrap_or_else(|e| e.into_inner());
            let Some(entry) = all.get_mut(&server_id) else { return; };
            if entry.epoch != epoch || !entry.syncing { return; }
            entry.syncing = false;
            match result {
                Ok(value) => match serde_json::from_value::<RoomBundle>(value) {
                    Ok(bundle) if bundle.schema_version == 1 => {
                        if let Err(reason) = apply_bundle(entry, bundle) {
                            entry.view.phase = "error".into();
                            entry.view.error = Some(reason);
                            entry.view.rooms.clear();
                        }
                    }
                    Ok(_) => {
                        entry.view.phase = "error".into();
                        entry.view.error = Some("Неподдерживаемая версия media.rooms.snapshot".into());
                        entry.view.rooms.clear();
                    }
                    Err(err) => {
                        entry.view.phase = "error".into();
                        entry.view.error = Some(format!("Неверный snapshot медиакомнат: {err}"));
                        entry.view.rooms.clear();
                    }
                },
                Err(err) => {
                    entry.view.phase = "error".into();
                    entry.view.error = Some(format!("Ошибка синхронизации медиакомнат: {err}"));
                    entry.view.rooms.clear();
                }
            }
            entry.view.revision = entry.view.revision.wrapping_add(1);
            entry.view.clone()
        };
        emit(&app, view);
    });
}

fn apply_one(view: &mut MediaServerView, topic: &str, room: MediaRoom) -> Result<(), String> {
    if view.instance_id.as_deref() != Some(room.instance_id.as_str()) {
        return Err("Backend сменил instance_id: требуется повторный snapshot".into());
    }
    if room.sequence <= view.sequence { return Ok(()); }
    if room.sequence != view.sequence.saturating_add(1) {
        return Err("Обнаружен пропуск sequence медиакомнаты".into());
    }
    view.sequence = room.sequence;
    view.rooms.retain(|old| old.room_id != room.room_id);
    if topic == "media.room.changed" && room.room_state != "CLOSED" {
        view.rooms.push(room);
        view.rooms.sort_by(|a,b| a.room_id.cmp(&b.room_id));
    }
    Ok(())
}

fn apply_bundle(entry: &mut ServerState, bundle: RoomBundle) -> Result<(), String> {
    if bundle.instance_id.is_empty() { return Err("Пустой instance_id".into()); }
    if bundle.rooms.iter().any(|r| r.instance_id != bundle.instance_id
        || r.sequence > bundle.sequence || r.room_id.is_empty() || r.playback_id.is_empty()) {
        return Err("Несогласованный список медиакомнат".into());
    }
    let mut view = entry.view.clone();
    view.instance_id = Some(bundle.instance_id);
    view.sequence = bundle.sequence;
    view.rooms = bundle.rooms;
    view.rooms.sort_by(|a,b| a.room_id.cmp(&b.room_id));
    view.phase = "ready".into();
    view.error = None;
    let pending = std::mem::take(&mut entry.pending);
    for (topic, room) in pending {
        if let Err(err) = apply_one(&mut view, &topic, room) {
            entry.view.phase = "loading".into();
            entry.view.rooms.clear();
            entry.view.error = Some(err.clone());
            return Err(err);
        }
    }
    entry.view = view;
    Ok(())
}

pub fn on_event(app: &AppHandle, server_id: &str, message: &Value) {
    if message.get("type").and_then(Value::as_str) != Some("event") { return; }
    let Some(topic @ ("media.room.changed" | "media.room.closed")) =
        message.get("topic").and_then(Value::as_str) else { return; };
    let Some(payload) = message.pointer("/data/payload") else { return; };
    let Ok(room) = serde_json::from_value::<MediaRoom>(payload.clone()) else { return; };
    if room.room_id.is_empty() || room.playback_id.is_empty() { return; }
    let (view, resync) = {
        let state = app.state::<MediaRooms>();
        let mut all = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.entry(server_id.into()).or_insert_with(|| ServerState::new(server_id));
        if entry.view.phase == "offline" { return; }
        let mut resync = false;
        if entry.view.phase == "ready" {
            if let Err(_) = apply_one(&mut entry.view, topic, room.clone()) {
                entry.view.phase = "loading".into();
                entry.view.rooms.clear();
                entry.pending.clear();
                entry.pending.push((topic.into(), room));
                resync = true;
            }
        } else {
            if entry.pending.len() >= MAX_PENDING {
                entry.pending.clear();
                entry.view.phase = "error".into();
                entry.view.error = Some("Переполнена очередь событий медиакомнат".into());
            } else {
                entry.pending.push((topic.into(), room));
            }
            resync = !entry.syncing;
        }
        entry.view.revision = entry.view.revision.wrapping_add(1);
        (entry.view.clone(), resync)
    };
    emit(app, view);
    if resync { request_snapshot(app.clone(), server_id.to_owned()); }
}

#[tauri::command]
pub async fn homecloud_media_refresh(app: AppHandle, server_id: String) -> Result<(), String> {
    {
        let state = app.state::<MediaRooms>();
        let all = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.get(&server_id).ok_or("Нет соединения с Backend")?;
        if entry.view.phase == "offline" { return Err("Backend Offline".into()); }
    }
    request_snapshot(app, server_id);
    Ok(())
}

fn command_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let n = COMMAND_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("hc-ui-{nanos}-{n}")
}

#[tauri::command]
pub async fn homecloud_media_command(
    app: AppHandle, server_id: String, device_id: String,
    room_id: String, playback_id: String, generation: u32,
    action: String, volume: Option<i32>, muted: Option<bool>, position_ms: Option<i64>,
) -> Result<Value, String> {
    // The user-selected room identity is checked at invocation time, not just
    // when the button was rendered. Backend validates it AGAIN before dispatch.
    let room = {
        let state = app.state::<MediaRooms>();
        let all = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = all.get(&server_id).ok_or("Неизвестный Backend")?;
        if entry.view.phase != "ready" { return Err("Медиакомнаты ещё не синхронизированы".into()); }
        entry.view.rooms.iter().find(|r| r.room_id == room_id
            && r.target.device_id == device_id
            && r.playback_id == playback_id && r.generation == generation)
            .cloned().ok_or("STALE_PLAYBACK: состояние комнаты изменилось")?
    };
    let data = match action.as_str() {
        "stop" if volume.is_none() && muted.is_none() && position_ms.is_none() =>
            json!({"command_id":command_id(),"room_id":room_id}),
        "seek" if volume.is_none() && muted.is_none() && position_ms.is_some_and(|n| (0..=MAX_SEEK_MS).contains(&n))
            && room.room_state == "ACTIVE" && room.tv_attach == "READY" =>
            json!({"command_id":command_id(),"room_id":room_id,"playback_id":playback_id,"generation":generation,"position_ms":position_ms}),
        "pause" | "resume" | "play" if volume.is_none() && muted.is_none() && position_ms.is_none()
            && room.room_state == "ACTIVE" && room.tv_attach == "READY" =>
            json!({"command_id":command_id(),"room_id":room_id,"playback_id":playback_id,"generation":generation,"action":action}),
        "volume" if muted.is_none() && position_ms.is_none() && volume.is_some_and(|n| (0..=100).contains(&n))
            && room.room_state == "ACTIVE" && room.tv_attach == "READY" =>
            json!({"command_id":command_id(),"room_id":room_id,"playback_id":playback_id,"generation":generation,"action":action,"volume":volume}),
        "mute" if volume.is_none() && position_ms.is_none() && muted.is_some()
            && room.room_state == "ACTIVE" && room.tv_attach == "READY" =>
            json!({"command_id":command_id(),"room_id":room_id,"playback_id":playback_id,"generation":generation,"action":action,"muted":muted}),
        _ => return Err("Недопустимая команда или комната ещё не готова".into()),
    };
    let endpoint = match action.as_str() {
        "stop" => "media.rooms.stop",
        "seek" => "media.rooms.seek",
        _ => "media.room.control",
    };
    crate::storage::request_media(&app, &server_id, endpoint, data).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn room(instance: &str, sequence: u64) -> MediaRoom {
        serde_json::from_value(json!({
            "room_id":"room-1", "playback_id":"play-1", "generation":1,
            "instance_id":instance, "sequence":sequence, "revision":1,
            "target":{"node_id":"n","device_id":"tv-a"},
            "room_state":"ACTIVE", "playback_state":"PAUSED", "tv_attach":"READY",
            "position_ms":42
        })).unwrap()
    }
    #[test]
    fn snapshot_applies_buffered_events_but_not_old_ones() {
        let mut entry = ServerState::new("primary");
        entry.reset("loading");
        entry.pending.push(("media.room.changed".into(),room("instance-a",6)));
        entry.pending.push(("media.room.changed".into(),room("instance-a",7)));
        apply_bundle(&mut entry,RoomBundle{schema_version:1,instance_id:"instance-a".into(),sequence:6,rooms:vec![room("instance-a",6)]}).unwrap();
        assert_eq!(entry.view.sequence,7);
        assert_eq!(entry.view.rooms[0].sequence,7);
    }
    #[test]
    fn closes_room_and_fences_stale_sequence() {
        let mut state = ServerState::new("primary");
        apply_bundle(&mut state,RoomBundle{schema_version:1,instance_id:"i".into(),sequence:4,rooms:vec![room("i",4)]}).unwrap();
        apply_one(&mut state.view,"media.room.closed",room("i",5)).unwrap();
        assert!(state.view.rooms.is_empty());
        apply_one(&mut state.view,"media.room.changed",room("i",4)).unwrap();
        assert!(state.view.rooms.is_empty());
        assert!(apply_one(&mut state.view,"media.room.changed",room("different",6)).is_err());
        assert!(apply_one(&mut state.view,"media.room.changed",room("i",7)).is_err());
    }
    #[test]
    fn disconnect_invalidates_old_async_snapshot() {
        let mut state = ServerState::new("primary");
        state.reset("loading");
        let old_epoch = state.epoch;
        state.reset("offline");
        assert_ne!(old_epoch,state.epoch);
        assert_eq!(state.view.phase,"offline");
        assert!(state.view.rooms.is_empty());
    }
}
