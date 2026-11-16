//! Explicit track-version labels that contradict one another.
//!
//! A missing label is unknown. Only a qualifier written in brackets or at
//! the end of a title can provide version evidence; words inside a title
//! such as "Live Forever" do not.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Version {
    Acoustic,
    Studio,
    Live,
    Remix,
    Original,
    Instrumental,
    Vocal,
}

/// Compare track labels first; album labels fill in only a missing track
/// qualifier on their own side.
pub(crate) fn context_conflict(
    expected_track: &[&str],
    expected_album: &[&str],
    found_track: &[&str],
    found_album: &[&str],
) -> Option<(&'static str, &'static str)> {
    use Version::{Acoustic, Instrumental, Live, Original, Remix, Studio, Vocal};
    let expected_track = collect_versions(expected_track);
    let expected_album = collect_versions(expected_album);
    let found_track = collect_versions(found_track);
    let found_album = collect_versions(found_album);
    let oppositions = [
        (Acoustic, Studio),
        (Studio, Acoustic),
        (Live, Studio),
        (Studio, Live),
        (Remix, Original),
        (Original, Remix),
        (Instrumental, Vocal),
        (Vocal, Instrumental),
    ];
    for (expected, found) in oppositions {
        if has_pair_version(&expected_track, &expected_album, expected, found)
            && has_pair_version(&found_track, &found_album, found, expected)
        {
            return opposing(expected, found);
        }
    }
    None
}

fn collect_versions(texts: &[&str]) -> Vec<Version> {
    texts.iter().flat_map(|text| versions(text)).collect()
}

fn has_pair_version(
    track: &[Version],
    album: &[Version],
    wanted: Version,
    opposite: Version,
) -> bool {
    if track.contains(&wanted) || track.contains(&opposite) {
        return track.contains(&wanted);
    }
    album.contains(&wanted)
}

fn opposing(expected: Version, found: Version) -> Option<(&'static str, &'static str)> {
    use Version::{Acoustic, Instrumental, Live, Original, Remix, Studio, Vocal};
    match (expected, found) {
        (Acoustic, Studio) => Some(("acoustic", "studio")),
        (Studio, Acoustic) => Some(("studio", "acoustic")),
        (Live, Studio) => Some(("live", "studio")),
        (Studio, Live) => Some(("studio", "live")),
        (Remix, Original) => Some(("remix", "original")),
        (Original, Remix) => Some(("original", "remix")),
        (Instrumental, Vocal) => Some(("instrumental", "vocal")),
        (Vocal, Instrumental) => Some(("vocal", "instrumental")),
        _ => None,
    }
}

fn versions(text: &str) -> Vec<Version> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some((start, close)) = next_group(rest) {
        if let Some(end) = rest[start + 1..].find(close) {
            add_phrase(&rest[start + 1..start + 1 + end], &mut found);
            rest = &rest[start + end + 2..];
        } else {
            break;
        }
    }
    add_suffix(rest, &mut found);
    found
}

fn next_group(text: &str) -> Option<(usize, char)> {
    text.char_indices().find_map(|(index, ch)| match ch {
        '(' => Some((index, ')')),
        '[' => Some((index, ']')),
        '{' => Some((index, '}')),
        _ => None,
    })
}

fn add_phrase(text: &str, into: &mut Vec<Version>) {
    let words = words(text);
    if let Some(version) = phrase_version(&words) {
        push_once(into, version);
    }
}

fn add_suffix(text: &str, into: &mut Vec<Version>) {
    let words = words(text);
    let phrases = [
        (&["acoustic", "version"][..], Version::Acoustic),
        (&["studio", "version"][..], Version::Studio),
        (&["live", "version"][..], Version::Live),
        (&["remix", "version"][..], Version::Remix),
        (&["instrumental", "version"][..], Version::Instrumental),
        (&["vocal", "version"][..], Version::Vocal),
        (&["original", "mix"][..], Version::Original),
        (&["original", "version"][..], Version::Original),
    ];
    for (phrase, version) in phrases {
        if words.len() > phrase.len() && words[words.len() - phrase.len()..] == *phrase {
            push_once(into, version);
        }
    }
    let suffixes = [
        ("acoustic", Version::Acoustic),
        ("unplugged", Version::Acoustic),
        ("studio", Version::Studio),
        ("live", Version::Live),
        ("remix", Version::Remix),
        ("remixed", Version::Remix),
        ("instrumental", Version::Instrumental),
        ("vocal", Version::Vocal),
    ];
    for (suffix, version) in suffixes {
        if words.last().is_some_and(|last| last == suffix)
            && has_explicit_separator_before(text, suffix)
        {
            push_once(into, version);
        }
    }
}

fn has_explicit_separator_before(text: &str, suffix: &str) -> bool {
    let text = text.trim_end();
    let Some(prefix) = text.get(..text.len().saturating_sub(suffix.len())) else {
        return false;
    };
    if !text[prefix.len()..].eq_ignore_ascii_case(suffix) {
        return false;
    }
    prefix
        .trim_end()
        .chars()
        .last()
        .is_some_and(|ch| matches!(ch, '-' | '–' | '—' | ':'))
}

fn phrase_version(words: &[String]) -> Option<Version> {
    use Version::{Acoustic, Instrumental, Live, Original, Remix, Studio, Vocal};
    match words {
        [a] if a == "acoustic" || a == "unplugged" => Some(Acoustic),
        [a, version] if a == "acoustic" && version == "version" => Some(Acoustic),
        [a] if a == "studio" => Some(Studio),
        [a, version] if a == "studio" && version == "version" => Some(Studio),
        [a] if a == "live" => Some(Live),
        [a, version] if a == "live" && version == "version" => Some(Live),
        [a] if a == "remix" || a == "remixed" => Some(Remix),
        [a, version] if a == "remix" && version == "version" => Some(Remix),
        [a] if a == "instrumental" => Some(Instrumental),
        [a, version] if a == "instrumental" && version == "version" => Some(Instrumental),
        [a] if a == "vocal" => Some(Vocal),
        [a, version] if a == "vocal" && version == "version" => Some(Vocal),
        [a, mix] if a == "original" && mix == "mix" => Some(Original),
        [a, version] if a == "original" && version == "version" => Some(Original),
        _ => None,
    }
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

fn push_once(into: &mut Vec<Version>, version: Version) {
    if !into.contains(&version) {
        into.push(version);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conflict(expected: &[&str], found: &[&str]) -> Option<(&'static str, &'static str)> {
        context_conflict(expected, &[], found, &[])
    }

    #[test]
    fn only_opposing_explicit_version_qualifiers_conflict() {
        for (expected, found) in [
            ("Song (Acoustic Version)", "Song [Studio Version]"),
            ("Song - Live", "Song (Studio)"),
            ("Song (Remix)", "Song [Original Mix]"),
            ("Song (Instrumental)", "Song [Vocal Version]"),
        ] {
            assert!(
                conflict(&[expected], &[found]).is_some(),
                "{expected} / {found}"
            );
        }
        assert_eq!(
            conflict(
                &["Smoke & Ribbons (Acoustic Version)"],
                &["Smoke & Ribbons [Acoustic] (Remastered 2023)"]
            ),
            None,
            "punctuation, release date and remaster labels do not change the version"
        );
        assert_eq!(
            conflict(&["Live Forever"], &["Live Forever (Studio)"]),
            None
        );
        assert_eq!(conflict(&["Acoustic #3"], &["Acoustic #3 (Studio)"]), None);
        assert_eq!(conflict(&["Song (Acoustic)"], &["Song"]), None);
        assert_eq!(conflict(&["Long Live"], &["Long Live (Studio)"]), None);
        assert_eq!(
            conflict(&["I Work in a Studio"], &["I Work in a Studio (Acoustic)"]),
            None
        );
        assert_eq!(conflict(&["Song Instrumental"], &["Song (Vocal)"]), None);
        assert_eq!(conflict(&["Song Remix"], &["Song (Original Mix)"]), None);
        assert_eq!(
            context_conflict(
                &["Song (Studio Version)"],
                &["Live Album (Live)"],
                &["Song (Studio)"],
                &["Live Album (Acoustic)"],
            ),
            None,
            "matching track qualifiers outrank mixed-edition album labels"
        );
        assert_eq!(
            context_conflict(
                &["Song (Vocal)"],
                &["Acoustic Album (Acoustic)"],
                &["Song [Vocal Version]"],
                &["Studio Album (Studio)"],
            ),
            Some(("acoustic", "studio")),
            "a vocal track label does not hide conflicting album performance labels"
        );
    }
}
