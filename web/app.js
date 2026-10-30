// UI for the Artist Playlist Sorter. Plain ES modules, no build step.
// All Apple Music access goes through the helper's /api endpoints; nothing here
// invents data. Matching and reporting logic live in /src and are unit-tested.

import { listArtists, matchTracks, normalize, REASONS } from '/src/matching.js';
import { buildReport, failedMatches } from '/src/report.js';

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
  selected: new Set(),
  includeFeatured: false,
  duplicates: 'skip',
  removed: new Set(),
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

function computeMatches() {
  const result = matchTracks(state.tracks, [...state.selected], {
    includeFeatured: state.includeFeatured,
    duplicates: state.duplicates,
  });
  let matches = result.matches.filter((m) => !state.removed.has(m.position));
  if (state.onlyPositions) matches = matches.filter((m) => state.onlyPositions.has(m.position));
  return { matches, skippedDuplicates: result.skippedDuplicates };
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
    ${removable ? `<button class="btn btn-sm" data-action="remove" data-position="${m.position}" aria-label="Remove ${esc(m.track.title)}">Remove</button>` : ''}</li>`;
}

function screenReview() {
  const { matches, skippedDuplicates } = computeMatches();
  const uncertain = matches.filter((m) => m.uncertain).length;
  const noId = matches.filter((m) => !m.track.id).length;
  return `<h2 tabindex="-1">Review matching songs</h2>
    ${sourceCard()}
    <p><b>${matches.length}</b> matching track${matches.length === 1 ? '' : 's'}, in original playlist order.
      ${state.removed.size ? `<span class="muted">${state.removed.size} removed by you.</span>` : ''}</p>
    ${uncertain ? `<div class="banner banner-warn" role="status"><b>${uncertain} uncertain match${uncertain === 1 ? '' : 'es'}.</b> Their artist name has more than one name in it (for example “A &amp; B”). Check them, and remove any that don't belong.</div>` : ''}
    ${noId ? `<div class="banner banner-error" role="alert"><b>${noId} track${noId === 1 ? ' has' : 's have'} no Apple Music ID</b> and can't be copied safely. Remove ${noId === 1 ? 'it' : 'them'} to continue.</div>` : ''}
    <label for="dups">Duplicate tracks</label>
    <select id="dups">
      <option value="skip" ${state.duplicates === 'skip' ? 'selected' : ''}>Skip duplicates (keep the first copy)</option>
      <option value="allow" ${state.duplicates === 'allow' ? 'selected' : ''}>Allow duplicates</option>
    </select>
    ${skippedDuplicates.length ? `<p class="muted">${skippedDuplicates.length} duplicate${skippedDuplicates.length === 1 ? '' : 's'} will be skipped.</p>` : ''}
    ${matches.length === 0
      ? `<div class="empty"><p><b>No songs to copy.</b></p><p>${state.removed.size ? 'You removed every match.' : 'None of the selected artists have tracks in this playlist with the current options.'} Go back to change your selection.</p></div>`
      : `<ul class="list" aria-label="Matching tracks">${matches.map((m) => trackRow(m, true)).join('')}</ul>`}
    <div class="actions"><button class="btn" data-action="back">Back</button>
      ${state.removed.size ? '<button class="btn" data-action="restore">Restore removed</button>' : ''}
      <span class="spacer"></span>
      <button class="btn btn-primary" data-action="to-confirm" ${matches.length === 0 || noId ? 'disabled' : ''}>Continue</button></div>`;
}

function screenConfirm() {
  const { matches } = computeMatches();
  const problem = nameProblem(state.destName);
  const preview = state.previewOnly;
  return `<h2 tabindex="-1">Name and confirm</h2>
    ${sourceCard()}
    <div class="card dest"><span class="tag tag-dest">New playlist (will be created)</span>
      <label for="dest">Playlist name</label>
      <input type="text" id="dest" value="${esc(state.destName)}" maxlength="200" autocomplete="off" ${state.copying ? 'disabled' : ''}
        aria-describedby="dest-problem">
      <p class="banner banner-error" id="dest-problem" role="alert" ${problem ? '' : 'hidden'}>${esc(problem || '')}</p>
      <p><b>${matches.length}</b> song${matches.length === 1 ? '' : 's'} will be copied.${state.onlyPositions ? ' <span class="muted">(retrying only the tracks that failed)</span>' : ''}</p></div>
    <div class="banner banner-info">Your source playlist, <b>${esc(state.sourceName)}</b>, will <b>not</b> be changed. Nothing is deleted.</div>
    <label class="check"><input type="checkbox" id="preview" ${preview ? 'checked' : ''} ${state.copying ? 'disabled' : ''}>
      Preview only: don't create anything in Music</label>
    ${state.copyError ? copyErrorBanner() : ''}
    <div class="actions"><button class="btn" data-action="back" ${state.copying ? 'disabled' : ''}>Back</button>
      <button class="btn btn-primary" id="copy-btn" data-action="copy" ${problem || state.copying || matches.length === 0 ? 'disabled' : ''}>
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
  renderSteps();
  renderConnection();
  const screens = { 1: screenPlaylist, 2: screenArtists, 3: screenReview, 4: screenConfirm, 5: screenResults };
  $app.innerHTML = screens[state.step]();
  if (state.step === 2) renderArtistList();
}

function go(step, { focus = true } = {}) {
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
    state.onlyPositions = null;
    state.report = null;
    state.previewShown = null;
    state.search = '';
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
  go(4);
}

function startCopy() {
  if (state.copying) return;
  const { matches } = computeMatches();
  const problem = nameProblem(state.destName);
  if (problem || matches.length === 0) return;
  if (state.previewOnly) {
    state.previewShown = computeMatches();
    state.report = null;
    go(5);
    return;
  }
  document.getElementById('confirm-body').innerHTML = `
    <div class="card source"><span class="tag tag-source">Source (unchanged)</span><p class="name">${esc(state.sourceName)}</p></div>
    <div class="card dest"><span class="tag tag-dest">New playlist</span><p class="name">${esc(state.destName.trim())}</p>
      <p><b>${matches.length}</b> song${matches.length === 1 ? '' : 's'} will be copied into it.</p></div>
    <p>This creates a new playlist in your Music library. It can't be cancelled once it starts.</p>`;
  $dialog.returnValue = '';
  $dialog.showModal();
}

async function doCopy() {
  if (state.copying) return;
  const { matches, skippedDuplicates } = computeMatches();
  state.copying = true;
  state.copyError = null;
  render();
  try {
    const helperResult = await api('/api/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirm: true,
        sourceId: state.playlistId,
        destName: state.destName.trim(),
        tracks: matches.map((m) => ({ position: m.position, id: m.track.id })),
      }),
    });
    state.report = buildReport({ requested: matches, skippedDuplicates, helperResult });
    state.copying = false;
    // The new playlist now exists; refresh the list so name checks stay correct.
    api('/api/playlists').then((p) => { state.playlists = p.playlists; }).catch(() => {});
    go(5);
  } catch (e) {
    state.copying = false;
    state.copyError = e;
    await refreshStatus();
    render();
  }
}

function restart() {
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
  if (a === 'retry-status' || a === 'reload') loadPlaylists();
  else if (a === 'to-artists') toArtists();
  else if (a === 'to-review' && state.selected.size > 0) { save(); go(3); }
  else if (a === 'to-confirm') toConfirm();
  else if (a === 'back') go(state.step - 1);
  else if (a === 'back-to-confirm') { state.previewShown = null; go(4); }
  else if (a === 'remove') { state.removed.add(Number(btn.dataset.position)); render(); }
  else if (a === 'restore') { state.removed = new Set(); render(); }
  else if (a === 'copy') startCopy();
  else if (a === 'retry-failed') retryFailed();
  else if (a === 'restart') restart();
});

$app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'search') { state.search = t.value; renderArtistList(); }
  else if (t.id === 'dest') {
    state.destName = t.value;
    state.autoName = '';
    const problem = nameProblem(t.value);
    const el = document.getElementById('dest-problem');
    el.hidden = !problem;
    el.textContent = problem || '';
    document.getElementById('copy-btn').disabled = !!problem || state.copying;
  }
});

$app.addEventListener('change', (ev) => {
  const t = ev.target;
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
  try { sessionStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  state.selected = new Set();
  state.playlistId = '';
  render();
});

load();
loadPlaylists();
