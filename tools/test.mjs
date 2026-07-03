// Offline test for audit.mjs.
//
// Serves fixtures/ (a page with deliberately planted defects), runs the full
// audit against it with no network, and asserts the tool DETECTS each planted
// defect. This is the real value of the fixture: if a change to audit.mjs
// silently stops catching missing alt / heading skips / untitled iframes /
// unlabeled controls / low contrast, this test fails loudly.
//
// Run: node test.mjs   (or: npm test)

import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8199;
const BASE = `http://127.0.0.1:${PORT}/`;

// ---- tiny assert harness ----------------------------------------------------
const results = [];
const check = (name, cond) => { results.push({ name, ok: !!cond }); };

// ---- process helpers --------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['serve.mjs'], { cwd: dir });
    const t = setTimeout(() => reject(new Error('serve.mjs did not start within 5s')), 5000);
    proc.stdout.on('data', (b) => { if (String(b).includes(`on ${PORT}`)) { clearTimeout(t); resolve(proc); } });
    proc.stderr.on('data', (b) => process.stderr.write(b));
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`serve.mjs exited early (${code})`)); });
  });
}

function runAudit(outDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node',
      ['audit.mjs', BASE, '--no-proxy', '--max', '10', '--wait', '300', '--out', outDir],
      { cwd: dir });
    let err = '';
    proc.stderr.on('data', (b) => { err += b; });
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`audit.mjs exited ${code}: ${err.slice(0, 400)}`)));
  });
}

// audit's own heading-skip rule (kept in sync with audit.mjs report logic).
const hasHeadingSkip = (headings) => {
  let prev = 0;
  for (const h of headings) { if (prev && h.level > prev + 1) return true; prev = h.level; }
  return false;
};

// ---- main -------------------------------------------------------------------
let server, outDir;
try {
  server = await startServer();
  outDir = await mkdtemp(path.join(tmpdir(), 'bca-audit-test-'));
  await runAudit(outDir);

  const inv = JSON.parse(await readFile(path.join(outDir, 'inventory.json'), 'utf8'));
  const a11y = JSON.parse(await readFile(path.join(outDir, 'a11y.json'), 'utf8'));

  const indexPage = inv.pages.find((p) => p.iframes.length > 0);
  const aboutPage = inv.pages.find((p) => /about\.html$/.test(p.url));

  const axeRules = new Set(a11y.pages.flatMap((p) => p.violations.map((v) => v.id)));
  const isFilenameAlt = (alt) => /\.(jpe?g|png|gif|webp|svg)$/i.test((alt || '').trim());

  // crawl sanity
  check('crawl produced pages', inv.pages.length >= 2);
  check('no crawl errors', inv.errors.length === 0);
  check('found the index fixture (has iframe)', !!indexPage);
  check('found the about fixture', !!aboutPage);

  if (indexPage) {
    check('detects heading skip (h1 → h3)', hasHeadingSkip(indexPage.headings));
    check('detects image with no alt attr', indexPage.images.some((i) => !i.hasAltAttr));
    check('detects filename-as-alt image', indexPage.images.some((i) => i.hasAltAttr && isFilenameAlt(i.alt)));
    check('detects untitled iframe', indexPage.iframes.some((f) => !f.title));
    check('detects Vimeo embed missing dnt=1 (third-party cookies)', indexPage.iframes.some((f) => f.dntMissing));
    // control case: a Vimeo embed that already has ?dnt=1 must NOT be flagged
    check('Vimeo embed with dnt=1 is not flagged', indexPage.iframes.some((f) => /player\.vimeo\.com/.test(f.src) && /[?&]dnt=1\b/.test(f.src) && !f.dntMissing));
    check('detects unlabeled form control', indexPage.forms.some((f) => f.controls.some((c) => !c.labelled)));
    // control case: a genuinely-decorative empty alt must NOT masquerade as a defect
    check('decorative empty alt is not a filename-alt', indexPage.images.some((i) => i.hasAltAttr && i.alt === '' && !isFilenameAlt(i.alt)));
  }

  if (aboutPage) {
    check('detects missing lang attribute', !aboutPage.lang);
    check('detects wrong <h1> count (0 on about)', aboutPage.headings.filter((h) => h.level === 1).length !== 1);
    check('detects image with no alt attr (about)', aboutPage.images.some((i) => !i.hasAltAttr));
  }

  // axe-core wiring: the scan runs and surfaces the expected rules
  check('axe flags low-contrast text', axeRules.has('color-contrast'));
  check('axe flags missing image alt', axeRules.has('image-alt'));
} catch (e) {
  check(`harness ran without throwing (${String(e.message).slice(0, 120)})`, false);
} finally {
  if (server) server.kill();
  if (outDir) await rm(outDir, { recursive: true, force: true }).catch(() => {});
}

// ---- report -----------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
