//! Strong evidence for resolving stale download holds after another copy
//! lands. The album group only limits the search. Names, durations and
//! MusicBrainz IDs are never used as proof that two files are duplicates.

use std::collections::HashSet;
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use droppedneedle_kernel::db::backup::read_sha256;

use super::{below, store::HeldFile};
use crate::landing::{confine, ports::IndexedAudio};

#[derive(Debug, PartialEq, Eq, Hash)]
enum Proof {
    WholeFile(String, u64),
    // STREAMINFO determines how the frames decode. Keep it all in the
    // comparison, and exclude only the blocks the tagger can rewrite.
    Flac([u8; 34], String, u64),
}

fn flac_proof(mut file: impl Read + Seek) -> io::Result<Proof> {
    let mut magic = [0; 4];
    file.read_exact(&mut magic)?;
    let mut header = [0; 4];
    file.read_exact(&mut header)?;
    if &magic != b"fLaC" || header[0] & 0x7f != 0 || header[1..] != [0, 0, 34] {
        return Err(io::Error::other("invalid FLAC stream header"));
    }
    let mut info = [0; 34];
    file.read_exact(&mut info)?;
    while header[0] & 0x80 == 0 {
        file.read_exact(&mut header)?;
        let len = u32::from_be_bytes([0, header[1], header[2], header[3]]);
        file.seek(SeekFrom::Current(i64::from(len)))?;
    }
    let (sha, size) = read_sha256(file)?;
    if size == 0 {
        return Err(io::Error::other("empty FLAC audio"));
    }
    Ok(Proof::Flac(info, sha, size))
}

fn proof(root: &Path, path: &Path) -> io::Result<Proof> {
    let real = root.canonicalize()?;
    let rel = path.strip_prefix(root).map_err(io::Error::other)?;
    let path = real.join(rel);
    let mut file = confine::open_beneath(std::slice::from_ref(&real), &path)?;
    let stat = |file: &File| {
        let m = file.metadata()?;
        Ok::<_, io::Error>((
            m.len(),
            m.ctime(),
            m.ctime_nsec(),
            m.mtime(),
            m.mtime_nsec(),
        ))
    };
    let before = stat(&file)?;
    let is_flac = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("flac"));
    let proof = if is_flac {
        flac_proof(BufReader::new(&mut file))?
    } else {
        let (sha, size) = read_sha256(&mut file)?;
        if size == 0 {
            return Err(io::Error::other("empty audio file"));
        }
        Proof::WholeFile(sha, size)
    };
    if before != stat(&file)? {
        return Err(io::Error::other("audio file changed during comparison"));
    }
    Ok(proof)
}

/// IDs with the same audio as an indexed file of this album. Unreadable,
/// unmounted, synthetic or changed files prove nothing.
pub(super) fn confirmed(root: &Path, files: &[HeldFile], library: &[IndexedAudio]) -> Vec<i64> {
    let owned: HashSet<_> = library
        .iter()
        .filter_map(|file| {
            Some((
                file.disc.max(1),
                file.track,
                proof(&file.root, &file.path).ok()?,
            ))
        })
        .collect();
    if owned.is_empty() {
        return Vec::new();
    }
    files
        .iter()
        .filter_map(|file| {
            let path = below(root, &file.path)?;
            let disc = file.pairing.disc_number.unwrap_or(1).max(1);
            let track = file.pairing.track_number.filter(|track| *track > 0)?;
            let duplicate = owned.contains(&(disc, track, proof(root, &path).ok()?));
            duplicate.then_some(file.id)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn flac_duplicates_ignore_tags_but_require_the_same_frames_and_streaminfo() {
        // A FLAC stream fixture, with an added valid padding metadata block
        // to simulate a different tagging layout without rewriting audio.
        let bytes = include_bytes!("../../../tests/fixtures/library/flac_no_tags.flac");
        let original = flac_proof(Cursor::new(bytes.as_slice())).unwrap();
        let mut edited = bytes.to_vec();
        edited.splice(42..42, [1, 0, 0, 2, 0, 0]);
        if edited[4] & 0x80 != 0 {
            edited[4] &= 0x7f;
            edited[42] |= 0x80;
        }
        assert_eq!(original, flac_proof(Cursor::new(&edited)).unwrap());
        *edited.last_mut().unwrap() ^= 1;
        assert_ne!(original, flac_proof(Cursor::new(&edited)).unwrap());
        assert!(flac_proof(Cursor::new(b"not a FLAC")).is_err());
    }
}
