// Renders the hand-maintained event list (/assets/data/events.json) into any
// <ul data-events> container. Progressive enhancement only: containers start
// [hidden] and the static "browse our ticketing site" content stays in place,
// so a fetch failure or an empty list leaves the page exactly as authored.
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

// Filter to valid, not-yet-past events, soonest first.
window.BCA.upcomingEvents = (events) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (events || [])
    .map((e) => ({ ...e, day: window.BCA.parseEventDay(e.date) }))
    .filter((e) => e.title && e.url && e.day && e.day >= today)
    .sort((a, b) => a.day - b.day);
};

// Fill a <ul> with playbill-style event cards. `upcoming` must come from
// upcomingEvents(). Returns the number of cards rendered.
window.BCA.renderEvents = (list, upcoming, max) => {
  const esc = (s) => String(s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const full = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const shown = upcoming.slice(0, max || upcoming.length);
  list.innerHTML = shown.map((e) => {
    const when = [e.dateLabel || full.format(e.day), e.time].filter(Boolean).join(' · ');
    return `<li class="event">
      <a href="${esc(e.url)}">
        <span class="event-date">
          <span class="d">${e.day.getDate()}</span>
          <span class="m">${month.format(e.day)}</span>
        </span>
        <span class="event-info">
          <span class="event-title">${esc(e.title)}</span>
          <span class="event-meta">${esc(when)}${e.presenter ? ` — ${esc(e.presenter)}` : ''}</span>
        </span>
        <span class="event-cta" aria-hidden="true">Tickets →</span>
      </a>
    </li>`;
  }).join('');
  return shown.length;
};

(async () => {
  const lists = document.querySelectorAll('ul[data-events]');
  if (!lists.length) return;
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
})();
