#!/usr/bin/env bash
# Provision the bca-api backend on the droplet (run AFTER setup-droplet.sh):
#
#   sudo bash deploy/api/setup-api.sh
#
# Does, in order: installs node, copies the service to /opt/bca, installs +
# starts the systemd unit, seeds /var/lib/bca/events.json from the webroot,
# and creates the staff htpasswd (set BCA_ADMIN_USER/BCA_ADMIN_PASS to skip
# the prompt). The one manual step it can't do safely: adding the location
# blocks to the nginx conf, because certbot rewrites that file — it prints
# the instructions at the end.
#
# Idempotent: safe to re-run (keeps existing htpasswd and events.json).

set -euo pipefail

DOMAIN=bonita.lab980.com
WEBROOT=/var/www/$DOMAIN
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HTPASSWD=/etc/nginx/bca-htpasswd
ADMIN_USER="${BCA_ADMIN_USER:-bca}"

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

echo "==> Seeding /var/lib/bca/events.json (kept if it already exists)"
if [[ ! -f /var/lib/bca/events.json ]]; then
  # StateDirectory owns /var/lib/bca once the service has started.
  install -m 644 "$WEBROOT/assets/data/events.json" /var/lib/bca/events.json
fi

echo "==> Staff credentials ($HTPASSWD, user: $ADMIN_USER)"
if [[ -f $HTPASSWD ]]; then
  echo "    exists — keeping it (delete the file and re-run to reset)"
else
  if [[ -z "${BCA_ADMIN_PASS:-}" ]]; then
    read -r -s -p "    choose a password for '$ADMIN_USER': " BCA_ADMIN_PASS; echo
  fi
  printf '%s:%s\n' "$ADMIN_USER" "$(openssl passwd -apr1 "$BCA_ADMIN_PASS")" > "$HTPASSWD"
  chmod 640 "$HTPASSWD" && chown root:www-data "$HTPASSWD"
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

After that: https://$DOMAIN/admin asks for the staff login, and its
"Save to site" button publishes events.json immediately.
EOF
