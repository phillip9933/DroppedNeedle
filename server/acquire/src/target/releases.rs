//! Order Usenet releases against the target. An NZB is opaque until it
//! downloads, so the evidence is the release title and the file count the
//! indexer reports: releases that name the album (and its artist) come
//! first, then those whose file count matches the tracklist. Ties keep the
//! indexer's order, so the list is the same on every failover.

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

    fn starts_field_at(&self, start: usize, name: &str) -> bool {
        let end = start + name.len();
        !name.is_empty()
            && self.folded[start..].starts_with(name)
            && self.boundaries.binary_search(&end).is_ok()
    }

    fn ends_album_at(&self, end: usize) -> bool {
        let Some(&next) = self.boundaries.iter().find(|&&at| at > end) else {
            return true;
        };
        let suffix = &self.folded[end..next];
        // The album can be followed by release metadata. An ordinary word
        // here is still part of the title ("McCartney and Wings").
        let year = suffix.len() == 4
            && suffix
                .parse::<u16>()
                .is_ok_and(|year| (1900..2100).contains(&year));
        let disc_count = suffix.strip_suffix("cd").is_some_and(|count| {
            !count.is_empty() && count.bytes().all(|byte| byte.is_ascii_digit())
        });
        year || disc_count
            || matches!(
                suffix,
                "flac"
                    | "mp3"
                    | "aac"
                    | "alac"
                    | "wav"
                    | "ogg"
                    | "opus"
                    | "web"
                    | "cd"
                    | "vinyl"
                    | "sacd"
                    | "lossless"
                    | "remaster"
                    | "remastered"
                    | "deluxe"
                    | "expanded"
                    | "anniversary"
                    | "edition"
                    | "reissue"
            )
    }
}

fn fit_names(title: &str, artist: &str, album: &str) -> u8 {
    let title = Title::new(title);
    let album = fold(album);
    let artist = Title::new(crate::slskd::query::primary_artist(artist));
    let after_artist = artist.folded.len();
    let album_at =
        |start| title.starts_field_at(start, &album) && title.ends_album_at(start + album.len());
    if title.starts_field_at(0, &artist.folded) {
        // Once the artist is recognized, only the following title field
        // can name the album, even for a self-titled release.
        if album_at(after_artist) { 0 } else { 2 }
    } else if album_at(0) && !artist.starts_field_at(0, &album) {
        1
    } else {
        2
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_album_title_is_a_field_not_a_substring_of_another_title() {
        for (title, expected) in [
            (
                "Paul.McCartney-Pure.McCartney-Deluxe.Edition-4CD-FLAC-2016-FORSAKEN",
                2,
            ),
            (
                "Various.Artists.-.Paul.McCartney.in.Jazz.A.Jazz.Tribute.to.Paul.McCartney.2023.FLAC",
                2,
            ),
            (
                "Paul.McCartney.-.Paul.McCartney.And.Wings.2023.Rock.[FLAC.16-44]-xpost",
                2,
            ),
            ("Paul McCartney - Ram", 2),
            ("Paul.McCartney-McCartney-1970-FLAC", 0),
            ("Paul_McCartney_McCartney_Deluxe_Edition_2CD_FLAC", 0),
            ("Paul McCartney - McCartney (2011 Remaster)", 0),
        ] {
            assert_eq!(
                fit_names(title, "Paul McCartney", "McCartney"),
                expected,
                "{title}"
            );
        }
        assert_eq!(fit_names("Dummy.1994.FLAC", "Portishead", "Dummy"), 1);
        assert_eq!(
            fit_names("Portishead - Dummy Live at Roseland", "Portishead", "Dummy"),
            2
        );
    }
}
