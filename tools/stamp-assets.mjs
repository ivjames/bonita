// stamp-assets — content-hash cache-busting for the static site.
//
//   node tools/stamp-assets.mjs          rewrite the stamps in place
//   node tools/stamp-assets.mjs --check  verify only; exit 1 if any are stale
//
// Every local CSS/JS reference in site/**/*.html carries a `?v=…` query. This
// rewrites that token to the first 8 hex of the sha256 of the referenced
// file's current bytes, so the URL changes if and only if the file's content
// changes — browsers refetch exactly when they must and cache forever
// otherwise. It replaces the old hand-picked `?v=5,6,7…` integers, which had
// to be bumped by memory and collided whenever two branches bumped in
// parallel (a merge of the same integer served stale assets).
//
// No build step: the stamped hashes live in the committed HTML and deploy
// as-is with `git pull`. Run it after changing a stylesheet or script (or let
// a pre-commit hook run `--check`), then commit the result.
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const check = process.argv.includes('--check');

// Matches href/src="/path/to/asset.css?v=TOKEN" (local, root-relative CSS/JS).
const REF = /((?:href|src)=")(\/[^"?]+\.(?:css|js))\?v=[^"]*(")/g;

async function htmlFiles(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await htmlFiles(full));
    else if (ent.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const hashes = new Map();   // asset url path -> short hash (memoised)
async function hashOf(urlPath) {
  if (hashes.has(urlPath)) return hashes.get(urlPath);
  const bytes = await readFile(path.join(root, urlPath.replace(/^\//, '')));
  const h = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  hashes.set(urlPath, h);
  return h;
}

let stale = 0;
let stamped = 0;
const missing = [];

for (const file of await htmlFiles(root)) {
  const src = await readFile(file, 'utf8');
  const edits = [];
  // Collect replacements (async hashing) before rewriting the string.
  for (const m of src.matchAll(REF)) {
    let h;
    try { h = await hashOf(m[2]); }
    catch { missing.push(m[2]); continue; }
    edits.push({ match: m[0], repl: `${m[1]}${m[2]}?v=${h}${m[3]}` });
  }
  let out = src;
  for (const e of edits) if (e.match !== e.repl) out = out.replace(e.match, e.repl);
  if (out !== src) {
    stale += 1;
    if (!check) { await writeFile(file, out); stamped += 1; }
    console.log(`${check ? 'stale' : 'stamped'}: ${path.relative(root, file)}`);
  }
}

if (missing.length) {
  console.error(`\nreferenced but not found:\n  ${[...new Set(missing)].join('\n  ')}`);
  process.exit(2);
}

console.log('\nasset hashes:');
for (const [p, h] of [...hashes].sort()) console.log(`  ${h}  ${p}`);

if (check && stale) {
  console.error(`\n${stale} file(s) have stale stamps — run: node tools/stamp-assets.mjs`);
  process.exit(1);
}
console.log(check ? '\nall stamps current' : `\ndone (${stamped} file(s) updated)`);
