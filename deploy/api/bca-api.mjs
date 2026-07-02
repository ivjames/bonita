// bca-api — tiny form/admin backend for bonita.lab980.com. Node stdlib only.
//
// Listens on 127.0.0.1 (never exposed directly); nginx proxies /api/* to it
// and enforces auth on the staff endpoints (see deploy/nginx/bca-api.locations).
//
// Endpoints:
//   GET  /api/health          -> {ok:true}  (admin page uses this to decide
//                                whether to show its "Save to site" button)
//   PUT  /api/events          -> validate + atomically write events.json to
//                                $BCA_DATA/events.json, keeping timestamped
//                                backups. nginx serves that file for
//                                /assets/data/events.json via an alias, so
//                                staff saves survive `sudo bonita` deploys
//                                (which rsync --delete the webroot).
//   POST /api/forms           -> append a form submission (rental inquiry /
//                                lost & found) to $BCA_DATA/forms.jsonl and,
//                                if sendmail exists and $BCA_MAIL_TO is set,
//                                email it. The public forms currently use
//                                mailto: links; point them here when ready.
//
// Config (environment):
//   BCA_DATA    data directory (default /var/lib/bca; the systemd unit sets
//               this via StateDirectory)
//   BCA_LISTEN  port on 127.0.0.1 (default 8787)
//   BCA_MAIL_TO recipient for form email notifications (optional)

import http from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, unlink, writeFile, appendFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const DATA = process.env.BCA_DATA || '/var/lib/bca';
const PORT = Number(process.env.BCA_LISTEN || 8787);
const MAIL_TO = process.env.BCA_MAIL_TO || '';
const SENDMAIL = '/usr/sbin/sendmail';
const MAX_BODY = 256 * 1024;
const MAX_EVENTS = 200;
const KEEP_BACKUPS = 30;

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

// Mirrors the checks in site/assets/js/admin.js — what the admin page
// flags, the server refuses.
function validateEvents(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return 'body must be a JSON object';
  if (!Array.isArray(data.events)) return 'missing "events" array';
  if (data.events.length > MAX_EVENTS) return `more than ${MAX_EVENTS} events`;
  for (const [i, e] of data.events.entries()) {
    const at = `events[${i}]`;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return `${at} must be an object`;
    for (const [k, v] of Object.entries(e)) {
      if (typeof v !== 'string') return `${at}.${k} must be a string`;
      if (v.length > 500) return `${at}.${k} too long`;
    }
    if (!e.title) return `${at} needs a title`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return `${at} needs a date (YYYY-MM-DD)`;
    if (!/^https:\/\//.test(e.url || '')) return `${at} needs an https:// ticket URL`;
  }
  return null;
}

async function saveEvents(raw) {
  const file = path.join(DATA, 'events.json');
  const backups = path.join(DATA, 'backups');
  await mkdir(backups, { recursive: true });
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(file, path.join(backups, `events-${stamp}.json`));
    const old = (await readdir(backups)).filter((f) => f.startsWith('events-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) {
      await unlink(path.join(backups, f));
    }
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, raw, 'utf8');       // atomic replace: nginx never
  await rename(tmp, file);                 // serves a half-written file
}

function mailForm(entry) {
  if (!MAIL_TO || !existsSync(SENDMAIL)) return;
  const lines = Object.entries(entry.fields || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const msg = `To: ${MAIL_TO}\nSubject: [BCA website] ${entry.form || 'form'} submission\nContent-Type: text/plain; charset=utf-8\n\n${lines}\n\nReceived ${entry.at} from ${entry.ip}\n`;
  const child = execFile(SENDMAIL, ['-t'], (err) => {
    if (err) console.error('sendmail failed:', err.message);
  });
  child.stdin.end(msg);
}

// Cheap per-IP rate limit for the public forms endpoint.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const windowStart = now - 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => t > windowStart);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10000) hits.clear();     // memory backstop
  return list.length > 10;
}

const server = http.createServer(async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const route = `${req.method} ${req.url.split('?')[0]}`;
  try {
    if (route === 'GET /api/health') return json(res, 200, { ok: true });

    if (route === 'PUT /api/events' || route === 'POST /api/events') {
      const raw = await readBody(req);
      let data;
      try { data = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const problem = validateEvents(data);
      if (problem) return json(res, 422, { error: problem });
      await saveEvents(`${JSON.stringify(data, null, 2)}\n`);
      console.log(`events.json saved (${data.events.length} events) by ${ip}`);
      return json(res, 200, { ok: true, events: data.events.length });
    }

    if (route === 'POST /api/forms') {
      if (limited(ip)) return json(res, 429, { error: 'too many submissions, try again later' });
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (body.website) return json(res, 200, { ok: true });   // honeypot field: pretend success
      const entry = { at: new Date().toISOString(), ip, form: String(body.form || 'unknown').slice(0, 50), fields: {} };
      for (const [k, v] of Object.entries(body.fields || {})) {
        entry.fields[String(k).slice(0, 50)] = String(v).slice(0, 2000);
      }
      await mkdir(DATA, { recursive: true });
      await appendFile(path.join(DATA, 'forms.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
      mailForm(entry);
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(`${route} failed:`, err.message);
    json(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`bca-api listening on 127.0.0.1:${PORT}, data in ${DATA}${MAIL_TO ? `, mailing ${MAIL_TO}` : ', mail off'}`);
});
