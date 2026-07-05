# Bonita Center for the Arts — site

Static site in `site/`, deployed to a DigitalOcean droplet by a plain
`git pull` (no build step). Because there's no build, some output is
**generated and committed** — it must be regenerated and committed whenever
its sources change, or the deploy serves stale bytes.

## Standard step before merging / deploying

Regenerate committed generated output and commit the result. CI
(`.github/workflows/generated-assets-fresh.yml`) fails the PR if either is
stale, so this must be green before merge:

```bash
npm --prefix tools run gen    # = chrome.mjs (page chrome) + stamp-assets.mjs (?v= hashes)
git add -A && git commit
# npm --prefix tools run check  ← what CI runs (both --check, non-zero if stale)
```

If you enable the committed hook once per clone —
`git config core.hooksPath .githooks` — this runs automatically on every
commit and stages the result, so you can't forget.

- **Cache-busting (`tools/stamp-assets.mjs`).** Every local CSS/JS URL in
  `site/**/*.html` carries `?v=<hash>`, the sha256 of the file's bytes.
  Browsers only refetch when the token changes. **After editing any
  stylesheet or script you must re-run this and commit** — otherwise pages
  keep pointing at the old hash and browsers serve the cached old asset
  ("I pushed a change and don't see it"). This does **not** cover HTML or
  images — their freshness depends on nginx cache headers on the droplet.
- **Page chrome (`tools/chrome.mjs`).** Header nav, footer, JSON-LD, and the
  "In this section" subnav are generated from the nav tree in the script into
  **partials** under `site/partials/`, which each page pulls in at request
  time via nginx server-side includes (`ssi on`). Pages carry only the
  `<!--# set -->` / `<!--# include -->` directives between the
  `<!-- chrome:* -->` markers. To change the nav/footer, edit the script and
  re-run it; don't hand-edit the partials or inside the markers.

Both support `--check` (verify without writing, non-zero if stale). See
`tools/README.md` for full details on these and the audit tooling.

## Editing rules for agents (keep token usage down)

The chrome is generated and duplicated across the site, and some committed
data is large. To avoid wasting tokens and creating churn:

- **Never rewrite a whole page file.** ~half of each page is shared chrome now
  living in `site/partials/`. Use targeted edits and only touch page-unique
  content — the stuff **outside** the `<!-- chrome:* -->` markers.
- **Never hand-edit inside `<!-- chrome:* -->` markers or the `site/partials/`
  files.** They're generated. Change `tools/chrome.mjs` (the `NAV` tree /
  `FOOTER` / `JSONLD`) and re-run `npm --prefix tools run chrome`.
- **Never hand-edit `?v=` tokens.** Re-run `npm --prefix tools run stamp`.
- **Don't read `site/assets/data/events.json` whole** (thousands of lines).
  Grep for the one entry you need and edit in place. Staff-edited events are
  served from `/var/lib/bca/events.json` on the droplet, not this file.
- **Before committing generated changes,** run `npm --prefix tools run gen`
  (or let the pre-commit hook do it). Forgetting bounces CI and costs a round
  trip.

## Deploy

`sudo bonita` on the droplet (`deploy/update.sh`) is the whole deploy: git pull
+ optional bca-api refresh + `nginx -t` + reload. nginx serves the checkout's
`site/` directly and assembles the SSI partials at request time. Merges to
`main` also auto-deploy via `.github/workflows/deploy.yml` (SSH → `sudo bonita`);
setup is in `deploy/DEPLOY-GITHUB.md`.
