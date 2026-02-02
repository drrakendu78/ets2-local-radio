//! ETS2/ATS Local Radio - Tauri Backend

mod remote;

use remote::RemoteServer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TelemetryData {
    #[serde(rename = "TruckValues")]
    pub truck_values: TruckValues,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TruckValues {
    #[serde(rename = "Positioning")]
    pub positioning: Positioning,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Positioning {
    #[serde(rename = "HeadPositionInWorldSpace")]
    pub head_position: Vector3,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Vector3 {
    #[serde(rename = "X")]
    pub x: f64,
    #[serde(rename = "Y")]
    pub y: f64,
    #[serde(rename = "Z")]
    pub z: f64,
}

pub struct AppState {
    pub favourites: Mutex<HashMap<String, String>>,
    pub current_game: Mutex<String>,
    pub language: Mutex<String>,
    pub config_path: PathBuf,
    pub remote_server: Arc<RemoteServer>,
    pub overlay_bridge: Mutex<Option<Child>>,
    pub overlay_connected: Mutex<bool>,
}

impl AppState {
    pub fn new(config_path: PathBuf) -> Self {
        let favourites = Self::load_favourites(&config_path);
        Self {
            favourites: Mutex::new(favourites),
            current_game: Mutex::new("ets2".to_string()),
            language: Mutex::new("en-GB".to_string()),
            config_path,
            remote_server: Arc::new(RemoteServer::new()),
            overlay_bridge: Mutex::new(None),
            overlay_connected: Mutex::new(false),
        }
    }

    fn load_favourites(config_path: &PathBuf) -> HashMap<String, String> {
        let fav_path = config_path.join("favourites.json");
        if fav_path.exists() {
            if let Ok(content) = fs::read_to_string(&fav_path) {
                if let Ok(favs) = serde_json::from_str(&content) {
                    return favs;
                }
            }
        }
        HashMap::new()
    }

    pub fn save_favourites(&self) {
        let fav_path = self.config_path.join("favourites.json");
        if let Ok(favs) = self.favourites.lock() {
            if let Ok(content) = serde_json::to_string_pretty(&*favs) {
                let _ = fs::create_dir_all(&self.config_path);
                let _ = fs::write(fav_path, content);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandData {
    pub id: String,
    pub language: String,
    pub game: String,
    pub action: Option<String>,
    pub amount: Option<i32>,
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
fn telemetry_get() -> TelemetryData {
    #[cfg(windows)]
    {
        if let Some(data) = read_ets2_telemetry() {
            return data;
        }
    }
    TelemetryData::default()
}

#[tauri::command]
fn favourites_get_all(state: State<'_, Arc<AppState>>) -> HashMap<String, String> {
    state.favourites.lock().unwrap().clone()
}

#[tauri::command]
fn favourites_get_one(country: String, state: State<'_, Arc<AppState>>) -> HashMap<String, String> {
    let favs = state.favourites.lock().unwrap();
    let mut result = HashMap::new();
    result.insert("Name".to_string(), favs.get(&country).cloned().unwrap_or_default());
    result
}

#[tauri::command]
fn favourites_set(country: String, name: String, state: State<'_, Arc<AppState>>) -> bool {
    {
        let mut favs = state.favourites.lock().unwrap();
        favs.insert(country, name);
    }
    state.save_favourites();
    true
}

#[tauri::command]
fn game_get(state: State<'_, Arc<AppState>>) -> String {
    state.current_game.lock().unwrap().clone()
}

#[tauri::command]
fn game_set(game: String, state: State<'_, Arc<AppState>>) {
    *state.current_game.lock().unwrap() = game;
}

#[tauri::command]
fn language_get(state: State<'_, Arc<AppState>>) -> String {
    state.language.lock().unwrap().clone()
}

#[tauri::command]
fn language_set(lang: String, state: State<'_, Arc<AppState>>) {
    *state.language.lock().unwrap() = lang;
}

#[tauri::command]
fn commands_get(state: State<'_, Arc<AppState>>) -> CommandData {
    CommandData {
        id: "0".to_string(),
        language: state.language.lock().unwrap().clone(),
        game: state.current_game.lock().unwrap().clone(),
        action: None,
        amount: None,
    }
}

// ============================================================================
// Remote Control Commands
// ============================================================================

#[tauri::command]
fn remote_enable(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let server = state.remote_server.clone();

    // Start WebSocket server in background if not already running
    if !*server.enabled.lock().unwrap() {
        let server_clone = server.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                if let Err(e) = remote::start_server(server_clone).await {
                    eprintln!("Remote server error: {}", e);
                }
            });
        });
    }

    // Generate QR code and return data URL
    remote::enable_remote(&server)
}

#[tauri::command]
fn remote_disable(state: State<'_, Arc<AppState>>) {
    remote::disable_remote(&state.remote_server);
}

#[tauri::command]
fn remote_status(state: State<'_, Arc<AppState>>) -> bool {
    *state.remote_server.enabled.lock().unwrap()
}

#[tauri::command]
fn remote_get_url(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    remote::get_remote_url(&state.remote_server)
}

#[tauri::command]
fn remote_update_state(
    station_id: String,
    station_name: String,
    country: String,
    volume: f64,
    playing: bool,
    muted: bool,
    state: State<'_, Arc<AppState>>,
) {
    let radio_state = remote::messages::RadioState {
        station_id,
        station_name,
        country,
        volume,
        playing,
        muted,
    };
    state.remote_server.update_state(radio_state);
}

#[tauri::command]
fn remote_get_command_rx(state: State<'_, Arc<AppState>>) -> Option<String> {
    // Pop next command from queue
    state.remote_server.pop_command()
}

// ============================================================================
// Overlay Bridge Commands
// ============================================================================

const OVERLAY_BRIDGE_PORT: u16 = 8332;

/// Start the OverlayBridge.exe process
#[tauri::command]
fn overlay_start(app_handle: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let mut bridge = state.overlay_bridge.lock().unwrap();

    // Check if already running
    if let Some(ref mut child) = *bridge {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited, we can restart
            }
            Ok(None) => {
                // Still running
                return Ok(true);
            }
            Err(_) => {}
        }
    }

    // Find OverlayBridge.exe - try multiple locations
    // Use short paths to avoid issues with EasyHook and long path prefixes
    let exe_path = {
        // Try local development path first (shorter path, more reliable)
        let dev_path = PathBuf::from("c:\\Users\\djame\\Documents\\projet\\ets2-local-radio-tauri\\src-tauri\\overlay-bridge\\bin\\Release\\OverlayBridge.exe");
        if dev_path.exists() {
            Some(dev_path)
        } else {
            None
        }
    }.or_else(|| {
        // Try target/debug path
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("overlay-bridge")
            .join("bin")
            .join("Release")
            .join("OverlayBridge.exe");
        if dev_path.exists() {
            Some(dev_path)
        } else {
            None
        }
    }).or_else(|| {
        // Try resource path (production build)
        app_handle
            .path()
            .resolve("overlay-bridge/bin/Release/OverlayBridge.exe", tauri::path::BaseDirectory::Resource)
            .ok()
            .filter(|p| p.exists())
    }).ok_or_else(|| "OverlayBridge.exe not found. Make sure it's compiled.".to_string())?;

    println!("Starting OverlayBridge from: {:?}", exe_path);

    // Start the process with admin elevation using PowerShell Start-Process -Verb RunAs
    // This will show UAC prompt for OverlayBridge only, not the whole app
    let exe_str = exe_path.to_string_lossy();
    let exe_dir = exe_path.parent().unwrap().to_string_lossy();

    // Use -Wait to ensure PowerShell waits for the elevated process to start
    // Use -WindowStyle Hidden to minimize the PowerShell window
    // Set WorkingDirectory to ensure EasyHook can find all DLLs
    let child = Command::new("powershell")
        .args([
            "-WindowStyle", "Hidden",
            "-Command",
            &format!(
                "Start-Process -FilePath '{}' -ArgumentList '{}' -Verb RunAs -WindowStyle Normal -WorkingDirectory '{}'",
                exe_str,
                OVERLAY_BRIDGE_PORT,
                exe_dir
            )
        ])
        .spawn()
        .map_err(|e| format!("Failed to start OverlayBridge: {}", e))?;

    *bridge = Some(child);

    // Give it time for UAC prompt + startup
    std::thread::sleep(std::time::Duration::from_millis(2500));

    Ok(true)
}

/// Stop the OverlayBridge.exe process
#[tauri::command]
fn overlay_stop(state: State<'_, Arc<AppState>>) -> bool {
    let mut bridge = state.overlay_bridge.lock().unwrap();
    if let Some(ref mut child) = *bridge {
        let _ = child.kill();
        let _ = child.wait();
    }
    *bridge = None;
    *state.overlay_connected.lock().unwrap() = false;
    true
}

/// Send a command to OverlayBridge via WebSocket
fn send_overlay_command(command: &str) -> Result<String, String> {
    send_overlay_command_with_timeout(command, 5)
}

/// Send a command with custom timeout (for attach which takes longer)
fn send_overlay_command_with_timeout(command: &str, timeout_secs: u64) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{}", OVERLAY_BRIDGE_PORT);

    let mut stream = TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_secs(2)
    ).map_err(|e| format!("Connection failed: {}", e))?;

    stream.set_read_timeout(Some(Duration::from_secs(timeout_secs))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(timeout_secs))).ok();

    // WebSocket handshake
    use base64::Engine;
    let key = base64::engine::general_purpose::STANDARD.encode(rand::random::<[u8; 16]>());
    let request = format!(
        "GET / HTTP/1.1\r\n\
        Host: 127.0.0.1:{}\r\n\
        Upgrade: websocket\r\n\
        Connection: Upgrade\r\n\
        Sec-WebSocket-Key: {}\r\n\
        Sec-WebSocket-Version: 13\r\n\r\n",
        OVERLAY_BRIDGE_PORT, key
    );

    stream.write_all(request.as_bytes())
        .map_err(|e| format!("Failed to send handshake: {}", e))?;

    // Read handshake response
    let mut response = [0u8; 1024];
    let n = stream.read(&mut response)
        .map_err(|e| format!("Failed to read handshake: {}", e))?;

    let response_str = String::from_utf8_lossy(&response[..n]);
    if !response_str.contains("101") {
        return Err("WebSocket handshake failed".to_string());
    }

    // Send command as WebSocket frame
    let payload = command.as_bytes();
    let mut frame = Vec::new();

    frame.push(0x81); // Text frame, FIN

    if payload.len() < 126 {
        frame.push(0x80 | payload.len() as u8); // Masked
    } else if payload.len() < 65536 {
        frame.push(0x80 | 126);
        frame.push((payload.len() >> 8) as u8);
        frame.push((payload.len() & 0xFF) as u8);
    } else {
        return Err("Payload too large".to_string());
    }

    // Masking key
    let mask: [u8; 4] = rand::random();
    frame.extend_from_slice(&mask);

    // Masked payload
    for (i, byte) in payload.iter().enumerate() {
        frame.push(byte ^ mask[i % 4]);
    }

    // First, read and discard the initial status message sent on connect
    let mut header = [0u8; 2];
    stream.read_exact(&mut header)
        .map_err(|e| format!("Failed to read initial status header: {}", e))?;

    let initial_len = (header[1] & 0x7F) as usize;
    let mut initial_payload = vec![0u8; initial_len];
    stream.read_exact(&mut initial_payload)
        .map_err(|e| format!("Failed to read initial status: {}", e))?;

    // Now send the actual command
    stream.write_all(&frame)
        .map_err(|e| format!("Failed to send command: {}", e))?;

    // Read the command response
    stream.read_exact(&mut header)
        .map_err(|e| format!("Failed to read response header: {}", e))?;

    let len = (header[1] & 0x7F) as usize;
    let mut response_payload = vec![0u8; len];
    stream.read_exact(&mut response_payload)
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(String::from_utf8_lossy(&response_payload).to_string())
}

/// Attach overlay to the game process
#[tauri::command]
fn overlay_attach(game: String, state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let command = serde_json::json!({
        "command": "attach",
        "game": game
    }).to_string();

    // Use longer timeout (30s) for attach - injection takes time
    let result = send_overlay_command_with_timeout(&command, 30)?;

    // Parse the result to check if attach was successful
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&result) {
        if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
            *state.overlay_connected.lock().unwrap() = true;
        }
    }

    Ok(result)
}

/// Detach overlay from the game
#[tauri::command]
fn overlay_detach(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let command = serde_json::json!({
        "command": "detach"
    }).to_string();

    let result = send_overlay_command(&command)?;
    *state.overlay_connected.lock().unwrap() = false;
    Ok(result)
}

/// Show station overlay in game
#[tauri::command]
fn overlay_show(
    station: String,
    signal: String,
    logo: Option<String>,
    now_playing: Option<String>,
    rtl: Option<bool>,
) -> Result<String, String> {
    let command = serde_json::json!({
        "command": "show",
        "station": station,
        "signal": signal,
        "logo": logo,
        "nowPlaying": now_playing.unwrap_or_else(|| "Now playing:".to_string()),
        "rtl": rtl.unwrap_or(false)
    }).to_string();

    send_overlay_command(&command)
}

/// Hide the overlay
#[tauri::command]
fn overlay_hide() -> Result<String, String> {
    let command = serde_json::json!({
        "command": "hide"
    }).to_string();

    send_overlay_command(&command)
}

/// Get overlay status
#[tauri::command]
fn overlay_status(state: State<'_, Arc<AppState>>) -> bool {
    *state.overlay_connected.lock().unwrap()
}

// ============================================================================
// Windows Shared Memory for ETS2 Telemetry
// ============================================================================

#[cfg(windows)]
fn read_ets2_telemetry() -> Option<TelemetryData> {
    use windows::Win32::System::Memory::*;
    use windows::core::PCSTR;

    unsafe {
        // ETS2 Local Radio plugin uses this shared memory name
        let name = "Local\\ETS2LocalRadio\0";

        let handle = OpenFileMappingA(
            FILE_MAP_READ.0,
            false,
            PCSTR(name.as_ptr())
        );

        if let Ok(h) = handle {
            if !h.0.is_null() {
                let ptr = MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0);

                if !ptr.Value.is_null() {
                    let data = read_telemetry_from_memory(ptr.Value as *const u8);
                    let _ = UnmapViewOfFile(ptr);
                    let _ = windows::Win32::Foundation::CloseHandle(h);
                    return Some(data);
                }
                let _ = windows::Win32::Foundation::CloseHandle(h);
            }
        }
    }
    None
}

#[cfg(windows)]
unsafe fn read_telemetry_from_memory(ptr: *const u8) -> TelemetryData {
    // Truck position coordinates are at offset 2200 (Zone 8 in the telemetry structure)
    // Each coordinate is a double (f64 = 8 bytes)
    let x_offset = 2200;
    let y_offset = 2208;
    let z_offset = 2216;

    let x = *(ptr.add(x_offset) as *const f64);
    let y = *(ptr.add(y_offset) as *const f64);
    let z = *(ptr.add(z_offset) as *const f64);

    TelemetryData {
        truck_values: TruckValues {
            positioning: Positioning {
                head_position: Vector3 { x, y, z }
            }
        }
    }
}

#[cfg(not(windows))]
fn read_ets2_telemetry() -> Option<TelemetryData> {
    None
}

// ============================================================================
// Plugin Installation
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInstallStatus {
    pub path: Option<String>,
    pub plugin_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginStatus {
    pub ets2: GameInstallStatus,
    pub ats: GameInstallStatus,
}

/// Detect game installation paths via Steam
#[cfg(windows)]
fn find_steam_game_path(_app_id: &str, game_folder: &str) -> Option<PathBuf> {
    use std::io::BufRead;

    // Common Steam installation paths
    let steam_paths = vec![
        PathBuf::from(r"C:\Program Files (x86)\Steam"),
        PathBuf::from(r"C:\Program Files\Steam"),
        PathBuf::from(r"D:\Steam"),
        PathBuf::from(r"D:\SteamLibrary"),
        PathBuf::from(r"E:\Steam"),
        PathBuf::from(r"E:\SteamLibrary"),
    ];

    for steam_path in &steam_paths {
        // Check default steamapps folder
        let default_path = steam_path.join("steamapps").join("common").join(game_folder);
        if default_path.exists() {
            return Some(default_path);
        }

        // Check libraryfolders.vdf for additional library paths
        let vdf_path = steam_path.join("steamapps").join("libraryfolders.vdf");
        if vdf_path.exists() {
            if let Ok(file) = fs::File::open(&vdf_path) {
                let reader = std::io::BufReader::new(file);
                for line in reader.lines().map_while(Result::ok) {
                    if line.contains("\"path\"") {
                        if let Some(start) = line.find('"') {
                            let rest = &line[start + 1..];
                            if let Some(mid) = rest.find('"') {
                                let rest2 = &rest[mid + 1..];
                                if let Some(start2) = rest2.find('"') {
                                    let rest3 = &rest2[start2 + 1..];
                                    if let Some(end) = rest3.find('"') {
                                        let lib_path = &rest3[..end];
                                        let game_path = PathBuf::from(lib_path)
                                            .join("steamapps")
                                            .join("common")
                                            .join(game_folder);
                                        if game_path.exists() {
                                            return Some(game_path);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

#[cfg(not(windows))]
fn find_steam_game_path(_app_id: &str, _game_folder: &str) -> Option<PathBuf> {
    None
}

fn get_plugin_path(game_path: &PathBuf) -> PathBuf {
    game_path.join("bin").join("win_x64").join("plugins").join("local-radio.dll")
}

#[tauri::command]
fn plugin_get_status() -> PluginStatus {
    let ets2_path = find_steam_game_path("227300", "Euro Truck Simulator 2");
    let ats_path = find_steam_game_path("270880", "American Truck Simulator");

    PluginStatus {
        ets2: GameInstallStatus {
            path: ets2_path.as_ref().map(|p| p.to_string_lossy().to_string()),
            plugin_installed: ets2_path
                .as_ref()
                .map(|p| get_plugin_path(p).exists())
                .unwrap_or(false),
        },
        ats: GameInstallStatus {
            path: ats_path.as_ref().map(|p| p.to_string_lossy().to_string()),
            plugin_installed: ats_path
                .as_ref()
                .map(|p| get_plugin_path(p).exists())
                .unwrap_or(false),
        },
    }
}

#[tauri::command]
fn plugin_install(game: String, app_handle: tauri::AppHandle) -> Result<bool, String> {
    let game_folder = match game.as_str() {
        "ets2" => "Euro Truck Simulator 2",
        "ats" => "American Truck Simulator",
        _ => return Err("Invalid game".to_string()),
    };

    let app_id = match game.as_str() {
        "ets2" => "227300",
        "ats" => "270880",
        _ => return Err("Invalid game".to_string()),
    };

    let game_path = find_steam_game_path(app_id, game_folder)
        .ok_or_else(|| format!("{} not found", game_folder))?;

    let plugins_dir = game_path.join("bin").join("win_x64").join("plugins");

    // Create plugins directory if it doesn't exist
    fs::create_dir_all(&plugins_dir)
        .map_err(|e| format!("Failed to create plugins directory: {}", e))?;

    // Get the bundled plugin from resources
    let resource_path = app_handle
        .path()
        .resolve("resources/local-radio.dll", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve resource path: {}", e))?;

    let dest_path = plugins_dir.join("local-radio.dll");

    fs::copy(&resource_path, &dest_path)
        .map_err(|e| format!("Failed to copy plugin: {}", e))?;

    Ok(true)
}

#[tauri::command]
fn plugin_uninstall(game: String) -> Result<bool, String> {
    let game_folder = match game.as_str() {
        "ets2" => "Euro Truck Simulator 2",
        "ats" => "American Truck Simulator",
        _ => return Err("Invalid game".to_string()),
    };

    let app_id = match game.as_str() {
        "ets2" => "227300",
        "ats" => "270880",
        _ => return Err("Invalid game".to_string()),
    };

    let game_path = find_steam_game_path(app_id, game_folder)
        .ok_or_else(|| format!("{} not found", game_folder))?;

    let plugin_path = get_plugin_path(&game_path);

    if plugin_path.exists() {
        fs::remove_file(&plugin_path)
            .map_err(|e| format!("Failed to remove plugin: {}", e))?;
    }

    Ok(true)
}

// ============================================================================
// Tauri App Runner
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config_path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ETS2LocalRadio");

    let state = Arc::new(AppState::new(config_path));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            telemetry_get,
            favourites_get_all,
            favourites_get_one,
            favourites_set,
            game_get,
            game_set,
            language_get,
            language_set,
            commands_get,
            plugin_get_status,
            plugin_install,
            plugin_uninstall,
            // Remote control
            remote_enable,
            remote_disable,
            remote_status,
            remote_get_url,
            remote_update_state,
            remote_get_command_rx,
            // Overlay
            overlay_start,
            overlay_stop,
            overlay_attach,
            overlay_detach,
            overlay_show,
            overlay_hide,
            overlay_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
