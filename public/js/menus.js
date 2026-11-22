/** Menu contextuel (clic droit) et sélecteur « Déplacer vers… » partagés par la barre latérale, les pages et les blocs. */
import { h, toast, modal } from './util.js';
import { vi, iconNode, kindIcon } from './icons.js';

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Affiche un menu à la position (x, y) de l'écran.
 * items : { label, icon (nom d'icône), fn, danger, disabled, hint } | { header } | 'sep'.
 * Se ferme au clic ailleurs, à Échap, au défilement ou au redimensionnement.
 */
export function popMenu(x, y, items) {
  document.querySelectorAll('.ctx-menu.pop').forEach((m) => m.remove());
  const m = h('div', { class: 'ctx-menu pop', role: 'menu', oncontextmenu: (e) => e.preventDefault() });
  let closed = false;
  const close = () => { if (closed) return; closed = true; m.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', close); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  const outside = (e) => { if (!m.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  for (const it of items.filter(Boolean)) {
    if (it === 'sep') m.append(h('div', { class: 'bm-sep' }));
    else if (it.header) m.append(h('div', { class: 'bm-title' }, it.header));
    else m.append(h('button', { class: it.danger ? 'danger' : '', disabled: it.disabled, role: 'menuitem',
      onclick: () => { close(); Promise.resolve().then(it.fn).catch((e) => toast(e.message, 'error')); } },
    it.icon ? vi(it.icon, 16) : h('span', { class: 'mi-gap' }), h('span', { class: 'mi-label' }, it.label), it.hint ? h('span', { class: 'mi-hint' }, it.hint) : null));
  }
  document.body.append(m);
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8))}px`;
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); window.addEventListener('blur', close); window.addEventListener('resize', close); document.addEventListener('scroll', close, true); }, 0);
  m.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  return { close };
}

/**
 * Fermeture automatique d'un menu flottant (hors popMenu, qui a la sienne) : clic ailleurs, Échap, défilement de la page ou changement de page.
 * Les clics à l'intérieur du menu le laissent ouvert (cases à cocher). Se désinscrit tout seul dès que le menu a disparu.
 */
export function autoClose(el) {
  const off = () => { document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('scroll', onScroll, true); window.removeEventListener('hashchange', close); };
  const close = () => { el.remove(); off(); };
  const outside = (e) => { if (!el.isConnected) return off(); if (!el.contains(e.target)) close(); };
  const onKey = (e) => { if (!el.isConnected) return off(); if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const onScroll = (e) => { if (!el.isConnected) return off(); if (!el.contains(e.target)) close(); };
  setTimeout(() => { if (!el.isConnected) return; document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); document.addEventListener('scroll', onScroll, true); window.addEventListener('hashchange', close); }, 0);
}
// Un changement de page ferme tout menu ou sélecteur d'options resté ouvert.
window.addEventListener('hashchange', () => document.querySelectorAll('.ctx-menu, .opt-pop').forEach((m) => m.remove()));

/**
 * Sélecteur de destination (comme « Déplacer vers… » de Notion). Résout l'id choisi, '' pour la racine, ou null si annulé.
 *  pages : [{id,parent_id,title,icon,kind,archived}] ; exclude : ids interdits (l'élément et ses descendants) ;
 *  allow(p) : la page peut-elle être une destination ? ; rootLabel : texte de l'entrée « racine » (null = pas de racine possible).
 */
export function movePicker({ title = 'Déplacer vers…', pages, exclude = new Set(), allow = () => true, rootLabel = 'Racine (en haut de la barre latérale)', currentParent = null, subject = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const byId = new Map(pages.map((p) => [p.id, p]));
    const usable = pages.filter((p) => !p.archived && !exclude.has(p.id) && byId.get(p.parent_id)?.kind !== 'database');
    const kids = new Map();
    for (const p of usable) { const key = byId.has(p.parent_id) && !exclude.has(p.parent_id) ? p.parent_id : null; if (!kids.has(key)) kids.set(key, []); kids.get(key).push(p); }
    const open = new Set(), search = h('input', { class: 'input', placeholder: 'Rechercher une page ou un dossier…', autofocus: true }), list = h('div', { class: 'mv-list' });
    const pathOf = (p) => { const parts = []; let c = byId.get(p.parent_id), g = 0; while (c && g++ < 20) { parts.unshift(c.title || 'Sans titre'); c = byId.get(c.parent_id); } return parts.join(' / '); };
    const row = (p, depth, withPath) => {
      const sub = kids.get(p.id) || [], here = p.id === currentParent, ok = allow(p) && !here;
      return h('div', { class: 'mv-item', style: `padding-left:${6 + depth * 18}px` },
        withPath ? h('span', { class: 'mv-caret' }) : h('button', { class: `mv-caret ${open.has(p.id) ? 'open' : ''} ${sub.length ? '' : 'inv'}`, 'aria-label': 'Déplier', onclick: () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); draw(); } }, vi('chevron-right', 14)),
        h('button', { class: 'mv-row', disabled: !ok, onclick: () => finish(p.id) }, iconNode(p.icon, 18, kindIcon(p.kind)), h('span', { class: 'mv-name' }, p.title || 'Sans titre'),
          withPath && pathOf(p) ? h('span', { class: 'mv-path' }, pathOf(p)) : null, here ? h('span', { class: 'mv-path' }, 'emplacement actuel') : null));
    };
    function draw() {
      const q = fold(search.value.trim());
      const nodes = [];
      if (q) { const found = usable.filter((p) => fold(p.title).includes(q) && allow(p)).slice(0, 80); nodes.push(...(found.length ? found.map((p) => row(p, 0, true)) : [h('div', { class: 'muted pad' }, 'Aucun résultat')])); }
      else {
        if (rootLabel) nodes.push(h('div', { class: 'mv-item' }, h('span', { class: 'mv-caret' }), h('button', { class: 'mv-row', disabled: currentParent === null, onclick: () => finish('') }, vi('layout-grid', 18), h('span', { class: 'mv-name' }, rootLabel), currentParent === null ? h('span', { class: 'mv-path' }, 'emplacement actuel') : null)));
        const walk = (list, depth) => { for (const p of list) { nodes.push(row(p, depth, false)); if (open.has(p.id)) walk(kids.get(p.id) || [], depth + 1); } };
        walk(kids.get(null) || [], 0);
      }
      list.replaceChildren(...nodes);
    }
    search.addEventListener('input', draw);
    const m = modal(title, h('div', { class: 'mv' }, subject ? h('div', { class: 'muted small mv-subject' }, `« ${subject} »`) : null, search, list), { onClose: () => finish(null) });
    draw(); search.focus();
  });
}
