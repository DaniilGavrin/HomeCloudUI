//! Remember devices seen by each HomeCloudBackend. A disconnected client is
//! offline, not forgotten. Only this Rust store owns persistent device records.
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};

const EVENT: &str = "homecloud:device-registry";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceRecord {
    pub server_id: String,
    pub device_id: String,
    pub client_type: String,
    pub online: bool,
    pub last_seen_at: Option<u64>,
}

#[derive(Clone, Serialize)]
pub struct DeviceRegistrySnapshot {
    pub devices: Vec<DeviceRecord>,
    pub revision: u64,
}

pub struct DeviceRegistry {
    file: PathBuf,
    inner: Mutex<DeviceRegistrySnapshot>,
    local_id: String,
}

fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn save(file: &PathBuf, data: &[DeviceRecord]) -> Result<(), String> {
    let dir = file.parent().ok_or("Каталог реестра устройств не найден")?;
    fs::create_dir_all(dir).map_err(|e| format!("Каталог устройств: {e}"))?;
    let tmp = file.with_extension("json.tmp");
    let bak = file.with_extension("json.bak");
    let bytes = serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| format!("Запись устройств: {e}"))?;
    if file.exists() {
        let _ = fs::remove_file(&bak);
        if let Err(e) = fs::rename(file, &bak) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("Резервная копия устройств: {e}"));
        }
    }
    if let Err(e) = fs::rename(&tmp, file) {
        if bak.exists() { let _ = fs::rename(&bak, file); }
        return Err(format!("Сохранение устройств: {e}"));
    }
    let _ = fs::remove_file(&bak);
    Ok(())
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let file = app.path().app_config_dir().map_err(|e| e.to_string())?.join("device-registry.json");
    let backup = file.with_extension("json.bak");
    if !file.exists() && backup.exists() {
        fs::copy(&backup, &file).map_err(|e| format!("Восстановление устройств: {e}"))?;
    }
    let mut devices: Vec<DeviceRecord> = if file.exists() {
        serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Ошибка реестра устройств: {e}"))?
    } else { Vec::new() };
    // A process restart cannot prove a previous connection is still alive.
    devices.retain(|d| !d.server_id.is_empty() && !d.device_id.is_empty());
    devices.sort_by(|a, b| (&a.server_id, &a.device_id).cmp(&(&b.server_id, &b.device_id)));
    devices.dedup_by(|a, b| a.server_id == b.server_id && a.device_id == b.device_id);
    for device in &mut devices { device.online = false; }
    let identity_path = file.with_file_name("homecloud-ui-device-id.txt");
    let local_id = fs::read_to_string(&identity_path).ok()
        .filter(|value| value.starts_with("homecloud-ui-") && value.len() <= 90
            && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        .unwrap_or_else(|| format!("homecloud-ui-{}-{}", std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
    fs::create_dir_all(file.parent().ok_or("Каталог приложения не найден")?)
        .map_err(|e| e.to_string())?;
    fs::write(&identity_path, &local_id).map_err(|e| format!("Сохранение ID HomeCloud UI: {e}"))?;
    app.manage(DeviceRegistry { file, inner: Mutex::new(DeviceRegistrySnapshot { devices, revision: 0 }), local_id });
    Ok(())
}

pub fn local_device_id(app: &AppHandle) -> String {
    app.state::<DeviceRegistry>().local_id.clone()
}

#[tauri::command]
pub fn homecloud_device_registry_status(app: AppHandle) -> DeviceRegistrySnapshot {
    app.state::<DeviceRegistry>().inner.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn edit(app: &AppHandle, mutator: impl FnOnce(&mut Vec<DeviceRecord>) -> Result<bool, String>) -> Result<(), String> {
    let next = {
        let registry = app.state::<DeviceRegistry>();
        let mut state = registry.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut records = state.devices.clone();
        if !mutator(&mut records)? { return Ok(()); }
        records.sort_by(|a, b| (&a.server_id, &a.device_id).cmp(&(&b.server_id, &b.device_id)));
        save(&registry.file, &records)?;
        state.devices = records;
        state.revision = state.revision.wrapping_add(1);
        state.clone()
    };
    let _ = app.emit(EVENT, next);
    Ok(())
}

fn apply_device(devices: &mut Vec<DeviceRecord>, server_id: &str, device_id: &str, client_type: &str, online: bool) -> bool {
    if device_id.is_empty() { return false; }
    if let Some(old) = devices.iter_mut().find(|d| d.server_id == server_id && d.device_id == device_id) {
        let changed = old.online != online || (online && old.client_type != client_type);
        if changed {
            old.online = online;
            old.last_seen_at = Some(now_seconds());
            if online { old.client_type = client_type.to_owned(); }
        }
        changed
    } else if online {
        devices.push(DeviceRecord {
            server_id: server_id.to_owned(), device_id: device_id.to_owned(),
            client_type: client_type.to_owned(), online: true, last_seen_at: Some(now_seconds()),
        });
        true
    } else { false }
}

pub fn reconcile(app: &AppHandle, server_id: &str, active: &[(String, String)]) {
    if let Err(e) = edit(app, |all| {
        let mut changed = false;
        for old in all.iter_mut().filter(|d| d.server_id == server_id && d.online) {
            if !active.iter().any(|(id, _)| id == &old.device_id) {
                old.online = false;
                old.last_seen_at = Some(now_seconds());
                changed = true;
            }
        }
        for (id, kind) in active {
            changed |= apply_device(all, server_id, id, kind, true);
        }
        Ok(changed)
    }) { eprintln!("[Devices] Failed to persist snapshot: {e}"); }
}

pub fn event(app: &AppHandle, server_id: &str, device_id: &str, client_type: &str, connected: bool) {
    if let Err(e) = edit(app, |all| Ok(apply_device(all, server_id, device_id, client_type, connected))) {
        eprintln!("[Devices] Failed to persist event: {e}");
    }
}

pub fn disconnected(app: &AppHandle, server_id: &str) {
    if let Err(e) = edit(app, |all| {
        let mut changed = false;
        for device in all.iter_mut().filter(|d| d.server_id == server_id && d.online) {
            device.online = false;
            device.last_seen_at = Some(now_seconds());
            changed = true;
        }
        Ok(changed)
    }) { eprintln!("[Devices] Failed to mark offline: {e}"); }
}

// Repointing a server at a different address means a different identity.
// Cached devices from the former endpoint must not be attributed to the new one.
pub fn forget_server(app: &AppHandle, server_id: &str) -> Result<(), String> {
    edit(app, |all| {
        let old = all.len();
        all.retain(|d| d.server_id != server_id);
        Ok(old != all.len())
    })
}

#[tauri::command]
pub fn homecloud_device_forget(app: AppHandle, server_id: String, device_id: String) -> Result<(), String> {
    edit(&app, |all| {
        let position = all.iter().position(|d| d.server_id == server_id && d.device_id == device_id)
            .ok_or("Устройство не найдено")?;
        if all[position].online { return Err("Нельзя удалить устройство, пока оно подключено".into()); }
        all.remove(position);
        Ok(true)
    })
}

#[tauri::command]
pub fn homecloud_device_refresh(app: AppHandle, server_id: String) -> Result<(), String> {
    if server_id == "primary" {
        let manager = app.state::<crate::homecloud_ws::ConnectionManager>();
        crate::homecloud_ws::refresh_devices(&manager)
    } else {
        crate::server_pool::refresh_devices(&app, &server_id)
    }
}

#[tauri::command]
pub async fn homecloud_device_send(app: AppHandle, server_id: String, device_id: String, payload: serde_json::Value) -> Result<String, String> {
    if !payload.is_object() { return Err("Сообщение должно быть JSON-объектом".into()); }
    {
        let registry = app.state::<DeviceRegistry>();
        let state = registry.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !state.devices.iter().any(|d| d.server_id == server_id && d.device_id == device_id && d.online) {
            return Err("Устройство не подключено к указанному серверу".into());
        }
    }
    if server_id == "primary" {
        crate::homecloud_ws::send_to_device(&app, device_id, payload).await
    } else {
        crate::server_pool::send_to_device(&app, &server_id, device_id, payload).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identities_are_server_scoped() {
        let mut rows = Vec::new();
        assert!(apply_device(&mut rows, "primary", "tv", "television", true));
        assert!(apply_device(&mut rows, "node-2", "tv", "desktop", true));
        assert_eq!(rows.len(), 2);
        assert!(apply_device(&mut rows, "primary", "tv", "television", false));
        assert!(!rows[0].online);
        assert!(rows[1].online);
        assert!(!apply_device(&mut rows, "primary", "never-seen", "tv", false));
    }
}
