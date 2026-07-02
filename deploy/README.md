# Deploying bonita.lab980.com

The rebuilt site is plain static files in [`site/`](../site/) — no build
step, no runtime dependencies. Hosting is a standard DigitalOcean droplet
running nginx, with TLS from Let's Encrypt (certbot).

## First-time setup

1. **DNS** — at your DNS provider for `lab980.com`, add an A record:

   ```
   bonita.lab980.com  A  <droplet public IP>
   ```

   (Add an AAAA record too if the droplet has IPv6.)

2. **Provision the droplet** (Ubuntu 22.04/24.04, as root):

   ```bash
   git clone https://github.com/ivjames/bonita.git
   cd bonita
   sudo bash deploy/setup-droplet.sh
   ```

   The script is idempotent and does, in order: installs nginx + certbot,
   opens the firewall (SSH + HTTP/HTTPS), rsyncs `site/` to
   `/var/www/bonita.lab980.com`, installs the server block from
   [`nginx/bonita.lab980.com.conf`](nginx/bonita.lab980.com.conf), then runs
   `certbot --nginx` to obtain the certificate and turn on the HTTPS
   redirect. Certbot registers with `ivjames@gmail.com` by default —
   override with `CERTBOT_EMAIL=... sudo -E bash deploy/setup-droplet.sh`.

   If DNS hasn't propagated yet the script stops before certbot; re-run it
   once `bonita.lab980.com` resolves.

3. **Renewals** are automatic (certbot's systemd timer). Verify with
   `certbot renew --dry-run`.

## Updating the site

Merge to `main`, then on the droplet:

```bash
cd bonita && sudo bash deploy/update.sh
```

(`update.sh` = fetch + ff-only pull of main + rsync into the webroot + chown.)

Alternative, if you'd rather push from your machine without touching the
droplet's clone: `deploy/deploy.sh root@bonita.lab980.com`.

No nginx reload is needed for content changes — only when the `.conf` changes
(`sudo nginx -t && sudo systemctl reload nginx`).

## Decisions baked into the config

- **Staging is noindex.** `robots.txt` disallows everything and nginx sends
  `X-Robots-Tag: noindex, nofollow` — the rebuild must not compete with the
  live Wix site in search. **At cutover** (when this becomes the real site):
  remove that header from the nginx conf, replace `robots.txt` with an
  allow-all, and update the `<link rel="canonical">` tags in `site/*.html`
  to the production domain.
- **URL paths mirror Wix** (`/about`, `/booking-calendar`, `/get-involved`,
  `/rentals`) via `try_files $uri $uri.html`, so existing links keep working
  at cutover with no redirect map. The three PDFs the Wix site served from
  hashed `/_files/ugd/...` paths get 301s to their new self-hosted homes.
- **Forms have no backend.** Lost & found (About) and the rental inquiry
  (Rentals) compose a pre-filled email in the visitor's mail app
  (`site/assets/js/site.js`), with the recipient's address visible as a
  fallback. To upgrade later, point the form at a real endpoint (Formspree,
  or a tiny handler on the droplet) — the markup already has proper
  names/labels.
- **Calendar is Ludus-first.** The Wix events widget can't leave Wix, and
  Ludus sits behind Cloudflare (fragile to iframe), so the Calendar page and
  the Home events section link out to
  `bonitacenterforthearts.ludus.com`. If an embedded calendar is wanted
  later, Ludus offers embed widgets that can be enabled from their dashboard.
- **CSP is strict** (`default-src 'self'` + Vimeo frames only). If you add
  a third-party embed (maps, calendar), extend `frame-src`/`img-src` in the
  nginx conf accordingly.
