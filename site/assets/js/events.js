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

// Every valid event, soonest first — past and future together. Feeds the
// month-grid calendar, whose back-arrow browses into the venue's history.
window.BCA.allEvents = (events) => (events || [])
  .map((e) => ({ ...e, day: window.BCA.parseEventDay(e.date) }))
  .filter((e) => e.title && e.day)
  .sort((a, b) => a.day - b.day);

// Valid events already in the past, most recent first — the archive list.
window.BCA.pastEvents = (events) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return window.BCA.allEvents(events).filter((e) => e.day < today).reverse();
};

window.BCA.escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// URL-safe slug of a title, for the event-details page (/event?e=…). Two
// entries of the same run (a multi-day show) share a title, so they share a
// slug and resolve to the same details page.
window.BCA.slugify = (s) => String(s || '').toLowerCase()
  .replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

// Link to an event's details page. The date is carried along as a tiebreaker
// so two distinct runs that happen to share a title resolve to the right one.
window.BCA.eventDetailHref = (e) =>
  `/event?e=${encodeURIComponent(window.BCA.slugify(e.title))}` +
  (e.date ? `&d=${encodeURIComponent(e.date)}` : '');

// An event earns a details page only when it has something to show there —
// a ticket link or a blurb. Bare informational entries (school breaks) don't.
window.BCA.hasEventDetail = (e) => Boolean(e.url || e.description);

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
// shows on the calendar grid) collapse to a single card here. The blurb is
// not shown here — a card links through to the event's details page (/event),
// where the full description and the tickets link live. Returns the number of
// cards rendered.
window.BCA.renderEvents = (list, upcoming, max) => {
  const esc = window.BCA.escapeHtml;
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const full = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const runKey = (e) => [e.title, e.dateLabel, e.url].join('\n');
  const deduped = upcoming.filter((e, i) => !i || runKey(e) !== runKey(upcoming[i - 1]));
  const shown = deduped.slice(0, max || deduped.length);
  list.innerHTML = shown.map((e) => {
    const when = [e.dateLabel || full.format(e.day), e.time].filter(Boolean).join(' · ');
    const detail = window.BCA.hasEventDetail(e);
    const inner = `
        <span class="event-date">
          <span class="d">${e.day.getDate()}</span>
          <span class="m">${month.format(e.day)}</span>
        </span>
        <span class="event-info">
          <span class="event-title">${esc(e.title)}</span>
          <span class="event-meta">${esc(when)}${e.presenter ? ` — ${esc(e.presenter)}` : ''}</span>
        </span>${detail ? `
        <span class="event-cta" aria-hidden="true">Details →</span>` : ''}`;
    const card = detail
      ? `<a class="event-card" href="${esc(window.BCA.eventDetailHref(e))}">${inner}</a>`
      : `<span class="event-card">${inner}</span>`;
    return `<li class="event">${card}</li>`;
  }).join('');
  return shown.length;
};

// Fill a [data-events-calendar] container with a month-grid calendar of the
// events. Opens on the current month; the arrows browse back through the
// earliest event's month and forward through the latest — so patrons can
// step into the venue's history as well as ahead to what's on. `events`
// must come from allEvents() (or upcomingEvents() for a future-only grid).
window.BCA.renderCalendar = (root, events) => {
  const esc = window.BCA.escapeHtml;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const byDay = new Map();
  events.forEach((e) => {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  });
  const monthOf = (d) => d.getFullYear() * 12 + d.getMonth();
  // Always keep the current month reachable, even if every event is on one
  // side of today.
  const min = Math.min(monthOf(today), monthOf(events[0].day));
  const max = Math.max(monthOf(today), monthOf(events[events.length - 1].day));
  let shown = monthOf(today);

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
        return window.BCA.hasEventDetail(e)
          ? `<a class="cal-event" href="${esc(window.BCA.eventDetailHref(e))}" aria-label="${esc(`${e.title} — ${when} — details`)}">${name}</a>`
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

// Render the single-event details page (/event) into a [data-event-detail]
// container. The event is resolved from the ?e=<title-slug>&d=<date> query
// that the cards and calendar cells link to: match by slug, disambiguate by
// date, then gather the whole run so a multi-day show reads as one page.
// Replaces the container's static fallback only on a hit; returns the resolved
// event (for the page <title> and JSON-LD) or null when nothing matched.
window.BCA.renderEventDetail = (root, events) => {
  const esc = window.BCA.escapeHtml;
  const full = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('e') || '';
  const wantDay = params.get('d') || '';
  if (!slug) return null;
  const withDay = (events || [])
    .map((e) => ({ ...e, day: window.BCA.parseEventDay(e.date) }))
    .filter((e) => e.title && e.day)
    .sort((a, b) => a.day - b.day);
  const matches = withDay.filter((e) => window.BCA.slugify(e.title) === slug);
  if (!matches.length) return null;
  // Anchor on the requested day (else the earliest match), then keep the
  // entries sharing its identity — the same show across its multi-day run.
  const ident = (e) => [e.title, e.dateLabel || '', e.time || '', e.presenter || '', e.url || '', e.description || ''].join(' ');
  const e = (wantDay && matches.find((m) => m.date === wantDay)) || matches[0];
  const when = [e.dateLabel || full.format(e.day), e.time].filter(Boolean).join(' · ');

  root.innerHTML = `
      <p class="eyebrow">Event</p>
      <h1 class="event-detail-title">${esc(e.title)}</h1>
      <p class="event-detail-when">${esc(when)}</p>
      ${e.presenter ? `<p class="event-detail-presenter">Presented by ${esc(e.presenter)}</p>` : ''}
      ${e.description ? `<div class="event-desc event-detail-desc">${window.BCA.mdToHtml(e.description)}</div>` : ''}
      <p class="event-detail-actions">
        ${e.url ? `<a class="btn btn-primary" href="${esc(e.url)}">Get tickets</a>` : ''}
        <a class="btn btn-secondary" href="/booking-calendar">Back to calendar</a>
      </p>`;
  return e;
};

(async () => {
  const lists = document.querySelectorAll('ul[data-events]');
  const pastLists = document.querySelectorAll('ul[data-events-past]');
  const calendars = document.querySelectorAll('[data-events-calendar]');
  const detail = document.querySelector('[data-event-detail]');
  if (!lists.length && !pastLists.length && !calendars.length && !detail) return;
  let data;
  try {
    // Revalidate every load: the event list changes when staff edit it (via
    // /admin) with no ?v= bump, so a cached copy must not win for a day —
    // otherwise Safari/iPad keeps showing stale events. no-cache still lets
    // an unchanged file come back as a cheap 304.
    data = await (await fetch('/assets/data/events.json', { cache: 'no-cache' })).json();
  } catch {
    return;
  }
  const addJsonLd = (graph) => {
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
    document.head.append(ld);
  };
  if (detail) {
    const ev = window.BCA.renderEventDetail(detail, data.events);
    if (ev) {
      document.title = `${ev.title} | Bonita Center for the Arts`;
      addJsonLd(window.BCA.eventsJsonLd([ev]));
    }
  }
  const upcoming = window.BCA.upcomingEvents(data.events);
  const past = window.BCA.pastEvents(data.events);
  const all = window.BCA.allEvents(data.events);
  // Upcoming list(s) — the "what's on" cards. Only these become structured
  // data (a past show marked up as an Event would read as still on sale).
  if (upcoming.length) {
    lists.forEach((list) => {
      window.BCA.renderEvents(list, upcoming, parseInt(list.dataset.max, 10) || 0);
      list.hidden = false;
    });
    addJsonLd(window.BCA.eventsJsonLd(upcoming));
  }
  // Past list(s) — the archive, most recent first, in a collapsible wrapper.
  if (past.length) {
    pastLists.forEach((list) => {
      window.BCA.renderEvents(list, past, parseInt(list.dataset.max, 10) || 0);
      list.hidden = false;
      const wrap = list.closest('[data-past-wrap]');
      if (wrap) wrap.hidden = false;
    });
  }
  // The month grid spans the whole history — its back-arrow steps into the
  // past, the forward-arrow ahead to what's on.
  if (all.length) {
    calendars.forEach((cal) => {
      window.BCA.renderCalendar(cal, all);
      cal.hidden = false;
    });
  }
})();
