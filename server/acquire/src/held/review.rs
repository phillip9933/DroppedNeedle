//! Decide which held downloads are optional using the indexed copy and
//! the original download's edition. This never changes a held file.

use std::collections::{HashMap, HashSet};

use droppedneedle_library::identity::reads::copy_for_group;
use rusqlite::Connection;

use super::store::{Entry, EntryOrigin, HeldFile};
use crate::dispatch::DispatchOrigin;
use crate::downloads::plan::{ExpectedTrack, TaskPlan};
use crate::downloads::store::{DownloadStore, StoreError};
use crate::landing::sql::GROUP_TRACKS;
use crate::reason::Reason;

pub(super) fn optional_copy(conn: &Connection, entry: &Entry) -> Result<bool, StoreError> {
    if entry.origin != EntryOrigin::Download
        || entry.recording_mbid.is_some()
        || entry.files.is_empty()
    {
        return Ok(false);
    }
    let Some(group) = entry.release_group_mbid.as_deref() else {
        return Ok(false);
    };
    let mut by_task: HashMap<&str, Vec<&HeldFile>> = HashMap::new();
    for file in &entry.files {
        // A recording conflict, an import problem or an explicit upgrade
        // decision still matters even when the requested edition is full.
        if !matches!(
            file.reason,
            Reason::WeakMatch
                | Reason::TagMismatch
                | Reason::OwnedOnAlbum
                | Reason::NoBetterThanYours
        ) {
            return Ok(false);
        }
        if file.reason == Reason::TagMismatch && file.pairing.release_track_mbid.is_none() {
            return Ok(false);
        }
        let Some(id) = file.source_task_id.as_deref() else {
            return Ok(false);
        };
        by_task.entry(id).or_default().push(file);
    }
    let Some(copy) = copy_for_group(conn, group)? else {
        return Ok(false);
    };
    let Some(release) = copy.release_mbid.as_deref() else {
        return Ok(false);
    };
    let placed: HashSet<String> = conn
        .prepare_cached(GROUP_TRACKS.text())?
        .query_map((group.to_ascii_lowercase(), &copy.album_id), |row| {
            row.get(0)
        })?
        .collect::<rusqlite::Result<_>>()?;
    let downloads = DownloadStore::new(conn);
    for (id, files) in by_task {
        let Some(task) = downloads.get_task(id)? else {
            return Ok(false);
        };
        if task.download_type != "album"
            || !task.release_group_mbid.eq_ignore_ascii_case(group)
            || task.picked_by_person
            || matches!(
                task.origin,
                DispatchOrigin::Upgrade | DispatchOrigin::Edition
            )
        {
            return Ok(false);
        }
        let plan = downloads.task_plan(id)?;
        if !plan.is_for(release)
            || plan.planned_album.is_some()
            || plan.expected_tracks.is_empty()
            || !plan.expected_tracks.iter().all(|track| {
                track
                    .release_track_mbid
                    .as_deref()
                    .is_some_and(|id| placed.contains(&id.to_ascii_lowercase()))
            })
            || !files.iter().all(|file| on_edition(file, &plan))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn on_edition(file: &HeldFile, plan: &TaskPlan) -> bool {
    let pair = &file.pairing;
    if pair
        .release_mbid
        .as_deref()
        .is_some_and(|id| !plan.is_for(id))
    {
        return false;
    }
    let agrees = |track: &ExpectedTrack| {
        if let Some(id) = pair.release_track_mbid.as_deref() {
            track
                .release_track_mbid
                .as_deref()
                .is_some_and(|expected| id.eq_ignore_ascii_case(expected))
        } else {
            pair.disc_number == Some(track.disc_number)
                && pair.track_number == Some(track.track_number)
        }
    };
    plan.expected_tracks.iter().any(|track| {
        agrees(track)
            && pair.recording_mbid.as_deref().is_none_or(|id| {
                track
                    .recording_mbid
                    .as_deref()
                    .is_some_and(|expected| id.eq_ignore_ascii_case(expected))
            })
    })
}
