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
