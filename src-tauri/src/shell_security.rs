use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};

static SECURITY_LOCK: Mutex<()> = Mutex::new(());
use tauri::{AppHandle, Manager};

const MIN_PIN_LENGTH: usize = 4;
const MAX_PIN_LENGTH: usize = 12;
const CONFIG_FILE: &str = "shell-security.json";

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SecurityConfig {
    pin_length: u8,
    password_hash: String,
}

#[derive(Debug, Serialize)]
pub struct SecurityStatus {
    enabled: bool,
    pin_length: Option<u8>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(CONFIG_FILE))
}

fn read_config(app: &AppHandle) -> Result<Option<SecurityConfig>, String> {
    let path = config_path(app)?;
    match fs::read(path) {
        Ok(bytes) => {
            let config: SecurityConfig = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Не удалось прочитать настройки безопасности: {error}"))?;
            if !(MIN_PIN_LENGTH..=MAX_PIN_LENGTH).contains(&usize::from(config.pin_length)) {
                return Err("Некорректная длина PIN в настройках безопасности".into());
            }
            PasswordHash::new(&config.password_hash)
                .map_err(|error| format!("Некорректный хеш PIN: {error}"))?;
            Ok(Some(config))
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Не удалось прочитать настройки безопасности: {error}")),
    }
}

fn write_config(app: &AppHandle, config: &SecurityConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(config).map_err(|error| error.to_string())?;

    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }

    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_pin(pin: &str, expected_length: Option<u8>) -> Result<(), String> {
    if !(MIN_PIN_LENGTH..=MAX_PIN_LENGTH).contains(&pin.len())
        || !pin.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("PIN должен содержать от 4 до 12 цифр".into());
    }
    if let Some(length) = expected_length {
        if pin.len() != usize::from(length) {
            return Err("Длина PIN не совпадает с выбранной".into());
        }
    }
    Ok(())
}

fn make_config(pin: &str) -> Result<SecurityConfig, String> {
    validate_pin(pin, None)?;
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|error| format!("Не удалось создать хеш PIN: {error}"))?
        .to_string();

    Ok(SecurityConfig {
        pin_length: pin.len() as u8,
        password_hash,
    })
}

fn pin_matches(config: &SecurityConfig, pin: &str) -> bool {
    if validate_pin(pin, Some(config.pin_length)).is_err() {
        return false;
    }
    let Ok(hash) = PasswordHash::new(&config.password_hash) else {
        return false;
    };
    Argon2::default().verify_password(pin.as_bytes(), &hash).is_ok()
}

#[tauri::command]
pub fn shell_security_status(app: AppHandle) -> Result<SecurityStatus, String> {
    let config = read_config(&app)?;
    Ok(match config {
        Some(config) => SecurityStatus {
            enabled: true,
            pin_length: Some(config.pin_length),
        },
        None => SecurityStatus {
            enabled: false,
            pin_length: None,
        },
    })
}

#[tauri::command]
pub fn shell_security_set_pin(app: AppHandle, pin: String, pin_length: u8) -> Result<(), String> {
    let _guard = SECURITY_LOCK.lock().map_err(|_| "Не удалось получить блокировку настроек безопасности")?;
    validate_pin(&pin, Some(pin_length))?;
    if read_config(&app)?.is_some() {
        return Err("PIN уже установлен".into());
    }
    write_config(&app, &make_config(&pin)?)
}

#[tauri::command]
pub fn shell_security_verify_pin(app: AppHandle, pin: String) -> Result<bool, String> {
    let Some(config) = read_config(&app)? else {
        return Ok(false);
    };
    Ok(pin_matches(&config, &pin))
}

#[tauri::command]
pub fn shell_security_change_pin(
    app: AppHandle,
    current_pin: String,
    new_pin: String,
    pin_length: u8,
) -> Result<(), String> {
    let _guard = SECURITY_LOCK.lock().map_err(|_| "Не удалось получить блокировку настроек безопасности")?;
    validate_pin(&new_pin, Some(pin_length))?;
    let Some(config) = read_config(&app)? else {
        return Err("PIN ещё не установлен".into());
    };
    if !pin_matches(&config, &current_pin) {
        return Err("Текущий PIN введён неверно".into());
    }
    write_config(&app, &make_config(&new_pin)?)
}

#[tauri::command]
pub fn shell_security_remove_pin(app: AppHandle, current_pin: String) -> Result<(), String> {
    let _guard = SECURITY_LOCK.lock().map_err(|_| "Не удалось получить блокировку настроек безопасности")?;
    let Some(config) = read_config(&app)? else {
        return Err("PIN ещё не установлен".into());
    };
    if !pin_matches(&config, &current_pin) {
        return Err("Текущий PIN введён неверно".into());
    }
    let path = config_path(&app)?;
    fs::remove_file(path).map_err(|error| error.to_string())
}
