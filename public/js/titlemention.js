// Mentions « @ » dans les titres de pages et de lignes de base de données : @date, @page (même menu que dans le texte, en plus léger).
import { h } from './util.js';
import { atomLabel } from './richtext.js';
import { prettify, formatDate, pickDate, todayIso } from './dates.js';
import { iconNode, kindIcon } from './icons.js';

const txt = (c) => ({ type: 'text', text: { content: c, link: null }, plain_text: c, annotations: {}, href: null });
const mention = (m, plain) => ({ type: 'mention', mention: m, plain_text: plain, annotations: {}, href: null });

/** Remplit le titre (h1 éditable ou non) à partir d'un texte riche : texte brut + atomes de mention non éditables. */
export function titleToDom(el, rt) {
  el.replaceChildren(...rt.map((r) => {
    if (r.type !== 'mention') return document.createTextNode(r.plain_text ?? r.text?.content ?? '');
    const kind = r.mention?.type || 'x', a = document.createElement('span');
    a.className = `atom atom-${kind}`; a.contentEditable = 'false'; a.dataset.rt = JSON.stringify(r);
    a.textContent = kind === 'page' ? prettify(atomLabel(r)) : atomLabel(r);
    return a;
  }));
}

/** Relit le titre : tableau de texte riche (textes fusionnés, mentions conservées). */
export function domToRt(el) {
  const out = [];
  const push = (s) => { s = s.replace(/[\n​]/g, ' '); if (!s) return; const l = out[out.length - 1]; if (l?.type === 'text') { l.text.content += s; l.plain_text += s; } else out.push(txt(s)); };
  for (const n of el.childNodes) {
    if (n.nodeType === 3) push(n.textContent);
    else if (n.dataset?.rt) { try { out.push(JSON.parse(n.dataset.rt)); } catch { push(n.textContent); } }
    else if (n.nodeName !== 'BR') push(n.textContent);
  }
  return out;
}

/** Branche le menu « @ » sur un titre éditable. hooks : { searchPages(q), recentPages(), onChange() }. */
export function attachTitleMentions(el, hooks) {
  let menu = null, items = [], sel = 0, seq = 0, ctx = null; // ctx : { node, start, end }
  const close = () => { seq++; menu?.remove(); menu = null; items = []; ctx = null; };
  const caretCtx = () => {
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return null;
    const r = s.getRangeAt(0), n = r.startContainer; if (n.nodeType !== 3 || !el.contains(n)) return null;
    const m = /@([^\s@]*)$/.exec(n.textContent.slice(0, r.startOffset)); if (!m) return null;
    return { node: n, start: r.startOffset - m[0].length, end: r.startOffset, q: m[1] };
  };
  const insert = (rt) => {
    const c = ctx; close(); el.focus(); if (!c?.node.isConnected) return;
    const r = document.createRange(); r.setStart(c.node, c.start); r.setEnd(c.node, c.end); r.deleteContents();
    const tmp = document.createElement('div'); titleToDom(tmp, [rt]);
    const space = document.createTextNode(' '); r.insertNode(space); r.insertNode(tmp.firstChild);
    const nr = document.createRange(); nr.setStart(space, 1); nr.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(nr);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const draw = () => {
    if (!items.length) { menu?.remove(); menu = null; return; }
    const first = !menu; menu ||= h('div', { class: 'ctx-menu title-mention', role: 'listbox' }); // pas de focus volé : le curseur reste dans le titre
    menu.replaceChildren(...items.map((it, i) => h('button', { class: i === sel ? 'sel' : '', role: 'option', onmousedown: (e) => { e.preventDefault(); it.run(); } },
      it.icon ? (typeof it.icon === 'string' ? h('span', { class: 'mi-gap' }, it.icon) : it.icon) : null, h('span', { class: 'mi-label' }, it.label), it.sub ? h('span', { class: 'mi-hint' }, it.sub) : null)));
    if (first) document.body.append(menu);
    const rr = getSelection().rangeCount ? getSelection().getRangeAt(0).getBoundingClientRect() : el.getBoundingClientRect(), b = rr.height ? rr : el.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(b.left, innerWidth - menu.offsetWidth - 8))}px`; menu.style.top = `${Math.min(b.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
  };
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function open(c) {
    const my = ++seq, nq = norm(c.q); ctx = c;
    const dates = [['Aujourd’hui', 0], ['Demain', 1], ['Hier', -1]].filter(([l]) => !nq || norm(l).includes(nq) || 'date'.startsWith(nq))
      .map(([l, d]) => ({ icon: '📅', label: l, sub: formatDate(todayIso(d)), run: () => insert(mention({ type: 'date', date: { start: todayIso(d), end: null, time_zone: null } }, todayIso(d))) }));
    if (!nq || nq.startsWith('dat') || 'choisir une date calendrier'.includes(nq)) dates.push({ icon: '🗓', label: 'Choisir une date…', run: async () => {
      const c2 = ctx; seq++; menu?.remove(); menu = null;
      const d = await pickDate({}); ctx = c2; if (d && !d.remove) insert(mention({ type: 'date', date: d }, d.start)); else { ctx = null; el.focus(); }
    } });
    const rows = (list) => list.slice(0, 8).map((p) => ({ icon: iconNode(p.icon, 18, kindIcon(p.kind)), label: prettify(p.title) || 'Sans titre', sub: p.parent_title ? prettify(p.parent_title) : '', run: () => insert(mention({ type: 'page', page: { id: p.id } }, p.title || 'Sans titre')) }));
    const show = (pages, final) => { if (my !== seq) return; items = [...pages, ...dates]; sel = Math.min(sel, Math.max(0, items.length - 1)); if (!items.length && !final) return; draw(); };
    show(rows(nq ? [] : (hooks.recentPages?.() || [])), !nq);
    if (nq) { try { show(rows(await hooks.searchPages(c.q)), true); } catch { show([], true); } }
  }
  el.addEventListener('input', () => { const c = caretCtx(); if (c) { sel = 0; open(c); } else close(); });
  el.addEventListener('keydown', (e) => {
    if (!menu) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); items[sel]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  el.addEventListener('blur', () => setTimeout(() => { if (menu && document.activeElement !== el) close(); }, 150));
}
