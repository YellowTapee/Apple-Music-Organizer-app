import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../helper/server.js';
import { createMusicAdapter } from '../helper/music-adapter.js';
import http from 'node:http';

test('playback validates song identity fields and routes play and pause separately', async t => {
  const calls = [];
  const server = createServer({ port: 0, adapter: {
    async playTrack(body) { calls.push(body); return { playing: true }; },
    async pause() { calls.push('pause'); return { paused: true }; },
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (path, body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: 'POST', headers: { Host: '127.0.0.1:0', 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  assert.equal((await post('/api/play', { sourceId: 'P', position: -1, id: 'T' })).status, 400);
  assert.equal(calls.length, 0);
  const track = { sourceId: 'P', position: 42, id: 'T' };
  assert.equal((await post('/api/play', track)).status, 200);
  assert.equal((await post('/api/pause', {})).status, 200);
  assert.deepEqual(calls, [track, 'pause']);
});

test('adapter passes exact track identity as arguments to playback automation', async () => {
  const calls = [];
  const adapter = createMusicAdapter({ platform: 'darwin', exec: async (file, args) => { calls.push({ file, args }); return '{}'; } });
  await adapter.playTrack({ sourceId: 'P', position: 4, id: 'T' });
  await adapter.pause();
  assert.match(calls[0].file, /play-track.js$/);
  assert.deepEqual(calls[0].args, ['P', '4', 'T']);
  assert.match(calls[1].file, /pause.js$/);
});
