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
//   POST   /api/logout      -> clears the session
//   PUT    /api/events      -> validate + atomically write events.json to
//                              $BCA_DATA (timestamped backups kept). nginx
//                              aliases /assets/data/events.json to that file,
//                              outside the webroot, so staff saves survive
//                              `sudo bonita` deploys (rsync --delete).
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
import { mkdir, readFile, readdir, rename, unlink, writeFile, appendFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const DATA = process.env.BCA_DATA || '/var/lib/bca';
const PORT = Number(process.env.BCA_LISTEN || 8787);
const MAIL_TO = process.env.BCA_MAIL_TO || '';
const SENDMAIL = '/usr/sbin/sendmail';
const USERS_FILE = () => path.join(DATA, 'users.json');
const MAX_BODY = 256 * 1024;
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

async function atomicWrite(file, content) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, 'utf8');   // atomic replace: readers never
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
  await atomicWrite(file, raw);
}

// ---- forms ----

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
      const entry = { at: new Date().toISOString(), ip, form: String(body.form || 'unknown').slice(0, 50), fields: {} };
      for (const [k, v] of Object.entries(body.fields || {})) {
        entry.fields[String(k).slice(0, 50)] = String(v).slice(0, 2000);
      }
      await mkdir(DATA, { recursive: true });
      await appendFile(path.join(DATA, 'forms.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
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
