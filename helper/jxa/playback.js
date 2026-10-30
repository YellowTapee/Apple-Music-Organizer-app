// Read playback or control the currently loaded song without editing playlists.
function run(argv) {
  const Music = Application('Music');
  const action = argv[0];
  const track = Music.currentTrack;
  if (!track.exists()) throw new Error('No song is loaded in Music. Click Play in Music first.');
  const id = track.persistentID();
  const duration = Number(track.duration()) || 0;
  if (action !== 'status') {
    if (id !== argv[1]) throw new Error('The playing song changed. Try again after the player updates.');
    if (action === 'seek') {
      const seconds = Number(argv[2]);
      if (!Number.isFinite(seconds) || seconds < 0 || !duration || seconds > duration) throw new Error('Invalid song time.');
      Music.playerPosition = seconds;
    } else if (action === 'resume') Music.play();
    else throw new Error('Unknown playback action.');
  }
  return JSON.stringify({ id: id, title: track.name(), artist: track.artist(), duration: duration, position: Number(Music.playerPosition()) || 0, playing: Music.playerState() === 'playing' });
}
