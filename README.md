# Bonita Center for the Arts — website

Working repo for maintaining and eventually rebuilding
[bonitacenterforthearts.com](https://www.bonitacenterforthearts.com), migrating
it off Wix onto a self-hosted DigitalOcean droplet.

- **Live site:** https://www.bonitacenterforthearts.com (Wix)
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

## Known issues to fix (in Wix now, or carry into the rebuild)

- Contact info stale: About contact block + footer on Rentals/Calendar still show
  **Stone / Stone@Bonita.k12.ca.us** → should be **Brown / KBrown@Bonita.k12.ca.us**
- Calendar page renders blank without JS (no static fallback)
- "Gallery" section on About is actually just a lost & found form — no real gallery
- Seating chart is a PDF behind an unlabeled image ("CLICK IMAGE TO OPEN PDF")
- 2015 Vimeo opening video duplicated on Home and Rentals
- Wix-generated filename alt text likely throughout

## Accessibility

Audit tooling lives in [`tools/`](tools/) — a headless-Chromium crawler that
generates a content/asset inventory and an axe-core WCAG 2.1 A/AA scan. It is
built and verified against a local fixture, but **cannot run from the current web
environment because the network policy denies outbound HTTPS**; run it from an
environment with web access or locally. See [`tools/README.md`](tools/README.md).

Reports (once generated) go to [`audit/reports/`](audit/reports/).

### Running the audit (enabling web access)

The crawler needs outbound web access, which a **Trusted** (default) Claude Code
web environment does not grant — package registries and GitHub only, no arbitrary
sites — so the live scan can't run from such a session. To enable it, edit the
environment's **Network access** in the web UI (claude.ai/code → cloud/environment
selector → hover the environment → gear icon → **Network access**) and pick:

- **Full** — simplest; it's a read-only crawl of a public site.
- **Custom** — tighter. Check *"Also include default list of common package
  managers"* (keeps `npm install` working) and allow:

  ```text
  bonitacenterforthearts.com
  www.bonitacenterforthearts.com
  *.wixstatic.com      # Wix images/assets
  *.parastorage.com    # Wix JS/CSS
  *.wix.com
  bonitacenterforthearts.ludus.com
  player.vimeo.com
  *.vimeocdn.com
  ```

The policy is fixed when a session starts, so **start a new session** after
editing, then run the audit command from [`tools/README.md`](tools/README.md).
axe-core is bundled and installed from npm, so the only host the policy must
unblock is the BCA site itself. Docs:
https://code.claude.com/docs/en/claude-code-on-the-web#network-access

## Migration TODO

- [ ] Get Wix admin access (via Kyle Brown / BUSD)
- [ ] Full content + asset audit before leaving Wix — tooling ready in `tools/`
- [ ] Accessibility audit (axe-core via `tools/audit.mjs`; add Lighthouse/pa11y)
- [ ] Choose the stack for the self-hosted DO droplet
- [ ] Calendar solution to replace the Wix bookings widget
- [ ] Ludus ticketing integration approach
- [ ] URL redirect strategy
- [ ] Sitewide contact corrections (Stone → Brown)

## Repo layout

```
tools/          audit crawler (crawl + axe-core), test fixtures, README
audit/reports/  generated audit output (empty until the audit runs)
```
