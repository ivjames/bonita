#!/usr/bin/env bash
# Update the live site ON THE DROPLET: `sudo bonita` = git pull, done.
#
# nginx serves this checkout's site/ directory directly (the `root` in the
# nginx conf points at <clone>/site), so the pull IS the deploy. There is
# no rsync and no second copy of the site on disk.
#
# First run:        sudo bash deploy/update.sh   (from the clone)
# Every run after:  sudo bonita                  (from any directory)
#
# The script self-installs as /usr/local/bin/bonita on each run and pulls
# main ff-only, so a diverged clone fails loudly instead of merging.

set -euo pipefail

BIN_LINK=/usr/local/bin/bonita
# Resolve through the symlink so REPO_DIR is the real checkout, not /usr/local.
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bonita)" >&2
  exit 1
fi

git -C "$REPO_DIR" fetch origin main
git -C "$REPO_DIR" checkout main >/dev/null 2>&1 || git -C "$REPO_DIR" checkout -b main origin/main
git -C "$REPO_DIR" merge --ff-only origin/main

ln -sf "$SCRIPT_PATH" "$BIN_LINK"

echo "Updated to $(git -C "$REPO_DIR" rev-parse --short HEAD) — nginx serves $REPO_DIR/site directly, so that's it."
