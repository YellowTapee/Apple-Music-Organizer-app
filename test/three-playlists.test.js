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
