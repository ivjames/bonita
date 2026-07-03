// Backstage manager (/admin). Sign-in gated end to end: the page shows
// nothing editable until staff authenticate against the bca-api backend
// (deploy/api/ — GET /api/health reports whether it's up and whether this
// request is signed in). Modes, decided by that probe:
//   backend unreachable / not configured -> a locked "unavailable" notice
//   backend up, signed out               -> the staff sign-in form, nothing else
//   backend up, signed in                -> the full manager (events, messages,
//                                           media, staff accounts). "Save to site"
//                                           PUTs /api/events; the server enforces
//                                           the session cookie on every write.
// There is deliberately no open, no-login fallback: if the backend is down
// the manager locks rather than exposing an editor.
(() => {
  const rowsEl = document.getElementById('rows');
  const rowsEmpty = document.getElementById('rows-empty');
  const eventCount = document.getElementById('event-count');
  const jsonOut = document.getElementById('json-out');
  let extras = {};   // _readme/_example and any other non-event keys, preserved on output

  const fullDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const FIELDS = [
    { key: 'title', label: 'Title *', type: 'text', required: true, hint: '' },
    { key: 'date', label: 'Start date *', type: 'date', required: true, hint: 'The day of the event, or the first day of a multi-day run' },
    { key: 'dateEnd', label: 'End date', type: 'date', hint: 'Only for a multi-day run — the last day. Leave empty for a single day; every day in the range is added to the calendar automatically.' },
    { key: 'time', label: 'Time', type: 'text', hint: 'e.g. 7:00 PM' },
    { key: 'presenter', label: 'Presenter', type: 'text', hint: 'Who’s putting it on (optional)' },
    { key: 'url', label: 'Ticket URL', type: 'url', hint: 'The event’s page on bonitacenterforthearts.ludus.com — leave empty if tickets aren’t sold through our site' },
    { key: 'description', label: 'Description', type: 'textarea', hint: 'Optional blurb shown under the event. Markdown: **bold**, _italic_, [text](https://…). Blank line starts a new paragraph.' },
  ];

  const monthLong = new Intl.DateTimeFormat('en-US', { month: 'long' });
  const parseDay = (s) => window.BCA.parseEventDay(s);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);   // whole days, DST-safe

  // Display label for a multi-day run: "July 17–19" within a month/year,
  // "December 21 – January 1" across one. Matches how events.json labels runs.
  const rangeLabel = (startStr, endStr) => {
    const s = parseDay(startStr), e = parseDay(endStr);
    if (!s || !e) return '';
    const sM = monthLong.format(s), eM = monthLong.format(e);
    return (sM === eM && s.getFullYear() === e.getFullYear())
      ? `${sM} ${s.getDate()}–${e.getDate()}`
      : `${sM} ${s.getDate()} – ${eM} ${e.getDate()}`;
  };

  // Everything a run shares day-to-day (date + dateLabel are per-run, derived).
  const runSig = (e) => JSON.stringify([e.title || '', e.time || '', e.presenter || '', e.url || '', e.description || '']);
  const runShared = (e) => {
    const r = { title: e.title || '', date: e.date || '' };
    if (e.time) r.time = e.time;
    if (e.presenter) r.presenter = e.presenter;
    if (e.url) r.url = e.url;
    if (e.description) r.description = e.description;
    return r;
  };

  // events.json stores one entry per day (so the calendar grid marks each day);
  // the editor collapses consecutive same-event days into a single run row.
  const groupRuns = (events) => {
    const valid = [], invalid = [];
    for (const e of (events || [])) (parseDay(e.date) ? valid : invalid).push(e);
    valid.sort((a, b) => parseDay(a.date) - parseDay(b.date));
    const runs = [];
    let cur = null, lastDay = null;
    for (const e of valid) {
      const day = parseDay(e.date);
      if (cur && cur._sig === runSig(e) && dayDiff(lastDay, day) === 1) {
        cur.dateEnd = e.date;   // extend the run
      } else {
        cur = runShared(e); cur._sig = runSig(e); runs.push(cur);
      }
      lastDay = day;
    }
    runs.forEach((r) => delete r._sig);
    invalid.forEach((e) => runs.push(runShared(e)));   // keep date-less entries as their own rows
    return runs;
  };

  // Inverse of groupRuns: a run row -> one entry per day, with the run's
  // display label on multi-day runs, sorted by date. This is what ships.
  const expandRuns = (runs) => {
    const out = [];
    for (const r of runs) {
      const start = parseDay(r.date);
      if (!r.title || !start) continue;   // incomplete rows don't ship (same as before)
      const end = r.dateEnd ? parseDay(r.dateEnd) : null;
      const multi = end && end.getTime() > start.getTime();
      const label = multi ? rangeLabel(r.date, r.dateEnd) : '';
      const last = multi ? end : start;
      for (let d = new Date(start.getTime()); d.getTime() <= last.getTime(); d.setDate(d.getDate() + 1)) {
        const ev = { title: r.title, date: ymd(d) };
        if (r.time) ev.time = r.time;
        if (multi) ev.dateLabel = label;
        if (r.presenter) ev.presenter = r.presenter;
        if (r.url) ev.url = r.url;
        if (r.description) ev.description = r.description;
        out.push(ev);
      }
    }
    return out.sort((a, b) => parseDay(a.date) - parseDay(b.date));
  };

  const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

  function addRow(event = {}, open = false) {
    const li = document.createElement('li');
    li.className = 'event-row';

    // Collapsed summary — the row as it reads in the list. Clicking it opens
    // the editing fields; it stays a scannable one-liner the rest of the time.
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'row-summary';
    summary.setAttribute('aria-expanded', 'false');
    const sTitle = document.createElement('span');
    sTitle.className = 'row-title';
    const sWhen = document.createElement('span');
    sWhen.className = 'row-when';
    const sBadge = document.createElement('span');
    sBadge.className = 'row-badge';
    sBadge.textContent = '⚠';
    sBadge.hidden = true;
    const sAction = document.createElement('span');
    sAction.className = 'row-chevron';
    sAction.setAttribute('aria-hidden', 'true');
    summary.append(sBadge, sTitle, sWhen, sAction);

    const body = document.createElement('div');
    body.className = 'row-body';
    const fields = document.createElement('div');
    fields.className = 'fields';
    FIELDS.forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = `field field-${f.key}`;
      const id = `f-${f.key}-${Math.floor(performance.now() * 1000)}-${rowsEl.children.length}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = f.label;
      const input = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
      if (f.type === 'textarea') input.rows = 3; else input.type = f.type;
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
    body.append(fields, flag, remove);

    const setOpen = (state) => {
      li.classList.toggle('open', state);
      summary.setAttribute('aria-expanded', state ? 'true' : 'false');
    };
    summary.addEventListener('click', () => {
      const nowOpen = !li.classList.contains('open');
      setOpen(nowOpen);
      if (nowOpen) fields.querySelector('input').focus();
    });
    if (open) setOpen(true);

    li.append(summary, body);
    rowsEl.append(li);
    return li;
  }

  function readRow(li) {
    const e = {};
    li.querySelectorAll('input, textarea').forEach((input) => {
      const v = input.value.trim();
      if (v) e[input.dataset.key] = v;
    });
    return e;
  }

  // Keep a row's collapsed summary and its warnings in sync with its fields.
  // `r` is a run: title, date (start), optional dateEnd, time, presenter, url…
  function paintRow(li, r) {
    const start = parseDay(r.date);
    const end = r.dateEnd ? parseDay(r.dateEnd) : null;
    const multi = start && end && end.getTime() > start.getTime();
    const title = li.querySelector('.row-title');
    title.textContent = r.title || 'Untitled event';
    title.classList.toggle('is-empty', !r.title);

    const when = [];
    if (multi) when.push(`${rangeLabel(r.date, r.dateEnd)} · ${dayDiff(start, end) + 1} days`);
    else if (start) when.push(fullDate.format(start));
    else when.push('no date yet');
    if (r.time) when.push(r.time);
    if (r.presenter) when.push(r.presenter);
    li.querySelector('.row-when').textContent = when.join(' · ');

    const lastDay = multi ? end : start;
    const problems = [];
    if (!r.title || !r.date) problems.push('needs a title and start date to appear on the site');
    if (r.dateEnd && end && start && end.getTime() < start.getTime()) problems.push('end date is before the start date');
    if (r.date && lastDay && lastDay < today()) problems.push('date is in the past — it won’t be shown (safe to remove)');
    if (r.url && !/^https:\/\//.test(r.url)) problems.push('ticket URL should start with https://');

    const flag = li.querySelector('.row-flag');
    flag.textContent = problems.length ? `⚠ This event ${problems.join('; ')}.` : '';
    flag.hidden = !problems.length;
    const badge = li.querySelector('.row-badge');
    badge.hidden = !problems.length;
    badge.title = problems.join('; ');
  }

  function refresh() {
    const runs = [...rowsEl.children].map(readRow);
    [...rowsEl.children].forEach((li, i) => paintRow(li, runs[i]));
    const filled = runs.filter((r) => Object.keys(r).length);
    rowsEmpty.hidden = rowsEl.children.length > 0;
    eventCount.textContent = filled.length ? `${filled.length} event${filled.length === 1 ? '' : 's'}` : '';
    setStat('stat-events', filled.length);
    setBadge('nav-events', filled.length);
    jsonOut.value = `${JSON.stringify({ ...extras, events: expandRuns(filled) }, null, 2)}\n`;
  }

  // Dashboard tiles + sidebar badges reflect live counts.
  function setStat(id, n) { const el = document.getElementById(id); if (el) el.textContent = String(n); }
  function setBadge(id, n) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(n);
    el.hidden = !n;
  }

  document.getElementById('add').addEventListener('click', () => {
    addRow({}, true).querySelector('input').focus();
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

  // Modes, decided by /api/health:
  //   'down'  backend unreachable / not configured -> locked notice only
  //   'login' backend up, signed out               -> sign-in form only
  //   'live'  backend up, signed in                -> the full manager
  const saveBtn = document.getElementById('save');
  const saveStatus = document.getElementById('save-status');
  const loginForm = document.getElementById('login');
  const loginStatus = document.getElementById('login-status');
  const logoutBtn = document.getElementById('logout');
  const whoami = document.getElementById('whoami');

  // Section tabs (live only): the sidebar rail swaps one work panel at a time,
  // so the console shows a focused view rather than one long scroll.
  const navItems = [...document.querySelectorAll('.nav-item')];
  const panels = [...document.querySelectorAll('.panel')];
  function activateTab(name) {
    navItems.forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach((p) => { p.hidden = p.dataset.tab !== name; });
  }
  navItems.forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => activateTab(el.dataset.goto)));

  function setMode(mode, user) {   // 'down' | 'login' | 'live'
    const live = mode === 'live', login = mode === 'login', down = mode === 'down';
    // Everything editable is live-only. Signed out / unreachable shows only the
    // centred gate card (sign-in form or notice); the console shell — sidebar,
    // panels, publish action — renders only with a session.
    document.getElementById('publish-note-down').hidden = !down;
    document.getElementById('publish-note-login').hidden = !login;
    document.getElementById('publish-note-live').hidden = !live;
    document.getElementById('gate').hidden = live;
    document.getElementById('app').hidden = !live;
    const gateTitle = document.getElementById('gate-title');
    if (gateTitle) gateTitle.textContent = down ? 'Backstage is unavailable' : 'Sign in to Backstage';
    loginForm.hidden = !login;
    logoutBtn.hidden = !live;
    whoami.hidden = !live;
    if (user) whoami.textContent = `Signed in as ${user}`;
    if (live) { activateTab('overview'); loadUserList(); loadMessages(); loadMedia(); }
  }

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
      if (res.status === 401) { setMode('login'); throw new Error('session expired — sign in again'); }
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

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('login-user');
    const pass = document.getElementById('login-pass');
    loginStatus.hidden = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: user.value, password: pass.value }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `sign-in failed (${res.status})`);
      pass.value = '';
      setMode('live', out.user);
    } catch (err) {
      loginStatus.hidden = false;
      loginStatus.textContent = `⚠ ${err.message}`;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    saveStatus.hidden = true;
    setMode('login');
  });

  // ---- staff accounts (visible only when signed in) ----
  const userList = document.getElementById('user-list');

  async function loadUserList() {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) return;
      const { users } = await res.json();
      setStat('stat-staff', users.length);
      userList.innerHTML = '';
      users.forEach(({ name }) => {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = name;
        li.append(label);
        if (users.length > 1) {
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'btn-link';
          rm.textContent = 'Remove';
          rm.addEventListener('click', async () => {
            if (!confirm(`Remove the account "${name}"? They won't be able to sign in.`)) return;
            const del = await fetch(`/api/users/${encodeURIComponent(name)}`, { method: 'DELETE' });
            if (del.ok) loadUserList();
          });
          li.append(rm);
        }
        userList.append(li);
      });
    } catch { /* leave the list as-is */ }
  }

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('pw-status');
    const current = document.getElementById('pw-current');
    const fresh = document.getElementById('pw-new');
    status.hidden = false;
    status.className = 'save-status';
    status.textContent = 'Changing…';
    try {
      const res = await fetch('/api/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current: current.value, new: fresh.value }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `failed (${res.status})`);
      current.value = fresh.value = '';
      status.classList.add('ok');
      status.textContent = 'Password changed ✓';
    } catch (err) {
      status.classList.add('err');
      status.textContent = `⚠ ${err.message}`;
    }
  });

  document.getElementById('adduser-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('au-status');
    const name = document.getElementById('au-name');
    const pass = document.getElementById('au-pass');
    status.hidden = false;
    status.className = 'save-status';
    status.textContent = 'Adding…';
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.value, password: pass.value }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `failed (${res.status})`);
      status.classList.add('ok');
      status.textContent = out.existed ? `Password reset for ${name.value} ✓` : `Account added ✓`;
      name.value = pass.value = '';
      loadUserList();
    } catch (err) {
      status.classList.add('err');
      status.textContent = `⚠ ${err.message}`;
    }
  });

  // ---- messages inbox (visible only when signed in) ----
  const msgList = document.getElementById('message-list');
  const msgEmpty = document.getElementById('messages-empty');
  const msgStatus = document.getElementById('messages-status');
  const msgCount = document.getElementById('messages-count');
  const FORM_LABELS = { 'rental-inquiry': 'Rental inquiry', 'lost-and-found': 'Lost & found' };
  const fmtWhen = (iso) => {
    try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
    catch { return iso; }
  };

  // Render a field value as a clickable mailto:/tel: link when it looks like
  // one (staff reply straight from the inbox), else as plain text.
  function fieldValue(v) {
    const s = String(v);
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
      const a = document.createElement('a'); a.href = `mailto:${s}`; a.textContent = s; return a;
    }
    const digits = s.replace(/\D/g, '');
    if (/^[+\d\s().-]+$/.test(s) && digits.length >= 7 && digits.length <= 15) {
      const a = document.createElement('a'); a.href = `tel:${s.replace(/[^+\d]/g, '')}`; a.textContent = s; return a;
    }
    return document.createTextNode(s);
  }

  function renderMessages(submissions) {
    msgList.innerHTML = '';
    msgEmpty.hidden = submissions.length > 0;
    submissions.forEach((m) => {
      const li = document.createElement('li');
      li.className = `message${m.handled ? ' handled' : ''}`;

      const head = document.createElement('div');
      head.className = 'message-head';
      const type = document.createElement('span');
      type.className = 'message-type';
      type.textContent = FORM_LABELS[m.form] || m.form;
      const when = document.createElement('time');
      when.dateTime = m.at || '';
      when.textContent = m.at ? fmtWhen(m.at) : '';
      head.append(type, when);
      if (m.handled) {
        const tag = document.createElement('span');
        tag.className = 'message-tag';
        tag.textContent = 'Handled';
        head.append(tag);
      }

      const dl = document.createElement('dl');
      dl.className = 'message-fields';
      Object.entries(m.fields || {}).forEach(([k, v]) => {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.append(fieldValue(v));
        dl.append(dt, dd);
      });

      const actions = document.createElement('p');
      actions.className = 'admin-actions';
      const handleBtn = document.createElement('button');
      handleBtn.type = 'button';
      handleBtn.className = 'btn btn-secondary';
      handleBtn.textContent = m.handled ? 'Mark unhandled' : 'Mark handled';
      handleBtn.addEventListener('click', () => setHandled(m, handleBtn));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-link';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => removeMessage(m));
      actions.append(handleBtn, delBtn);

      li.append(head, dl, actions);
      msgList.append(li);
    });
  }

  async function loadMessages() {
    try {
      const res = await fetch('/api/forms');
      if (!res.ok) return;
      const { submissions, unhandled } = await res.json();
      renderMessages(submissions || []);
      msgCount.textContent = unhandled ? `${unhandled} new` : '';
      msgCount.hidden = !unhandled;
      setStat('stat-messages', unhandled || 0);
      setBadge('nav-messages', unhandled || 0);
    } catch { /* leave the list as-is */ }
  }

  async function setHandled(m, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(`/api/forms/${m.id}/handled`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handled: !m.handled }),
      });
      if (!res.ok) throw new Error();
      await loadMessages();
    } catch { btn.disabled = false; }
  }

  async function removeMessage(m) {
    if (!confirm('Delete this message? This can’t be undone.')) return;
    msgStatus.hidden = true;
    try {
      const res = await fetch(`/api/forms/${m.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await loadMessages();
    } catch {
      msgStatus.hidden = false;
      msgStatus.className = 'save-status err';
      msgStatus.textContent = '⚠ Could not delete that message — try again.';
    }
  }

  // ---- media (swappable support PDFs; visible only when signed in) ----
  const mediaList = document.getElementById('media-list');
  const mediaStatus = document.getElementById('media-status');
  const fmtSize = (n) => (n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`);
  const fmtDate = (iso) => {
    try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso)); }
    catch { return iso; }
  };

  function mediaMsg(kind, text) {
    mediaStatus.hidden = false;
    mediaStatus.className = `save-status ${kind}`.trim();
    mediaStatus.textContent = text;
  }

  function renderMedia(docs) {
    mediaList.innerHTML = '';
    docs.forEach((d) => {
      const li = document.createElement('li');
      li.className = `media-item${d.override ? ' replaced' : ''}`;

      const head = document.createElement('div');
      head.className = 'media-head';
      const label = document.createElement('span');
      label.className = 'media-label';
      label.textContent = d.label;
      const tag = document.createElement('span');
      tag.className = 'media-tag';
      if (d.override) {
        tag.classList.add('is-replaced');
        tag.textContent = `Replaced ${fmtDate(d.override.updated)} · ${fmtSize(d.override.size)}`;
      } else {
        tag.textContent = 'Original';
      }
      head.append(label, tag);

      // Link the live file, cache-busted so a fresh swap shows immediately.
      const view = document.createElement('a');
      view.className = 'media-view';
      const stamp = d.override ? new Date(d.override.updated).getTime() : 0;
      view.href = `${d.url}?t=${stamp}`;
      view.target = '_blank';
      view.rel = 'noopener';
      view.textContent = 'View current PDF';

      const form = document.createElement('form');
      form.className = 'media-upload';
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'application/pdf,.pdf';
      file.required = true;
      const replace = document.createElement('button');
      replace.type = 'submit';
      replace.className = 'btn btn-secondary';
      replace.textContent = 'Replace…';
      form.append(file, replace);
      form.addEventListener('submit', (e) => { e.preventDefault(); uploadMedia(d, file.files[0], form); });

      const actions = document.createElement('p');
      actions.className = 'media-actions';
      actions.append(view);
      if (d.override) {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn-link';
        restore.textContent = 'Restore original';
        restore.addEventListener('click', () => restoreMedia(d));
        actions.append(restore);
      }

      li.append(head, form, actions);
      mediaList.append(li);
    });
  }

  async function loadMedia() {
    try {
      const res = await fetch('/api/media');
      if (!res.ok) return;
      const { docs } = await res.json();
      renderMedia(docs || []);
      setStat('stat-media', (docs || []).filter((d) => d.override).length);
    } catch { /* leave the list as-is */ }
  }

  async function uploadMedia(doc, fileObj, form) {
    if (!fileObj) return;
    if (fileObj.type && fileObj.type !== 'application/pdf' && !/\.pdf$/i.test(fileObj.name)) {
      mediaMsg('err', `⚠ ${doc.label}: choose a PDF file.`);
      return;
    }
    const btn = form.querySelector('button');
    btn.disabled = true;
    mediaMsg('', `Uploading ${doc.label}…`);
    try {
      const res = await fetch(`/api/media/${doc.slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: fileObj,   // raw bytes; same-origin so the API's Origin check passes
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { setMode('login'); throw new Error('session expired — sign in again'); }
      if (!res.ok) throw new Error(out.error || `upload failed (${res.status})`);
      form.reset();
      mediaMsg('ok', `${doc.label} replaced ✓`);
      await loadMedia();
    } catch (err) {
      mediaMsg('err', `⚠ ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  async function restoreMedia(doc) {
    if (!confirm(`Restore the original ${doc.label}? The uploaded version will be removed.`)) return;
    try {
      const res = await fetch(`/api/media/${doc.slug}`, { method: 'DELETE' });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { setMode('login'); throw new Error('session expired — sign in again'); }
      if (!res.ok) throw new Error(out.error || `restore failed (${res.status})`);
      mediaMsg('ok', `${doc.label} restored to the original ✓`);
      await loadMedia();
    } catch (err) {
      mediaMsg('err', `⚠ ${err.message}`);
    }
  }

  (async () => {
    try {
      const res = await fetch('/api/health');
      const h = await res.json();
      if (!res.ok || !h.ok || !h.configured) { setMode('down'); return; }
      setMode(h.auth ? 'live' : 'login', h.user);
    } catch { setMode('down'); /* backend unreachable: lock, don't fall open */ }
  })();

  (async () => {
    try {
      const data = await (await fetch('/assets/data/events.json', { cache: 'no-store' })).json();
      const { events, ...rest } = data;
      extras = rest;
      groupRuns(events).forEach((run) => addRow(run));   // collapse day-runs; all start collapsed
    } catch {
      extras = {};
    }
    refresh();
  })();
})();
