// Renders the hand-maintained event list (/assets/data/events.json) into any
// <ul data-events> container. Progressive enhancement only: containers start
// [hidden] and the static "browse our ticketing site" content stays in place,
// so a fetch failure or an empty list leaves the page exactly as authored.
(async () => {
  const lists = document.querySelectorAll('ul[data-events]');
  if (!lists.length) return;

  let data;
  try {
    data = await (await fetch('/assets/data/events.json')).json();
  } catch {
    return;
  }

  // Parse YYYY-MM-DD as local time (new Date('2026-05-09') would be UTC and
  // can shift a day); keep events listed through the day of the show.
  const parseDay = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = (data.events || [])
    .map((e) => ({ ...e, day: parseDay(e.date) }))
    .filter((e) => e.title && e.url && e.day && e.day >= today)
    .sort((a, b) => a.day - b.day);
  if (!upcoming.length) return;

  const esc = (s) => String(s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const full = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  lists.forEach((list) => {
    const max = parseInt(list.dataset.max, 10) || upcoming.length;
    list.innerHTML = upcoming.slice(0, max).map((e) => {
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
    list.hidden = false;
  });
})();
