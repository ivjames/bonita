// bca-api — tiny form/admin backend for bonita.lab980.com. Node stdlib only.
//
// Listens on 127.0.0.1 (never exposed directly); nginx proxies /api/* to it.
// Auth is app-level: per-user accounts in $BCA_DATA/users.json (scrypt
// hashes), session cookie set by the /admin login form. All routine account
// operations — password changes, adding/removing staff — happen from the
// /admin page; the only thing that needs the droplet is creating the first
// account (deploy/api/setup-api.sh).
//
// Public endpoints:
//   GET  /api/health        -> {ok, configured, auth, user}
//   POST /api/login         -> {user, password}; rate-limited; sets a 12h
//                              HttpOnly session cookie
//   POST /api/forms         -> form intake: appends to $BCA_DATA/forms.jsonl
//                              and emails it if sendmail + $BCA_MAIL_TO exist
// Session-required endpoints:
//   GET    /api/forms       -> the submissions inbox: spooled form entries,
//                              newest first (?limit=&offset=), each tagged
//                              handled/unhandled
//   POST   /api/forms/:id/handled -> {handled}: mark a submission handled
//                              (staff triage; state in $BCA_DATA/forms-state.json)
//   DELETE /api/forms/:id    -> delete a submission (spam removal)
//   POST   /api/logout      -> clears the session
//   PUT    /api/events      -> validate + atomically write events.json to
//                              $BCA_DATA (timestamped backups kept). nginx
//                              aliases /assets/data/events.json to that file,
//                              outside the git clone it serves, so staff
//                              saves never collide with `sudo bonita`
//                              (git pull) deploys.
//   GET    /api/media       -> list the swappable support PDFs (stage
//                              dimensions, building layout, seating chart)
//                              with whether a staff override is installed
//   PUT    /api/media/:slug  -> replace a support PDF: writes the upload to
//                              $BCA_DATA/media/ (timestamped backups kept),
//                              which nginx serves in place of the repo seed
//   DELETE /api/media/:slug  -> drop the override, restoring the shipped PDF
//   POST   /api/password    -> {current, new}: change your own password
//                              (signs out your other sessions)
//   GET    /api/users       -> list staff accounts
//   POST   /api/users       -> {name, password}: add a staff account, or
//                              reset a colleague's password
//   DELETE /api/users/NAME  -> remove an account (the last one is protected)
//
// Config (environment; the systemd unit loads /etc/bca-api.env):
//   BCA_DATA     data directory (default /var/lib/bca; the unit sets this
//                via StateDirectory)
//   BCA_LISTEN   port on 127.0.0.1 (default 8787)
//   BCA_MAIL_TO  recipient for form email notifications (optional)

import http from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile, appendFile, copyFile, stat, chmod } from 'node:fs/promises';
import path from 'node:path';

const DATA = process.env.BCA_DATA || '/var/lib/bca';
const PORT = Number(process.env.BCA_LISTEN || 8787);
const MAIL_TO = process.env.BCA_MAIL_TO || '';
const SENDMAIL = '/usr/sbin/sendmail';
const USERS_FILE = () => path.join(DATA, 'users.json');
const MAX_BODY = 256 * 1024;
const MAX_PDF = 20 * 1024 * 1024;   // support PDFs run to a few hundred KB; leave headroom
const MAX_EVENTS = 200;
const KEEP_BACKUPS = 30;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const COOKIE = 'bca_session';
const SCRYPT_N = 16384;
const NAME_RE = /^[a-z0-9._-]{2,32}$/;
const MIN_PASSWORD = 8;

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
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

// Like readBody but keeps the raw bytes (for binary uploads) and takes its own
// size cap — PDFs are far bigger than the JSON MAX_BODY allows.
const readRawBody = (req, max) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > max) { reject(new Error('body too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// mode is optional: pass 0o644 for files nginx serves directly (events.json),
// so www-data can read them. DynamicUser's umask (0077) would otherwise leave
// them 0600 and nginx 403s. Omit it for private files (users.json, the form
// spool) — they keep the restrictive default and must NOT become world-readable.
async function atomicWrite(file, content, mode) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, 'utf8');   // atomic replace: readers never
  if (mode !== undefined) await chmod(tmp, mode);   // set before rename
  await rename(tmp, file);                 // see a half-written file
}

// ---- user store ($BCA_DATA/users.json: {"users": {name: {hash, updated}}}) ----

async function loadUsers() {
  try {
    const data = JSON.parse(await readFile(USERS_FILE(), 'utf8'));
    return (typeof data.users === 'object' && data.users) || {};
  } catch {
    return {};
  }
}

async function saveUsers(users) {
  await mkdir(DATA, { recursive: true });
  await atomicWrite(USERS_FILE(), `${JSON.stringify({ users }, null, 2)}\n`);
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: SCRYPT_N });
  return ['scrypt', SCRYPT_N, salt.toString('hex'), key.toString('hex')].join('$');
}

// Kept for timing parity when the username doesn't exist.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

function verifyPassword(password, hash) {
  const [scheme, nStr, saltHex, keyHex] = String(hash || DUMMY_HASH).split('$');
  if (scheme !== 'scrypt') return false;
  const key = Buffer.from(keyHex, 'hex');
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), key.length,
    { N: Number(nStr), maxmem: 128 * 1024 * 1024 });
  return timingSafeEqual(derived, key);
}

// ---- sessions (in-memory; a service restart just means signing in again) ----

const sessions = new Map();   // token -> {user, exp}

function sessionOf(req) {
  const m = /(?:^|;\s*)bca_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { sessions.delete(m[1]); return null; }
  return { token: m[1], user: s.user };
}

function dropSessions(user, exceptToken = null) {
  for (const [token, s] of sessions) {
    if (s.user === user && token !== exceptToken) sessions.delete(token);
  }
}

function startSession(res, user) {
  if (sessions.size > 100) {               // cap: evict the oldest
    const oldest = [...sessions.entries()].sort((a, b) => a[1].exp - b[1].exp)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { user, exp: Date.now() + SESSION_TTL });
  res.setHeader('set-cookie',
    `${COOKIE}=${token}; Max-Age=${SESSION_TTL / 1000}; Path=/; HttpOnly; Secure; SameSite=Strict`);
}

// Same-origin check for state-changing requests: browsers send Origin on
// cross-site (and same-site fetch) requests; if present it must match Host.
function crossOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.host; } catch { return true; }
}

// Cheap per-IP rate limiting. Every form submission counts; for logins only
// FAILURES count — staff share the school's public IP, so counting
// successful sign-ins would lock the whole office out on a busy afternoon.
function makeLimiter(maxHits, windowMs) {
  const hits = new Map();
  const recent = (ip) => (hits.get(ip) || []).filter((t) => t > Date.now() - windowMs);
  return {
    over(ip) { return recent(ip).length >= maxHits; },
    record(ip) {
      const list = recent(ip);
      list.push(Date.now());
      hits.set(ip, list);
      if (hits.size > 10000) hits.clear();   // memory backstop
    },
  };
}
const formsLimiter = makeLimiter(10, 10 * 60 * 1000);
const loginFailures = makeLimiter(5, 15 * 60 * 1000);

// ---- events ----

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
    if (e.url && !/^https:\/\//.test(e.url)) return `${at} ticket URL must start with https://`;
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
  await atomicWrite(file, raw, 0o644);   // nginx serves this file directly
}

// ---- media (swappable support PDFs) ----
//
// A fixed registry of the PDFs the public pages link to. Staff can upload a
// replacement for any of them; the upload lands in $BCA_DATA/media/ (outside
// the git clone), which nginx serves in place of the repo seed — same
// survive-a-git-deploy trick as events.json. The registry is closed on
// purpose: only these known filenames can be written, so an upload can never
// create an arbitrary path.
const MEDIA_DIR = () => path.join(DATA, 'media');
const MEDIA_DOCS = [
  { slug: 'stage-dimensions', file: 'bca-stage-dimensions.pdf', label: 'Stage dimensions drawing', page: '/rentals/tech-specs' },
  { slug: 'building-layout',  file: 'bca-building-layout.pdf',  label: 'Building layout',           page: '/rentals/building' },
  { slug: 'seating-chart',    file: 'bca-seating-chart.pdf',    label: 'Seating chart',             page: '/about/visit' },
];
const mediaDoc = (slug) => MEDIA_DOCS.find((d) => d.slug === slug);

// The current state of every registered doc: whether a staff override is
// installed and, if so, its size and upload time.
async function listMedia() {
  const dir = MEDIA_DIR();
  return Promise.all(MEDIA_DOCS.map(async (d) => {
    let override = null;
    try {
      const st = await stat(path.join(dir, d.file));
      override = { size: st.size, updated: st.mtime.toISOString() };
    } catch { /* no override uploaded — the repo seed is live */ }
    return { slug: d.slug, label: d.label, file: d.file, page: d.page, url: `/assets/pdf/${d.file}`, override };
  }));
}

// Prune a doc's backups down to KEEP_BACKUPS, oldest first.
async function pruneMediaBackups(backups, slug) {
  const old = (await readdir(backups)).filter((f) => f.startsWith(`${slug}-`)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) {
    await unlink(path.join(backups, f));
  }
}

// ---- forms ----

const FORMS_FILE = () => path.join(DATA, 'forms.jsonl');
const FORMS_STATE_FILE = () => path.join(DATA, 'forms-state.json');

// The spool (forms.jsonl) is append-only and the source of truth. "Handled"
// is triage state kept separately so reading the inbox never rewrites the
// log; deletion (spam) is the one operation that does.
async function readForms() {
  try {
    const raw = await readFile(FORMS_FILE(), 'utf8');
    return raw.split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

async function loadHandled() {
  try {
    const d = JSON.parse(await readFile(FORMS_STATE_FILE(), 'utf8'));
    return (d && typeof d.handled === 'object' && d.handled) || {};
  } catch { return {}; }
}

async function saveHandled(handled) {
  await mkdir(DATA, { recursive: true });
  await atomicWrite(FORMS_STATE_FILE(), `${JSON.stringify({ handled }, null, 2)}\n`);
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

// ---- server ----

const server = http.createServer(async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const [urlPath] = req.url.split('?');
  const route = `${req.method} ${urlPath}`;
  try {
    if (route === 'GET /api/health') {
      const session = sessionOf(req);
      const users = await loadUsers();
      return json(res, 200, {
        ok: true,
        configured: Object.keys(users).length > 0,
        auth: !!session,
        user: session?.user || null,
      });
    }

    if (req.method !== 'GET' && crossOrigin(req)) {
      return json(res, 403, { error: 'cross-origin request rejected' });
    }

    if (route === 'POST /api/login') {
      const users = await loadUsers();
      if (!Object.keys(users).length) return json(res, 503, { error: 'no staff accounts configured on the server' });
      if (loginFailures.over(ip)) return json(res, 429, { error: 'too many failed attempts — wait 15 minutes' });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const name = String(body.user || '').toLowerCase().trim();
      const record = NAME_RE.test(name) ? users[name] : undefined;
      if (typeof body.password !== 'string' || !verifyPassword(body.password, record?.hash)) {
        loginFailures.record(ip);
        console.log(`failed login for "${name}" from ${ip}`);
        return json(res, 401, { error: 'wrong username or password' });
      }
      startSession(res, name);
      console.log(`${name} signed in from ${ip}`);
      return json(res, 200, { ok: true, user: name });
    }

    if (route === 'POST /api/forms') {
      if (formsLimiter.over(ip)) return json(res, 429, { error: 'too many submissions, try again later' });
      formsLimiter.record(ip);
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (body.website) return json(res, 200, { ok: true });   // honeypot field: pretend success
      const entry = { id: randomBytes(6).toString('hex'), at: new Date().toISOString(), ip, form: String(body.form || 'unknown').slice(0, 50), fields: {} };
      for (const [k, v] of Object.entries(body.fields || {})) {
        entry.fields[String(k).slice(0, 50)] = String(v).slice(0, 2000);
      }
      await mkdir(DATA, { recursive: true });
      await appendFile(FORMS_FILE(), `${JSON.stringify(entry)}\n`, 'utf8');
      mailForm(entry);
      return json(res, 200, { ok: true });
    }

    // ---- everything below requires a session ----
    const session = sessionOf(req);
    if (!session) return json(res, 401, { error: 'sign in first' });

    if (route === 'POST /api/logout') {
      sessions.delete(session.token);
      res.setHeader('set-cookie', `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
      return json(res, 200, { ok: true });
    }

    if (route === 'GET /api/forms') {
      const q = new URL(req.url, 'http://x').searchParams;
      const limit = Math.min(Math.max(Number(q.get('limit')) || 100, 1), 500);
      const offset = Math.max(Number(q.get('offset')) || 0, 0);
      const handled = await loadHandled();
      const all = (await readForms())
        .map((e) => ({ ...e, handled: !!handled[e.id] }))
        .reverse();   // newest first
      return json(res, 200, {
        total: all.length,
        unhandled: all.filter((e) => !e.handled).length,
        submissions: all.slice(offset, offset + limit),
      });
    }

    const handledRoute = /^POST \/api\/forms\/([a-f0-9]{6,32})\/handled$/.exec(route);
    if (handledRoute) {
      const id = handledRoute[1];
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (!(await readForms()).some((e) => e.id === id)) return json(res, 404, { error: 'no such submission' });
      const handled = await loadHandled();
      if (body.handled) handled[id] = true; else delete handled[id];
      await saveHandled(handled);
      return json(res, 200, { ok: true, handled: !!body.handled });
    }

    const formDel = /^DELETE \/api\/forms\/([a-f0-9]{6,32})$/.exec(route);
    if (formDel) {
      const id = formDel[1];
      const all = await readForms();
      const kept = all.filter((e) => e.id !== id);
      if (kept.length === all.length) return json(res, 404, { error: 'no such submission' });
      await atomicWrite(FORMS_FILE(), kept.length ? `${kept.map((e) => JSON.stringify(e)).join('\n')}\n` : '');
      const handled = await loadHandled();
      if (handled[id]) { delete handled[id]; await saveHandled(handled); }
      console.log(`${session.user} deleted form submission ${id} from ${ip}`);
      return json(res, 200, { ok: true });
    }

    if (route === 'PUT /api/events' || route === 'POST /api/events') {
      const raw = await readBody(req);
      let data;
      try { data = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const problem = validateEvents(data);
      if (problem) return json(res, 422, { error: problem });
      await saveEvents(`${JSON.stringify(data, null, 2)}\n`);
      console.log(`events.json saved (${data.events.length} events) by ${session.user} from ${ip}`);
      return json(res, 200, { ok: true, events: data.events.length });
    }

    if (route === 'GET /api/media') {
      return json(res, 200, { docs: await listMedia() });
    }

    const mediaPut = /^(?:PUT|POST) \/api\/media\/([a-z0-9-]{2,40})$/.exec(route);
    if (mediaPut) {
      const doc = mediaDoc(mediaPut[1]);
      if (!doc) return json(res, 404, { error: 'no such document' });
      const ctype = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ctype && ctype !== 'application/pdf') return json(res, 415, { error: 'upload must be a PDF' });
      let buf;
      try { buf = await readRawBody(req, MAX_PDF); }
      catch { return json(res, 413, { error: `PDF too large (max ${MAX_PDF / (1024 * 1024)} MB)` }); }
      if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return json(res, 422, { error: "that doesn't look like a PDF file" });
      }
      const dir = MEDIA_DIR();
      const backups = path.join(dir, 'backups');
      await mkdir(backups, { recursive: true });
      const dest = path.join(dir, doc.file);
      if (existsSync(dest)) {   // keep the replaced copy before overwriting
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await copyFile(dest, path.join(backups, `${doc.slug}-${stamp}.pdf`));
        await pruneMediaBackups(backups, doc.slug);
      }
      const tmp = `${dest}.tmp`;
      await writeFile(tmp, buf);   // atomic replace: readers never see a partial PDF
      await chmod(tmp, 0o644);     // nginx serves this file directly (see atomicWrite)
      await rename(tmp, dest);
      console.log(`media "${doc.slug}" replaced (${buf.length} bytes) by ${session.user} from ${ip}`);
      return json(res, 200, { ok: true, size: buf.length });
    }

    const mediaDel = /^DELETE \/api\/media\/([a-z0-9-]{2,40})$/.exec(route);
    if (mediaDel) {
      const doc = mediaDoc(mediaDel[1]);
      if (!doc) return json(res, 404, { error: 'no such document' });
      const dest = path.join(MEDIA_DIR(), doc.file);
      if (!existsSync(dest)) return json(res, 200, { ok: true, existed: false });
      const backups = path.join(MEDIA_DIR(), 'backups');
      await mkdir(backups, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await copyFile(dest, path.join(backups, `${doc.slug}-${stamp}.pdf`));   // keep the override in case it's wanted back
      await pruneMediaBackups(backups, doc.slug);
      await unlink(dest);
      console.log(`media "${doc.slug}" reverted to the shipped original by ${session.user} from ${ip}`);
      return json(res, 200, { ok: true, existed: true });
    }

    if (route === 'POST /api/password') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const users = await loadUsers();
      if (!verifyPassword(String(body.current ?? ''), users[session.user]?.hash)) {
        return json(res, 401, { error: 'current password is wrong' });
      }
      if (typeof body.new !== 'string' || body.new.length < MIN_PASSWORD) {
        return json(res, 422, { error: `new password must be at least ${MIN_PASSWORD} characters` });
      }
      users[session.user] = { hash: hashPassword(body.new), updated: new Date().toISOString() };
      await saveUsers(users);
      dropSessions(session.user, session.token);   // keep this session, drop the rest
      console.log(`${session.user} changed their password from ${ip}`);
      return json(res, 200, { ok: true });
    }

    if (route === 'GET /api/users') {
      const users = await loadUsers();
      return json(res, 200, {
        users: Object.entries(users).map(([name, u]) => ({ name, updated: u.updated || null })),
      });
    }

    if (route === 'POST /api/users') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const name = String(body.name || '').toLowerCase().trim();
      if (!NAME_RE.test(name)) return json(res, 422, { error: 'username must be 2-32 characters: letters, digits, . _ -' });
      if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD) {
        return json(res, 422, { error: `password must be at least ${MIN_PASSWORD} characters` });
      }
      const users = await loadUsers();
      const existed = !!users[name];
      users[name] = { hash: hashPassword(body.password), updated: new Date().toISOString() };
      await saveUsers(users);
      if (existed) dropSessions(name);             // password reset: sign them out
      console.log(`${session.user} ${existed ? 'reset the password for' : 'added staff account'} "${name}" from ${ip}`);
      return json(res, 200, { ok: true, existed });
    }

    const del = /^DELETE \/api\/users\/([a-z0-9._-]{2,32})$/.exec(route);
    if (del) {
      const name = del[1];
      const users = await loadUsers();
      if (!users[name]) return json(res, 404, { error: 'no such account' });
      if (Object.keys(users).length === 1) return json(res, 422, { error: "can't remove the last account" });
      delete users[name];
      await saveUsers(users);
      dropSessions(name);
      console.log(`${session.user} removed staff account "${name}" from ${ip}`);
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(`${route} failed:`, err.message);
    json(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const users = await loadUsers();
  console.log(`bca-api listening on 127.0.0.1:${PORT}, data in ${DATA}, ` +
    `${Object.keys(users).length} staff account(s)` +
    `${MAIL_TO ? `, mailing ${MAIL_TO}` : ', mail off'}`);
});
