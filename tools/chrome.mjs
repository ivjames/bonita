// Generates the shared page chrome — header nav, footer, venue JSON-LD, and
// per-section "In this section" subnav — as *partials* under site/partials/,
// which each page pulls in at request time via nginx SSI (`ssi on`). Pages
// carry only tiny include directives between the marker comments:
//
//   <!-- chrome:header -->
//   <!--# set var="page" value="about-visit" -->
//   <!--# set var="section" value="about" -->
//   <!--# include virtual="/partials/header.html" -->
//   <!-- /chrome:header -->
//
// The shared markup lives once in the partial instead of being copied into
// every page, so an edit to the nav/footer touches one small file and pages
// stop carrying ~100 lines of duplicated boilerplate each. Per-page state
// (aria-current, current-section) is kept server-side with SSI if/set keyed on
// the `page`/`section` vars each page sets — no JS, so pages that ship no
// script (e.g. about/visit.html) still highlight correctly.
//
// Output is committed, so nginx/deploy stay a plain `git pull` (nginx just
// assembles the includes at request time). Don't edit inside the markers or
// the partials by hand: re-running `node tools/chrome.mjs` overwrites both.
// `--check` exits 1 if any partial or page region is stale.
//
// The nav tree below is the single source of truth for the site structure.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const PARTIALS = path.join(SITE, 'partials');
const TICKETS = 'https://bonitacenterforthearts.ludus.com/index.php';

// href: page path (clean URL). home: label of the section landing page as it
// appears in that section's "In this section" subnav. sub: dropdown children.
const NAV = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about', home: 'Our story', sub: [
    { label: 'Plan your visit', href: '/about/visit' },
    { label: 'Gallery', href: '/about/gallery' },
    { label: 'Contact us', href: '/about/contact' },
    { label: 'House policies', href: '/about/policies' },
  ] },
  { label: 'Calendar', href: '/booking-calendar' },
  { label: 'Get Involved', href: '/get-involved' },
  { label: 'Rentals', href: '/rentals', home: 'Rental inquiry', sub: [
    { label: 'Rental policies', href: '/rentals/policies' },
    { label: 'Building layout', href: '/rentals/building' },
    { label: 'Technical specs', href: '/rentals/tech-specs' },
  ] },
];

// Stable per-page token used by the SSI conditionals: '/' -> home,
// '/about/visit' -> about-visit. Matches the `page`/`section` vars each page
// sets before including the header.
const token = (href) => (href === '/' ? 'home' : href.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '-'));
const inSection = (item, page) => page === item.href || page.startsWith(item.href + '/');
const sectionOf = (page) => {
  const s = NAV.find((item) => item.sub && inSection(item, page));
  return s ? token(s.href) : '';
};

// ` aria-current="page"` when the current page's token matches — emitted by
// nginx (or preview.mjs) at request time, so one partial serves every page.
const currentIf = (href) => `<!--# if expr="$page = ${token(href)}" --> aria-current="page"<!--# endif -->`;

function headerPartial() {
  const items = NAV.map((item) => {
    if (!item.sub) return `        <li><a href="${item.href}"${currentIf(item.href)}>${item.label}</a></li>`;
    // Lead the dropdown with the section landing page (e.g. "Our story"),
    // matching the "In this section" subnav so it's reachable from the menu.
    const entries = [{ label: item.home, href: item.href }, ...item.sub];
    const sub = entries.map((s) => `            <li><a href="${s.href}"${currentIf(s.href)}>${s.label}</a></li>`).join('\n');
    return `        <li class="has-sub<!--# if expr="$section = ${token(item.href)}" --> current-section<!--# endif -->">
          <a href="${item.href}"${currentIf(item.href)}>${item.label}</a>
          <ul class="sub">
${sub}
          </ul>
        </li>`;
  }).join('\n');
  return `<header class="site-header">
  <div class="bar">
    <a class="brand" href="/">
      <img src="/assets/img/bca-logo.png" alt="" width="44" height="52">
      <span class="name">Bonita Center for the Arts<small>A Bonita Unified School District venue</small></span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <ul>
${items}
        <li><a class="tickets" href="${TICKETS}">Tickets</a></li>
      </ul>
    </nav>
  </div>
</header>
`;
}

function subnavPartial(section) {
  const entries = [{ label: section.home, href: section.href }, ...section.sub];
  const items = entries.map((s) => `      <li><a href="${s.href}"${currentIf(s.href)}>${s.label}</a></li>`).join('\n');
  return `  <nav class="toc section-nav" aria-label="In this section">
    <h2>In this section</h2>
    <ul>
${items}
    </ul>
  </nav>
`;
}

const FOOTER = `<footer class="site-footer">
  <div class="cols">
    <div class="badge">
      <img src="/assets/img/bca-logo.png" alt="Bonita Center for the Arts badge logo">
    </div>
    <div>
      <h2>Contact</h2>
      <p>Office: <a href="tel:+19099718280">(909) 971-8280</a></p>
      <p>Email: <a href="mailto:KBrown@Bonita.k12.ca.us">KBrown@Bonita.k12.ca.us</a></p>
    </div>
    <div>
      <h2>Box office</h2>
      <p>Opens 1 hour before showtime</p>
      <p>Email: <a href="mailto:Kauffunger@Bonita.k12.ca.us">Kauffunger@Bonita.k12.ca.us</a></p>
      <p><a href="${TICKETS}">Buy tickets online</a></p>
    </div>
    <div>
      <h2>Visit</h2>
      <address>
        Bonita Center for the Arts<br>
        822 West Covina Boulevard<br>
        San Dimas, CA 91773
      </address>
      <p><a href="https://www.google.com/maps/search/?api=1&amp;query=Bonita+Center+for+the+Arts%2C+822+W+Covina+Blvd%2C+San+Dimas%2C+CA+91773">Get directions</a></p>
    </div>
  </div>
  <div class="fineprint">
    <p>The Bonita Center for the Arts is owned and operated by the Bonita Unified School District.</p>
  </div>
</footer>
`;

// Kept identical on every public page. At cutover, point the URLs at the
// production domain, same as the canonicals.
const JSONLD = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "PerformingArtsTheater",
  "@id": "https://bonita.lab980.com/#venue",
  "name": "Bonita Center for the Arts",
  "alternateName": "BCA",
  "description": "A 701-seat Bonita Unified School District venue in San Dimas, California, hosting performances in theater, music, and dance and offering facilities for meetings, art exhibitions and special events.",
  "url": "https://bonita.lab980.com/",
  "image": "https://bonita.lab980.com/assets/img/bca-exterior.jpg",
  "logo": "https://bonita.lab980.com/assets/img/bca-logo.png",
  "telephone": "+1-909-971-8280",
  "email": "KBrown@Bonita.k12.ca.us",
  "foundingDate": "2014",
  "maximumAttendeeCapacity": 701,
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "822 West Covina Boulevard",
    "addressLocality": "San Dimas",
    "addressRegion": "CA",
    "postalCode": "91773",
    "addressCountry": "US"
  },
  "hasMap": "https://www.google.com/maps/search/?api=1&query=Bonita+Center+for+the+Arts%2C+822+W+Covina+Blvd%2C+San+Dimas%2C+CA+91773",
  "parentOrganization": {
    "@type": "EducationalOrganization",
    "name": "Bonita Unified School District"
  },
  "sameAs": [
    "https://www.bonitacenterforthearts.com",
    "https://bonitacenterforthearts.ludus.com"
  ]
}
</script>
`;

// The committed partial files, keyed by the virtual path pages include.
function buildPartials() {
  const out = {
    'header.html': headerPartial(),
    'footer.html': FOOTER,
    'jsonld.html': JSONLD,
  };
  for (const item of NAV) if (item.sub) out[`subnav-${token(item.href)}.html`] = subnavPartial(item);
  return out;
}

// The body written between a page's <!-- chrome:NAME --> markers: the SSI
// include (plus, for the header, the per-page `set` vars the conditionals read).
function regionBody(name, page) {
  if (name === 'header') {
    return `\n<!--# set var="page" value="${token(page)}" -->\n<!--# set var="section" value="${sectionOf(page)}" -->\n<!--# include virtual="/partials/header.html" -->\n`;
  }
  if (name === 'subnav') {
    const section = sectionOf(page);
    if (!section) throw new Error(`subnav marker on ${page}, which is not inside a nav section`);
    return `\n<!--# include virtual="/partials/subnav-${section}.html" -->\n`;
  }
  return `\n<!--# include virtual="/partials/${name}.html" -->\n`;
}

async function pages(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'assets' && entry.name !== 'partials') out.push(...await pages(full));
    else if (entry.name.endsWith('.html') && entry.name !== 'admin.html') out.push(full);
  }
  return out;
}

const check = process.argv.includes('--check');
let stale = 0;

// 1) Partials.
const partials = buildPartials();
if (!check) await mkdir(PARTIALS, { recursive: true });
for (const [name, body] of Object.entries(partials)) {
  const file = path.join(PARTIALS, name);
  const cur = await readFile(file, 'utf8').catch(() => null);
  if (cur === body) continue;
  stale++;
  if (check) console.error(`stale partial: partials/${name}`);
  else { await writeFile(file, body); console.log(`wrote partials/${name}`); }
}

// 2) Page chrome regions (markers now wrap SSI directives).
for (const file of await pages(SITE)) {
  const page = '/' + path.relative(SITE, file).replace(/\.html$/, '').replace(/^index$/, '').replace(/\\/g, '/');
  const src = await readFile(file, 'utf8');
  const out = src.replace(
    /(<!-- chrome:(header|footer|jsonld|subnav) -->)[\s\S]*?(<!-- \/chrome:\2 -->)/g,
    (_, open, name, close) => open + regionBody(name, page) + close,
  );
  if (out === src) continue;
  stale++;
  if (check) console.error(`stale chrome: ${path.relative(SITE, file)}`);
  else { await writeFile(file, out); console.log(`stamped ${path.relative(SITE, file)}`); }
}

if (check && stale) process.exit(1);
console.log(check ? 'chrome up to date' : `done (${stale} file(s) updated)`);
