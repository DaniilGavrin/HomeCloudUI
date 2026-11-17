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
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MIN_PIN_LENGTH: usize = 4;
const MAX_PIN_LENGTH: usize = 12;
const MAX_PIN_ATTEMPTS: u8 = 3;
const LOCKOUT_SECONDS: u64 = 10 * 60;
const CONFIG_FILE: &str = "shell-security.json";
const ATTEMPTS_FILE: &str = "shell-security-attempts.json";

static SECURITY_LOCK: Mutex<()> = Mutex::new(());
static VERIFY_ATTEMPTS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SecurityConfig {
    pin_length: u8,
    password_hash: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct VerifyAttempts {
    failures: u8,
    blocked_until_unix: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct SecurityStatus {
    enabled: bool,
    pin_length: Option<u8>,
    attempts_remaining: u8,
    lockout_remaining_secs: u64,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(CONFIG_FILE))
}

fn attempts_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(ATTEMPTS_FILE))
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_attempts(app: &AppHandle) -> Result<VerifyAttempts, String> {
    match fs::read(attempts_path(app)?) {
        Ok(bytes) => {
            let attempts: VerifyAttempts = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Не удалось прочитать состояние защиты PIN: {error}"))?;
            if attempts.failures > MAX_PIN_ATTEMPTS {
                return Err("Некорректное состояние защиты PIN".into());
            }
            Ok(attempts)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(VerifyAttempts::default()),
        Err(error) => Err(format!("Не удалось прочитать состояние защиты PIN: {error}")),
    }
}

fn write_attempts(app: &AppHandle, attempts: &VerifyAttempts) -> Result<(), String> {
    let bytes = serde_json::to_vec(attempts).map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(attempts_path(app)?).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn reset_attempts(app: &AppHandle) -> Result<(), String> {
    let _guard = VERIFY_ATTEMPTS_LOCK
        .lock()
        .map_err(|_| "Не удалось получить блокировку состояния PIN")?;
    write_attempts(app, &VerifyAttempts::default())
}

fn current_lockout(attempts: &VerifyAttempts) -> u64 {
    attempts
        .blocked_until_unix
        .unwrap_or_default()
        .saturating_sub(now_unix_secs())
}

fn read_config(app: &AppHandle) -> Result<Option<SecurityConfig>, String> {
    match fs::read(config_path(app)?) {
        Ok(bytes) => {
            let config: SecurityConfig = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Не удалось прочитать настройки безопасности: {error}"))?;
            if !(MIN_PIN_LENGTH..=MAX_PIN_LENGTH).contains(&usize::from(config.pin_length)) {
                return Err("Некорректная длина PIN в настройках безопасности".into());
            }
            PasswordHash::new(&config.password_hash)
                .map_err(|error| format!("Некорректный хеш PIN: {error}"))?;
            Ok(Some(config))
        }
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

    fs::rename(&temporary, &path).map_err(|error| error.to_string())
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

fn verify_pin_with_limit(app: &AppHandle, config: &SecurityConfig, pin: &str) -> Result<bool, String> {
    let _guard = VERIFY_ATTEMPTS_LOCK
        .lock()
        .map_err(|_| "Не удалось получить блокировку проверки PIN")?;
    let mut attempts = read_attempts(app)?;
    let remaining = current_lockout(&attempts);
    if remaining > 0 {
        return Err(format!("Слишком много попыток. Повторите через {remaining} сек."));
    }

    if attempts.blocked_until_unix.is_some() {
        attempts = VerifyAttempts::default();
    }

    if pin_matches(config, pin) {
        write_attempts(app, &VerifyAttempts::default())?;
        return Ok(true);
    }

    attempts.failures = attempts.failures.saturating_add(1);
    if attempts.failures >= MAX_PIN_ATTEMPTS {
        attempts.blocked_until_unix = Some(now_unix_secs().saturating_add(LOCKOUT_SECONDS));
    }
    write_attempts(app, &attempts)?;
    Ok(false)
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
    let _guard = VERIFY_ATTEMPTS_LOCK
        .lock()
        .map_err(|_| "Не удалось получить блокировку состояния PIN")?;
    let mut attempts = read_attempts(&app)?;
    let lockout_remaining_secs = current_lockout(&attempts);
    if attempts.blocked_until_unix.is_some() && lockout_remaining_secs == 0 {
        attempts = VerifyAttempts::default();
        write_attempts(&app, &attempts)?;
    }

    Ok(SecurityStatus {
        enabled: config.is_some(),
        pin_length: config.map(|value| value.pin_length),
        attempts_remaining: if lockout_remaining_secs > 0 {
            0
        } else {
            MAX_PIN_ATTEMPTS.saturating_sub(attempts.failures)
        },
        lockout_remaining_secs,
    })
}

#[tauri::command]
pub fn shell_security_set_pin(app: AppHandle, pin: String, pin_length: u8) -> Result<(), String> {
    let _guard = SECURITY_LOCK.lock().map_err(|_| "Не удалось получить блокировку настроек безопасности")?;
    validate_pin(&pin, Some(pin_length))?;
    if read_config(&app)?.is_some() {
        return Err("PIN уже установлен".into());
    }
    write_config(&app, &make_config(&pin)?)?;
    reset_attempts(&app)
}

#[tauri::command]
pub fn shell_security_verify_pin(app: AppHandle, pin: String) -> Result<bool, String> {
    let Some(config) = read_config(&app)? else {
        return Ok(false);
    };
    verify_pin_with_limit(&app, &config, &pin)
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
    if !verify_pin_with_limit(&app, &config, &current_pin)? {
        return Err("Текущий PIN введён неверно".into());
    }
    write_config(&app, &make_config(&new_pin)?)?;
    reset_attempts(&app)
}

#[tauri::command]
pub fn shell_security_remove_pin(app: AppHandle, current_pin: String) -> Result<(), String> {
    let _guard = SECURITY_LOCK.lock().map_err(|_| "Не удалось получить блокировку настроек безопасности")?;
    let Some(config) = read_config(&app)? else {
        return Err("PIN ещё не установлен".into());
    };
    if !verify_pin_with_limit(&app, &config, &current_pin)? {
        return Err("Текущий PIN введён неверно".into());
    }
    fs::remove_file(config_path(&app)?).map_err(|error| error.to_string())?;
    reset_attempts(&app)
}
