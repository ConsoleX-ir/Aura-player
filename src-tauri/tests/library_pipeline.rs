// Library pipeline integration tests: real filesystem, real SQLite, real
// (tiny, procedurally generated) WAV files — the same flow Local Music
// drives: import → catalog → reconcile diff (add/remove/mtime change) →
// tombstones → folder untracking.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use aura_lib::db::Db;
use aura_lib::library::reconcile::{self, ImportContext};
use aura_lib::library::scan::{check_paths, resolve_dropped_paths, scan_folder};

/// A minimal, valid 16-bit mono PCM WAV file (44-byte header + N samples).
/// Lofty parses these fine — real durations come out, no fake fixtures.
fn write_wav(path: &Path, seconds: u32) {
    let sample_rate = 8000u32;
    let samples = sample_rate * seconds;
    let data_len = samples * 2;
    let mut bytes: Vec<u8> = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&((36 + data_len).to_le_bytes()));
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
    bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
    bytes.extend_from_slice(&16u16.to_le_bytes()); // bits
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    bytes.extend(std::iter::repeat_n(0u8, data_len as usize));
    std::fs::write(path, bytes).unwrap();
}

fn ctx_for(dir: &Path) -> ImportContext {
    let db = Arc::new(Db::open_in_memory().unwrap());
    ImportContext { db, covers_dir: Arc::new(dir.join("covers")) }
}

#[tokio::test]
async fn import_reconcile_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let folder = tmp.path().join("music");
    std::fs::create_dir_all(&folder).unwrap();
    let ctx = ctx_for(tmp.path());

    // ── import two files explicitly ──
    write_wav(&folder.join("one.wav"), 30);
    write_wav(&folder.join("two.wav"), 200);
    let scanned = scan_folder(&folder);
    assert_eq!(scanned.len(), 2);
    let tracks = reconcile::import_files(&ctx, &scanned, 2, |_, _| {}).await.unwrap();
    assert_eq!(tracks.len(), 2);
    {
        let conn = ctx.db.lock();
        assert_eq!(aura_lib::db::library::list_library_track_ids(&conn).unwrap().len(), 2);
        let all = aura_lib::db::tracks::list_tracks(&conn).unwrap();
        assert!(all.iter().all(|t| t.duration_secs > 0.0), "parsed WAV durations must be real");
        assert!(all.iter().all(|t| !t.missing));
        // Titles fall back to the file stem (WAVs carry no tags).
        assert!(all.iter().any(|t| t.title == "one"));
    }

    // Register the folder and reconcile: no changes expected.
    reconcile::add_music_folder(&ctx, folder.to_string_lossy().into()).await.unwrap();
    let result = reconcile::reconcile_folder(&ctx, &folder.to_string_lossy()).await.unwrap();
    assert_eq!(result.added, 0);
    assert_eq!(result.removed, 0);

    // ── a new file appears on disk ──
    write_wav(&folder.join("three.wav"), 45);
    let result = reconcile::reconcile_folder(&ctx, &folder.to_string_lossy()).await.unwrap();
    assert_eq!(result.added, 1);
    assert_eq!(result.upserted_tracks.len(), 1);

    // ── a file vanishes → removed (Library entry + catalog row) ──
    std::fs::remove_file(folder.join("two.wav")).unwrap();
    let result = reconcile::reconcile_folder(&ctx, &folder.to_string_lossy()).await.unwrap();
    assert_eq!(result.removed, 1);
    assert_eq!(result.removed_track_ids.len(), 1);
}

#[tokio::test]
async fn tombstones_block_reconcile_and_clear_on_reimport() {
    let tmp = tempfile::tempdir().unwrap();
    let folder = tmp.path().join("music");
    std::fs::create_dir_all(&folder).unwrap();
    let ctx = ctx_for(tmp.path());

    write_wav(&folder.join("keep.wav"), 10);
    write_wav(&folder.join("gone.wav"), 10);
    let scanned = scan_folder(&folder);
    reconcile::import_files(&ctx, &scanned, 2, |_, _| {}).await.unwrap();
    reconcile::add_music_folder(&ctx, folder.to_string_lossy().into()).await.unwrap();

    // User removes "gone" from the Library while the file still exists.
    let gone_id = aura_lib::domain::local_track_id(&folder.join("gone.wav").to_string_lossy());
    {
        let conn = ctx.db.lock();
        aura_lib::db::library::remove_from_library(&conn, &[gone_id.clone()]).unwrap();
    }

    // Reconcile must NOT resurrect it (the tombstone's whole purpose).
    let result = reconcile::reconcile_folder(&ctx, &folder.to_string_lossy()).await.unwrap();
    assert_eq!(result.added, 0, "tombstoned path must not re-enter the library");

    // Explicit re-import clears the tombstone and restores membership. Both
    // files are already catalogued, so nothing re-parses — but "gone"
    // rejoins the Library (a conscious re-import is a restore).
    let scanned = scan_folder(&folder);
    reconcile::import_files(&ctx, &scanned, 2, |_, _| {}).await.unwrap();
    {
        let conn = ctx.db.lock();
        assert!(aura_lib::db::library::is_in_library(&conn, &gone_id).unwrap());
        assert!(aura_lib::db::library::list_tombstoned_paths(&conn).unwrap().is_empty());
    }
}

#[tokio::test]
async fn vanished_folder_is_untracked() {
    let tmp = tempfile::tempdir().unwrap();
    let folder = tmp.path().join("usb-drive");
    std::fs::create_dir_all(&folder).unwrap();
    let ctx = ctx_for(tmp.path());

    write_wav(&folder.join("a.wav"), 5);
    let scanned = scan_folder(&folder);
    reconcile::import_files(&ctx, &scanned, 2, |_, _| {}).await.unwrap();
    reconcile::add_music_folder(&ctx, folder.to_string_lossy().into()).await.unwrap();

    // The drive unplugs.
    std::fs::remove_dir_all(&folder).unwrap();
    let result = reconcile::reconcile_folder(&ctx, &folder.to_string_lossy()).await.unwrap();
    assert_eq!(result.removed, 1);
    assert_eq!(result.untracked_folders.len(), 1);

    let conn = ctx.db.lock();
    assert!(aura_lib::db::misc::list_music_folders(&conn).unwrap().is_empty());
}

#[test]
fn scan_and_drop_resolution_handle_mixed_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let folder = tmp.path().join("mix");
    std::fs::create_dir_all(folder.join("nested")).unwrap();
    write_wav(&folder.join("a.wav"), 1);
    write_wav(&folder.join("nested").join("b.wav"), 1);
    std::fs::write(folder.join("notes.txt"), b"not audio").unwrap();

    let scanned = scan_folder(&folder);
    assert_eq!(scanned.len(), 2);

    // Drop: one folder + one loose file + one ignored file.
    let dropped = resolve_dropped_paths(&[
        folder.to_string_lossy().into(),
        folder.join("nested").join("b.wav").to_string_lossy().into(),
        folder.join("notes.txt").to_string_lossy().into(),
    ]);
    assert_eq!(dropped.folders.len(), 1);
    assert!(dropped.files.len() >= 2);
    assert!(dropped.files.iter().all(|f| f.mtime_ms > 0));

    // Health checks never error per-path.
    let checks = check_paths(&[
        folder.join("a.wav").to_string_lossy().into(),
        "/definitely/not/there.wav".into(),
    ]);
    assert!(checks[0].exists);
    assert!(!checks[1].exists);
}

#[tokio::test]
async fn health_check_reports_missing_files() {
    let tmp = tempfile::tempdir().unwrap();
    let folder = tmp.path().join("music");
    std::fs::create_dir_all(&folder).unwrap();
    let ctx = ctx_for(tmp.path());

    write_wav(&folder.join("x.wav"), 3);
    let scanned = scan_folder(&folder);
    reconcile::import_files(&ctx, &scanned, 2, |_, _| {}).await.unwrap();

    let ids: Vec<String> = scanned
        .iter()
        .map(|f| aura_lib::domain::local_track_id(&f.path))
        .collect();
    std::fs::remove_file(folder.join("x.wav")).unwrap();
    let checks = check_paths(&scanned.iter().map(|f| f.path.clone()).collect::<Vec<_>>());
    assert!(!checks[0].exists);
    // The catalog row still exists (reconcile decides when to drop it).
    let conn = ctx.db.lock();
    assert!(aura_lib::db::tracks::get_track(&conn, &ids[0]).unwrap().is_some());
}
