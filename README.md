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
- [ ] Choose the stack for the self-hosted DO droplet
- [ ] Calendar solution to replace the Wix bookings widget
- [ ] Ludus ticketing integration approach
- [ ] URL redirect strategy
- [ ] Sitewide contact corrections (Stone → Brown)

## Repo layout

```
tools/          audit crawler (crawl + axe-core), test fixtures, README
audit/reports/  generated audit output, one subdirectory per model run (fable/)
```
