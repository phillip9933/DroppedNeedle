//! A whole-album download is satisfied only when one indexed copy covers
//! every release track of the edition it asks for.

use std::collections::{HashMap, HashSet};

use droppedneedle_library::identity::reads::copy_for_group;

use super::plan::ExpectedTrack;
use super::store::{DownloadStore, StoreError, TaskRow};
use crate::dispatch::DispatchOrigin;
use crate::landing::library::GroupCopy;
use crate::landing::sql::GROUP_COPIES;

pub(super) enum AlbumCoverage {
    Fetch,
    NeedsTracklist(String),
    Complete,
}

impl DownloadStore<'_> {
    pub(super) fn album_coverage(
        &self,
        task: &TaskRow,
        resolved: Option<(&str, &[ExpectedTrack])>,
    ) -> Result<AlbumCoverage, StoreError> {
        if task.download_type != "album"
            || task.release_group_mbid.is_empty()
            || task.picked_by_person
            || matches!(
                task.origin,
                DispatchOrigin::Upgrade | DispatchOrigin::Edition
            )
        {
            return Ok(AlbumCoverage::Fetch);
        }
        let group = task.release_group_mbid.to_ascii_lowercase();
        let plan = self.task_plan(&task.id)?;
        if plan.planned_album.is_some() || !plan.album_wanted.is_empty() {
            return Ok(AlbumCoverage::Fetch);
        }
        let details = self.task_details(&task.id)?;
        let requested = details
            .release_mbid
            .as_deref()
            .or(plan.release_mbid.as_deref());
        let chosen = if requested.is_none() || plan.preferred_edition {
            copy_for_group(self.conn(), &group)?.and_then(|copy| copy.release_mbid)
        } else {
            None
        };
        let Some(release) = chosen.as_deref().or(requested) else {
            return Ok(AlbumCoverage::Fetch);
        };
        // A plan may know that MusicBrainz merged the requested release.
        let is_release = |id: &str| {
            id.eq_ignore_ascii_case(release) || (plan.is_for(release) && plan.is_for(id))
        };
        let mut copies: HashMap<String, HashSet<String>> = HashMap::new();
        let mut statement = self.conn().prepare_cached(GROUP_COPIES.text())?;
        for row in statement.query_map((&group, None::<&str>), GroupCopy::from_row)? {
            let row = row?;
            if is_release(&row.album_release_mbid) {
                copies
                    .entry(row.album_id)
                    .or_default()
                    .insert(row.release_track_mbid);
            }
        }
        if copies.is_empty() {
            return Ok(AlbumCoverage::Fetch);
        }
        let expected = match resolved {
            Some((id, tracks)) if is_release(id) => tracks,
            _ if plan.is_for(release) && !plan.expected_tracks.is_empty() => &plan.expected_tracks,
            _ => return Ok(AlbumCoverage::NeedsTracklist(release.to_owned())),
        };
        if !expected.is_empty()
            && copies.values().any(|copy| {
                expected.iter().all(|track| {
                    track
                        .release_track_mbid
                        .as_deref()
                        .is_some_and(|id| !id.is_empty() && copy.contains(&id.to_ascii_lowercase()))
                })
            })
        {
            Ok(AlbumCoverage::Complete)
        } else {
            Ok(AlbumCoverage::Fetch)
        }
    }
}
