import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPreview, createPreviewLookup } from '../helper/previews.js';
const song = { trackName: 'Song', artistName: 'Artist', collectionName: 'Album', previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a', trackViewUrl: 'https://music.apple.com/ca/song/123' };
test('preview requires matching title and artist and keeps different versions separate', () => {
  assert.equal(pickPreview([song], 'Song (Live)', 'Artist', 'Album'), null);
  assert.equal(pickPreview([song], 'Song', 'Other', 'Album'), null);
  assert.equal(pickPreview([song], 'song', 'artist', 'Album').previewUrl, song.previewUrl);
});
test('preview rejects unsafe media links and missing previews', () => {
  assert.equal(pickPreview([{ ...song, previewUrl: 'http://localhost:123' }], 'Song', 'Artist'), null);
  assert.equal(pickPreview([{ ...song, previewUrl: null }], 'Song', 'Artist'), null);
});
test('preview searches on demand and caches results', async () => {
  let count = 0;
  const lookup = createPreviewLookup(async url => {
    count++;
    assert.equal(url.hostname, 'itunes.apple.com');
    return { ok: true, json: async () => ({ results: [song] }) };
  });
  await lookup({ title: 'Song', artist: 'Artist' });
  await lookup({ title: 'Song', artist: 'Artist' });
  assert.equal(count, 1);
  await assert.rejects(lookup({ title: '', artist: 'Artist' }));
});
