#!/usr/bin/env bash
# Provision the bca-api backend on the droplet (run AFTER setup-droplet.sh):
#
#   sudo bash deploy/api/setup-api.sh
#
# Does, in order: installs node, copies the service to /opt/bca, installs +
# starts the systemd unit, seeds /var/lib/bca/events.json from the webroot,
# and creates the FIRST staff account in /var/lib/bca/users.json (set
# BCA_ADMIN_USER/BCA_ADMIN_PASS to skip the prompts). The one manual step it
# can't do safely: adding the location blocks to the nginx conf, because
# certbot rewrites that file — it prints the instructions at the end.
#
# Everything after bootstrap is self-service on the /admin page: staff sign
# in there (session cookie, no HTTP basic auth), change their own passwords,
# and add/remove accounts. This script never needs re-running for any of
# that. Locked out entirely? Delete /var/lib/bca/users.json and re-run to
# bootstrap a fresh first account.
#
# Idempotent: safe to re-run (keeps existing accounts and events.json).

set -euo pipefail

DOMAIN=bonita.lab980.com
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USERS_FILE=/var/lib/bca/users.json

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash deploy/api/setup-api.sh)" >&2
  exit 1
fi

echo "==> Installing node"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nodejs

echo "==> Installing service to /opt/bca"
install -d /opt/bca
install -m 644 "$REPO_DIR/deploy/api/bca-api.mjs" /opt/bca/bca-api.mjs
install -m 644 "$REPO_DIR/deploy/api/bca-api.service" /etc/systemd/system/bca-api.service
systemctl daemon-reload
systemctl enable --now bca-api
systemctl restart bca-api
sleep 1   # let StateDirectory create /var/lib/bca

echo "==> Seeding /var/lib/bca/events.json (kept if it already exists)"
if [[ ! -f /var/lib/bca/events.json ]]; then
  # Seed from the repo checkout this script runs from — always present and
  # current, unlike the webroot (which may not have been rsynced yet).
  install -m 644 "$REPO_DIR/site/assets/data/events.json" /var/lib/bca/events.json
  chown --reference=/var/lib/bca /var/lib/bca/events.json
fi

echo "==> First staff account ($USERS_FILE)"
if [[ -f $USERS_FILE ]]; then
  echo "    exists — keeping it (accounts are managed from /admin;"
  echo "    if everyone is locked out, delete the file and re-run)"
else
  if [[ -z "${BCA_ADMIN_USER:-}" ]]; then
    read -r -p "    choose a username for the first staff account: " BCA_ADMIN_USER
  fi
  if [[ -z "${BCA_ADMIN_PASS:-}" ]]; then
    read -r -s -p "    choose their password (8+ characters): " BCA_ADMIN_PASS; echo
  fi
  BCA_ADMIN_USER="$BCA_ADMIN_USER" BCA_ADMIN_PASS="$BCA_ADMIN_PASS" node -e '
    const { randomBytes, scryptSync } = require("node:crypto");
    const name = process.env.BCA_ADMIN_USER.toLowerCase().trim();
    if (!/^[a-z0-9._-]{2,32}$/.test(name)) { console.error("bad username"); process.exit(1); }
    if (process.env.BCA_ADMIN_PASS.length < 8) { console.error("password too short"); process.exit(1); }
    const N = 16384, salt = randomBytes(16);
    const key = scryptSync(process.env.BCA_ADMIN_PASS, salt, 32, { N });
    const hash = ["scrypt", N, salt.toString("hex"), key.toString("hex")].join("$");
    const users = { [name]: { hash, updated: new Date().toISOString() } };
    require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ users }, null, 2) + "\n");
  ' "$USERS_FILE"
  chmod 600 "$USERS_FILE"
  # The service (a systemd DynamicUser) must be able to read AND rewrite it.
  chown --reference=/var/lib/bca "$USERS_FILE"
fi

echo "==> Service status"
sleep 1
curl -sf http://127.0.0.1:8787/api/health && echo

cat <<EOF

Done, except one manual step: add the location blocks from
  $REPO_DIR/deploy/nginx/bca-api.locations
inside the server { } block(s) of
  /etc/nginx/sites-available/$DOMAIN.conf
(both the 443 and, if you want, the 80 block once certbot has split them),
then:
  sudo nginx -t && sudo systemctl reload nginx

After that: staff open https://$DOMAIN/admin and sign in on the page
itself. Publishing events, changing passwords, and adding or removing
staff accounts are all done there — no droplet access needed again.
EOF
