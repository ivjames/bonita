// Backstage events manager (/admin). Loads the current
// /assets/data/events.json, lets staff edit the list with a live preview,
// and generates the file. Publishing adapts to the environment: if the
// bca-api backend is running (deploy/api/ — GET /api/health answers), a
// "Save to site" button PUTs to /api/events, which nginx protects with
// basic auth; otherwise the page falls back to download/copy for manual
// installation.
(() => {
  const rowsEl = document.getElementById('rows');
  const previewList = document.getElementById('preview-list');
  const previewEmpty = document.getElementById('preview-empty');
  const jsonOut = document.getElementById('json-out');
  let extras = {};   // _readme/_example and any other non-event keys, preserved on output

  const FIELDS = [
    { key: 'title', label: 'Title *', type: 'text', required: true, hint: '' },
    { key: 'date', label: 'Date *', type: 'date', required: true, hint: 'First (or only) performance — used for ordering and expiry' },
    { key: 'time', label: 'Time', type: 'text', hint: 'e.g. 7:00 PM' },
    { key: 'dateLabel', label: 'Date label', type: 'text', hint: 'Optional display override, e.g. “July 18–20”' },
    { key: 'presenter', label: 'Presenter', type: 'text', hint: 'Who’s putting it on (optional)' },
    { key: 'url', label: 'Ticket URL *', type: 'url', required: true, hint: 'The event’s page on bonitacenterforthearts.ludus.com' },
  ];

  const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

  function addRow(event = {}) {
    const li = document.createElement('li');
    li.className = 'event-row';
    const fields = document.createElement('div');
    fields.className = 'fields';
    FIELDS.forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = `field field-${f.key}`;
      const id = `f-${f.key}-${Math.floor(performance.now() * 1000)}-${rowsEl.children.length}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = f.type;
      input.id = id;
      input.dataset.key = f.key;
      if (f.required) input.required = true;
      if (f.hint) input.title = f.hint;
      input.value = event[f.key] || '';
      wrap.append(label, input);
      fields.append(wrap);
    });
    const flag = document.createElement('p');
    flag.className = 'row-flag';
    flag.hidden = true;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-secondary btn-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => { li.remove(); refresh(); });
    li.append(fields, flag, remove);
    rowsEl.append(li);
    return li;
  }

  function readRow(li) {
    const e = {};
    li.querySelectorAll('input').forEach((input) => {
      const v = input.value.trim();
      if (v) e[input.dataset.key] = v;
    });
    return e;
  }

  function flagRow(li, e) {
    const flag = li.querySelector('.row-flag');
    const problems = [];
    if (!e.title || !e.date || !e.url) problems.push('needs a title, date, and ticket URL to appear on the site');
    const day = window.BCA.parseEventDay(e.date);
    if (e.date && day && day < today()) problems.push('date is in the past — it won’t be shown (safe to remove)');
    if (e.url && !/^https:\/\//.test(e.url)) problems.push('ticket URL should start with https://');
    flag.textContent = problems.length ? `⚠ This event ${problems.join('; ')}.` : '';
    flag.hidden = !problems.length;
  }

  function currentEvents() {
    return [...rowsEl.children].map(readRow).filter((e) => Object.keys(e).length);
  }

  function refresh() {
    [...rowsEl.children].forEach((li) => flagRow(li, readRow(li)));
    const events = currentEvents();
    const upcoming = window.BCA.upcomingEvents(events);
    const shown = window.BCA.renderEvents(previewList, upcoming, 0);
    previewEmpty.hidden = shown > 0;
    // Neutralize preview links so a stray click doesn't leave the editor.
    previewList.querySelectorAll('a').forEach((a) => a.addEventListener('click', (ev) => ev.preventDefault()));
    const sorted = [...events].sort((a, b) => {
      const da = window.BCA.parseEventDay(a.date), db = window.BCA.parseEventDay(b.date);
      return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
    });
    jsonOut.value = `${JSON.stringify({ ...extras, events: sorted }, null, 2)}\n`;
  }

  document.getElementById('add').addEventListener('click', () => {
    addRow().querySelector('input').focus();
    refresh();
  });
  document.getElementById('sort').addEventListener('click', () => {
    const rows = [...rowsEl.children];
    rows.sort((a, b) => {
      const da = window.BCA.parseEventDay(readRow(a).date), db = window.BCA.parseEventDay(readRow(b).date);
      return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
    });
    rows.forEach((r) => rowsEl.append(r));
    refresh();
  });
  document.getElementById('download').addEventListener('click', () => {
    const blob = new Blob([jsonOut.value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'events.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('copy').addEventListener('click', async () => {
    const done = document.getElementById('copy-done');
    try {
      await navigator.clipboard.writeText(jsonOut.value);
    } catch {
      jsonOut.select();  // clipboard API needs a secure context; fall back to manual copy
      document.execCommand && document.execCommand('copy');
    }
    done.hidden = false;
    setTimeout(() => { done.hidden = true; }, 2000);
  });
  rowsEl.addEventListener('input', refresh);

  // "Save to site" appears only when the bca-api backend answers.
  const saveBtn = document.getElementById('save');
  const saveStatus = document.getElementById('save-status');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveStatus.hidden = false;
    saveStatus.className = 'save-status';
    saveStatus.textContent = 'Saving…';
    try {
      const res = await fetch('/api/events', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: jsonOut.value,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `save failed (${res.status})`);
      saveStatus.classList.add('ok');
      saveStatus.textContent = `Saved — ${out.events} event${out.events === 1 ? '' : 's'} live ✓`;
    } catch (err) {
      saveStatus.classList.add('err');
      saveStatus.textContent = `⚠ ${err.message}`;
    } finally {
      saveBtn.disabled = false;
    }
  });
  (async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok || !(await res.json()).ok) return;
      saveBtn.hidden = false;
      document.getElementById('download').hidden = true;   // Save is the one true button
      document.getElementById('publish-note').hidden = true;
      document.getElementById('publish-note-live').hidden = false;
    } catch { /* no backend: stay in download/copy mode */ }
  })();

  (async () => {
    try {
      const data = await (await fetch('/assets/data/events.json', { cache: 'no-store' })).json();
      const { events, ...rest } = data;
      extras = rest;
      (events || []).forEach(addRow);
    } catch {
      extras = {};
    }
    if (!rowsEl.children.length) addRow();
    refresh();
  })();
})();
