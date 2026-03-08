use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::process::Child;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub cwd: String,
    #[serde(rename = "processName")]
    pub process_name: Option<String>,
    #[serde(rename = "ptyCols")]
    pub pty_cols: u16,
    #[serde(rename = "ptyRows")]
    pub pty_rows: u16,
}

type Sessions = Arc<RwLock<Vec<SessionInfo>>>;

#[derive(Clone)]
struct Client {
    _id: String,
    session_ids: HashSet<String>,
    role: String,
    _device: String,
    tx: mpsc::UnboundedSender<Message>,
}

type Clients = Arc<RwLock<HashMap<String, Client>>>;

struct ServerState {
    shutdown_tx: mpsc::Sender<()>,
    clients: Clients,
    sessions: Sessions,
    dns_sd_process: Option<Child>,
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
struct CreateSessionEvent {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "clientId")]
    client_id: String,
}

#[derive(Serialize, Clone)]
struct DeleteSessionEvent {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "clientId")]
    client_id: String,
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
    let sessions: Sessions = Arc::new(RwLock::new(Vec::new()));
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    // Get local IP addresses for discovery
    let addresses = get_local_addresses();

    // Register mDNS service using macOS dns-sd command (reliable native implementation)
    let hostname = gethostname::gethostname()
        .to_string_lossy()
        .to_string();
    let service_name = format!("TermPod-{hostname}");

    // Kill any stale dns-sd processes from previous runs
    let _ = std::process::Command::new("pkill")
        .args(["-f", "dns-sd -R .* _termpod._tcp"])
        .output();

    eprintln!("[LocalServer] Registering mDNS via dns-sd: {} on port {}", service_name, port);

    let dns_sd_process = std::process::Command::new("dns-sd")
        .args(["-R", &service_name, "_termpod._tcp", "local.", &port.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start dns-sd: {e}"))?;

    eprintln!("[LocalServer] dns-sd process started (pid: {}) on port {}", dns_sd_process.id(), port);

    let clients_clone = clients.clone();
    let sessions_clone = sessions.clone();
    let app_clone = app.clone();

    // Spawn the server loop
    tokio::spawn(async move {
        loop {
            tokio::select! {
                Ok((stream, peer_addr)) = listener.accept() => {
                    let clients = clients_clone.clone();
                    let sessions = sessions_clone.clone();
                    let app = app_clone.clone();

                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, peer_addr, clients, sessions, app).await {
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
        sessions,
        dns_sd_process: Some(dns_sd_process),
    });

    Ok(info)
}

#[tauri::command]
pub async fn stop_local_server() -> Result<(), String> {
    let mut guard = server_lock().lock().await;

    if let Some(mut state) = guard.take() {
        let _ = state.shutdown_tx.send(()).await;

        if let Some(mut child) = state.dns_sd_process.take() {
            let _ = child.kill();
        }
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
    let sid_bytes = session_id.as_bytes();

    // Build multiplexed frame: [channel:0x00][sid_len][sid][data]
    let mut frame = Vec::with_capacity(2 + sid_bytes.len() + data.len());
    frame.push(0x00);
    frame.push(sid_bytes.len() as u8);
    frame.extend_from_slice(sid_bytes);
    frame.extend_from_slice(&data);
    let msg = Message::Binary(frame.into());

    for client in clients.values() {
        if client.session_ids.contains(&session_id) && client.role == "viewer" {
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
        if client.session_ids.contains(&session_id) && client.role == "viewer" {
            let _ = client.tx.send(msg.clone());
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn local_server_send_to_client(
    client_id: String,
    json: String,
) -> Result<(), String> {
    let guard = server_lock().lock().await;

    let Some(state) = guard.as_ref() else {
        return Ok(());
    };

    let clients = state.clients.read().await;
    let msg = Message::Text(json.into());

    if let Some(client) = clients.get(&client_id) {
        let _ = client.tx.send(msg);
    }

    Ok(())
}

#[tauri::command]
pub async fn update_local_sessions(sessions: Vec<SessionInfo>) -> Result<(), String> {
    let guard = server_lock().lock().await;

    let Some(state) = guard.as_ref() else {
        return Ok(());
    };

    *state.sessions.write().await = sessions.clone();

    // Broadcast sessions_updated to all connected clients
    let notification = serde_json::json!({
        "type": "sessions_updated",
        "sessions": sessions,
    });
    let msg = Message::Text(notification.to_string().into());
    let clients = state.clients.read().await;

    for client in clients.values() {
        let _ = client.tx.send(msg.clone());
    }

    Ok(())
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    peer_addr: SocketAddr,
    clients: Clients,
    sessions: Sessions,
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

    let mut registered_id: Option<String> = None;
    let mut client_device = String::new();

    while let Some(msg_result) = ws_rx.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(_) => break,
        };

        match msg {
            Message::Text(text) => {
                if let Ok(hello) = serde_json::from_str::<HelloMsg>(&text) {
                    if hello._msg_type == "hello" {
                        let cid = hello.client_id.clone();
                        client_device = hello.device.clone();

                        let mut initial_sessions = HashSet::new();

                        // Validate and auto-subscribe if sessionId provided (backward compat)
                        if let Some(sid) = &hello.session_id {
                            let known = sessions.read().await;
                            if !known.iter().any(|s| s.id == *sid) {
                                let err = serde_json::json!({
                                    "type": "error",
                                    "message": "Unknown session"
                                });
                                let _ = tx.send(Message::Text(err.to_string().into()));
                                let _ = tx.send(Message::Close(None));
                                break;
                            }
                            initial_sessions.insert(sid.clone());
                        }

                        let client = Client {
                            _id: cid.clone(),
                            session_ids: initial_sessions,
                            role: hello.role.clone(),
                            _device: hello.device.clone(),
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
                } else if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = json.get("type").and_then(|t| t.as_str());

                    match msg_type {
                        Some("subscribe_session") => {
                            if let (Some(cid), Some(sid)) = (
                                registered_id.as_ref(),
                                json.get("sessionId").and_then(|s| s.as_str()),
                            ) {
                                // Validate session exists
                                let known = sessions.read().await;
                                if known.iter().any(|s| s.id == sid) {
                                    let mut cl = clients.write().await;
                                    if let Some(client) = cl.get_mut(cid) {
                                        client.session_ids.insert(sid.to_string());
                                    }

                                    let _ = app.emit(
                                        "local-ws-viewer-joined",
                                        ViewerEvent {
                                            client_id: cid.clone(),
                                            device: client_device.clone(),
                                            session_id: sid.to_string(),
                                        },
                                    );
                                } else {
                                    let err = serde_json::json!({
                                        "type": "error",
                                        "message": "Unknown session",
                                        "sessionId": sid,
                                    });
                                    let _ = tx.send(Message::Text(err.to_string().into()));
                                }
                            }
                        }

                        Some("unsubscribe_session") => {
                            if let (Some(cid), Some(sid)) = (
                                registered_id.as_ref(),
                                json.get("sessionId").and_then(|s| s.as_str()),
                            ) {
                                let mut cl = clients.write().await;
                                if let Some(client) = cl.get_mut(cid) {
                                    client.session_ids.remove(sid);
                                }

                                let _ = app.emit(
                                    "local-ws-viewer-left",
                                    ViewerEvent {
                                        client_id: cid.clone(),
                                        device: client_device.clone(),
                                        session_id: sid.to_string(),
                                    },
                                );
                            }
                        }

                        Some("ping") => {
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

                        Some("create_session_request") => {
                            if let Some(request_id) = json.get("requestId").and_then(|r| r.as_str()) {
                                let cid = registered_id.clone().unwrap_or_default();
                                let _ = app.emit(
                                    "local-ws-create-session",
                                    CreateSessionEvent {
                                        request_id: request_id.to_string(),
                                        client_id: cid,
                                    },
                                );
                            }
                        }

                        Some("list_sessions") => {
                            let list = sessions.read().await;
                            let response = serde_json::json!({
                                "type": "sessions_list",
                                "sessions": *list,
                            });
                            let _ = tx.send(Message::Text(response.to_string().into()));
                        }

                        Some("delete_session") => {
                            if let Some(sid) = json.get("sessionId").and_then(|s| s.as_str()) {
                                let cid = registered_id.clone().unwrap_or_default();
                                let _ = app.emit(
                                    "local-ws-delete-session",
                                    DeleteSessionEvent {
                                        session_id: sid.to_string(),
                                        client_id: cid,
                                    },
                                );
                            }
                        }

                        _ => {}
                    }
                }
            }

            Message::Binary(data) => {
                if data.len() < 2 {
                    continue;
                }

                let channel = data[0];
                let sid_len = data[1] as usize;

                // Parse multiplexed frame: [channel][sid_len][sid][payload]
                let (target_sid, payload_offset) = if sid_len > 0 && data.len() >= 2 + sid_len {
                    if let Ok(sid) = std::str::from_utf8(&data[2..2 + sid_len]) {
                        (Some(sid.to_string()), 2 + sid_len)
                    } else {
                        continue;
                    }
                } else if sid_len == 0 {
                    // Fallback: use client's first/only session_id
                    let cid = registered_id.as_ref();
                    let fallback = if let Some(cid) = cid {
                        let cl = clients.read().await;
                        cl.get(cid).and_then(|c| c.session_ids.iter().next().cloned())
                    } else {
                        None
                    };
                    (fallback, 2)
                } else {
                    continue;
                };

                if let Some(sid) = target_sid {
                    match channel {
                        0x00 => {
                            let _ = app.emit(
                                "local-ws-input",
                                InputEvent {
                                    session_id: sid,
                                    data: data[payload_offset..].to_vec(),
                                },
                            );
                        }
                        0x01 if data.len() >= payload_offset + 4 => {
                            let cols = u16::from_be_bytes([
                                data[payload_offset],
                                data[payload_offset + 1],
                            ]);
                            let rows = u16::from_be_bytes([
                                data[payload_offset + 2],
                                data[payload_offset + 3],
                            ]);
                            let _ = app.emit(
                                "local-ws-resize",
                                ResizeEvent {
                                    session_id: sid,
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

    // Cleanup: emit viewer-left for each subscribed session
    if let Some(cid) = &registered_id {
        let session_ids = {
            let mut cl = clients.write().await;
            let sids = cl.get(cid).map(|c| c.session_ids.clone()).unwrap_or_default();
            cl.remove(cid);
            sids
        };

        for sid in session_ids {
            let _ = app.emit(
                "local-ws-viewer-left",
                ViewerEvent {
                    client_id: cid.clone(),
                    device: client_device.clone(),
                    session_id: sid,
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
