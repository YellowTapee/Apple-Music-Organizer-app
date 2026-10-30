// Play the exact source track, verifying its identity before playback.
function run(argv) {
  const Music = Application('Music');
  const index = Music.userPlaylists.persistentID().indexOf(argv[0]);
  if (index < 0) throw new Error('Source playlist no longer exists. Reload the organizer.');
  const playlist = Music.userPlaylists[index];
  const position = Number(argv[1]);
  if (!Number.isInteger(position) || position < 0 || position >= playlist.tracks.length) throw new Error('Song position changed. Reload the organizer.');
  const track = playlist.tracks[position];
  if (track.persistentID() !== argv[2]) throw new Error('Source playlist changed. Reload the organizer before playing.');
  Music.play(track);
  return JSON.stringify({ playing: true });
}
