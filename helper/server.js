// Local helper server. Serves the web UI and a small JSON API that wraps the
// Music adapter. Bound to 127.0.0.1 only: nothing on your network, and no
// other website, should be able to drive your library through it.
//
// Start: npm start   ->  http://127.0.0.1:4173

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMusicAdapter, MusicError } from './music-adapter.js';
import { createPreviewLookup } from './previews.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = { '/src/': path.join(ROOT, 'src'), '/': path.join(ROOT, 'web') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export const LIMITS = { maxTracksPerCopy: 5000, maxNameLength: 200, maxBodyBytes: 2 * 1024 * 1024 };

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function errorBody(e) {
  if (e instanceof MusicError) return { error: { code: e.code, message: e.message } };
  return { error: { code: 'failed', message: e.message || 'Unexpected error' } };
}

function statusFor(e) {
  if (e instanceof MusicError) {
    return { 'permission-denied': 403, 'music-closed': 503, 'unsupported-platform': 501, timeout: 504 }[e.code] || 502;
  }
  return 500;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMITS.maxBodyBytes) throw Object.assign(new Error('Request too large'), { http: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Body is not valid JSON'), { http: 400 });
  }
}

export function validateCopyRequest(body, existingNames) {
  const problems = [];
  const name = typeof body.destName === 'string' ? body.destName.trim() : '';
  if (body.confirm !== true) problems.push('Writing requires explicit confirmation (confirm: true).');
  if (typeof body.sourceId !== 'string' || !body.sourceId) problems.push('sourceId is required.');
  if (!name) problems.push('Playlist name cannot be empty.');
  if (name.length > LIMITS.maxNameLength) problems.push(`Playlist name is longer than ${LIMITS.maxNameLength} characters.`);
  if (!Array.isArray(body.tracks) || body.tracks.length === 0) problems.push('Select at least one track.');
  else if (body.tracks.length > LIMITS.maxTracksPerCopy) problems.push(`Too many tracks (max ${LIMITS.maxTracksPerCopy} per copy).`);
  else if (body.tracks.some((t) => !Number.isInteger(t.position) || typeof t.id !== 'string' || !t.id)) {
    problems.push('Every track needs an integer position and a track id.');
  }
  if (name && existingNames.some((n) => n === name)) {
    problems.push(`A playlist named "${name}" already exists. Pick a different name; this app never overwrites playlists.`);
  }
  return { problems, name };
}

export function createServer({ adapter = createMusicAdapter(), port = 4173 } = {}) {
  const previewLookup = createPreviewLookup();
  let writeInFlight = false; // blocks double submissions
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      // DNS-rebinding guard: only answer to our own host names.
      if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: { code: 'bad-host', message: 'Forbidden host' } });

      if (url.pathname.startsWith('/api/')) {
        // Cross-site guard: browsers send Origin on cross-origin requests.
        const origin = req.headers.origin;
        if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) {
          return send(res, 403, { error: { code: 'bad-origin', message: 'Cross-origin requests are not allowed' } });
        }

        if (req.method === 'GET' && url.pathname === '/api/health') {
          return send(res, 200, { app: 'apple-music-organizer', version: 1 });
        }
        if (req.method === 'GET' && url.pathname === '/api/status') {
          return send(res, 200, await adapter.status());
        }
        if (req.method === 'GET' && url.pathname === '/api/preview') {
          try {
            const preview = await previewLookup(Object.fromEntries(url.searchParams));
            return send(res, 200, { preview });
          } catch (error) {
            return send(res, 502, { error: { code: 'preview-unavailable', message: error.message } });
          }
        }
        if (req.method === 'GET' && url.pathname === '/api/playlists') {
          return send(res, 200, { playlists: await adapter.listPlaylists() });
        }
        if (req.method === 'GET' && url.pathname === '/api/playback') {
          return send(res, 200, await adapter.playback());
        }
        if (req.method === 'POST' && (url.pathname === '/api/seek' || url.pathname === '/api/resume')) {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: { code: 'invalid', message: 'Use application/json' } });
          const body = await readJson(req);
          if (writeInFlight) return send(res, 409, { error: { code: 'busy', message: 'Wait for copying to finish.' } });
          if (typeof body.id !== 'string' || !body.id || (url.pathname === '/api/seek' && (!Number.isFinite(body.seconds) || body.seconds < 0))) return send(res, 400, { error: { code: 'invalid', message: 'Choose a valid song time.' } });
          return send(res, 200, await adapter.playback(url.pathname === '/api/seek' ? 'seek' : 'resume', body.id, body.seconds));
        }
        if (req.method === 'POST' && (url.pathname === '/api/play' || url.pathname === '/api/pause')) {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: { code: 'invalid', message: 'Use application/json' } });
          const body = await readJson(req);
          if (writeInFlight) return send(res, 409, { error: { code: 'busy', message: 'Wait for copying to finish before controlling playback.' } });
          if (url.pathname === '/api/pause') return send(res, 200, await adapter.pause());
          if (typeof body.sourceId !== 'string' || !body.sourceId || typeof body.id !== 'string' || !body.id || !Number.isInteger(body.position) || body.position < 0) return send(res, 400, { error: { code: 'invalid', message: 'Select a song with a valid Music ID.' } });
          return send(res, 200, await adapter.playTrack(body));
        }
        const m = url.pathname.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
        if (req.method === 'GET' && m) {
          return send(res, 200, await adapter.readPlaylist(decodeURIComponent(m[1])));
        }
        if (req.method === 'POST' && url.pathname === '/api/copy') {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
            return send(res, 415, { error: { code: 'bad-content-type', message: 'Use application/json' } });
          }
          const body = await readJson(req);
          if (writeInFlight) {
            return send(res, 409, { error: { code: 'busy', message: 'A copy is already in progress. Wait for it to finish.' } });
          }
          writeInFlight = true;
          try {
            const existing = (await adapter.listPlaylists()).map((p) => p.name);
            const { problems, name } = validateCopyRequest(body, existing);
            if (problems.length) return send(res, 400, { error: { code: 'invalid', message: problems.join(' '), problems } });
            const result = await adapter.copyTracks({ sourceId: body.sourceId, destName: name, tracks: body.tracks });
            return send(res, 200, result);
          } finally {
            writeInFlight = false;
          }
        }
        return send(res, 404, { error: { code: 'not-found', message: 'Unknown endpoint' } });
      }

      // Static files (read-only GET).
      if (req.method !== 'GET') return send(res, 405, { error: { code: 'method', message: 'Method not allowed' } });
      let file = null;
      for (const [prefix, dir] of Object.entries(STATIC)) {
        if (url.pathname.startsWith(prefix)) {
          const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(prefix.length);
          const candidate = path.resolve(dir, rel);
          if (candidate.startsWith(dir + path.sep)) file = candidate;
          break;
        }
      }
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      send(res, e.http || statusFor(e), errorBody(e));
    }
  });
  return server;
}

// CLI entry: node helper/server.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4173;
  createServer({ port }).listen(port, '127.0.0.1', () => {
    console.log(`Apple Music Organizer helper running at http://127.0.0.1:${port}`);
    console.log('Library operations run locally. Preview searches contact Apple on demand.');
  });
}

