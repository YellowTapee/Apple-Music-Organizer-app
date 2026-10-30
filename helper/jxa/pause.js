function run() {
  Application('Music').pause();
  return JSON.stringify({ paused: true });
}
