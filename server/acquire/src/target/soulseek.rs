//! Search Soulseek for a target and pick the folder to fetch from.
//!
//! Albums and single tracks both search with the album query ladder and
//! rank folders with [`rank_listing`]. A single track only falls back to
//! the track query ladder when no album folder holds it, and a lone-track
//! share is taken only when nothing better exists; the caller records the
//! reason.

use std::collections::HashSet;

use tokio::time::{Instant, timeout_at};

use super::SearchTarget;
use super::reasons::TrackReason;
use crate::client_error::{ClientError, Service};
use crate::reason::Reason;
use crate::slskd::folders::{FolderPick, RankRequest, rank_folders, rank_listing};
use crate::slskd::{SearchResult, SlskdHttp, SlskdRepository, album_query_ladder};

/// An eligible folder and the reason a lone-track share would be used.
#[derive(Debug, Clone)]
pub struct SoulseekChoice {
    /// The folder and the files to enqueue from it.
    pub pick: FolderPick,
    /// Set when the pick is a lone-track share.
    pub lone_reason: Option<TrackReason>,
}

/// Why nothing was picked.
#[derive(Debug)]
pub enum SoulseekMiss {
    /// slskd failed.
    Search(ClientError),
    /// Nothing usable was found: why, and the text the log keeps.
    Nothing { reason: Reason, detail: String },
}

const NO_FOLDER: &str = "slskd has no untried folder for this album";

/// Search from specific to broad, keeping earlier folders for review and
/// partial downloads. Check for a usable folder after filtering each answer.
pub(crate) async fn search_album<H: SlskdHttp>(
    repo: &SlskdRepository<H>,
    target: &SearchTarget,
    request: RankRequest<'_>,
    deadline: Instant,
    keep: impl Fn(&SearchResult) -> bool,
) -> Result<(Vec<SearchResult>, Vec<FolderPick>), ClientError> {
    let mut hits = Vec::new();
    let mut seen = HashSet::new();
    let mut listing = Vec::new();
    for query in album_query_ladder(&target.artist, &target.album_title, target.year) {
        let answer = timeout_at(deadline, repo.run_search(&query))
            .await
            .unwrap_or_else(|_| {
                Err(ClientError::transport(
                    Service::Slskd,
                    "album search timed out".to_owned(),
                ))
            });
        let files = match answer {
            Ok(files) => files,
            Err(error) if !listing.is_empty() => {
                tracing::warn!(%error, "slskd album search stopped with earlier results");
                break;
            }
            Err(error) => return Err(error),
        };
        let previous = hits.len();
        hits.extend(
            files.into_iter().filter(|hit| {
                keep(hit) && seen.insert((hit.username.clone(), hit.filename.clone()))
            }),
        );
        if hits.len() == previous {
            continue;
        }
        listing = rank_listing(&hits, request, repo.policy());
        let automatic = rank_folders(&hits, request, repo.policy());
        if automatic.first().is_some_and(|pick| {
            !pick.unknown_quality
                && if request.single_track {
                    !pick.lone_track
                } else if request.wanted.is_empty() {
                    pick.total == 0 || (pick.coverage == pick.total && pick.duration_misses == 0)
                } else {
                    pick.held == request.wanted.len()
                }
        }) {
            break;
        }
    }
    Ok((hits, listing))
}

/// All the ranked folders are refused, or there was no usable folder at all.
fn miss(has_listing: bool, has_title_conflict: bool, reason: Reason, detail: &str) -> SoulseekMiss {
    if !has_listing {
        return SoulseekMiss::Nothing {
            reason,
            detail: detail.to_owned(),
        };
    }
    if has_title_conflict {
        return SoulseekMiss::Nothing {
            reason,
            detail: "slskd has folders, but their file titles or version labels conflict with this edition"
                .to_owned(),
        };
    }
    SoulseekMiss::Nothing {
        reason: Reason::NothingAllowed,
        detail: "slskd has folders for this, but none in your quality settings".to_owned(),
    }
}

/// Search and rank. `keep` drops hits that may not be tried again
/// (quarantined files, peers this task already tried).
pub async fn choices<H: SlskdHttp>(
    repo: &SlskdRepository<H>,
    target: &SearchTarget,
    deadline: Instant,
    keep: impl Fn(&SearchResult) -> bool,
) -> Result<Vec<SoulseekChoice>, SoulseekMiss> {
    let request = RankRequest {
        album_title: &target.album_title,
        tracklist: &target.tracklist,
        wanted: &target.wanted,
        single_track: target.track.is_some(),
    };
    let policy = repo.policy();
    let (mut hits, listing) = if target.has_album() {
        search_album(repo, target, request, deadline, &keep)
            .await
            .map_err(SoulseekMiss::Search)?
    } else {
        (Vec::new(), Vec::new())
    };
    let has_listing = !listing.is_empty();
    let has_title_conflict = listing.iter().any(|pick| pick.title_conflicts > 0);
    let album_choices: Vec<_> = rank_folders(&hits, request, policy)
        .into_iter()
        .filter(|pick| target.track.is_none() || !pick.lone_track)
        .map(|pick| SoulseekChoice {
            pick,
            lone_reason: None,
        })
        .collect();
    if !album_choices.is_empty() {
        return Ok(album_choices);
    }
    let Some(track) = target.track.as_ref() else {
        return Err(miss(
            has_listing,
            has_title_conflict,
            Reason::NoSource,
            NO_FOLDER,
        ));
    };
    // No album folder holds the track: search for the track itself. Its
    // results can still turn up an album folder, which wins as usual.
    let album = target.has_album().then_some(target.album_title.as_str());
    let more = timeout_at(
        deadline,
        repo.search_track(&track.artist, &track.title, album),
    )
    .await
    .unwrap_or_else(|_| {
        Err(ClientError::transport(
            Service::Slskd,
            "track search timed out",
        ))
    })
    .map_err(SoulseekMiss::Search)?;
    for hit in more {
        let seen = hits
            .iter()
            .any(|known| known.username == hit.username && known.filename == hit.filename);
        if !seen && keep(&hit) {
            hits.push(hit);
        }
    }
    let picks = rank_folders(&hits, request, policy);
    if picks.is_empty() {
        let review = rank_listing(&hits, request, policy);
        return Err(miss(
            !review.is_empty(),
            review.iter().any(|pick| pick.title_conflicts > 0),
            TrackReason::TrackNotFound.into(),
            &TrackReason::TrackNotFound.to_string(),
        ));
    }
    Ok(picks
        .into_iter()
        .map(|pick| {
            let lone_reason = (pick.lone_track || !target.has_album())
                .then(|| track.no_album.unwrap_or(TrackReason::NoAlbumFolder));
            SoulseekChoice { pick, lone_reason }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_conflict_misses_name_the_actual_reason() {
        let SoulseekMiss::Nothing { detail, .. } =
            miss(true, true, Reason::TrackNotFound, "no track folder")
        else {
            unreachable!("miss stays a no-source answer");
        };
        assert!(detail.contains("titles or version labels conflict"));
        assert!(!detail.contains("quality settings"));

        let SoulseekMiss::Nothing { detail, reason } =
            miss(true, false, Reason::NoSource, "no album folder")
        else {
            unreachable!("miss stays a no-source answer");
        };
        assert_eq!(reason, Reason::NothingAllowed);
        assert!(detail.contains("quality settings"));
    }
}
