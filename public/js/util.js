export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** N'autorise que http(s), mailto, tel, chemins relatifs et ancres : bloque javascript:, data:, etc. */
export const safeUrl = (u) => (typeof u === 'string' && /^(https?:|mailto:|tel:|\/|#)/i.test(u.trim()) ? u.trim() : '');

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crée un élément : h('div', {class:'x', onclick}, 'texte' | enfants...) */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 3500);
  setTimeout(() => t.remove(), 4000);
}

export function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', esc_); onClose?.(); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('b', {}, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Fermer' }, '✕')),
      h('div', { class: 'modal-body' }, body)));
  document.addEventListener('keydown', esc_);
  document.body.append(back);
  return { close, el: back };
}

export function ask(title, label, initial = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value: initial, placeholder: label, class: 'input' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const m = modal(title, h('form', { onsubmit: (e) => { e.preventDefault(); finish(input.value); } },
      input, h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Annuler'), h('button', { class: 'btn primary' }, 'OK'))),
    { onClose: () => finish(null) });
    input.focus(); input.select();
  });
}

export const confirmBox = (msg) => new Promise((resolve) => {
  let done = false;
  const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
  const m = modal('Confirmation', h('div', {}, h('p', {}, msg),
    h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => finish(false) }, 'Annuler'), h('button', { class: 'btn danger', onclick: () => finish(true) }, 'Confirmer'))),
  { onClose: () => finish(false) });
});

export const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`);
