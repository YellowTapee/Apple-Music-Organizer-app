import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as matching from '../src/matching.js';
import * as reports from '../src/report.js';
import * as organizing from '../src/organizing.js';

function ui(fetch) {
  const nodes = new Map();
  const node = () => ({ addEventListener() {}, pause() {}, load() {}, removeAttribute() {}, hasAttribute() { return false; }, querySelector() { return null; } });
  const storage = new Map();
  const context = vm.createContext({ ...matching, ...reports, ...organizing, Set, Map, URLSearchParams, fetch, setTimeout, clearTimeout,
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { addEventListener() {}, scrollTo() {} },
    localStorage: { setItem(k, v) { storage.set(k, v); }, getItem(k) { return storage.get(k) || null; } },
    sessionStorage: { getItem() { return null; } },
  });
  let code = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
  code = code.replace(/load\(\);\s*loadPlaylists\(\);\s*$/, '');
  vm.runInContext(code + '\nglobalThis.ui = { state, playlistBatches, batchProblem, doCopy, trackRow };', context);
  return { ...context.ui, storage };
}

test('three destinations retain overlapping selections and save only verified copies across a failure', async () => {
  const requests = [];
  const app = ui(async (path, options) => {
    if (path === '/api/playlists') return { ok: true, json: async () => ({ playlists: [] }) };
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.destName === 'Two') throw new Error('connection lost');
    return { ok: true, json: async () => ({ destination: { name: body.destName }, sourceUnchanged: true, results: body.tracks.map(t => ({ position: t.position, status: 'copied' })) }) };
  });
  Object.assign(app.state, { mode: 'songs', playlistId: 'source', destName: 'One', extraNames: ['Two', 'Three'], tracks: [
    { id: 'A', title: 'Alpha', artist: 'Artist' }, { id: 'B', title: 'Beta', artist: 'Artist' }, { id: 'C', title: 'Gamma', artist: 'Artist' },
  ], removed: new Set([1, 2]), extraSelections: [new Set([0, 1]), new Set([2])] });
  assert.equal(app.batchProblem(), null);
  await app.doCopy();
  assert.deepEqual(requests.map(r => r.tracks.map(t => t.id)), [['A'], ['A', 'B'], ['C']]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.organized.source)), ['A', 'C']);
  assert.equal(app.state.batchReports.length, 3);
  assert.match(app.state.batchReports[1].error, /reach the helper/);
  assert.equal(app.state.step, 5);
  assert.deepEqual(JSON.parse(app.storage.get(organizing.ORGANIZED_KEY)).source, ['A', 'C']);
});

test('empty destinations are skipped and duplicate names cannot be copied', () => {
  const app = ui();
  Object.assign(app.state, { mode: 'songs', destName: 'Same', extraNames: ['Same', ''], tracks: [{ id: 'A', title: 'Song', artist: 'Artist' }], extraSelections: [new Set([0]), new Set()] });
  assert.equal(app.playlistBatches().length, 2);
  assert.match(app.batchProblem(), /different name/);
  app.state.removed.add(0);
  assert.equal(app.playlistBatches().length, 1);
  assert.equal(app.batchProblem(), null);
});

test('five playlist slots start independently and the last two create separate destinations', async () => {
  const requests = [];
  const app = ui(async (path, options) => {
    if (path === '/api/playlists') return { ok: true, json: async () => ({ playlists: [] }) };
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => ({ destination: { name: body.destName }, sourceUnchanged: true, results: body.tracks.map(t => ({ position: t.position, status: 'copied' })) }) };
  });
  assert.equal(app.state.extraSelections.length, 4);
  app.state.extraSelections[2].add(0);
  assert.equal(app.state.extraSelections[3].size, 0);
  app.state.extraSelections[3].add(0);
  Object.assign(app.state, { mode: 'songs', playlistId: 'P', tracks: [{ id: 'A', title: 'Song', artist: 'Artist' }], removed: new Set([0]), extraNames: ['', '', 'Four', 'Five'] });
  await app.doCopy();
  assert.deepEqual(requests.map(r => r.destName), ['Four', 'Five']);
  assert.deepEqual(requests.map(r => r.tracks[0].id), ['A', 'A']);
});

test('a 2200-song source completes all five destinations in source order without dropping overlapping selections', async () => {
  const requests = [];
  const app = ui(async (path, options) => {
    if (path === '/api/playlists') return { ok: true, json: async () => ({ playlists: [] }) };
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => ({ destination: { name: body.destName }, sourceUnchanged: true, results: body.tracks.map(t => ({ position: t.position, status: 'copied' })) }) };
  });
  const tracks = Array.from({ length: 2200 }, (_, i) => ({ id: `ID${i}`, title: `Song ${i}`, artist: 'Artist', album: 'Album' }));
  const original = JSON.stringify(tracks);
  const groups = Array.from({ length: 5 }, (_, slot) => new Set(tracks.map((_, i) => i).filter(i => i % 5 === slot || i === 0)));
  Object.assign(app.state, { mode: 'songs', playlistId: 'P', tracks, destName: 'First', extraNames: ['Second', 'Third', 'Fourth', 'Fifth'], removed: new Set(tracks.map((_, i) => i).filter(i => !groups[0].has(i))), extraSelections: groups.slice(1), songSearch: 'Song 2199' });
  assert.equal(app.batchProblem(), null);
  await app.doCopy();
  assert.deepEqual(requests.map(r => r.destName), ['First', 'Second', 'Third', 'Fourth', 'Fifth']);
  for (let slot = 0; slot < 5; slot++) {
    assert.deepEqual(requests[slot].tracks.map(t => t.position), [...groups[slot]]);
    assert.equal(requests[slot].confirm, true);
    assert.equal(app.state.batchReports[slot].report.status, 'success');
    assert.equal(app.state.batchReports[slot].report.copiedCount, groups[slot].size);
  }
  assert.equal(app.state.step, 5);
  assert.equal(app.state.copying, false);
  assert.equal(app.state.organized.P.length, 2200);
  assert.equal(JSON.parse(app.storage.get(organizing.ORGANIZED_KEY)).P.length, 2200);
  assert.equal(JSON.stringify(tracks), original);
});
