# Bonita Center for the Arts — website

Working repo for maintaining and rebuilding
[bonitacenterforthearts.com](https://www.bonitacenterforthearts.com), migrating
it off Wix onto a self-hosted DigitalOcean droplet.

- **Live site:** https://www.bonitacenterforthearts.com (Wix)
- **Rebuild (staging):** https://bonita.lab980.com — static site in
  [`site/`](site/), nginx + certbot config in [`deploy/`](deploy/)
- **Ticketing:** https://bonitacenterforthearts.ludus.com (Ludus, external)
- **Venue:** 701-seat performing-arts theatre owned by Bonita Unified School
  District (BUSD), San Dimas CA. Opened 2014.

## Contacts

| Role | Name | Email |
|------|------|-------|
| Theatre Manager | Kyle Brown | KBrown@Bonita.k12.ca.us |
| Box Office Manager | Megan Kauffunger | Kauffunger@Bonita.k12.ca.us |
| Technical Director | Scott Inlow | Inlow@Bonita.k12.ca.us |

Main phone: (909) 971-8280. All staff are BUSD employees. Wix admin access is
coordinated through Kyle Brown / BUSD.

## Site structure (current Wix site)

- **Home** — upcoming events (Ludus), contact footer
- **About** — overview, contacts, lost & found form, location/map, seating chart
  PDF, house policies
- **Calendar** — Wix bookings widget (JS-rendered, no static fallback)
- **Get Involved** — staff hiring info, volunteer signup (SignUpGenius)
- **Rentals** — inquiry form, policies, building layout, full technical specs

Rentals are inquiry-gated (no public pricing); the venue is booked Nov–June for
district use, with external rentals only in summer and fall.

## The rebuild (`site/` + `deploy/`)

Static HTML/CSS (no build step, no third-party requests or trackers; the
Fraunces display font is self-hosted in `site/assets/fonts/`), served by nginx
on the droplet at **bonita.lab980.com**. Same five URL paths as Wix. See
[`deploy/README.md`](deploy/README.md) for droplet setup (DNS → nginx →
certbot) and the decisions baked into the config (staging is noindex, forms
are mailto-composed pending a backend, calendar links out to Ludus, Wix PDF
paths get 301s).

Everything in "known issues" below is fixed in the rebuild; the axe-core
audit of the rebuilt site is clean (0 violations, 0 bad alt, all forms
labeled, one H1 per page — verify with `node tools/preview.mjs` +
`node tools/audit.mjs http://127.0.0.1:8288/ --no-proxy --max 10 --wait 400 --out /tmp/rebuild-audit`).

## Known issues in the live Wix site (fixed in the rebuild)

- Contact info stale: About contact block + footer on Rentals/Calendar still show
  **Stone / Stone@Bonita.k12.ca.us** → should be **Brown / KBrown@Bonita.k12.ca.us**
  (as of 2026-07-01 the visible text is updated but the About mailto still
  points at Stone@)
- Calendar page renders blank without JS (no static fallback)
- "Gallery" section on About is actually just a lost & found form — no real gallery
  (rebuild names the section Lost & found)
- Seating chart is a PDF behind an unlabeled image ("CLICK IMAGE TO OPEN PDF")
- 2015 Vimeo opening video duplicated on Home and Rentals (rebuild embeds it
  once, on About)
- Wix-generated filename alt text likely throughout

## Accessibility

Audit tooling lives in [`tools/`](tools/) — a headless-Chromium crawler that
generates a content/asset inventory and an axe-core WCAG 2.1 A/AA scan. See
[`tools/README.md`](tools/README.md) for usage and the network/proxy notes
(the managed web environment's egress proxy rejects Chromium's default TLS
handshake; `audit.mjs` works around it automatically).

**The live audit ran 2026-07-01** — reports are in
[`audit/reports/fable/`](audit/reports/fable/): 5 pages, 18 images (12 with
missing/auto-generated alt text), 26 axe violation instances across 4 rules.
Highlights beyond the alt-text problem: the Rentals inquiry form has 5 of 6
controls unlabeled, all 3 PDF links sitewide have no accessible name, About and
Calendar have no H1 (Get Involved has two), and the Rentals tech-specs section
misuses ~40 H5s (16 of them empty) for body text.

## Migration TODO

- [ ] Get Wix admin access (via Kyle Brown / BUSD)
- [x] Full content + asset audit before leaving Wix — see `audit/reports/fable/inventory.md`
- [x] Accessibility audit (axe-core) — see `audit/reports/fable/a11y.md`; Lighthouse/pa11y still TODO
- [x] Choose the stack for the self-hosted DO droplet — plain static HTML/CSS + nginx (`site/`, `deploy/`)
- [x] Calendar solution to replace the Wix bookings widget — link out to Ludus
      (single source of truth), plus a hand-maintained upcoming-events list
      (`site/assets/data/events.json`, rendered by `assets/js/events.js` on
      Home and Calendar; past dates drop off automatically; empty list = pages
      fall back to the plain Ludus link). The old Wix "calendar widget" was a
      third-party eventscalendar.co iframe that was also fed by hand.
      Staff edit the list at **/admin** (site/admin.html — "Backstage: Events
      manager"): browser-only form UI with validation, past-date flags, and a
      live preview; it generates events.json to download/copy until a write
      backend exists. Not linked from the public site; noindex, and robots.txt
      carries a commented Disallow to enable at cutover.
- [ ] Enable the Ludus embed widget (optional upgrade; needs Ludus account
      admin — Kyle Brown / box office). Ludus has no public API or iCal feed;
      the sanctioned option is their embed widget (+$0.50/ticket, More →
      Embed Widget → Get Started, whitelist bonita.lab980.com + production
      domain). The mount point and activation checklist are plumbed in
      `site/booking-calendar.html` as an inert comment.
- [x] Ludus ticketing integration approach — prominent links sitewide (header
      Tickets button, Home events section, Calendar page); no iframe (Ludus
      sits behind Cloudflare)
- [x] URL redirect strategy — rebuild keeps the Wix paths verbatim
      (`/about`, `/booking-calendar`, `/get-involved`, `/rentals`); the 3
      hashed Wix PDF URLs get 301s in nginx
- [x] Sitewide contact corrections (Stone → Brown) — corrected in the rebuild
      (still stale on live Wix)
- [ ] Provision the droplet + DNS A record, run `deploy/setup-droplet.sh`
- [ ] Form backend (rental inquiry + lost & found currently compose an email
      client-side). A ready-to-provision sketch lives in `deploy/api/` —
      bca-api, a stdlib-only Node service behind nginx: `PUT /api/events`
      (the /admin "Save to site" button; auto-detected via /api/health) and
      `POST /api/forms` (intake spool + optional sendmail). Staff auth is
      per-user accounts in /var/lib/bca/users.json (scrypt hashes) with a
      session-cookie login form on /admin — no HTTP basic auth, and account
      management (password changes, add/remove staff) is self-service on the
      page; the droplet is only touched once, to bootstrap the first
      account. Run `deploy/api/setup-api.sh` on the droplet + paste
      `deploy/nginx/bca-api.locations` into the server block. The public
      forms still need pointing at /api/forms once email delivery is
      decided.
- [x] Structured data (JSON-LD) — a shared `PerformingArtsTheater` block in
      every public page's head (venue, address, phone, capacity, BUSD as
      parent org), plus per-show `Event` markup emitted by
      `assets/js/events.js` alongside the rendered list. Note Lighthouse's
      structured-data check is a manual audit and never affects the SEO
      score; while the staging noindex is in place that score is capped
      (~69, "page is blocked from indexing") by design — it recovers at
      cutover.
- [ ] At cutover: drop noindex (nginx header + robots.txt), point canonicals
      at the production domain — and the structured-data URLs with them (the
      JSON-LD `#venue` block in each page head + the venue `@id` in
      `assets/js/events.js`)

## Repo layout

```
site/           the rebuilt static site (5 pages + assets), deployable as-is
deploy/         nginx server block, provisioning + deploy scripts, runbook
tools/          audit crawler (crawl + axe-core), local preview server,
                test fixtures, README
audit/reports/  committed runs, one subdir per model:
                  fable/ live-site audit + Lighthouse (2026-07-01)
                  opus/  fixture self-test sample (not the live site)
```
