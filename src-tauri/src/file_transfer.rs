//! KAN-81: native HC SS file data-plane client.
//! File endpoints are discovered via Backend; no auth tokens or manual IP ACLs.
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{net::Ipv4Addr, path::PathBuf, sync::atomic::{AtomicU64, Ordering}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter};
use tokio::{fs::{self, File}, io::{AsyncReadExt, AsyncWriteExt}};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const FRAME: usize = 128 * 1024;
const FRAME_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_UPLOAD: u64 = 32 << 30;
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn valid_endpoint(endpoint: &str) -> bool {
    // Only exact private IPv4 endpoints; reject public/DNS/credential-bearing URLs.
    let Some(hostport) = endpoint.strip_prefix("ws://").and_then(|s| s.strip_suffix("/ws/files")) else {return false};
    let Some((host,port)) = hostport.rsplit_once(':') else {return false};
    let Ok(ip) = host.parse::<Ipv4Addr>() else {return false};
    let Ok(p) = port.parse::<u16>() else {return false};
    let bytes = ip.octets();
    p > 0 && (ip.is_private() || (bytes[0]==100 && (64..=127).contains(&bytes[1])) || ip.is_loopback())
}
fn valid_path(path: &str) -> bool {
    !path.is_empty() && path.len()<=1800 && !path.starts_with('/')
      && !path.contains('\\') && !path.contains(':') && !path.contains('\0')
      && path.split('/').all(|p| !p.is_empty() && p!="." && p!=".." && !p.starts_with(".hcss-upload-"))
}
fn valid_root(kind: &str, id: &str) -> bool {
    matches!(kind,"disk"|"folder") && !id.is_empty() && id.len()<=128
      && !id.contains('/') && !id.contains('\\') && !id.chars().any(char::is_control)
}
fn transfer_id() -> String {
    let ns=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("file-{}-{}",ns,COUNTER.fetch_add(1,Ordering::Relaxed))
}
type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn dial(endpoints: &[String]) -> Result<Socket,String> {
    // The host firewall is the network access boundary; Backend only provides
    // private file-data URLs. Try alternatives instead of forcing users to
    // configure LAN/Tailnet addresses and static keys.
    if endpoints.is_empty() {return Err("HC SS не опубликовал файловые адреса".into());}
    if endpoints.len()>16 {return Err("HC SS опубликовал слишком много файловых адресов".into());}
    let mut failures=Vec::new();
    for endpoint in endpoints {
        if !valid_endpoint(endpoint) {
            failures.push(format!("{endpoint}: неверный частный WS адрес"));
            continue;
        }
        match tokio::time::timeout(Duration::from_secs(5), connect_async(endpoint)).await {
            Ok(Ok((socket,_))) => return Ok(socket),
            Ok(Err(error)) => failures.push(format!("{endpoint}: {error}")),
            Err(_) => failures.push(format!("{endpoint}: тайм-аут соединения")),
        }
    }
    Err(format!("Нет соединения с файловым каналом HC SS. Проверь порт 8093 и firewall: {}",failures.join(" | ")))
}

async fn send(socket: &mut Socket, value: Value) -> Result<(),String> {
    tokio::time::timeout(FRAME_TIMEOUT,socket.send(Message::Text(value.to_string().into()))).await
        .map_err(|_|"Тайм-аут отправки команды")?.map_err(|e|e.to_string())
}
async fn next(socket: &mut Socket) -> Result<Message,String> {
    tokio::time::timeout(FRAME_TIMEOUT,socket.next()).await
        .map_err(|_|"Тайм-аут передачи файла")?
        .ok_or_else(||"HC SS закрыл соединение".to_owned())?.map_err(|e|e.to_string())
}
fn response(value: Message, expected: &str, id: &str) -> Result<Value,String> {
    let Message::Text(text)=value else {return Err("Ожидался JSON от HC SS".into())};
    let val:Value=serde_json::from_str(text.as_str()).map_err(|e|e.to_string())?;
    if val.get("id").and_then(Value::as_str)!=Some(id){return Err("HC SS ответил на другой запрос".into());}
    if val.get("type").and_then(Value::as_str)==Some("file.error") {
        return Err(format!("HC SS: {}",val.get("code").and_then(Value::as_str).unwrap_or("UNKNOWN")));
    }
    if val.get("type").and_then(Value::as_str)!=Some(expected) {
        return Err(format!("Неожиданный ответ HC SS: {}",val.get("type").and_then(Value::as_str).unwrap_or("?")));
    }
    Ok(val)
}
fn progress(app:&AppHandle,role:&str,done:u64,total:u64) {
    let _=app.emit("homecloud:hcss-transfer-progress",
        json!({"role":role,"completed_bytes":done,"total_bytes":total}));
}
fn local_path(value: Option<String>) -> Result<PathBuf,String> {
    let p=PathBuf::from(value.ok_or("Не выбран локальный файл")?);
    if p.as_os_str().is_empty(){return Err("Не выбран локальный файл".into());}
    Ok(p)
}
async fn upload(app:&AppHandle,socket:&mut Socket,id:&str,remote:&str,local:PathBuf,root:Value) -> Result<Value,String> {
    let meta=fs::metadata(&local).await.map_err(|e|format!("Локальный файл: {e}"))?;
    if !meta.is_file() || meta.len()>MAX_UPLOAD {return Err("Недопустимый локальный файл или размер свыше 32 ГиБ".into());}
    let mut file=File::open(&local).await.map_err(|e|e.to_string())?;
    send(socket,json!({"v":1,"id":id,"type":"file.put","root":root,"path":remote,"size_bytes":meta.len()})).await?;
    let ready=response(next(socket).await?,"file.ready",id)?;
    if ready.get("size_bytes").and_then(Value::as_u64)!=Some(meta.len()){return Err("HC SS подтвердил другой размер файла".into());}
    let mut hash=Sha256::new();
    let mut written=0u64;
    let mut buf=vec![0u8;FRAME];
    loop {
        let n=file.read(&mut buf).await.map_err(|e|e.to_string())?;
        if n==0 {break}
        written+=n as u64;
        if written>meta.len(){return Err("Локальный файл изменился во время отправки".into());}
        hash.update(&buf[..n]);
        tokio::time::timeout(FRAME_TIMEOUT,socket.send(Message::Binary(buf[..n].to_vec().into()))).await
          .map_err(|_|"Тайм-аут отправки блока")?.map_err(|e|e.to_string())?;
        progress(app,"upload",written,meta.len());
    }
    if written!=meta.len(){return Err("Локальный файл сократился во время отправки".into());}
    let digest=format!("{:x}",hash.finalize());
    send(socket,json!({"v":1,"id":id,"type":"file.end","sha256":digest})).await?;
    let done=response(next(socket).await?,"file.complete",id)?;
    if done.get("sha256").and_then(Value::as_str)!=Some(digest.as_str()){return Err("HC SS вернул другой SHA-256".into());}
    Ok(done)
}
async fn download(app:&AppHandle,socket:&mut Socket,id:&str,remote:&str,local:PathBuf,root:Value) -> Result<Value,String> {
    // Local target is never overwritten, even on a rename race.
    if fs::try_exists(&local).await.map_err(|e|e.to_string())? {return Err("Файл назначения уже существует".into());}
    send(socket,json!({"v":1,"id":id,"type":"file.get","root":root,"path":remote})).await?;
    let ready=response(next(socket).await?,"file.ready",id)?;
    let total=ready.get("size_bytes").and_then(Value::as_u64).ok_or("HC SS не предоставил размер")?;
    let tmp=local.with_extension(format!("hcsspart-{}",COUNTER.fetch_add(1,Ordering::Relaxed)));
    let mut file=File::create_new(&tmp).await.map_err(|e|format!("Временный файл: {e}"))?;
    let result:Result<Value,String>=async {
        let mut sum=Sha256::new();
        let mut received=0u64;
        loop {
            match next(socket).await? {
                Message::Binary(bytes)=>{
                    received+=bytes.len() as u64;
                    if bytes.len()>FRAME||received>total{return Err("HC SS передал больше заявленного размера".into());}
                    sum.update(&bytes);
                    file.write_all(&bytes).await.map_err(|e|e.to_string())?;
                    progress(app,"download",received,total);
                }
                value@Message::Text(_)=>{
                    let complete=response(value,"file.complete",id)?;
                    let actual=format!("{:x}",sum.finalize());
                    if received!=total || complete.get("size_bytes").and_then(Value::as_u64)!=Some(total) ||
                       complete.get("sha256").and_then(Value::as_str)!=Some(actual.as_str()) {
                        return Err("SHA-256 / размер скачанного файла не совпадает".into());
                    }
                    file.flush().await.map_err(|e|e.to_string())?;
                    file.sync_all().await.map_err(|e|e.to_string())?;
                    drop(file);
                    fs::hard_link(&tmp,&local).await.map_err(|e|format!("Не удалось сохранить без перезаписи: {e}"))?;
                    let _=fs::remove_file(&tmp).await;
                    return Ok(complete);
                }
                Message::Close(_)=>return Err("HC SS прервал загрузку".into()),
                _=>{}
            }
        }
    }.await;
    if result.is_err(){let _=fs::remove_file(&tmp).await;}
    result
}

#[tauri::command]
pub async fn homecloud_hcss_file_operation(
    app: AppHandle,
    endpoints: Vec<String>,
    operation: String, root_kind: String, root_id: String,
    path: String, new_path: Option<String>, local_file: Option<String>,
) -> Result<Value,String> {
    if !valid_root(&root_kind,&root_id)||!valid_path(&path){return Err("Недопустимый путь или корень HC SS".into());}
    let action=match operation.as_str() {
        "download"=>"file.get",
        "upload"=>"file.put",
        "mkdir"=>"file.mkdir",
        "delete"=>"file.delete",
        "rename"=>"file.rename",
        _=>return Err("Неизвестная файловая операция".into())
    };
    if action=="file.rename"&&!new_path.as_deref().is_some_and(valid_path){return Err("Недопустимый новый путь".into());}
    let mut socket=dial(&endpoints).await?;
    let id=transfer_id();
    let root=json!({"kind":root_kind,"id":root_id});
    let result=match action {
        "file.put"=>upload(&app,&mut socket,&id,&path,local_path(local_file)?,root).await,
        "file.get"=>download(&app,&mut socket,&id,&path,local_path(local_file)?,root).await,
        _=>{
            send(&mut socket,json!({"v":1,"id":id,"type":action,"root":root,"path":path,"new_path":new_path.unwrap_or_default()})).await?;
            response(next(&mut socket).await?,"file.complete",&id)
        }
    };
    let _=socket.close(None).await;
    result
}
#[cfg(test)]
mod tests {
    use super::{valid_endpoint,valid_root,valid_path};
    #[test]
    fn accepts_private_lan_and_rejects_external_endpoints(){
        assert!(valid_endpoint("ws://100.114.58.74:8093/ws/files"));
        assert!(valid_endpoint("ws://192.168.0.147:8093/ws/files"));
        assert!(valid_endpoint("ws://10.42.0.3:8093/ws/files"));
        assert!(!valid_endpoint("ws://8.8.8.8:8093/ws/files"));
        assert!(!valid_endpoint("ws://example.com:8093/ws/files"));
        assert!(!valid_endpoint("ws://100.114.58.74:8093/ws/files?token=evil"));
        assert!(!valid_endpoint("ws://100.114.58.74:8093/other"));
    }
    #[test]
    fn rejects_path_traversal() {
        assert!(valid_path("Фото/2026/pic.jpg"));
        assert!(!valid_path("../secret"));
        assert!(!valid_path("a/../../b"));
        assert!(!valid_path("a\\b"));
        assert!(!valid_path("a/.hcss-upload-xyz"));
        assert!(valid_root("disk","storage-hdd"));
        assert!(!valid_root("other","storage-hdd"));
    }
}
