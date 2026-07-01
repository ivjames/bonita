# BCA content & asset inventory

Base: http://127.0.0.1:8199/
Pages crawled: 3

## Fixture Home
`http://127.0.0.1:8199/` — HTTP 200 — lang=en

Meta description: Test home page

**Headings (2)**

- H1: Welcome
    - H3: Jumped a level ⚠️skips level

**Images (5, 3 with missing/auto-generated alt)**

- ⚠️ auto-generated? `http://127.0.0.1:8199/photos/DSC_0421.jpg` — alt: "DSC_0421.jpg"
- ✅ `http://127.0.0.1:8199/photos/hero.jpg` — alt: "Students performing on the mainstage"
- ❌ no alt attr `http://127.0.0.1:8199/logo.png` — alt: —
- ⬜ empty alt (decorative?) `http://127.0.0.1:8199/spacer.gif` — alt: ""
- ⚠️ auto-generated? `http://127.0.0.1:8199/seat-thumb.png` — alt: "seat-thumb.png"

**Embeds / iframes (1)**

- `https://player.vimeo.com/video/12345` — ⚠️ no title

**PDF links (1)**

- `http://127.0.0.1:8199/seating.pdf` — link text: "" ⚠️ no accessible name

**External hosts linked:** bonitacenterforthearts.ludus.com

**Forms (1)**

- Form 1 → `http://127.0.0.1:8199/lostfound` — 2 controls, 1 unlabeled ⚠️

---

## About
`http://127.0.0.1:8199/about.html` — HTTP 200 — lang=MISSING

**Headings (1)**

  - H2: About us

> ⚠️ 0 H1 elements (expected exactly 1)

**Images (1, 1 with missing/auto-generated alt)**

- ❌ no alt attr `http://127.0.0.1:8199/team.jpg` — alt: —

---

## Fixture Home
`http://127.0.0.1:8199/index.html` — HTTP 200 — lang=en

Meta description: Test home page

**Headings (2)**

- H1: Welcome
    - H3: Jumped a level ⚠️skips level

**Images (5, 3 with missing/auto-generated alt)**

- ⚠️ auto-generated? `http://127.0.0.1:8199/photos/DSC_0421.jpg` — alt: "DSC_0421.jpg"
- ✅ `http://127.0.0.1:8199/photos/hero.jpg` — alt: "Students performing on the mainstage"
- ❌ no alt attr `http://127.0.0.1:8199/logo.png` — alt: —
- ⬜ empty alt (decorative?) `http://127.0.0.1:8199/spacer.gif` — alt: ""
- ⚠️ auto-generated? `http://127.0.0.1:8199/seat-thumb.png` — alt: "seat-thumb.png"

**Embeds / iframes (1)**

- `https://player.vimeo.com/video/12345` — ⚠️ no title

**PDF links (1)**

- `http://127.0.0.1:8199/seating.pdf` — link text: "" ⚠️ no accessible name

**External hosts linked:** bonitacenterforthearts.ludus.com

**Forms (1)**

- Form 1 → `http://127.0.0.1:8199/lostfound` — 2 controls, 1 unlabeled ⚠️

---

