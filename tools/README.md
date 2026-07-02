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

`fixtures/` + `serve.mjs` are a local site with deliberate defects used to verify
the tool without hitting the network:

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
