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

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--max N` | 40 | max pages to crawl (same-origin BFS) |
| `--wait MS` | 1500 | settle delay after `networkidle` (Wix is JS-rendered) |
| `--no-proxy` | off | ignore `HTTPS_PROXY` (for local/file targets) |
| `--out DIR` | `../audit/reports` | output directory |

## Network note (Claude Code on the web)

This environment's egress policy currently **denies all outbound HTTPS** (the
proxy returns `403 to CONNECT` for every external host, `example.com` included),
so the audit cannot fetch the live site from here. Two ways to run it:

- Recreate the web environment with a network policy that allows outbound web,
  then run the command above. See
  https://code.claude.com/docs/en/claude-code-on-the-web
- Or run it locally / on the DO droplet — the script is self-contained.

## Test harness

`fixtures/` + `serve.mjs` are a local site with deliberate defects used to verify
the tool without hitting the network:

```bash
node serve.mjs &          # serves fixtures on 127.0.0.1:8199
node audit.mjs http://127.0.0.1:8199/ --no-proxy --max 10 --wait 300
```
