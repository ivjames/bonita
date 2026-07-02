#!/usr/bin/env bash
# One-time provisioning for bonita.lab980.com on a standard Ubuntu DO droplet.
# Run as root ON THE DROPLET, from a checkout of this repo:
#
#   git clone https://github.com/ivjames/bonita.git && cd bonita
#   sudo bash deploy/setup-droplet.sh
#
# Prerequisite: a DNS A record for bonita.lab980.com pointing at this
# droplet's public IP (certbot's HTTP-01 challenge needs it resolving here).
#
# Idempotent: safe to re-run.

set -euo pipefail

DOMAIN=bonita.lab980.com
WEBROOT=/var/www/$DOMAIN
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-ivjames@gmail.com}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash deploy/setup-droplet.sh)" >&2
  exit 1
fi

echo "==> Installing nginx + certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx rsync

echo "==> Firewall (ufw): allow SSH + HTTP/HTTPS"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null
  ufw allow 'Nginx Full' >/dev/null
  ufw --force enable >/dev/null
fi

echo "==> Deploying site content to $WEBROOT"
mkdir -p "$WEBROOT"
rsync -a --delete "$REPO_DIR/site/" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

echo "==> Installing nginx server block"
install -m 644 "$REPO_DIR/deploy/nginx/$DOMAIN.conf" "/etc/nginx/sites-available/$DOMAIN.conf"
ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
# Drop the stock catch-all so $DOMAIN isn't shadowed on plain-IP requests.
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Checking DNS for $DOMAIN"
if ! getent hosts "$DOMAIN" >/dev/null; then
  echo "!! $DOMAIN does not resolve yet. Create the A record, wait for DNS,"
  echo "   then re-run this script (or just the certbot command below)."
  exit 1
fi

echo "==> Obtaining/renewing Let's Encrypt certificate"
# --nginx rewrites the server block: adds the 443 block + HTTP->HTTPS redirect.
# Renewal is automatic via the certbot systemd timer.
certbot --nginx -d "$DOMAIN" \
  --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect

echo "==> Done. https://$DOMAIN"
