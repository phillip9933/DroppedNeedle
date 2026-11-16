//! What acquisition asks MusicBrainz: which releases carry a recording,
//! the tracklist of one release, and the default edition and date of a
//! release group. [`AlbumLookup`] is the port;
//! [`MusicBrainzAlbums`] answers it over the shared client. Lookups are
//! identity critical: an outage is an error, never an empty answer that
//! would read as "no album".

use futures_util::future::BoxFuture;

use droppedneedle_catalog::metadata::album::GroupDetail;
use droppedneedle_kernel::runtime_config::ConfigStore;
use droppedneedle_library::edition_prefs::LivePreferences;
use droppedneedle_providers::musicbrainz::{
    Criticality, LiveSource, MbRelease, MusicBrainzClient, MusicBrainzView, is_valid_mbid,
    parse_year,
};
use droppedneedle_providers::{
    CacheKey, Fetched, Policy, ProviderCacheStore, RequestPriority, Source,
};
use serde::{Deserialize, Serialize};

/// Various Artists: a compilation credit that no Soulseek path carries.
pub const VARIOUS_ARTISTS_MBID: &str = "89ad4ac3-39f7-470e-963a-56509c546377";

/// Medium formats that carry video, not downloadable audio.
/// DVD-Audio stays.
const VIDEO_FORMATS: [&str; 12] = [
    "dvd",
    "dvd-video",
    "blu-ray",
    "hd-dvd",
    "hdv",
    "vhs",
    "betamax",
    "video cd",
    "video-cd",
    "vcd",
    "svcd",
    "laserdisc",
];

/// One release carrying a recording, with the fields release choice ranks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseCandidate {
    /// Release MBID, lowercase.
    pub id: String,
    /// `Official`, `Bootleg`, ...
    pub status: Option<String>,
    /// Release date.
    pub date: Option<String>,
    /// Release-group MBID, lowercase.
    pub release_group_mbid: String,
    /// Group primary type (`Album`, `Single`, ...).
    pub primary_type: Option<String>,
    /// Group secondary types (`Compilation`, `Live`, ...).
    pub secondary_types: Vec<String>,
}

/// One audio track of a release.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct AlbumTrack {
    /// Disc number (1-based).
    pub disc: u32,
    /// Position on the disc (1-based).
    pub position: u32,
    /// Track title on this release.
    pub title: String,
    /// Length in seconds.
    pub duration_seconds: Option<f64>,
    /// Recording MBID, lowercase.
    pub recording_mbid: String,
    /// Release-track MBID, lowercase.
    pub release_track_mbid: String,
}

/// One release with its audio tracklist.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct AlbumRelease {
    /// Release MBID, lowercase.
    pub id: String,
    /// Release title.
    pub title: String,
    /// Release-group MBID, lowercase.
    pub release_group_mbid: String,
    /// Credited release artist.
    pub artist: String,
    /// Whether the release is credited to Various Artists.
    pub various_artists: bool,
    /// Year of the group's first release, else of this release.
    pub year: Option<i32>,
    /// Audio tracks in disc and position order.
    pub tracks: Vec<AlbumTrack>,
}

/// MusicBrainz could not answer.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("musicbrainz lookup failed: {0}")]
pub struct LookupError(pub String);

/// Why a default album edition could not be resolved.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GroupLookupError {
    /// Choosing an edition requires the saved preferences.
    #[error("could not read edition preferences")]
    Preferences,
    /// The provider did not give a usable answer.
    #[error(transparent)]
    Provider(#[from] LookupError),
}

/// The MusicBrainz reads acquisition needs.
pub trait AlbumLookup: Send + Sync {
    /// Releases carrying one recording; `None` when MusicBrainz does not
    /// know the recording.
    fn recording_releases<'a>(
        &'a self,
        recording_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<Vec<ReleaseCandidate>>, LookupError>>;

    /// One release with its audio tracklist; `None` when unknown.
    fn release<'a>(
        &'a self,
        release_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<AlbumRelease>, LookupError>>;

    /// The preferred edition with an audio tracklist, for a task without
    /// an edition. `None` when MusicBrainz has no usable edition.
    fn preferred_release<'a>(
        &'a self,
        release_group_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<AlbumRelease>, GroupLookupError>>;

    /// A release group's first release date as MusicBrainz gives it
    /// (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`); `None` when the group is
    /// unknown or undated.
    fn first_release_date<'a>(
        &'a self,
        release_group_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, LookupError>>;
}

/// [`AlbumLookup`] over the MusicBrainz client.
pub struct MusicBrainzAlbums {
    client: MusicBrainzClient,
    source: LiveSource,
    cache: ProviderCacheStore,
    preferences: LivePreferences,
}

impl MusicBrainzAlbums {
    fn live_client(&self) -> MusicBrainzView {
        self.client
            .live(self.source.clone(), RequestPriority::BackgroundSync)
    }

    /// Cache exact releases for group resolution, including definite misses,
    /// but do not cache a reply that failed to prove the release's identity.
    async fn group_release(
        &self,
        client: &MusicBrainzView,
        namespace: &str,
        group_mbid: &str,
        release_mbid: String,
    ) -> Result<Option<AlbumRelease>, LookupError> {
        let key = CacheKey::new(
            Source::MusicBrainz,
            &[
                namespace,
                "acquire_group_release",
                group_mbid,
                &release_mbid,
            ],
        );
        let (client, group_mbid) = (client.clone(), group_mbid.to_owned());
        self.cache
            .get_or_fetch(
                &key,
                Policy::MUSICBRAINZ_ENTITY,
                RequestPriority::BackgroundSync,
                move |_| async move {
                    let Some(found) = client
                        .lookup_exact_release(&release_mbid, Criticality::IdentityCritical)
                        .await
                        .map_err(|error| LookupError(error.to_string()))?
                    else {
                        return Ok(Fetched::Missing);
                    };
                    let resolved = found
                        .redirects
                        .last()
                        .map_or(release_mbid.as_str(), |hop| hop.to_mbid.as_str());
                    if !found.entity.id.eq_ignore_ascii_case(resolved)
                        || !found
                            .entity
                            .release_group
                            .as_ref()
                            .is_some_and(|group| group.id.eq_ignore_ascii_case(&group_mbid))
                    {
                        return Err(LookupError(format!(
                            "release {release_mbid} did not resolve to an edition of {group_mbid}"
                        )));
                    }
                    Ok(
                        match album_release(found.entity).filter(|album| !album.tracks.is_empty()) {
                            Some(album) => Fetched::Found(album),
                            None => Fetched::Missing,
                        },
                    )
                },
            )
            .await
    }
}

impl AlbumLookup for MusicBrainzAlbums {
    fn recording_releases<'a>(
        &'a self,
        recording_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<Vec<ReleaseCandidate>>, LookupError>> {
        Box::pin(async move {
            let found = self
                .live_client()
                .lookup_recording(
                    recording_mbid,
                    &["releases", "release-groups"],
                    Criticality::IdentityCritical,
                )
                .await
                .map_err(|error| LookupError(error.to_string()))?;
            Ok(found.map(|lookup| {
                lookup
                    .entity
                    .releases
                    .into_iter()
                    .filter_map(|release| {
                        let group = release.release_group?;
                        Some(ReleaseCandidate {
                            id: release.id.to_ascii_lowercase(),
                            status: release.status,
                            date: release.date,
                            release_group_mbid: group.id.to_ascii_lowercase(),
                            primary_type: group.primary_type,
                            secondary_types: group.secondary_types,
                        })
                    })
                    .collect()
            }))
        })
    }

    fn release<'a>(
        &'a self,
        release_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<AlbumRelease>, LookupError>> {
        Box::pin(async move {
            let found = self
                .live_client()
                .lookup_exact_release(release_mbid, Criticality::IdentityCritical)
                .await
                .map_err(|error| LookupError(error.to_string()))?;
            Ok(found.and_then(|lookup| album_release(lookup.entity)))
        })
    }

    fn preferred_release<'a>(
        &'a self,
        release_group_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<AlbumRelease>, GroupLookupError>> {
        Box::pin(async move {
            if !is_valid_mbid(release_group_mbid) {
                return Ok(None);
            }
            let prefs = self
                .preferences
                .current()
                .ok_or(GroupLookupError::Preferences)?;
            let (source, namespace) = self
                .source
                .cache_source()
                .ok_or_else(|| LookupError("could not read MusicBrainz settings".to_owned()))?;
            let group_mbid = release_group_mbid.trim().to_ascii_lowercase();
            let client = self.client.fixed(source, RequestPriority::BackgroundSync);
            let key = CacheKey::new(
                Source::MusicBrainz,
                &[&namespace, "acquire_group", &group_mbid],
            );
            let group = self
                .cache
                .get_or_fetch(
                    &key,
                    Policy::MUSICBRAINZ_ENTITY,
                    RequestPriority::BackgroundSync,
                    {
                        let (client, mbid) = (client.clone(), group_mbid.clone());
                        move |_| async move {
                            let found = client
                                .lookup_release_group(
                                    &mbid,
                                    &["media", "releases"],
                                    Criticality::IdentityCritical,
                                )
                                .await
                                .map_err(|error| LookupError(error.to_string()))?;
                            match found {
                                None => Ok(Fetched::Missing),
                                Some(found) if found.entity.id.eq_ignore_ascii_case(&mbid) => {
                                    Ok(Fetched::Found(GroupDetail::from_wire(found.entity)))
                                }
                                Some(_) => Err(LookupError(format!(
                                    "MusicBrainz answered for a different release group than {mbid}"
                                ))),
                            }
                        }
                    },
                )
                .await?;
            let Some(group) = group else {
                return Ok(None);
            };
            for candidate in group.default_edition_candidates(&prefs) {
                if !is_valid_mbid(&candidate) {
                    return Err(LookupError(format!(
                        "invalid release MBID for group {group_mbid}"
                    ))
                    .into());
                }
                if let Some(album) = self
                    .group_release(
                        &client,
                        &namespace,
                        &group_mbid,
                        candidate.to_ascii_lowercase(),
                    )
                    .await?
                {
                    return Ok(Some(album));
                }
            }
            Ok(None)
        })
    }

    fn first_release_date<'a>(
        &'a self,
        release_group_mbid: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, LookupError>> {
        Box::pin(async move {
            let found = self
                .live_client()
                .lookup_release_group(release_group_mbid, &[], Criticality::IdentityCritical)
                .await
                .map_err(|error| LookupError(error.to_string()))?;
            Ok(found
                .and_then(|lookup| lookup.entity.first_release_date)
                .filter(|date| !date.trim().is_empty()))
        })
    }
}

/// The production lookups: background priority on the shared limiter,
/// the configured MusicBrainz source read per request, failures counted
/// toward system health.
pub fn live_albums(
    providers: &droppedneedle_providers::Providers,
    source: LiveSource,
    config: &ConfigStore,
) -> MusicBrainzAlbums {
    MusicBrainzAlbums {
        client: providers.musicbrainz.clone(),
        source,
        cache: providers.cache.clone(),
        preferences: LivePreferences::new(config),
    }
}

/// The wire release as acquisition reads it: audio media only, tracks
/// without a recording or a position dropped.
pub fn album_release(release: MbRelease) -> Option<AlbumRelease> {
    let group = release.release_group?;
    let various_artists = release
        .artist_credit
        .iter()
        .any(|credit| credit.artist.id.eq_ignore_ascii_case(VARIOUS_ARTISTS_MBID));
    let artist = release
        .artist_credit
        .iter()
        .map(|credit| {
            let name = if credit.name.is_empty() {
                credit.artist.name.as_str()
            } else {
                credit.name.as_str()
            };
            format!("{name}{}", credit.joinphrase)
        })
        .collect::<String>()
        .trim()
        .to_owned();
    let mut tracks = Vec::new();
    for (index, medium) in release.media.iter().enumerate() {
        let video = medium.format.as_deref().is_some_and(|format| {
            VIDEO_FORMATS.contains(&format.trim().to_ascii_lowercase().as_str())
        });
        if video {
            continue;
        }
        let disc = medium
            .position
            .unwrap_or_else(|| u32::try_from(index + 1).unwrap_or(1));
        for track in &medium.tracks {
            let (Some(position), Some(recording)) = (track.position, track.recording.as_ref())
            else {
                continue;
            };
            tracks.push(AlbumTrack {
                disc,
                position,
                title: track.display_title().unwrap_or_default().to_owned(),
                duration_seconds: track.length_ms().map(|ms| ms as f64 / 1000.0),
                recording_mbid: recording.id.to_ascii_lowercase(),
                release_track_mbid: track.id.to_ascii_lowercase(),
            });
        }
    }
    Some(AlbumRelease {
        id: release.id.to_ascii_lowercase(),
        title: release
            .title
            .unwrap_or_else(|| group.title.clone().unwrap_or_default()),
        release_group_mbid: group.id.to_ascii_lowercase(),
        artist,
        various_artists,
        year: parse_year(group.first_release_date.as_deref())
            .or_else(|| parse_year(release.date.as_deref())),
        tracks,
    })
}
