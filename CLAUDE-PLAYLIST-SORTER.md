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

## Claude's complete responsibility

Claude should handle the initial implementation across the following areas.

### Repository and architecture

- Inspect every relevant existing file before changing the project.
- Identify the current framework, build system, entry points, styling system, and deployment setup.
- Preserve the repository's existing conventions where reasonable.
- Choose a minimal architecture suitable for a private single-user app.
- Keep Apple Music integration isolated behind a clear adapter/service boundary.
- Keep the future #430 playlist-comparison feature possible without building it now.
- Avoid introducing a backend, account system, or dependency that is not necessary.
- Add a clear local development and testing README section if missing.
- Keep the app easy for another developer to understand.

### UI and design

- Build the full select, review, confirm, and results flow.
- Create polished Mac and iPhone-responsive layouts.
- Use accessible labels, keyboard navigation, focus states, and sufficient contrast.
- Make primary and destructive actions visually distinct.
- Add loading skeletons or clear loading indicators where useful.
- Add empty states that explain what the user should do next.
- Add actionable error messages rather than generic errors.
- Make the source playlist and new destination playlist visually unmistakable.
- Keep copy concise and understandable.
- Avoid decorative complexity, unnecessary dashboards, and fake statistics.

### Frontend behavior

- Implement playlist, artist, track, selection, and operation-result state.
- Preserve selections when moving backward through the flow.
- Disable invalid actions.
- Prevent double submissions.
- Handle cancellation safely.
- Handle partial success without losing the operation report.
- Keep preview mode separate from write mode.
- Validate playlist names and selected-track counts.
- Avoid losing data during refreshes or errors.
- Make retry behavior safe and explicit.

### Apple Music and Mac-helper work

- Investigate AppleScript, JXA, and Shortcuts.
- Prototype the smallest real playlist-reading operation.
- Prototype artist matching using real metadata.
- Prototype creation of a new regular playlist.
- Prototype copying tracks without modifying the source.
- Detect whether Music is open and whether permission is available.
- Produce clear machine-readable results for copied, skipped, and failed tracks.
- Isolate platform-specific code from the UI.
- Document exact macOS permissions and setup steps.
- If a browser cannot perform an operation, make that limitation visible and provide the correct local-helper path.
- Never simulate a successful write as if it were real.

### Data and matching logic

- Normalize artist/title/album metadata safely.
- Prefer stable Apple Music identifiers where available.
- Implement primary-artist matching.
- Implement opt-in featured-artist matching.
- Preserve playlist order.
- Implement simple duplicate handling.
- Mark ambiguous matches for review.
- Create deterministic matching tests with sample fixtures.
- Keep the matching logic independent from the visual components.

### Testing and quality

- Add unit tests for matching logic.
- Add tests for primary versus featured artists.
- Add tests for duplicate behavior.
- Add tests for source-playlist immutability.
- Add tests for ordering.
- Add tests for empty and no-match playlists.
- Add tests for special characters and unusual metadata.
- Test permission denied, Music closed, and operation failure states.
- Test a failure halfway through copying.
- Test a large playlist for performance and usable rendering.
- Test responsive layouts on Mac-sized and iPhone-sized screens.
- Run the project's available lint, typecheck, build, and test commands.
- Fix warnings and errors caused by the new work.
- Do not declare success based only on a screenshot or mock data.

### Documentation and handoff

- Document what was actually implemented.
- Document what was tested with real Apple Music data.
- Document what remains blocked or unverified.
- Document required Mac permissions.
- Document how to run the app locally.
- Document how to run the tests.
- Record any assumptions.
- Do not claim iPhone-only operation if a Mac is required.
- Do not claim MusicKit or API access unless it was actually configured and tested.
- At the end, provide a concise changed-files summary, test results, known limitations, and next recommended step.

### GitHub handoff

When the work is complete:

- Save all actual changes in this repository.
- Commit the changes with a clear commit message.
- Push them to the repository's current branch.
- Do not only paste code into chat.
- Do not modify another repository.
- Do not commit secrets or local personal data.
- Report the commit hash.
- Report whether the implementation is complete, partial, or blocked.
- Clearly separate tested functionality from planned functionality.

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
