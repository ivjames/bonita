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
node tools/stamp-assets.mjs   # cache-busting ?v= hashes on CSS/JS
node tools/chrome.mjs         # generated header/footer/subnav
git add -A && git commit
```

- **Cache-busting (`tools/stamp-assets.mjs`).** Every local CSS/JS URL in
  `site/**/*.html` carries `?v=<hash>`, the sha256 of the file's bytes.
  Browsers only refetch when the token changes. **After editing any
  stylesheet or script you must re-run this and commit** — otherwise pages
  keep pointing at the old hash and browsers serve the cached old asset
  ("I pushed a change and don't see it"). This does **not** cover HTML or
  images — their freshness depends on nginx cache headers on the droplet.
- **Page chrome (`tools/chrome.mjs`).** Header nav, footer, JSON-LD, and the
  "In this section" subnav live between `<!-- chrome:* -->` markers and are
  generated from the nav tree in the script. Don't hand-edit inside the
  markers; change the script or the content outside them and re-run.

Both support `--check` (verify without writing, non-zero if stale). See
`tools/README.md` for full details on these and the audit tooling.
