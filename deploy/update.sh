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

# The webroot nginx actually serves. Override with BCA_WEBROOT=...; otherwise
# use whichever known location exists (the droplet uses /var/www/bonita).
WEBROOT="${BCA_WEBROOT:-}"
if [[ -z $WEBROOT ]]; then
  for d in /var/www/bonita /var/www/bonita.lab980.com; do
    [[ -d $d ]] && WEBROOT=$d && break
  done
fi
if [[ -z $WEBROOT ]]; then
  echo "No webroot found (/var/www/bonita or /var/www/bonita.lab980.com)." >&2
  echo "Provision first (deploy/setup-droplet.sh) or set BCA_WEBROOT=..." >&2
  exit 1
fi
BIN_LINK=/usr/local/bin/bonita
# Resolve through the symlink so REPO_DIR is the real checkout, not /usr/local.
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bonita) — chown needs it" >&2
  exit 1
fi

# HARD GUARD: never deploy over the checkout itself. If the clone lives in
# or under the webroot, rsync --delete would wipe the repo — including
# site/ out from under the copy ("file has vanished"). The clone belongs
# outside the webroot, e.g. /root/bonita.
case "$REPO_DIR/" in
  "$WEBROOT/"|"$WEBROOT"/*)
    echo "Refusing to deploy: this checkout ($REPO_DIR) is inside the" >&2
    echo "webroot ($WEBROOT). Move the clone outside it, e.g.:" >&2
    echo "  git clone https://github.com/ivjames/bonita.git /root/bonita" >&2
    echo "  sudo bash /root/bonita/deploy/update.sh" >&2
    exit 1;;
esac

git -C "$REPO_DIR" fetch origin main
git -C "$REPO_DIR" checkout main >/dev/null 2>&1 || git -C "$REPO_DIR" checkout -b main origin/main
git -C "$REPO_DIR" merge --ff-only origin/main

rsync -a --delete "$REPO_DIR/site/" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

ln -sf "$SCRIPT_PATH" "$BIN_LINK"

echo "Updated $WEBROOT to $(git -C "$REPO_DIR" rev-parse --short HEAD)"
