// Renders the hand-maintained event list (/assets/data/events.json) into any
// <ul data-events> container, and a browsable month-grid calendar into any
// [data-events-calendar] container. Progressive enhancement only: containers
// start [hidden] and the static "browse our ticketing site" content stays in
// place, so a fetch failure or an empty list leaves the page exactly as
// authored.
//
// The parsing/rendering helpers live on window.BCA so the backstage events
// manager (/admin) can reuse them for its live preview.
window.BCA = window.BCA || {};

// Parse YYYY-MM-DD as local time (new Date('2026-05-09') would be UTC and
// can shift a day).
window.BCA.parseEventDay = (s) => {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

// Filter to valid, not-yet-past events, soonest first. A url (the Ludus
// event page) is optional: some venue events sell tickets elsewhere or
// aren't ticketed at all — those render without a link.
window.BCA.upcomingEvents = (events) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (events || [])
    .map((e) => ({ ...e, day: window.BCA.parseEventDay(e.date) }))
    .filter((e) => e.title && e.day && e.day >= today)
    .sort((a, b) => a.day - b.day);
};

window.BCA.escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tiny Markdown -> HTML for event descriptions — the only rich text the site
// renders, and the whole reason there's no Markdown library here. Supports the
// subset the live calendar's blurbs use: [text](url) links (http/https/mailto
// only), **bold**, _italic_/*italic*, blank-line paragraphs, and
// backslash-escaped punctuation (\* -> a literal *). Any real HTML in the
// source is escaped first, so a description can never inject markup.
window.BCA.mdToHtml = (md) => {
  const esc = window.BCA.escapeHtml;
  const held = [];
  // 1. stash backslash-escaped punctuation so the inline passes skip it
  let s = String(md || '').replace(/\\([\\`*_{}[\]()#+\-.!>~])/g, (_, ch) => {
    held.push(ch);
    return `\u0000${held.length - 1}\u0000`;
  });
  // 2. neutralise any real HTML in the source
  s = esc(s);
  // 3. inline: links first (so ** inside a label is left alone), then bold, italic
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
    `<a href="${esc(/^(https?:|mailto:)/i.test(url) ? url : '#')}">${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 4. paragraphs on blank lines, <br> on single newlines
  s = s.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  // 5. restore the stashed literals (as escaped text, never markup)
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => esc(held[Number(i)]));
};

// Same subset flattened to plain text — for the JSON-LD, where description
// must be a plain string (no markup).
window.BCA.mdToText = (md) => window.BCA.mdToHtml(md)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

// Fill a <ul> with playbill-style event cards. `upcoming` must come from
// upcomingEvents(). Multi-day runs entered as one row per day (so each day
// shows on the calendar grid) collapse to a single card here. Returns the
// number of cards rendered.
window.BCA.renderEvents = (list, upcoming, max) => {
  const esc = window.BCA.escapeHtml;
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const full = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const runKey = (e) => [e.title, e.dateLabel, e.url].join('\n');
  const deduped = upcoming.filter((e, i) => !i || runKey(e) !== runKey(upcoming[i - 1]));
  const shown = deduped.slice(0, max || deduped.length);
  list.innerHTML = shown.map((e) => {
    const when = [e.dateLabel || full.format(e.day), e.time].filter(Boolean).join(' · ');
    const inner = `
        <span class="event-date">
          <span class="d">${e.day.getDate()}</span>
          <span class="m">${month.format(e.day)}</span>
        </span>
        <span class="event-info">
          <span class="event-title">${esc(e.title)}</span>
          <span class="event-meta">${esc(when)}${e.presenter ? ` — ${esc(e.presenter)}` : ''}</span>
        </span>${e.url ? `
        <span class="event-cta" aria-hidden="true">Tickets →</span>` : ''}`;
    const card = e.url
      ? `<a class="event-card" href="${esc(e.url)}">${inner}</a>`
      : `<span class="event-card">${inner}</span>`;
    // The blurb sits outside the card link: it can carry its own links
    // (e.g. "GET TICKETS"), and an <a> can't nest inside another <a>.
    const desc = e.description
      ? `<div class="event-desc">${window.BCA.mdToHtml(e.description)}</div>`
      : '';
    return `<li class="event">${card}${desc}</li>`;
  }).join('');
  return shown.length;
};

// Fill a [data-events-calendar] container with a month-grid calendar of the
// upcoming events. Opens on the soonest event's month; the arrows browse
// from the current month through the last month with an event. `upcoming`
// must come from upcomingEvents().
window.BCA.renderCalendar = (root, upcoming) => {
  const esc = window.BCA.escapeHtml;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const byDay = new Map();
  upcoming.forEach((e) => {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  });
  const monthOf = (d) => d.getFullYear() * 12 + d.getMonth();
  const min = Math.min(monthOf(today), monthOf(upcoming[0].day));
  const max = monthOf(upcoming[upcoming.length - 1].day);
  let shown = monthOf(upcoming[0].day);

  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  const full = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  root.innerHTML = `
    <div class="cal-bar">
      <h2 class="cal-title" aria-live="polite"></h2>
      <div class="cal-nav">
        <button type="button" class="cal-prev" aria-label="Previous month">&#8592;</button>
        <button type="button" class="cal-next" aria-label="Next month">&#8594;</button>
      </div>
    </div>
    <table class="cal-grid">
      <thead><tr>${weekdays.map((w) => `<th scope="col"><span aria-hidden="true">${w.slice(0, 3)}</span><span class="visually-hidden">${w}</span></th>`).join('')}</tr></thead>
      <tbody></tbody>
    </table>`;
  const title = root.querySelector('.cal-title');
  const tbody = root.querySelector('tbody');
  const prev = root.querySelector('.cal-prev');
  const next = root.querySelector('.cal-next');

  const draw = () => {
    const y = Math.floor(shown / 12), m = shown % 12;
    title.textContent = monthName.format(new Date(y, m, 1));
    const days = new Date(y, m + 1, 0).getDate();
    const cells = Array.from({ length: new Date(y, m, 1).getDay() }, () => '<td class="cal-empty"></td>');
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const evs = byDay.get(key) || [];
      const cls = ['cal-day', evs.length && 'has-event',
        new Date(y, m, d).getTime() === today.getTime() && 'is-today'].filter(Boolean).join(' ');
      cells.push(`<td class="${cls}"><span class="cal-num">${d}</span>${evs.map((e) => {
        const when = [e.dateLabel || full.format(e.day), e.time].filter(Boolean).join(' · ');
        const name = `<span class="cal-event-name" aria-hidden="true">${esc(e.title)}</span>`;
        return e.url
          ? `<a class="cal-event" href="${esc(e.url)}" aria-label="${esc(`${e.title} — ${when} — tickets`)}">${name}</a>`
          : `<span class="cal-event">${name}<span class="visually-hidden">${esc(`${e.title} — ${when}`)}</span></span>`;
      }).join('')}</td>`);
    }
    while (cells.length % 7) cells.push('<td class="cal-empty"></td>');
    tbody.innerHTML = Array.from({ length: cells.length / 7 },
      (_, r) => `<tr>${cells.slice(r * 7, r * 7 + 7).join('')}</tr>`).join('');
    prev.disabled = shown <= min;
    next.disabled = shown >= max;
  };
  prev.addEventListener('click', () => { if (shown > min) { shown -= 1; draw(); } });
  next.addEventListener('click', () => { if (shown < max) { shown += 1; draw(); } });
  draw();
};

// Mirror the rendered list as schema.org Event structured data so search
// engines can pick up the show listings. `upcoming` must come from
// upcomingEvents(). (A JSON-LD <script> is a data block, never executed,
// so the site's script-src CSP doesn't apply to it.)
window.BCA.eventsJsonLd = (upcoming) => upcoming.map((e) => {
  // "7:00 PM" -> T19:00:00; date-only startDate when the time doesn't parse.
  const m = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i.exec(String(e.time || '').trim());
  const h = m ? (Number(m[1]) % 12) + (/p/i.test(m[3]) ? 12 : 0) : 0;
  const ev = {
    '@type': 'Event',
    name: e.title,
    startDate: m ? `${e.date}T${String(h).padStart(2, '0')}:${m[2]}:00` : e.date,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'PerformingArtsTheater',
      '@id': 'https://bonita.lab980.com/#venue',
      name: 'Bonita Center for the Arts',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '822 West Covina Boulevard',
        addressLocality: 'San Dimas',
        addressRegion: 'CA',
        postalCode: '91773',
        addressCountry: 'US'
      }
    },
  };
  if (e.url) {
    ev.url = e.url;
    ev.offers = { '@type': 'Offer', url: e.url };
  }
  if (e.presenter) ev.organizer = { '@type': 'Organization', name: e.presenter };
  if (e.description) ev.description = window.BCA.mdToText(e.description);
  return ev;
});

(async () => {
  const lists = document.querySelectorAll('ul[data-events]');
  const calendars = document.querySelectorAll('[data-events-calendar]');
  if (!lists.length && !calendars.length) return;
  let data;
  try {
    data = await (await fetch('/assets/data/events.json')).json();
  } catch {
    return;
  }
  const upcoming = window.BCA.upcomingEvents(data.events);
  if (!upcoming.length) return;
  lists.forEach((list) => {
    window.BCA.renderEvents(list, upcoming, parseInt(list.dataset.max, 10) || 0);
    list.hidden = false;
  });
  calendars.forEach((cal) => {
    window.BCA.renderCalendar(cal, upcoming);
    cal.hidden = false;
  });
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': window.BCA.eventsJsonLd(upcoming) });
  document.head.append(ld);
})();
