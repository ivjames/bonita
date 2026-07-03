#!/usr/bin/env bash
# One-time provisioning for bonita.lab980.com on a standard Ubuntu DO droplet.
# Run as root ON THE DROPLET, from a checkout of this repo:
#
#   git clone https://github.com/ivjames/bonita.git /var/www/bonita
#   cd /var/www/bonita
#   sudo bash deploy/setup-droplet.sh
#
# This provisions BOTH halves in one pass: the static site (nginx serves this
# checkout's site/ directly — no webroot, no copying) and the bca-api backend
# (Node service + /api/ proxy + first staff account), by calling
# deploy/api/setup-api.sh at the end. The backend isn't optional: /admin has
# no open, no-login mode, so it needs the API to sign in at all. Set
# BCA_ADMIN_USER / BCA_ADMIN_PASS to skip the first-account prompts.
#
# Updates are `sudo bonita` (= git pull + service sync + nginx reload).
#
# Prerequisite: a DNS A record for bonita.lab980.com pointing at this
# droplet's public IP (certbot's HTTP-01 challenge needs it resolving here).
#
# Idempotent: safe to re-run (keeps existing staff accounts and events).

set -euo pipefail

DOMAIN=bonita.lab980.com
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-ivjames@gmail.com}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash deploy/setup-droplet.sh)" >&2
  exit 1
fi

echo "==> Installing nginx + certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

echo "==> Firewall (ufw): allow SSH + HTTP/HTTPS"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null
  ufw allow 'Nginx Full' >/dev/null
  ufw --force enable >/dev/null
fi

echo "==> Linking nginx routing snippet into the checkout"
# All routing lives in snippets/bonita.d/, SYMLINKED into this checkout —
# same trick as serving site/ directly: `sudo bonita` (git pull + nginx
# reload) updates the conf with no copying and no re-setup. The glob
# include also picks up api.conf if deploy/api/setup-api.sh later
# provisions the backend. Only the certbot-managed server block below
# stays outside the repo.
install -d /etc/nginx/snippets/bonita.d
ln -sfn "$REPO_DIR/deploy/nginx/bonita-common.conf" /etc/nginx/snippets/bonita.d/common.conf

echo "==> Installing nginx server block (root -> $REPO_DIR/site, served directly)"
# Template the conf so `root` points at this checkout's site/ wherever the
# clone lives; no copying, `sudo bonita` (git pull) is the whole deploy.
# NOTE: this overwrites certbot's in-place TLS edits — that's fine here
# because the certbot step below re-applies them (offline `certbot install`
# when a cert already exists on disk, obtain only when there is none).
sed "s#^\( *root \).*#\1$REPO_DIR/site;#" "$REPO_DIR/deploy/nginx/$DOMAIN.conf" \
  > "/etc/nginx/sites-available/$DOMAIN.conf"
chmod 644 "/etc/nginx/sites-available/$DOMAIN.conf"
ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
# Drop the stock catch-all so $DOMAIN isn't shadowed on plain-IP requests.
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Installing 'bonita' update command"
ln -sf "$REPO_DIR/deploy/update.sh" /usr/local/bin/bonita

if [[ -d /etc/letsencrypt/live/$DOMAIN ]]; then
  echo "==> Re-installing existing Let's Encrypt certificate"
  # A cert is already on disk, and the re-templated server block above just
  # lost its TLS lines — wire the existing cert back in. `certbot install`
  # is purely local (no ACME/network calls), so this works even when
  # letsencrypt.org is unreachable, and never wastes an issuance.
  certbot install --nginx --cert-name "$DOMAIN" --redirect --non-interactive
else
  echo "==> Checking DNS for $DOMAIN"
  if ! getent hosts "$DOMAIN" >/dev/null; then
    echo "!! $DOMAIN does not resolve yet. Create the A record, wait for DNS,"
    echo "   then re-run this script (or just the certbot command below)."
    exit 1
  fi

  echo "==> Obtaining Let's Encrypt certificate"
  # --nginx rewrites the server block: adds the 443 block + HTTP->HTTPS
  # redirect. Renewal is automatic via the certbot systemd timer.
  certbot --nginx -d "$DOMAIN" \
    --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
fi

echo "==> Provisioning the bca-api backend"
# Second half of the deploy. Runs last, after certbot has (re)written the
# server block, because setup-api.sh needs the snippets/bonita.d include to
# be in place to link its /api/ locations. Idempotent; keeps existing
# accounts/events. Honours BCA_ADMIN_USER / BCA_ADMIN_PASS for the first
# account, else prompts.
bash "$REPO_DIR/deploy/api/setup-api.sh"

echo "==> Done. https://$DOMAIN"
