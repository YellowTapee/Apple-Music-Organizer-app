import { normalize } from '../src/matching.js';

export function pickPreview(results, title, artist, album) {
  const matches = results.filter(r => normalize(r.trackName) === normalize(title) && normalize(r.artistName) === normalize(artist));
  const exactAlbum = matches.find(r => normalize(r.collectionName) === normalize(album));
  const match = exactAlbum || matches[0];
  if (!match?.previewUrl || !match?.trackViewUrl) return null;
  try {
    const audio = new URL(match.previewUrl), link = new URL(match.trackViewUrl);
    if (audio.protocol !== 'https:' || !audio.hostname.endsWith('.itunes.apple.com')) return null;
    if (link.protocol !== 'https:' || !['music.apple.com', 'itunes.apple.com'].includes(link.hostname)) return null;
  } catch { return null; }
  return { previewUrl: match.previewUrl, trackUrl: match.trackViewUrl, title: match.trackName, artist: match.artistName };
}

export function createPreviewLookup(fetcher = fetch) {
  const cache = new Map();
  let windowStart = Date.now(), requests = 0;
  return async ({ title, artist, album = '' }) => {
    if (![title, artist].every(v => typeof v === 'string' && v.trim() && v.length <= 500) || typeof album !== 'string' || album.length > 500) throw new Error('Song title and artist are required.');
    const key = JSON.stringify([title, artist, album]);
    if (cache.has(key)) return cache.get(key);
    if (Date.now() - windowStart > 60000) { requests = 0; windowStart = Date.now(); }
    if (++requests > 15) throw new Error('Preview search is cooling down. Try again in a minute.');
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({ term: `${title} ${artist}`, entity: 'song', country: 'CA', limit: '25' });
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Apple preview search is unavailable. Try again later.');
    const body = await response.json();
    const preview = pickPreview(Array.isArray(body.results) ? body.results : [], title, artist, album);
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, preview);
    return preview;
  };
}
