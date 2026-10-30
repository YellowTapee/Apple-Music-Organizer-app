# Apple Music Organizer: Artist Playlist Sorter

A private, local-first tool for one person's Apple Music library. Pick an existing
playlist, pick artists, review the matching songs, and copy them into a **new**
playlist. The source playlist is only ever read.

**Status: initial Mac proof of concept confirmed by the owner.** Reading a real
playlist and copying selected tracks into a new playlist worked; the owner also
confirmed the source stayed unchanged. The website flow and launcher still need
testing on the owner's Mac. iPhone syncing is not yet confirmed.

## Platform boundary (read this first)

- Changing the Apple Music library has to happen **on a Mac**, through a small local
  helper that controls the Music app with macOS scripting (JXA via `osascript`).
- The web page can be opened on the Mac, and can be *viewed* on an iPhone, but an
  iPhone cannot perform the copy by itself. The helper only listens on the Mac itself
  (`127.0.0.1`), by design.
- The Mac must be awake, the Music app must be open, and macOS must allow the app that
  runs the helper (for example Terminal) to control Music.
- The new playlist should reach your iPhone through **Sync Library**. That is
  not yet verified; see the verification doc.
- The app shows the real connection state. If Music is closed, permission is missing, or
  it is running on a non-Mac, it says so and blocks the flow. It never substitutes demo data.

No Apple Developer membership, MusicKit or cloud account is used.

## Run it (on your Mac)

### Listening while selecting

Click **▶ Preview** beside a song. The shared player plays one Apple catalog clip
at a time, with pause and seeking controls. Some songs/versions have no matching
preview; the app says so rather than substituting a differently titled version.
Safari may require pressing Play in the audio controls after the lookup finishes.
Preview lookup sends only the clicked song's title and artist to Apple's Search
API; no library is uploaded. These previews are catalog clips, not full playback.
Previewing never selects a song or marks it organized.

### Picking songs and tracking progress

Choose a source playlist, then either select artists or use **Browse all songs**.
The song review screen shows titles, artists and albums, with individual checkboxes.
Search by artist or song title; selections remain checked as you change the search.
**Select all shown** and **Deselect all shown** affect only the filtered results.
Browse-all starts with nothing selected; artist mode starts with matching songs checked.

After a successful copy, copied-song IDs are saved per source playlist in this
browser's localStorage. Those songs are hidden on later visits. Failed copies and
preview-only runs never mark a song organized. Enable **Show organized songs** to
select those songs again for another playlist. Reset progress from the review screen.
Clearing browser data loses progress; using another browser does not share it.
This does not change the source playlist or delete any song in Apple Music.

Requires Node 20+.

For everyday use, double-click **Open Organizer.command** in Finder. It opens
Music, starts the helper, and opens the website automatically. Keep the Terminal
window it opens running while using the app. No commands are needed after launch.
Closing the browser alone does not stop the helper. Avoid closing the helper
window while a copy is running; wait for its results first.

After pulling this update into an existing checkout, the launcher is ready to use.
If macOS blocks opening it, use Finder's Open action and review the security prompt.
Do not disable macOS security settings globally.

You can also start the website manually:

```bash
npm start
# open http://127.0.0.1:4173
```

### macOS permission setup

The first time the helper talks to Music, macOS asks whether to allow it. If you
miss or deny the prompt:

1. Open **System Settings → Privacy & Security → Automation**.
2. Find the app that launched `npm start` (for example **Terminal** or **iTerm**).
3. Turn on **Music**.
4. Press **Retry** in the app.

## The first thing to do: the real-data proof of concept

Before trusting anything, run the self-test against a real small playlist. Read-only first:

```bash
npm run selftest -- --source "My 20 Track Playlist" --artists "Artist A,Artist B"
```

Then the real write test (creates one new playlist; never touches the source):

```bash
npm run selftest -- --source "My 20 Track Playlist" --artists "Artist A,Artist B" \
  --write --dest "Selftest Copy 1"
```

It prints a report. Paste it back so the results can be recorded in
`docs/VERIFICATION.md`.

## Tests

```bash
npm test                 # 52 unit tests, no dependencies, runs anywhere
python3 test/e2e.py      # 50 browser checks (needs: pip install playwright && playwright install chromium)
```

The browser tests run the real UI and real helper server against an in-memory **fake**
Music library (`test/e2e-fake-server.js`, clearly labelled, test-only). They prove the
UI and its failure handling. They do not prove Apple Music behaviour.

## How it works

```
web/ (UI)  ->  helper/server.js (127.0.0.1 only)  ->  helper/music-adapter.js  ->  osascript + helper/jxa/*.js  ->  Music
                                   |
                src/matching.js, src/report.js   (pure logic, shared by UI and tests)
```

| Path | Purpose |
| --- | --- |
| `src/matching.js` | Artist parsing, primary/featured matching, duplicates, ordering. Pure, never mutates input. |
| `src/report.js` | Turns the helper's raw result into copied / skipped / failed. Success only if every track is positively reported copied. |
| `helper/jxa/*.js` | The only code that touches Music: read playlists, read tracks, create a new playlist and copy. |
| `helper/music-adapter.js` | Runs the scripts, maps errors (permission denied, Music closed, timeout) to clear messages. All Apple Music access sits behind this one interface. |
| `helper/server.js` | Local API + static files. Requires explicit `confirm`, refuses existing names, blocks double submits, rejects cross-origin requests. |
| `web/` | The five screens: Playlist → Artists → Review → Confirm → Results. |
| `helper/selftest.js` | The real-library proof-of-concept runner. |

### Matching rules

- Primary artist only by default. Featured artists ("feat." in the artist or the title) are
  included only if you turn on the toggle.
- Output keeps original playlist order. You can remove individual tracks.
- Duplicates: prefer the Apple Music track ID; otherwise title + artist + album. Live,
  remix, clean, deluxe and remastered versions are **not** treated as the same song.
- A name like "A & B" could be one act or two artists, so it matches "A" but is flagged
  **check match** for you to review. Names with commas (such as "Tyler, The Creator") are
  treated the same way.
- Tracks with no Apple Music ID can't be copied safely, so you must remove them first.

### Safety

- The source playlist is never written to. The only write operations are "create a new
  playlist" and "duplicate a track into that new playlist".
- Each track is re-checked against its ID at its position just before copying; if the
  playlist changed in between, that track fails rather than copying the wrong song.
- The helper compares the source's tracks before and after and reports whether they match.
- Nothing is deleted or overwritten. If the new name already exists, the copy is refused.
- Confirmation is required in the UI and again by the server.
- A failure partway leaves a clear report: exactly which tracks were copied, which failed,
  and which were never attempted. Cleanup concerns only the new playlist, which you can delete yourself in Music.
- Retrying failed tracks creates *another* new playlist (copying into an existing playlist is out of scope).

## Privacy and data

- Library organization stays on your Mac. No analytics or accounts. On-demand
  preview requests send the clicked title/artist to Apple and stream Apple's clip.
- The browser tab remembers only your last playlist choice, selected artist names and two
  options, in `sessionStorage` (cleared when the tab closes, or with "Clear saved
  selections"). Organizing progress separately saves source-playlist and copied-song
  IDs in localStorage until reset. Titles, artists and audio are never stored.
- No credentials or tokens exist in this repo.

## Not included (by design)

Accounts, sharing, MusicKit, backups/export, smart playlists, copying into existing
playlists, genre/year/duration filters, the future playlist-comparison feature (#430).
The matching module is independent of the UI, so a second tab can be added later.

## Known limits

- Max 5,000 tracks per copy; names up to 200 characters.
- Smart playlists can be read as a source; special system playlists are hidden.
- Cancel is possible before confirming; once copying starts it can't be stopped.

# Three-playlist sorting and playback

In song review, name up to three playlists and toggle Playlist 1, Playlist 2,
and Playlist 3 beside each song. Each button is independent. Empty selections
are skipped; the confirmation shows each destination and song count. Copying
runs separately for each destination and reports its own successes and failures.
Only confirmed copied tracks are saved as organized, even after refresh.

Play in Music asks the local Mac Music app to play the exact source track,
checking the track ID first. Pause Music pauses it without leaving the organizer.
Catalog Preview remains available too. Real Mac playback needs verification.

