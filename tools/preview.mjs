// Local preview of the rebuilt static site with nginx-equivalent clean URLs
// (try_files $uri $uri.html): `node preview.mjs` then open 127.0.0.1:8288.
// Lets the audit tool (and a browser) exercise site/ exactly as nginx will
// serve it on the droplet.
//
// Like nginx on the droplet, /api/* is proxied to the bca-api backend
// (127.0.0.1:8787, see deploy/api/). If the backend isn't running the
// request just errors and the site behaves as static-only — same as prod.
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
  const candidates = path.extname(p) ? [p] : [p, `${p}.html`, `${p}/index.html`];
  for (const c of candidates) {
    try {
      const buf = await readFile(path.join(root, c));
      res.writeHead(200, { 'content-type': types[path.extname(c)] || 'application/octet-stream' });
      return res.end(buf);
    } catch { /* try next candidate */ }
  }
  try {
    const buf = await readFile(path.join(root, '404.html'));
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
s.listen(8288, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:8288`));
