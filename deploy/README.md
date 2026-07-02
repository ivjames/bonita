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

Merge to `main`, then on the droplet, from any directory:

```bash
sudo bonita
```

(= fetch + ff-only pull of main + rsync into the webroot + chown. The
command is a symlink to `deploy/update.sh`, installed by `setup-droplet.sh`
and re-asserted on every run. If it doesn't exist yet on an older droplet,
bootstrap once with `cd bonita && sudo bash deploy/update.sh`.)

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
- **Forms have no backend (yet).** Lost & found (About) and the rental
  inquiry (Rentals) compose a pre-filled email in the visitor's mail app
  (`site/assets/js/site.js`), with the recipient's address visible as a
  fallback. A ready-to-provision backend sketch lives in [`api/`](api/) —
  see "Optional: the bca-api backend" below.
- **Calendar is Ludus-first.** The Wix events widget can't leave Wix, and
  Ludus sits behind Cloudflare (fragile to iframe), so the Calendar page and
  the Home events section link out to
  `bonitacenterforthearts.ludus.com`. If an embedded calendar is wanted
  later, Ludus offers embed widgets that can be enabled from their dashboard.
- **CSP is strict** (`default-src 'self'` + Vimeo frames only). If you add
  a third-party embed (maps, calendar), extend `frame-src`/`img-src` in the
  nginx conf accordingly.

## Optional: the bca-api backend (`api/`)

A single-file Node service (stdlib only, no npm installs) that gives the
static site its two missing write paths:

- **`PUT /api/events`** — the [/admin](../site/admin.html) events manager's
  "Save to site" button. Validates the payload (same rules the admin page
  enforces), writes atomically to `/var/lib/bca/events.json`, and keeps the
  last 30 timestamped backups in `/var/lib/bca/backups/`. nginx serves that
  file for `/assets/data/events.json` via an alias, **outside the webroot**,
  because `sudo bonita` rsyncs `--delete` into the webroot and would
  otherwise clobber staff edits on the next deploy.
- **`POST /api/forms`** — form intake: appends to `/var/lib/bca/forms.jsonl`
  and, if sendmail is available and `BCA_MAIL_TO` is set in the unit, emails
  the submission. Honeypot-aware and rate-limited. The public forms still
  use mailto until they're pointed here.

**Auth is app-level with per-user accounts** — no HTTP basic auth. Staff
accounts live in `/var/lib/bca/users.json` (scrypt hashes; the file is the
"database" — at a handful of users that's all it needs to be). Staff sign
in on the /admin page itself (username + password on an on-brand form),
which sets a 12-hour HttpOnly `SameSite=Strict` session cookie; there's a
Sign out button, and saves are logged with the username
(`journalctl -u bca-api`). Everything routine is self-service on /admin:
change your own password, add a colleague, reset their password, remove an
account (the last account is protected, and removing/resetting someone
revokes their sessions). Failed logins are rate-limited per IP (5 per
15 min — failures only, so a busy office behind one school IP can't lock
itself out by signing in a lot); cross-origin writes are rejected. Sessions
live in memory — restarting the service signs everyone out, which doubles
as a global-logout lever.

The admin page needs no reconfiguration: it probes `GET /api/health` and
picks its mode — no backend → download/copy; backend + signed out → login
form; signed in → "Save to site" + the Staff accounts section.
`tools/preview.mjs` mirrors the proxy locally.

To provision, after `setup-droplet.sh`:

```bash
sudo bash deploy/api/setup-api.sh
```

(installs node + the systemd unit `bca-api`, seeds `/var/lib/bca`, and
creates the **first** staff account), then paste the location blocks from
[`nginx/bca-api.locations`](nginx/bca-api.locations) into the server block
and `sudo nginx -t && sudo systemctl reload nginx`. That's the last time
the droplet is involved in account management. If everyone is ever locked
out: delete `/var/lib/bca/users.json`, re-run the script.
