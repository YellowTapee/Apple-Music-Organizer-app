#!/bin/bash
# Double-click in Finder. Closing this window stops the helper started here.
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is required. Install it from https://nodejs.org, then reopen this file.'
  read -r -p 'Press Return to close. ' unused
  exit 1
fi
node helper/launch.js
result=$?
if [ "$result" -ne 0 ]; then
  read -r -p 'Press Return to close. ' unused
fi
exit "$result"
