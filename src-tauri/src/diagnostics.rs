//! Small always-on diagnostic logger for packaged desktop builds.
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

static LOG_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;

fn path_slot() -> &'static Mutex<Option<PathBuf>> {
    LOG_PATH.get_or_init(|| Mutex::new(None))
}

pub fn initialize(app: &tauri::App) -> Result<PathBuf, String> {
    use tauri::Manager;

    let directory = app.path().app_log_dir().map_err(|e| format!("Resolve app log directory: {e}"))?;
    fs::create_dir_all(&directory).map_err(|e| format!("Create app log directory: {e}"))?;
    let path = directory.join("monitoring.log");
    {
        let mut slot = path_slot().lock().unwrap_or_else(|e| e.into_inner());
        *slot = Some(path.clone());
    }
    log("INFO", &format!("diagnostics initialized path={}", path.display()));
    Ok(path)
}

pub fn log(level: &str, message: &str) {
    let slot = path_slot().lock().unwrap_or_else(|e| e.into_inner());
    let Some(path) = slot.as_ref() else {
        eprintln!("[HomeCloud Diagnostics][{level}] {message}");
        return;
    };

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!("{timestamp_ms} [{level}] {message}\n");

    let result = (|| -> std::io::Result<()> {
        if fs::metadata(&path).map(|m| m.len() >= MAX_LOG_BYTES).unwrap_or(false) {
            let previous = path.with_extension("log.1");
            let _ = fs::remove_file(&previous);
            fs::rename(&path, previous)?;
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        file.write_all(line.as_bytes())?;
        file.flush()
    })();

    if let Err(error) = result {
        eprintln!("[HomeCloud Diagnostics] cannot write log: {error}; {message}");
    }
}
