#!/usr/bin/env bash
# Update the live site ON THE DROPLET: `sudo bonita` = git pull, then
# nginx test + reload. That's the whole deploy.
#
# nginx serves this checkout's site/ directory directly, and the routing
# conf (/etc/nginx/snippets/bonita.d/*.conf) is symlinked into this
# checkout's deploy/nginx/ — so the pull updates content AND conf, and the
# reload makes conf changes live. Content-only updates don't need the
# reload, but it's zero-downtime and instant, so it just always runs.
# (Only the certbot-managed server-block shell in sites-available sits
# outside the repo; it holds nothing but listen/server_name/root and the
# include, and shouldn't ever need to change.)
#
# First run:        sudo bash deploy/update.sh   (from the clone)
# Every run after:  sudo bonita                  (from any directory)
#
# The script self-installs as /usr/local/bin/bonita on each run and pulls
# main ff-only, so a diverged clone fails loudly instead of merging.

set -euo pipefail

# The pull below can replace this very file while it runs. The braces make
# bash parse the whole body before executing any of it, and the trailing
# `exit` stops it from reading whatever the new version put at these byte
# offsets afterwards. Keep everything inside the block.
{

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

nginx -t
systemctl reload nginx

echo "Updated to $(git -C "$REPO_DIR" rev-parse --short HEAD) and reloaded nginx."

exit
}
