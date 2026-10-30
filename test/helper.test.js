// Tests for the adapter, server and report logic using FAKE Music back-ends.
// The fakes live only in this file. They prove our handling of failure states;
// they say nothing about whether real Apple Music behaves. See docs/VERIFICATION.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMusicAdapter, classifyError, MusicError } from '../helper/music-adapter.js';
import { createServer, validateCopyRequest, LIMITS } from '../helper/server.js';
import { buildReport, failedMatches } from '../src/report.js';
import { matchTracks } from '../src/matching.js';
import { playlist20 } from './fixtures.js';

// ---------- adapter: platform + error classification ----------

test('adapter reports unsupported platform instead of faking data', async () => {
  const a = createMusicAdapter({ platform: 'linux', exec: async () => { throw new Error('must not run'); } });
  assert.equal((await a.status()).state, 'unsupported-platform');
  await assert.rejects(a.listPlaylists(), (e) => e.code === 'unsupported-platform');
  await assert.rejects(a.readPlaylist('x'), (e) => e.code === 'unsupported-platform');
  await assert.rejects(a.copyTracks({ sourceId: 'x', destName: 'y', tracks: [] }), (e) => e.code === 'unsupported-platform');
});

test('classifyError maps permission denied (-1743) with next steps', () => {
  const e = classifyError('execution error: Not authorized to send Apple events to Music. (-1743)');
  assert.equal(e.code, 'permission-denied');
  assert.match(e.message, /Automation/);
});

test('classifyError maps Music closed (-600)', () => {
  const e = classifyError('execution error: Application isn’t running. (-600)');
  assert.equal(e.code, 'music-closed');
});

test('classifyError falls back to a generic failure carrying the first line', () => {
  const e = classifyError('something odd\nsecond line');
  assert.equal(e.code, 'failed');
  assert.match(e.message, /something odd/);
});

test('status: Music closed, permission denied and ready are reported distinctly', async () => {
  const mk = (stdout) => createMusicAdapter({ platform: 'darwin', exec: async () => stdout });
  assert.equal((await mk(JSON.stringify({ musicRunning: false })).status()).state, 'music-closed');
  assert.equal(
    (await mk(JSON.stringify({ musicRunning: true, error: 'Error: Not authorized to send Apple events (-1743)' })).status()).state,
    'permission-denied',
  );
  assert.equal((await mk(JSON.stringify({ musicRunning: true, permission: 'granted' })).status()).state, 'ready');
});

test('adapter surfaces unreadable helper output as an error, not as empty data', async () => {
  const a = createMusicAdapter({ platform: 'darwin', exec: async () => 'not json' });
  await assert.rejects(a.listPlaylists(), (e) => e instanceof MusicError && e.code === 'failed');
});

// ---------- request validation ----------

const goodBody = () => ({
  confirm: true,
  sourceId: 'SRC',
  destName: 'My Copy',
  tracks: [{ position: 0, id: 'A' }],
});

test('copy validation passes a good request', () => {
  assert.deepEqual(validateCopyRequest(goodBody(), []).problems, []);
});

test('copy validation requires confirmation, a name, tracks, and a non-colliding name', () => {
  assert.ok(validateCopyRequest({ ...goodBody(), confirm: false }, []).problems.length);
  assert.ok(validateCopyRequest({ ...goodBody(), destName: '   ' }, []).problems.length);
  assert.ok(validateCopyRequest({ ...goodBody(), tracks: [] }, []).problems.length);
  assert.ok(validateCopyRequest({ ...goodBody(), tracks: [{ position: 'x', id: 'A' }] }, []).problems.length);
  const clash = validateCopyRequest(goodBody(), ['My Copy']);
  assert.match(clash.problems.join(' '), /already exists/);
  const tooMany = Array.from({ length: LIMITS.maxTracksPerCopy + 1 }, (_, i) => ({ position: i, id: String(i) }));
  assert.ok(validateCopyRequest({ ...goodBody(), tracks: tooMany }, []).problems.length);
});

// ---------- server (fake adapter, real HTTP) ----------

async function withServer(adapter, fn) {
  const port = 0;
  const server = createServer({ adapter, port });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const realPort = server.address().port;
  // Host allow-list is built from the port passed to createServer, so rebuild with the real one.
  server.close();
  const real = createServer({ adapter, port: realPort });
  await new Promise((r) => real.listen(realPort, '127.0.0.1', r));
  const base = `http://127.0.0.1:${realPort}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => real.close(r));
  }
}

const fakeAdapter = (over = {}) => ({
  status: async () => ({ state: 'ready' }),
  listPlaylists: async () => [{ id: 'SRC', name: 'Source', trackCount: 20 }],
  readPlaylist: async () => ({ id: 'SRC', name: 'Source', tracks: [] }),
  copyTracks: async ({ tracks }) => ({
    destination: { id: 'D', name: 'My Copy', trackCount: tracks.length },
    results: tracks.map((t) => ({ position: t.position, id: t.id, status: 'copied' })),
    sourceUnchanged: true,
    aborted: null,
  }),
  ...over,
});

const post = (base, body, headers = {}) =>
  fetch(base + '/api/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('server: successful copy returns the adapter result', async () => {
  await withServer(fakeAdapter(), async (base) => {
    const res = await post(base, goodBody());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).results[0].status, 'copied');
  });
});

test('server: write without confirm is rejected and never reaches the adapter', async () => {
  let called = false;
  await withServer(fakeAdapter({ copyTracks: async () => { called = true; } }), async (base) => {
    const res = await post(base, { ...goodBody(), confirm: undefined });
    assert.equal(res.status, 400);
    assert.equal(called, false);
  });
});

test('server: refuses to reuse an existing playlist name (no silent overwrite)', async () => {
  let called = false;
  const adapter = fakeAdapter({
    listPlaylists: async () => [{ id: 'X', name: 'My Copy' }],
    copyTracks: async () => { called = true; },
  });
  await withServer(adapter, async (base) => {
    const res = await post(base, goodBody());
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /already exists/);
    assert.equal(called, false);
  });
});

test('server: double submission is blocked while a copy is running', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const adapter = fakeAdapter({
    copyTracks: async ({ tracks }) => {
      calls++;
      await gate;
      return { destination: { id: 'D', name: 'My Copy' }, results: tracks.map((t) => ({ position: t.position, id: t.id, status: 'copied' })), sourceUnchanged: true };
    },
  });
  await withServer(adapter, async (base) => {
    const first = post(base, goodBody());
    await new Promise((r) => setTimeout(r, 50));
    const second = await post(base, goodBody());
    assert.equal(second.status, 409);
    release();
    assert.equal((await first).status, 200);
    assert.equal(calls, 1);
  });
});

test('server: lock is released after a failure so the user can retry', async () => {
  let n = 0;
  const adapter = fakeAdapter({
    copyTracks: async ({ tracks }) => {
      if (n++ === 0) throw new MusicError('music-closed', 'The Music app is not running.');
      return { destination: { id: 'D', name: 'My Copy' }, results: tracks.map((t) => ({ position: t.position, id: t.id, status: 'copied' })), sourceUnchanged: true };
    },
  });
  await withServer(adapter, async (base) => {
    const bad = await post(base, goodBody());
    assert.equal(bad.status, 503);
    assert.equal((await bad.json()).error.code, 'music-closed');
    assert.equal((await post(base, goodBody())).status, 200);
  });
});

test('server: permission denied is a 403 with the actionable message', async () => {
  const adapter = fakeAdapter({ listPlaylists: async () => { throw classifyError('Not authorized to send Apple events (-1743)'); } });
  await withServer(adapter, async (base) => {
    const res = await fetch(base + '/api/playlists');
    assert.equal(res.status, 403);
    assert.match((await res.json()).error.message, /Automation/);
  });
});

test('server: cross-origin and wrong-host requests are refused', async () => {
  await withServer(fakeAdapter(), async (base) => {
    const evil = await post(base, goodBody(), { Origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const form = await fetch(base + '/api/copy', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(goodBody()) });
    assert.equal(form.status, 415);
  });
});

test('server: static files cannot escape their folders', async () => {
  await withServer(fakeAdapter(), async (base) => {
    const res = await fetch(base + '/src/..%2f..%2fpackage.json');
    assert.notEqual(res.status, 200);
  });
});

// ---------- report: partial failure halfway ----------

test('report: failure halfway identifies exactly what was copied, failed and not attempted', () => {
  const { matches } = matchTracks(playlist20, ['Drake']); // several tracks
  const requested = matches;
  const results = requested.map((m, i) => {
    if (i < 2) return { position: m.position, id: m.track.id, status: 'copied' };
    if (i === 2) return { position: m.position, id: m.track.id, status: 'failed', reason: 'Connection is invalid (-609)' };
    return { position: m.position, id: m.track.id, status: 'failed', reason: 'not attempted: Connection is invalid (-609)' };
  });
  const report = buildReport({ requested, helperResult: { destination: { id: 'D', name: 'X' }, results, sourceUnchanged: true, aborted: 'Connection is invalid (-609)' } });
  assert.equal(report.status, 'partial');
  assert.equal(report.copiedCount, 2);
  assert.equal(report.failedCount, requested.length - 2);
  assert.equal(report.copiedCount + report.failedCount, requested.length);
  assert.match(report.failed[0].reason, /-609/);
  assert.equal(failedMatches(report).length, report.failedCount);
  assert.ok(!('reason' in failedMatches(report)[0]));
});

test('report: success only when every track is positively reported copied', () => {
  const { matches } = matchTracks(playlist20, ['SZA']);
  const all = matches.map((m) => ({ position: m.position, id: m.track.id, status: 'copied' }));
  assert.equal(buildReport({ requested: matches, helperResult: { results: all, sourceUnchanged: true } }).status, 'success');
  // A track with no reported result must NOT count as copied.
  const missingOne = buildReport({ requested: matches, helperResult: { results: all.slice(1), sourceUnchanged: true } });
  assert.equal(missingOne.status, 'partial');
  assert.equal(missingOne.failedCount, 1);
});

test('report: nothing copied is "failed"; empty or missing helper result never claims success', () => {
  const { matches } = matchTracks(playlist20, ['SZA']);
  assert.equal(buildReport({ requested: matches, helperResult: { results: [] } }).status, 'failed');
  assert.equal(buildReport({ requested: matches, helperResult: undefined }).status, 'failed');
  assert.equal(buildReport({ requested: [], helperResult: { results: [] } }).status, 'failed');
});

test('report: sourceUnchanged is tri-state and never assumed true', () => {
  const { matches } = matchTracks(playlist20, ['SZA']);
  const results = matches.map((m) => ({ position: m.position, id: m.track.id, status: 'copied' }));
  assert.equal(buildReport({ requested: matches, helperResult: { results, sourceUnchanged: false } }).sourceUnchanged, false);
  assert.equal(buildReport({ requested: matches, helperResult: { results } }).sourceUnchanged, null);
});

test('report: skipped duplicates are counted separately from failures', () => {
  const tracks = [
    { id: '1', title: 'S', artist: 'A', album: 'X' },
    { id: '1', title: 'S', artist: 'A', album: 'X' },
  ];
  const { matches, skippedDuplicates } = matchTracks(tracks, ['A']);
  const results = matches.map((m) => ({ position: m.position, id: m.track.id, status: 'copied' }));
  const r = buildReport({ requested: matches, skippedDuplicates, helperResult: { results, sourceUnchanged: true } });
  assert.equal(r.skippedCount, 1);
  assert.equal(r.failedCount, 0);
  assert.equal(r.status, 'success');
});
