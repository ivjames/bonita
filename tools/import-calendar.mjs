// Backfill site/assets/data/events.json from the venue's live public Google
// Calendar — the same calendar (bonitacenter@gmail.com) that feeds the
// eventscalendar.co widget on the Wix site, the one whose months you can page
// back through for years of history.
//
// RUN THIS FROM THE DROPLET (or any host with open outbound HTTPS). The
// managed web/dev sandbox blocks calendar.google.com at the egress proxy, so
// the site can't pull the feed itself — this is a standalone script you run
// where the network is open. It's stdlib-only Node (no npm install).
//
// What it does:
//   1. Fetches the calendar's public iCalendar (.ics) feed (or reads a local
//      .ics you pass in with --src=path.ics).
//   2. Parses every event — past and future — into the events.json schema
//      (title/date/time/dateLabel/description): times land in the venue's
//      timezone, multi-day runs become one entry per day (matching how the
//      file already records breaks and multi-night shows), simple recurring
//      events are expanded, and HTML blurbs are converted to the same Markdown
//      subset events.js renders.
//   3. Merges into events.json WITHOUT clobbering hand-curated entries: an
//      imported event whose (title, date) already exists is left untouched, so
//      the tuned Ludus links, blurbs, and dateLabels the box office set on
//      /admin all survive. Everything else is added, and the list is re-sorted
//      by date.
//
// Usage:
//   node tools/import-calendar.mjs                  dry run — proposed JSON to stdout, summary to stderr
//   node tools/import-calendar.mjs --write          merge into site/assets/data/events.json in place
//   node tools/import-calendar.mjs --past-only      only events before today (pure history backfill)
//   node tools/import-calendar.mjs --src=<url|file> override the source (a URL or a local .ics path)
//   node tools/import-calendar.mjs --since=2014-01-01 --until=2027-12-31
//
// Defaults: source = the public ICS for bonitacenter@gmail.com; window =
// 2014-01-01 (the venue opened in 2014) through ~18 months out.

import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CAL_ID = 'bonitacenter@gmail.com';
const DEFAULT_SRC = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL_ID)}/public/basic.ics`;
const TZ = 'America/Los_Angeles';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = path.join(HERE, '..', 'site', 'assets', 'data', 'events.json');

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
if (flag('help')) {
  console.log(await readFile(fileURLToPath(import.meta.url), 'utf8')
    .then((s) => s.split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')));
  process.exit(0);
}
const SRC = opt('src', DEFAULT_SRC);
const WRITE = flag('write');
const today = new Date();
const todayISO = iso(today.getFullYear(), today.getMonth() + 1, today.getDate());
const SINCE = opt('since', '2014-01-01');
const UNTIL = flag('past-only')
  ? addDaysISO(todayISO, -1)
  : opt('until', addDaysISO(todayISO, 540));

// ---- fetch ----------------------------------------------------------------
async function loadSource(src) {
  if (/^https?:\/\//i.test(src)) return get(src);
  return readFile(src, 'utf8');
}

function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'bca-import-calendar/1.0' } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location && hops < 5) {
        res.resume();
        return resolve(get(new URL(headers.location, url).toString(), hops + 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(
          `HTTP ${statusCode} fetching ${url}\n` +
          (statusCode === 404 || statusCode === 403
            ? 'The calendar may not be shared publicly. In Google Calendar → Settings for\n' +
              'bonitacenter@gmail.com → Access permissions, tick "Make available to public",\n' +
              'or grab "Secret address in iCal format" and pass it with --src=<that url>.\n' +
              'You can also export the calendar and run with --src=path/to/exported.ics.'
            : '')));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// ---- ICS parsing ----------------------------------------------------------
// Unfold RFC 5545 line folding (a continuation line starts with space/tab),
// then split into VEVENT blocks.
function parseIcs(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  let cur = null;
  for (const line of unfolded.split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(parseVevent(cur)); cur = null; continue; }
    if (cur && line) cur.push(line);
  }
  return events;
}

function parseVevent(lines) {
  const props = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = left.split(';');
    const params = {};
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    // A calendar can carry EXDATE more than once; keep them all.
    if (name === 'EXDATE') (props.EXDATE ||= []).push({ value, params });
    else props[name] = { value, params };
  }
  return props;
}

const unescapeText = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// A date-time value -> venue-local calendar fields. All-day (VALUE=DATE)
// values have no time. UTC values (trailing Z) are converted through the
// venue timezone; TZID / floating values are read as already-local wall time.
function parseDT(entry) {
  const { value, params } = entry;
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8);
    return { y, m, d, time: null, allDay: true };
  }
  const mt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!mt) return null;
  let [, Y, M, D, h, mi] = mt.map(Number);
  if (mt[7] === 'Z') {
    ({ y: Y, m: M, d: D, h, mi } = inTZ(new Date(Date.UTC(Y, M - 1, D, h, mi))));
  }
  return { y: Y, m: M, d: D, time: fmtTime(h, mi), allDay: false };
}

// Wall-clock fields of an instant in the venue timezone.
function inTZ(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instant);
  const g = (t) => +parts.find((p) => p.type === t).value;
  let h = g('hour');
  if (h === 24) h = 0; // some ICU builds render midnight as 24
  return { y: g('year'), m: g('month'), d: g('day'), h, mi: g('minute') };
}

function fmtTime(h, mi) {
  const ap = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(mi).padStart(2, '0')} ${ap}`;
}

// ---- HTML blurb -> the Markdown subset events.js renders ------------------
function htmlToMarkdown(raw) {
  let s = raw || '';
  const looksHtml = /<[a-z!/][^>]*>/i.test(s);
  if (looksHtml) {
    s = s
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n\n')
      .replace(/<\s*p[^>]*>/gi, '')
      .replace(/<\s*(?:b|strong)\s*>([\s\S]*?)<\/\s*(?:b|strong)\s*>/gi, '**$1**')
      .replace(/<\s*(?:i|em)\s*>([\s\S]*?)<\/\s*(?:i|em)\s*>/gi, '_$1_')
      .replace(/<\s*a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\s*a\s*>/gi,
        (_, href, text) => `[${text.trim()}](${href.trim()})`)
      .replace(/<[^>]+>/g, ''); // drop anything left
  }
  s = s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- event expansion ------------------------------------------------------
// Turn one VEVENT into events.json rows: one per day, with a dateLabel on
// multi-day runs. Recurring events are expanded across the window.
function expand(ve, out) {
  if (!ve.SUMMARY) return;
  const title = unescapeText(ve.SUMMARY.value).trim();
  if (!title) return;
  const start = ve.DTSTART && parseDT(ve.DTSTART);
  if (!start) return;
  const end = ve.DTEND && parseDT(ve.DTEND);
  const description = ve.DESCRIPTION ? htmlToMarkdown(unescapeText(ve.DESCRIPTION.value)) : '';
  const url = ve.URL && /^https?:\/\//i.test(ve.URL.value) ? ve.URL.value.trim() : '';

  // Day span: for an all-day event DTEND is exclusive, so the run is
  // [start, end). Timed events are treated as a single day.
  let spanDays = 1;
  if (start.allDay && end) {
    spanDays = Math.max(1, Math.round((Date.UTC(end.y, end.m - 1, end.d) - Date.UTC(start.y, start.m - 1, start.d)) / 86400000));
  }

  const exdates = new Set(
    (ve.EXDATE || []).flatMap((e) => e.value.split(',')).map((v) => v.slice(0, 8))
      .map((v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`));

  for (const [oy, om, od] of occurrences(start, ve.RRULE && ve.RRULE.value)) {
    const firstISO = iso(oy, om, od);
    if (exdates.has(firstISO)) continue;
    const label = spanDays > 1 ? runLabel(oy, om, od, spanDays) : '';
    for (let k = 0; k < spanDays; k++) {
      const { y, m, d } = shift(oy, om, od, k);
      const date = iso(y, m, d);
      if (date < SINCE || date > UNTIL) continue;
      const row = { title, date };
      if (start.time) row.time = start.time;
      if (label) row.dateLabel = label;
      if (url) row.url = url;
      if (description) row.description = description;
      out.push(row);
    }
  }
}

// Yield occurrence start dates [y,m,d] within the window. Non-recurring
// events yield just their start; RRULE FREQ DAILY/WEEKLY/MONTHLY/YEARLY are
// expanded with INTERVAL/COUNT/UNTIL and (weekly) BYDAY.
function* occurrences(start, rrule) {
  if (!rrule) { yield [start.y, start.m, start.d]; return; }
  const r = Object.fromEntries(rrule.split(';').map((p) => {
    const [k, v] = p.split('='); return [k.toUpperCase(), v];
  }));
  const freq = r.FREQ;
  const interval = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
  const until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : UNTIL;
  const byDay = r.BYDAY ? r.BYDAY.split(',').map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.slice(-2))) : null;
  const hardStop = UNTIL < until ? UNTIL : until;

  let emitted = 0;
  const MAX = 3000;
  let cursor = { y: start.y, m: start.m, d: start.d };
  for (let i = 0; i < MAX && emitted < count; i++) {
    if (freq === 'WEEKLY' && byDay) {
      // Walk the seven days of this week-step; emit the matching weekdays.
      const weekStart = shift(cursor.y, cursor.m, cursor.d, 0);
      for (let dow = 0; dow < 7 && emitted < count; dow++) {
        const day = shift(weekStart.y, weekStart.m, weekStart.d, dow - dowOf(weekStart));
        const dISO = iso(day.y, day.m, day.d);
        if (dISO < iso(start.y, start.m, start.d)) continue;
        if (dISO > hardStop) return;
        if (byDay.includes(dowOf(day))) { yield [day.y, day.m, day.d]; emitted++; }
      }
      cursor = shift(cursor.y, cursor.m, cursor.d, 7 * interval);
      continue;
    }
    const dISO = iso(cursor.y, cursor.m, cursor.d);
    if (dISO > hardStop) return;
    yield [cursor.y, cursor.m, cursor.d]; emitted++;
    if (freq === 'DAILY') cursor = shift(cursor.y, cursor.m, cursor.d, interval);
    else if (freq === 'WEEKLY') cursor = shift(cursor.y, cursor.m, cursor.d, 7 * interval);
    else if (freq === 'MONTHLY') cursor = addMonths(cursor, interval);
    else if (freq === 'YEARLY') cursor = { ...cursor, y: cursor.y + interval };
    else return; // unsupported FREQ: base occurrence only
  }
}

// ---- date helpers ---------------------------------------------------------
function iso(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function shift(y, m, d, days) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function addMonths({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1 + n, d));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function dowOf({ y, m, d }) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function addDaysISO(isoStr, days) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const s = shift(y, m, d, days);
  return iso(s.y, s.m, s.d);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function runLabel(y, m, d, spanDays) {
  const a = { y, m, d };
  const b = shift(y, m, d, spanDays - 1);
  return a.m === b.m
    ? `${MONTHS[a.m - 1]} ${a.d}–${b.d}`
    : `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}`;
}

// ---- merge ----------------------------------------------------------------
function mergeInto(existing, imported) {
  const key = (e) => `${e.title}\n${e.date}`;
  const have = new Set((existing.events || []).map(key));
  const seen = new Set();
  const added = [];
  for (const e of imported) {
    const k = key(e);
    if (have.has(k) || seen.has(k)) continue; // keep curated / de-dup imports
    seen.add(k);
    added.push(e);
  }
  const events = [...(existing.events || []), ...added]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Preserve every non-events key (the _readme, _example, etc.) in place.
  const merged = {};
  for (const k of Object.keys(existing)) merged[k] = k === 'events' ? events : existing[k];
  if (!('events' in merged)) merged.events = events;
  return { merged, added };
}

// ---- main -----------------------------------------------------------------
const raw = await loadSource(SRC).catch((e) => { console.error(e.message); process.exit(1); });
const vevents = parseIcs(raw);
const imported = [];
for (const ve of vevents) expand(ve, imported);
imported.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const existing = JSON.parse(await readFile(EVENTS_FILE, 'utf8'));
const { merged, added } = mergeInto(existing, imported);

const pastAdded = added.filter((e) => e.date < todayISO).length;
console.error(
  `source:   ${SRC}\n` +
  `window:   ${SINCE} … ${UNTIL}\n` +
  `parsed:   ${vevents.length} VEVENT(s) → ${imported.length} day-row(s) in window\n` +
  `existing: ${(existing.events || []).length} event row(s)\n` +
  `added:    ${added.length} new (${pastAdded} historic), skipped ${imported.length - added.length} already present/dupes\n` +
  `total:    ${merged.events.length} event row(s)`);
if (added.length) {
  const runs = added.filter((e, i, a) => i === 0 || e.title !== a[i - 1].title || e.dateLabel !== a[i - 1].dateLabel);
  console.error('\nnew entries:');
  for (const e of runs.slice(0, 40)) console.error(`  ${e.dateLabel || e.date}  ${e.title}`);
  if (runs.length > 40) console.error(`  … and ${runs.length - 40} more`);
}

const json = `${JSON.stringify(merged, null, 2)}\n`;
if (WRITE) {
  await writeFile(EVENTS_FILE, json);
  console.error(`\nwrote ${path.relative(path.join(HERE, '..'), EVENTS_FILE)}`);
} else {
  process.stdout.write(json);
  console.error('\n(dry run — re-run with --write to merge into events.json)');
}
