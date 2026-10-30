// JXA: report whether Music is running and whether we may talk to it.
// Run with: osascript -l JavaScript helper/jxa/status.js
//
// UNVERIFIED: written without access to a Mac. See docs/VERIFICATION.md.
// Does not launch Music: .running() only inspects the process list.

function run() {
  const out = { musicRunning: false, permission: 'unknown' };
  try {
    const Music = Application('Music');
    out.musicRunning = Music.running();
    if (!out.musicRunning) return JSON.stringify(out);
    // Any real Apple Event triggers the macOS Automation permission check.
    out.musicVersion = Music.version();
    out.permission = 'granted';
  } catch (e) {
    out.error = String(e);
  }
  return JSON.stringify(out);
}
