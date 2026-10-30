import { duplicateKey, normalize } from './matching.js';

export const ORGANIZED_KEY = 'organizer/copied-tracks/v1';

export function allTracks(tracks, duplicates = 'skip') {
  const seen = new Set();
  const matches = [], skippedDuplicates = [];
  tracks.forEach((track, position) => {
    const match = { track, position, reasons: [], uncertain: false, matchType: 'direct' };
    const key = duplicateKey(track);
    if (duplicates === 'skip' && seen.has(key)) skippedDuplicates.push(match);
    else matches.push(match);
    seen.add(key);
  });
  return { matches, skippedDuplicates };
}

export function filterSongs(matches, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  return matches.filter(({ track }) => {
    const text = normalize(`${track.title || ''} ${track.artist || ''} ${track.album || ''}`);
    const tokens = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    return words.length <= 1 ? text.includes(words[0] || '') : text.includes(normalize(query)) || words.every(word => tokens.has(word));
  });
}

export function readOrganized(storage) {
  try {
    const value = JSON.parse(storage.getItem(ORGANIZED_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, ids]) => Array.isArray(ids)).map(([id, ids]) => [id, ids.filter(x => typeof x === 'string')]));
  } catch { return {}; }
}

export function recordCopied(previous, sourceId, copied) {
  const ids = new Set(previous[sourceId] || []);
  for (const match of copied) if (match.track.id) ids.add(String(match.track.id));
  return { ...previous, [sourceId]: [...ids] };
}
