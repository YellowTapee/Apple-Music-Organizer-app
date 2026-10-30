// Proof-of-concept runner. Run this ON YOUR MAC against a real playlist.
//
//   Read-only (safe, writes nothing):
//     npm run selftest -- --source "My 20 Track Playlist" --artists "Artist A,Artist B"
//
//   Real write test (creates ONE new playlist, never touches the source):
//     npm run selftest -- --source "My 20 Track Playlist" --artists "Artist A,Artist B" \
//       --write --dest "Selftest Copy 1"
//
// It prints a plain-text report. Paste that report back into the chat so what
// worked and what is blocked can be recorded in docs/VERIFICATION.md.
// Output goes to the terminal only; nothing is saved to disk.

import { createMusicAdapter, MusicError } from './music-adapter.js';
import { matchTracks } from '../src/matching.js';
import { buildReport } from '../src/report.js';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes('--' + name);

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

async function main() {
  const sourceName = arg('source');
  const artists = (arg('artists') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const write = flag('write');
  const destName = arg('dest');
  const includeFeatured = flag('featured');

  if (!sourceName || artists.length === 0 || (write && !destName)) {
    console.log('Usage: npm run selftest -- --source "<playlist>" --artists "A,B" [--featured] [--write --dest "<new name>"]');
    process.exit(2);
  }

  const music = createMusicAdapter();
  say('# Selftest report');
  say(`Platform: ${process.platform}   Node: ${process.version}   Mode: ${write ? 'WRITE' : 'read-only'}`);

  say('\n## 1. Connection');
  const status = await music.status();
  say(`state=${status.state}  message=${status.message}`);
  if (status.state !== 'ready') { say('\nBLOCKED: fix the connection above, then re-run.'); return 1; }

  say('\n## 2. Read playlists');
  const playlists = await music.listPlaylists();
  say(`found ${playlists.length} playlists`);
  const matching = playlists.filter((p) => p.name === sourceName);
  if (matching.length !== 1) {
    say(`BLOCKED: expected exactly one playlist named "${sourceName}", found ${matching.length}.`);
    return 1;
  }
  const src = matching[0];

  say('\n## 3. Read source tracks');
  const data = await music.readPlaylist(src.id);
  say(`source "${data.name}" has ${data.tracks.length} tracks`);
  const withIds = data.tracks.filter((t) => t.id).length;
  say(`tracks with persistent IDs: ${withIds}/${data.tracks.length}`);

  say('\n## 4. Match');
  const { matches, skippedDuplicates } = matchTracks(data.tracks, artists, { includeFeatured });
  say(`artists: ${artists.join(' | ')}   includeFeatured=${includeFeatured}`);
  say(`matching tracks: ${matches.length}   duplicates skipped: ${skippedDuplicates.length}`);
  for (const m of matches) {
    const flags = [m.uncertain ? 'UNCERTAIN' : '', ...m.reasons].filter(Boolean).join(',');
    say(`  #${m.position + 1}  ${m.track.title} | ${m.track.artist} | ${m.track.album}${flags ? '   [' + flags + ']' : ''}`);
  }

  if (!write) {
    say('\nRead-only run finished. Nothing was written to Music.');
    say('To test the copy, add:  --write --dest "<a new playlist name>"');
    return 0;
  }
  if (matches.length === 0) { say('\nNothing to copy.'); return 0; }

  say('\n## 5. Copy into NEW playlist');
  if (playlists.some((p) => p.name === destName)) {
    say(`BLOCKED: a playlist named "${destName}" already exists. Pick another name.`);
    return 1;
  }
  const result = await music.copyTracks({
    sourceId: src.id,
    destName,
    tracks: matches.map((m) => ({ position: m.position, id: m.track.id })),
  });
  const report = buildReport({ requested: matches, skippedDuplicates, helperResult: result });
  say(`status=${report.status}  copied=${report.copiedCount}  failed=${report.failedCount}  skipped=${report.skippedCount}`);
  say(`create method used: ${result.createMethod}`);
  say(`destination: "${result.destination?.name}"  reported track count: ${result.destination?.trackCount}`);
  say(`source unchanged (helper's before/after check): ${report.sourceUnchanged}`);
  for (const f of report.failed) say(`  FAILED #${f.position + 1} ${f.track.title}: ${f.reason}`);

  say('\n## 6. Independent re-read of both playlists');
  const srcAfter = await music.readPlaylist(src.id);
  const sameLength = srcAfter.tracks.length === data.tracks.length;
  const sameOrderAndIds = sameLength && srcAfter.tracks.every((t, i) => t.id === data.tracks[i].id);
  say(`source before=${data.tracks.length} after=${srcAfter.tracks.length}  identical order+IDs: ${sameOrderAndIds}`);
  const after = await music.listPlaylists();
  const dest = after.find((p) => p.name === destName);
  say(`destination found by name: ${Boolean(dest)}   track count: ${dest?.trackCount}`);
  if (dest) {
    const destTracks = await music.readPlaylist(dest.id);
    say('destination tracks:');
    for (const t of destTracks.tracks) say(`  ${t.title} | ${t.artist} | ${t.album}`);
  }

  say('\n## 7. Manual checks for you');
  say('  [ ] The new playlist shows the expected songs in the Music app');
  say('  [ ] The source playlist looks exactly as before');
  say('  [ ] With Sync Library on, the new playlist appears on your iPhone (give it a minute)');
  return report.status === 'success' && sameOrderAndIds ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    console.log('\nFAILED: ' + (e instanceof MusicError ? `[${e.code}] ${e.message}` : e.stack || e));
    process.exitCode = 1;
  });
