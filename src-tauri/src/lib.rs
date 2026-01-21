//! ETS2/ATS Local Radio - Tauri Backend

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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
}

impl AppState {
    pub fn new(config_path: PathBuf) -> Self {
        let favourites = Self::load_favourites(&config_path);
        Self {
            favourites: Mutex::new(favourites),
            current_game: Mutex::new("ets2".to_string()),
            language: Mutex::new("en-GB".to_string()),
            config_path,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
