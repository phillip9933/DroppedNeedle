//! Live, account-scoped control of players that explicitly make themselves available.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    Json,
    extract::{FromRef, State},
    http::StatusCode,
};
use droppedneedle_auth::User;
use droppedneedle_kernel::{
    error::ApiError,
    extract::ValidJson,
    mount::{Routes, routes},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::PlaybackDeps;

const LIVE_MS: i64 = 45_000;
const COMMAND_MS: i64 = 30_000;
const MAX_TRACKS: usize = 2000;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct TransferTrack {
    /// Track gain in decibels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaygain_track_gain: Option<f64>,
    /// Album gain in decibels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaygain_album_gain: Option<f64>,
    /// Track peak relative to digital full scale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaygain_track_peak: Option<f64>,
    /// Album peak relative to digital full scale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaygain_album_peak: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_mbid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording_mbid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_group_mbid: Option<String>,
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_id: Option<String>,
    pub artist_id: Option<String>,
    pub duration: Option<f64>,
    pub format: Option<String>,
    pub track_number: Option<i64>,
    pub disc_number: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct TransferQueue {
    pub tracks: Vec<TransferTrack>,
    pub index: usize,
    pub position_ms: i64,
    pub playing: bool,
}

impl TransferQueue {
    fn valid(&self) -> bool {
        self.tracks.len() <= MAX_TRACKS
            && self.index < self.tracks.len()
            && (0..=604_800_000).contains(&self.position_ms)
            && self.tracks.iter().all(|t| {
                let safe_id = |s: &str| {
                    !s.is_empty()
                        && s.len() <= 128
                        && s.bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
                };
                safe_id(&t.id)
                    && t.album_id.as_deref().is_none_or(safe_id)
                    && t.artist_id.as_deref().is_none_or(safe_id)
                    && [&t.artist_mbid, &t.recording_mbid, &t.release_group_mbid]
                        .into_iter()
                        .flatten()
                        .all(|id| Uuid::parse_str(id).is_ok())
                    && t.title.len() <= 1024
                    && t.artist.len() <= 1024
                    && t.album.len() <= 1024
                    && t.format.as_ref().is_none_or(|s| s.len() <= 64)
                    && t.duration
                        .is_none_or(|n| n.is_finite() && (0.0..=604_800.0).contains(&n))
            })
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceAction {
    Play,
    Pause,
    Next,
    Previous,
    Transfer,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeviceControlRequest {
    pub id: String,
    pub target: String,
    pub action: DeviceAction,
    pub destination: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct DeviceCommand {
    pub id: String,
    pub action: DeviceAction,
    /// Filled only when the destination receives the queue released by the source.
    pub queue: Option<TransferQueue>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeviceReceipt {
    pub id: String,
    pub error: Option<String>,
    pub queue: Option<TransferQueue>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeviceHeartbeat {
    pub id: String,
    pub name: String,
    pub title: Option<String>,
    pub playing: bool,
    pub can_transfer: bool,
    pub receipt: Option<DeviceReceipt>,
    #[serde(default)]
    pub disconnect: bool,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct LinkedDevice {
    pub id: String,
    pub name: String,
    pub title: Option<String>,
    pub playing: bool,
    pub can_transfer: bool,
    pub busy: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceUpdate {
    pub devices: Vec<LinkedDevice>,
    pub command: Option<DeviceCommand>,
}

#[derive(Clone)]
struct Pending {
    command: DeviceCommand,
    destination: Option<String>,
    deadline: i64,
}

struct Entry {
    summary: LinkedDevice,
    seen: i64,
    pending: Option<Pending>,
    reservation: Option<(String, i64)>,
    last_receipt: Option<String>,
}

impl Entry {
    fn busy(&self) -> bool {
        self.pending.is_some() || self.reservation.is_some()
    }
}

type Players = HashMap<(String, String), Entry>;

/// A queue is retained only while both players cooperate in a live handoff.
#[derive(Clone, Default)]
pub struct DeviceRegistry(Arc<Mutex<Players>>);

impl DeviceRegistry {
    fn with<T>(&self, now: i64, operation: impl FnOnce(&mut Players) -> T) -> T {
        let mut players = self.0.lock().unwrap_or_else(|err| err.into_inner());
        players.retain(|_, entry| entry.seen > now - LIVE_MS);
        for entry in players.values_mut() {
            if entry.pending.as_ref().is_some_and(|p| p.deadline <= now) {
                entry.pending = None;
                entry.summary.error = Some("The other player did not respond in time.".into());
            }
            if entry.reservation.as_ref().is_some_and(|(_, t)| *t <= now) {
                entry.reservation = None;
            }
        }
        operation(&mut players)
    }

    pub fn sync(
        &self,
        user: &str,
        hb: DeviceHeartbeat,
        now: i64,
    ) -> Result<DeviceUpdate, ApiError> {
        if Uuid::parse_str(&hb.id).is_err()
            || hb.name.trim().is_empty()
            || hb.name.chars().take(81).count() > 80
        {
            return Err(ApiError::invalid_input("Invalid player identity or name."));
        }
        let key = (user.to_owned(), hb.id.clone());
        self.with(now, |players| {
            if hb.disconnect {
                if let Some(leaving) = players.remove(&key) {
                    if let Some(pending) = leaving.pending
                        && let Some(dest) = pending.destination
                        && let Some(target) = players.get_mut(&(user.to_owned(), dest))
                        && target
                            .reservation
                            .as_ref()
                            .is_some_and(|(id, _)| *id == pending.command.id)
                    {
                        target.reservation = None;
                    }
                    if let Some((reservation, _)) = leaving.reservation {
                        for ((owner, _), source) in players.iter_mut() {
                            if owner == user
                                && source.pending.as_ref().is_some_and(|p| {
                                    p.command.id == reservation
                                        && p.destination.as_ref() == Some(&hb.id)
                                })
                            {
                                source.pending = None;
                                source.summary.error =
                                    Some("The destination player disconnected.".into());
                            }
                        }
                    }
                }
                return Ok(DeviceUpdate {
                    devices: Vec::new(),
                    command: None,
                });
            }
            if !players.contains_key(&key)
                && (players.len() >= 2048
                    || players.keys().filter(|(u, _)| u == user).count() >= 16)
            {
                return Err(ApiError::conflict("Too many active players."));
            }
            let entry = players.entry(key.clone()).or_insert_with(|| Entry {
                summary: LinkedDevice {
                    id: hb.id,
                    name: String::new(),
                    title: None,
                    playing: false,
                    can_transfer: false,
                    busy: false,
                    error: None,
                },
                seen: now,
                pending: None,
                reservation: None,
                last_receipt: None,
            });
            entry.seen = now;
            entry.summary.name = hb.name;
            entry.summary.title = hb.title.map(|title| title.chars().take(1024).collect());
            entry.summary.playing = hb.playing;
            entry.summary.can_transfer = hb.can_transfer;
            if let Some((receipt, pending)) = hb.receipt.and_then(|r| {
                entry
                    .pending
                    .take_if(|p| p.command.id == r.id)
                    .map(|p| (r, p))
            }) {
                entry.last_receipt = Some(receipt.id.clone());
                let mut problem = receipt
                    .error
                    .map(|s| s.chars().take(180).collect::<String>());
                if let Some(destination) = pending.destination {
                    if let Some(target) =
                        players
                            .get_mut(&(user.to_owned(), destination))
                            .filter(|e| {
                                e.reservation
                                    .as_ref()
                                    .is_some_and(|(id, _)| id == &receipt.id)
                            })
                    {
                        target.reservation = None;
                        if problem.is_none() {
                            if let Some(queue) = receipt.queue.filter(TransferQueue::valid) {
                                target.pending = Some(Pending {
                                    command: DeviceCommand {
                                        id: receipt.id,
                                        action: DeviceAction::Transfer,
                                        queue: Some(queue),
                                    },
                                    destination: None,
                                    deadline: now + COMMAND_MS,
                                });
                            } else {
                                problem = Some("This queue cannot be transferred.".into());
                            }
                        }
                    } else {
                        problem = Some("The destination player disconnected.".into());
                    }
                }
                if let Some(e) = players.get_mut(&key) {
                    e.summary.error = problem;
                }
            }
            let mut devices: Vec<_> = players
                .iter()
                .filter(|((owner, _), _)| owner == user)
                .map(|(_, e)| {
                    let mut result = e.summary.clone();
                    result.busy = e.busy();
                    result
                })
                .collect();
            devices.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
            Ok(DeviceUpdate {
                devices,
                command: players
                    .get(&key)
                    .and_then(|e| e.pending.as_ref())
                    .map(|p| p.command.clone()),
            })
        })
    }

    pub fn control(&self, user: &str, req: DeviceControlRequest, now: i64) -> Result<(), ApiError> {
        if Uuid::parse_str(&req.id).is_err()
            || (req.action == DeviceAction::Transfer) != req.destination.is_some()
            || req.destination.as_ref() == Some(&req.target)
        {
            return Err(ApiError::invalid_input("Invalid player command."));
        }
        self.with(now, |players| {
            let key = (user.to_owned(), req.target);
            let source = players.get(&key).ok_or_else(ApiError::not_found)?;
            if source.last_receipt.as_deref() == Some(&req.id)
                || source
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.command.id == req.id)
            {
                return Ok(());
            }
            if source.busy() {
                return Err(ApiError::conflict(
                    "This player is handling another command.",
                ));
            }
            if let Some(destination) = &req.destination {
                if !source.summary.can_transfer {
                    return Err(ApiError::conflict(
                        "This player has no transferable DN queue.",
                    ));
                }
                let target = players
                    .get_mut(&(user.to_owned(), destination.clone()))
                    .ok_or_else(ApiError::not_found)?;
                if target.busy() {
                    return Err(ApiError::conflict("The destination player is busy."));
                }
                target.summary.error = None;
                target.reservation = Some((req.id.clone(), now + COMMAND_MS));
            }
            let source = players.get_mut(&key).ok_or_else(ApiError::not_found)?;
            source.summary.error = None;
            source.pending = Some(Pending {
                command: DeviceCommand {
                    id: req.id,
                    action: req.action,
                    queue: None,
                },
                destination: req.destination,
                deadline: now + COMMAND_MS,
            });
            Ok(())
        })
    }
}

/// Advertise this player and acknowledge the last command it handled.
#[utoipa::path(
    post, tag = "playback", path = "/api/v3/playback/devices/sync", request_body = DeviceHeartbeat,
    responses(
        (status = 200, description = "This listener's live players and this device's command", body = DeviceUpdate),
        (status = 400, description = "Invalid heartbeat"),
        (status = 401, description = "Not authenticated"),
        (status = 409, description = "Player limit reached")
    )
)]
pub async fn sync_device(
    State(deps): State<PlaybackDeps>,
    User(user): User,
    ValidJson(body): ValidJson<DeviceHeartbeat>,
) -> Result<Json<DeviceUpdate>, ApiError> {
    deps.devices
        .sync(user.user_id(), body, deps.clock.now_ms())
        .map(Json)
}

/// Send a transport or handoff request to one of this listener's live players.
#[utoipa::path(
    post, tag = "playback", path = "/api/v3/playback/devices/control", request_body = DeviceControlRequest,
    responses(
        (status = 204, description = "Command queued"),
        (status = 400, description = "Invalid command"),
        (status = 401, description = "Not authenticated"),
        (status = 404, description = "Player unavailable"),
        (status = 409, description = "Player busy or queue unavailable")
    )
)]
pub async fn control_device(
    State(deps): State<PlaybackDeps>,
    User(user): User,
    ValidJson(body): ValidJson<DeviceControlRequest>,
) -> Result<StatusCode, ApiError> {
    deps.devices
        .control(user.user_id(), body, deps.clock.now_ms())?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn routes<S>() -> Routes<S>
where
    S: Clone + Send + Sync + 'static,
    PlaybackDeps: FromRef<S>,
{
    Routes::new()
        .user(routes!(sync_device))
        .user(routes!(control_device))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_multilingual_name_and_long_song_title_keep_a_player_available() {
        let registry = DeviceRegistry::default();
        let name = "台所のスピーカー".repeat(5);
        let title = "🎶".repeat(1025);
        let update = registry
            .sync(
                "listener",
                DeviceHeartbeat {
                    id: Uuid::new_v4().to_string(),
                    name: name.clone(),
                    title: Some(title),
                    playing: true,
                    can_transfer: false,
                    receipt: None,
                    disconnect: false,
                },
                0,
            )
            .unwrap();
        assert_eq!(update.devices[0].name, name);
        assert_eq!(update.devices[0].title, Some("🎶".repeat(1024)));
        assert!(update.devices[0].playing);
    }

    #[test]
    fn expired_commands_and_disconnected_destinations_release_the_source() {
        let devices = DeviceRegistry::default();
        let phone = Uuid::new_v4().to_string();
        let browser = Uuid::new_v4().to_string();
        let heartbeat = |id: &str, disconnect| DeviceHeartbeat {
            id: id.to_owned(),
            name: "Player".into(),
            title: None,
            playing: false,
            can_transfer: true,
            receipt: None,
            disconnect,
        };
        for id in [&phone, &browser] {
            devices.sync("a", heartbeat(id, false), 0).unwrap();
        }
        let request = || DeviceControlRequest {
            id: Uuid::new_v4().to_string(),
            target: phone.clone(),
            destination: Some(browser.clone()),
            action: DeviceAction::Transfer,
        };
        devices.control("a", request(), 1).unwrap();
        devices.sync("a", heartbeat(&browser, true), 3).unwrap();
        let update = devices.sync("a", heartbeat(&phone, false), 4).unwrap();
        assert!(update.command.is_none());
        assert!(!update.devices[0].busy);
        assert!(update.devices[0].error.is_some());
        devices.sync("a", heartbeat(&browser, false), 5).unwrap();
        devices.control("a", request(), 6).unwrap();
        let update = devices
            .sync("a", heartbeat(&phone, false), 6 + COMMAND_MS)
            .unwrap();
        assert!(update.command.is_none());
        assert!(update.devices.iter().all(|d| !d.busy));
        assert_eq!(
            devices
                .sync("a", heartbeat(&phone, false), 6 + LIVE_MS)
                .unwrap()
                .devices
                .len(),
            1
        );
    }
}
