# BCA audit tooling

Headless-Chromium crawler that produces two deliverables for the Wix→self-hosted
migration:

1. **Content & asset inventory** — every page's headings, images (+ alt text with
   an auto-generated-filename heuristic), links, embeds/iframes, PDF links, and
   forms (+ unlabeled-control detection).
2. **Accessibility scan** — axe-core against each page (WCAG 2.1 A/AA +
   best-practice), aggregated by rule and detailed per page.

## Requirements

- Node ≥ 18, `npm install` in this dir (pulls `playwright` + `axe-core`).
- A Chromium for Playwright (`npx playwright install chromium`), unless one is
  already provided (this managed env ships one at `$PLAYWRIGHT_BROWSERS_PATH`).
- **Outbound web access to the target site.** See the note below.

## Run

```bash
cd tools
npm install
node audit.mjs https://www.bonitacenterforthearts.com --max 40
```

Reports are written to `../audit/reports/`:
`summary.md`, `inventory.md` / `inventory.json`, `a11y.md` / `a11y.json`.
In this repo committed reports live in a subdirectory per model run
(e.g. `--out ../audit/reports/fable`).

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--max N` | 40 | max pages to crawl (same-origin BFS) |
| `--wait MS` | 1500 | settle delay after `networkidle` (Wix is JS-rendered) |
| `--no-proxy` | off | ignore `HTTPS_PROXY` (for local/file targets) |
| `--out DIR` | `../audit/reports` | output directory |

## Network note (Claude Code on the web)

The environment's network policy must allow outbound web access (see
https://code.claude.com/docs/en/claude-code-on-the-web#network-access); with the
default Trusted policy every CONNECT gets a 403 and nothing loads.

Even with web access allowed, the egress proxy inspects tunneled TLS
ClientHellos and **closes any handshake advertising Encrypted ClientHello** —
which Chromium sends by default (GREASE ECH) — so every page fails with
`net::ERR_CONNECTION_CLOSED` while `curl` works fine. `audit.mjs` handles this
automatically when `HTTPS_PROXY` is set: it writes the
`EncryptedClientHelloEnabled: false` enterprise policy to
`/etc/chromium/policies/managed/` and launches the full Chromium build at
`/opt/pw-browsers/chromium` (Playwright's default headless shell doesn't read
enterprise policies, and `--disable-features=EncryptedClientHello` does not
remove the GREASE ECH extension).

The script is self-contained, so it can also run locally or on the DO droplet.

## Test harness

`fixtures/` is a small site with **deliberately planted defects** (missing alt,
a heading skip, an untitled iframe, an eagerly-loaded Vimeo embed, an unlabeled
form control, low-contrast text, a missing `lang`). They are test input, not
rot — each is annotated in the fixture's header comment, so don't "fix" the
markup.

`test.mjs` is the automated test: it serves the fixtures with `serve.mjs`, runs
the full audit offline, and asserts `audit.mjs` **detects every planted defect**.
It fails loudly if a change makes the tool stop catching one.

```bash
npm test                  # serves fixtures, audits them, asserts the findings
```

To eyeball the raw report instead of the assertions:

```bash
node serve.mjs &          # serves fixtures on 127.0.0.1:8199
node audit.mjs http://127.0.0.1:8199/ --no-proxy --max 10 --wait 300
```

## Page chrome (`chrome.mjs`)

The shared header nav, footer, venue JSON-LD, and per-section "In this
section" subnav are generated, not hand-copied. Each page in `site/` carries
marker comments (`<!-- chrome:header -->…<!-- /chrome:header -->`);
`node chrome.mjs` regenerates everything between them from the nav tree at
the top of the script. Output is committed, so nginx/deploy stay a plain
`git pull`. Don't edit inside the markers by hand — change the script (or the
page content outside the markers) and re-run it. `node chrome.mjs --check`
exits non-zero if any page is stale. `admin.html` is skipped on purpose (its
reduced nav is hand-maintained).

## Import historic events from the live calendar (`import-calendar.mjs`)

Backfills `site/assets/data/events.json` from the venue's live **public Google
Calendar** (`bonitacenter@gmail.com` — the one that feeds the eventscalendar.co
widget on the Wix site, whose months you can page back through for years of
history). The rebuilt Calendar page renders those past dates as a "Past events"
archive and lets the month grid arrow back into them.

**Run it from the droplet** (or any host with open outbound HTTPS). The managed
web/dev sandbox blocks `calendar.google.com` at the egress proxy, so the site
can't fetch the feed itself — hence a standalone script you run where the
network is open. Stdlib-only Node, no `npm install`.

```bash
node tools/import-calendar.mjs                 # dry run: proposed JSON to stdout, summary to stderr
node tools/import-calendar.mjs --write         # merge into events.json in place
node tools/import-calendar.mjs --past-only     # only events before today (pure history backfill)
node tools/import-calendar.mjs --src=cal.ics   # read a local .ics instead of the live feed
```

It parses every VEVENT into the events.json schema — times land in
`America/Los_Angeles`, multi-day runs expand to one row per day with a shared
`dateLabel`, simple recurring events (`RRULE` DAILY/WEEKLY/MONTHLY/YEARLY, with
`INTERVAL`/`COUNT`/`UNTIL`, weekly `BYDAY`, and `EXDATE`) expand across the
window, and HTML blurbs convert to the Markdown subset `events.js` renders. The
merge keys on `(title, date)` and **never overwrites an existing entry**, so the
hand-curated upcoming shows (Ludus links, tuned blurbs) set on `/admin` survive
— only genuinely new dates are added, then the list is re-sorted.

Defaults: source is the public ICS for `bonitacenter@gmail.com`; window is
`2014-01-01` (the venue opened in 2014) through ~18 months out. Override with
`--since=YYYY-MM-DD` / `--until=YYYY-MM-DD`. If the feed 403s, the calendar
isn't shared publicly — enable "Make available to public" (or use its secret
iCal address / an export) per the message the script prints. Always review the
dry-run diff before `--write`.

## Asset cache-busting (`stamp-assets.mjs`)

Every local CSS/JS reference in `site/**/*.html` carries a `?v=…` query for
cache-busting. Rather than hand-picking integers (`?v=5`, `?v=6`… — easy to
forget, and two branches bumping to the same number merged to a stale asset),
the token is the first 8 hex of the sha256 of the referenced file:

```bash
cd tools
npm run stamp          # or: node stamp-assets.mjs
```

The URL changes if and only if the file's bytes change, so browsers refetch
exactly when they must. Run it after editing a stylesheet or script and
commit the result — the hashes live in the committed HTML and deploy as-is
with `git pull` (no build step). `npm run stamp:check` (`--check`) verifies
without writing and exits non-zero if any stamp is stale — wire it into a
pre-commit hook or CI. Idempotent; safe to run any time.
