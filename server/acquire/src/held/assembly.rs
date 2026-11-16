//! Assign verified held files to one chosen edition.

use std::collections::HashMap;
use std::io::{self, Read as _};
use std::path::{Path, PathBuf};

use droppedneedle_library::identify::sources::AcoustIdUnavailable;
use droppedneedle_library::matching::score::SAME_MASTER_SECS;
use droppedneedle_library::matching::{Release, ReleaseTrack};
use droppedneedle_providers::RequestPriority;

use super::store::HeldFile;
use crate::drop_import::extract::{FREE_SPACE_MARGIN, MAX_ARCHIVE_BYTES};
use crate::landing::confine;
use crate::landing::ports::{LandingLibrary, VerifiedSources};
use crate::landing::probe::{LandedFile, probe_beneath};
use crate::landing::quality;
use crate::reason::Reason;

/// Copy the candidates off their original paths before reading tags or
/// asking AcoustID. The publisher still records each original held path.
pub(super) fn snapshot(
    held_root: &Path,
    files: Vec<HeldFile>,
    skipped: &[PathBuf],
) -> io::Result<(VerifiedSources, Vec<(HeldFile, LandedFile)>)> {
    let held_root = held_root.canonicalize()?;
    let mut remaining = match droppedneedle_library::adapters::free_bytes_for(&held_root) {
        Ok(free) => free
            .saturating_sub(FREE_SPACE_MARGIN)
            .min(MAX_ARCHIVE_BYTES),
        Err(error) => {
            tracing::warn!(%error, "held assembly free space unknown");
            MAX_ARCHIVE_BYTES
        }
    };
    let root = held_root.join(format!(".assembly-{}", uuid::Uuid::new_v4().simple()));
    confine::create_private_dir(&held_root, &root)?;
    let mut snapshots = VerifiedSources {
        held_root,
        root,
        files: HashMap::new(),
    };
    let mut candidates = HashMap::new();
    for file in files {
        let Some(original) = super::below(&snapshots.held_root, &file.path) else {
            continue;
        };
        if skipped.iter().any(|folder| original.starts_with(folder)) {
            continue;
        }
        let Some(name) = original.file_name() else {
            continue;
        };
        let source =
            match confine::open_beneath(std::slice::from_ref(&snapshots.held_root), &original) {
                Ok(source) => source,
                Err(error) => {
                    tracing::debug!(file_id = file.id, %error, "held assembly source unreadable");
                    continue;
                }
            };
        if snapshots.files.contains_key(&original) {
            continue;
        }
        if source.metadata()?.len() > remaining {
            return Err(snapshot_limit());
        }
        let dir = snapshots.root.join(file.id.to_string());
        let copy = dir.join(name);
        snapshots.files.insert(original, copy.clone());
        confine::create_private_dir(&snapshots.root, &dir)?;
        let mut dest = confine::create_private_file(&snapshots.root, &copy)?;
        let copied = io::copy(&mut source.take(remaining + 1), &mut dest)?;
        remaining = remaining.checked_sub(copied).ok_or_else(snapshot_limit)?;
        candidates.insert(copy, file);
    }
    let paths: Vec<_> = candidates.keys().cloned().collect();
    let landing = probe_beneath(&paths, skipped, Some(&snapshots.root));
    let audio = landing
        .audio
        .into_iter()
        .filter_map(|audio| candidates.remove(&audio.path).map(|file| (file, audio)))
        .collect();
    Ok((snapshots, audio))
}

fn snapshot_limit() -> io::Error {
    io::Error::other(
        "The held files are too large to verify together with the available disk space.",
    )
}

/// Unlink the original only while it still contains the published bytes.
pub(super) fn consume(snapshots: &VerifiedSources, original: &Path) -> io::Result<bool> {
    let copy = snapshots
        .files
        .get(original)
        .ok_or_else(|| io::Error::other("there is no verified assembly copy for this file"))?;
    let verified = confine::hash_beneath(std::slice::from_ref(&snapshots.root), copy)?;
    let held = std::slice::from_ref(&snapshots.held_root);
    let current = confine::hash_beneath(held, original)?;
    if current.sha256 != verified.sha256 {
        return Ok(false);
    }
    confine::remove_beneath_if_unchanged(held, original, &current)
}

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
