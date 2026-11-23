import { h, $, toast, modal, ask, confirmBox, debounce, esc, fmtDate, fmtSize, safeUrl, uuid } from './util.js';
import { api } from './api.js';
import { createEditor } from './editor.js';
import { propEditor, titleKey, typeIcon } from './database.js';
import { renderDatabase } from './dbviews.js';
import { openComments, openThreadsByBlock, openThreadCount } from './comments.js';
import { rtPlain, plainRt } from './richtext.js';
import { titleToDom, domToRt, attachTitleMentions } from './titlemention.js';
import { prettify, formatDate, getPrefs, setPrefs, deviceTz, allTimezones, todayIso } from './dates.js';
import { iconNode, vi, pickIcon, kindIcon, makeIcon, parseIcon, ICON_COLORS } from './icons.js';
import { popMenu, movePicker, autoClose } from './menus.js';
import './math.js';
import { loadingText, o5Page, redactedLine, redBar } from './clins.js';
import { valueFor, parseBlocksText, blocksFromItems } from './buttons.js';

const S = { settings: {}, me: null, tree: { pages: [], shared: [], sharedRoots: [] }, current: null, editor: null, token: null, dirty: false, saving: null, sel: new Set(), anchor: null };
const root = $('#app');
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ================= apparence / personnalisation =================
function applySettings(s) {
  S.settings = { ...S.settings, ...s };
  const st = document.documentElement.style;
  const set = (k, v) => (v ? st.setProperty(k, v) : st.removeProperty(k));
  set('--accent', /^#[0-9a-f]{3,8}$/i.test(s.accent || '') ? s.accent : '');
  set('--font', { system: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', serif: 'var(--font-serif)', mono: 'var(--font-mono)' }[s.font] || (s.font && !/[;{}]/.test(s.font) ? s.font : ''));
  set('--divider-color', /^#[0-9a-f]{3,8}$/i.test(s.divider_color || '') ? s.divider_color : '');
  const ts = store.get('dw_text_size', null) || s.text_size; set('--text-size', /^\d{2}$/.test(String(ts || '')) ? `${ts}px` : '');
  set('--radius', /^\d+$/.test(s.radius || '') ? `${s.radius}px` : '');
  set('--content-width', /^\d+$/.test(s.content_width || '') ? `${s.content_width}px` : '');
  $('#custom-css').textContent = s.custom_css || '';
  document.title = s.site_name || 'Deepwell';
  if ('favicon' in s) { siteFavicon = s.favicon || ''; refreshFavicon(); }
  applyTheme();
}
const DEFAULT_FAVICON = document.querySelector('link[rel=icon]')?.getAttribute('href') || '';
/** Convertit une icône (emoji, vectorielle ou image) en URL utilisable comme favicon. */
async function faviconHref(icon) {
  const p = parseIcon(icon);
  if (!p) return null;
  const wrap = (inner) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${inner}</svg>`)}`;
  if (p.kind === 'image') return p.url;
  if (p.kind === 'emoji') return wrap(`<text x="16" y="25" font-size="25" text-anchor="middle">${esc(p.text)}</text>`);
  const svg = await fetch(`/icons/${encodeURIComponent(p.name)}.svg`).then((r) => r.text());
  const inner = (svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/) || [])[1] || '';
  const color = ICON_COLORS[p.color] || (/^#[0-9a-f]{3,8}$/i.test(p.color || '') ? p.color : '#2383e2');
  return wrap(`<rect width="32" height="32" rx="7" fill="${color}"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`);
}
let siteFavicon = '', shownFavicon = null;
/** Icône de l'onglet : celle de la page ouverte ; sans icône (ou hors d'une page), celle du site ; à défaut, l'icône de base. */
function refreshFavicon() {
  const icon = (S.current?.icon && parseIcon(S.current.icon) ? S.current.icon : '') || siteFavicon;
  if (icon === shownFavicon) return;
  shownFavicon = icon; setFavicon(icon);
}
function setFavicon(icon) {
  faviconHref(icon).catch(() => null).then((href) => {
    let l = document.querySelector('link[rel=icon]');
    if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.append(l); }
    if (icon === shownFavicon) l.setAttribute('href', href || DEFAULT_FAVICON); // on ignore une réponse arrivée après un changement de page
  });
}
function applyTheme() {
  const pref = store.get('dw_theme', S.settings.default_theme || 'auto');
  document.documentElement.dataset.theme = pref === 'auto' ? '' : pref;
}

// ================= démarrage =================
async function boot() {
  try { applySettings(await api.get('/api/settings')); } catch {}
  const me = await api.get('/api/auth/me');
  if (location.hash.startsWith('#/public/')) { S.me = me.user; return startShell(true); }
  if (!me.user) return renderAuth(me);
  S.me = me.user;
  startShell(false);
}

function renderAuth(me) {
  let mode = me.needsSetup ? 'register' : 'login';
  const draw = () => {
    const err = h('div', { class: 'form-err' });
    const email = h('input', { class: 'input', type: 'email', placeholder: 'E-mail', required: true, autocomplete: 'username' });
    const name = h('input', { class: 'input', placeholder: 'Nom (facultatif)', autocomplete: 'name' });
    const pw = h('input', { class: 'input', type: 'password', placeholder: 'Mot de passe (8 caractères min.)', required: true, autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
    const remember = h('input', { type: 'checkbox', checked: store.get('dw_remember', true) ? true : null, onchange: (e) => store.set('dw_remember', e.target.checked) });
    const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const r = await api.post(`/api/auth/${mode}`, { email: email.value, password: pw.value, name: name.value, remember: remember.checked });
        S.me = r.user; startShell(false);
      } catch (x) { err.textContent = x.message; }
    } },
      h('div', { class: 'logo' }, S.settings.site_name || 'Deepwell'),
      h('h2', {}, mode === 'login' ? 'Connexion' : me.needsSetup ? 'Créer le compte administrateur' : 'Créer un compte'),
      mode === 'register' ? name : null, email, pw, mode === 'login' ? h('label', { class: 'check small' }, remember, 'Rester connecté 90 jours sur cet appareil') : null, err,
      h('button', { class: 'btn primary wide' }, mode === 'login' ? 'Se connecter' : 'Créer le compte'),
      me.allowSignup && !me.needsSetup ? h('a', { href: '#', class: 'muted', onclick: (ev) => { ev.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); } }, mode === 'login' ? 'Pas de compte ? S’inscrire' : 'Déjà un compte ? Se connecter') : null);
    root.replaceChildren(h('div', { class: 'auth' }, form));
    email.focus();
  };
  draw();
}

// ================= coquille =================
let sidebarEl, mainEl;
const isNarrow = () => window.matchMedia('(max-width: 800px)').matches || document.body.classList.contains('phone');
// Mode téléphone : « auto » (écran étroit, ou écran tactile de taille moyenne), « on » (forcé) ou « off ». Réglage propre à l'appareil.
export function applyPhoneMode() {
  const pref = store.get('dw_phone', 'auto');
  const on = pref === 'on' || (pref === 'auto' && (matchMedia('(max-width: 760px)').matches || (matchMedia('(pointer: coarse)').matches && innerWidth < 1000)));
  document.body.classList.toggle('phone', on);
  document.documentElement.classList.toggle('phone', on);
}
window.addEventListener('resize', applyPhoneMode); applyPhoneMode();
/** Panneau latéral : masqué/affiché (mémorisé sur l'appareil) ; sur petit écran il s'ouvre en tiroir. */
function applySidebarState() { document.querySelector('.shell')?.classList.toggle('sb-hidden', !isNarrow() && store.get('dw_sb_hidden', false)); }
function toggleSidebar() {
  if (isNarrow()) document.body.classList.toggle('sidebar-open');
  else { store.set('dw_sb_hidden', !store.get('dw_sb_hidden', false)); applySidebarState(); }
}
async function startShell(publicOnly) {
  root.replaceChildren();
  const peek = new URLSearchParams(location.search).has('peek'); // chargé dans l'aperçu latéral d'une base
  document.body.classList.toggle('is-peek', peek); // pas « peek » : cette classe est celle du panneau latéral et déformait le body
  window.__dwFlush = () => flushSave();
  window.addEventListener('dw-refresh-page', () => { if (S.current && !S.dirty) showPage(S.current.id); });
  const showSidebar = !publicOnly && S.me && !peek;
  sidebarEl = h('aside', { class: 'sidebar' });
  mainEl = h('main', { class: 'main' });
  root.append(h('div', { class: `shell ${showSidebar ? '' : 'no-sidebar'}` }, showSidebar ? sidebarEl : null, mainEl));
  applySidebarState();
  window.matchMedia('(max-width: 800px)').addEventListener?.('change', applySidebarState);
  if (showSidebar) await refreshTree(); // l'arbre doit être chargé avant le routage (page d'accueil, liens/mentions)
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && S.me) { e.preventDefault(); openSearch(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '\\' && S.me) { e.preventDefault(); toggleSidebar(); }
    if (e.key === 'Escape' && S.sel.size && !document.querySelector('.modal, .ctx-menu')) { S.sel.clear(); drawSidebar(); }
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/#/page/"]');
    if (a && S.token) { e.preventDefault(); location.hash = `#/public/${S.token}/${a.getAttribute('href').split('/').pop()}`; }
  });
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { flushSave(true); e.preventDefault(); } });
  route();
}

async function route() {
  await flushSave();
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  S.token = null;
  document.body.classList.remove('sidebar-open');
  if (S.guest && !(parts[0] === 'page' && parts[1] === S.guest)) S.guest = null; // l'aperçu invité ne suit pas quand on change de page
  document.body.classList.toggle('guest-preview', !!S.guest);
  if (parts[0] === 'public') {
    S.token = parts[1];
    try {
      const id = parts[2] || (await api.get(`/api/pages/public/${parts[1]}`)).page_id;
      return showPage(id);
    } catch (e) { return mainEl.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Lien indisponible'), h('p', {}, e.message), redactedLine())); }
  }
  if (!S.me) return renderAuth(await api.get('/api/auth/me'));
  if (parts[0] === 'page' && parts[1]) return showPage(parts[1]);
  if (parts[0] === 'settings') return showSettings(parts[1] || 'profile');
  if (parts[0] === 'trash') return showTrash();
  if (parts[0] === 'releases') return showReleases();
  if (parts[0] === 'redacted') { S.current = null; drawSidebar(); return mainEl.replaceChildren(topbar([{ title: 'REDACTED' }]), o5Page()); }
  const first = S.tree.pages.find((p) => !p.parent_id && !p.archived);
  if (first) { location.hash = `#/page/${first.id}`; return; }
  showEmpty();
}

function showEmpty() {
  mainEl.replaceChildren(topbar([]), h('div', { class: 'empty' },
    h('h2', {}, 'Bienvenue 👋'), h('p', {}, 'Votre espace est vide. Créez une première page ou importez votre contenu Notion.'),
    h('div', { class: 'row-center' }, h('button', { class: 'btn primary', onclick: () => newPage(null) }, '＋ Nouvelle page'),
      h('button', { class: 'btn', onclick: () => (location.hash = '#/settings/import') }, 'Importer depuis Notion'))));
}

function topbar(crumbs, right = []) {
  return h('div', { class: 'topbar' },
    h('button', { class: 'icon-btn sb-toggle', onclick: toggleSidebar, title: 'Afficher le panneau latéral (Ctrl+\\)', 'aria-label': 'Afficher le panneau latéral' }, vi('panel-left-open', 18)),
    h('div', { class: 'crumbs' }, crumbs.flatMap((c, i) => [i ? h('span', { class: 'sep' }, '/') : null,
      c.id ? h('a', { href: S.token ? `#/public/${S.token}/${c.id}` : `#/page/${c.id}` }, iconNode(c.icon, 16, kindIcon(c.kind)), prettify(c.title) || 'Sans titre') : h('span', {}, c.title)])),
    h('div', { class: 'top-right' }, right));
}

// ================= barre latérale =================
async function refreshTree() {
  try { S.tree = await api.get('/api/pages/tree'); } catch (e) { if (e.status === 401) return location.reload(); }
  S.pageMap = new Map([...S.tree.pages, ...S.tree.shared].map((p) => [p.id, p]));
  try { S.favs = await api.get('/api/pages/favorites'); } catch { S.favs = S.favs || []; }
  drawSidebar();
}
/** Infos d'une page pour les liens/mentions : objet, null (cible inconnue) ou undefined (arbre non chargé : on ne juge pas). */
const pageInfo = (id) => (S.pageMap ? S.pageMap.get(id) || null : undefined);
const recordVisit = (id) => store.set('dw_recent', [id, ...store.get('dw_recent', []).filter((x) => x !== id)].slice(0, 12));
const recentPages = () => store.get('dw_recent', []).map((id) => S.pageMap?.get(id)).filter((p) => p && !p.archived).map((p) => ({ ...p, parent_title: S.pageMap.get(p.parent_id)?.title || '' }));
let usersCache;
const loadUsers = () => (usersCache ||= api.get('/api/users').catch(() => []));
function buildKids(pages) {
  const byId = new Map(pages.map((p) => [p.id, p])), kids = new Map();
  for (const p of pages) {
    if (p.archived) continue;
    const par = byId.get(p.parent_id);
    if (par?.kind === 'database') continue; // lignes de base : visibles dans le tableau
    const key = par ? p.parent_id : null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(p);
  }
  return kids;
}
const favBottom = () => !!store.get('dw_fav_bottom', false); // section Favoris en haut (défaut) ou en bas du panneau
const isFav = (id) => (S.favs || []).includes(id);
async function toggleFav(p) {
  try { S.favs = isFav(p.id) ? await api.del('/api/pages/favorites/' + p.id) : await api.post('/api/pages/favorites', { page_id: p.id }); } catch (e) { return toast(e.message, 'error'); }
  drawSidebar(); const b = document.querySelector('.fav-top'); if (b && S.current?.id === p.id) b.classList.toggle('on', isFav(p.id));
  toast(isFav(p.id) ? 'Ajoutée aux favoris' : 'Retirée des favoris');
}
/** Section « Favoris » : pages et sous-pages épinglées, réordonnables par glisser-déposer. */
function favSection() {
  const items = (S.favs || []).map((id) => S.pageMap?.get(id)).filter((p) => p && !p.archived);
  if (!items.length) return null;
  let dragId = null;
  const reorder = async (fromId, toId, after) => {
    const ids = (S.favs || []).filter((x) => x !== fromId), at = ids.indexOf(toId);
    ids.splice(at < 0 ? ids.length : at + (after ? 1 : 0), 0, fromId);
    S.favs = ids; drawSidebar();
    try { S.favs = await api.put('/api/pages/favorites/order', { ids }); drawSidebar(); } catch (e) { toast(e.message, 'error'); }
  };
  const row = (p) => {
    const r = h('div', { class: `si fav ${S.current?.id === p.id ? 'active' : ''}`, 'data-id': p.id, draggable: 'true', style: 'padding-left:8px',
      ondragstart: (e) => { dragId = p.id; e.dataTransfer.setData('text/dw-fav', p.id); e.dataTransfer.effectAllowed = 'move'; r.classList.add('dragging'); },
      ondragend: () => { dragId = null; r.classList.remove('dragging'); document.querySelectorAll('.si.fav').forEach((x) => x.classList.remove('drop-above', 'drop-below')); },
      ondragover: (e) => { if (!dragId || dragId === p.id) return; e.preventDefault(); e.stopPropagation(); const b = r.getBoundingClientRect(), below = e.clientY > b.top + b.height / 2; r.classList.toggle('drop-below', below); r.classList.toggle('drop-above', !below); },
      ondragleave: () => r.classList.remove('drop-above', 'drop-below'),
      ondrop: (e) => { if (!dragId || dragId === p.id) return; e.preventDefault(); e.stopPropagation(); const below = r.classList.contains('drop-below'); r.classList.remove('drop-above', 'drop-below'); reorder(dragId, p.id, below); },
      oncontextmenu: (e) => { e.preventDefault(); pageContextMenu(e.clientX, e.clientY, p); } },
      h('a', { href: `#/page/${p.id}`, class: 'si-title' }, h('span', { class: 'si-icon' }, iconNode(p.icon, 18, kindIcon(p.kind))), h('span', { class: 'si-name' }, prettify(p.title) || 'Sans titre'), (S.lockInfo?.open && S.lockInfo.pageId === p.id) ? h('span', { class: 'si-lock', title: 'Déverrouillée' }, vi('lock-open', 12)) : p.locked ? h('span', { class: 'si-lock', title: 'REDACTED' }, vi('lock', 12)) : null),
      h('button', { class: 'si-add si-unfav', title: 'Retirer des favoris', 'aria-label': 'Retirer des favoris', onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggleFav(p); } }, vi('star', 14)));
    return r;
  };
  const where = favBottom();
  return [h('div', { class: 'sb-section sb-section-row' }, h('span', {}, 'Favoris'),
    h('button', { class: 'icon-btn sb-plus', style: 'opacity:1', title: where ? 'Placer la section Favoris en haut du panneau' : 'Placer la section Favoris en bas du panneau', 'aria-label': 'Déplacer la section Favoris', onclick: () => { store.set('dw_fav_bottom', !where); const o = sbSections().filter((k) => k !== 'fav'); o.splice(where ? o.indexOf('actions') + 1 : o.length, 0, 'fav'); store.set('dw_sb_order', o); drawSidebar(); } }, vi(where ? 'arrow-up' : 'arrow-down', 14))),
    h('div', { class: 'sb-favs' }, items.map(row))];
}
/** Ordre du panneau latéral : sections (Favoris, Pages, Partagé…) et boutons d'action, réordonnables par glisser-déposer (mémorisé sur cet appareil). */
const SB_KEYS = ['actions', 'fav', 'pages', 'shared'], SB_ACTION_KEYS = ['search', 'page', 'folder', 'db'];
function sbOrderOf(name, all, fallback) {
  const saved = store.get(name, null), base = (Array.isArray(saved) ? saved : fallback).filter((k) => all.includes(k));
  all.forEach((k) => { if (!base.includes(k)) base.push(k); });
  return base;
}
const sbSections = () => sbOrderOf('dw_sb_order', SB_KEYS, favBottom() ? ['actions', 'pages', 'shared', 'fav'] : SB_KEYS);
function sbMove(name, order, from, to, after) {
  if (from === to) return;
  const o = order.filter((k) => k !== from), at = o.indexOf(to);
  o.splice(at < 0 ? o.length : at + (after ? 1 : 0), 0, from);
  store.set(name === 'actions' ? 'dw_sb_actions' : 'dw_sb_order', o); drawSidebar();
}
/** Rend un élément déplaçable (poignée = l'élément lui-même) et déposable parmi ses frères de même nom d'ordre. */
function sbDraggable(el, name, key, order, headerOnly = false) {
  el.draggable = true; el.dataset.sbkey = key;
  let fromHeader = !headerOnly;
  if (headerOnly) el.addEventListener('mousedown', (e) => { fromHeader = !!e.target.closest('.sb-section'); });
  el.addEventListener('dragstart', (e) => {
    if (e.target !== el || !fromHeader) { if (e.target === el) e.preventDefault(); return; } // glisser une page de l'arbre ne déplace pas la section
    e.stopPropagation(); e.dataTransfer.setData('text/dw-sb-' + name, key); e.dataTransfer.effectAllowed = 'move'; el.classList.add('sb-dragging');
  });
  el.addEventListener('dragend', () => { el.classList.remove('sb-dragging'); document.querySelectorAll('.sb-over-top,.sb-over-bottom').forEach((x) => x.classList.remove('sb-over-top', 'sb-over-bottom')); });
  el.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('text/dw-sb-' + name)) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    el.classList.toggle('sb-over-top', !after); el.classList.toggle('sb-over-bottom', after);
  });
  el.addEventListener('dragleave', () => el.classList.remove('sb-over-top', 'sb-over-bottom'));
  el.addEventListener('drop', (e) => {
    const from = e.dataTransfer.getData('text/dw-sb-' + name); if (!from) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect(); sbMove(name, order, from, key, e.clientY > r.top + r.height / 2);
  });
  return el;
}
function drawSidebar() {
  refreshFavicon();
  if (!S.me) return;
  { const known = new Set([...S.tree.pages, ...S.tree.shared].map((p) => p.id)); for (const id of S.sel) if (!known.has(id)) S.sel.delete(id); }
  const open = new Set(store.get('dw_open', []));
  const toggle = (id) => { open.has(id) ? open.delete(id) : open.add(id); store.set('dw_open', [...open]); drawSidebar(); };
  const mine = buildKids(S.tree.pages), shared = buildKids(S.tree.shared);
  const node = (p, kids, depth) => {
    const sub = kids.get(p.id) || [], isOpen = open.has(p.id);
    const row = h('div', { class: `si ${S.current?.id === p.id ? 'active' : ''} ${S.sel.has(p.id) ? 'selected' : ''}`, 'data-id': p.id, style: `padding-left:${8 + depth * 14}px`, draggable: 'true',
      onclick: (e) => rowClick(e, p),
      oncontextmenu: (e) => { e.preventDefault(); if (S.sel.size > 1 && S.sel.has(p.id)) bulkMenu(e.clientX, e.clientY); else pageContextMenu(e.clientX, e.clientY, p); },
      ondragstart: (e) => { e.dataTransfer.setData('text/dw-page', p.id); }, ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/dw-page')) { e.preventDefault(); row.classList.add('drop'); } },
      ondragleave: () => row.classList.remove('drop'),
      ondrop: async (e) => { row.classList.remove('drop'); const id = e.dataTransfer.getData('text/dw-page'); if (!id || id === p.id) return; e.preventDefault(); e.stopPropagation(); try { await api.patch(`/api/pages/${id}`, { parent_id: p.id }); open.add(p.id); store.set('dw_open', [...open]); await refreshTree(); } catch (x) { toast(x.message, 'error'); } } },
      h('button', { class: `caret ${isOpen ? 'open' : ''} ${sub.length ? '' : 'inv'}`, 'aria-label': 'Déplier', onclick: (e) => { e.preventDefault(); toggle(p.id); } }, vi('chevron-right', 14)),
      h('a', { href: `#/page/${p.id}`, class: 'si-title' }, h('span', { class: 'si-icon' }, iconNode(p.icon, 18, kindIcon(p.kind))), h('span', { class: 'si-name' }, prettify(p.title) || 'Sans titre'), p.locked ? h('span', { class: 'si-lock', title: 'Page verrouillée par un code' }, vi('lock', 13)) : null),
      p.kind === 'database' ? null : h('button', { class: 'si-add', title: 'Ajouter dedans…', 'aria-label': 'Ajouter dedans', onclick: (e) => {
        e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect();
        popMenu(r.left, r.bottom + 4, [{ label: 'Nouvelle page', icon: 'file-plus', fn: () => { open.add(p.id); store.set('dw_open', [...open]); return newPage(p.id); } },
          { label: 'Nouveau dossier', icon: 'folder-plus', fn: () => { open.add(p.id); store.set('dw_open', [...open]); return newPage(p.id, 'folder'); } }]);
      } }, vi('plus', 14)));
    return h('div', {}, row, isOpen && sub.length ? sub.map((c) => node(c, kids, depth + 1)) : null);
  };
  const roots = mine.get(null) || [];
  const sharedRoots = S.tree.shared.filter((p) => S.tree.sharedRoots.includes(p.id) && !p.archived);
  sidebarEl.replaceChildren(...[
    h('div', { class: 'sb-head' }, S.settings.favicon ? h('span', { class: 'sb-avatar sb-logo' }, iconNode(S.settings.favicon, 22)) : h('span', { class: 'sb-avatar' }, (S.settings.site_name || 'D')[0].toUpperCase()),
      h('div', { class: 'who' }, h('a', { href: '#/', class: 'logo' }, S.settings.site_name || 'Deepwell'), h('span', { class: 'muted small' }, S.me.name || S.me.email)),
      h('button', { class: 'icon-btn sb-toggle', onclick: toggleSidebar, title: 'Masquer le panneau latéral (Ctrl+\\)', 'aria-label': 'Masquer le panneau latéral' }, vi('panel-left-close', 18))),
    ...(() => {
      const actionBtn = {
        search: () => h('button', { class: 'si-btn', title: 'Glisser pour réordonner', onclick: openSearch }, vi('search', 16), h('span', {}, 'Rechercher'), h('kbd', {}, 'Ctrl K')),
        page: () => h('button', { class: 'si-btn', title: 'Glisser pour réordonner', onclick: () => newPage(null) }, vi('square-pen', 16), 'Nouvelle page'),
        folder: () => h('button', { class: 'si-btn', title: 'Glisser pour réordonner', onclick: () => newPage(null, 'folder') }, vi('folder-plus', 16), 'Nouveau dossier'),
        db: () => h('button', { class: 'si-btn', title: 'Glisser pour réordonner', onclick: () => newPage(null, 'database') }, vi('database', 16), 'Nouvelle base de données'),
      };
      const aOrder = sbOrderOf('dw_sb_actions', SB_ACTION_KEYS, SB_ACTION_KEYS);
      const groups = {
        actions: [h('div', { class: 'sb-actions' }, aOrder.map((k) => sbDraggable(actionBtn[k](), 'actions', k, aOrder)))],
        fav: favSection(),
        pages: [h('div', { class: 'sb-section sb-section-row' }, h('span', {}, 'Pages'),
          h('button', { class: 'icon-btn sb-plus', title: 'Ajouter…', 'aria-label': 'Ajouter une page, un dossier ou une base', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); popMenu(r.left, r.bottom + 4, newMenuItems(null)); } }, vi('plus', 15))),
          S.sel.size ? selBar() : null,
          h('div', { class: 'sb-tree', oncontextmenu: (e) => { if (e.target.closest('.si')) return; e.preventDefault(); popMenu(e.clientX, e.clientY, newMenuItems(null)); }, ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/dw-page')) e.preventDefault(); },
            ondrop: async (e) => { const id = e.dataTransfer.getData('text/dw-page'); if (!id) return; try { await api.patch(`/api/pages/${id}`, { parent_id: null }); await refreshTree(); } catch (x) { toast(x.message, 'error'); } } },
            roots.length ? roots.map((p) => node(p, mine, 0)) : h('div', { class: 'muted pad' }, 'Aucune page'))],
        shared: sharedRoots.length ? [h('div', { class: 'sb-section' }, 'Partagé avec moi'), sharedRoots.map((p) => node(p, shared, 0))] : null,
      };
      const sOrder = sbSections();
      return sOrder.map((k) => { const nodes = groups[k] && [groups[k]].flat(2).filter(Boolean); if (!nodes?.length) return null; const g = h('div', { class: 'sb-group' }, nodes); return sbDraggable(g, 'sections', k, sOrder, true); });
    })(),
    h('div', { class: 'sb-foot' },
      h('a', { href: '#/trash', class: 'si-btn ico', title: 'Corbeille', 'aria-label': 'Corbeille' }, vi('trash-2', 15)),
      h('a', { href: '#/settings', class: 'si-btn ico', title: 'Réglages', 'aria-label': 'Réglages' }, vi('settings', 15)),
      h('button', { class: 'si-btn ico', title: 'Se déconnecter', 'aria-label': 'Se déconnecter', onclick: async () => { await api.post('/api/auth/logout'); S.me = null; location.hash = ''; location.reload(); } }, vi('log-out', 15)),
      S.settings.version ? h('a', { href: '#/releases', class: 'sb-version', title: releasesUnseen() ? 'Nouveautés : voir les notes de version' : 'Notes de version' }, 'alpha ' + S.settings.version, releasesUnseen() ? h('span', { class: 'sb-dot', 'aria-label': 'Nouvelle version' }) : null) : null),
  ].flat().filter(Boolean));
}
// ---- sélection multiple de pages (Ctrl/⌘ + clic, Maj + clic pour une plage) ----
function rowClick(e, p) {
  if (e.target.closest('button')) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault(); e.stopPropagation();
    if (S.sel.has(p.id)) S.sel.delete(p.id); else S.sel.add(p.id);
    S.anchor = p.id; drawSidebar(); return;
  }
  if (e.shiftKey && S.anchor && S.anchor !== p.id) {
    e.preventDefault(); e.stopPropagation();
    const ids = [...sidebarEl.querySelectorAll('.si[data-id]')].map((r) => r.dataset.id), a = ids.indexOf(S.anchor), b = ids.indexOf(p.id);
    if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((i) => S.sel.add(i));
    drawSidebar(); return;
  }
  S.anchor = p.id;
  if (S.sel.size) { S.sel.clear(); setTimeout(drawSidebar, 0); } // après la navigation du lien
}
const selPages = () => [...S.sel].map((id) => S.tree.pages.find((p) => p.id === id) || S.tree.shared.find((p) => p.id === id)).filter(Boolean);
const clearSel = () => { S.sel.clear(); drawSidebar(); };
function selBar() {
  const n = S.sel.size;
  return h('div', { class: 'sb-selbar' }, h('span', { class: 'sb-seln' }, `${n} sélectionnée${n > 1 ? 's' : ''}`),
    h('button', { class: 'icon-btn', title: 'Changer l’icône', 'aria-label': 'Changer l’icône des pages sélectionnées', onclick: () => bulkIcon().catch((e) => toast(e.message, 'error')) }, vi('smile-plus', 16)),
    h('button', { class: 'icon-btn', title: 'Déplacer vers…', 'aria-label': 'Déplacer les pages sélectionnées', onclick: () => bulkMove().catch((e) => toast(e.message, 'error')) }, vi('arrow-right', 16)),
    h('button', { class: 'icon-btn', title: 'Mettre à la corbeille', 'aria-label': 'Mettre les pages sélectionnées à la corbeille', onclick: () => bulkTrash().catch((e) => toast(e.message, 'error')) }, vi('trash-2', 16)),
    h('button', { class: 'icon-btn', title: 'Désélectionner (Échap)', 'aria-label': 'Désélectionner', onclick: clearSel }, vi('x', 16)));
}
function bulkMenu(x, y) {
  const n = S.sel.size;
  popMenu(x, y, [{ header: `${n} pages sélectionnées` },
    { label: `Changer l’icône (${n})`, icon: 'smile-plus', fn: bulkIcon }, { label: `Déplacer vers… (${n})`, icon: 'arrow-right', fn: bulkMove },
    'sep', { label: `Mettre à la corbeille (${n})`, icon: 'trash-2', danger: true, fn: bulkTrash }, 'sep', { label: 'Désélectionner', icon: 'x', fn: clearSel }]);
}
/** Une seule icône pour toutes les pages sélectionnées. */
async function bulkIcon() {
  const ps = selPages(); if (!ps.length) return;
  const v = await pickIcon(ps.every((p) => p.icon === ps[0].icon) ? ps[0].icon : null, { title: `Icône de ${ps.length} page${ps.length > 1 ? 's' : ''}` });
  if (v === null) return;
  for (const p of ps) await api.patch(`/api/pages/${p.id}`, { icon: v || null });
  toast(`Icône modifiée sur ${ps.length} page${ps.length > 1 ? 's' : ''}`);
  await afterTreeChange();
}
async function bulkMove() {
  const ps = selPages(); if (!ps.length) return;
  const exclude = new Set(); for (const p of ps) { exclude.add(p.id); descendantsOf(p.id, S.tree.pages).forEach((d) => exclude.add(d)); }
  const dest = await movePicker({ title: `Déplacer ${ps.length} pages vers…`, subject: ps.map((p) => prettify(p.title) || 'Sans titre').slice(0, 3).join(', ') + (ps.length > 3 ? '…' : ''), pages: S.tree.pages, exclude, allow: (x) => x.kind !== 'database' });
  if (dest === null) return;
  for (const p of ps) await api.patch(`/api/pages/${p.id}`, { parent_id: dest || null });
  if (dest) { const open = new Set(store.get('dw_open', [])); open.add(dest); store.set('dw_open', [...open]); }
  S.sel.clear(); toast(`${ps.length} pages déplacées`); await afterTreeChange();
}
async function bulkTrash() {
  const ps = selPages(); if (!ps.length || !(await confirmBox(`Mettre ${ps.length} page${ps.length > 1 ? 's' : ''} (et leurs sous-pages) à la corbeille ?`))) return;
  const cur = S.current?.id, gone = new Set(); for (const p of ps) { gone.add(p.id); descendantsOf(p.id, S.tree.pages).forEach((d) => gone.add(d)); }
  for (const p of ps) await api.del(`/api/pages/${p.id}`);
  S.sel.clear(); await refreshTree(); if (cur && gone.has(cur)) location.hash = '#/'; toast('Mises à la corbeille');
}

const newMenuItems = (parent) => [{ label: 'Nouvelle page', icon: 'file-plus', fn: () => newPage(parent) }, { label: 'Nouveau dossier', icon: 'folder-plus', fn: () => newPage(parent, 'folder') }, { label: 'Nouvelle base de données', icon: 'database', fn: () => newPage(parent, 'database') }];
/** Tous les descendants d'une page (pour interdire de la déplacer dans elle-même). */
function descendantsOf(id, pages) {
  const out = new Set(), kids = new Map();
  for (const p of pages) { if (!kids.has(p.parent_id)) kids.set(p.parent_id, []); kids.get(p.parent_id).push(p.id); }
  const walk = (i) => { for (const c of kids.get(i) || []) if (!out.has(c)) { out.add(c); walk(c); } };
  walk(id); return out;
}
const afterTreeChange = async () => { await refreshTree(); if (S.current) showPage(S.current.id); }; // la page affichée peut être la destination (dossier) ou l'élément déplacé

/** « Déplacer vers… » : ouvre le sélecteur de destination et change le parent de la page ou du dossier. */
async function movePageDialog(p) {
  const exclude = descendantsOf(p.id, S.tree.pages); exclude.add(p.id);
  const dest = await movePicker({ title: 'Déplacer vers…', subject: prettify(p.title) || 'Sans titre', pages: S.tree.pages, exclude, allow: (x) => x.kind !== 'database', currentParent: p.parent_id || null });
  if (dest === null) return;
  await api.patch(`/api/pages/${p.id}`, { parent_id: dest || null });
  if (dest) { const open = new Set(store.get('dw_open', [])); open.add(dest); store.set('dw_open', [...open]); }
  toast(dest ? `Déplacé dans « ${prettify(S.pageMap?.get(dest)?.title) || 'Sans titre'} »` : 'Déplacé à la racine');
  await afterTreeChange(p.id);
}
async function renamePage(p) {
  const v = await ask('Renommer', 'Titre', p.title || ''); if (v === null) return;
  await api.patch(`/api/pages/${p.id}`, { title: v.trim() }); await afterTreeChange(p.id);
}
async function changePageIcon(p) {
  const v = await pickIcon(p.icon); if (v === null) return;
  await api.patch(`/api/pages/${p.id}`, { icon: v || null }); await afterTreeChange(p.id);
}
async function duplicatePage(p) {
  const r = await api.post(`/api/pages/${p.id}/duplicate`); await refreshTree(); toast('Page dupliquée'); location.hash = `#/page/${r.id}`;
}
async function trashPage(p) {
  await api.del(`/api/pages/${p.id}`); await refreshTree();
  if (S.current?.id === p.id || descendantsOf(p.id, S.tree.pages).has(S.current?.id)) location.hash = p.parent_id ? `#/page/${p.parent_id}` : '#/';
  toast('Mis à la corbeille');
}
const pageLink = (p) => `${location.origin}/#/page/${p.id}`;
/** Menu du clic droit sur une page ou un dossier (barre latérale, listes de sous-pages…). */
function pageContextMenu(x, y, p) {
  const container = p.kind !== 'database';
  popMenu(x, y, [
    { header: prettify(p.title) || 'Sans titre' },
    { label: 'Ouvrir dans un nouvel onglet', icon: 'external-link', fn: () => window.open(pageLink(p), '_blank', 'noopener') },
    { label: 'Copier le lien', icon: 'link-2', fn: async () => { await navigator.clipboard?.writeText(pageLink(p)).catch(() => {}); toast('Lien copié'); } },
    { label: isFav(p.id) ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: 'star', fn: () => toggleFav(p) },
    'sep',
    { label: 'Renommer', icon: 'pencil', fn: () => renamePage(p) },
    { label: 'Changer l’icône', icon: 'smile-plus', fn: () => changePageIcon(p) },
    container ? { label: 'Ajouter une sous-page', icon: 'file-plus', fn: () => newPage(p.id) } : null,
    container ? { label: 'Ajouter un sous-dossier', icon: 'folder-plus', fn: () => newPage(p.id, 'folder') } : null,
    'sep',
    { label: 'Dupliquer', icon: 'copy', fn: () => duplicatePage(p) },
    { label: 'Déplacer vers…', icon: 'arrow-right', fn: () => movePageDialog(p) },
    'sep',
    { label: 'Mettre à la corbeille', icon: 'trash-2', danger: true, fn: () => trashPage(p) },
  ]);
}

async function newPage(parent_id, kind = 'page') {
  try {
    const p = await api.post('/api/pages', { parent_id, kind, title: '' });
    await refreshTree(); location.hash = `#/page/${p.id}`;
  } catch (e) { toast(e.message, 'error'); }
}

// ================= recherche =================
const foldAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Texte avec les mots recherchés surlignés (insensible à la casse et aux accents). */
function highlight(text, words) {
  const n = foldAccents(text), marks = [];
  for (const w of words) { for (let i = n.indexOf(w); w && i >= 0; i = n.indexOf(w, i + w.length)) marks.push([i, i + w.length]); }
  marks.sort((a, b) => a[0] - b[0]);
  const out = []; let pos = 0;
  for (const [a, b] of marks) { if (a < pos) continue; out.push(text.slice(pos, a), h('mark', {}, text.slice(a, b))); pos = b; }
  out.push(text.slice(pos));
  return out;
}
const pageIcon = (p, size = 18) => iconNode(p.icon, size, kindIcon(p.kind));

/** Palette de recherche (Ctrl/⌘ K) : pages récentes, résultats avec extrait, chemin du parent, navigation au clavier. */
function openSearch() {
  if (document.querySelector('.palette')) return;
  const input = h('input', { class: 'palette-input', placeholder: 'Rechercher ou aller à une page…', autocomplete: 'off', spellcheck: false });
  const list = h('div', { class: 'palette-list' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const back = h('div', { class: 'palette', onmousedown: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'palette-box', role: 'dialog', 'aria-label': 'Recherche' },
      h('div', { class: 'palette-head' }, h('span', { class: 'palette-ico' }, '🔍'), input, h('kbd', {}, 'Échap')),
      list,
      h('div', { class: 'palette-foot' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' naviguer'), h('span', {}, h('kbd', {}, '↵'), ' ouvrir'), h('span', {}, h('kbd', {}, 'Échap'), ' fermer'))));
  let rows = [], sel = 0, seq = 0;
  const go = (id) => { close(); location.hash = `#/page/${id}`; };
  const setSel = (i) => { sel = rows.length ? (i + rows.length) % rows.length : 0; rows.forEach((r, k) => r.el.classList.toggle('sel', k === sel)); rows[sel]?.el.scrollIntoView({ block: 'nearest' }); };
  function draw(items, words, title) {
    rows = items.map((p) => ({ id: p.id, el: h('a', { class: 'pal-item', href: `#/page/${p.id}`, onclick: (e) => { e.preventDefault(); go(p.id); }, onmousemove: () => { const k = rows.findIndex((r) => r.id === p.id); if (k !== sel) setSel(k); } },
      h('span', { class: 'pal-icon' }, pageIcon(p)),
      h('span', { class: 'pal-main' }, h('span', { class: 'pal-title' }, highlight(prettify(p.title) || 'Sans titre', words)), p.snippet ? h('span', { class: 'pal-snippet' }, highlight(p.snippet, words)) : null),
      p.parent_title ? h('span', { class: 'pal-path' }, prettify(p.parent_title)) : null) }));
    list.replaceChildren(...(rows.length ? [h('div', { class: 'pal-section' }, title), ...rows.map((r) => r.el)] : [h('div', { class: 'pal-empty' }, words.length ? 'Aucun résultat' : 'Aucune page récente')]));
    setSel(0);
  }
  const showRecent = () => draw(recentPages().slice(0, 8), [], 'Récent');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim(), words = foldAccents(q).split(/\s+/).filter(Boolean);
    if (!words.length) return showRecent();
    const my = ++seq;
    t = setTimeout(async () => {
      const r = await api.get(`/api/pages/search?q=${encodeURIComponent(q)}`).catch(() => []);
      if (my === seq) draw(r, words, 'Résultats');
    }, 140);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) go(rows[sel].id); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  showRecent(); input.focus();
}

// ================= page =================
function setStatus(t, cls = '') { const s = $('#save-status'); if (s) { s.textContent = t; s.className = `muted small ${cls}`; } }
async function flushSave(keepalive = false) {
  if (!S.dirty || !S.editor || !S.current) return;
  const id = S.current.id, blocks = S.editor.getFlat();
  S.dirty = false; setStatus('Enregistrement…');
  try { await api.put(`/api/pages/${id}/blocks`, { blocks }, { keepalive: keepalive && JSON.stringify(blocks).length < 60000 }); setStatus('Enregistré'); }
  catch (e) { S.dirty = true; setStatus('Échec de l’enregistrement', 'err'); toast(e.message, 'error'); }
}
const scheduleSave = debounce(() => flushSave(), 700);

/** Une page d'une base (ou sous-page d'une ligne de base) peut être un chapitre scolaire : on charge alors le panneau des fichiers. */
/** Mise à jour d'une ancienne page : liste des blocs de premier niveau (ceux de l'ancienne structure déjà cochés), confirmation, application. */
async function modernizeDialog(page, onDone) {
  let plan; try { plan = await api.post(`/api/pages/${page.id}/modernize`, { dry: true }); } catch (e) { toast(e.message, 'error'); return; }
  const checks = plan.blocks.map((b) => h('input', { type: 'checkbox', checked: b.suggested ? true : null }));
  const label = (t) => ({ toggle: 'Bloc déroulant', heading_1: 'Titre 1', heading_2: 'Titre 2', heading_3: 'Titre 3', paragraph: 'Texte', callout: 'Encadré', divider: 'Séparateur', button: 'Bouton' }[t] || t);
  const rows = plan.blocks.map((b, i) => h('label', { class: 'arch-row' }, checks[i], h('span', { class: 'muted small' }, label(b.type)), h('span', {}, b.text || '(vide)'), b.size > 1 ? h('span', { class: 'muted small' }, `+ ${b.size - 1} bloc(s) à l’intérieur`) : null));
  const m = modal('Mettre à jour cette page', h('div', {},
    plan.reference ? h('p', { class: 'arch-ref' }, vi('layout-template', 14), ` La page sera reconstruite selon l’architecture de « ${plan.reference} » : ton contenu est recasé sous les sections du même nom, le reste va dans « À classer » en bas.`) : null,
    h('p', {}, 'Coche ce qui doit être retiré (l’ancienne structure « Original / Modifié » est déjà cochée). Le bouton « Nouvel addendum » est ajouté dans la section Addenda s’il manque. Une version de secours de la page est conservée : tu peux revenir en arrière depuis l’historique.'),
    h('div', { class: 'arch-list' }, rows.length ? rows : h('p', { class: 'muted' }, 'La page est vide.')),
    h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await api.post(`/api/pages/${page.id}/modernize`, { dry: false, remove: plan.blocks.filter((_, i) => checks[i].checked).map((b) => b.id) }); m.close(); toast(`Page mise à jour (${r.removed} bloc(s) retiré(s)${r.buttons ? `, ${r.buttons} bouton(s) ajouté(s)` : ''})`); onDone?.(); }
        catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
      } }, 'Mettre à jour'))));
}
const hasDbAncestor = (p) => { let c = S.pageMap?.get(p.parent_id), n = 0; while (c && n++ < 5) { if (c.kind === 'database') return true; c = S.pageMap.get(c.parent_id); } return false; };
/** Battement de présence : alimente « Réglages → Connexions » (temps passé par page, comptes et liens publics). */
function startPing(pageId) {
  clearInterval(S.pingTimer); S.pingVisit = null; S.lastAct = S.lastAct || Date.now();
  if (!pageId) return;
  const send = async (keepalive) => {
    if (S.current?.id !== pageId || (document.visibilityState !== 'visible' && !keepalive)) return;
    if (S.pingVisit && Date.now() - (S.lastAct || 0) > 5 * 60_000 && !keepalive) return; // inactif : on ne compte pas
    try { const r = await api.post('/api/activity', { page_id: pageId, visit: S.pingVisit, token: S.token || undefined }, { keepalive }); if (r.visit) S.pingVisit = r.visit; } catch { /* sans importance */ }
  };
  send(false); S.pingTimer = setInterval(() => send(false), 30_000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.pingVisit && S.current) api.post('/api/activity', { page_id: S.current.id, visit: S.pingVisit, token: S.token || undefined }, { keepalive: true }).catch(() => {}); });
async function showPage(id) {
  S.editor?.destroy(); S.editor = null; S.current = null; S.dirty = false; S.tocCleanup?.(); S.tocCleanup = null;
  mainEl.replaceChildren(h('div', { class: 'loading' }, loadingText()));
  let data;
  try { data = await api.get(`/api/pages/${id}${S.token ? `?token=${encodeURIComponent(S.token)}` : ''}`); }
  catch (e) {
    if (e.status === 423 && e.data?.locked) return lockScreen(id, e.data);
    const notFound = e.status !== 401;
    return mainEl.replaceChildren(topbar([]), h('div', { class: 'empty' }, h('h2', { title: 'REDACTED' }, notFound ? 'Page introuvable' : 'Connexion requise'),
      h('p', {}, notFound ? 'Elle n’existe pas ou ne vous est pas accessible.' : 'Cette page n’est pas publique.'), redactedLine(),
      notFound ? h('p', { class: 'small' }, 'Si vous suivez un lien issu de Notion : cette page n’a probablement pas été importée (non partagée avec l’intégration Notion). Partagez-la dans Notion (••• → Connexions), puis relancez l’import dans Réglages → Import Notion.') : null,
      notFound ? null : h('a', { class: 'btn primary', href: '#/' }, 'Se connecter')));
  }
  const { page, blocks, children, crumbs } = data;
  const guest = S.guest === page.id && !S.token;                  // « Aperçu invité » : on voit la page comme quelqu'un qui n'a que la lecture
  const role = guest ? 'view' : data.role;
  S.current = page; drawSidebar();
  armIdleLock(page.id); startPing(page.id);
  if (!S.token) recordVisit(page.id);
  const editable = (role === 'edit' || role === 'owner') && !S.token && !page.archived;
  document.title = `${prettify(page.title) || 'Sans titre'} — ${S.settings.site_name || 'Deepwell'}`;

  // les dates ISO « brutes » d'un titre importé s'affichent dans le fuseau horaire de l'utilisateur
  const title = h('h1', { class: 'title', 'data-ph': 'Sans titre', contenteditable: editable ? 'plaintext-only' : null }, prettify(page.title));
  // titre riche (avec mentions @date / @page) : sur une ligne de base, c'est la propriété titre ; sinon props.dw_title_rt. Ignoré si le texte ne correspond plus au titre.
  const richTitle = data.parentSchema ? page.props?.[titleKey(data.parentSchema)]?.title : page.props?.dw_title_rt;
  if (Array.isArray(richTitle) && richTitle.some((r) => r.type === 'mention') && rtPlain(richTitle) === page.title) titleToDom(title, richTitle);
  if (editable) {
    const saveTitle = debounce(async () => {
      const rt = domToRt(title), t = rtPlain(rt).replace(/\n/g, ' '), rich = rt.some((r) => r.type === 'mention');
      try {
        let props;
        if (data.parentSchema) props = { ...page.props, [titleKey(data.parentSchema)]: { type: 'title', title: rt } };
        else { props = { ...(page.props || {}) }; if (rich) props.dw_title_rt = rt; else delete props.dw_title_rt; }
        const patch = { title: t }; if (data.parentSchema || rich || page.props?.dw_title_rt) patch.props = props;
        await api.patch(`/api/pages/${page.id}`, patch); if (patch.props) page.props = props;
        page.title = t; const cr = document.querySelector('.crumbs > :last-child'); if (cr?.lastChild?.nodeType === 3) cr.lastChild.textContent = prettify(t) || 'Sans titre'; document.title = `${prettify(t) || 'Sans titre'} — ${S.settings.site_name || 'Deepwell'}`; const sp = S.tree.pages.find((p) => p.id === page.id); if (sp) { sp.title = t; drawSidebar(); }
      } catch (e) { toast(e.message, 'error'); }
    }, 500);
    attachTitleMentions(title, { recentPages, searchPages: (q) => api.get(`/api/pages/search?q=${encodeURIComponent(q)}`), onChange: () => {} });
    title.addEventListener('input', () => saveTitle());
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); S.editor?.focusFirst(); } });
  }

  const setIcon = async (v) => {
    await api.patch(`/api/pages/${page.id}`, { icon: v || null }); page.icon = v || null;
    const sp = S.pageMap?.get(page.id); if (sp) sp.icon = v || null; drawSidebar(); showPage(id);
  };
  const askIcon = async () => { const v = await pickIcon(page.icon); if (v !== null) setIcon(v); };
  const icon = page.icon ? h('button', { class: 'page-icon', disabled: !editable, title: editable ? 'Changer l’icône' : null, onclick: askIcon }, iconNode(page.icon, 72, 'file-text')) : null;
  const controls = editable ? h('div', { class: 'page-controls' },
    page.icon ? null : h('button', { class: 'btn', onclick: askIcon }, vi('smile-plus', 16), 'Ajouter une icône'),
    h('button', { class: 'btn', onclick: () => coverDialog(page) }, vi('image-plus', 16), page.cover ? 'Changer la couverture' : 'Ajouter une couverture')) : null;
  const cover = page.cover && safeUrl(page.cover) ? h('div', { class: 'cover', style: `background-image:url("${safeUrl(page.cover).replace(/["\\]/g, '')}")` }) : null;

  const body = h('div', { class: 'page-body' });
  const parts = [cover, h('div', { class: `page ${store.get('dw_wide', false) || page.kind === 'database' ? 'wide' : ''}` }, icon, controls, title)];
  if (page.archived) parts[1].append(h('div', { class: 'banner' }, 'Cette page est dans la corbeille. ', h('button', { class: 'btn small', onclick: async () => { await api.patch(`/api/pages/${page.id}`, { archived: false }); await refreshTree(); showPage(id); } }, 'Restaurer')));

  if (data.parentSchema) { // ligne de base de données : propriétés
    const sch = data.parentSchema, tk = titleKey(sch);
    const box = h('div', { class: 'props' }, Object.keys(sch).filter((k) => k !== tk).map((k) => h('div', { class: 'prop' }, h('label', { class: 'prop-label', title: k }, vi(typeIcon(sch[k].type), 15), h('span', {}, k)),
      propEditor(sch[k], page.props?.[k], editable, async (np) => { page.props = { ...page.props, [k]: np }; try { const r = await api.patch(`/api/pages/${page.id}`, { props: page.props }); if (r?.title) { toast(`Titre : ${r.title}`); refreshTree(); showPage(page.id); } } catch (e) { toast(e.message, 'error'); } }, async () => { await api.patch(`/api/pages/${data.crumbs.at(-1)?.id}`, { schema: sch }); }))));
    parts[1].append(box);
  }
  if (page.kind === 'template') {
    const dbc = crumbs[crumbs.length - 1];
    parts[1].append(h('div', { class: 'banner tpl-banner' }, vi('file-text', 16), h('span', {}, ' Modèle de la base ', h('b', {}, dbc?.title || ''), '. Chaque nouvelle ligne créée depuis ce modèle reprend ses propriétés et son contenu. ',
      dbc ? h('a', { href: `#/page/${dbc.id}` }, 'Retour à la base') : null)));
  }
  if (editable && data.parentSchema && page.kind === 'page') { // ancienne page d'un recueil scolaire : pastille jaune + bouton de mise à jour
    const archHost = h('div', { class: 'arch-host' });
    parts[1].append(archHost);
    api.get(`/api/pages/${page.id}/modernize`).then((st) => {
      if (!st.legacy) return;
      const pill = h('span', { class: 'arch-pill', title: S.settings.dev_mode === '1' ? 'Clic droit : marquer comme modifiée' : 'Cette page utilise l’ancienne structure' }, '● À mettre à jour');
      pill.addEventListener('contextmenu', (e) => {
        if (S.settings.dev_mode !== '1') return;
        e.preventDefault();
        import('./menus.js').then(({ popMenu }) => popMenu(e.clientX, e.clientY, [{ label: 'Marquer comme modifiée', icon: 'check', fn: async () => { await api.post(`/api/pages/${page.id}/modernize/mark`); toast('Page marquée comme modifiée'); showPage(page.id); } }]));
      });
      archHost.append(h('div', { class: 'arch-banner' }, pill, h('span', { class: 'muted small' }, 'Cette page garde l’ancienne structure du recueil.'),
        h('button', { class: 'btn small', onclick: () => modernizeDialog(page, () => showPage(page.id)) }, vi('refresh-cw', 14), 'Mettre à jour cette page')));
    }).catch(() => {});
  }
  let schoolPanel = null;
  if (!S.token && S.me && page.kind !== 'database' && page.kind !== 'template' && (data.parentSchema || crumbs.slice(-5).some((c) => c.kind === 'database'))) {
    // Panneau « Fichiers » : un seul élément réutilisé (pas de rechargement à chaque rendu de l'éditeur). Sans bloc « Fichiers du chapitre » dans la page,
    // il reste en tête ; sinon il s'affiche là où le bloc a été placé (déplaçable comme n'importe quel bloc).
    schoolPanel = h('div', { class: 'school-files-host' });
    import('./school-files.js').then((m) => m.mountSchoolFiles(schoolPanel, page)).catch(() => {}); // chargé à la demande, seulement pour les pages d'une base
    if (!(data.blocks || []).some((b) => b.type === 'school_files')) {
      parts[1].append(schoolPanel);
      if (editable) schoolPanel.before(h('div', { class: 'sf-move' }, h('button', { class: 'btn small', title: 'Insère le panneau dans la page : tu peux ensuite le déplacer où tu veux', onclick: () => { S.editor?.insertBlockAt('school_files', Math.min(2, S.editor.getFlat().filter((b) => !b.parent_id).length)); document.querySelector('.sf-move')?.remove(); } }, vi('move', 14), 'Placer dans la page')));
    }
  }
  parts[1].append(body);
  const topRight = [h('span', { id: 'save-status', class: 'muted small' }, '')];
  if (S.token) topRight.push(h('span', { class: 'muted small' }, 'Page publique'), S.me ? h('a', { class: 'btn small', href: '#/' }, 'Ouvrir Deepwell') : null);
  else if (guest) topRight.push(h('span', { class: 'guest-pill' }, '👁 Aperçu invité — lecture seule'), h('button', { class: 'btn small primary', onclick: () => { S.guest = null; location.hash = `#/page/${page.id}`; showPage(page.id); document.body.classList.remove('guest-preview'); } }, 'Quitter l’aperçu'));
  else {
    topRight.push(h('button', { class: 'icon-btn cm-top', title: 'Commentaires', 'aria-label': 'Commentaires', onclick: () => showComments(page, role, null) }, vi('message-square', 18), h('span', { id: 'cm-count', class: 'cm-count', hidden: true })));
    topRight.push(h('button', { class: `icon-btn fav-top ${isFav(page.id) ? 'on' : ''}`, title: 'Ajouter aux favoris / retirer', 'aria-label': 'Favori', onclick: () => toggleFav(page) }, vi('star', 18)));
    if (role === 'owner') topRight.push(h('button', { class: 'btn small', onclick: () => shareDialog(page) }, 'Partager'));
    if (editable || role === 'owner') topRight.push(h('button', { class: 'icon-btn', title: 'Plus', onclick: (e) => pageMenu(e.currentTarget, page, role, editable) }, '⋯'));
  }
  mainEl.replaceChildren(topbar([...crumbs, { id: page.id, title: page.title, icon: page.icon, kind: page.kind }], topRight), h('div', { class: 'scroll' }, ...parts.filter(Boolean)));

  if (page.kind === 'folder') {
    const kids = children.filter((c) => c.kind !== undefined);
    body.append(h('div', { class: 'folder-view' },
      editable ? h('div', { class: 'folder-actions' }, h('button', { class: 'btn', onclick: () => newPage(page.id) }, vi('file-plus', 16), 'Nouvelle page'), h('button', { class: 'btn', onclick: () => newPage(page.id, 'folder') }, vi('folder-plus', 16), 'Nouveau dossier'), h('button', { class: 'btn', onclick: () => newPage(page.id, 'database') }, vi('database', 16), 'Nouvelle base')) : null,
      kids.length ? h('div', { class: 'folder-list' }, kids.map((c) => {
        const n = [...(S.pageMap?.values() || [])].filter((x) => x.parent_id === c.id && !x.archived).length;
        return h('a', { class: 'lst-row', href: S.token ? `#/public/${S.token}/${c.id}` : `#/page/${c.id}`, oncontextmenu: (e) => { const sp = S.pageMap?.get(c.id); if (editable && sp) { e.preventDefault(); pageContextMenu(e.clientX, e.clientY, sp); } } },
          iconNode(c.icon, 20, kindIcon(c.kind)), h('span', { class: 'lst-title' }, prettify(c.title) || 'Sans titre'), c.kind !== 'database' && n ? h('span', { class: 'muted small' }, `${n} élément${n > 1 ? 's' : ''}`) : null);
      })) : h('div', { class: 'muted pad' }, 'Ce dossier est vide. Ajoutez-y des pages ou d’autres dossiers, ou déplacez-en avec « Déplacer vers… ».')));
  } else if (page.kind === 'database') {
    renderDatabase(body, { page, rows: children.map((c) => ({ id: c.id, title: c.title, icon: c.icon, cover: c.cover, legacy: c.legacy, locked: c.locked, srank: c.srank, total: c.total, props: c.props || {} })), role, onChange: refreshTree });
  } else {
    const host = h('div', {});
    body.append(host);
    S.editor = createEditor(host, { blocks, editable, hooks: {
      mountSchoolFiles: schoolPanel ? (box) => { box.append(schoolPanel); } : null,
      onChange: () => { S.dirty = true; setStatus('Modifié…'); scheduleSave(); },
      upload: (f) => api.upload(f),
      createSubpage: async () => { const p = await api.post('/api/pages', { parent_id: page.id, title: '' }); refreshTree(); return p; },
      pickDrive: pickDriveFile,
      pageInfo, recentPages, users: loadUsers,
      searchPages: (q) => api.get(`/api/pages/search?q=${encodeURIComponent(q)}`),
      listDatabases: async () => [...(S.pageMap?.values() || [])].filter((p) => p.kind === 'database' && !p.archived).map((p) => ({ id: p.id, title: p.title })),
      loadDatabase,
      mountDatabase: async (host, dbId) => {
        const d = await api.get(`/api/pages/${dbId}${S.token ? `?token=${encodeURIComponent(S.token)}` : ''}`);
        if (d.page.kind !== 'database') return false;
        renderDatabase(host, { page: d.page, rows: d.children.map((x) => ({ id: x.id, title: x.title, icon: x.icon, cover: x.cover, legacy: x.legacy, locked: x.locked, srank: x.srank, total: x.total, props: x.props || {} })), role: S.token ? 'view' : d.role, onChange: refreshTree });
        return true;
      },
      commentBlock: S.token ? null : (blockId, label, quote, anchor) => showComments(page, role, { block_id: blockId, label, quote, anchor }),
      openComments: () => showComments(page, role, null),
      rightClickMode: () => store.get('dw_ctx_mode', 'deepwell'),
      userName: () => S.me?.name || S.me?.email || '',
      setPageIcons: async (ids, icon) => { for (const pid of ids) { try { await api.patch(`/api/pages/${pid}`, { icon: icon || null }); } catch (e) { toast(e.message, 'error'); } } await refreshTree(); },
      pageTitle: () => prettify(page.title) || '',
      pageSchema: () => data.parentSchema || null,
      pickPage: async () => { const pid = await movePicker({ title: 'Choisir une page', subject: '', pages: S.tree.pages, rootLabel: null }); return pid ? { id: pid, title: prettify(S.pageMap?.get(pid)?.title) || 'Sans titre' } : null; },
      buttonAction: async (a) => {
        if (a.type === 'add_page') {
          if (!a.database_id) throw new Error('aucune base de données choisie');
          const d = await api.get(`/api/pages/${a.database_id}`), schema = d.page.schema || {}, props = {};
          for (const { name, value } of a.props || []) { const def = schema[name]; if (!def) continue; const v = valueFor(def, value); if (v) props[name] = v; }
          let row;
          if (a.template_id) { // depuis un modèle de la base : contenu et propriétés copiés, « @Today » remplacé ; un titre saisi remplace celui du modèle
            row = await api.post(`/api/pages/${a.database_id}/from-template/${a.template_id}`, { today: todayIso() });
            if (a.title) { props[titleKey(schema)] = { type: 'title', title: plainRt(a.title) }; await api.patch(`/api/pages/${row.id}`, { title: a.title }); }
            const sc = d.page.props?.dw_school;
            if (sc?.enabled && sc.options?.drive) { try { await api.post(`/api/school/pages/${row.id}/folder`); } catch (e) { toast(e.message, 'error'); } }
          } else row = await api.post('/api/pages', { parent_id: a.database_id, title: a.title || '' });
          if (Object.keys(props).length) await api.patch(`/api/pages/${row.id}`, { props: { ...(row.props || {}), ...props } }); // garde les valeurs automatiques (numéros)
          dbCache.delete(a.database_id); refreshTree();
          toast(`Page ajoutée dans « ${prettify(d.page.title) || 'la base'} »`);
          if (a.open) { await flushSave(); location.hash = `#/page/${row.id}`; }
        } else if (a.type === 'add_subpage') {
          // mode scolaire : le titre « Addendum du <date> » devient « Addendum #<n° P.S.A.>/<nn>-<année>-<matière> » (le nom se tape ensuite)
          if (/^Addendum du /i.test(a.title || '') || /\{\{\s*matricule_addendum\s*\}\}/.test(a.title || '')) { try { const t = (await api.get(`/api/school/titles/addendum?page_id=${page.id}`)).title; if (t) a = { ...a, title: t }; } catch { /* hors mode scolaire : titre d'origine */ } }
          const p = await api.post('/api/pages', { parent_id: page.id, title: a.title || '' });
          let blocks = null;
          if (a.template_page_id) { // modèle : le contenu d'une autre page est copié (blocs neufs ; « @Today » du modèle → date du jour)
            const src = await api.get(`/api/pages/${a.template_page_id}`), kept = src.blocks.filter((b) => !['child_page', 'child_database'].includes(b.type)), ids = new Map(kept.map((b) => [b.id, uuid()])), today = todayIso();
            const walk = (v) => Array.isArray(v) ? v.map(walk) : v && typeof v === 'object'
              ? (v.type === 'mention' && v.mention?.type === 'template_mention' && /today|now/.test(JSON.stringify(v.mention.template_mention))
                ? { ...v, mention: { type: 'date', date: { start: today, end: null, time_zone: null } }, plain_text: today } : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))) : v;
            blocks = kept.map((b) => ({ id: ids.get(b.id), parent_id: b.parent_id ? ids.get(b.parent_id) || null : null, type: b.type, content: walk(b.content) }));
          } else { const items = parseBlocksText(a.text); if (items.length) { if (items[items.length - 1][0] === 'divider') items.push(['paragraph', '']); blocks = blocksFromItems(items); } } // jamais de séparateur en dernier : un bloc de texte prêt à écrire suit
          if (blocks?.length) await api.put(`/api/pages/${p.id}/blocks`, { blocks });
          refreshTree(); toast(`Sous-page « ${a.title || 'Sans titre'} » créée`);
          return { id: p.id, title: a.title || '' };
        } else if (a.type === 'edit_property') {
          const sch = data.parentSchema; if (!sch) throw new Error('cette page n’est pas une ligne de base de données');
          const def = sch[a.prop]; if (!def) throw new Error(`propriété « ${a.prop} » introuvable`);
          const v = valueFor(def, a.value); if (!v) throw new Error(`le type « ${def.type} » n’est pas modifiable par un bouton`);
          page.props = { ...page.props, [a.prop]: v };
          const patch = { props: page.props }; if (def.type === 'title') { patch.title = String(a.value ?? ''); page.title = patch.title; }
          await api.patch(`/api/pages/${page.id}`, patch); S.needRefresh = true; toast(`« ${a.prop} » modifiée`);
        }
      },
      saveNow: () => flushSave(),
      listTemplates: (id) => api.get(`/api/pages/${id}/templates`),
      afterButton: async () => { if (S.needRefresh) { S.needRefresh = false; await flushSave(); showPage(page.id); } },
      moveBlockTo: S.token ? null : async (flat, label, onMoved) => {
        try {
          const dest = await movePicker({ title: 'Déplacer le bloc vers…', subject: label, pages: S.tree.pages, exclude: new Set([page.id]), allow: (x) => x.kind === 'page', rootLabel: null });
          if (!dest) return;
          const d = await api.get(`/api/pages/${dest}`);
          const existing = d.blocks.map((b) => ({ id: b.id, parent_id: b.parent_id, type: b.type, content: b.content }));
          await api.put(`/api/pages/${dest}/blocks`, { blocks: [...existing, ...flat] }); // copie d'abord (nouveaux identifiants)…
          onMoved();                                                                           // …puis retrait de la source : jamais de perte
          toast(`Bloc déplacé dans « ${prettify(S.pageMap?.get(dest)?.title) || 'Sans titre'} »`);
        } catch (e) { toast(e.message, 'error'); }
      },
    } });
    if (!S.token) loadComments(page.id);
    S.tocCleanup = mountToc(host, $('.scroll', mainEl));
  }
  if (editable && !page.title && !blocks.length) title.focus();
}

// ================= commentaires =================
async function loadComments(pageId) {
  try { S.comments = await api.get(`/api/pages/${pageId}/comments`); } catch { S.comments = []; }
  if (S.current?.id !== pageId) return;
  S.editor?.setComments(openThreadsByBlock(S.comments));
  S.editor?.setCommentMarks?.(S.comments.filter((c) => !c.parent_id && !c.resolved));
  const b = $('#cm-count'); if (b) { const n = openThreadCount(S.comments); b.textContent = n; b.hidden = !n; }
}
function showComments(page, role, target) {
  const ctx = { page, role, me: S.me, list: S.comments || [], target, devMode: S.settings.dev_mode === '1',
    reload: async () => { await loadComments(page.id); ctx.list = S.comments || []; },
    goToBlock: (id) => id && S.editor?.scrollToBlock(id) };
  openComments(ctx);
}

// ================= données de bases pour les graphiques (mises en cache brièvement) =================
const dbCache = new Map();
async function loadDatabase(id) {
  const hit = dbCache.get(id);
  if (hit && Date.now() - hit.t < 20000) return hit.v;
  const d = await api.get(`/api/pages/${id}${S.token ? `?token=${encodeURIComponent(S.token)}` : ''}`);
  const v = { schema: d.page.schema || {}, rows: d.children.map((c) => ({ id: c.id, title: c.title, props: c.props || {} })) };
  dbCache.set(id, { t: Date.now(), v }); return v;
}

/**
 * Table des matières flottante à droite, comme Notion : de petits traits (un par titre) qui se déplient au survol
 * en liste cliquable ; le titre en cours de lecture est mis en évidence. Se met à jour pendant la frappe.
 */
function mountToc(host, scrollEl) {
  const rail = h('nav', { class: 'toc-rail', 'aria-label': 'Table des matières', hidden: true });
  mainEl.append(rail);
  const collect = () => [...host.querySelectorAll('.block.t-heading_1, .block.t-heading_2, .block.t-heading_3')]
    .map((b) => ({ el: b, level: +b.className.match(/t-heading_(\d)/)[1], text: (b.querySelector(':scope > .row .txt')?.textContent || '').trim() })).filter((x) => x.text);
  let sig = '';
  const markActive = () => {
    const heads = collect(), top = scrollEl.getBoundingClientRect().top + 110;
    let active = -1;
    heads.forEach((x, i) => { if (x.el.getBoundingClientRect().top <= top) active = i; });
    rail.querySelectorAll('[data-i]').forEach((n) => n.classList.toggle('active', Number(n.dataset.i) === active));
  };
  const build = () => {
    const heads = collect(), s = heads.map((x) => x.level + x.text).join('\n');
    rail.hidden = !heads.length;
    if (s === sig) return markActive();
    sig = s;
    const min = Math.min(...heads.map((x) => x.level));
    rail.replaceChildren(
      h('div', { class: 'toc-bars' }, heads.map((x, i) => h('span', { class: `toc-bar l${x.level - min + 1}`, dataset: { i } }))),
      h('div', { class: 'toc-panel' }, h('div', { class: 'toc-title' }, 'Table des matières'),
        heads.map((x, i) => h('a', { href: '#', class: `toc-link l${x.level - min + 1}`, dataset: { i }, title: x.text,
          onclick: (e) => { e.preventDefault(); collect()[i]?.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, x.text))));
    markActive();
  };
  let t; const later = () => { clearTimeout(t); t = setTimeout(build, 300); };
  const mo = new MutationObserver(later);
  mo.observe(host, { childList: true, subtree: true, characterData: true });
  let raf = 0; const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(markActive); };
  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  build();
  return () => { mo.disconnect(); clearTimeout(t); scrollEl.removeEventListener('scroll', onScroll); rail.remove(); };
}

/** Fenêtre « couverture » : importer, coller une URL, retirer. */
function coverDialog(page) {
  const done = async (cover) => { m.close(); await api.patch(`/api/pages/${page.id}`, { cover }); showPage(page.id); };
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', async () => { if (file.files[0]) { try { done((await api.upload(file.files[0])).url); } catch (e) { toast(e.message, 'error'); } } });
  const url = h('input', { class: 'input', placeholder: 'https://… adresse d’une image', value: page.cover && !page.cover.startsWith('/files/') ? page.cover : '' });
  const m = modal('Couverture', h('div', {}, h('div', { class: 'share-row' }, h('button', { class: 'btn', onclick: () => file.click() }, vi('file-up', 16), 'Importer une image'), file),
    h('div', { class: 'share-row' }, url, h('button', { class: 'btn primary', onclick: () => safeUrl(url.value) ? done(url.value.trim()) : toast('Adresse non valide', 'error') }, 'Utiliser')),
    page.cover ? h('div', { class: 'row-end' }, h('button', { class: 'btn danger', onclick: () => done(null) }, 'Retirer la couverture')) : null));
}

// ---------- accès restreint (code) ----------
function lockScreen(id, info) {
  clearInterval(S.idleTimer);
  const pin = h('input', { class: 'input', type: 'password', placeholder: 'Code d’accès', autocomplete: 'off', autofocus: true });
  const err = h('div', { class: 'lock-err' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api.post(`/api/pages/${id}/lock/unlock`, { pin: pin.value }); showPage(id); }
    catch (x) { err.textContent = x.message; pin.select(); }
  } }, pin, h('button', { class: 'btn primary', type: 'submit' }, 'Ouvrir'));
  mainEl.replaceChildren(topbar([]), h('div', { class: 'lock-screen' },
    h('div', { class: 'lock-big', title: 'P.C.S. actives' }, vi('lock', 26)), h('h2', {}, info.page?.title ? prettify(info.page.title) : h('span', { class: 'red-title' }, redBar(id, 0), h('span', { class: 'red-tag' }, 'EXPURGÉ'))),
    h('p', { class: 'muted' }, 'Cette page est protégée par un code d’accès.'), redactedLine(), form, err));
  setTimeout(() => pin.focus(), 50);
}
/** Verrouillage automatique après inactivité : le minuteur est réarmé à chaque page, remis à zéro à chaque action de l'utilisateur. */
/** Pastille « Déverrouillée » à côté du titre d'une page protégée par code qui est actuellement ouverte (clic : la reverrouiller). */
function markLockOpen(pageId, tries = 0) {
  document.querySelectorAll('.lock-chip').forEach((x) => x.remove());
  const li = S.lockInfo; if (!li || li.pageId !== pageId || !li.open || !(li.own || li.inherited) || S.token) return;
  const t = document.querySelector('.page h1.title');
  if (!t) { if (tries < 8) setTimeout(() => markLockOpen(pageId, tries + 1), 150); return; }
  t.after(h('button', { class: 'lock-chip', title: 'Cette page est protégée par un code et actuellement ouverte. Cliquer pour la reverrouiller.', onclick: async () => {
    try { await flushSave(); await api.post(`/api/pages/${pageId}/lock/now`); showPage(pageId); } catch (e) { toast(e.message, 'error'); }
  } }, vi('lock-open', 14), 'Déverrouillée · verrouiller'));
}
async function armIdleLock(pageId) {
  clearInterval(S.idleTimer); S.lockInfo = null;
  if (S.token) return;
  let li; try { li = await api.get(`/api/pages/${pageId}/lock`); } catch { return; }
  if (S.current?.id !== pageId) return;
  S.lockInfo = { pageId, own: li.own, inherited: li.inherited, idle: li.idle_min, open: !!li.open };
  markLockOpen(pageId); drawSidebar();
  if (!(li.own || li.inherited) || !li.idle_min) return;
  S.lastAct = Date.now();
  S.idleTimer = setInterval(async () => {
    if (Date.now() - S.lastAct < li.idle_min * 60_000) return;
    clearInterval(S.idleTimer);
    try { await flushSave(); await api.post(`/api/pages/${pageId}/lock/now`); } catch { /* verrouillage côté serveur de toute façon à l'expiration */ }
    if (S.current?.id === pageId) showPage(pageId);
  }, 10_000);
}
for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart']) document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true, capture: true });

// Clic droit sur une ligne de base de données : verrouiller / modifier / retirer le code sans quitter la base
window.addEventListener('dw-row-lock', async (e) => {
  const { id, mode, done } = e.detail || {};
  try {
    const own = (await api.get(`/api/pages/${id}/lock`)).own, page = { id };
    if (mode === 'remove') unlockRemove(page, done); else lockDialog(page, mode === 'edit' || (mode === 'auto' && own), done);
  } catch (x) { toast(x.message, 'error'); }
});
function pinField(label) { return h('input', { class: 'input', type: 'password', placeholder: label, autocomplete: 'new-password' }); }
function lockDialog(page, editing, after) {
  const cur = pinField('Code actuel'), p1 = pinField(editing ? 'Nouveau code (vide = inchangé)' : 'Code (4 caractères minimum)'), p2 = pinField('Confirmer le code');
  const idle = h('select', { class: 'input' }, [[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 heure'], [1440, '24 heures (par défaut)'], [0, 'Jamais (jusqu’à la déconnexion)']].map(([v, l]) => h('option', { value: v, selected: v === (S.lockInfo?.idle ?? 1440) }, l)));
  const err = h('div', { class: 'lock-err' });
  const m = modal(editing ? 'Modifier le verrou' : 'Verrouiller la page', h('div', { class: 'btn-dlg' },
    h('p', { class: 'muted small' }, 'Un code (PIN ou mot de passe) sera demandé pour ouvrir cette page et ses sous-pages, y compris à vous. Il n’est pas récupérable : conservez-le.'),
    editing ? cur : null, p1, p2,
    h('label', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, 'Verrouiller automatiquement après inactivité'), idle), err,
    h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary', onclick: async () => {
        err.textContent = '';
        if (p1.value !== p2.value && (p1.value || !editing)) { err.textContent = 'Les deux codes ne correspondent pas'; return; }
        try { await api.put(`/api/pages/${page.id}/lock`, { pin: p1.value, current_pin: cur.value, idle_min: Number(idle.value) }); m.close(); toast(editing ? 'Verrou modifié' : 'Page verrouillée'); await refreshTree(); after ? after() : showPage(page.id); }
        catch (x) { err.textContent = x.message; }
      } }, 'Enregistrer'))));
  setTimeout(() => (editing ? cur : p1).focus(), 50);
}
async function unlockRemove(page, after) {
  const pin = pinField('Code actuel'), err = h('div', { class: 'lock-err' });
  const m = modal('Retirer le verrou', h('div', { class: 'btn-dlg' }, h('p', { class: 'muted small' }, 'Saisissez le code actuel pour retirer la protection.'), pin, err,
    h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn danger', onclick: async () => { try { await api.post(`/api/pages/${page.id}/lock/remove`, { pin: pin.value }); m.close(); toast('Verrou retiré'); await refreshTree(); after ? after() : showPage(page.id); } catch (x) { err.textContent = x.message; } } }, 'Retirer le verrou'))));
  setTimeout(() => pin.focus(), 50);
}

// ---------- remplacer les liens par les documents (page courante uniquement) ----------
async function inlineDialog(page) {
  await flushSave();
  let links; try { links = (await api.post('/api/pages/' + page.id + '/inline-links', {})).links; } catch (e) { toast(e.message, 'error'); return; }
  if (!links.length) { toast('Aucun lien vers un document sur cette page'); return; }
  const kindLabel = { child_page: 'sous-page', link_to_page: 'lien de page' };
  const chosen = new Set(), groups = new Map();
  for (const l of links) { if (!groups.has(l.target)) groups.set(l.target, []); groups.get(l.target).push(l); }
  const where = (l) => l.in_page ? 'sous-page de cette page' : l.location != null ? 'situé dans « ' + (prettify(l.location) || 'Sans titre') + ' »' : 'à la racine';
  const checks = [];
  const rows = [...groups.values()].map((g, gi) => {
    const t = prettify(g[0].target_title) || 'Sans titre';
    if (g.length === 1) {
      const cb = h('input', { type: 'checkbox', onchange: () => { cb.checked ? chosen.add(g[0].cid) : chosen.delete(g[0].cid); } }); checks.push(cb);
      cb.dataset.id = g[0].cid;
      return h('div', { class: 'dup-group' }, h('label', {}, cb, h('span', {}, h('b', {}, t), ' — ' + (g[0].solo ? (kindLabel[g[0].kind] || 'mention') : 'mention dans « ' + (g[0].excerpt || '…') + ' »') + ', page ' + where(g[0]))));
    }
    return h('div', { class: 'dup-group' }, h('b', {}, t + ' — lié ' + g.length + ' fois : choisissez le lien qui devient la sous-page'),
      g.map((l, i) => h('label', {}, h('input', { type: 'radio', name: 'g' + gi, onchange: () => { g.forEach((x) => chosen.delete(x.cid)); chosen.add(l.cid); } }), 'Lien n° ' + (i + 1) + ' (' + (l.solo ? (kindLabel[l.kind] || 'mention') : 'mention dans « ' + (l.excerpt || '…') + ' »') + ') — la page ' + where(l))),
      h('label', {}, h('input', { type: 'radio', name: 'g' + gi, checked: true, onchange: () => g.forEach((x) => chosen.delete(x.cid)) }), 'Ne rien remplacer (tous restent des liens)'));
  });
  const body = h('div', { class: 'inl-body' },
    h('p', { class: 'small muted' }, 'Pour chaque lien coché, la sous-page réelle est déplacée de son emplacement d’origine sous cette page, et le lien devient cette sous-page (son contenu n’est pas copié). Elle n’existe plus à l’ancien emplacement. Seuls les liens de cette page sont concernés.'),
    h('button', { class: 'btn small', onclick: () => checks.forEach((c) => { c.checked = true; chosen.add(c.dataset.id); }) }, 'Tout cocher (liens uniques)'), rows);
  const m = modal('Remplacer des liens par les sous-pages', h('div', {}, body, h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler'),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!chosen.size) { toast('Aucun lien sélectionné'); return; }
      try {
        const r = await api.post('/api/pages/' + page.id + '/inline-links', { block_ids: [...chosen] });
        m.close(); toast(r.inlined + ' document' + (r.inlined > 1 ? 's' : '') + ' déplacé' + (r.inlined > 1 ? 's' : '') + ' dans la page');
        await refreshTree(); showPage(page.id);
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Remplacer la sélection'))), { wide: true });
}

/** Historique : liste des versions enregistrées, aperçu en lecture seule, restauration. */
async function historyDialog(page) {
  await flushSave();
  let list;
  try { list = await api.get(`/api/pages/${page.id}/versions`); } catch (e) { toast(e.message, 'error'); return; }
  const left = h('div', { class: 'hist-list' }), right = h('div', { class: 'hist-view' }, h('div', { class: 'muted pad' }, list.length ? 'Choisissez une version dans la liste pour l’afficher.' : ''));
  const m = modal('Historique des versions', h('div', { class: 'hist' }, left, right), { wide: true, onClose: () => ed?.destroy() });
  let ed = null, current = null;
  const drawList = () => left.replaceChildren(...(list.length ? list.map((v) => h('button', { class: `hist-item ${current === v.id ? 'on' : ''}`, onclick: () => show(v) },
    h('div', { class: 'hist-when' }, fmtDate(v.created_at)), h('div', { class: 'muted small' }, [v.user || 'Auteur inconnu', v.reason, `${v.n} bloc${v.n > 1 ? 's' : ''}`].filter(Boolean).join(' · ')),
    v.preview ? h('div', { class: 'hist-prev' }, v.preview) : null))
    : [h('div', { class: 'muted pad' }, 'Aucune version pour le moment. Une version est conservée à chaque enregistrement, au plus toutes les 5 minutes.')]));
  async function show(v) {
    current = v.id; drawList();
    right.replaceChildren(h('div', { class: 'muted pad' }, 'Chargement…'));
    try {
      const d = await api.get(`/api/pages/${page.id}/versions/${v.id}`);
      ed?.destroy();
      const host = h('div', { class: 'hist-doc' });
      right.replaceChildren(h('div', { class: 'hist-head' }, h('div', {}, h('b', {}, prettify(d.title) || 'Sans titre'), h('div', { class: 'muted small' }, `${fmtDate(d.created_at)} · ${d.user || 'auteur inconnu'}`)),
        h('button', { class: 'btn primary', onclick: restore }, vi('history', 16), 'Restaurer cette version')), host);
      ed = createEditor(host, { blocks: d.blocks, editable: false, hooks: { pageInfo } });
    } catch (e) { right.replaceChildren(h('div', { class: 'muted pad' }, e.message)); }
  }
  async function restore() {
    if (!current || !(await confirmBox('Restaurer cette version ? Le contenu actuel est d’abord conservé dans l’historique (« Avant restauration »).'))) return;
    try {
      await flushSave(); S.dirty = false;
      await api.post(`/api/pages/${page.id}/versions/${current}/restore`);
      ed?.destroy(); m.close(); toast('Version restaurée'); await refreshTree(); showPage(page.id);
    } catch (e) { toast(e.message, 'error'); }
  }
  drawList();
}

function pageMenu(anchor, page, role, editable) {
  document.querySelector('.ctx-menu')?.remove();
  const items = [];
  if (editable) {
    items.push({ label: page.icon ? 'Changer l’icône' : 'Ajouter une icône', icon: 'smile-plus', fn: async () => { const v = await pickIcon(page.icon); if (v === null) return; await api.patch(`/api/pages/${page.id}`, { icon: v || null }); await refreshTree(); showPage(page.id); } });
    items.push({ label: page.cover ? 'Changer la couverture' : 'Ajouter une couverture', icon: 'image-plus', fn: () => coverDialog(page) });
  }
  if (editable && S.settings.dev_mode === '1' && S.pageMap?.get(page.parent_id)?.kind === 'database') {
    items.push({ label: 'Marquer comme à mettre à jour', icon: 'refresh-cw', fn: async () => { try { await api.post(`/api/pages/${page.id}/modernize/unmark`); toast('Carte marquée « à mettre à jour »'); showPage(page.id); } catch (e) { toast(e.message, 'error'); } } });
    items.push({ label: 'Définir comme architecture de référence', icon: 'layout-template', fn: async () => {
      if (!await confirmBox('Utiliser la structure de cette page (titres, blocs déroulants, séparateurs, boutons) comme modèle pour « Mettre à jour cette page » sur toutes les anciennes pages de cette base ?', 'Définir')) return;
      try { const r = await api.post(`/api/pages/${page.id}/arch-reference`); toast(`Architecture de référence enregistrée (${r.kept} blocs de structure)`); } catch (e) { toast(e.message, 'error'); }
    } });
  }
  if (role === 'owner' || editable) items.push({ label: 'Aperçu invité (lecture seule)', icon: 'eye', fn: () => { S.guest = page.id; document.body.classList.add('guest-preview'); return showPage(page.id); } });
  if (page.kind === 'page' && !S.token) items.push({ label: 'Exporter en PDF…', icon: 'download', fn: async () => {
    const subs = [...(S.pageMap?.values() || [])].filter((x) => x.parent_id === page.id && x.kind === 'page' && !x.archived && !x.locked).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((x) => ({ id: x.id, title: x.title }));
    (await import('./pdfexport.js')).exportPdfDialog(page, { pageInfo, subpages: subs, school: !!S.pageMap?.get(page.parent_id) && S.pageMap.get(page.parent_id).kind === 'database' });
  } });
  if (editable) {
    items.push({ label: 'Dupliquer', icon: 'copy', fn: () => duplicatePage(page) });
    items.push({ label: 'Déplacer vers…', icon: 'arrow-right', fn: () => movePageDialog(page) });
  }
  if (role === 'owner' && !S.token) {
    const own = S.pageMap?.get(page.id)?.locked;
    if (!own) items.push({ label: 'Verrouiller avec un code…', icon: 'lock', fn: () => lockDialog(page, false) });
    else items.push({ label: 'Modifier le code ou la durée…', icon: 'lock', fn: () => lockDialog(page, true) }, { label: 'Retirer le verrou…', icon: 'lock-open', fn: () => unlockRemove(page) });
  }
  if (!S.token && S.lockInfo?.pageId === page.id && (S.lockInfo.own || S.lockInfo.inherited)) items.push({ label: 'Verrouiller maintenant', icon: 'lock', fn: async () => { await api.post(`/api/pages/${page.id}/lock/now`); showPage(page.id); } });
  if (editable && page.kind === 'page' && S.settings.dev_mode === '1') items.push({ label: 'Remplacer des liens par les sous-pages…', icon: 'link-2', fn: () => inlineDialog(page) });
  if (!S.token) items.push({ label: isFav(page.id) ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: 'star', fn: () => toggleFav(page) });
  if (editable && page.kind === 'page') items.push({ label: 'Historique des versions', icon: 'history', fn: () => historyDialog(page) });
  items.push({ label: store.get('dw_wide', false) ? 'Largeur normale' : 'Pleine largeur', icon: 'arrow-up-down', fn: () => { store.set('dw_wide', !store.get('dw_wide', false)); return showPage(page.id); } });
  if (role === 'owner' || editable) items.push({ label: 'Mettre à la corbeille', icon: 'trash-2', danger: true, fn: async () => { await api.del(`/api/pages/${page.id}`); await refreshTree(); location.hash = page.parent_id ? `#/page/${page.parent_id}` : '#/'; } });
  const menu = h('div', { class: 'ctx-menu' }, items.map((it) => h('button', { class: it.danger ? 'danger' : '',
    // Promise.resolve().then(fn) : fonctionne que l'action soit synchrone ou asynchrone, et remonte toute erreur
    onclick: () => { menu.remove(); Promise.resolve().then(it.fn).catch((e) => toast(e.message, 'error')); } }, vi(it.icon, 16), it.label)));
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`; menu.style.right = `${innerWidth - r.right}px`;
  document.body.append(menu);
  autoClose(menu);
}

// ================= partage =================
async function shareDialog(page) {
  const body = h('div', { class: 'share' });
  const m = modal(`Partager « ${page.title || 'Sans titre'} »`, body, { wide: true });
  const draw = async () => {
    const shares = await api.get(`/api/pages/${page.id}/shares`);
    const pub = shares.find((s) => s.public_token);
    const email = h('input', { class: 'input', type: 'email', placeholder: 'E-mail d’un utilisateur Deepwell' });
    const role = h('select', { class: 'input narrow' }, [['view', 'Lecture seule'], ['comment', 'Peut commenter'], ['edit', 'Peut éditer']].map(([v, l]) => h('option', { value: v }, l)));
    const link = pub ? `${location.origin}/#/public/${pub.public_token}` : '';
    body.replaceChildren(
      h('div', { class: 'share-row' }, email, role, h('button', { class: 'btn primary', onclick: async () => { try { await api.post(`/api/pages/${page.id}/shares`, { email: email.value, role: role.value }); draw(); } catch (e) { toast(e.message, 'error'); } } }, 'Inviter')),
      h('div', { class: 'share-list' }, shares.filter((s) => !s.public_token).map((s) => h('div', { class: 'share-item' }, h('span', {}, s.name || s.email, h('small', { class: 'muted' }, ` ${s.email}`)), h('span', { class: 'tag' }, { edit: 'Édition', comment: 'Commentaire' }[s.role] || 'Lecture'),
        h('button', { class: 'icon-btn', onclick: async () => { await api.del(`/api/pages/${page.id}/shares/${s.id}`); draw(); } }, '✕'))), shares.every((s) => s.public_token) ? h('div', { class: 'muted pad' }, 'Page privée : seuls vous et les personnes invitées y ont accès.') : null),
      h('hr'), h('div', { class: 'share-pub' }, h('div', {}, h('b', {}, 'Lien public'), h('div', { class: 'muted small' }, 'Toute personne disposant du lien peut lire cette page et ses sous-pages, sans compte.')),
        pub ? h('div', { class: 'share-row' }, h('input', { class: 'input', readonly: true, value: link, onclick: (e) => e.target.select() }),
          h('button', { class: 'btn', onclick: async () => { await navigator.clipboard?.writeText(link).catch(() => {}); toast('Lien copié'); } }, 'Copier'),
          h('button', { class: 'btn danger', onclick: async () => { await api.del(`/api/pages/${page.id}/shares/${pub.id}`); draw(); } }, 'Désactiver'))
          : h('button', { class: 'btn', onclick: async () => { await api.post(`/api/pages/${page.id}/shares`, { public: true }); draw(); } }, 'Créer un lien public')));
  };
  draw().catch((e) => { toast(e.message, 'error'); m.close(); });
}

// ================= Google Drive =================
async function pickDriveFile() {
  const st = await api.get('/api/drive/status');
  if (!st.connected) { toast(st.configured ? 'Connectez Google Drive dans Réglages → Google Drive' : 'Google Drive n’est pas configuré sur le serveur', 'error'); return null; }
  return new Promise((resolve) => {
    let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); m.close(); } };
    const list = h('div', { class: 'results' }), input = h('input', { class: 'input big', placeholder: 'Rechercher dans votre Drive…' });
    const load = async () => { list.replaceChildren(h('div', { class: 'muted pad' }, 'Chargement…')); try { const r = await api.get(`/api/drive/files?q=${encodeURIComponent(input.value)}`); list.replaceChildren(...(r.files.length ? r.files.map((f) => h('a', { class: 'result', href: '#', onclick: (e) => { e.preventDefault(); finish(f); } }, h('b', {}, f.name), h('small', {}, f.mimeType))) : [h('div', { class: 'muted pad' }, 'Aucun fichier')])); } catch (e) { list.replaceChildren(h('div', { class: 'form-err pad' }, e.message)); } };
    let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
    const m = modal('Google Drive', h('div', {}, input, list), { onClose: () => { if (!done) { done = true; resolve(null); } } });
    load();
  });
}

// ================= corbeille =================
async function showTrash() {
  await refreshTree(); S.current = null; drawSidebar();
  const trashed = S.tree.pages.filter((p) => p.archived);
  const byId = new Map(S.tree.pages.map((p) => [p.id, p]));
  const top = trashed.filter((p) => !byId.get(p.parent_id)?.archived);
  mainEl.replaceChildren(topbar([{ title: 'Corbeille' }]), h('div', { class: 'scroll' }, h('div', { class: 'page' }, h('h1', { class: 'title static' }, '🗑 Corbeille'),
    top.length ? top.map((p) => h('div', { class: 'trash-item' }, h('span', { class: 'trash-name' }, pageIcon(p), ' ', prettify(p.title) || 'Sans titre'),
      h('button', { class: 'btn small', onclick: async () => { await api.patch(`/api/pages/${p.id}`, { archived: false }); await showTrash(); } }, 'Restaurer'),
      h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox(`Supprimer définitivement « ${p.title || 'Sans titre'} » et ses sous-pages ? Action irréversible.`)) { await api.del(`/api/pages/${p.id}?permanent=1`); await showTrash(); } } }, 'Supprimer'))) : h('div', { class: 'muted' }, 'La corbeille est vide. A.D.O. : aucun document obsolète.'))));
}

// ================= notes de version =================
const releasesUnseen = () => { try { return !!S.me && localStorage.getItem('dw_seen_version') !== S.settings.version; } catch { return false; } };
async function showReleases() {
  S.current = null;
  const panel = h('div', { class: 'rel-list' }, h('p', { class: 'muted' }, 'Chargement…'));
  mainEl.replaceChildren(topbar([{ title: 'Notes de version' }]), h('div', { class: 'scroll' }, h('div', { class: 'page settings' }, h('h1', { class: 'title static' }, 'Notes de version'), panel)));
  try {
    const { renderReleases } = await import('./releases.js'); // chargée à la demande
    await renderReleases(panel);
    try { localStorage.setItem('dw_seen_version', S.settings.version); } catch { /* stockage indisponible : la pastille reste */ }
  } catch (e) { panel.replaceChildren(h('div', { class: 'form-err' }, e.message)); }
  drawSidebar();
}

// ================= réglages =================
const TABS = [['dev', 'Développeur'], ['profile', 'Profil'], ['datetime', 'Date et heure'], ['appearance', 'Apparence'], ['drive', 'Google Drive'], ['import', 'Import Notion'], ['backup', 'Sauvegardes'], ['server', 'Serveur'], ['pi', 'π'], ['activity', 'Connexions'], ['users', 'Utilisateurs']];
const ADMIN_TABS = ['backup', 'users', 'dev', 'activity', 'server'];
async function showSettings(tab) {
  S.current = null; drawSidebar();
  const isAdmin = S.me.role === 'admin';
  const panel = h('div', { class: 'settings-panel' });
  mainEl.replaceChildren(topbar([{ title: 'Réglages' }]), h('div', { class: 'scroll' }, h('div', { class: 'page settings' },
    h('h1', { class: 'title static' }, '⚙ Réglages'),
    h('div', { class: 'tabs' }, TABS.filter(([k]) => isAdmin || !ADMIN_TABS.includes(k)).map(([k, l]) => h('a', { href: `#/settings/${k}`, class: k === tab ? 'on' : '' }, l))), panel)));
  const fn = { profile: tabProfile, datetime: tabDatetime, appearance: tabAppearance, drive: tabDrive, import: tabImport, backup: tabBackup, activity: tabActivity, users: tabUsers, dev: tabDev,
    server: async (p) => (await import('./serverstatus.js')).tabServer(p, { section }), pi: async (p) => (await import('./pigame.js')).tabPi(p, { section }) }[tab] || tabProfile;
  if (ADMIN_TABS.includes(tab) && !isAdmin) return panel.append(h('p', {}, 'Réservé aux administrateurs.'));
  try { await fn(panel); } catch (e) { panel.append(h('div', { class: 'form-err' }, e.message)); }
}
const field = (label, input, help) => h('label', { class: 'field' }, h('span', {}, label), input, help ? h('small', { class: 'muted' }, help) : null);
const section = (title, help, ...kids) => h('section', { class: 'set-section' }, h('h3', {}, title), help ? h('p', { class: 'muted set-help' }, help) : null, ...kids);

async function tabProfile(p) {
  const name = h('input', { class: 'input', value: S.me.name || '' }), cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' }), pw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  p.append(
    section('Compte', 'Votre nom apparaît dans les commentaires, les mentions et le partage.',
      field('Adresse e-mail', h('input', { class: 'input', value: S.me.email, disabled: true }), 'Identifiant de connexion (non modifiable ici).'), field('Nom affiché', name),
      h('button', { class: 'btn primary', onclick: async () => { const r = await api.put('/api/auth/me', { name: name.value }); S.me = r.user; drawSidebar(); toast('Profil enregistré'); } }, 'Enregistrer')),
    section('Mot de passe', 'Vous serez déconnecté des autres appareils après le changement.',
      field('Mot de passe actuel', cur), field('Nouveau mot de passe', pw, '8 caractères minimum.'),
      h('button', { class: 'btn', onclick: async () => { try { await api.put('/api/auth/me', { currentPassword: cur.value, password: pw.value }); cur.value = pw.value = ''; toast('Mot de passe modifié'); } catch (e) { toast(e.message, 'error'); } } }, 'Modifier le mot de passe')),
    section('Mes données', 'Export JSON complet de toutes vos pages et blocs (format interne, sans perte). Pour une sauvegarde de tout le serveur, voir l’onglet Sauvegardes.',
      h('a', { class: 'btn', href: '/api/export' }, 'Télécharger mon export JSON')),
    section('Apparence', 'Le thème, la taille du texte et la largeur des pages se règlent dans l’onglet Apparence.', h('a', { class: 'btn', href: '#/settings/appearance' }, 'Ouvrir Apparence')));
}

async function tabDatetime(p) {
  const prefs = getPrefs();
  const sel = (opts, cur) => h('select', { class: 'input' }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
  const tz = sel([['auto', `Automatique — fuseau de cet appareil (${deviceTz()})`], ...allTimezones().map((z) => [z, z.replace(/_/g, ' ')])], prefs.tz);
  const df = sel([['long', 'Long : 26 août 2026'], ['short', 'Court : 26/08/2026'], ['iso', 'ISO : 2026-08-26'], ['relative', 'Relatif : Aujourd’hui, Demain, Hier…']], prefs.dateFmt);
  const tf = sel([['24', '24 heures (19:25)'], ['12', '12 heures (7:25 PM)']], prefs.timeFmt);
  const preview = h('div', { class: 'date-preview' });
  const draw = () => preview.replaceChildren(
    h('div', {}, h('b', {}, 'Maintenant : '), formatDate({ start: new Date().toISOString() })),
    h('div', {}, h('b', {}, 'Une date Notion « 2026-08-26T19:25:00.000+02:00 » : '), formatDate('2026-08-26T19:25:00.000+02:00')),
    h('div', {}, h('b', {}, 'Une date sans heure « 2026-08-26 » : '), formatDate('2026-08-26'), h('small', { class: 'muted' }, ' (jamais décalée)')));
  const save = () => { setPrefs({ tz: tz.value, dateFmt: df.value, timeFmt: tf.value }); draw(); toast('Préférences de date enregistrées'); };
  [tz, df, tf].forEach((s) => s.addEventListener('change', save));
  p.append(h('p', { class: 'muted' }, 'Les dates sont stockées de façon universelle (avec leur décalage horaire) et affichées ici dans le fuseau horaire et le format de votre choix : mentions de dates, propriétés de bases de données, titres importés de Notion. Ces préférences sont propres à cet appareil.'),
    field('Fuseau horaire', tz), field('Format de date', df), field('Format de l’heure', tf), h('h3', {}, 'Aperçu'), preview);
  draw();
}

async function tabAppearance(p) {
  const s = S.settings, admin = S.me.role === 'admin';
  const sel = (opts, cur) => h('select', { class: 'input' }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cur) }, l)));

  // ----- Mon affichage : propre à cet appareil, chaque utilisateur choisit -----
  const theme = sel([['auto', 'Automatique (suit votre appareil)'], ['light', 'Clair'], ['dark', 'Sombre'], ['black', 'Noir profond']], store.get('dw_theme', 'auto')); theme.onchange = () => { store.set('dw_theme', theme.value); applyTheme(); };
  const mySize = sel([['', 'Valeur du site'], ['15', 'Petit — 15 px'], ['16', 'Normal — 16 px (taille de Notion)'], ['17', 'Grand — 17 px'], ['19', 'Très grand — 19 px']], store.get('dw_text_size', '') || '');
  mySize.onchange = () => { store.set('dw_text_size', mySize.value || null); applySettings({}); };
  const wide = h('input', { type: 'checkbox' }); wide.checked = store.get('dw_wide', false); wide.onchange = () => store.set('dw_wide', wide.checked);
  const ctxMode = sel([['deepwell', 'Menu de Deepwell (Maj + clic droit : menu du navigateur)'], ['native', 'Toujours le menu du navigateur (orthographe)']], store.get('dw_ctx_mode', 'deepwell'));
  ctxMode.onchange = () => store.set('dw_ctx_mode', ctxMode.value);
  const phone = sel([['auto', 'Automatique (écran étroit ou tactile)'], ['on', 'Toujours activé'], ['off', 'Désactivé']], store.get('dw_phone', 'auto'));
  phone.onchange = () => { store.set('dw_phone', phone.value); applyPhoneMode(); };
  p.append(section('Mon affichage', 'Ces choix ne concernent que vous, sur cet appareil.',
    field('Mode téléphone', phone, 'Panneau latéral qui se glisse par-dessus, boutons plus grands, menus en bas de l’écran, texte lisible sans zoom.'),
    field('Thème', theme, 'Clair, sombre ou automatique.'), field('Taille du texte', mySize, 'Taille du texte des pages et de l’interface. « Valeur du site » reprend le réglage de l’administrateur.'),
    h('label', { class: 'check' }, wide, 'Afficher les pages en pleine largeur (ignore la « largeur de la colonne de texte »)'),
    field('Clic droit dans les pages', ctxMode, 'Sur un bloc, le clic droit ouvre le menu du bloc (couleur, déplacer, dupliquer, supprimer…). Le menu du navigateur reste accessible avec Maj + clic droit, et sur du texte sélectionné.')));

  if (!admin) { p.append(section('Apparence du site', null, h('p', { class: 'muted' }, 'L’apparence générale du site (couleurs, police, séparateurs…) est réglée par l’administrateur.'))); return; }

  // ----- Apparence du site : administrateur, pour tous les utilisateurs -----
  let favicon = s.favicon || '';
  const favPreview = h('span', { class: 'fav-preview' });
  const drawFav = () => { favPreview.replaceChildren(favicon ? iconNode(favicon, 28) : h('span', { class: 'muted small' }, 'Icône par défaut')); };
  drawFav();
  let divider = s.divider_color || '';
  const dividerInput = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(divider) ? divider : '#d9d8d6' });
  const dividerState = h('span', { class: 'muted small' }, divider ? divider : 'Couleur par défaut du thème');
  dividerInput.oninput = () => { divider = dividerInput.value; dividerState.textContent = divider; live(); };
  const inputs = {
    site_name: h('input', { class: 'input', value: s.site_name || '', placeholder: 'Deepwell' }),
    accent: h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#2383e2' }),
    font: sel([['', 'Notion (police système moderne)'], ['system', 'Sans-serif classique'], ['serif', 'Serif (empattements)'], ['mono', 'Monospace']], s.font || ''),
    text_size: sel([['', 'Normal — 17 px (défaut)'], ['15', 'Petit — 15 px'], ['16', 'Notion — 16 px'], ['17', 'Grand — 17 px'], ['19', 'Très grand — 19 px']], s.text_size || ''),
    content_width: h('input', { class: 'input', type: 'number', min: 480, max: 1800, step: 10, value: s.content_width || 708 }),
    radius: h('input', { type: 'range', min: 0, max: 16, value: s.radius || 4 }),
    default_theme: sel([['auto', 'Automatique (suit l’appareil)'], ['light', 'Clair'], ['dark', 'Sombre'], ['black', 'Noir profond']], s.default_theme || 'auto'),
    custom_css: h('textarea', { class: 'input code', rows: 10, spellcheck: false, placeholder: '/* Exemple */\n:root { --accent: #e11d48; }\n.block.t-heading_1 .txt { font-family: var(--font-serif); }' }, s.custom_css || ''),
  };
  const values = () => ({ ...Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, String(el.value)])), divider_color: divider, favicon });
  const live = () => applySettings(values());
  Object.values(inputs).forEach((el) => el.addEventListener('input', live));
  p.append(
    section('Identité', null, field('Icône du site (favicon)', h('div', { class: 'share-row' }, favPreview,
        h('button', { class: 'btn', onclick: async () => { const v = await pickIcon(favicon); if (v === null) return; favicon = v; drawFav(); applySettings({ favicon }); } }, 'Choisir une icône ou une image…'),
        favicon ? h('button', { class: 'btn small', onclick: () => { favicon = ''; drawFav(); applySettings({ favicon }); } }, 'Rétablir') : null),
        'Petite image de l’onglet du navigateur. Icône vectorielle (avec couleur), emoji ou image importée (PNG, SVG…).'),
      field('Nom du site', inputs.site_name, 'Affiché en haut du panneau latéral, sur la page de connexion et dans l’onglet du navigateur.'),
      field('Couleur d’accent', inputs.accent, 'Boutons principaux, liens actifs, sélection et focus.')),
    section('Texte', null, field('Police du site', inputs.font, 'Police de l’interface et des pages. On peut aussi changer la police d’un bloc ou d’un passage dans l’éditeur.'),
      field('Taille du texte par défaut', inputs.text_size, 'Taille de base appliquée à tout le monde. Chacun peut choisir la sienne dans « Mon affichage ».')),
    section('Mise en page', null, field('Largeur de la colonne de texte (px)', inputs.content_width, '708 px = largeur de Notion. Sans effet pour les pages en pleine largeur.'),
      field('Arrondi des angles (px)', inputs.radius, '0 = angles droits, 16 = très arrondis (boutons, champs, cartes).')),
    section('Séparateurs', 'Les séparateurs sont les lignes horizontales que l’on insère avec « --- » ou la commande /séparateur.',
      field('Couleur par défaut', h('div', { class: 'share-row' }, dividerInput, dividerState, h('button', { class: 'btn small', onclick: () => { divider = ''; dividerState.textContent = 'Couleur par défaut du thème'; live(); } }, 'Rétablir')),
        'S’applique à tous les séparateurs. Pour colorer UN séparateur en particulier : cliquez sur la poignée ⋮⋮ à sa gauche → « Couleur du séparateur ».')),
    section('Thème', null, field('Thème par défaut', inputs.default_theme, 'Thème des nouveaux appareils. Chaque utilisateur peut ensuite choisir le sien dans « Mon affichage ».')),
    section('Avancé', null, field('CSS personnalisé', inputs.custom_css, 'Appliqué à tout le site pour tous les utilisateurs. Variables utiles : --accent, --bg, --fg, --muted, --border, --hover, --sidebar-bg, --divider-color, --radius, --font, --text-size, --content-width. Classes de blocs : .block.t-heading_1, .t-quote, .t-callout…')),
    h('div', { class: 'share-row' }, h('button', { class: 'btn primary', onclick: async () => { await api.put('/api/settings', values()); toast('Apparence enregistrée pour tout le site'); } }, 'Enregistrer pour tout le site'),
      h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Rétablir l’apparence par défaut (celle de Notion) pour tout le site ?')) { await api.put('/api/settings', { site_name: '', accent: '', font: '', text_size: '', content_width: '', radius: '', default_theme: '', divider_color: '', favicon: '', custom_css: '' }); applySettings({ site_name: '', accent: '', font: '', text_size: '', content_width: '', radius: '', default_theme: '', divider_color: '', favicon: '', custom_css: '' }); showSettings('appearance'); } } }, 'Rétablir les valeurs par défaut')));
}

async function tabDrive(p) {
  const st = await api.get('/api/drive/status'), admin = S.me.role === 'admin';
  p.append(h('p', { class: 'muted' }, 'Reliez votre compte Google pour insérer des fichiers Drive dans vos pages (commande /drive), envoyer les éléments datés d’une base vers Google Agenda (Réglages de la base) et, côté administrateur, envoyer les sauvegardes vers votre Drive.'));
  if (!st.configured) {
    p.append(h('div', { class: 'banner' }, h('b', {}, 'Non configuré sur le serveur.'), h('ol', {},
      h('li', {}, 'Console Google Cloud → API et services → activer « Google Drive API » et « Google Calendar API ».'),
      h('li', {}, 'Identifiants → créer un « ID client OAuth » (application Web).'),
      h('li', {}, `URI de redirection autorisé : ${st.redirect}`),
      h('li', {}, 'Définir GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et PUBLIC_URL dans l’environnement du serveur, puis redémarrer.'))));
    if (admin) await pdmSection(p);
    return;
  }
  if (st.connected) {
    p.append(h('p', {}, '✅ Connecté', st.email ? ` : ${st.email}` : ''), st.calendar ? h('p', {}, '✅ Google Agenda autorisé') : h('div', { class: 'banner' }, h('p', {}, 'Google Agenda n’est pas encore autorisé pour ce compte (connexion faite avant son ajout).'), h('button', { class: 'btn primary', onclick: async () => { const r = await api.post('/api/drive/connect'); location.href = r.url; } }, 'Autoriser Google Agenda')), h('button', { class: 'btn danger', onclick: async () => { await api.post('/api/drive/disconnect'); showSettings('drive'); } }, 'Déconnecter'));
    if (admin) { const s = await api.get('/api/admin/settings'); p.append(h('hr'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.backup_to_drive === '1', onchange: async (e) => { await api.put('/api/settings', { backup_to_drive: e.target.checked ? '1' : '0' }); } }), 'Envoyer automatiquement chaque sauvegarde vers Google Drive (dossier « Deepwell Backups »)')); }
  } else p.append(h('button', { class: 'btn primary', onclick: async () => { const r = await api.post('/api/drive/connect'); location.href = r.url; } }, 'Connecter Google (Drive et Agenda)'));
  if (admin) await pdmSection(p);
}

/** PDM (éditeur de PDF) : adresse + clé secrète affichée sur l'accueil de PDM (« Lier à DeepWell »). Réservé à l'administrateur. */
async function pdmSection(p) {
  const cfg = await api.get('/api/pdm/config');
  const url = h('input', { class: 'input', value: cfg.url || 'https://pdm.louisharicuisine.com', placeholder: 'https://pdm.louisharicuisine.com' });
  const key = h('input', { class: 'input', type: 'password', placeholder: cfg.configured ? '•••••• (clé enregistrée : laisse vide pour la garder)' : 'Clé affichée par PDM', autocomplete: 'off' });
  const state = h('p', { class: cfg.configured ? '' : 'muted' }, cfg.configured ? `✅ Lié à PDM : ${cfg.url}` : 'PDM n’est pas encore lié.');
  p.append(h('hr'), h('h3', {}, 'PDM (éditeur de PDF)'),
    h('p', { class: 'muted' }, 'Pour que le PDF de référence de chaque cours soit déposé automatiquement dans PDM : ouvre PDM, déroule « Lier à DeepWell » sur l’accueil, clique « Afficher la clé », puis recopie-la ici. Active ensuite l’option « Intégration de l’éditeur de PDF » dans les réglages de ta base (mode scolaire).'),
    state, h('label', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, 'Adresse de PDM'), url), h('label', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, 'Clé secrète'), key),
    h('div', { class: 'share-row' },
      h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; try { const r = await api.put('/api/pdm/config', { url: url.value, key: key.value }); key.value = ''; state.textContent = `✅ Lié à PDM : ${r.url}`; state.className = ''; toast('PDM lié : connexion vérifiée'); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; } }, 'Vérifier et enregistrer'),
      cfg.configured ? h('button', { class: 'btn danger', onclick: async () => { if (!(await confirmBox('Délier PDM ? Les documents déjà déposés restent dans PDM.'))) return; await api.del('/api/pdm/config'); state.textContent = 'PDM n’est pas encore lié.'; state.className = 'muted'; } }, 'Délier') : null));
}

async function tabImport(p) {
  const log = h('pre', { class: 'log', hidden: true }), stat = h('div', { class: 'import-stat' });
  const follow = async (id) => {
    log.hidden = false;
    for (;;) {
      const j = await api.get(`/api/import/${id}`);
      log.textContent = j.log.join('\n'); log.scrollTop = log.scrollHeight;
      const c = j.counts;
      stat.textContent = `${j.status === 'running' ? '⏳ En cours' : j.status === 'done' ? '✅ Terminé' : '❌ Erreur'} — ${c.pages} pages, ${c.databases} bases, ${c.blocks} blocs, ${c.files} fichiers, ${c.warnings} avertissement(s)${j.progress ? ` (${j.progress.done}/${j.progress.total})` : ''}`;
      if (j.status !== 'running') {
        if (j.error) toast(j.error, 'error');
        if (j.missing?.length) stat.append(h('div', { class: 'banner' }, h('b', {}, `${c.missing} page(s) référencée(s) mais inaccessible(s) à l’intégration :`), h('ul', {}, j.missing.slice(0, 40).map((t) => h('li', {}, prettify(t)))),
          h('p', { class: 'small' }, 'Dans Notion : ouvrez chaque page (ou sa page parente) → ••• → Connexions → ajoutez votre intégration. Puis relancez l’import : seul le complément est ajouté, sans doublons, et les liens se réparent.')));
        await refreshTree(); return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  const token = h('input', { class: 'input', type: 'password', placeholder: 'secret_… ou ntn_…', autocomplete: 'off' });
  const overwrite = h('input', { type: 'checkbox' });
  const startImport = async () => {
    if (!token.value.trim()) return;
    if (overwrite.checked) {
      const n = S.tree.pages.filter((p) => p.imported).length;
      const ok = await confirmBox(`Écraser : les ${n} page(s) déjà importées de Notion vont être SUPPRIMÉES, avec tout ce qui se trouve dessous (sous-pages ajoutées ici, partages, liens publics, modifications), puis réimportées à neuf depuis Notion. Une sauvegarde de sécurité est créée juste avant. Continuer ?`);
      if (!ok) return;
    }
    try { const { id } = await api.post('/api/import/notion', { token: token.value.trim(), overwrite: overwrite.checked }); token.value = ''; await follow(id); }
    catch (e) { toast(e.message, 'error'); }
  };
  const zip = h('input', { type: 'file', accept: '.zip' });
  p.append(
    h('h3', {}, '1. Import via l’API Notion — recommandé (fidélité maximale)'),
    h('p', { class: 'muted' }, 'Conserve tous les blocs au format natif (mise en forme, couleurs, mentions, toggles, colonnes, tableaux, callouts, équations…), les bases de données avec leurs types de propriétés, les fichiers (téléchargés ici), les icônes/couvertures, la hiérarchie et les liens internes. Rejouable sans doublons.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Sur notion.so/my-integrations : « Nouvelle intégration » (interne), cochez Lire le contenu et Lire les commentaires.'),
      h('li', {}, 'Copiez le « Jeton d’intégration interne ».'),
      h('li', {}, 'Dans Notion, pour chaque page racine à migrer : ••• → Connexions → ajoutez votre intégration (les sous-pages suivent).'),
      h('li', {}, 'Collez le jeton ci-dessous.')),
    h('div', { class: 'share-row' }, token, h('button', { class: 'btn primary', onclick: startImport }, 'Lancer l’import')),
    h('label', { class: 'check overwrite' }, overwrite, h('span', {}, h('b', {}, 'Écraser'), ' : supprimer d’abord les pages déjà importées de Notion, puis tout réimporter à neuf (au lieu de fusionner). Une sauvegarde de sécurité est créée avant.')),
    h('small', { class: 'muted' }, 'Le jeton n’est utilisé que pendant l’import et n’est jamais enregistré.'),
    h('details', { class: 'limits' }, h('summary', {}, 'Ce que l’API Notion ne permet pas de récupérer'), h('ul', {},
      h('li', {}, 'Les vues de bases de données (filtres, tris, vues galerie/calendrier/board) : seules les données et le schéma sont exposés ; la vue tableau complète est recréée ici.'),
      h('li', {}, 'L’historique des versions, les permissions et membres de l’espace Notion, les automatisations/boutons, les modèles de base.'),
      h('li', {}, 'Les blocs que Notion déclare « unsupported » sont conservés en brut mais non affichables.'),
      h('li', {}, 'Les formules/rollups sont importés avec leur dernière valeur calculée (non recalculés).'))),
    h('hr'),
    h('h3', {}, '2. Import du ZIP d’export Notion (Markdown & CSV)'),
    h('p', { class: 'muted' }, 'Sans jeton : Notion → Paramètres → Exporter tout le contenu → « Markdown & CSV » (incluez les sous-pages). Plus simple mais moins fidèle : l’export Notion lui-même perd les types exacts de propriétés, les couleurs, les mentions et les vues.'),
    h('div', { class: 'share-row' }, zip, h('button', { class: 'btn', onclick: async () => { if (!zip.files[0]) return; try { const { id } = await api.importZip(zip.files[0]); await follow(id); } catch (e) { toast(e.message, 'error'); } } }, 'Importer le ZIP')),
    stat, log);
}

async function tabDev(p) {
  p.replaceChildren(
    section('Mode développeur', 'Réservé aux administrateurs. Désactivé par défaut.',
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.settings.dev_mode === '1', onchange: async (e) => { try { await api.put('/api/settings', { dev_mode: e.target.checked ? '1' : '0' }); S.settings.dev_mode = e.target.checked ? '1' : '0'; toast(e.target.checked ? 'Mode développeur activé' : 'Mode développeur désactivé'); } catch (x) { e.target.checked = !e.target.checked; toast(x.message, 'error'); } } }),
        'Permettre de modifier la date d’ajout d’origine des commentaires (dans le panneau des commentaires, par l’auteur ou le propriétaire de la page). Désactivé : la date ne peut être modifiée par personne, même via l’API.')));
}

async function tabBackup(p) {
  const draw = async () => {
    const [list, st] = await Promise.all([api.get('/api/admin/backups'), api.get('/api/admin/settings')]);
    const drive = await api.get('/api/drive/status');
    p.replaceChildren(
      h('p', { class: 'muted' }, 'Instantané cohérent de la base (à chaud) + copie incrémentale des fichiers téléversés. Planification automatique ; les 14 derniers instantanés sont conservés.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.backup_enabled === '1', onchange: async (e) => { await api.put('/api/settings', { backup_enabled: e.target.checked ? '1' : '0' }); } }), 'Sauvegarde automatique quotidienne'),
      h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; try { await api.post('/api/admin/backups'); toast('Sauvegarde créée — Bravo Zulu'); } catch (x) { toast(x.message, 'error'); } draw(); } }, 'Sauvegarder maintenant'),
      h('table', { class: 'plain' }, h('tbody', {}, list.length ? list.map((b) => h('tr', {}, h('td', {}, fmtDate(b.created_at)), h('td', {}, fmtSize(b.size)),
        h('td', {}, h('a', { class: 'btn small', href: `/api/admin/backups/${b.name}` }, 'Télécharger'), ' ',
          drive.connected ? h('button', { class: 'btn small', onclick: async (e) => { e.target.disabled = true; try { await api.post(`/api/admin/backups/${b.name}/drive`); toast('Envoyé sur Google Drive'); } catch (x) { toast(x.message, 'error'); } e.target.disabled = false; } }, '→ Drive') : null))) : h('tr', {}, h('td', { class: 'muted' }, 'Aucune sauvegarde')))),
      h('details', { class: 'limits' }, h('summary', {}, 'Comment restaurer'), h('p', {}, 'Arrêtez le serveur, puis :'), h('pre', { class: 'log' }, 'npm run restore -- data/backups/deepwell-AAAA-MM-JJT….db.gz'), h('p', { class: 'muted' }, 'Les fichiers téléversés sont déjà dans data/uploads ; leur copie de secours est dans data/backups/uploads.')));
  };
  await draw();
}

const fmtDur = (sec) => { sec = Math.round(sec || 0); if (sec < 60) return `${sec} s`; const m = Math.floor(sec / 60); if (m < 60) return `${m} min ${String(sec % 60).padStart(2, '0')} s`; return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const fmtDT = (t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
async function tabActivity(p) {
  let kind = '', days = 30;
  const draw = async () => {
    const q = `?days=${days}${kind ? `&kind=${kind}` : ''}`;
    const [sessions, log, vis] = await Promise.all([api.get('/api/admin/activity/sessions'), api.get('/api/admin/activity/log'), api.get(`/api/admin/activity/visits${q}`)]);
    const sel = (opts, cur, fn) => h('select', { class: 'input', onchange: (e) => fn(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cur) }, l)));
    const who = (v) => v.actor === 'link' ? h('span', {}, h('span', { class: 'rel-tag' }, 'Lien public'), ` ${v.ip || ''}`) : (v.user_name || v.user_email || 'Compte');
    const KIND = { login: 'Connexion', login_fail: 'Échec de connexion', logout: 'Déconnexion', register: 'Création de compte' };
    p.replaceChildren(
      section('Appareils connectés', 'Les sessions ouvertes (connexion de 90 jours si « Rester connecté » est coché, 30 jours sinon ; chaque visite la renouvelle). Retirer un appareil le déconnecte immédiatement.',
        h('table', { class: 'plain' }, h('tbody', {}, sessions.map((s) => h('tr', {}, h('td', {}, s.name || s.email, s.current ? h('span', { class: 'rel-tag' }, 'cet appareil') : null), h('td', {}, s.device), h('td', { class: 'muted small' }, s.ip || ''),
          h('td', { class: 'muted small' }, 'actif ', fmtDT(s.last_seen || s.created_at)), h('td', { class: 'muted small' }, 'valide jusqu’au ', new Date(s.expires_at).toLocaleDateString('fr-FR')),
          h('td', {}, s.current ? null : h('button', { class: 'btn small danger', onclick: async () => { await api.del(`/api/admin/activity/sessions/${s.id}`); draw(); } }, 'Déconnecter'))))))),
      section('Consultations des pages', 'Temps passé par page (page visible et utilisateur actif, mesuré toutes les 30 s), pour les comptes et pour les liens publics sans compte. Conservé 1 an.',
        h('div', { class: 'row-end', style: 'justify-content:flex-start;gap:8px' }, sel([['', 'Comptes et liens publics'], ['link', 'Liens publics seulement'], ['user', 'Comptes seulement']], kind, (v) => { kind = v; draw(); }),
          sel([[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '1 an']], days, (v) => { days = Number(v); draw(); })),
        vis.pages.length ? h('table', { class: 'plain' }, h('thead', {}, h('tr', {}, ['Page', 'Consultations', 'Visiteurs', 'Temps total', 'Dernière'].map((x) => h('th', {}, x)))),
          h('tbody', {}, vis.pages.map((r) => h('tr', {}, h('td', {}, h('a', { href: `#/page/${r.page_id}` }, prettify(r.page_title) || 'Sans titre'), r.link_visits ? h('span', { class: 'rel-tag' }, `${r.link_visits} via lien`) : null),
            h('td', {}, r.visits), h('td', {}, r.visitors), h('td', {}, fmtDur(r.seconds)), h('td', { class: 'muted small' }, fmtDT(r.last_seen)))))) : h('p', { class: 'muted' }, 'Aucune consultation sur la période.'),
        vis.visits.length ? h('details', { class: 'limits' }, h('summary', {}, `Dernières consultations (${vis.visits.length})`), h('table', { class: 'plain' }, h('tbody', {}, vis.visits.map((v) => h('tr', {},
          h('td', { class: 'muted small' }, fmtDT(v.started_at)), h('td', {}, who(v)), h('td', {}, prettify(v.page_title) || 'Sans titre'), h('td', {}, fmtDur(v.seconds)), h('td', { class: 'muted small' }, v.device)))))) : null),
      section('Journal des connexions', 'Connexions, échecs de mot de passe et déconnexions (200 dernières).',
        h('details', { class: 'limits' }, h('summary', {}, 'Afficher le journal'), h('table', { class: 'plain' }, h('tbody', {}, log.map((l) => h('tr', {},
          h('td', { class: 'muted small' }, fmtDT(l.at)), h('td', {}, KIND[l.kind] || l.kind), h('td', {}, l.email || '—'), h('td', { class: 'muted small' }, l.ip || ''), h('td', { class: 'muted small' }, l.device))))))));
  };
  await draw();
}

async function tabUsers(p) {
  const draw = async () => {
    const [users, st] = await Promise.all([api.get('/api/admin/users'), api.get('/api/admin/settings')]);
    const email = h('input', { class: 'input', type: 'email', placeholder: 'E-mail' }), nm = h('input', { class: 'input', placeholder: 'Nom' }), pw = h('input', { class: 'input', type: 'password', placeholder: 'Mot de passe initial (8+)' });
    p.replaceChildren(
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.allow_signup === '1', onchange: async (e) => { await api.put('/api/settings', { allow_signup: e.target.checked ? '1' : '0' }); } }), 'Autoriser l’inscription libre : toute personne qui ouvre le site peut créer son compte (sinon, seul l’administrateur ajoute des comptes)'),
      h('table', { class: 'plain' }, h('tbody', {}, users.map((u) => h('tr', {}, h('td', {}, u.name || '—'), h('td', {}, u.email), h('td', {}, u.role === 'admin' ? 'Admin' : 'Membre'),
        h('td', {}, u.id === S.me.id ? null : h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox(`Supprimer ${u.email} et toutes ses pages ?`)) { await api.del(`/api/admin/users/${u.id}`); draw(); } } }, 'Supprimer')))))),
      h('h3', {}, 'Ajouter un utilisateur'), h('div', { class: 'share-row' }, nm, email, pw, h('button', { class: 'btn primary', onclick: async () => { try { await api.post('/api/admin/users', { name: nm.value, email: email.value, password: pw.value }); draw(); } catch (e) { toast(e.message, 'error'); } } }, 'Créer')));
  };
  await draw();
}

boot().catch((e) => { root.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Erreur de chargement'), h('p', {}, e.message))); });
