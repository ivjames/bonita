#!/usr/bin/env bash
# Push the static site to the droplet. Run from anywhere in the repo:
#
#   deploy/deploy.sh root@<droplet-ip-or-hostname>
#
# Uses rsync over SSH; only changed files transfer. --delete keeps the
# webroot an exact mirror of site/ (removed pages disappear from the server).

set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh <ssh-host, e.g. root@bonita.lab980.com>}"
WEBROOT=/var/www/bonita.lab980.com
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rsync -avz --delete --chown=www-data:www-data \
  "$REPO_DIR/site/" "$HOST:$WEBROOT/"

echo "Deployed site/ -> $HOST:$WEBROOT"
