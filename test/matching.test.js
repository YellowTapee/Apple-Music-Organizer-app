import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  parseArtists,
  listArtists,
  duplicateKey,
  matchTracks,
  removeMatches,
  REASONS,
} from '../src/matching.js';
import { playlist20, deepFreeze } from './fixtures.js';

const titles = (result) => result.matches.map((m) => m.track.title);

// ---------- normalize ----------

test('normalize strips case, diacritics, smart quotes and extra spaces', () => {
  assert.equal(normalize('  Beyoncé  '), 'beyonce');
  assert.equal(normalize('Don’t   Stop'), "don't stop");
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
});

// ---------- parseArtists ----------

test('parseArtists separates featured artist from the artist field', () => {
  const p = parseArtists('Kendrick Lamar feat. SZA', 'Hotel');
  assert.equal(p.primary, 'Kendrick Lamar');
  assert.deepEqual(p.featured, ['SZA']);
});

test('parseArtists reads featured artist from the title', () => {
  const p = parseArtists('Future', 'Foxtrot (feat. Drake)');
  assert.equal(p.primary, 'Future');
  assert.deepEqual(p.featured, ['Drake']);
});

test('parseArtists handles ft. and featuring variants', () => {
  assert.deepEqual(parseArtists('A ft. B', '').featured, ['B']);
  assert.deepEqual(parseArtists('A featuring B', '').featured, ['B']);
  assert.deepEqual(parseArtists('A feat. B & C', '').featured, ['B', 'C']);
});

test('parseArtists flags collaboration separators without splitting the primary', () => {
  const p = parseArtists('Drake & Future', 'Golf');
  assert.equal(p.primary, 'Drake & Future');
  assert.equal(p.hasCollabSeparator, true);
  assert.deepEqual(p.primaryParts, ['Drake', 'Future']);
});

test('parseArtists does not treat "Tyler, The Creator" as a plain single name silently', () => {
  const p = parseArtists('Tyler, The Creator', 'India');
  assert.equal(p.primary, 'Tyler, The Creator');
  assert.equal(p.hasCollabSeparator, true);
});

test('parseArtists survives missing and odd input', () => {
  assert.equal(parseArtists(undefined, undefined).primary, '');
  assert.equal(parseArtists('', '').featured.length, 0);
});

// ---------- listArtists ----------

test('listArtists counts primary tracks only by default', () => {
  const list = listArtists(playlist20);
  const drake = list.find((a) => a.name === 'Drake');
  assert.equal(drake.trackCount, 5);
  assert.equal(list.find((a) => a.name === 'SZA').trackCount, 3);
  // Featured-only artists don't appear as their own entry by default.
  assert.ok(!list.some((a) => a.name === 'Drake feat. Future'));
});

test('listArtists with includeFeatured adds featured appearances', () => {
  const withFeat = listArtists(playlist20, { includeFeatured: true });
  assert.equal(withFeat.find((a) => a.name === 'Drake').trackCount, 6); // +1 via title feat.
  assert.equal(withFeat.find((a) => a.name === 'SZA').trackCount, 4); // +1 via artist feat.
});

test('listArtists is sorted and stable', () => {
  const names = listArtists(playlist20).map((a) => a.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  assert.deepEqual(names, sorted);
});

// ---------- matchTracks: primary vs featured ----------

test('primary-only matching is the default and excludes featured', () => {
  const result = matchTracks(playlist20, ['SZA']);
  assert.deepEqual(titles(result), ['Echo', 'Lima', 'Quebec']); // not "Hotel" (SZA is featured)
});

test('opt-in featured matching adds featured tracks, in original order', () => {
  const result = matchTracks(playlist20, ['SZA'], { includeFeatured: true });
  assert.deepEqual(titles(result), ['Echo', 'Hotel', 'Lima', 'Quebec']);
  assert.equal(result.matches[1].matchType, 'featured');
});

test('two selected artists produce the expected set (the ~5 song proof-of-concept shape)', () => {
  const result = matchTracks(playlist20, ['SZA', 'Tyler, The Creator']);
  assert.deepEqual(titles(result), ['Echo', 'India', 'Lima', 'November', 'Quebec']);
  assert.equal(result.matches.length, 5);
});

test('title-based featured artist is excluded by default, included on opt-in', () => {
  // "Foxtrot (feat. Drake)" is a Future track.
  assert.ok(!titles(matchTracks(playlist20, ['Drake'])).includes('Foxtrot (feat. Drake)'));
  assert.ok(
    titles(matchTracks(playlist20, ['Drake'], { includeFeatured: true })).includes(
      'Foxtrot (feat. Drake)',
    ),
  );
});

test('artist selection is case- and accent-insensitive', () => {
  const tracks = [{ id: 'a', title: 'Song', artist: 'Beyoncé', album: 'X' }];
  assert.equal(matchTracks(tracks, ['beyonce']).matches.length, 1);
  assert.equal(matchTracks(tracks, ['BEYONCÉ']).matches.length, 1);
});

// ---------- uncertain matches ----------

test('collaboration strings are matched via their parts but flagged uncertain', () => {
  const result = matchTracks(playlist20, ['Drake']);
  const golf = result.matches.find((m) => m.track.title === 'Golf');
  assert.ok(golf, 'Drake & Future should match Drake');
  assert.equal(golf.uncertain, true);
  assert.ok(golf.reasons.includes(REASONS.COLLAB_NAME));
  // Plain Drake tracks are certain.
  const alpha = result.matches.find((m) => m.track.title === 'Alpha');
  assert.equal(alpha.uncertain, false);
});

test('an exact collaboration-string selection is a certain match', () => {
  const result = matchTracks(playlist20, ['Drake & Future']);
  assert.deepEqual(titles(result), ['Golf']);
  assert.equal(result.matches[0].uncertain, false);
});

test('version variants are noted for review but not auto-merged', () => {
  const tracks = [
    { id: '1', title: 'Song', artist: 'A', album: 'X' },
    { id: '2', title: 'Song (Live)', artist: 'A', album: 'Y' },
    { id: '3', title: 'Song (Remastered 2011)', artist: 'A', album: 'Z' },
  ];
  const result = matchTracks(tracks, ['A'], { duplicates: 'skip' });
  assert.equal(result.matches.length, 3, 'live/remaster are not duplicates of the original');
  assert.ok(result.matches[1].reasons.includes(REASONS.VERSION_VARIANT));
  assert.ok(result.matches[2].reasons.includes(REASONS.VERSION_VARIANT));
  assert.deepEqual(result.matches[0].reasons, []);
});

// ---------- duplicates ----------

test('skip duplicates by track ID keeps the first occurrence and reports the rest', () => {
  const tracks = [
    { id: '1', title: 'Song', artist: 'A', album: 'X' },
    { id: '2', title: 'Other', artist: 'A', album: 'X' },
    { id: '1', title: 'Song', artist: 'A', album: 'X' },
  ];
  const result = matchTracks(tracks, ['A'], { duplicates: 'skip' });
  assert.deepEqual(result.matches.map((m) => m.position), [0, 1]);
  assert.deepEqual(result.skippedDuplicates.map((m) => m.position), [2]);
});

test('allow duplicates keeps every occurrence', () => {
  const tracks = [
    { id: '1', title: 'Song', artist: 'A', album: 'X' },
    { id: '1', title: 'Song', artist: 'A', album: 'X' },
  ];
  const result = matchTracks(tracks, ['A'], { duplicates: 'allow' });
  assert.equal(result.matches.length, 2);
  assert.equal(result.skippedDuplicates.length, 0);
});

test('without IDs, duplicates fall back to title + artist + album metadata', () => {
  const tracks = [
    { title: 'Song', artist: 'A', album: 'X' },
    { title: 'SONG', artist: 'a', album: 'x' },
    { title: 'Song', artist: 'A', album: 'Different Album' },
  ];
  const result = matchTracks(tracks, ['A'], { duplicates: 'skip' });
  assert.equal(result.matches.length, 2);
  assert.equal(result.skippedDuplicates.length, 1);
});

test('duplicateKey prefers ID over metadata', () => {
  assert.equal(duplicateKey({ id: '42', title: 'x', artist: 'y', album: 'z' }), 'id:42');
  assert.match(duplicateKey({ title: 'X', artist: 'Y', album: 'Z' }), /^meta:/);
});

test('invalid duplicates option throws instead of silently guessing', () => {
  assert.throws(() => matchTracks(playlist20, ['Drake'], { duplicates: 'maybe' }));
});

// ---------- ordering ----------

test('matches preserve original playlist order via position', () => {
  const result = matchTracks(playlist20, ['Future', 'Drake']);
  const positions = result.matches.map((m) => m.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(result.matches[0].track.title, 'Alpha');
});

// ---------- source immutability ----------

test('matching never mutates the source playlist (deep-frozen input)', () => {
  const frozen = deepFreeze(structuredClone(playlist20));
  const before = JSON.stringify(frozen);
  matchTracks(frozen, ['Drake', 'Future'], { includeFeatured: true, duplicates: 'allow' });
  listArtists(frozen, { includeFeatured: true });
  assert.equal(JSON.stringify(frozen), before);
});

test('returned tracks are copies: editing a match does not touch the source', () => {
  const source = structuredClone(playlist20);
  const result = matchTracks(source, ['SZA']);
  result.matches[0].track.title = 'CHANGED';
  assert.equal(source.find((t) => t.id === '5').title, 'Echo');
});

// ---------- manual removal ----------

test('removeMatches drops selected positions and leaves the source alone', () => {
  const source = structuredClone(playlist20);
  const { matches } = matchTracks(source, ['SZA']);
  const trimmed = removeMatches(matches, [matches[1].position]);
  assert.deepEqual(trimmed.map((m) => m.track.title), ['Echo', 'Quebec']);
  assert.equal(matches.length, 3, 'original match list is untouched');
});

// ---------- empty / no-match / odd metadata ----------

test('empty playlist, empty selection and no matches return empty results', () => {
  assert.deepEqual(matchTracks([], ['Drake']).matches, []);
  assert.deepEqual(matchTracks(playlist20, []).matches, []);
  assert.deepEqual(matchTracks(playlist20, undefined).matches, []);
  assert.deepEqual(matchTracks(playlist20, ['Nobody Real']).matches, []);
});

test('special characters in names are handled literally', () => {
  const tracks = [
    { id: '1', title: 'Song [Bonus]', artist: 'AC/DC', album: 'Back in Black' },
    { id: '2', title: "Rock 'n' Roll", artist: 'P!nk', album: 'X' },
    { id: '3', title: 'Hey (Sing) *', artist: 'Sigur Rós', album: 'Y' },
    { id: '4', title: '日本語', artist: '宇多田ヒカル', album: 'Z' },
    { id: '5', title: 'Regex $^.*+?', artist: 'a.b(c)', album: 'Q' },
  ];
  assert.equal(matchTracks(tracks, ['AC/DC']).matches.length, 1);
  assert.equal(matchTracks(tracks, ['P!nk']).matches.length, 1);
  assert.equal(matchTracks(tracks, ['Sigur Ros']).matches.length, 1);
  assert.equal(matchTracks(tracks, ['宇多田ヒカル']).matches.length, 1);
  assert.equal(matchTracks(tracks, ['a.b(c)']).matches.length, 1);
  assert.equal(matchTracks(tracks, ['aXb(c)']).matches.length, 0, 'no regex interpretation');
});

test('missing artist metadata never matches a real selection and is flagged if matched', () => {
  const tracks = [{ id: '1', title: 'Mystery', artist: '', album: '' }];
  assert.equal(matchTracks(tracks, ['Drake']).matches.length, 0);
  assert.equal(matchTracks(tracks, ['']).matches.length, 0, 'blank selection matches nothing');
});

// ---------- large playlist ----------

test('a 20,000-track playlist matches quickly and stays ordered', () => {
  const artists = ['Drake', 'Future', 'SZA', 'Kendrick Lamar', 'Tyler, The Creator'];
  const big = Array.from({ length: 20000 }, (_, i) => ({
    id: String(i),
    title: `Track ${i}`,
    artist: artists[i % artists.length],
    album: `Album ${i % 500}`,
  }));
  const start = performance.now();
  const result = matchTracks(big, ['SZA', 'Future']);
  const elapsed = performance.now() - start;
  assert.equal(result.matches.length, 8000);
  assert.ok(elapsed < 2000, `took ${elapsed.toFixed(0)}ms`);
  const positions = result.matches.map((m) => m.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});
