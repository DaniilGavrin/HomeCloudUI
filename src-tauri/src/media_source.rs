//! HC SS media-source browsing and TV playback creation.
//! The UI never talks to Storage Service or Media Gateway directly.
//! All control requests reuse the selected Backend's identified WebSocket.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

static PLAY_COUNTER: AtomicU64 = AtomicU64::new(0);

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256
        && value.trim() == value && !value.chars().any(char::is_control)
}

fn valid_root(kind: &str, id: &str) -> bool {
    matches!(kind, "disk" | "folder") && valid_identifier(id)
}

fn valid_relative_path(path: &str) -> bool {
    path.len() <= 1800 && !path.starts_with('/')
        && !path.contains('\\') && !path.contains(':')
        && !path.chars().any(char::is_control)
        && (path.is_empty() || path.split('/').all(|part| part != "." && part != ".." && !part.is_empty()))
}

fn valid_hcs1_id(id: &str) -> bool {
    (5..=2048).contains(&id.len())
        && id.starts_with("hc1.")
        && id["hc1.".len()..].bytes().all(|b|
            b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn new_command_id() -> String {
    let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("hc-ui-play-{epoch}-{}", PLAY_COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[tauri::command]
pub async fn homecloud_hcss_sources(app: AppHandle, server_id: String) -> Result<Value, String> {
    crate::storage::request_media(&app, &server_id, "storage.agent.status", json!({})).await
}

#[tauri::command]
pub async fn homecloud_hcss_browse(
    app: AppHandle, server_id: String, storage_node_id: String,
    root_kind: String, root_id: String, path: String, cursor: Option<String>,
) -> Result<Value, String> {
    if !valid_identifier(&storage_node_id) || !valid_root(&root_kind, &root_id)
        || !valid_relative_path(&path) {
        return Err("Недопустимый узел, корень или относительный путь HC SS".into());
    }
    let cursor = cursor.unwrap_or_default();
    if !cursor.is_empty() && (cursor.len()>5 || !cursor.bytes().all(|b| b.is_ascii_digit())
        || cursor.parse::<usize>().map_or(true, |n| n>20000)) {
        return Err("Недопустимый курсор каталога HC SS".into());
    }
    let mut request = json!({"storage_node_id":storage_node_id,
        "root":{"kind":root_kind,"id":root_id},"path":path,"limit":500});
    // Older Backends reject unknown JSON fields. Omit the cursor on page one.
    if !cursor.is_empty() { request["cursor"] = json!(cursor); }
    crate::storage::request_media(&app, &server_id, "storage.fs.list", request).await
}

#[tauri::command]
pub async fn homecloud_hcss_play(
    app: AppHandle, server_id: String, device_id: String,
    storage_node_id: String, file_id: String, network: String,
) -> Result<Value, String> {
    if !valid_identifier(&device_id) || !valid_identifier(&storage_node_id)
        || !valid_hcs1_id(&file_id) || !matches!(network.as_str(), "lan" | "tailscale") {
        return Err("Некорректный TV, HC SS file_id или тип сети".into());
    }
    // This local snapshot is deliberately scoped to one Backend and one TV.
    // It protects the switch-in-place path from affecting another TV.
    let view = crate::media_rooms::homecloud_media_status(app.clone(), server_id.clone());
    if view.phase != "ready" {
        return Err("Состояние медиакомнат не синхронизировано; обнови список".into());
    }
    let active_room = view.rooms.iter().find(|r| r.target.device_id == device_id);
    // Source node must be registered and responsive on the SAME Backend.
    let agents = crate::storage::request_media(&app, &server_id,
        "storage.agent.status", json!({})).await?;
    let source_online = agents.get("agents").and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|entry|
            entry.get("storage_node_id").and_then(Value::as_str) == Some(storage_node_id.as_str())
            && entry.get("online").and_then(Value::as_bool) == Some(true)));
    if !source_online {
        return Err("HC Storage Service Offline на выбранном Backend".into());
    }
    // The authoritative Backend node ID comes from its cluster runtime,
    // never from a guessed host name or storage ID.
    let cluster = crate::storage::request_media(&app, &server_id,
        "cluster.status", json!({})).await?;
    let node_id = cluster.get("node_id").and_then(Value::as_str)
        .filter(|id| valid_identifier(id))
        .ok_or("Backend не предоставил node_id через cluster.status")?;
    let room_id = active_room.map(|room| room.room_id.as_str()).unwrap_or("");
    let data = json!({
        "command_id": new_command_id(),
        "network": network,
        "room_id": room_id,
        "target": {"node_id": node_id, "device_id": device_id},
        "source": {"storage_node_id": storage_node_id, "file_id": file_id}
    });
    crate::storage::request_media(&app, &server_id, "media.rooms.play", data).await
}

#[cfg(test)]
mod tests {
    use super::{valid_hcs1_id, valid_identifier, valid_relative_path, valid_root};
    #[test]
    fn supports_root_relative_filenames_without_traversal() {
        assert!(valid_relative_path(""));
        assert!(valid_relative_path("films/Наше видео (2026).mkv"));
        assert!(!valid_relative_path("../secrets"));
        assert!(!valid_relative_path("films/../../secrets"));
        assert!(!valid_relative_path("/etc/shadow"));
        assert!(!valid_relative_path("a//b"));
        assert!(!valid_relative_path("a\\b"));
        assert!(!valid_relative_path("a:b"));
    }
    #[test]
    fn only_hcss_roots_and_hcs1_source_ids() {
        assert!(valid_root("disk", "storage-hdd"));
        assert!(valid_root("folder", "music"));
        assert!(!valid_root("disk", ""));
        assert!(!valid_root("root", "x"));
        assert!(valid_hcs1_id("hc1.YWJjZA"));
        assert!(!valid_hcs1_id("managed-storage-file"));
        assert!(!valid_hcs1_id("hc1.a/b"));
        assert!(!valid_identifier("device\nspoof"));
    }
}
