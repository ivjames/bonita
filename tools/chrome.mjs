// Stamps the shared page chrome (header nav, footer, venue JSON-LD, and
// per-section subnav) into every page in site/, between marker comments:
//
//   <!-- chrome:header --> ... <!-- /chrome:header -->
//
// Blocks: header, footer, jsonld, subnav. A page only gets the blocks whose
// markers it carries (404.html has no jsonld; admin.html is skipped entirely —
// its reduced nav is hand-maintained). Output is committed, so nginx/deploy
// stay a plain `git pull`. Don't edit inside the markers by hand: re-running
// `node tools/chrome.mjs` overwrites it. `--check` exits 1 if any file is
// stale (run it before committing chrome edits).
//
// The nav tree below is the single source of truth for the site structure.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const TICKETS = 'https://bonitacenterforthearts.ludus.com/index.php';

// href: page path (clean URL). home: label of the section landing page as it
// appears in that section's "In this section" subnav. sub: dropdown children.
const NAV = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about', home: 'Our story', sub: [
    { label: 'Plan your visit', href: '/about/visit' },
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

const current = (href, page) => (href === page ? ' aria-current="page"' : '');
const inSection = (item, page) => page === item.href || page.startsWith(item.href + '/');

function header(page) {
  const items = NAV.map((item) => {
    if (!item.sub) return `        <li><a href="${item.href}"${current(item.href, page)}>${item.label}</a></li>`;
    const cls = inSection(item, page) ? 'has-sub current-section' : 'has-sub';
    const sub = item.sub.map((s) => `            <li><a href="${s.href}"${current(s.href, page)}>${s.label}</a></li>`).join('\n');
    return `        <li class="${cls}">
          <a href="${item.href}"${current(item.href, page)}>${item.label}</a>
          <ul class="sub">
${sub}
          </ul>
        </li>`;
  }).join('\n');
  return `
<header class="site-header">
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

function subnav(page) {
  const section = NAV.find((item) => item.sub && inSection(item, page));
  if (!section) throw new Error(`subnav marker on ${page}, which is not inside a nav section`);
  const entries = [{ label: section.home, href: section.href }, ...section.sub];
  const items = entries.map((s) => `      <li><a href="${s.href}"${current(s.href, page)}>${s.label}</a></li>`).join('\n');
  return `
  <nav class="toc section-nav" aria-label="In this section">
    <h2>In this section</h2>
    <ul>
${items}
    </ul>
  </nav>
`;
}

const FOOTER = `
<footer class="site-footer">
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
const JSONLD = `
<script type="application/ld+json">
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

async function pages(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'assets') out.push(...await pages(full));
    else if (entry.name.endsWith('.html') && entry.name !== 'admin.html') out.push(full);
  }
  return out;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const file of await pages(SITE)) {
  const page = '/' + path.relative(SITE, file).replace(/\.html$/, '').replace(/^index$/, '').replace(/\\/g, '/');
  const blocks = { header: header(page), footer: FOOTER, jsonld: JSONLD, subnav: subnav };
  const src = await readFile(file, 'utf8');
  const out = src.replace(
    /(<!-- chrome:(header|footer|jsonld|subnav) -->)[\s\S]*?(<!-- \/chrome:\2 -->)/g,
    (_, open, name, close) => {
      const body = blocks[name];
      return open + (typeof body === 'function' ? body(page) : body) + close;
    },
  );
  if (out === src) continue;
  stale++;
  if (check) console.error(`stale chrome: ${path.relative(SITE, file)}`);
  else { await writeFile(file, out); console.log(`stamped ${path.relative(SITE, file)}`); }
}
if (check && stale) process.exit(1);
console.log(check ? 'chrome up to date' : `done (${stale} file(s) updated)`);
