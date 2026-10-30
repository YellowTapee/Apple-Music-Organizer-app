// JXA: read every track of one playlist, in playlist order (read-only).
// Run with: osascript -l JavaScript helper/jxa/read-playlist.js <playlistPersistentID>
//
// UNVERIFIED: written without access to a Mac. See docs/VERIFICATION.md.

function run(argv) {
  const id = argv[0];
  if (!id) throw new Error('missing playlist id');

  const Music = Application('Music');
  const ids = Music.userPlaylists.persistentID();
  const idx = ids.indexOf(id);
  if (idx < 0) throw new Error('playlist not found: ' + id);

  const pl = Music.userPlaylists[idx];
  const tracks = [];
  const count = pl.tracks.length;
  if (count > 0) {
    // Bulk property reads are far faster than one Apple Event per track.
    const titles = pl.tracks.name();
    const artists = pl.tracks.artist();
    const albums = pl.tracks.album();
    const trackIds = pl.tracks.persistentID();
    for (let i = 0; i < trackIds.length; i++) {
      tracks.push({
        position: i,
        id: trackIds[i],
        title: titles[i],
        artist: artists[i],
        album: albums[i],
      });
    }
  }
  return JSON.stringify({ id: id, name: pl.name(), tracks: tracks });
}
