# Apple Music Organizer App — Claude Build Instructions

## Project goal

Build the first focused version of idea #384: an Apple Music Artist Playlist Sorter.

The user should be able to choose an existing Apple Music playlist, select artists, review matching tracks, and copy those tracks into a new playlist while leaving the original playlist completely unchanged.

Build only this focused first version. Do not add unrelated features or overcomplicate the app.

## Personal-use boundary

This app is only for the owner, Artin, and is being built for his personal Apple Music workflow.

It is not a public multi-user product. Do not add:

- User accounts
- Public sharing
- Teams or collaboration
- Multi-user permissions
- Subscription or payment features
- Public user profiles
- Analytics about other users
- A cloud database for personal Apple Music library data

Prefer local-first processing and local storage. Do not upload the user's Apple Music library data to a server unless a future decision in this chat explicitly requires it.

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

Clearly document the platform boundary:

- The browser interface may run on Mac or iPhone.
- The Mac may need to be awake, authorized, and running Music.
- The iPhone can view playlists after Sync Library, but may not be able to perform the Mac operation.
- The app must show the real connection and permission state.

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
- Connection/permission status
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
- Preview-only mode that does not write to Apple Music
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
- Do not silently overwrite an existing playlist with the same name; ask for confirmation or use a safe unique name

### 5. Results

Show:

- Destination playlist name
- Number copied
- Number skipped
- Number failed
- Track-level failure explanations
- Permission or connection errors with useful next steps
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
- If a new destination playlist is created and something fails, identify exactly which tracks were copied, skipped, or failed.
- Do not attempt to “undo” by changing the source playlist. Cleanup should only concern a newly created destination playlist.

## Matching rules

Start simple and predictable:

- Primary artist matching is the default.
- Featured artists are excluded by default.
- The user may explicitly include featured artists.
- Preserve source playlist order.
- Allow manual removal of individual tracks.
- Keep duplicate handling simple.
- Prefer the same Apple Music track ID when available.
- Otherwise compare title, artist, and album metadata.
- Do not automatically treat live, remix, clean, deluxe, or remastered versions as identical.
- Show ambiguous metadata for review.

Do not add advanced matching intelligence until the basic version works.

## Privacy and data handling

- Prefer local processing.
- Do not send Apple Music library contents to a remote server.
- Do not add an account system.
- Do not store credentials, private keys, or tokens in the repository.
- If local data is saved, explain what is saved and provide a way to clear it.
- Do not collect analytics or personal usage data for this single-user app.

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
- Public sharing or collaboration

## UI direction

The UI should be polished but simple:

- Clear step-by-step flow
- One primary action per screen
- Obvious source/destination separation
- Compact layout
- Strong empty, loading, error, and success states
- Clear permission setup instructions
- Clear preview-only option
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
- Test both empty and populated states.
- Test Apple Music closed, permission denied, no matching songs, duplicate songs, special characters in names, a large playlist, and a failure halfway through copying.
- Treat visual polish as secondary to a real tested workflow.

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

## Future direction

The later #430 Playlist Intersection Finder may become a second tab in this same Apple Music Organizer app. Do not build it now. Keep the structure flexible enough that it can be added later without rewriting the first feature.

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
- Errors are understandable and actionable.
- Permission setup is documented.
- Every visible button works.
- The app remains personal-use and local-first.
- The implementation has been tested rather than only visually mocked.

## Priority

The priority is a small, safe, real, private, reusable Apple Music organizer—not a large collection of unfinished options.
