//! Order Usenet releases against the target. An NZB is opaque until it
//! downloads, so the evidence is the release title and the file count the
//! indexer reports: releases that name the album (and its artist) come
//! first, then those whose file count matches the tracklist. Ties keep the
//! indexer's order, so the list is the same on every failover.

use std::ops::Range;

use super::SearchTarget;
use crate::usenet::newznab::IndexerResult;
use droppedneedle_library::matching::strings::fold;
use unicode_normalization::char::is_combining_mark;

/// How well one release's title and file count fit the target. Lower
/// is better on both counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ReleaseFit {
    /// 0: names the album and artist; 1: the album only; 2: album unclear.
    pub names: u8,
    /// 0: the file count fits the tracklist; 1: unknown; 2: it does not.
    pub files: u8,
}

impl ReleaseFit {
    /// Whether the title gives enough album evidence for an automatic pick.
    pub fn names_album(self) -> bool {
        self.names < 2
    }
}

/// Fold punctuation and accents for scene-style titles, and keep token
/// boundaries so short album names do not match inside other words.
struct Title {
    folded: String,
    boundaries: Vec<usize>,
}

impl Title {
    fn new(title: &str) -> Self {
        let mut folded = String::new();
        let mut boundaries = vec![0];
        for word in title.split(|ch: char| !ch.is_alphanumeric() && !is_combining_mark(ch)) {
            let word = fold(word);
            if !word.is_empty() {
                folded.push_str(&word);
                boundaries.push(folded.len());
            }
        }
        Self { folded, boundaries }
    }

    fn spans<'a>(&'a self, name: &'a str) -> impl Iterator<Item = Range<usize>> + 'a {
        self.boundaries.iter().copied().filter_map(move |start| {
            let end = start + name.len();
            (!name.is_empty()
                && self.folded[start..].starts_with(name)
                && self.boundaries.binary_search(&end).is_ok())
            .then_some(start..end)
        })
    }
}

fn fit_names(title: &str, artist: &str, album: &str) -> u8 {
    let title = Title::new(title);
    let album = fold(album);
    let artist = Title::new(crate::slskd::query::primary_artist(artist));
    let mut albums = title.spans(&album).peekable();
    if albums.peek().is_none() {
        return 2;
    }
    let artists: Vec<_> = title.spans(&artist.folded).collect();
    if albums.any(|album| {
        artists
            .iter()
            .any(|artist| album.end <= artist.start || artist.end <= album.start)
    }) {
        0
    } else if artist.spans(&album).next().is_some() {
        // In "Paul McCartney - Ram", the artist alone is not evidence
        // for the album "McCartney".
        2
    } else {
        1
    }
}

/// Judge one release against the target.
pub fn release_fit(hit: &IndexerResult, target: &SearchTarget) -> ReleaseFit {
    let tracks = target.tracklist.len();
    let names = fit_names(&hit.usenet.title, &target.artist, &target.album_title);
    let files = match (hit.usenet.files, tracks) {
        (Some(files), tracks) if tracks > 0 => {
            let files = usize::try_from(files.max(0)).unwrap_or(0);
            // Releases often carry an .nfo, .sfv or cover besides the audio.
            if files >= tracks && files <= tracks + 4 {
                0
            } else {
                2
            }
        }
        _ => 1,
    };
    ReleaseFit { names, files }
}

/// Best album fit first; stable.
pub fn order_releases(mut hits: Vec<IndexerResult>, target: &SearchTarget) -> Vec<IndexerResult> {
    hits.sort_by_cached_key(|hit| release_fit(hit, target));
    hits
}
