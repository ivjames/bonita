import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.join(process.cwd(), 'fixtures');
const types = { '.html':'text/html', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.pdf':'application/pdf' };
const s = http.createServer(async (req, res) => {
  let p = decodeURI(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(path.join(root, p));
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nf'); }
});
s.listen(8199, '127.0.0.1', () => console.log('serving on 8199'));
