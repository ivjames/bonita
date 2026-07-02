#!/usr/bin/env bash
# Update the live site ON THE DROPLET from the repo clone.
#
# First run:        cd bonita && sudo bash deploy/update.sh
# Every run after:  sudo bonita        (from any directory)
#
# The script self-installs as /usr/local/bin/bonita on each run, pulls main
# (ff-only, so a diverged clone fails loudly instead of merging), mirrors
# site/ into the webroot, and fixes ownership.

set -euo pipefail

WEBROOT=/var/www/bonita.lab980.com
BIN_LINK=/usr/local/bin/bonita
# Resolve through the symlink so REPO_DIR is the real checkout, not /usr/local.
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bonita) — chown needs it" >&2
  exit 1
fi

git -C "$REPO_DIR" fetch origin main
git -C "$REPO_DIR" checkout main >/dev/null 2>&1 || git -C "$REPO_DIR" checkout -b main origin/main
git -C "$REPO_DIR" merge --ff-only origin/main

rsync -a --delete "$REPO_DIR/site/" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

ln -sf "$SCRIPT_PATH" "$BIN_LINK"

echo "Updated $WEBROOT to $(git -C "$REPO_DIR" rev-parse --short HEAD)"
