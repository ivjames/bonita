// Render the rental policies page to a committed PDF: the download the
// /rentals/policies "Download PDF" button links to. We generate it here rather
// than let each visitor's browser convert, so the file is a stable, branded
// artifact (running header/footer, page margins, no background ink) that
// deploys with a plain `git pull`.
//
//   node tools/render-policies-pdf.mjs
//
// Re-run this whenever the policy text or the print stylesheet changes, then
// commit site/assets/pdf/bca-rental-policies.pdf. Uses the same print CSS the
// page carries (@media print in site.css), driven through the local preview
// server so root-relative asset URLs resolve exactly as on the droplet.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'site', 'assets', 'pdf', 'bca-rental-policies.pdf',
);

// Importing preview.mjs starts the static server on 127.0.0.1:8288.
await import('./preview.mjs');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8288/rentals/policies', { waitUntil: 'networkidle' });
await page.pdf({
  path: OUT,
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true, // honour the @page margins from site.css
});
await browser.close();
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
process.exit(0);
