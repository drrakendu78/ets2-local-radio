pub mod messages;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State as AxumState,
    },
    response::{Html, Response},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use image::Luma;
use messages::{RadioState, RemoteCommand, ServerMessage};
use qrcode::QrCode;
use serde::Deserialize;
use std::{
    collections::VecDeque,
    io::Cursor,
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Remote control server state
pub struct RemoteServer {
    pub enabled: Mutex<bool>,
    pub token: Mutex<Option<String>>,
    pub port: u16,
    pub radio_state: Mutex<RadioState>,
    /// Broadcast channel for sending state updates to WebSocket clients
    pub state_tx: broadcast::Sender<RadioState>,
    /// Queue of commands from mobile to be processed by frontend
    pub command_queue: Mutex<VecDeque<String>>,
    #[allow(dead_code)]
    shutdown_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl RemoteServer {
    pub fn new() -> Self {
        let (state_tx, _) = broadcast::channel(100);
        Self {
            enabled: Mutex::new(false),
            token: Mutex::new(None),
            port: 8331,
            radio_state: Mutex::new(RadioState::default()),
            state_tx,
            command_queue: Mutex::new(VecDeque::new()),
            shutdown_tx: Mutex::new(None),
        }
    }

    /// Generate a new session token
    pub fn generate_token(&self) -> String {
        let token = Uuid::new_v4().to_string();
        *self.token.lock().unwrap() = Some(token.clone());
        token
    }

    /// Validate a token
    pub fn validate_token(&self, token: &str) -> bool {
        self.token
            .lock()
            .unwrap()
            .as_ref()
            .map(|t| t == token)
            .unwrap_or(false)
    }

    /// Invalidate the current token
    pub fn invalidate_token(&self) {
        *self.token.lock().unwrap() = None;
    }

    /// Update radio state and broadcast to connected clients
    pub fn update_state(&self, state: RadioState) {
        *self.radio_state.lock().unwrap() = state.clone();
        // Broadcast state update to all WebSocket clients
        let _ = self.state_tx.send(state);
    }

    /// Get current radio state
    pub fn get_state(&self) -> RadioState {
        self.radio_state.lock().unwrap().clone()
    }

    /// Queue a command from mobile to be processed by frontend
    pub fn queue_command(&self, action: &str) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(action.to_string());
        }
    }

    /// Get next command from queue (for frontend polling)
    pub fn pop_command(&self) -> Option<String> {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.pop_front()
        } else {
            None
        }
    }
}

impl Default for RemoteServer {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate QR code as base64 data URL
pub fn generate_qr_code(url: &str) -> Result<String, String> {
    let code = QrCode::new(url.as_bytes()).map_err(|e| e.to_string())?;
    let image = code.render::<Luma<u8>>().min_dimensions(200, 200).build();

    let mut png_data = Cursor::new(Vec::new());
    image
        .write_to(&mut png_data, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let base64_data = STANDARD.encode(png_data.into_inner());
    Ok(format!("data:image/png;base64,{}", base64_data))
}

/// Get local IP address for LAN access
pub fn get_local_ip() -> Result<String, String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| e.to_string())
}

/// Query parameters for WebSocket connection
#[derive(Deserialize)]
pub struct WsQuery {
    token: Option<String>,
}

/// WebSocket handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumState(server): AxumState<Arc<RemoteServer>>,
    Query(query): Query<WsQuery>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, server, query.token))
}

/// Handle WebSocket connection
async fn handle_socket(socket: WebSocket, server: Arc<RemoteServer>, token: Option<String>) {
    let (mut sender, mut receiver) = socket.split();
    let mut state_rx = server.state_tx.subscribe();

    // Check if token was provided in query string
    if let Some(t) = token {
        if server.validate_token(&t) {
            let msg = ServerMessage::AuthResult {
                success: true,
                message: "Connected".to_string(),
            };
            let _ = sender
                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                .await;
            // Send initial state
            let state_msg = ServerMessage::State(server.get_state());
            let _ = sender
                .send(Message::Text(serde_json::to_string(&state_msg).unwrap().into()))
                .await;
        } else {
            // Invalid token
            let msg = ServerMessage::AuthResult {
                success: false,
                message: "Invalid token".to_string(),
            };
            let _ = sender
                .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
                .await;
            return;
        }
    } else {
        // No token provided
        let msg = ServerMessage::AuthResult {
            success: false,
            message: "No token provided".to_string(),
        };
        let _ = sender
            .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
            .await;
        return;
    }

    // Use Arc<Mutex<bool>> for authenticated state that can be shared
    let auth_flag = Arc::new(Mutex::new(true));
    let auth_flag_clone = auth_flag.clone();

    // Spawn task to forward state updates to client
    let send_task = tokio::spawn(async move {
        while let Ok(state) = state_rx.recv().await {
            if *auth_flag_clone.lock().unwrap() {
                let state_msg = ServerMessage::State(state);
                if sender
                    .send(Message::Text(serde_json::to_string(&state_msg).unwrap().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    });

    // Handle incoming messages (commands from mobile)
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            if let Ok(cmd) = serde_json::from_str::<RemoteCommand>(&text) {
                let is_auth = *auth_flag.lock().unwrap();
                match cmd {
                    RemoteCommand::Auth { token } => {
                        if server.validate_token(&token) {
                            *auth_flag.lock().unwrap() = true;
                        }
                    }
                    _ if is_auth => {
                        // Handle commands only if authenticated
                        let action = match &cmd {
                            RemoteCommand::Next => "next",
                            RemoteCommand::Previous => "prev",
                            RemoteCommand::Play => "play",
                            RemoteCommand::Pause => "pause",
                            RemoteCommand::TogglePlay => "togglePlay",
                            RemoteCommand::Mute => "mute",
                            RemoteCommand::Unmute => "unmute",
                            RemoteCommand::Favourite => "favourite",
                            RemoteCommand::Volume { value } => {
                                // Queue volume command with value
                                server.queue_command(&format!("volume:{}", value));
                                continue;
                            }
                            RemoteCommand::GetState => {
                                // Don't queue, just trigger state broadcast
                                let state = server.get_state();
                                let _ = server.state_tx.send(state);
                                continue;
                            }
                            _ => continue,
                        };
                        // Queue command for frontend to process
                        server.queue_command(action);
                    }
                    _ => {
                        // Not authenticated, ignore commands
                    }
                }
            }
        }
    }

    send_task.abort();
}

/// Serve the remote control HTML page
async fn remote_page() -> Html<&'static str> {
    Html(include_str!("../../remote.html"))
}

/// Start the WebSocket server
pub async fn start_server(server: Arc<RemoteServer>) -> Result<(), String> {
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/remote", get(remote_page))
        .route("/", get(remote_page))
        .with_state(server.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], server.port));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| e.to_string())?;

    println!("Remote control server started on port {}", server.port);

    axum::serve(listener, app)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Enable remote control and return QR code data URL
pub fn enable_remote(server: &Arc<RemoteServer>) -> Result<String, String> {
    let token = server.generate_token();
    let ip = get_local_ip()?;
    let url = format!("http://{}:{}/remote?token={}", ip, server.port, token);

    *server.enabled.lock().unwrap() = true;

    // Generate QR code
    generate_qr_code(&url)
}

/// Get the remote control URL
pub fn get_remote_url(server: &Arc<RemoteServer>) -> Result<String, String> {
    if !*server.enabled.lock().unwrap() {
        return Err("Remote control not enabled".to_string());
    }

    let token = server.token.lock().unwrap();
    if let Some(t) = token.as_ref() {
        let ip = get_local_ip()?;
        Ok(format!("http://{}:{}/remote?token={}", ip, server.port, t))
    } else {
        Err("No token available".to_string())
    }
}

/// Disable remote control
pub fn disable_remote(server: &Arc<RemoteServer>) {
    *server.enabled.lock().unwrap() = false;
    server.invalidate_token();
}
