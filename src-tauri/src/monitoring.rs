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
}

impl Drop for MonitoringSession {
    fn drop(&mut self) {
        let manager = self.app.state::<MonitoringManager>();
        let mut nodes = manager.nodes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(node) = nodes.get_mut(&self.server_id) {
            if node.generation == self.generation {
                node.sender = None;
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
        generation: 0,
    });
    node.section = section.clone();
    crate::diagnostics::log("INFO", &format!("Monitoring active section changed server_id={} section={:?}", server_id, section));
    if let Some(sender) = &node.sender {
        sender.send_replace(section);
    }
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
    node.sender = Some(sender);
    node.generation = generation;
    MonitoringSession {
        app: app.clone(),
        server_id: server_id.to_owned(),
        generation,
        active,
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

pub fn publish(app: &AppHandle, server_id: &str, target: &str, kind: &str, node_id: Option<&str>, payload: Value) {
    let mut payload = payload;
    // Keep cumulative nanosecond counters exact across the Rust -> JavaScript
    // boundary. UI formatting uses BigInt rather than lossy JS Number values.
    if kind == "update" {
        if let Some(items) = payload.get_mut("items").and_then(Value::as_array_mut) {
            for item in items {
                let metric = item.get("metric_id").and_then(Value::as_str).unwrap_or("");
                let is_nanosecond_counter = matches!(
                    metric,
                    "system.cpu.user"
                        | "system.cpu.system"
                        | "system.cpu.nice"
                        | "system.cpu.idle"
                        | "system.cpu.iowait"
                        | "system.cpu.irq"
                        | "system.cpu.softirq"
                        | "system.cpu.steal"
                        | "system.cpu.guest"
                        | "system.cpu.guest_nice"
                        | "system.cpu.core.user"
                );
                if is_nanosecond_counter {
                    if let Some(value) = item.get("value").and_then(Value::as_u64) {
                        item["value"] = Value::String(value.to_string());
                    }
                }
            }
        }
    }
    if target == "system.cpu" || target == "system.cpu.frequency" || target == "system.cpu.totalusage" {
        let summary = payload.get("items").and_then(Value::as_array).map(|items| {
            items.iter().map(|item| json!({
                "metric_id": item.get("metric_id").and_then(Value::as_str).unwrap_or(""),
                "object_id": item.get("object_id").and_then(Value::as_str),
            })).collect::<Vec<_>>()
        }).unwrap_or_default();
        crate::diagnostics::log(
            "INFO",
            &format!(
                "CPU emit server_id={} kind={} target={} subscription_id={} items={}",
                server_id, kind, target,
                payload.get("subscription_id").and_then(Value::as_str).unwrap_or(""),
                summary,
            ),
        );
    }
    let event = json!({
        "server_id": server_id,
        "kind": kind,
        "target": target,
        "node_id": node_id,
        "payload": payload,
    });
    match app.emit(EVENT, event) {
        Ok(()) if target.starts_with("system.cpu") => crate::diagnostics::log(
            "INFO",
            &format!("Tauri event emitted server_id={} target={} kind={}", server_id, target, kind),
        ),
        Ok(()) => {}
        Err(error) => crate::diagnostics::log(
            "ERROR",
            &format!("Tauri event emit failed server_id={} target={} kind={} error={}", server_id, target, kind, error),
        ),
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
