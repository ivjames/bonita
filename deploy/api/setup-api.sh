#!/usr/bin/env bash
# Provision the bca-api backend on the droplet (run AFTER setup-droplet.sh):
#
#   sudo bash deploy/api/setup-api.sh
#
# Does, in order: installs node, copies the service to /opt/bca, sets the
# staff password (scrypt-hashed into /etc/bca-api.env; set BCA_ADMIN_PASS to
# skip the prompt), installs + starts the systemd unit, and seeds
# /var/lib/bca/events.json from the webroot. The one manual step it can't do
# safely: adding the location blocks to the nginx conf, because certbot
# rewrites that file — it prints the instructions at the end.
#
# Staff sign in on the /admin page itself (session cookie, no HTTP basic
# auth). To change the password later: delete /etc/bca-api.env and re-run,
# then `systemctl restart bca-api` (which also signs everyone out).
#
# Idempotent: safe to re-run (keeps existing password and events.json).

set -euo pipefail

DOMAIN=bonita.lab980.com
WEBROOT=/var/www/$DOMAIN
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE=/etc/bca-api.env

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

echo "==> Staff password ($ENV_FILE)"
if [[ -f $ENV_FILE ]] && grep -q '^BCA_ADMIN_HASH=' "$ENV_FILE"; then
  echo "    set — keeping it (delete $ENV_FILE and re-run to reset)"
else
  if [[ -z "${BCA_ADMIN_PASS:-}" ]]; then
    read -r -s -p "    choose the staff password for /admin: " BCA_ADMIN_PASS; echo
  fi
  HASH="$(BCA_ADMIN_PASS="$BCA_ADMIN_PASS" node -e '
    const { randomBytes, scryptSync } = require("node:crypto");
    const N = 16384, salt = randomBytes(16);
    const key = scryptSync(process.env.BCA_ADMIN_PASS, salt, 32, { N });
    console.log(["scrypt", N, salt.toString("hex"), key.toString("hex")].join("$"));
  ')"
  touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
  printf 'BCA_ADMIN_HASH=%s\n' "$HASH" >> "$ENV_FILE"
  # Optional: uncomment/add for form email notifications
  # printf 'BCA_MAIL_TO=KBrown@Bonita.k12.ca.us\n' >> "$ENV_FILE"
fi

systemctl daemon-reload
systemctl enable --now bca-api
systemctl restart bca-api

echo "==> Seeding /var/lib/bca/events.json (kept if it already exists)"
if [[ ! -f /var/lib/bca/events.json ]]; then
  # StateDirectory owns /var/lib/bca once the service has started.
  install -m 644 "$WEBROOT/assets/data/events.json" /var/lib/bca/events.json
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

After that: staff open https://$DOMAIN/admin, sign in with the staff
password on the page itself, and "Save to site" publishes immediately.
EOF
