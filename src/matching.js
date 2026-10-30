// Pure matching logic for the Artist Playlist Sorter.
//
// No UI, no Apple Music access, no I/O. Everything here takes plain track
// objects in and returns new objects out. Input is never mutated, which is how
// the "source playlist is never modified" rule is enforced at the logic level.
//
// Track shape:
//   { id?: string, title: string, artist: string, album?: string }
// `position` (original playlist order) is assigned here from array index.

const FEATURED_SPLIT = /\s*[([]?\s*\b(?:feat\.?|ft\.?|featuring)\s+/i;
const COLLAB_SEPARATORS = /\s+(?:&|and|x|\+|vs\.?)\s+|\s*,\s*|\s*;\s*/i;
const VERSION_WORDS = /\b(live|remix|remastered|remaster|clean|deluxe|acoustic|instrumental|demo|radio edit|extended|explicit)\b/i;

export const REASONS = Object.freeze({
  COLLAB_NAME: 'collaboration-name', // "A & B" could be one act or two artists
  MISSING_ARTIST: 'missing-artist',
  VERSION_VARIANT: 'version-variant', // live/remix/clean/etc.; never auto-merged
});

// Reasons that make a match "uncertain" and worth a warning in the review UI.
const UNCERTAIN_REASONS = new Set([REASONS.COLLAB_NAME, REASONS.MISSING_ARTIST]);

/** Lowercase, strip diacritics, unify quotes/ampersands, collapse whitespace. */
export function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function splitList(text) {
  return text
    .split(/\s*(?:,|&|\band\b|\+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse an artist string and title into primary and featured artists.
 * Featured artists may appear in the artist field ("A feat. B") or in the
 * title ("Song (feat. B)").
 *
 * Returns display names (original casing) plus normalized forms.
 */
export function parseArtists(artist, title = '') {
  const rawArtist = (artist ?? '').toString().trim();
  const rawTitle = (title ?? '').toString();

  const [primaryText, ...featRest] = rawArtist.split(FEATURED_SPLIT);
  const featuredFromArtist = featRest.length ? splitList(featRest.join(' ').replace(/[)\]]+\s*$/, '')) : [];

  let featuredFromTitle = [];
  const titleMatch = rawTitle.match(/[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]/i);
  if (titleMatch) featuredFromTitle = splitList(titleMatch[1]);

  const primary = primaryText.trim();
  const hasCollabSeparator = primary !== '' && COLLAB_SEPARATORS.test(primary);

  return {
    primary, // whole primary string, e.g. "Simon & Garfunkel"
    primaryNormalized: normalize(primary),
    // Possible individual artists inside a collaboration string. Matches via
    // these parts are always flagged uncertain: "Simon & Garfunkel" is one act.
    primaryParts: hasCollabSeparator
      ? primary.split(COLLAB_SEPARATORS).map((s) => s.trim()).filter(Boolean)
      : [],
    featured: [...featuredFromArtist, ...featuredFromTitle],
    featuredNormalized: [...featuredFromArtist, ...featuredFromTitle].map(normalize),
    hasCollabSeparator,
  };
}

/**
 * Distinct artists in a playlist with track counts.
 * Primary-only by default; with includeFeatured, featured appearances are
 * added (a track is counted once per artist even if listed twice).
 * Sorted by name, case-insensitive, for a stable list.
 */
export function listArtists(tracks, { includeFeatured = false } = {}) {
  const byKey = new Map();
  const bump = (name, key, trackIndex) => {
    if (!key) return;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { name, key, trackIndexes: new Set() };
      byKey.set(key, entry);
    }
    entry.trackIndexes.add(trackIndex);
  };

  tracks.forEach((track, i) => {
    const parsed = parseArtists(track.artist, track.title);
    bump(parsed.primary, parsed.primaryNormalized, i);
    if (includeFeatured) {
      parsed.featured.forEach((name) => bump(name, normalize(name), i));
    }
  });

  return [...byKey.values()]
    .map(({ name, key, trackIndexes }) => ({ name, key, trackCount: trackIndexes.size }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Key used for duplicate detection. Prefers the Apple Music track ID. Without
 * one, falls back to normalized title + artist + album. Title keeps its
 * "(Live)", "(Remix)" etc. text, so version variants are NOT treated as
 * duplicates of each other.
 */
export function duplicateKey(track) {
  if (track.id !== undefined && track.id !== null && String(track.id) !== '') {
    return `id:${track.id}`;
  }
  return `meta:${normalize(track.title)}|${normalize(track.artist)}|${normalize(track.album)}`;
}

/**
 * Find the tracks in `tracks` by the selected artists.
 *
 * options:
 *   includeFeatured: boolean (default false)
 *   duplicates: 'skip' | 'allow' (default 'skip')
 *
 * Returns { matches, skippedDuplicates }. Each match is a NEW object:
 *   { track, position, matchType: 'primary' | 'featured', uncertain, reasons }
 * Matches keep original playlist order. Input arrays/objects are not mutated.
 */
export function matchTracks(tracks, selectedArtists, options = {}) {
  const { includeFeatured = false, duplicates = 'skip' } = options;
  if (duplicates !== 'skip' && duplicates !== 'allow') {
    throw new Error(`Unknown duplicates option: ${duplicates}`);
  }

  const wanted = new Set((selectedArtists ?? []).map(normalize).filter(Boolean));
  const matches = [];
  const skippedDuplicates = [];
  const seen = new Set();

  if (wanted.size === 0) return { matches, skippedDuplicates };

  tracks.forEach((track, position) => {
    const parsed = parseArtists(track.artist, track.title);
    const reasons = [];
    let matchType = null;

    if (wanted.has(parsed.primaryNormalized)) {
      matchType = 'primary';
    } else if (parsed.primaryParts.some((part) => wanted.has(normalize(part)))) {
      // "Drake & Future" when only "Drake" is selected: include, but flag.
      matchType = 'primary';
      reasons.push(REASONS.COLLAB_NAME);
    } else if (includeFeatured && parsed.featuredNormalized.some((n) => wanted.has(n))) {
      matchType = 'featured';
    }

    if (!matchType) return;

    if (!normalize(track.artist)) reasons.push(REASONS.MISSING_ARTIST);
    if (VERSION_WORDS.test(track.title ?? '')) reasons.push(REASONS.VERSION_VARIANT);

    const match = {
      track: { ...track },
      position,
      matchType,
      uncertain: reasons.some((r) => UNCERTAIN_REASONS.has(r)),
      reasons,
    };

    if (duplicates === 'skip') {
      const key = duplicateKey(track);
      if (seen.has(key)) {
        skippedDuplicates.push(match);
        return;
      }
      seen.add(key);
    }

    matches.push(match);
  });

  return { matches, skippedDuplicates };
}

/** Return a new match list without the tracks at the given playlist positions. */
export function removeMatches(matches, positionsToRemove) {
  const drop = new Set(positionsToRemove);
  return matches.filter((m) => !drop.has(m.position));
}
