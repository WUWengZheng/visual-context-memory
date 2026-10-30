#!/bin/bash
set -u
cd "$(dirname "$0")" || exit 1
install_status=0
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 24+ from https://nodejs.org and open this installer again.'
  install_status=1
else
  node scripts/setup.mjs "$@" || install_status=$?
fi
echo 'Press Enter to close this window.'
read -r || true
exit "$install_status"
