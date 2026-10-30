// UI for the Artist Playlist Sorter. Plain ES modules, no build step.
// All Apple Music access goes through the helper's /api endpoints; nothing here
// invents data. Matching and reporting logic live in /src and are unit-tested.

import { listArtists, matchTracks, normalize, REASONS } from '/src/matching.js';
import { buildReport, failedMatches } from '/src/report.js';
import { allTracks, filterSongs, readOrganized, recordCopied, ORGANIZED_KEY } from '/src/organizing.js';

const STEPS = ['Playlist', 'Artists', 'Review', 'Confirm', 'Results'];
const SAVE_KEY = 'artist-playlist-sorter/v1';

const state = {
  step: 1,
  status: null, // { state, message, ... } from /api/status
  playlists: null, // null = loading
  playlistsError: null,
  playlistId: '',
  tracksLoading: false,
  tracksError: null,
  sourceName: '',
  tracks: [],
  search: '',
  songSearch: '',
  mode: 'artists',
  showOrganized: false,
  organized: {},
  storageWarning: '',
  selected: new Set(),
  includeFeatured: false,
  duplicates: 'skip',
  removed: new Set(),
  extraSelections: [new Set(), new Set()],
  extraNames: ['', ''],
  batchReports: null,
  onlyPositions: null, // set when retrying only failed tracks
  destName: '',
  previewOnly: false,
  copying: false,
  copyError: null,
  report: null,
  previewShown: null,
};

const $app = document.getElementById('app');
const $dialog = document.getElementById('confirm-dialog');
const previewAudio = document.getElementById('preview-audio');
let previewRequest = 0;

function closePreview() {
  previewRequest++;
  previewAudio.pause();
  previewAudio.removeAttribute('src');
  previewAudio.load();
  document.getElementById('preview-player').hidden = true;
}

async function playPreview(position) {
  const track = state.tracks[position];
  if (!track) return;
  closePreview();
  const request = previewRequest;
  const panel = document.getElementById('preview-player');
  const message = document.getElementById('preview-message');
  const link = document.getElementById('preview-source');
  panel.hidden = false;
  link.hidden = true;
  message.textContent = `Finding preview: ${track.title} — ${track.artist}…`;
  try {
    await api('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (request !== previewRequest) return;
    const { preview } = await api('/api/preview?' + new URLSearchParams({ title: track.title || '', artist: track.artist || '', album: track.album || '' }));
    if (request !== previewRequest) return;
    if (!preview) { message.textContent = 'Preview unavailable for this song/version.'; return; }
    message.textContent = `${preview.title} — ${preview.artist} · Apple Music preview`;
    link.href = preview.trackUrl;
    link.hidden = false;
    previewAudio.src = preview.previewUrl;
    try { await previewAudio.play(); }
    catch { if (request === previewRequest) message.textContent += ' · Press Play below to listen.'; }
  } catch (error) {
    if (request === previewRequest) message.textContent = error.message;
  }
}
document.getElementById('close-preview').addEventListener('click', closePreview);
document.getElementById('pause-music').addEventListener('click', async () => {
  previewAudio.pause();
  try {
    await api('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    document.getElementById('preview-message').textContent = 'Playback paused.';
  } catch (e) { document.getElementById('preview-message').textContent = e.message; }
});
previewAudio.addEventListener('error', () => {
  if (previewAudio.hasAttribute('src')) document.getElementById('preview-message').textContent = 'This preview could not be played. Try another song.';
});

// ---------- helpers ----------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function api(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new ApiError('network', 'Could not reach the helper. Make sure it is running (npm start) and this page was opened from it.');
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(e?.code || 'failed', e?.message || `Helper returned HTTP ${res.status}.`);
  }
  return body;
}

function save() {
  try {
    sessionStorage.setItem(SAVE_KEY, JSON.stringify({
      playlistId: state.playlistId,
      selected: [...state.selected],
      includeFeatured: state.includeFeatured,
      duplicates: state.duplicates,
    }));
  } catch { /* storage unavailable: fine */ }
}
function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SAVE_KEY) || 'null');
    if (!s) return;
    state.playlistId = s.playlistId || '';
    state.selected = new Set(s.selected || []);
    state.includeFeatured = !!s.includeFeatured;
    state.duplicates = s.duplicates === 'allow' ? 'allow' : 'skip';
  } catch { /* ignore corrupt data */ }
}

function candidates() {
  const result = state.mode === 'songs' ? allTracks(state.tracks, state.duplicates) : matchTracks(state.tracks, [...state.selected], {
    includeFeatured: state.includeFeatured,
    duplicates: state.duplicates,
  });
  const hidden = new Set(state.organized[state.playlistId] || []);
  const visible = (m) => state.showOrganized || !hidden.has(String(m.track.id));
  return { matches: result.matches.filter(visible), skippedDuplicates: result.skippedDuplicates.filter(visible) };
}

function computeMatches() {
  const result = candidates();
  let matches = result.matches.filter((m) => !state.removed.has(m.position));
  if (state.onlyPositions) matches = matches.filter((m) => state.onlyPositions.has(m.position));
  return { matches, skippedDuplicates: result.skippedDuplicates };
}

function playlistBatches() {
  const first = computeMatches();
  const available = candidates().matches;
  return [
    { name: state.destName, matches: first.matches, skippedDuplicates: first.skippedDuplicates },
    ...state.extraSelections.map((selected, i) => ({ name: state.extraNames[i], matches: available.filter(m => selected.has(m.position)), skippedDuplicates: [] })),
  ].filter(b => b.matches.length);
}

function batchProblem() {
  const batches = playlistBatches();
  if (!batches.length) return 'Select at least one song.';
  for (const b of batches) {
    const problem = nameProblem(b.name);
    if (problem) return problem;
    if (b.matches.some(m => !m.track.id)) return 'A selected song has no Music ID. Deselect it to continue.';
  }
  if (new Set(batches.map(b => normalize(b.name))).size !== batches.length) return 'Give each playlist a different name.';
  return null;
}

async function playLibrarySong(position) {
  const track = state.tracks[position];
  if (!track) return;
  closePreview();
  const request = previewRequest;
  const panel = document.getElementById('preview-player');
  panel.hidden = false;
  document.getElementById('preview-source').hidden = true;
  const message = document.getElementById('preview-message');
  message.textContent = `Playing in Apple Music: ${track.title} — ${track.artist}…`;
  try {
    await api('/api/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: state.playlistId, position, id: track.id }) });
    if (request === previewRequest) message.textContent = `Playing in Apple Music: ${track.title} — ${track.artist}`;
  } catch (e) { if (request === previewRequest) message.textContent = e.message; }
}

function uniqueName(base) {
  const taken = new Set((state.playlists || []).map((p) => normalize(p.name)));
  if (!taken.has(normalize(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(normalize(candidate))) return candidate;
  }
  return `${base} (${Date.now()})`;
}

function defaultDestName() {
  if (state.mode === 'songs') return uniqueName(`${state.sourceName} — Selected songs`.slice(0, 190));
  const names = [...state.selected];
  const who = names.length <= 2 ? names.join(' + ') : `${names.length} artists`;
  return uniqueName(`${who} (from ${state.sourceName})`.slice(0, 190));
}

function nameProblem(name) {
  const t = name.trim();
  if (!t) return 'Enter a name for the new playlist.';
  if (t.length > 200) return 'That name is too long (200 characters max).';
  if ((state.playlists || []).some((p) => normalize(p.name) === normalize(t))) {
    return 'A playlist with that name already exists. This app never overwrites playlists, so pick a different name.';
  }
  return null;
}

const visiblePlaylists = () =>
  (state.playlists || []).filter((p) => !p.specialKind || p.specialKind === 'none');

// ---------- connection / status ----------

function renderConnection() {
  const el = document.getElementById('connection');
  const s = state.status;
  if (!s) { el.className = 'pill pill-muted'; el.textContent = 'Checking Music…'; return; }
  el.className = 'pill ' + (s.state === 'ready' ? 'pill-ok' : 'pill-bad');
  el.textContent = {
    ready: 'Connected to Music',
    'music-closed': 'Music is closed',
    'permission-denied': 'Permission needed',
    'unsupported-platform': 'Not running on a Mac',
  }[s.state] || 'Music unavailable';
}

function statusHelp() {
  const s = state.status;
  if (!s || s.state === 'ready') return '';
  const steps = {
    'music-closed': '<p>Open the Music app on this Mac, then press Retry.</p>',
    'permission-denied': `<ol>
        <li>Open <b>System Settings → Privacy &amp; Security → Automation</b>.</li>
        <li>Find the app that started this helper (for example <b>Terminal</b>) and switch on <b>Music</b>.</li>
        <li>Come back here and press Retry.</li>
      </ol>`,
    'unsupported-platform': '<p>This helper must run on the Mac that has your Music library: <code>npm start</code>, then open the address it prints. An iPhone can show this page but cannot make changes by itself.</p>',
  }[s.state] || '';
  return `<div class="banner banner-error" role="alert"><b>${esc(s.message || 'Music is unavailable.')}</b>${steps}
    <p><button class="btn btn-sm" data-action="retry-status">Retry</button></p></div>`;
}

async function refreshStatus() {
  try { state.status = await api('/api/status'); }
  catch (e) { state.status = { state: 'helper-unreachable', message: e.message }; }
  renderConnection();
}

async function loadPlaylists() {
  state.playlists = null;
  state.playlistsError = null;
  render();
  await refreshStatus();
  if (state.status.state !== 'ready') {
    state.playlists = [];
    render();
    return;
  }
  try {
    state.playlists = (await api('/api/playlists')).playlists;
    if (!state.playlists.some((p) => p.id === state.playlistId)) state.playlistId = '';
  } catch (e) {
    state.playlists = [];
    state.playlistsError = e;
    await refreshStatus();
  }
  render();
}

// ---------- screens ----------

function renderSteps() {
  document.getElementById('steps').innerHTML = STEPS.map((label, i) =>
    `<li ${state.step === i + 1 ? 'aria-current="step"' : ''}>${i + 1}. ${label}</li>`).join('');
}

function sourceCard() {
  return `<div class="card source"><span class="tag tag-source">Source playlist (will not change)</span>
    <p class="name">${esc(state.sourceName)}</p></div>`;
}

function screenPlaylist() {
  let body;
  if (state.playlists === null) {
    body = '<div class="skeleton"></div><div class="skeleton"></div><p class="muted">Loading playlists from Music…</p>';
  } else if (state.status && state.status.state !== 'ready') {
    body = statusHelp() || `<div class="banner banner-error" role="alert">${esc(state.status?.message)}</div>`;
  } else if (state.playlistsError) {
    body = `<div class="banner banner-error" role="alert"><b>Could not read playlists.</b> ${esc(state.playlistsError.message)}
      <p><button class="btn btn-sm" data-action="reload">Try again</button></p></div>`;
  } else if (visiblePlaylists().length === 0) {
    body = `<div class="empty"><p><b>No playlists found.</b></p><p>Create a playlist in the Music app first, then reload.</p>
      <button class="btn" data-action="reload">Reload</button></div>`;
  } else {
    body = `<label for="playlist">Source playlist</label>
      <select id="playlist">
        <option value="">Choose a playlist…</option>
        ${visiblePlaylists().map((p) => `<option value="${esc(p.id)}" ${p.id === state.playlistId ? 'selected' : ''}>${esc(p.name)}${p.trackCount != null ? ` (${p.trackCount})` : ''}${p.smart ? ' · smart' : ''}</option>`).join('')}
      </select>
      ${state.tracksError ? `<div class="banner banner-error" role="alert">${esc(state.tracksError.message)}</div>` : ''}
      ${state.tracksLoading ? '<div class="skeleton"></div><p class="muted">Reading tracks…</p>' : ''}`;
  }
  return `<h2 tabindex="-1">Choose a source playlist</h2>
    <p class="muted">Tracks are copied into a brand-new playlist. The playlist you pick here is only read.</p>
    ${body}
    <div class="actions"><span class="spacer"></span>
      <button class="btn btn-primary" data-action="to-artists" ${!state.playlistId || state.tracksLoading ? 'disabled' : ''}>Continue</button></div>`;
}

function screenArtists() {
  const artists = listArtists(state.tracks, { includeFeatured: state.includeFeatured });
  const q = normalize(state.search);
  const shown = q ? artists.filter((a) => normalize(a.name).includes(q)) : artists;
  return `<h2 tabindex="-1">Choose artists</h2>
    ${sourceCard()}
    <div class="card"><p>Want to pick songs directly?</p><button class="btn" data-action="browse-songs">Browse all songs</button></div>
    <label for="search">Search artists</label>
    <input type="search" id="search" value="${esc(state.search)}" placeholder="Type to filter" autocomplete="off">
    <label class="check"><input type="checkbox" id="featured" ${state.includeFeatured ? 'checked' : ''}>
      Also include tracks where the artist is only featured</label>
    <p class="muted" id="artist-summary"></p>
    <ul class="list" id="artist-list" aria-label="Artists"></ul>
    <div class="actions"><button class="btn" data-action="back">Back</button>
      <button class="btn btn-primary" id="to-review" data-action="to-review">Continue</button></div>`;
}

function renderArtistList() {
  const list = document.getElementById('artist-list');
  if (!list) return;
  const artists = listArtists(state.tracks, { includeFeatured: state.includeFeatured });
  const q = normalize(state.search);
  const shown = q ? artists.filter((a) => normalize(a.name).includes(q)) : artists;
  if (state.tracks.length === 0) {
    list.innerHTML = '<li class="empty">This playlist has no tracks. Go back and choose another.</li>';
  } else if (shown.length === 0) {
    list.innerHTML = '<li class="empty">No artists match your search.</li>';
  } else {
    list.innerHTML = shown.map((a, i) => `<li><label for="a${i}">
      <input type="checkbox" id="a${i}" data-artist="${esc(a.name)}" ${state.selected.has(a.name) ? 'checked' : ''}>
      <span>${esc(a.name || '(no artist)')}</span><span class="count">${a.trackCount} track${a.trackCount === 1 ? '' : 's'}</span></label></li>`).join('');
  }
  document.getElementById('artist-summary').textContent =
    `${state.selected.size} selected · ${artists.length} artists · ${state.tracks.length} tracks in playlist`;
  document.getElementById('to-review').disabled = state.selected.size === 0;
}

function trackRow(m, removable) {
  const badges = [
    m.matchType === 'featured' ? '<span class="badge badge-info">featured</span>' : '',
    m.reasons.includes(REASONS.COLLAB_NAME) ? '<span class="badge badge-warn" title="Artist name contains &amp; / and / comma, so this may be a different act">check match</span>' : '',
    m.reasons.includes(REASONS.MISSING_ARTIST) ? '<span class="badge badge-warn">no artist</span>' : '',
    m.reasons.includes(REASONS.VERSION_VARIANT) ? '<span class="badge badge-info" title="Live, remix, clean, remaster… versions are not treated as identical">version</span>' : '',
    !m.track.id ? '<span class="badge badge-warn">no ID</span>' : '',
  ].join('');
  return `<li class="track"><span class="pos">${m.position + 1}</span>
    <span class="meta"><span class="title">${esc(m.track.title)}${badges}</span>
      <span class="sub">${esc(m.track.artist)}${m.track.album ? ' · ' + esc(m.track.album) : ''}</span></span>
    <button class="btn btn-sm" data-action="preview-song" data-position="${m.position}" aria-label="Preview ${esc(m.track.title)}">▶ Preview</button>
    <button class="btn btn-sm" data-action="play-song" data-position="${m.position}">▶ Play in Music</button>
    ${removable ? [0, 1, 2].map(i => `<button class="btn btn-sm playlist-toggle" data-action="toggle-playlist" data-slot="${i}" data-position="${m.position}" aria-pressed="${i === 0 ? !state.removed.has(m.position) : state.extraSelections[i - 1].has(m.position)}" aria-label="Include ${esc(m.track.title)} in playlist ${i + 1}">Playlist ${i + 1}</button>`).join('') : ''}</li>`;
}

function screenReview() {
  const { matches, skippedDuplicates } = computeMatches();
  const available = candidates().matches;
  const shown = filterSongs(available, state.songSearch);
  const organizedCount = state.tracks.filter(t => (state.organized[state.playlistId] || []).includes(String(t.id))).length;
  const uncertain = matches.filter((m) => m.uncertain).length;
  const noId = playlistBatches().flatMap(b => b.matches).filter(m => !m.track.id).length;
  return `<h2 tabindex="-1">Review matching songs</h2>
    ${sourceCard()}
    <label for="song-search">Search songs or artists</label>
    <input type="search" id="song-search" value="${esc(state.songSearch)}" placeholder="Song title, artist, or album" autocomplete="off">
    <label class="check"><input type="checkbox" id="show-organized" ${state.showOrganized ? 'checked' : ''}>Show organized songs (${organizedCount})</label>
    <p class="muted">Organized songs are hidden here after successful copying. They stay in Apple Music. This progress is saved only in this browser on this Mac.</p>
    ${state.storageWarning ? `<p role="alert">${esc(state.storageWarning)}</p>` : ''}
    ${organizedCount ? '<button class="btn btn-sm" data-action="reset-organized">Reset organizing progress for this playlist</button>' : ''}
    <div class="card"><p>Choose up to three new playlists. A highlighted button includes that song; click again to remove it. Songs can go in more than one.</p>
    ${[0, 1, 2].map(i => `<label for="playlist-name-${i}">Playlist ${i + 1} name</label><input id="playlist-name-${i}" data-playlist-name="${i}" value="${esc(i === 0 ? state.destName : state.extraNames[i - 1])}" maxlength="200" placeholder="Name playlist ${i + 1}"><p class="muted">${i === 0 ? matches.length : available.filter(m => state.extraSelections[i - 1].has(m.position)).length} songs selected</p><button class="btn btn-sm" data-action="bulk-playlist" data-slot="${i}" data-checked="true">Select all shown for ${i + 1}</button> <button class="btn btn-sm" data-action="bulk-playlist" data-slot="${i}" data-checked="false">Clear shown for ${i + 1}</button>`).join('')}</div>
    ${uncertain ? `<div class="banner banner-warn" role="status"><b>${uncertain} uncertain match${uncertain === 1 ? '' : 'es'}.</b> Their artist name has more than one name in it (for example “A &amp; B”). Check them, and remove any that don't belong.</div>` : ''}
    ${noId ? `<div class="banner banner-error" role="alert"><b>${noId} track${noId === 1 ? ' has' : 's have'} no Apple Music ID</b> and can't be copied safely. Remove ${noId === 1 ? 'it' : 'them'} to continue.</div>` : ''}
    <label for="dups">Duplicate tracks</label>
    <select id="dups">
      <option value="skip" ${state.duplicates === 'skip' ? 'selected' : ''}>Skip duplicates (keep the first copy)</option>
      <option value="allow" ${state.duplicates === 'allow' ? 'selected' : ''}>Allow duplicates</option>
    </select>
    ${skippedDuplicates.length ? `<p class="muted">${skippedDuplicates.length} duplicate${skippedDuplicates.length === 1 ? '' : 's'} will be skipped.</p>` : ''}
    <p class="muted">${shown.length} songs shown. Search filters the list without clearing your selections.</p>
    ${shown.length === 0 ? '<div class="empty"><p>No songs shown. Clear the search, show organized songs, or change artists.</p></div>' : ''}
    <ul class="list" aria-label="Matching tracks">${shown.map((m) => trackRow(m, true)).join('')}</ul>
    <div class="actions"><button class="btn" data-action="back">Back</button>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-action="to-confirm" ${playlistBatches().length === 0 || noId ? 'disabled' : ''}>Continue</button></div>`;
}

function screenConfirm() {
  const { matches } = computeMatches();
  const problem = batchProblem();
  const preview = state.previewOnly;
  return `<h2 tabindex="-1">Name and confirm</h2>
    ${sourceCard()}
    ${playlistBatches().map(b => `<div class="card dest"><b>${esc(b.name)}</b><p>${b.matches.length} songs will be copied.</p></div>`).join('')}
    <div class="card dest" hidden><span class="tag tag-dest">Playlist 1 name</span>
      <label for="dest">Playlist name</label>
      <input type="text" id="dest" value="${esc(state.destName)}" maxlength="200" autocomplete="off" ${state.copying ? 'disabled' : ''}
        aria-describedby="dest-problem">
      <p class="banner banner-error" id="dest-problem" role="alert" ${problem ? '' : 'hidden'}>${esc(problem || '')}</p>
      <p class="muted">Go Back to change all three names and selections. Playlists with no selections are skipped.</p></div>
    <div class="banner banner-info">Your source playlist, <b>${esc(state.sourceName)}</b>, will <b>not</b> be changed. Nothing is deleted.</div>
    <label class="check"><input type="checkbox" id="preview" ${preview ? 'checked' : ''} ${state.copying ? 'disabled' : ''}>
      Preview only: don't create anything in Music</label>
    ${state.copyError ? copyErrorBanner() : ''}
    <div class="actions"><button class="btn" data-action="back" ${state.copying ? 'disabled' : ''}>Back</button>
      <button class="btn btn-primary" id="copy-btn" data-action="copy" ${problem || state.copying ? 'disabled' : ''}>
        ${state.copying ? 'Copying… please wait' : preview ? 'Show preview' : 'Copy Tracks'}</button></div>`;
}

function copyErrorBanner() {
  const e = state.copyError;
  const safe = e.code === 'invalid' || e.code === 'busy';
  return `<div class="banner banner-error" role="alert"><b>${esc(e.message)}</b>
    ${safe ? '<p>Nothing was written to Music.</p>'
      : `<p>The copy may have been interrupted. <b>Check the Music app for a playlist named “${esc(state.destName.trim())}”</b> before trying again; if it exists, choose a different name or delete that playlist yourself.</p>`}</div>`;
}

function screenResults() {
  const r = state.report;
  if (state.batchReports) return `<h2 tabindex="-1">Results</h2>
    ${state.storageWarning ? `<p role="alert">${esc(state.storageWarning)}</p>` : ''}
    ${state.batchReports.map(({ name, report, error }) => `<div class="card"><h3>${esc(name)}</h3>${error ? `<p role="alert">${esc(error)} Check this playlist in Music before retrying; its result could not be verified.</p>` : `<p>${report.copiedCount} copied · ${report.failedCount} failed</p>${report.aborted ? `<p role="alert">${esc(report.aborted)}</p>` : ''}${report.failed.length ? `<ul>${report.failed.map(f => `<li>${esc(f.track.title)} — ${esc(f.reason)}</li>`).join('')}</ul>` : ''}<p>${report.sourceUnchanged === true ? 'Source playlist checked: unchanged.' : 'Check the source playlist in Music; it could not be confirmed unchanged.'}</p>`}</div>`).join('')}
    <p>Successfully copied songs are saved as organized. Check each result above before continuing.</p>
    <button class="btn btn-primary" data-action="restart">Start another</button>`;
  if (state.previewShown) {
    const { matches, skippedDuplicates } = state.previewShown;
    return `<h2 tabindex="-1">Preview only</h2>
      <div class="banner banner-info" role="status"><b>Nothing was written to Music.</b> This is what would be copied.</div>
      ${sourceCard()}
      <div class="stats"><div class="stat"><b>${matches.length}</b>would copy</div><div class="stat"><b>${skippedDuplicates.length}</b>duplicates skipped</div><div class="stat"><b>0</b>written</div></div>
      <ul class="list">${matches.map((m) => trackRow(m, false)).join('')}</ul>
      <div class="actions"><button class="btn" data-action="back-to-confirm">Back to confirm</button>
        <button class="btn btn-primary" data-action="restart">Start over</button></div>`;
  }
  const head = {
    success: ['banner-ok', 'All tracks copied.'],
    partial: ['banner-warn', 'Partly copied. Some tracks did not make it.'],
    failed: ['banner-error', 'Nothing was copied.'],
  }[r.status];
  const unchanged = r.sourceUnchanged === true
    ? '<div class="banner banner-ok">Checked: the source playlist has the same tracks in the same order as before.</div>'
    : r.sourceUnchanged === false
      ? '<div class="banner banner-error" role="alert"><b>Warning: the source playlist looks different from before.</b> This app never edits it, but please open Music and check it.</div>'
      : '<div class="banner banner-warn">The helper could not verify that the source playlist is unchanged. Please check it in Music.</div>';
  return `<h2 tabindex="-1">Results</h2>
    ${state.storageWarning ? `<p role="alert">${esc(state.storageWarning)}</p>` : ''}
    <div class="banner ${head[0]}" role="status"><b>${head[1]}</b></div>
    ${r.destination ? `<div class="card dest"><span class="tag tag-dest">New playlist</span><p class="name">${esc(r.destination.name)}</p></div>` : ''}
    <div class="stats"><div class="stat"><b>${r.copiedCount}</b>copied</div><div class="stat"><b>${r.skippedCount}</b>skipped (duplicates)</div><div class="stat"><b>${r.failedCount}</b>failed</div></div>
    ${r.aborted ? `<div class="banner banner-error" role="alert"><b>The copy stopped early:</b> ${esc(r.aborted)}<p>Make sure Music is open and allowed to be controlled, then retry the failed tracks.</p></div>` : ''}
    ${r.failed.length ? `<h3>Tracks that failed</h3><ul class="list">${r.failed.map((f) => `<li class="track"><span class="pos">${f.position + 1}</span><span class="meta"><span class="title">${esc(f.track.title)}</span><span class="sub">${esc(f.track.artist)}</span><span class="sub"><b>Why:</b> ${esc(f.reason)}</span></span></li>`).join('')}</ul>` : ''}
    ${unchanged}
    ${r.copiedCount ? '<p class="muted">With Sync Library on, the new playlist should appear on your iPhone after a short while.</p>' : ''}
    <div class="actions">
      ${r.failed.length ? '<button class="btn" data-action="retry-failed">Retry failed tracks in a new playlist</button>' : ''}
      <span class="spacer"></span>
      <button class="btn btn-primary" data-action="restart">Start another</button></div>`;
}

// ---------- render ----------

function render() {
  document.getElementById('clear-saved').disabled = state.copying;
  renderSteps();
  renderConnection();
  const screens = { 1: screenPlaylist, 2: screenArtists, 3: screenReview, 4: screenConfirm, 5: screenResults };
  $app.innerHTML = screens[state.step]();
  if (state.step === 2) renderArtistList();
}

function go(step, { focus = true } = {}) {
  closePreview();
  state.step = step;
  render();
  if (focus) $app.querySelector('h2')?.focus();
  window.scrollTo(0, 0);
}

// ---------- actions ----------

async function toArtists() {
  state.tracksError = null;
  state.tracksLoading = true;
  render();
  try {
    const data = await api(`/api/playlists/${encodeURIComponent(state.playlistId)}/tracks`);
    state.tracks = data.tracks;
    state.sourceName = data.name;
    state.removed = new Set();
    state.extraSelections = [new Set(), new Set()];
    state.extraNames = ['', ''];
    state.batchReports = null;
    state.onlyPositions = null;
    state.report = null;
    state.previewShown = null;
    state.search = '';
    state.songSearch = '';
    state.mode = 'artists';
    const known = new Set(listArtists(state.tracks, { includeFeatured: true }).map((a) => a.name));
    state.selected = new Set([...state.selected].filter((n) => known.has(n)));
    state.tracksLoading = false;
    save();
    go(2);
  } catch (e) {
    state.tracksLoading = false;
    state.tracksError = e;
    await refreshStatus();
    render();
  }
}

function toConfirm() {
  state.copyError = null;
  state.previewShown = null;
  if (!state.destName || state.destName === state.autoName) {
    state.autoName = defaultDestName();
    state.destName = state.autoName;
  }
  state.extraNames = state.extraNames.map((name, i) => name || uniqueName(`${state.sourceName} — Playlist ${i + 2}`.slice(0, 190)));
  go(4);
}

function startCopy() {
  if (state.copying) return;
  const { matches } = computeMatches();
  const problem = batchProblem();
  if (problem) return;
  if (state.previewOnly) {
    state.previewShown = { matches: playlistBatches().flatMap(b => b.matches), skippedDuplicates: [] };
    state.report = null;
    go(5);
    return;
  }
  document.getElementById('confirm-body').innerHTML = `
    <div class="card source"><span class="tag tag-source">Source (unchanged)</span><p class="name">${esc(state.sourceName)}</p></div>
    ${playlistBatches().map(b => `<div class="card dest"><p class="name">${esc(b.name.trim())}</p><p>${b.matches.length} songs</p></div>`).join('')}
    <p>This creates a new playlist in your Music library. It can't be cancelled once it starts.</p>`;
  $dialog.returnValue = '';
  $dialog.showModal();
}

async function doCopy() {
  if (state.copying) return;
  if (batchProblem()) return;
  const batches = playlistBatches();
  state.batchReports = [];
  state.copying = true;
  state.copyError = null;
  render();
  for (const batch of batches) {
    try {
      const helperResult = await api('/api/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, sourceId: state.playlistId, destName: batch.name.trim(), tracks: batch.matches.map(m => ({ position: m.position, id: m.track.id })) }) });
      const report = buildReport({ requested: batch.matches, skippedDuplicates: batch.skippedDuplicates, helperResult });
      state.batchReports.push({ name: batch.name, report });
      state.organized = recordCopied(state.organized, state.playlistId, report.copied);
      try { localStorage.setItem(ORGANIZED_KEY, JSON.stringify(state.organized)); }
      catch { state.storageWarning = 'Progress could not be saved. Organized songs may reappear next time.'; }
    } catch (e) {
      state.batchReports.push({ name: batch.name, error: e.message });
    }
  }
  state.copying = false;
  api('/api/playlists').then(p => { state.playlists = p.playlists; }).catch(() => {});
  go(5);
}


function restart() {
  state.extraSelections = [new Set(), new Set()];
  state.extraNames = ['', ''];
  state.batchReports = null;
  state.mode = 'artists';
  state.songSearch = '';
  state.tracks = [];
  state.selected = new Set();
  state.removed = new Set();
  state.onlyPositions = null;
  state.report = null;
  state.previewShown = null;
  state.destName = '';
  state.autoName = '';
  state.previewOnly = false;
  state.copyError = null;
  state.playlistId = '';
  state.step = 1; // leave the results screen BEFORE its data is gone
  save();
  loadPlaylists().then(() => go(1));
}

function retryFailed() {
  const failed = failedMatches(state.report);
  state.onlyPositions = new Set(failed.map((m) => m.position));
  state.removed = new Set();
  state.report = null;
  state.copyError = null;
  state.destName = uniqueName(`${state.destName.trim()} (retry)`);
  state.autoName = '';
  api('/api/playlists').then((p) => { state.playlists = p.playlists; state.destName = uniqueName(state.destName); render(); }).catch(() => {});
  go(4);
}

// ---------- events ----------

$app.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const a = btn.dataset.action;
  if (a === 'play-song') { playLibrarySong(Number(btn.dataset.position)); return; }
  if (a === 'toggle-playlist' || a === 'bulk-playlist') {
    const slot = Number(btn.dataset.slot);
    const positions = a === 'toggle-playlist' ? [Number(btn.dataset.position)] : filterSongs(candidates().matches, state.songSearch).map(m => m.position);
    for (const position of positions) {
      const current = slot === 0 ? !state.removed.has(position) : state.extraSelections[slot - 1].has(position);
      const checked = a === 'toggle-playlist' ? !current : btn.dataset.checked === 'true';
      const set = slot === 0 ? state.removed : state.extraSelections[slot - 1];
      if (slot === 0 ? !checked : checked) set.add(position); else set.delete(position);
    }
    const scroll = window.scrollY;
    render();
    window.scrollTo(0, scroll);
    return;
  }
  if (a === 'preview-song') { playPreview(Number(btn.dataset.position)); return; }
  if (a === 'retry-status' || a === 'reload') loadPlaylists();
  else if (a === 'to-artists') toArtists();
  else if (a === 'to-review' && state.selected.size > 0) {
    if (state.mode !== 'artists') state.removed = new Set();
    state.mode = 'artists'; save(); go(3);
  }
  else if (a === 'browse-songs') { state.mode = 'songs'; state.removed = new Set(state.tracks.map((_, i) => i)); state.songSearch = ''; state.onlyPositions = null; go(3); }
  else if (a === 'to-confirm') toConfirm();
  else if (a === 'back') go(state.step - 1);
  else if (a === 'back-to-confirm') { state.previewShown = null; go(4); }
  else if (a === 'select-all-tracks' || a === 'deselect-all-tracks') {
    for (const m of filterSongs(candidates().matches, state.songSearch)) {
      if (a === 'select-all-tracks') state.removed.delete(m.position); else state.removed.add(m.position);
    }
    render();
  }
  else if (a === 'reset-organized' && window.confirm('Reset the website’s organizing progress for this playlist? Apple Music will not change.')) {
    state.organized = { ...state.organized, [state.playlistId]: [] };
    try { localStorage.setItem(ORGANIZED_KEY, JSON.stringify(state.organized)); } catch { state.storageWarning = 'Progress could not be saved.'; }
    render();
  }
  else if (a === 'copy') startCopy();
  else if (a === 'retry-failed') retryFailed();
  else if (a === 'restart') restart();
});

$app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.playlistName !== undefined) {
    const slot = Number(t.dataset.playlistName);
    if (slot === 0) { state.destName = t.value; state.autoName = ''; }
    else state.extraNames[slot - 1] = t.value;
    return;
  }
  if (t.id === 'search') { state.search = t.value; renderArtistList(); }
  else if (t.id === 'song-search') {
    state.songSearch = t.value;
    const position = t.selectionStart;
    render();
    const input = document.getElementById('song-search');
    input.focus();
    if (position != null) input.setSelectionRange(position, position);
  }
  else if (t.id === 'dest') {
    state.destName = t.value;
    state.autoName = '';
    const problem = batchProblem();
    const el = document.getElementById('dest-problem');
    el.hidden = !problem;
    el.textContent = problem || '';
    document.getElementById('copy-btn').disabled = !!problem || state.copying;
  }
});

$app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'show-organized') { state.showOrganized = t.checked; render(); return; }
  if (t.dataset.trackPosition !== undefined) {
    const position = Number(t.dataset.trackPosition);
    if (t.checked) state.removed.delete(position); else state.removed.add(position);
    render();
    $app.querySelector(`[data-track-position="${position}"]`)?.focus();
    return;
  }
  if (t.id === 'playlist') { state.playlistId = t.value; state.tracksError = null; save(); render(); $app.querySelector('#playlist')?.focus(); }
  else if (t.dataset.artist !== undefined) {
    if (t.checked) state.selected.add(t.dataset.artist); else state.selected.delete(t.dataset.artist);
    save();
    renderArtistList();
  } else if (t.id === 'featured') { state.includeFeatured = t.checked; save(); renderArtistList(); }
  else if (t.id === 'dups') { state.duplicates = t.value; save(); render(); }
  else if (t.id === 'preview') { state.previewOnly = t.checked; render(); }
});

$dialog.addEventListener('close', () => {
  if ($dialog.returnValue === 'ok') doCopy();
});

document.getElementById('clear-saved').addEventListener('click', () => {
  if (state.copying) return;
  try { sessionStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  restart();
});

window.addEventListener('beforeunload', (event) => {
  if (!state.copying) return;
  event.preventDefault();
  event.returnValue = '';
});

try { state.organized = readOrganized(localStorage); } catch { /* storage blocked */ }
load();
loadPlaylists();

