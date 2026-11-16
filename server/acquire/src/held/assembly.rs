//! Assign verified held files to one chosen edition.

use droppedneedle_library::identify::sources::AcoustIdUnavailable;
use droppedneedle_library::matching::score::SAME_MASTER_SECS;
use droppedneedle_library::matching::{Release, ReleaseTrack};
use droppedneedle_providers::RequestPriority;

use super::store::HeldFile;
use crate::landing::ports::LandingLibrary;
use crate::landing::probe::LandedFile;
use crate::landing::quality;
use crate::reason::Reason;

/// Best verified file for each track index. A file already held for an
/// AcoustID decision still needs new audio evidence, even with exact tags.
pub(super) async fn best_copies(
    library: &dyn LandingLibrary,
    release: &Release,
    files: &[(HeldFile, LandedFile)],
) -> (Vec<Option<usize>>, Option<AcoustIdUnavailable>) {
    let mut slots = vec![None; release.tracks.len()];
    let mut needs_audio = Vec::new();
    for (index, (held, file)) in files.iter().enumerate() {
        if !file
            .header
            .duration_seconds
            .is_some_and(|secs| secs.is_finite() && secs > 0.0)
        {
            continue;
        }
        match from_tags(held, file, release) {
            Some(track) => offer(&mut slots[track], files, index),
            None => needs_audio.push(index),
        }
    }
    if needs_audio.is_empty() {
        return (slots, None);
    }
    let request = needs_audio
        .iter()
        .map(|index| (index.to_string(), files[*index].1.path.clone()))
        .collect();
    let heard = match library
        .fingerprints(request, RequestPriority::UserInitiated)
        .await
    {
        Ok(heard) => heard,
        Err(error) => return (slots, Some(error)),
    };
    for index in needs_audio {
        if let Some(recordings) = heard.get(&index.to_string())
            && let Some(track) = unique_track(release, |track| {
                recordings
                    .iter()
                    .any(|id| same_id(Some(id), &track.recording_id))
            })
            && length_fits(&files[index].1, &release.tracks[track])
        {
            offer(&mut slots[track], files, index);
        }
    }
    (slots, None)
}

fn offer(slot: &mut Option<usize>, files: &[(HeldFile, LandedFile)], candidate: usize) {
    if slot.is_none_or(|current| {
        let (held, offered) = &files[candidate];
        let (kept, best) = &files[current];
        quality::beats(offered.tier(), best.tier())
            || (offered.tier() == best.tier() && held.id < kept.id)
    }) {
        *slot = Some(candidate);
    }
}

fn from_tags(held: &HeldFile, file: &LandedFile, release: &Release) -> Option<usize> {
    let tag = &file.tag;
    if matches!(
        held.reason,
        Reason::FingerprintMismatch | Reason::FingerprintUnconfirmed | Reason::AcoustidUnavailable
    ) || !tag
        .musicbrainz_release_id
        .as_deref()
        .is_some_and(|id| release.answers_to(id.trim()))
        || tag
            .musicbrainz_release_group_id
            .as_deref()
            .is_some_and(|id| !same_id(Some(id), &release.release_group_id))
    {
        return None;
    }
    let index = unique_track(release, |track| {
        same_id(tag.musicbrainz_release_track_id.as_deref(), &track.id)
    })?;
    let track = &release.tracks[index];
    (same_id(tag.musicbrainz_recording_id.as_deref(), &track.recording_id)
        && (tag.disc_number == 0 || tag.disc_number == track.disc.max(1))
        && (tag.track_number == 0 || tag.track_number == track.position)
        && length_fits(file, track))
    .then_some(index)
}

fn same_id(id: Option<&str>, expected: &str) -> bool {
    !expected.is_empty() && id.is_some_and(|id| id.trim().eq_ignore_ascii_case(expected))
}

fn unique_track(release: &Release, fits: impl Fn(&ReleaseTrack) -> bool) -> Option<usize> {
    let mut tracks = release
        .tracks
        .iter()
        .enumerate()
        .filter(|(_, track)| fits(track));
    let (index, _) = tracks.next()?;
    tracks.next().is_none().then_some(index)
}

fn length_fits(file: &LandedFile, track: &ReleaseTrack) -> bool {
    match (file.header.duration_seconds, track.length_ms) {
        (Some(seconds), Some(wanted)) if file.header.duration_measured => {
            (seconds - wanted as f64 / 1000.0).abs() <= SAME_MASTER_SECS
        }
        _ => true,
    }
}
