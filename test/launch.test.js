import test from 'node:test';
import assert from 'node:assert/strict';
import { probeHelper, launch } from '../helper/launch.js';

test('launcher only reuses the organizer, not another local service', async () => {
  assert.equal(await probeHelper('http://localhost', async () => ({ ok: true, json: async () => ({ app: 'apple-music-organizer' }) })), true);
  assert.equal(await probeHelper('http://localhost', async () => ({ ok: true, json: async () => ({ app: 'other' }) })), false);
  assert.equal(await probeHelper('http://localhost', async () => { throw Error('offline'); }), false);
});

test('launcher refuses non-Mac platforms without opening anything', async () => {
  let opened = false;
  await assert.rejects(launch({ platform: 'linux', run: async () => { opened = true; } }), /Mac/);
  assert.equal(opened, false);
});
