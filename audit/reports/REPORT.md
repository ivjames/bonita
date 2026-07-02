# BCA audit — consolidated report

One merged view of the two committed audit runs in this directory:

| Run | What it is | Base | Pages | Detail files |
|-----|------------|------|------:|--------------|
| **`fable/`** | **Live-site audit** of the current Wix site, 2026-07-01, plus Lighthouse 13.4.0 lab runs | `https://www.bonitacenterforthearts.com` | 5 | `fable/summary.md`, `fable/inventory.md`, `fable/a11y.md`, `fable/lighthouse.md`, `fable/lighthouse/*.report.html` |
| **`opus/`** | **Tool self-test** against local fixtures with deliberately planted defects (see `opus/README.md`) — validates `tools/audit.mjs`, not the real site | `http://127.0.0.1:8199/` | 3 | `opus/summary.md`, `opus/inventory.md`, `opus/a11y.md` |

The two runs answer different questions, so this report doesn't sum their
numbers. Sections 1–3 are the site findings (from the fable run). Section 4
uses the opus fixture run for what it's good for: establishing which defect
classes the tooling provably detects, and therefore how much confidence to
place in the live site's clean results.

## 1. Live site at a glance (fable run, 2026-07-01)

- 5 pages crawled (Home, About, Calendar, Get Involved, Rentals), 0 crawl errors
- 18 images, **12 with missing or auto-generated (filename) alt text**
- 26 axe violation instances across 4 distinct rules
- Lighthouse: Performance 71–85, Accessibility 92–95, SEO 92–100

### axe-core violations (WCAG 2.1 A/AA + best-practice)

| Impact | Rule | Instances | Where |
|---|---|---:|---|
| serious | `frame-title` | 1 | About — untitled Wix gallery iframe (`static.parastorage.com`) |
| serious | `link-name` | 1 | About — Rachlin Architects link with no discernible text |
| moderate | `heading-order` | 8 | Rentals — H2 → H5 jumps throughout the tech-specs sections |
| minor | `empty-heading` | 16 | Rentals — empty `<h5>` spacer headings |

Home, Calendar, and Get Involved scanned clean at the document level.

### Content/inventory issues (beyond axe)

- **Alt text**: no image is missing the `alt` attribute outright, but most
  non-decorative images carry auto-generated filenames as alt
  ("BCA Beta Background.png", "Snip of Stage with Dims.PNG", …). The shared
  header background image and an empty-alt footer image repeat on every page.
- **H1 structure** (inventory heading check):
  - About and Calendar have **0 H1** elements
  - Get Involved has **2 H1s** ("Apply to be BCA Staff!", "Volunteer!")
  - Home's only H1 is the events-strip caption text, not the site/page title
  - (axe's `page-has-heading-one` best-practice rule did not fire on these
    pages, so treat the H1 findings as sourced from the inventory's own
    heading extraction.)
- **Unlabeled form controls**: the Rentals inquiry form has **5 of 6 controls
  unlabeled**. The About (lost & found) form is fully labeled.
- **PDF links with no accessible name**: 3 total — 1 on About (seating chart)
  and 2 on Rentals (building layout, stage dims). All are "click image to open
  PDF" patterns.
- **Missing meta description** on Calendar, Get Involved, and Rentals
  (Home and About have one — Lighthouse SEO 92 vs 100 tracks this exactly).

## 2. Lighthouse (lab, mobile emulation)

| Page | Perf | A11y | Best practices | SEO | LCP | TBT | CLS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Home | 85 | 94 | 100 | 100 | 2.1 s | 250 ms | 0.017 |
| About | 82 | 92 | 100 | 100 | 2.0 s | 360 ms | 0.043 |
| Calendar | 80 | 94 | 100 | 92 | 2.1 s | 350 ms | 0.046 |
| Get Involved | 71 | 95 | 100 | 92 | 3.4 s | 290 ms | 0.063 |
| Rentals | 76 | 94 | 77 | 92 | 2.1 s | 450 ms | 0.109 |

- **TTFB is the biggest performance lever** (1.0–1.8 s estimated savings on
  every page except Home) and **~257 KB of unused JavaScript loads on every
  page** — both are Wix platform costs that the migration removes for free.
- Lighthouse's accessibility pass adds one finding the document-level axe scan
  missed: **buttons without an accessible name on every page** (Wix chrome —
  hamburger/nav buttons).
- Rentals is the outlier page: heaviest DOM, worst CLS (0.109) and TBT
  (450 ms), and best-practices 77 from third-party cookies set by the Vimeo
  autoplay embed.

## 3. Consolidated issue list for the migration

Ordered by impact; "source" says which underlying report has the detail.

| # | Issue | Pages | Source |
|--:|-------|-------|--------|
| 1 | Rentals inquiry form: 5/6 controls unlabeled | Rentals | `fable/inventory.md` |
| 2 | Buttons with no accessible name (Wix nav chrome) | all 5 | `fable/lighthouse.md` |
| 3 | Auto-generated filename alt text on 12 of 18 images | all 5 | `fable/inventory.md` |
| 4 | PDF links with no accessible name ("click image" pattern) | About, Rentals | `fable/inventory.md` |
| 5 | Untitled gallery iframe | About | `fable/a11y.md` |
| 6 | Link with no discernible text (Rachlin Architects) | About | `fable/a11y.md` |
| 7 | Broken heading hierarchy: H2→H5 skips (8) + empty headings (16) | Rentals | `fable/a11y.md` |
| 8 | H1 structure: 0 H1 (About, Calendar), 2 H1s (Get Involved), wrong H1 (Home) | 4 of 5 | `fable/inventory.md` |
| 9 | Missing meta descriptions | Calendar, Get Involved, Rentals | `fable/lighthouse.md` |
| 10 | Rentals CLS 0.109 / third-party cookies from Vimeo autoplay embed | Rentals | `fable/lighthouse.md` |
| 11 | Slow TTFB + ~257 KB unused Wix JS (platform-inherent) | all 5 | `fable/lighthouse.md` |

All of these are content/markup issues the rebuild in `site/` addresses (the
repo README records a clean axe run against the rebuilt site: 0 violations,
0 bad alt, all forms labeled, one H1 per page); #11 disappears with the move
off Wix entirely. Items worth double-checking in the rebuild specifically:
click-to-load (or non-autoplay) treatment for the Vimeo embed (#10), and
descriptive link text for the seating-chart and tech-spec PDFs (#4).

## 4. What the opus fixture run tells us (tool validation)

The opus run crawled 3 fixture pages with planted defects and reported
39 axe instances across 8 rules plus the expected inventory flags — i.e. the
tool detected **every planted defect class**:

- axe rules exercised: `image-alt` (critical), `frame-title`,
  `color-contrast`, `html-has-lang`, `region`, `landmark-one-main`,
  `heading-order`, `page-has-heading-one`
- inventory checks exercised: missing `alt` attribute, auto-generated
  (filename) alt, empty alt, untitled iframe, PDF link with no accessible
  name, unlabeled form control, missing `lang`, 0-H1 page, heading level skip

That validation is what gives the live run's *absences* weight. Rules the
fixture proves the tool catches but that did **not** fire on the live site —
and can therefore be read as genuine passes rather than blind spots:

- `image-alt` — no live image is missing the attribute (the live problem is
  low-quality filename alt, which axe can't judge; the inventory catches it)
- `html-has-lang` — all live pages declare `lang="en"`
- `color-contrast`, `region`, `landmark-one-main` — clean on all 5 live pages

Two caveats the fixture run surfaces about the tool itself:

- The crawler counts `/` and `/index.html` as separate pages (both appear in
  the fixture output), so page/instance totals can be slightly inflated when
  a site links both forms.
- The axe scan is document-level; it missed the live site's `button-name`
  issue that Lighthouse's page-level pass caught (§2). Treat axe + Lighthouse
  together as the accessibility picture, not axe alone.

## 5. File map

```
audit/reports/
├── REPORT.md              ← this consolidated report
├── fable/                 ← live-site audit, 2026-07-01
│   ├── summary.md         top-level counts
│   ├── inventory.md/.json per-page headings, images+alt, links, embeds, PDFs, forms
│   ├── a11y.md/.json      axe-core scan, by rule + per page
│   ├── lighthouse.md      scores, opportunities, migration takeaways
│   └── lighthouse/        full per-page HTML reports
└── opus/                  ← fixture self-test of tools/audit.mjs
    ├── README.md          what the fixture run is (and is not)
    ├── summary.md, inventory.md/.json, a11y.md/.json
```
