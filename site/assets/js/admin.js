// Backstage events manager (/admin). Loads the current
// /assets/data/events.json, lets staff edit the list with a live preview,
// and generates the file. Publishing adapts to the environment: if the
// bca-api backend is running (deploy/api/ — GET /api/health answers), a
// "Save to site" button PUTs to /api/events, which nginx protects with
// basic auth; otherwise the page falls back to download/copy for manual
// installation.
(() => {
  const rowsEl = document.getElementById('rows');
  const rowsEmpty = document.getElementById('rows-empty');
  const eventCount = document.getElementById('event-count');
  const jsonOut = document.getElementById('json-out');
  let extras = {};   // _readme/_example and any other non-event keys, preserved on output

  const fullDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const FIELDS = [
    { key: 'title', label: 'Title *', type: 'text', required: true, hint: '' },
    { key: 'date', label: 'Date *', type: 'date', required: true, hint: 'First (or only) performance — used for ordering and expiry' },
    { key: 'time', label: 'Time', type: 'text', hint: 'e.g. 7:00 PM' },
    { key: 'dateLabel', label: 'Date label', type: 'text', hint: 'Optional display override, e.g. “July 18–20”' },
    { key: 'presenter', label: 'Presenter', type: 'text', hint: 'Who’s putting it on (optional)' },
    { key: 'url', label: 'Ticket URL', type: 'url', hint: 'The event’s page on bonitacenterforthearts.ludus.com — leave empty if tickets aren’t sold through our site' },
  ];

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
    sAction.className = 'row-action';
    sAction.textContent = 'Edit';
    summary.append(sTitle, sWhen, sBadge, sAction);

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
    body.append(fields, flag, remove);

    const setOpen = (state) => {
      li.classList.toggle('open', state);
      summary.setAttribute('aria-expanded', state ? 'true' : 'false');
      sAction.textContent = state ? 'Done' : 'Edit';
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
    li.querySelectorAll('input').forEach((input) => {
      const v = input.value.trim();
      if (v) e[input.dataset.key] = v;
    });
    return e;
  }

  // Keep a row's collapsed summary and its warnings in sync with its fields.
  function paintRow(li, e) {
    const day = window.BCA.parseEventDay(e.date);
    const title = li.querySelector('.row-title');
    title.textContent = e.title || 'Untitled event';
    title.classList.toggle('is-empty', !e.title);

    const when = [];
    if (e.dateLabel) when.push(e.dateLabel);
    else if (day) when.push(fullDate.format(day));
    else when.push('no date yet');
    if (e.time) when.push(e.time);
    if (e.presenter) when.push(e.presenter);
    li.querySelector('.row-when').textContent = when.join(' · ');

    const problems = [];
    if (!e.title || !e.date) problems.push('needs a title and date to appear on the site');
    if (e.date && day && day < today()) problems.push('date is in the past — it won’t be shown (safe to remove)');
    if (e.url && !/^https:\/\//.test(e.url)) problems.push('ticket URL should start with https://');

    const flag = li.querySelector('.row-flag');
    flag.textContent = problems.length ? `⚠ This event ${problems.join('; ')}.` : '';
    flag.hidden = !problems.length;
    const badge = li.querySelector('.row-badge');
    badge.hidden = !problems.length;
    badge.title = problems.join('; ');
  }

  function currentEvents() {
    return [...rowsEl.children].map(readRow).filter((e) => Object.keys(e).length);
  }

  function refresh() {
    [...rowsEl.children].forEach((li) => paintRow(li, readRow(li)));
    const events = currentEvents();
    rowsEmpty.hidden = rowsEl.children.length > 0;
    eventCount.textContent = events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : '';
    const sorted = [...events].sort((a, b) => {
      const da = window.BCA.parseEventDay(a.date), db = window.BCA.parseEventDay(b.date);
      return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
    });
    jsonOut.value = `${JSON.stringify({ ...extras, events: sorted }, null, 2)}\n`;
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

  // Publishing modes, decided by /api/health:
  //   no backend            -> download/copy only (static mode)
  //   backend, signed out   -> staff login form
  //   backend, signed in    -> "Save to site" + staff accounts section
  const saveBtn = document.getElementById('save');
  const saveStatus = document.getElementById('save-status');
  const loginForm = document.getElementById('login');
  const loginStatus = document.getElementById('login-status');
  const logoutBtn = document.getElementById('logout');
  const whoami = document.getElementById('whoami');

  function setMode(mode, user) {   // 'static' | 'login' | 'live'
    document.getElementById('publish-note').hidden = mode !== 'static';
    document.getElementById('publish-note-login').hidden = mode !== 'login';
    document.getElementById('publish-note-live').hidden = mode !== 'live';
    loginForm.hidden = mode !== 'login';
    saveBtn.hidden = mode !== 'live';
    logoutBtn.hidden = mode !== 'live';
    whoami.hidden = mode !== 'live';
    if (user) whoami.textContent = `Signed in as ${user}`;
    document.getElementById('download').hidden = mode !== 'static';
    document.getElementById('accounts').hidden = mode !== 'live';
    if (mode === 'live') loadUserList();
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

  (async () => {
    try {
      const res = await fetch('/api/health');
      const h = await res.json();
      if (!res.ok || !h.ok || !h.configured) return;   // stays in static mode
      setMode(h.auth ? 'live' : 'login', h.user);
    } catch { /* no backend: stay in download/copy mode */ }
  })();

  (async () => {
    try {
      const data = await (await fetch('/assets/data/events.json', { cache: 'no-store' })).json();
      const { events, ...rest } = data;
      extras = rest;
      (events || []).forEach((e) => addRow(e));   // collapsed; index must not leak in as `open`
    } catch {
      extras = {};
    }
    refresh();
  })();
})();
