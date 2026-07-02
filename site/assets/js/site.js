// Forms on this site have no server backend yet: submitting composes a
// pre-filled email in the visitor's mail app. Each form declares
// data-mailto (recipient) and data-subject (subject prefix); field labels
// come from data-label on the controls.
document.querySelectorAll('form[data-mailto]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const fields = [...form.querySelectorAll('input, textarea')].filter((c) => c.name);
    const body = fields
      .map((c) => `${c.dataset.label || c.name}: ${c.value}`)
      .join('\n');
    const subjField = form.querySelector('[name="subject"]');
    const prefix = form.dataset.subject || 'Website inquiry';
    const subject = subjField && subjField.value ? `${prefix}: ${subjField.value}` : prefix;
    window.location.href =
      `mailto:${form.dataset.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
