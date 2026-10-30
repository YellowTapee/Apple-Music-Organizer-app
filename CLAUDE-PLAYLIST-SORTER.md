# Apple Music Organizer App — Claude Build Instructions

## Project goal

Build the first focused version of idea #384: an Apple Music Artist Playlist Sorter.

The user should be able to choose an existing Apple Music playlist, select artists, review matching tracks, and copy those tracks into a new playlist while leaving the original playlist completely unchanged.

Build only this focused first version. Do not add unrelated features or overcomplicate the app.

## Technical constraints

The user has:

- An Apple Music subscription
- A Mac and an iPhone
- No paid Apple Developer membership

First investigate the practical free Mac-local approaches:

- AppleScript
- JXA
- macOS Shortcuts

The actual Apple Music library operation may need to run on the Mac. Do not claim that an iPhone-only PWA can directly modify the Apple Music library.

If direct Apple Music access cannot work from a browser, create or plan a local Mac helper instead. Do not fake successful Apple Music operations with demo data.

## Required proof of concept

Before visual polish, test:

- A real 20-track Apple Music playlist
- Two selected artists
- Approximately five expected matching songs
- Creation of a new regular playlist
- Copying the selected songs into the new playlist
- Confirmation that the source playlist is unchanged
- Confirmation that the new playlist can sync to iPhone

Document exactly what works, what permissions are required, and what is blocked.

## Required workflow

### 1. Select source playlist

Include:

- Playlist selector
- Clear source-playlist label
- Loading state
- Empty state
- Error state
- Continue button

### 2. Select artists

Include:

- Searchable artist list
- Multi-select checkboxes
- Track count beside each artist when available
- Primary-artist-only matching by default
- Toggle to include featured artists
- Continue button disabled until an artist is selected
- Back button

### 3. Review matching songs

Include:

- Total matching-track count
- Track title
- Artist
- Album when available
- Original playlist order
- Ability to remove individual tracks
- Warning for uncertain matches
- Duplicate option:
  - Skip duplicates
  - Allow duplicates
- Back and continue buttons

### 4. Create destination playlist

Include:

- Editable new playlist name
- Source playlist name
- Number of selected songs
- Clear warning that the source playlist will not be changed
- One explicit “Copy Tracks” action
- Confirmation immediately before writing
- Loading and disabled states while copying

Do not silently overwrite an existing playlist.

### 5. Results

Show:

- Destination playlist name
- Number copied
- Number skipped
- Number failed
- Track-level failure explanations
- Permission or connection errors
- Retry failed tracks if practical
- Clear success or partial-success state
- Option to begin another operation

## Safety requirements

- Never modify the source playlist.
- Never delete tracks.
- Never silently overwrite a playlist.
- Require confirmation before writing.
- Make source and destination visually distinct.
- Prevent double submissions.
- Show honest errors.
- Do not claim success unless the real operation succeeded.
- Use preview/test mode when practical.
- Do not use fake data as if it came from Apple Music.

## Matching rules

Start simple and predictable:

- Primary artist matching is the default.
- Featured artists are excluded by default.
- The user may explicitly include featured artists.
- Preserve source playlist order.
- Allow manual removal of individual tracks.
- Keep duplicate handling simple.
- Show ambiguous metadata for review.

Do not add advanced matching intelligence until the basic version works.

## Scope exclusions

Do not build these in the first version:

- MusicKit developer integration unless proven necessary
- Cloud accounts or authentication
- Multi-user backend
- Playlist backups
- CSV or JSON export
- Menu-bar integration
- Smart playlists
- Percentage-based artist selection
- Automatic playlist creation for every artist
- Copying directly into existing playlists
- Genre, year, popularity, or duration filters
- Complex history dashboards
- iPhone-only Apple Music control
- Unverified third-party APIs
- Fake success states
- Unfinished placeholder buttons

## UI direction

The UI should be polished but simple:

- Clear step-by-step flow
- One primary action per screen
- Obvious source/destination separation
- Compact layout
- Strong empty, loading, error, and success states
- Reuse sensible components if any are added later
- Avoid unnecessary navigation, dashboards, settings, accounts, or decorative screens

Suggested screens:

1. Select Playlist
2. Select Artists
3. Review Tracks
4. Name and Confirm
5. Results

## Engineering expectations

- Inspect the repository before choosing the architecture.
- Keep the code modular and understandable.
- Do not break existing or future Apple Music organizer functionality.
- Add tests for matching logic and source-playlist protection where possible.
- Handle permissions and partial failures.
- Do not commit tokens, private keys, or credentials.
- Do not add a visible feature that does not work.
- If a capability is blocked, explain the exact blocker instead of disguising it.

## Suggested implementation order

1. Inspect the repository.
2. Decide whether a local Mac helper is required.
3. Test AppleScript, JXA, or Shortcuts.
4. Prove playlist reading.
5. Prove artist matching.
6. Prove new-playlist creation.
7. Prove copying tracks.
8. Verify the source playlist stays unchanged.
9. Build the select/review/confirm/results UI.
10. Connect the UI to the real operation.
11. Test with real small playlists.
12. Fix all broken buttons and states.
13. Polish the interface only after the workflow works.

## Definition of done

Do not call the project complete until:

- A real playlist can be selected, or the limitation is clearly documented.
- Real tracks can be previewed, or the limitation is clearly documented.
- Artists can be selected.
- Featured-artist behavior is clear.
- Matching songs can be reviewed.
- Individual songs can be removed.
- A new playlist can be named.
- The source playlist remains unchanged.
- The destination playlist is created only after confirmation.
- Results accurately report copied, skipped, and failed tracks.
- Errors are understandable.
- Every visible button works.
- The implementation has been tested rather than only visually mocked.

## Priority

The priority is a small, safe, real, reusable Apple Music organizer—not a large collection of unfinished options.
