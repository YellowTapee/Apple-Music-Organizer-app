// JXA: create a NEW playlist and copy chosen tracks into it.
// Run with:
//   osascript -l JavaScript helper/jxa/copy-tracks.js <sourcePlaylistID> <newPlaylistName> <tracksJSON>
// where tracksJSON is [{"position":3,"id":"ABC..."}, ...] in the order to copy.
//
// Safety design:
//  - The source playlist is only ever READ. The only write operations are
//    "make new playlist" and "duplicate <track> to <new playlist>".
//  - Each track is verified by persistent ID at its position before copying;
//    if the playlist changed underneath us, that track fails instead of a
//    wrong track being copied.
//  - The source's track IDs are snapshotted before and after; the result says
//    whether they are identical.
//  - Per-track results are returned so a failure halfway is fully reported.
//
// UNVERIFIED: written without access to a Mac. See docs/VERIFICATION.md.

function run(argv) {
  const sourceId = argv[0];
  const destName = argv[1];
  const wanted = JSON.parse(argv[2] || '[]');
  if (!sourceId || !destName || !wanted.length) throw new Error('missing arguments');

  const Music = Application('Music');

  // ---- locate source (read-only) ----
  const srcIds = Music.userPlaylists.persistentID();
  const srcIdx = srcIds.indexOf(sourceId);
  if (srcIdx < 0) throw new Error('source playlist not found: ' + sourceId);
  const src = Music.userPlaylists[srcIdx];
  const before = src.tracks.length ? src.tracks.persistentID() : [];

  // ---- refuse to touch an existing playlist with the same name ----
  const existing = Music.userPlaylists.name();
  if (existing.indexOf(destName) >= 0) {
    throw new Error('a playlist named "' + destName + '" already exists; refusing to overwrite');
  }

  // ---- create the destination ----
  let dest = null;
  let createMethod = null;
  const knownIds = Music.userPlaylists.persistentID();
  try {
    Music.make({ new: 'playlist', withProperties: { name: destName } });
    createMethod = 'make new playlist';
  } catch (e1) {
    try {
      Music.userPlaylists.push(Music.Playlist({ name: destName }));
      createMethod = 'userPlaylists.push';
    } catch (e2) {
      throw new Error('could not create playlist (make: ' + e1 + '; push: ' + e2 + ')');
    }
  }
  // Find the new playlist by "an ID that was not there before" and the right name.
  const afterIds = Music.userPlaylists.persistentID();
  const afterNames = Music.userPlaylists.name();
  for (let i = 0; i < afterIds.length; i++) {
    if (knownIds.indexOf(afterIds[i]) < 0 && afterNames[i] === destName) {
      dest = Music.userPlaylists[i];
      break;
    }
  }
  if (!dest) throw new Error('playlist creation did not produce a findable playlist');
  const destId = dest.persistentID();

  // ---- copy track by track ----
  const results = [];
  let aborted = null;
  for (let k = 0; k < wanted.length; k++) {
    const w = wanted[k];
    if (aborted) {
      results.push({ position: w.position, id: w.id, status: 'failed', reason: 'not attempted: ' + aborted });
      continue;
    }
    try {
      const track = src.tracks[w.position];
      const actualId = track.persistentID();
      if (actualId !== w.id) {
        results.push({
          position: w.position, id: w.id, status: 'failed',
          reason: 'playlist changed since it was read (track at this position is different)',
        });
        continue;
      }
      Music.duplicate(track, { to: dest });
      results.push({ position: w.position, id: w.id, status: 'copied' });
    } catch (e) {
      const msg = String(e);
      results.push({ position: w.position, id: w.id, status: 'failed', reason: msg });
      // If Music went away or permission vanished, stop and report the rest as not attempted.
      if (/-600|-609|-1743|Connection is invalid|not running|Not authorized/i.test(msg)) {
        aborted = msg;
      }
    }
  }

  // ---- verify ----
  let afterSource = [];
  let destTrackCount = null;
  try { afterSource = src.tracks.length ? src.tracks.persistentID() : []; } catch (e) {}
  try { destTrackCount = dest.tracks.length; } catch (e) {}
  const sourceUnchanged =
    before.length === afterSource.length && before.every(function (v, i) { return v === afterSource[i]; });

  return JSON.stringify({
    destination: { id: destId, name: destName, trackCount: destTrackCount },
    createMethod: createMethod,
    results: results,
    sourceUnchanged: sourceUnchanged,
    aborted: aborted,
  });
}
