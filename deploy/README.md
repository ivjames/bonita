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

2. **Provision the droplet** (Ubuntu 22.04/24.04, as root). nginx serves
   the clone's `site/` directory directly — there is no separate webroot,
   no rsync, and no second copy of the site on disk:

   ```bash
   git clone https://github.com/ivjames/bonita.git /var/www/bonita
   cd /var/www/bonita
   sudo bash deploy/setup-droplet.sh
   ```

   The script is idempotent and does, in order: installs nginx + certbot,
   opens the firewall (SSH + HTTP/HTTPS), installs the server block from
   [`nginx/bonita.lab980.com.conf`](nginx/bonita.lab980.com.conf) with its
   `root` rewritten to this checkout's `site/`, then runs `certbot --nginx`
   to obtain the certificate and turn on the HTTPS redirect. Certbot
   registers with `ivjames@gmail.com` by default — override with
   `CERTBOT_EMAIL=... sudo -E bash deploy/setup-droplet.sh`.

   If DNS hasn't propagated yet the script stops before certbot; re-run it
   once `bonita.lab980.com` resolves.

3. **Renewals** are automatic (certbot's systemd timer). Verify with
   `certbot renew --dry-run`.

## Updating the site

Merge to `main`, then on the droplet, from any directory:

```bash
sudo bonita
```

(= fetch + ff-only pull of main, then `nginx -t` + reload. nginx serves the
clone's `site/` directly and the routing conf — headers, clean URLs,
redirects, API locations — is *symlinked* from
`/etc/nginx/snippets/bonita.d/` into [`nginx/`](nginx/), so the pull
updates content and conf alike and the zero-downtime reload makes it all
live. The command is a symlink to `deploy/update.sh`, re-asserted on every
run. If it doesn't exist yet, bootstrap once with
`sudo bash deploy/update.sh` from the clone.)

nginx conf changes therefore deploy like content changes: edit
[`nginx/bonita-common.conf`](nginx/bonita-common.conf) (or
`nginx/bca-api.locations`), merge, `sudo bonita`. The one file that lives
outside the repo is the certbot-managed server-block shell
(`sites-available/bonita.lab980.com.conf` — just listen/server_name/root
plus the include), which shouldn't ever need to change.

**One-time migration for a droplet provisioned before the symlink layout:**
run `sudo bash deploy/setup-droplet.sh` once (idempotent; re-runs certbot so
TLS survives the re-templated shell). If the API location blocks were
hand-pasted into the old conf, run `sudo bash deploy/api/setup-api.sh` once
too. After that it's `sudo bonita` forever.

## Decisions baked into the config

- **Staging is noindex.** `robots.txt` disallows everything and nginx sends
  `X-Robots-Tag: noindex, nofollow` — the rebuild must not compete with the
  live Wix site in search. **At cutover** (when this becomes the real site),
  in [`nginx/bonita-common.conf`](nginx/bonita-common.conf) remove the
  `X-Robots-Tag` header AND the staging-only `Cache-Control "no-cache"`
  header (dev aid so deploys show instantly; once live, browsers should
  cache HTML normally), replace `robots.txt` with an allow-all, and update
  the `<link rel="canonical">` tags in the site's HTML to the production
  domain — then merge and `sudo bonita`.
- **URL paths mirror Wix** (`/about`, `/booking-calendar`, `/get-involved`,
  `/rentals`) via `try_files $uri $uri.html`, so existing links keep working
  at cutover with no redirect map. The three PDFs the Wix site served from
  hashed `/_files/ugd/...` paths get 301s to their new self-hosted homes.
- **The public forms aren't wired to the backend yet.** The bca-api backend
  is deployed and live (see "The bca-api backend" below), but Lost & found
  (About) and the rental inquiry (Rentals) still compose a pre-filled email
  in the visitor's mail app (`site/assets/js/site.js`), with the recipient's
  address visible as a fallback. Pointing them at `POST /api/forms` is the
  remaining step.
- **Calendar is Ludus-first.** The Wix events widget can't leave Wix, and
  Ludus sits behind Cloudflare (fragile to iframe), so the Calendar page and
  the Home events section link out to
  `bonitacenterforthearts.ludus.com`. If an embedded calendar is wanted
  later, Ludus offers embed widgets that can be enabled from their dashboard.
- **CSP is strict** (`default-src 'self'` + Vimeo frames only). If you add
  a third-party embed (maps, calendar), extend `frame-src`/`img-src` in the
  nginx conf accordingly.

## The bca-api backend (`api/`)

Deployed and live. A single-file Node service (stdlib only, no npm installs)
that gives the static site its write paths and a submissions inbox:

- **`PUT /api/events`** — the [/admin](../site/admin.html) events manager's
  "Save to site" button. Validates the payload (same rules the admin page
  enforces), writes atomically to `/var/lib/bca/events.json`, and keeps the
  last 30 timestamped backups in `/var/lib/bca/backups/`. nginx serves that
  file for `/assets/data/events.json` via an alias, **outside the clone**,
  so staff edits never collide with git (`sudo bonita` pulls would refuse
  to overwrite a dirty tracked file).
- **`POST /api/forms`** — form intake: appends to `/var/lib/bca/forms.jsonl`
  and, if sendmail is available and `BCA_MAIL_TO` is set in the unit, emails
  the submission. Honeypot-aware and rate-limited. The rental-inquiry and
  lost & found forms POST here, falling back to a mailto compose only if the
  backend is unreachable.
- **`GET /api/forms`** (+ `POST /api/forms/:id/handled`, `DELETE
  /api/forms/:id`) — the submissions inbox behind the /admin "Messages" tab
  (session-gated). Staff read spooled submissions newest-first, mark them
  handled (triage state in `/var/lib/bca/forms-state.json`, kept separate so
  reads never rewrite the append-only spool), and delete spam. This is the
  primary way staff see submissions — no mail delivery required, which suits
  a district that may not offer mailer access; the `POST /api/forms` sendmail
  notification is a bonus on top.

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
form; signed in → "Save to site" + the Messages and Staff accounts sections.
`tools/preview.mjs` mirrors the proxy locally.

Provisioned (after `setup-droplet.sh`) with:

```bash
sudo bash deploy/api/setup-api.sh
```

Re-runnable if you ever need to rebuild the droplet. It installs node + the
systemd unit `bca-api`, seeds `/var/lib/bca`, creates the **first** staff
account, and installs the nginx location blocks from
[`nginx/bca-api.locations`](nginx/bca-api.locations) as
`snippets/bonita.d/api.conf` + reloads nginx. That's the last time the
droplet is involved in account management. If everyone is ever locked out:
delete `/var/lib/bca/users.json`, re-run the script.
