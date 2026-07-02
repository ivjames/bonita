#!/usr/bin/env bash
# Update the live site ON THE DROPLET from the repo clone:
#
#   cd bonita && sudo bash deploy/update.sh
#
# Pulls main (ff-only, so a diverged clone fails loudly instead of merging),
# mirrors site/ into the webroot, and fixes ownership.

set -euo pipefail

WEBROOT=/var/www/bonita.lab980.com
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash deploy/update.sh) — chown needs it" >&2
  exit 1
fi

git -C "$REPO_DIR" fetch origin main
git -C "$REPO_DIR" checkout main >/dev/null 2>&1 || git -C "$REPO_DIR" checkout -b main origin/main
git -C "$REPO_DIR" merge --ff-only origin/main

rsync -a --delete "$REPO_DIR/site/" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

echo "Updated $WEBROOT to $(git -C "$REPO_DIR" rev-parse --short HEAD)"
