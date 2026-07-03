// Contact forms submit to the bca-api backend (POST /api/forms), which spools
// the message and emails it to staff. If the backend is unreachable (or
// declines, e.g. rate-limited), we fall back to composing a pre-filled email
// in the visitor's mail app so the message still gets through. Each form
// declares data-mailto (recipient), data-subject (subject prefix), and
// data-form (backend label); field labels come from data-label on the
// controls, and a `website` honeypot input traps bots.
document.querySelectorAll('form[data-mailto]').forEach((form) => {
  // A polite live-region for the result, inserted once before the submit note.
  const status = document.createElement('p');
  status.className = 'form-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  form.querySelector('button[type="submit"]').insertAdjacentElement('afterend', status);

  // Named controls with a value, minus the honeypot — empties are dropped so
  // the spooled/emailed message doesn't carry blank optional fields.
  const namedControls = () =>
    [...form.querySelectorAll('input, textarea')]
      .filter((c) => c.name && c.name !== 'website' && c.value.trim());

  const composeMailto = () => {
    const body = namedControls().map((c) => `${c.dataset.label || c.name}: ${c.value}`).join('\n');
    const subjField = form.querySelector('[name="subject"]');
    const prefix = form.dataset.subject || 'Website inquiry';
    const subject = subjField && subjField.value ? `${prefix}: ${subjField.value}` : prefix;
    window.location.href =
      `mailto:${form.dataset.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const show = (msg, ok) => {
    status.textContent = msg;
    status.className = `form-status${ok ? ' ok' : ' err'}`;
    status.hidden = false;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button[type="submit"]');

    const fields = {};
    namedControls().forEach((c) => { fields[c.dataset.label || c.name] = c.value; });
    const payload = {
      form: form.dataset.form || form.dataset.subject || 'inquiry',
      fields,
      website: form.querySelector('[name="website"]')?.value || '',
    };

    btn.disabled = true;
    show('Sending…', true);
    try {
      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`backend responded ${res.status}`);
      form.reset();
      show("Thanks — we've got your message and will be in touch.", true);
    } catch {
      // Backend down or refused: hand off to the visitor's mail app instead.
      status.hidden = true;
      composeMailto();
    } finally {
      btn.disabled = false;
    }
  });
});

// Content that used to live on the long single-scroll /about and /rentals
// pages now has its own subpages. Fragments never reach the server, so old
// deep links like /rentals#audio land on the landing page — forward them.
const FORWARDS = {
  '/about': {
    'contact': '/about/contact', 'lost-and-found': '/about/contact',
    'location': '/about/visit', 'seating': '/about/visit',
    'policies': '/about/policies',
  },
  '/rentals': {
    'policies': '/rentals/policies', 'building': '/rentals/building',
    'stage': '/rentals/tech-specs', 'orchestra': '/rentals/tech-specs',
    'audio': '/rentals/tech-specs', 'lighting': '/rentals/tech-specs',
    'video': '/rentals/tech-specs', 'rigging': '/rentals/tech-specs',
  },
};
const forward = (FORWARDS[window.location.pathname.replace(/\/$/, '')] || {})[window.location.hash.slice(1)];
if (forward) window.location.replace(forward + window.location.hash);

// On accordion pages (/rentals/tech-specs), anchors point inside <details>:
// open the accordion holding the target so the jump actually lands there.
const revealTarget = () => {
  const id = decodeURIComponent(window.location.hash.slice(1));
  const el = id && document.getElementById(id);
  const acc = el && el.closest('details');
  // open first, then scroll a frame later — the browser's own scroll-to-
  // fragment attempt (which found the element hidden) can land after ours
  if (acc && !acc.open) {
    acc.open = true;
    requestAnimationFrame(() => el.scrollIntoView());
  }
};
window.addEventListener('hashchange', revealTarget);
revealTarget();

// Gallery lightbox: click a photo to view it enlarged, with keyboard
// navigation (← → to move, Esc to close). Progressive enhancement — with no
// JS the masonry grid still shows every photo; this only adds the zoom.
const gallery = document.querySelector('.gallery');
if (gallery) {
  const imgs = [...gallery.querySelectorAll('img')];
  const dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.setAttribute('aria-label', 'Photo viewer');
  dlg.innerHTML =
    '<button type="button" class="lb-close" aria-label="Close viewer">×</button>' +
    '<button type="button" class="lb-nav lb-prev" aria-label="Previous photo">‹</button>' +
    '<figure class="lb-stage"><img class="lb-img" alt=""><figcaption class="lb-cap"></figcaption></figure>' +
    '<button type="button" class="lb-nav lb-next" aria-label="Next photo">›</button>';
  document.body.appendChild(dlg);
  const lbImg = dlg.querySelector('.lb-img');
  const lbCap = dlg.querySelector('.lb-cap');
  let idx = 0;
  let opener = null;

  const show = (i) => {
    idx = (i + imgs.length) % imgs.length;
    lbImg.src = imgs[idx].currentSrc || imgs[idx].src;
    lbImg.alt = imgs[idx].alt;
    // Visible caption is the photo's own title (data-caption); some have none.
    const cap = imgs[idx].dataset.caption || '';
    lbCap.textContent = cap;
    lbCap.hidden = !cap;
  };

  // Turn each thumbnail into a button that opens the viewer.
  imgs.forEach((img, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gz';
    btn.setAttribute('aria-label', `View larger: ${img.alt}`);
    img.parentNode.insertBefore(btn, img);
    btn.appendChild(img);
    btn.addEventListener('click', () => { opener = btn; show(i); dlg.showModal(); });
  });

  dlg.querySelector('.lb-close').addEventListener('click', () => dlg.close());
  dlg.querySelector('.lb-prev').addEventListener('click', () => show(idx - 1));
  dlg.querySelector('.lb-next').addEventListener('click', () => show(idx + 1));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
  });
  // A click on the backdrop (outside the image and controls) closes.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  // Return focus to the thumbnail that opened the viewer.
  dlg.addEventListener('close', () => { if (opener) opener.focus(); });
}

// Click-to-load Vimeo. We render only a self-hosted poster until the visitor
// asks to watch; the real player iframe is injected on click. Because nothing
// hits player.vimeo.com on first paint, Vimeo's CDN never sets its Cloudflare
// __cf_bm cookie, which is what Lighthouse "Uses third-party cookies" flags
// (dnt=1 can't stop it — it's an edge cookie, not a Vimeo tracking cookie).
document.querySelectorAll('.video-facade').forEach((facade) => {
  facade.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.className = 'video-embed';
    // autoplay so the click that dismissed the poster also starts playback;
    // dnt=1 keeps Vimeo's own tracking off once the player does load.
    iframe.src = `https://player.vimeo.com/video/${facade.dataset.vimeo}?dnt=1&autoplay=1`;
    iframe.title = facade.dataset.title || 'Vimeo video';
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    iframe.setAttribute('allowfullscreen', '');
    facade.replaceWith(iframe);
    iframe.focus();
  });
});

// Print affordance (rental policies "Print / Save as PDF"). The site CSP is
// script-src 'self' with no unsafe-inline, so an inline onclick would be
// blocked — bind the handler here in the external bundle instead.
document.querySelectorAll('[data-print]').forEach((btn) => {
  btn.addEventListener('click', () => window.print());
});
