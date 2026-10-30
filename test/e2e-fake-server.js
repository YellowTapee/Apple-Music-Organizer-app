// TEST-ONLY server. Runs the real UI and real helper server against an
// in-memory FAKE Music library so browser tests can exercise every state
// (permission denied, Music closed, failure halfway, ...).
//
// Never use this to "demo" the app. Everything it serves is fake and the
// playlist names say so. Real use is `npm start`.
//
//   MODE=ok|permission-denied|music-closed|fail-halfway|empty|unsupported PORT=4180 node test/e2e-fake-server.js

import { createServer } from '../helper/server.js';
import { MusicError } from '../helper/music-adapter.js';
import { playlist20 } from './fixtures.js';

const MODE = process.env.MODE || 'ok';
const PORT = Number(process.env.PORT) || 4180;

const library = [
  { id: 'P1', name: 'FAKE TEST: 20 track playlist', specialKind: 'none', tracks: structuredClone(playlist20) },
  { id: 'P2', name: 'FAKE TEST: <b>html</b> & "quotes"', specialKind: 'none', tracks: [{ id: 'x1', title: '<img src=x onerror=alert(1)>', artist: 'Evil & Co', album: '"><script>1</script>' }] },
  { id: 'P3', name: 'FAKE TEST: Empty', specialKind: 'none', tracks: [] },
  { id: 'SYS', name: 'Recently Added', specialKind: 'recently added', tracks: [] },
];
let nextId = 1;
const log = []; // every write, so tests can assert on it

function guard() {
  if (MODE === 'permission-denied') throw new MusicError('permission-denied', 'macOS has not allowed this app to control Music. Open System Settings > Privacy & Security > Automation, and enable Music for the app that is running this helper (for example Terminal). Then try again.');
  if (MODE === 'music-closed') throw new MusicError('music-closed', 'The Music app is not running. Open Music, then try again.');
}

const adapter = {
  async status() {
    if (MODE === 'permission-denied') return { state: 'permission-denied', message: 'macOS has not allowed this app to control Music.' };
    if (MODE === 'music-closed') return { state: 'music-closed', message: 'Open the Music app to continue.' };
    if (MODE === 'unsupported') return { state: 'unsupported-platform', message: 'Apple Music control only works on a Mac. Run this helper on your Mac.' };
    return { state: 'ready', message: 'Connected to Music.' };
  },
  async listPlaylists() {
    guard();
    if (MODE === 'empty') return [];
    return library.map((p) => ({ id: p.id, name: p.name, trackCount: p.tracks.length, specialKind: p.specialKind, smart: false }));
  },
  async readPlaylist(id) {
    guard();
    const p = library.find((x) => x.id === id);
    if (!p) throw new MusicError('failed', 'playlist not found');
    return { id: p.id, name: p.name, tracks: p.tracks.map((t, i) => ({ position: i, ...t })) };
  },
  async copyTracks({ sourceId, destName, tracks }) {
    guard();
    await new Promise((r) => setTimeout(r, 400)); // long enough to observe the "copying" state
    const src = library.find((p) => p.id === sourceId);
    const before = JSON.stringify(src.tracks.map((t) => t.id));
    const dest = { id: 'N' + nextId++, name: destName, specialKind: 'none', tracks: [] };
    library.push(dest);
    const results = [];
    let aborted = null;
    tracks.forEach((t, k) => {
      if (aborted) return results.push({ position: t.position, id: t.id, status: 'failed', reason: 'not attempted: ' + aborted });
      if (MODE === 'fail-halfway' && k === 2) {
        aborted = 'Connection is invalid (-609)';
        return results.push({ position: t.position, id: t.id, status: 'failed', reason: aborted });
      }
      dest.tracks.push(src.tracks[t.position]);
      results.push({ position: t.position, id: t.id, status: 'copied' });
    });
    log.push({ destName, requested: tracks.length, copied: dest.tracks.length });
    console.log('WRITE ' + JSON.stringify(log[log.length - 1])); // tests read this from stdout
    return {
      destination: { id: dest.id, name: destName, trackCount: dest.tracks.length },
      createMethod: 'fake',
      results,
      sourceUnchanged: before === JSON.stringify(src.tracks.map((t) => t.id)),
      aborted,
    };
  },
};

const server = createServer({ adapter, port: PORT });
server.listen(PORT, '127.0.0.1', () => console.log(`fake test server (${MODE}) on ${PORT}`));
