import test from 'node:test';
import assert from 'node:assert/strict';
import { allTracks, filterSongs, readOrganized, recordCopied } from '../src/organizing.js';
import { buildReport } from '../src/report.js';

test('full browser preserves source positions, metadata and separate versions', () => {
  const tracks = [{ id: 'a', title: 'Song', artist: 'Artist' }, { id: 'a', title: 'Song', artist: 'Artist' }, { id: 'b', title: 'Song (live)', artist: 'Artist' }];
  const result = allTracks(tracks);
  assert.deepEqual(result.matches.map(m => m.position), [0, 2]);
  assert.equal(result.skippedDuplicates.length, 1);
  assert.equal(allTracks(tracks, 'allow').matches.length, 3);
  assert.equal(tracks.length, 3);
});

test('search matches song, artist and album without modifying selections', () => {
  const { matches } = allTracks([{ id: '1', title: 'Night', artist: 'Drake', album: 'One' }, { id: '2', title: 'Day', artist: 'Lil Baby', album: 'Two' }]);
  assert.equal(filterSongs(matches, 'drake night')[0].track.id, '1');
  assert.equal(filterSongs(matches, 'two')[0].track.id, '2');
  assert.equal(filterSongs(matches, '').length, 2);
});

test('only confirmed successful copies are recorded, scoped to source playlist', () => {
  const requested = allTracks([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).matches;
  const report = buildReport({ requested, helperResult: { results: [{ position: 0, status: 'copied' }, { position: 1, status: 'failed' }] } });
  const previous = { other: ['z'] };
  const next = recordCopied(previous, 'source', report.copied);
  assert.deepEqual(next, { other: ['z'], source: ['a'] });
  assert.deepEqual(previous, { other: ['z'] });
  assert.deepEqual(recordCopied(next, 'source', report.copied), next);
});

test('corrupt or unavailable local storage does not break the browser', () => {
  assert.deepEqual(readOrganized({ getItem: () => 'broken' }), {});
  assert.deepEqual(readOrganized({ getItem: () => { throw Error('denied'); } }), {});
  assert.deepEqual(readOrganized({ getItem: () => '{"source":["a",null,5]}' }), { source: ['a'] });
});

test('browse and search a 2200-song playlist without losing original indexes', () => {
  const tracks = Array.from({ length: 2200 }, (_, i) => ({ id: String(i), title: `Song ${i}`, artist: i % 2 ? 'Artist A' : 'Artist B' }));
  const { matches } = allTracks(tracks);
  assert.equal(matches.length, 2200);
  assert.equal(filterSongs(matches, 'Artist A').length, 1100);
  assert.equal(matches[2199].position, 2199);
});
