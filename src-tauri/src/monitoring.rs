//! CPU telemetry subscription routing for configured HomeCloud nodes.
//! The existing ServerPool WebSocket remains the sole transport owner.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

pub const EVENT: &str = "homecloud:monitoring";
const SECTIONS: &[&str] = &[
    "overview", "cpu", "ram", "gpu", "disks", "network", "processes",
    "services", "load", "sensors", "system", "events", "history", "nodes",
];

struct ActiveNode {
    section: Option<String>,
    sender: Option<watch::Sender<Option<String>>>,
    perf_enabled: bool,
    perf_sender: Option<watch::Sender<bool>>,
    generation: u64,
}

#[derive(Default)]
pub struct MonitoringManager {
    nodes: Mutex<HashMap<String, ActiveNode>>,
    next_generation: AtomicU64,
}

pub struct MonitoringSession {
    app: AppHandle,
    server_id: String,
    generation: u64,
    pub active: watch::Receiver<Option<String>>,
    pub perf_enabled: watch::Receiver<bool>,
}

impl Drop for MonitoringSession {
    fn drop(&mut self) {
        let manager = self.app.state::<MonitoringManager>();
        let mut nodes = manager.nodes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(node) = nodes.get_mut(&self.server_id) {
            if node.generation == self.generation {
                node.sender = None;
                node.perf_sender = None;
            }
        }
    }
}

#[tauri::command]
pub fn homecloud_monitoring_set_active(
    app: AppHandle,
    server_id: String,
    section: Option<String>,
) -> Result<(), String> {
    if server_id.trim().is_empty() {
        return Err("Не указан сервер мониторинга".into());
    }
    if let Some(value) = section.as_deref() {
        if !SECTIONS.contains(&value) {
            return Err("Неизвестный раздел мониторинга".into());
        }
    }

    let exists = {
        let pool = app.state::<crate::server_pool::ServerPool>();
        let snapshot = pool.inner.lock().unwrap_or_else(|e| e.into_inner());
        snapshot.servers.iter().any(|node| node.entry.id == server_id)
    };
    if !exists {
        return Err("Сервер мониторинга не найден".into());
    }

    let manager = app.state::<MonitoringManager>();
    let mut nodes = manager.nodes.lock().unwrap_or_else(|e| e.into_inner());
    let node = nodes.entry(server_id.clone()).or_insert(ActiveNode {
        section: None,
        sender: None,
        perf_enabled: false,
        perf_sender: None,
        generation: 0,
    });
    node.section = section.clone();
    if section.as_deref() != Some("cpu") {
        node.perf_enabled = false;
        if let Some(sender) = &node.perf_sender {
            sender.send_replace(false);
        }
    }
    crate::diagnostics::log("INFO", &format!("Monitoring active section changed server_id={} section={:?}", server_id, section));
    if let Some(sender) = &node.sender {
        sender.send_replace(section);
    }
    Ok(())
}

#[tauri::command]
pub fn homecloud_monitoring_set_perf_enabled(
    app: AppHandle,
    server_id: String,
    enabled: bool,
) -> Result<(), String> {
    if server_id.trim().is_empty() {
        return Err("Не указан сервер мониторинга".into());
    }
    let exists = {
        let pool = app.state::<crate::server_pool::ServerPool>();
        let snapshot = pool.inner.lock().unwrap_or_else(|e| e.into_inner());
        snapshot.servers.iter().any(|node| node.entry.id == server_id)
    };
    if !exists {
        return Err("Сервер мониторинга не найден".into());
    }

    let manager = app.state::<MonitoringManager>();
    let mut nodes = manager.nodes.lock().unwrap_or_else(|e| e.into_inner());
    let node = nodes.get_mut(&server_id).ok_or("Сессия Monitoring не активна")?;
    if enabled && node.section.as_deref() != Some("cpu") {
        return Err("PMU можно включить только на экране CPU".into());
    }
    node.perf_enabled = enabled;
    if let Some(sender) = &node.perf_sender {
        sender.send_replace(enabled);
    }
    crate::diagnostics::log("INFO", &format!("Monitoring CPU PMU changed server_id={} enabled={}", server_id, enabled));
    Ok(())
}

pub fn attach(app: &AppHandle, server_id: &str) -> MonitoringSession {
    let manager = app.state::<MonitoringManager>();
    let mut nodes = manager.nodes.lock().unwrap_or_else(|e| e.into_inner());
    let generation = manager.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let node = nodes.entry(server_id.to_owned()).or_insert(ActiveNode {
        section: None,
        sender: None,
        generation: 0,
    });
    crate::diagnostics::log("INFO", &format!("Monitoring session attached server_id={} section={:?}", server_id, node.section));
    let (sender, active) = watch::channel(node.section.clone());
    let (perf_sender, perf_enabled) = watch::channel(node.perf_enabled);
    node.sender = Some(sender);
    node.perf_sender = Some(perf_sender);
    node.generation = generation;
    MonitoringSession {
        app: app.clone(),
        server_id: server_id.to_owned(),
        generation,
        active,
        perf_enabled,
    }
}

pub fn clear_server(app: &AppHandle, server_id: &str) {
    let manager = app.state::<MonitoringManager>();
    manager.nodes.lock().unwrap_or_else(|e| e.into_inner()).remove(server_id);
}

pub fn node_id(app: &AppHandle, server_id: &str) -> Option<String> {
    let pool = app.state::<crate::server_pool::ServerPool>();
    let snapshot = pool.inner.lock().unwrap_or_else(|e| e.into_inner());
    snapshot.servers.iter()
        .find(|node| node.entry.id == server_id)?
        .data.as_ref()?
        .get("node_id")?
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

pub fn publish(app: &AppHandle, server_id: &str, target: &str, kind: &str, node_id: Option<&str>, mut payload: Value) {
    // Preserve exact integer counters across the Rust -> JavaScript boundary.
    // Tauri events are decoded as JS Numbers, which cannot represent every u64.
    if kind == "update" {
        if let Some(items) = payload.get_mut("items").and_then(Value::as_array_mut) {
            for item in items {
                let unit = item.get("unit").and_then(Value::as_str).unwrap_or("");
                if unit != "ns" && unit != "count" {
                    continue;
                }
                if let Some(value) = item.get("value").and_then(Value::as_u64) {
                    item["value"] = Value::String(value.to_string());
                } else if let Some(value) = item.get("value").and_then(Value::as_i64) {
                    item["value"] = Value::String(value.to_string());
                }
            }
        }
    }

    // The base system.cpu group already contains totalusage. Reuse that
    // sample for the always-visible server panel instead of maintaining a
    // second Backend subscription while the CPU page is open.
    let panel_payload = if target == "system.cpu" {
        shared_cpu_panel_payload(kind, &payload)
    } else {
        None
    };

    if kind != "update" {
        crate::diagnostics::log(
            if kind == "error" { "ERROR" } else { "INFO" },
            &format!("Monitoring event server_id={} target={} kind={}", server_id, target, kind),
        );
    }
    emit_monitoring_event(app, server_id, target, kind, node_id, payload);
    if let Some(panel_payload) = panel_payload {
        emit_monitoring_event(app, server_id, "system.cpu.totalusage", kind, node_id, panel_payload);
    }
}

fn shared_cpu_panel_payload(kind: &str, payload: &Value) -> Option<Value> {
    match kind {
        "update" => {
            let mut panel = payload.clone();
            if let Some(items) = panel.get_mut("items").and_then(Value::as_array_mut) {
                items.retain(|item| item.get("metric_id").and_then(Value::as_str) == Some("system.cpu.totalusage"));
            }
            if panel.get("items").and_then(Value::as_array).is_some_and(|items| !items.is_empty()) {
                Some(panel)
            } else {
                None
            }
        }
        "created" | "error" => Some(payload.clone()),
        _ => None,
    }
}

fn emit_monitoring_event(
    app: &AppHandle,
    server_id: &str,
    target: &str,
    kind: &str,
    node_id: Option<&str>,
    payload: Value,
) {
    let event = json!({
        "server_id": server_id,
        "kind": kind,
        "target": target,
        "node_id": node_id,
        "payload": payload,
    });
    if let Err(error) = app.emit(EVENT, event) {
        crate::diagnostics::log(
            "ERROR",
            &format!("Monitoring event emit failed server_id={} target={} kind={} error={}", server_id, target, kind, error),
        );
    }
}

#[tauri::command]
pub async fn homecloud_monitoring_get_topology(
    app: AppHandle,
    server_id: String,
) -> Result<Value, String> {
    if server_id.trim().is_empty() {
        return Err("Не указан сервер мониторинга".into());
    }
    let exists = {
        let pool = app.state::<crate::server_pool::ServerPool>();
        let snapshot = pool.inner.lock().unwrap_or_else(|e| e.into_inner());
        snapshot.servers.iter().any(|node| node.entry.id == server_id)
    };
    if !exists {
        return Err("Сервер мониторинга не найден".into());
    }
    crate::storage::request_cpu_topology(&app, &server_id).await
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serde_json::json;

    #[test]
    fn shared_cpu_panel_update_contains_only_total_usage() {
        let payload = json!({
            "subscription_id": "sub-cpu",
            "items": [
                {"metric_id": "system.cpu.totalusage", "value": 42.5},
                {"metric_id": "system.cpu.user", "value": "123456"},
                {"metric_id": "system.cpu.frequency.current", "value": 2400000000}
            ]
        });
        let panel = shared_cpu_panel_payload("update", &payload).expect("panel sample");
        let items = panel["items"].as_array().expect("items array");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["metric_id"], "system.cpu.totalusage");
        assert_eq!(panel["subscription_id"], "sub-cpu");
    }

    #[test]
    fn shared_cpu_panel_omits_updates_without_total_usage() {
        let payload = json!({
            "items": [{"metric_id": "system.cpu.user", "value": "123456"}]
        });
        assert!(shared_cpu_panel_payload("update", &payload).is_none());
    }

    #[test]
    fn shared_cpu_panel_forwards_subscription_lifecycle_events() {
        let payload = json!({"subscription_id": "sub-cpu"});
        assert_eq!(shared_cpu_panel_payload("created", &payload), Some(payload.clone()));
        assert_eq!(shared_cpu_panel_payload("error", &payload), Some(payload));
    }
}
