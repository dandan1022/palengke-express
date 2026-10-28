#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is required. Install Node.js 18+ from https://nodejs.org/'
  read '?Press Enter to close...'
  exit 1
fi
(sleep 1; open 'http://localhost:3000') &
echo 'Starting Palengke Express on http://localhost:3000'
echo 'Press Control+C to stop the server.'
node server.js
