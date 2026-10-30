# Verification record

Last updated: 2026-10-29. Build environment: Linux cloud sandbox, **no Mac and no Apple Music**.

## Summary

| Area | Status |
| --- | --- |
| Matching logic (primary/featured, duplicates, order, edge cases) | **Tested** (52 unit tests) |
| Helper server (validation, confirm, double-submit, origin checks) | **Tested** with a fake adapter |
| Failure handling (permission denied, Music closed, failure halfway) | **Tested** with a fake adapter |
| UI flow, states, mobile layout, hostile metadata escaping | **Tested** in a real browser against a fake library (50 checks) |
| Reading real playlists from Music | **UNVERIFIED** (scripts written, never run) |
| Creating a new playlist in Music | **UNVERIFIED** |
| Copying tracks into it | **UNVERIFIED** |
| Source unchanged on a real library | **UNVERIFIED** |
| New playlist syncing to iPhone | **UNVERIFIED** |
| Required macOS permission steps | **Documented, unconfirmed** |

Overall: **partial**. The workflow is built end to end, but nothing has yet touched a real
Apple Music library. Do not rely on it until the proof of concept below passes.

## What the fake tests do and don't prove

They prove our code handles each situation correctly *if* Music behaves the way the
scripts assume. They say nothing about whether it does. The browser tests use a
test-only server with in-memory fake data (`test/e2e-fake-server.js`); the shipped app
never serves fake data.

## Assumptions in the Mac scripts that must be confirmed on a real Mac

These are the most likely places for the first real run to fail. Each is handled
defensively but not proven:

1. **Reading:** `Music.userPlaylists.persistentID()` and bulk reads like `playlist.tracks.name()` return aligned arrays.
2. **Creating a playlist:** `Music.make({new: 'playlist', ...})` works; the fallback `userPlaylists.push(Music.Playlist(...))` is tried if not. The result reports which method worked (`createMethod`).
3. **Copying:** `Music.duplicate(track, {to: playlist})` adds a track from one playlist to another. Tracks that exist only in the cloud or are not in the library may fail; the per-track result will say why.
4. **Special playlists:** `specialKind` filtering hides system playlists ("Recently Added" and similar). If it misfilters, the playlist list will look wrong.
5. **Permissions:** the error text for a denied Automation permission matches `-1743` / "Not authorized to send Apple events".
6. **Music closed:** `Application('Music').running()` reports false without launching Music.
7. **Sync to iPhone:** a regular playlist created this way syncs when Sync Library is on.

## Proof of concept protocol

Use a real playlist of about 20 tracks with two artists who together have about five songs in it.

1. `npm run selftest -- --source "<playlist>" --artists "<A>,<B>"` and confirm the connection, track count and matches look right.
2. Repeat with `--write --dest "<new name>"`.
3. In Music, check the new playlist has the expected songs and the source is unchanged.
4. Wait a minute and check the new playlist appears on your iPhone.
5. Record the results below.

### Results

_Not yet run._

| Check | Result | Notes |
| --- | --- | --- |
| Connection and permission state | | |
| Playlist read (track count correct) | | |
| Artist matching on real metadata | | |
| New playlist created | | which `createMethod` |
| Songs copied (count) | | |
| Source unchanged (helper check) | | |
| Source unchanged (independent re-read) | | |
| New playlist visible on iPhone | | |
| Failure cases seen (Music closed, permission denied) | | |

## Test inventory

- `test/matching.test.js`: normalization, artist parsing, primary vs featured, duplicates, ordering, immutability (deep-frozen input), manual removal, empty and no-match, special characters, 20,000-track performance.
- `test/helper.test.js`: platform handling, error classification, request validation, no-overwrite, double-submit blocking, lock release after failure, cross-origin refusal, path traversal, report accounting for a failure halfway.
- `test/e2e.py`: full five-screen flow, preview-only (no write), cancel (no write), single write, name collisions, hostile metadata, empty playlist, phone-sized layouts, failure halfway with retry, permission/closed/non-Mac states.

## Not tested

- Real Apple Music of any kind (see above).
- Screen readers. Labels, focus handling and keyboard operation are implemented but only checked in code and with Chromium.
- Safari. Only Chromium was used for the browser tests.
- A real 5,000-track write.
