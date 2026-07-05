// Local preview of the rebuilt static site with nginx-equivalent clean URLs
// (try_files $uri $uri.html): `node preview.mjs` then open 127.0.0.1:8288.
// Lets the audit tool (and a browser) exercise site/ exactly as nginx will
// serve it on the droplet.
//
// Like nginx on the droplet, /api/* is proxied to the bca-api backend
// (127.0.0.1:8787, see deploy/api/). If the backend isn't running the
// request just errors and the site behaves as static-only — same as prod.
//
// It also mimics nginx `ssi on`: the shared chrome lives in site/partials/ and
// is pulled into each page with <!--# include -->, so pages must be assembled
// before they're served or local preview (and the policies-PDF render) would
// show no header/footer. renderSSI() below supports the exact directives
// chrome.mjs emits — set / include virtual / if(=)…endif — nothing more.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain',
};

// Minimal nginx-SSI equivalent. `vars` is the per-request scope shared with
// included partials (so a partial's `if` sees the page's `set`s), matching how
// nginx keeps SSI variables request-scoped. Only the directive forms chrome.mjs
// generates are handled.
const attr = (s, name) => (s.match(new RegExp(`${name}="([^"]*)"`)) || [, ''])[1];
async function renderSSI(html, vars) {
  const re = /<!--#\s*(set|include|if|endif)\b([^>]*?)-->/g;
  const stack = [];                              // nested if-blocks: is each active?
  const on = () => stack.every((f) => f);        // emit only when every enclosing if is true
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    if (on()) out += html.slice(last, m.index);
    last = re.lastIndex;
    const [, kind, rest] = m;
    if (kind === 'set') {
      if (on()) vars[attr(rest, 'var')] = attr(rest, 'value');
    } else if (kind === 'include') {
      if (on()) {
        const virtual = attr(rest, 'virtual').replace(/^\//, '');
        out += await renderSSI(await readFile(path.join(root, virtual), 'utf8'), vars);
      }
    } else if (kind === 'if') {
      const [, name, val] = attr(rest, 'expr').match(/^\$(\w+)\s*=\s*(.*)$/) || [];
      stack.push(on() && (vars[name] ?? '') === (val || '').replace(/^"(.*)"$/, '$1'));
    } else if (kind === 'endif') {
      stack.pop();
    }
  }
  if (on()) out += html.slice(last);
  return out;
}

const s = http.createServer(async (req, res) => {
  let p = decodeURI(req.url.split('?')[0]);
  if (p.startsWith('/api/')) {
    const up = http.request({ host: '127.0.0.1', port: 8787, path: req.url, method: req.method, headers: req.headers }, (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    });
    up.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"backend not running"}'); });
    return req.pipe(up);
  }
  if (p === '/') p = '/index.html';
  // /partials/ is internal on the droplet — only reachable via SSI subrequests,
  // never fetched directly. Mirror that so preview matches prod.
  if (p.startsWith('/partials/')) { res.writeHead(404); return res.end('not found'); }
  const candidates = path.extname(p) ? [p] : [p, `${p}.html`, `${p}/index.html`];
  for (const c of candidates) {
    try {
      let buf = await readFile(path.join(root, c));
      if (path.extname(c) === '.html') buf = Buffer.from(await renderSSI(buf.toString('utf8'), {}));
      res.writeHead(200, { 'content-type': types[path.extname(c)] || 'application/octet-stream' });
      return res.end(buf);
    } catch { /* try next candidate */ }
  }
  try {
    const buf = Buffer.from(await renderSSI(await readFile(path.join(root, '404.html'), 'utf8'), {}));
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
s.listen(8288, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:8288`));
