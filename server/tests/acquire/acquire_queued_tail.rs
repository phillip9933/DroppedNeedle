//! A Soulseek peer sent part of an album and queued the rest.

use std::sync::Arc;

use droppedneedle_acquire::db::AcquireDb;
use droppedneedle_acquire::downloads::sources::SourceHandle;
use droppedneedle_acquire::downloads::state::{AttemptState, TaskStatus};
use droppedneedle_acquire::downloads::store::NewTask;
use droppedneedle_acquire::downloads::{ExpectedTrack, SourceTag, TaskPlan};
use droppedneedle_acquire::landing::library::LibraryLanding;
use droppedneedle_kernel::test_support::ManualClock;
use droppedneedle_library::scan::EffectivePolicy;
use droppedneedle_testkit::slskd::MockSlskd;
use serde_json::json;

use crate::acquire_landing::{Releases, files_under, land_file, length_ms, release};
use crate::common::TestPlatform;
use crate::common::acquire::{no_targets, review_off, save_policy, save_slskd, worker_with};
use crate::common::bundles::{acquire_on, idle_host};
use crate::common::library::{every_priority, library_at};

#[tokio::test]
async fn a_timed_out_soulseek_tail_lands_only_finished_files_then_refills() {
    queued_tail_refills(false).await;
}

#[tokio::test]
async fn a_client_timed_out_tail_lands_only_finished_files_then_refills() {
    queued_tail_refills(true).await;
}

async fn queued_tail_refills(client_timeout: bool) {
    const TASK: &str = "t-queued-tail";
    const ATTEMPT: &str = "t-queued-tail-a0";
    const GROUP: &str = "6d0b7a1e-0000-4000-8000-000000000001";
    const RELEASE: &str = "6d0b7a1e-0000-4000-8000-000000000002";
    const COMPLETE: &str = "@@music\\Portishead\\Dummy\\01 - Mysterons.flac";
    const COVER: &str = r"@@music\Portishead\Dummy\cover.jpg";
    const WAITING: &str = "@@music\\Portishead\\Dummy\\02 - Sour Times.flac";

    let db = AcquireDb::scratch().expect("scratch database");
    db.add_user("u-ada", "Ada", "user").await.expect("user");
    let dir = db.path().parent().expect("scratch folder");
    let clock = Arc::new(ManualClock::at(1_800_000_000_000));
    let platform = TestPlatform::on(db.db(), dir)
        .clock(clock.clone())
        .build()
        .await;
    let (library, _) = library_at(&platform);
    let music = dir.join("music");
    std::fs::create_dir_all(&music).expect("music folder");
    library
        .scans
        .add_root(
            Some("music".to_owned()),
            music.to_string_lossy().into_owned(),
            EffectivePolicy::Automatic,
        )
        .expect("root");

    let downloads = dir.join("slskd");
    let album = downloads.join("Dummy");
    let first = land_file(
        &album,
        "01 - Mysterons.flac",
        "flac_full_01.flac",
        "Mysterons",
        1,
    );
    // A same-sized file left by an earlier download is visible on the
    // mount. The waiting transfer never proved this is the file it sent.
    let stale = land_file(
        &album,
        "02 - Sour Times.flac",
        "flac_full_02.flac",
        "Sour Times",
        2,
    );
    let lengths = [length_ms(&first), length_ms(&stale)];
    let sizes = [&first, &stale].map(|file| file.metadata().expect("file").len() as i64);
    let edition = release(RELEASE, GROUP, &["Mysterons", "Sour Times"], &lengths);
    let plan = TaskPlan {
        release_mbid: Some(RELEASE.to_owned()),
        expected_tracks: edition
            .tracks
            .iter()
            .map(|track| ExpectedTrack {
                disc_number: i64::from(track.disc),
                track_number: i64::from(track.position),
                title: Some(track.title.clone()),
                duration_seconds: track.length_ms.map(|ms| ms as f64 / 1000.0),
                recording_mbid: Some(track.recording_id.clone()),
                release_track_mbid: Some(track.id.clone()),
            })
            .collect(),
        ..Default::default()
    };

    let slskd = MockSlskd::start().await.expect("slskd mock");
    slskd.inject_transfer(
        "slow",
        COMPLETE,
        sizes[0],
        "Completed, Succeeded",
        None,
        None,
    );
    slskd.inject_transfer("slow", COVER, 25, "Completed, Succeeded", None, None);
    slskd.inject_transfer_progress("slow", WAITING, sizes[1], 0, "Queued, Remotely", None, None);
    let peer_files = [COMPLETE, WAITING]
        .into_iter()
        .zip(sizes)
        .zip(lengths)
        .map(|((filename, size), ms)| {
            json!({"filename":filename, "size":size, "extension":"flac",
                   "bitDepth":16, "sampleRate":44100, "length":ms.map(|ms| ms as f64 / 1000.0)})
        })
        .collect::<Vec<_>>();
    slskd.script_responses(vec![json!({
        "username": "next", "hasFreeUploadSlot": true, "uploadSpeed": 1_000_000,
        "queueLength": 0, "fileCount": 2, "lockedFileCount": 0, "lockedFiles": [], "token": 1,
        "files": peer_files
    })]);

    save_slskd(&platform.settings, &slskd.base_url());
    review_off(&platform);
    save_policy(&platform.settings, |policy| {
        policy.download_queued_timeout_minutes = 5
    });
    let landing = Arc::new(LibraryLanding::new(
        &library,
        every_priority(Arc::new(Releases(vec![edition]))),
    ));
    let acquire = acquire_on(&platform, &library, landing);
    let worker = worker_with(
        &platform,
        idle_host(&platform, library.core.clone()),
        acquire.journal.clone(),
        &platform.settings,
        downloads,
        no_targets(&acquire.journal),
        acquire.landing.clone(),
        Default::default(),
        droppedneedle_kernel::events::EventHub::new(),
    );
    let handle = serde_json::to_string(&SourceHandle {
        username: "slow".to_owned(),
        filenames: vec![COMPLETE.to_owned(), WAITING.to_owned(), COVER.to_owned()],
        sizes: vec![sizes[0], sizes[1], 25],
        ..SourceHandle::new(SourceTag::Soulseek)
    })
    .expect("handle encodes");
    acquire
        .journal
        .run("test.seed", move |store| {
            let now = 1_800_000_000.0;
            store.insert_task(
                &NewTask {
                    id: TASK.to_owned(),
                    user_id: "u-ada".to_owned(),
                    artist_name: "Portishead".to_owned(),
                    album_title: "Dummy".to_owned(),
                    release_group_mbid: GROUP.to_owned(),
                    origin: "user".to_owned(),
                    retry_count: 0,
                },
                now,
            )?;
            store.set_task_plan(TASK, &plan, now)?;
            store.insert_attempt(
                ATTEMPT,
                TASK,
                "soulseek",
                0,
                "",
                &handle,
                AttemptState::InUse,
                now,
            )?;
            store.transition_task(TASK, TaskStatus::Downloading, now, None)
        })
        .await
        .expect("seed task");

    worker.run_once(1).await;
    let progress = acquire
        .journal
        .read("test.queue", |store| store.queue_task(TASK))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(progress.extras.files_total, 2, "cover is not a track");
    assert_eq!(
        progress.extras.files_completed, 1,
        "only one audio file finished"
    );
    assert_eq!(
        progress.task.downloaded_bytes,
        sizes[0] + 25,
        "cover still transfers"
    );

    clock.advance(299_000);
    worker.run_once(2).await;
    assert_eq!(
        acquire
            .journal
            .read_task(TASK)
            .await
            .unwrap()
            .unwrap()
            .status,
        TaskStatus::Downloading
    );
    assert!(
        files_under(&music, "flac").is_empty(),
        "allow the peer its full wait"
    );

    if client_timeout {
        // slskd itself can mark the final transfer timed out before the
        // application's remote queue timeout fires.
        slskd.inject_transfer_progress(
            "slow",
            WAITING,
            sizes[1],
            0,
            "Completed, TimedOut",
            None,
            None,
        );
    } else {
        clock.advance(2_000);
    }
    worker.run_once(3).await;
    worker.wait_for_landings().await;
    assert_eq!(
        files_under(&music, "flac").len(),
        1,
        "only confirmed finished audio lands"
    );
    assert!(
        stale.is_file(),
        "the old file under the waiting filename was not consumed"
    );
    assert_eq!(
        acquire
            .journal
            .read("test.missing", |store| store.missing_positions(TASK))
            .await
            .unwrap(),
        vec![(1, 2)]
    );
    let attempts = acquire.journal.read_attempts(TASK).await.unwrap();
    assert_eq!(
        attempts[0].state,
        AttemptState::Complete,
        "the whole original batch was cleaned up"
    );
    assert!(
        acquire
            .journal
            .read("test.quarantine", |store| store.list_quarantine())
            .await
            .unwrap()
            .is_empty()
    );

    worker.run_once(4).await;
    worker.wait_for_landings().await;
    let attempts = acquire.journal.read_attempts(TASK).await.unwrap();
    assert_eq!(attempts.len(), 2, "the missing position was fetched");
    let next: SourceHandle = serde_json::from_str(
        &acquire
            .journal
            .read_attempt_handle(&attempts[1].id)
            .await
            .unwrap()
            .unwrap(),
    )
    .expect("next handle");
    assert_eq!(next.username, "next");
    assert_eq!(
        next.filenames,
        vec![WAITING],
        "the first position was not requested again"
    );
    assert_eq!(files_under(&music, "flac").len(), 2);
    assert_eq!(
        acquire
            .journal
            .read_task(TASK)
            .await
            .unwrap()
            .unwrap()
            .status,
        TaskStatus::Completed
    );
}
