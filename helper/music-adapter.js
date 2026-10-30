// The ONLY module that talks to Apple Music. It shells out to osascript (JXA)
// and turns raw output/errors into honest, typed results.
//
// The server and UI depend on the adapter *interface* below, not on osascript:
//   status()                         -> { state, platform, message, ... }
//   listPlaylists()                  -> [{ id, name, trackCount, ... }]
//   readPlaylist(id)                 -> { id, name, tracks: [{position,id,title,artist,album}] }
//   copyTracks({sourceId, destName, tracks}) -> { destination, results, sourceUnchanged, aborted }
//
// Nothing here fabricates data. On a non-Mac platform every call reports
// "unsupported-platform" instead of returning sample content.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const JXA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'jxa');
const READ_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 10 * 60_000;

export class MusicError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'MusicError';
    this.code = code; // 'unsupported-platform' | 'music-closed' | 'permission-denied' | 'timeout' | 'failed'
    this.detail = detail;
  }
}

/** Map raw osascript stderr to a typed error with an actionable message. */
export function classifyError(stderr) {
  const text = String(stderr || '');
  if (/-1743|not authori[sz]ed to send apple events/i.test(text)) {
    return new MusicError(
      'permission-denied',
      'macOS has not allowed this app to control Music. Open System Settings > Privacy & Security > Automation, and enable Music for the app that is running this helper (for example Terminal). Then try again.',
      text,
    );
  }
  if (/-600|application isn.t running|not running/i.test(text)) {
    return new MusicError('music-closed', 'The Music app is not running. Open Music, then try again.', text);
  }
  return new MusicError('failed', 'Music reported an error: ' + (text.trim().split('\n')[0] || 'unknown error'), text);
}

function defaultExec(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', file, ...args],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (err.killed || err.signal === 'SIGTERM') {
            return reject(new MusicError('timeout', 'Music did not respond in time.', String(err)));
          }
          return reject(classifyError(stderr || String(err)));
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * @param {object} [deps] for tests only: { platform, exec }
 */
export function createMusicAdapter({ platform = process.platform, exec = defaultExec } = {}) {
  const isMac = platform === 'darwin';

  function requireMac() {
    if (!isMac) {
      throw new MusicError(
        'unsupported-platform',
        'Apple Music control only works on a Mac. This helper is running on ' + platform + '. Run it on the Mac that has your Music library.',
      );
    }
  }

  async function runJson(script, args, timeoutMs = READ_TIMEOUT_MS) {
    requireMac();
    const stdout = await exec(path.join(JXA_DIR, script), args, timeoutMs);
    try {
      return JSON.parse(stdout);
    } catch {
      throw new MusicError('failed', 'Music helper returned unreadable output.', stdout);
    }
  }

  return {
    async status() {
      if (!isMac) {
        return {
          state: 'unsupported-platform',
          platform,
          musicRunning: false,
          message: 'Apple Music control only works on a Mac. Run this helper on your Mac.',
        };
      }
      try {
        const s = await runJson('status.js', []);
        if (s.error) throw classifyError(s.error);
        if (!s.musicRunning) {
          return { state: 'music-closed', platform, musicRunning: false, message: 'Open the Music app to continue.' };
        }
        return { state: 'ready', platform, musicRunning: true, musicVersion: s.musicVersion, message: 'Connected to Music.' };
      } catch (e) {
        if (e instanceof MusicError) {
          return { state: e.code, platform, musicRunning: e.code !== 'music-closed', message: e.message };
        }
        throw e;
      }
    },

    async listPlaylists() {
      return runJson('list-playlists.js', []);
    },

    async readPlaylist(id) {
      return runJson('read-playlist.js', [String(id)]);
    },

    async playTrack({ sourceId, position, id }) {
      return runJson('play-track.js', [String(sourceId), String(position), String(id)]);
    },

    async pause() {
      return runJson('pause.js', []);
    },

    async playback(action = 'status', id = '', seconds = 0) {
      return runJson('playback.js', [action, String(id), String(seconds)]);
    },

    async copyTracks({ sourceId, destName, tracks }) {
      const payload = tracks.map((t) => ({ position: t.position, id: t.id }));
      return runJson('copy-tracks.js', [String(sourceId), String(destName), JSON.stringify(payload)], WRITE_TIMEOUT_MS);
    },
  };
}

