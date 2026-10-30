// Local Mac launcher. Does not read or write playlists itself.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from './server.js';

const exec = promisify(execFile);
export const APP_ID = 'apple-music-organizer';

export async function probeHelper(url, fetcher = fetch) {
  try {
    const response = await fetcher(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    return response.ok && body.app === APP_ID;
  } catch { return false; }
}

export async function launch({ platform = process.platform, port = 4173, run = exec } = {}) {
  if (platform !== 'darwin') throw new Error('Open Organizer must run on your Mac.');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Install Node.js 20 or newer.');
  const url = `http://127.0.0.1:${port}`;
  await run('open', ['-a', 'Music']);
  if (await probeHelper(url)) {
    await run('open', [url]);
    console.log('Organizer is already running. Opened it in your browser.');
    return null;
  }
  const server = createServer({ port });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch((error) => {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${port} is occupied. Close the older helper or other app using it, then reopen Organizer.`);
    throw error;
  });
  try { await run('open', [url]); }
  catch (error) { server.close(); throw error; }
  console.log(`Organizer is ready: ${url}`);
  console.log('Keep this window open while using Organizer. Close it or press Control-C to stop.');
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch().then((server) => {
    if (!server) return;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.once(signal, () => {
        console.log('Stopping Organizer…');
        server.close();
        // Let an in-progress copy return its report before exiting.
      });
    }
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
