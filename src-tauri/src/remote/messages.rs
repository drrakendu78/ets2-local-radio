use serde::{Deserialize, Serialize};

/// Radio state sent to remote clients
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioState {
    pub station_id: String,
    pub station_name: String,
    pub country: String,
    pub volume: f64,
    pub playing: bool,
    pub muted: bool,
}

impl Default for RadioState {
    fn default() -> Self {
        Self {
            station_id: String::new(),
            station_name: String::from("-"),
            country: String::from("-"),
            volume: 1.0,
            playing: false,
            muted: false,
        }
    }
}

/// Commands from remote clients
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RemoteCommand {
    #[serde(rename = "auth")]
    Auth { token: String },
    #[serde(rename = "next")]
    Next,
    #[serde(rename = "prev")]
    Previous,
    #[serde(rename = "play")]
    Play,
    #[serde(rename = "pause")]
    Pause,
    #[serde(rename = "togglePlay")]
    TogglePlay,
    #[serde(rename = "volume")]
    Volume { value: f64 },
    #[serde(rename = "mute")]
    Mute,
    #[serde(rename = "unmute")]
    Unmute,
    #[serde(rename = "favourite")]
    Favourite,
    #[serde(rename = "getState")]
    GetState,
}

/// Messages sent to remote clients
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "authResult")]
    AuthResult { success: bool, message: String },
    #[serde(rename = "state")]
    State(RadioState),
    #[serde(rename = "command")]
    Command { action: String },
    #[serde(rename = "error")]
    Error { message: String },
}
