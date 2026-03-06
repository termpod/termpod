use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

const SERVICE_TYPE: &str = "_termpod._tcp.local.";

#[derive(Clone)]
struct Client {
    id: String,
    session_id: Option<String>,
    role: String,
    device: String,
    tx: mpsc::UnboundedSender<Message>,
}

type Clients = Arc<RwLock<HashMap<String, Client>>>;

struct ServerState {
    shutdown_tx: mpsc::Sender<()>,
    clients: Clients,
    mdns: ServiceDaemon,
    service_fullname: String,
}

static SERVER: std::sync::OnceLock<tokio::sync::Mutex<Option<ServerState>>> =
    std::sync::OnceLock::new();

fn server_lock() -> &'static tokio::sync::Mutex<Option<ServerState>> {
    SERVER.get_or_init(|| tokio::sync::Mutex::new(None))
}

#[derive(Serialize, Clone)]
pub struct LocalServerInfo {
    pub port: u16,
    pub addresses: Vec<String>,
}

#[derive(Deserialize)]
struct HelloMsg {
    #[serde(rename = "type")]
    _msg_type: String,
    #[serde(rename = "clientId")]
    client_id: String,
    role: String,
    device: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

#[derive(Serialize, Clone)]
struct ViewerEvent {
    #[serde(rename = "clientId")]
    client_id: String,
    device: String,
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Serialize, Clone)]
struct InputEvent {
    #[serde(rename = "sessionId")]
    session_id: String,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
struct ResizeEvent {
    #[serde(rename = "sessionId")]
    session_id: String,
    cols: u16,
    rows: u16,
}

#[tauri::command]
pub async fn start_local_server(app: AppHandle) -> Result<LocalServerInfo, String> {
    let mut guard = server_lock().lock().await;

    if guard.is_some() {
        return Err("Server already running".into());
    }

    // Bind to a random available port
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let port = addr.port();

    let clients: Clients = Arc::new(RwLock::new(HashMap::new()));
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    // Get local IP addresses for discovery
    let addresses = get_local_addresses();

    // Register mDNS service
    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let hostname = gethostname::gethostname()
        .to_string_lossy()
        .to_string();
    let service_name = format!("Termpod-{hostname}");

    let service_info = ServiceInfo::new(
        SERVICE_TYPE,
        &service_name,
        &format!("{hostname}.local."),
        "",
        port,
        None,
    )
    .map_err(|e| e.to_string())?;

    let service_fullname = service_info.get_fullname().to_string();
    mdns.register(service_info).map_err(|e| e.to_string())?;

    let clients_clone = clients.clone();
    let app_clone = app.clone();

    // Spawn the server loop
    tokio::spawn(async move {
        loop {
            tokio::select! {
                Ok((stream, peer_addr)) = listener.accept() => {
                    let clients = clients_clone.clone();
                    let app = app_clone.clone();

                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, peer_addr, clients, app).await {
                            eprintln!("[LocalServer] Connection error: {e}");
                        }
                    });
                }
                _ = shutdown_rx.recv() => {
                    break;
                }
            }
        }
    });

    let info = LocalServerInfo {
        port,
        addresses: addresses.clone(),
    };

    *guard = Some(ServerState {
        shutdown_tx,
        clients,
        mdns,
        service_fullname,
    });

    Ok(info)
}

#[tauri::command]
pub async fn stop_local_server() -> Result<(), String> {
    let mut guard = server_lock().lock().await;

    if let Some(state) = guard.take() {
        let _ = state.shutdown_tx.send(()).await;
        let _ = state.mdns.unregister(&state.service_fullname);
        let _ = state.mdns.shutdown();
    }

    Ok(())
}

#[tauri::command]
pub async fn local_server_broadcast(session_id: String, data: Vec<u8>) -> Result<(), String> {
    let guard = server_lock().lock().await;

    let Some(state) = guard.as_ref() else {
        return Ok(());
    };

    let clients = state.clients.read().await;

    // Prepend channel byte 0x00 for terminal data
    let mut frame = Vec::with_capacity(1 + data.len());
    frame.push(0x00);
    frame.extend_from_slice(&data);
    let msg = Message::Binary(frame.into());

    for client in clients.values() {
        if client.session_id.as_deref() == Some(session_id.as_str())
            && client.role == "viewer"
        {
            let _ = client.tx.send(msg.clone());
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn local_server_send_control(
    session_id: String,
    json: String,
) -> Result<(), String> {
    let guard = server_lock().lock().await;

    let Some(state) = guard.as_ref() else {
        return Ok(());
    };

    let clients = state.clients.read().await;
    let msg = Message::Text(json.into());

    for client in clients.values() {
        if client.session_id.as_deref() == Some(session_id.as_str())
            && client.role == "viewer"
        {
            let _ = client.tx.send(msg.clone());
        }
    }

    Ok(())
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    peer_addr: SocketAddr,
    clients: Clients,
    app: AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws_stream = accept_async(stream).await?;
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let _client_id = format!("local-{peer_addr}");

    // Spawn a task to forward messages from channel to WebSocket
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut session_id: Option<String> = None;
    let mut registered_id: Option<String> = None;

    while let Some(msg_result) = ws_rx.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(_) => break,
        };

        match msg {
            Message::Text(text) => {
                if let Ok(hello) = serde_json::from_str::<HelloMsg>(&text) {
                    if hello._msg_type == "hello" {
                        session_id = hello.session_id.clone();
                        let cid = hello.client_id.clone();

                        let client = Client {
                            id: cid.clone(),
                            session_id: hello.session_id.clone(),
                            role: hello.role.clone(),
                            device: hello.device.clone(),
                            tx: tx.clone(),
                        };

                        clients.write().await.insert(cid.clone(), client);
                        registered_id = Some(cid.clone());

                        // Send "ready" to the viewer so it knows the handshake is complete
                        let ready = serde_json::json!({ "type": "ready" });
                        let _ = tx.send(Message::Text(ready.to_string().into()));

                        if let Some(sid) = &hello.session_id {
                            let _ = app.emit(
                                "local-ws-viewer-joined",
                                ViewerEvent {
                                    client_id: cid,
                                    device: hello.device,
                                    session_id: sid.clone(),
                                },
                            );
                        }
                    }
                } else if let Some(sid) = &session_id {
                    // Forward other text (control messages) as JSON to JS
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if json.get("type").and_then(|t| t.as_str()) == Some("ping") {
                            let pong = serde_json::json!({
                                "type": "pong",
                                "timestamp": json.get("timestamp"),
                                "serverTime": std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64,
                            });
                            let _ = tx.send(Message::Text(pong.to_string().into()));
                        }
                    }

                    let _ = sid; // suppress unused warning
                }
            }

            Message::Binary(data) => {
                if data.is_empty() {
                    continue;
                }

                let channel = data[0];

                if let Some(sid) = &session_id {
                    match channel {
                        0x00 => {
                            // Terminal input from viewer → emit to JS
                            let _ = app.emit(
                                "local-ws-input",
                                InputEvent {
                                    session_id: sid.clone(),
                                    data: data[1..].to_vec(),
                                },
                            );
                        }
                        0x01 if data.len() >= 5 => {
                            // Resize from viewer
                            let cols =
                                u16::from_be_bytes([data[1], data[2]]);
                            let rows =
                                u16::from_be_bytes([data[3], data[4]]);
                            let _ = app.emit(
                                "local-ws-resize",
                                ResizeEvent {
                                    session_id: sid.clone(),
                                    cols,
                                    rows,
                                },
                            );
                        }
                        _ => {}
                    }
                }
            }

            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup
    if let Some(cid) = &registered_id {
        clients.write().await.remove(cid);

        if let Some(sid) = &session_id {
            let _ = app.emit(
                "local-ws-viewer-left",
                ViewerEvent {
                    client_id: cid.clone(),
                    device: String::new(),
                    session_id: sid.clone(),
                },
            );
        }
    }

    forward_task.abort();

    Ok(())
}

fn get_local_addresses() -> Vec<String> {
    let mut addrs = Vec::new();

    if let Ok(ip) = local_ip_address::local_ip() {
        addrs.push(ip.to_string());
    }

    addrs
}
