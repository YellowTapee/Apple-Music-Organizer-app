// JXA: list the user's playlists (read-only).
// Run with: osascript -l JavaScript helper/jxa/list-playlists.js
//
// UNVERIFIED: written without access to a Mac. See docs/VERIFICATION.md.

function run() {
  const Music = Application('Music');
  const pls = Music.userPlaylists;
  const names = pls.name();
  const ids = pls.persistentID();
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const item = { id: ids[i], name: names[i], trackCount: null, specialKind: null, smart: null };
    try { item.trackCount = pls[i].tracks.length; } catch (e) {}
    try { item.specialKind = String(pls[i].specialKind()); } catch (e) {}
    try { item.smart = !!pls[i].smart(); } catch (e) {}
    out.push(item);
  }
  return JSON.stringify(out);
}
