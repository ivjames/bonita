# BCA Lighthouse audit (lab)

Run 2026-07-01, Lighthouse 13.4.0, mobile emulation with simulated throttling
(the same lab setup PageSpeed Insights uses; no CrUX field data). Full
per-page HTML reports are alongside this file (`lighthouse/<page>.report.html`).

Repro: `cd tools && CHROME_PATH=/opt/pw-browsers/chromium npx lighthouse <url>
--chrome-flags="--headless=new --no-sandbox --proxy-server=$HTTPS_PROXY"`

## Scores

| Page | Perf | A11y | Best practices | SEO | FCP | LCP | TBT | CLS | Speed Index |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Home | 85 | 94 | 100 | 100 | 2.1 s | 2.1 s | 250 ms | 0.017 | 7.8 s |
| About | 82 | 92 | 100 | 100 | 1.9 s | 2.0 s | 360 ms | 0.043 | 7.1 s |
| Calendar | 80 | 94 | 100 | 92 | 2.1 s | 2.1 s | 350 ms | 0.046 | 9.6 s |
| Get Involved | 71 | 95 | 100 | 92 | 3.3 s | 3.4 s | 290 ms | 0.063 | 8.1 s |
| Rentals | 76 | 94 | 77 | 92 | 2.0 s | 2.1 s | 450 ms | 0.109 | 7.3 s |

## Performance opportunities

- **Server response time (TTFB) is the biggest lever**: 1.0–1.8 s estimated
  savings on every page except Home (About 1.6 s, Rentals 1.8 s, Get Involved
  1.3 s, Calendar 1.1 s). This is Wix's rendering infrastructure — largely
  fixed by the migration off Wix; hard to fix within Wix.
- **~257 KB of unused JavaScript on every page** — the Wix platform bundle.
  Also goes away with the migration.
- Speed Index is 7–10 s everywhere: the pages paint late as Wix hydrates.
- CLS is fine except Rentals (0.109, borderline) — the long tech-specs page
  shifts as images/embeds load.

## Non-performance findings

- **Buttons without an accessible name — every page** (Lighthouse/axe
  `button-name`; this fires on Wix chrome such as the hamburger/nav buttons,
  which the earlier document-level axe scan in `a11y.md` did not flag).
- Links without a discernible name — About (the Rachlin Architects link,
  matches `a11y.md`).
- Non-sequential heading order — Rentals (matches `a11y.md`).
- **No meta description** on Calendar, Get Involved, Rentals (SEO 92s).
- Rentals best-practices 77: third-party cookies (2) and DevTools issues
  logged — Vimeo autoplay embed is the likely source.

## Takeaways for the migration

1. The two big performance costs (TTFB, unused Wix JS) are platform-inherent —
   a static/self-hosted rebuild should push Perf scores into the 90s without
   special effort.
2. Carry the content fixes regardless of platform: meta descriptions on all
   pages, accessible names for icon buttons/links, heading hierarchy.
3. Keep an eye on the Rentals page in the rebuild: heaviest DOM, worst CLS and
   TBT, third-party cookie source (Vimeo embed — consider click-to-load).
