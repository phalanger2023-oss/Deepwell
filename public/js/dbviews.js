/**
 * Vues d'une base de données : Tableau, Kanban (type Trello), Calendrier, Galerie, Liste.
 * Les vues sont enregistrées avec la base (champ `views`) ; les données restent au format Notion (propriétés, options, dates).
 */
import { h, ask, modal, toast, confirmBox, safeUrl, uuid } from './util.js';
import { rtPlain, plainRt } from './richtext.js';
import { api } from './api.js';
import { propText, propEditor, titleKey, sortKey, compareProps } from './database.js';
import { vi, iconNode, ICON_COLORS } from './icons.js';
import { autoClose } from './menus.js';
import { toInputs, fromInputs, userTz, formatDate, todayIso } from './dates.js';

const TYPES = [['table', 'Tableau', 'table'], ['board', 'Kanban', 'kanban'], ['calendar', 'Calendrier', 'calendar-days'], ['gallery', 'Galerie', 'layout-grid'], ['list', 'Liste', 'list']];
const typeInfo = (t) => TYPES.find((x) => x[0] === t) || TYPES[0];
const pad = (n) => String(n).padStart(2, '0');
const hexOf = (c) => ICON_COLORS[c] || '#9b9a97';
const chip = (opt) => h('span', { class: 'chip', style: `background:color-mix(in srgb, ${hexOf(opt?.color)} 22%, transparent)` }, opt?.name ?? '');

/** Cellule « lecture seule » compacte d'une propriété pour les cartes. */
function propBadge(def, prop) {
  if (!prop) return null;
  const v = prop[prop.type];
  if (prop.type === 'select' || prop.type === 'status') return v ? chip(v) : null;
  if (prop.type === 'multi_select') return v?.length ? h('span', { class: 'chips' }, v.map(chip)) : null;
  if (prop.type === 'checkbox') return h('span', { class: 'muted' }, v ? '☑' : '☐');
  const t = propText(prop);
  return t ? h('span', { class: 'card-prop' }, t) : null;
}

/** Aperçu latéral d'une entrée (glisse depuis la droite) : la page complète, dans un cadre, avec « Ouvrir en plein écran ». */
function peekRow(r, onChange) {
  document.querySelector('.peek-wrap')?.remove();
  const frame = h('iframe', { class: 'peek-frame', src: `/?peek=1#/page/${r.id}`, title: r.title || 'Entrée' });
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .ctx-menu, .palette')) close(); };
  const close = async () => {
    document.removeEventListener('keydown', onKey, true);
    try { await frame.contentWindow?.__dwFlush?.(); } catch { /* cadre déjà fermé */ }
    wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 180);
    window.dispatchEvent(new Event('dw-refresh-page')); onChange?.();
  };
  const wrap = h('div', { class: 'peek-wrap' }, h('div', { class: 'peek-back', onclick: close }),
    h('aside', { class: 'peek', role: 'dialog', 'aria-label': 'Aperçu de l’entrée' }, h('div', { class: 'peek-head' },
      h('button', { class: 'btn small', onclick: () => { close(); location.hash = `#/page/${r.id}`; } }, vi('maximize-2', 14), 'Ouvrir en plein écran'),
      h('span', { class: 'ip-spacer' }), h('button', { class: 'icon-btn', title: 'Fermer (Échap)', 'aria-label': 'Fermer', onclick: close }, vi('x', 18))), frame));
  document.body.append(wrap); setTimeout(() => wrap.classList.add('in'), 20);
  document.addEventListener('keydown', onKey, true);
}

/**
 * « Attraper » le fond d'une vue avec la souris pour la faire défiler (comme une main sur une carte) : tableau, Kanban, galerie, liste, calendrier.
 * Horizontal : le tableau ou le Kanban s'il déborde ; vertical : la page. Cartes, liens, boutons et champs gardent leur comportement normal.
 */
const NO_GRAB = 'button, input, select, textarea, label, th, [contenteditable="true"], [draggable="true"], .kb-card, .cal-ev, .add-col, .cal-plus, .kb-track';
function grabScroll(body) {
  body.addEventListener('mousedown', (e) => {
    // Une carte du Kanban se déplace d'une colonne à l'autre : pour la saisir comme fond, clic molette ou Maj + glisser.
    const forced = !!e.target.closest('.kb-card') && (e.button === 1 || (e.button === 0 && e.shiftKey));
    if (!(e.button === 0 || forced) || (e.target.closest(NO_GRAB) && !forced)) return;
    const link = e.target.closest('a'), cardLink = forced || link?.matches('.gal-card, .lst-row'); // cartes de la galerie, lignes de la liste : on peut les attraper, un simple clic les ouvre toujours
    if (link && !cardLink) return;
    e.preventDefault(); // pas de sélection de texte, ni de « glisser le lien » / glisser-déposer de la carte pendant qu'on fait défiler
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // le clic sur le fond sort quand même d'un champ en cours de saisie
    const hs = e.target.closest('.kb-board, .db-scroll') || body.querySelector('.kb-board, .db-scroll'), vs = body.closest('.scroll') || document.scrollingElement;
    const x0 = e.clientX, y0 = e.clientY, sx = hs ? hs.scrollLeft : 0, sy = vs ? vs.scrollTop : 0;
    let on = false;
    const move = (m) => {
      if (!on) { if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 4) return; on = true; body.classList.add('panning'); getSelection()?.removeAllRanges(); }
      if (hs && hs.scrollWidth > hs.clientWidth) hs.scrollLeft = sx - (m.clientX - x0);
      if (vs) vs.scrollTop = sy - (m.clientY - y0);
    };
    const up = () => {
      body.classList.remove('panning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      if (on && cardLink) { const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; window.addEventListener('click', kill, true); setTimeout(() => window.removeEventListener('click', kill, true), 0); } // un glisser n'ouvre pas la fiche
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
}

export function renderDatabase(host, { page, rows, role, onChange }) {
  const editable = role === 'edit' || role === 'owner';
  const schema = page.schema || { Name: { id: 'title', name: 'Name', type: 'title', title: {} } };
  const tk = titleKey(schema);
  const allProps = [tk, ...Object.keys(schema).filter((k) => k !== tk)];
  let views = page.views?.length ? page.views : [{ id: 'v-table', name: 'Tableau', type: 'table' }];
  const memoKey = `dw_view_${page.id}`;
  let activeId = (() => { try { return localStorage.getItem(memoKey); } catch { return null; } })();
  if (!views.some((v) => v.id === activeId)) activeId = views[0].id;
  let filter = '', calMonth = null;
  const view = () => views.find((v) => v.id === activeId);

  const saveSchema = () => api.patch(`/api/pages/${page.id}`, { schema }).catch((e) => toast(e.message, 'error'));
  const saveViews = () => api.patch(`/api/pages/${page.id}`, { views }).catch((e) => toast(e.message, 'error'));
  const visibleProps = (v) => (v.props ? allProps.filter((p) => p === tk || v.props.includes(p)) : allProps);
  const cardProps = (v) => (v.props ? v.props.filter((p) => p !== tk && schema[p]) : allProps.filter((p) => p !== tk && p !== v.group_by && p !== v.date_prop && ['select', 'status', 'multi_select', 'date', 'number', 'checkbox', 'people', 'url'].includes(schema[p].type)).slice(0, 3));
  const firstOf = (types) => allProps.find((p) => types.includes(schema[p].type));

  async function commitRow(r, col, np) {
    r.props = { ...(r.props || {}), [col]: np };
    const patch = { props: r.props };
    if (col === tk) { r.title = rtPlain(np.title); patch.title = r.title; }
    try { await api.patch(`/api/pages/${r.id}`, patch); if (col === tk) onChange?.(); } catch (e) { toast(e.message, 'error'); }
  }
  async function createRow(title = '', extra = {}) {
    const created = await api.post('/api/pages', { parent_id: page.id, title });
    const row = { id: created.id, title, icon: null, cover: null, props: { ...(created.props || {}), [tk]: { type: 'title', title: plainRt(title) }, ...extra } };
    rows.push(row);
    await api.patch(`/api/pages/${row.id}`, { props: row.props });
    onChange?.();
    return row;
  }
  // clic sur une entrée : aperçu latéral (par défaut) ou page complète (option de la base)
  const fullDefault = () => !!page.props?.dw_open_full;
  const schoolOn = () => !!page.props?.dw_school?.enabled;
  const schoolDrive = () => !!(page.props?.dw_school?.enabled && page.props?.dw_school?.options?.drive);
  const newChapter = async () => {
    try {
      const r = await createRow('', {});
      try { const f = await api.post(`/api/school/pages/${r.id}/folder`); if (f?.pending) toast('Chapitre créé. Google ne répond pas : le dossier Drive sera créé automatiquement dès que possible.'); }
      catch (e) { toast(e.message, 'error'); }
      if (view().type === 'table') { draw(); host.querySelector('tbody tr:last-child .title-cell input')?.focus(); } else open(r);
    } catch (e) { toast(e.message, 'error'); }
  };
  // Nouvelle ligne depuis un modèle (propriétés + contenu copiés, mentions « @Today » remplacées par la date du jour)
  async function createFromTemplate(t) {
    const created = await api.post(`/api/pages/${page.id}/from-template/${t.id}`, { today: todayIso() });
    const row = { id: created.id, title: created.title || '', icon: created.icon, cover: null, props: created.props || {} };
    rows.push(row); onChange?.();
    if (schoolDrive()) {
      try { const f = await api.post(`/api/school/pages/${row.id}/folder`); if (f?.pending) toast('Chapitre créé. Google ne répond pas : le dossier Drive sera créé automatiquement dès que possible.'); }
      catch (e) { toast(e.message, 'error'); }
    }
    draw(); open(row);
  }
  const openTemplates = async (anchor) => { try { (await import('./templates.js')).openTemplateMenu(anchor, { page, onPick: (t) => createFromTemplate(t).catch((e) => toast(e.message, 'error')) }); } catch (e) { toast(e.message, 'error'); } };
  // Valeurs par défaut : chaque nouvelle ligne (bouton, Kanban, calendrier, bouton d'automatisation) les reçoit ; une colonne du Kanban ou un modèle les remplace.
  const DEF_TYPES = ['select', 'status', 'multi_select', 'checkbox', 'number', 'rich_text', 'url', 'email', 'phone_number'];
  const defCandidates = () => allProps.filter((p) => p !== tk && DEF_TYPES.includes(schema[p].type));
  const defCount = () => Object.keys(page.props?.dw_defaults || {}).filter((k) => schema[k]).length;
  const emptyFor = (t) => ({ type: t, [t]: t === 'multi_select' || t === 'rich_text' ? [] : t === 'checkbox' ? false : null });
  const openDefaults = () => {
    const defs = { ...(page.props?.dw_defaults || {}) };
    const persist = async () => {
      const props = { ...(page.props || {}), dw_defaults: defs };
      if (!Object.keys(defs).length) delete props.dw_defaults;
      try { await api.patch(`/api/pages/${page.id}`, { props }); page.props = props; } catch (e) { toast(e.message, 'error'); }
    };
    const box = h('div', { class: 'defs' });
    const redraw = () => {
      const used = Object.keys(defs).filter((k) => schema[k]), free = defCandidates().filter((p) => !used.includes(p));
      const adder = free.length ? h('select', { class: 'input', onchange: async (e) => { const k = e.target.value; if (!k) return; defs[k] = emptyFor(schema[k].type); await persist(); redraw(); } },
        h('option', { value: '' }, 'Ajouter une valeur par défaut…'), free.map((p) => h('option', { value: p }, p))) : null;
      box.replaceChildren(...[
        used.length ? null : h('p', { class: 'muted small' }, 'Aucune valeur par défaut. Exemple : « Statut » = « À faire » pour que chaque nouvelle ligne arrive dans cette colonne du Kanban.'),
        ...used.map((k) => h('div', { class: 'defs-row' }, h('span', { class: 'defs-name' }, k),
          h('span', { class: 'defs-val' }, propEditor(schema[k], defs[k], true, async (np) => { defs[k] = np; await persist(); }, saveSchema)),
          h('button', { class: 'icon-btn', title: 'Retirer cette valeur par défaut', onclick: async () => { delete defs[k]; await persist(); redraw(); } }, vi('x', 15)))),
        adder].filter(Boolean));
    };
    redraw();
    modal('Valeurs par défaut des nouvelles lignes', h('div', {}, box,
      h('p', { class: 'muted small' }, 'Elles s’appliquent aux nouvelles lignes (bouton « Nouvelle ligne », modèles, boutons d’automatisation). Une colonne du Kanban ou un modèle qui indique déjà une valeur garde la sienne.')));
  };
  const openSchoolSettings = async () => { try { (await import('./school.js')).openDatabaseSettings(page, { onSaved: () => draw() }); } catch (e) { toast(e.message, 'error'); } };
  const open = (r, forceFull) => { if (forceFull || fullDefault()) location.hash = `#/page/${r.id}`; else peekRow(r, onChange); };
  host.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/#/page/"]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const r = rows.find((x) => a.getAttribute('href') === `/#/page/${x.id}`);
    if (r) { e.preventDefault(); open(r); }
  });
  const matches = (r) => !filter || (r.title + ' ' + allProps.map((c) => propText(r.props?.[c])).join(' ')).toLowerCase().includes(filter.toLowerCase());
  const sorted = (list, v) => (v.sort?.prop && schema[v.sort.prop] ? [...list].sort((a, b) => compareProps(a.props?.[v.sort.prop], b.props?.[v.sort.prop], v.sort.dir)) : list);
  let exProm = null; const excerpts = () => (exProm ||= api.get(`/api/pages/${page.id}/excerpts`).catch(() => ({})));
  const cal = {}; // état de navigation du calendrier (non enregistré)
  const ctx = { schema, tk, allProps, editable, rows, commitRow, createRow, open, saveSchema, saveViews, cal, redraw: () => draw(), matches, sorted, cardProps, visibleProps, excerpts };

  // ---------- onglets de vues + barre d'outils ----------
  const body = h('div', { class: 'dbv-body' });
  grabScroll(body);
  function draw() {
    const v = view();
    const tabs = h('div', { class: 'dbv-tabs' }, views.map((x) => h('button', { class: `dbv-tab ${x.id === activeId ? 'on' : ''}`, onclick: () => { activeId = x.id; try { localStorage.setItem(memoKey, activeId); } catch {} draw(); },
      oncontextmenu: (e) => { if (editable) { e.preventDefault(); viewMenu(e.currentTarget, x); } } }, vi(typeInfo(x.type)[2], 15), x.name,
      editable && x.id === activeId ? h('span', { class: 'dbv-more', title: 'Options de la vue', onclick: (e) => { e.stopPropagation(); viewMenu(e.currentTarget, x); } }, vi('ellipsis', 15)) : null)),
    editable ? h('button', { class: 'dbv-add', title: 'Ajouter une vue', onclick: (e) => addViewMenu(e.currentTarget) }, vi('plus', 15), 'Vue') : null);
    const tools = h('div', { class: 'dbv-tools' }, h('input', { class: 'input dbv-filter', placeholder: 'Filtrer…', value: filter, oninput: (e) => { filter = e.target.value; clearTimeout(draw.t); draw.t = setTimeout(() => drawBody(), 120); } }), ...toolControls(v),
      editable && schoolDrive() ? h('button', { class: 'btn small', title: 'Crée la page du chapitre et son dossier sur Google Drive', onclick: newChapter }, vi('folder', 14), 'Nouveau chapitre') : null,
      editable && defCandidates().length ? h('button', { class: 'btn small', title: 'Valeurs par défaut des nouvelles lignes', onclick: openDefaults }, vi('sliders-horizontal', 14), 'Par défaut', defCount() ? h('span', { class: 'rel-tag' }, defCount()) : null) : null,
      editable ? h('button', { class: 'btn small', title: 'Réglages de la base', onclick: openSchoolSettings }, vi('settings', 14), 'Réglages', schoolOn() ? h('span', { class: 'rel-tag' }, 'Scolaire') : null) : null,
      editable ? h('span', { class: 'btn-split' },
        h('button', { class: 'btn primary small', onclick: async () => {
          try { const r = await createRow('', {}); if (v.type === 'table') { draw(); host.querySelector('tbody tr:last-child .title-cell input')?.focus(); } else open(r); } catch (e) { toast(e.message, 'error'); }
        } }, vi('plus', 14), 'Nouvelle ligne'),
        h('button', { class: 'btn primary small btn-split-arrow', title: 'Nouvelle ligne depuis un modèle', 'aria-label': 'Choisir un modèle', onclick: (e) => openTemplates(e.currentTarget) }, vi('chevron-down', 14))) : null);
    host.replaceChildren(tabs, tools, body);
    drawBody();
  }
  function drawBody() {
    const v = view(); body.replaceChildren();
    ({ table: drawTable, board: drawBoard, calendar: drawCalendar, gallery: drawGallery, list: drawList }[v.type] || drawTable)(body, v, ctx);
  }

  // contrôles propres à chaque vue (regroupement, propriété date, tri, propriétés visibles)
  function toolControls(v) {
    const out = [];
    const sel = (label, options, cur, onPick) => {
      const s = h('select', { class: 'input dbv-sel', title: label, disabled: !editable }, options.map(([val, l]) => h('option', { value: val, selected: val === cur }, l)));
      s.onchange = () => onPick(s.value);
      return h('label', { class: 'dbv-ctl' }, h('span', {}, label), s);
    };
    if (v.type === 'board') out.push(sel('Regrouper par', allProps.filter((p) => ['select', 'status'].includes(schema[p].type)).map((p) => [p, p]), v.group_by || firstOf(['select', 'status']) || '', (p) => { v.group_by = p; saveViews(); draw(); }));
    if (v.type === 'calendar') out.push(sel('Date', allProps.filter((p) => schema[p].type === 'date').map((p) => [p, p]), v.date_prop || firstOf(['date']) || '', (p) => { v.date_prop = p; saveViews(); draw(); }));
    {
      out.push(sel('Trier', [['', '—'], ...allProps.map((p) => [p, p])], v.sort?.prop || '', (p) => { v.sort = p ? { prop: p, dir: v.sort?.dir || 'asc' } : null; saveViews(); draw(); }));
      if (v.sort?.prop) out.push(sel('Ordre', [['asc', 'Croissant ▲'], ['desc', 'Décroissant ▼']], v.sort.dir === 'desc' ? 'desc' : 'asc', (d) => { v.sort.dir = d; saveViews(); draw(); }));
    }
    out.push(h('button', { class: 'btn small', onclick: (e) => propsMenu(e.currentTarget, v) }, vi('sliders-horizontal', 14), 'Propriétés'));
    return out;
  }
  function propsMenu(anchor, v) {
    document.querySelector('.ctx-menu')?.remove();
    const cur = new Set((v.type === 'board' || v.type === 'gallery' || v.type === 'list' || v.type === 'calendar') ? cardProps(v) : visibleProps(v)), list = h('div', { class: 'ctx-menu db-props' }, h('div', { class: 'bm-title' }, 'Propriétés affichées'),
      allProps.filter((p) => p !== tk).map((p) => h('label', { class: 'bm-color' }, h('input', { type: 'checkbox', checked: cur.has(p), disabled: !editable, onchange: (e) => { e.target.checked ? cur.add(p) : cur.delete(p); v.props = allProps.filter((x) => x === tk || cur.has(x)); saveViews(); draw(); } }), p)));
    const r = anchor.getBoundingClientRect(); list.style.left = `${r.left}px`; list.style.top = `${r.bottom + 4}px`; document.body.append(list);
    autoClose(list);
  }
  function addViewMenu(anchor) {
    document.querySelector('.ctx-menu')?.remove();
    const m = h('div', { class: 'ctx-menu' }, h('div', { class: 'bm-title' }, 'Nouvelle vue'), TYPES.map(([t, l, ico]) => h('button', { onclick: async () => {
      m.remove();
      const v = { id: uuid(), name: l, type: t };
      if (t === 'board') v.group_by = firstOf(['select', 'status']); if (t === 'calendar') v.date_prop = firstOf(['date']);
      views = [...views, v]; activeId = v.id; await saveViews(); draw();
    } }, vi(ico, 16), l)));
    const r = anchor.getBoundingClientRect(); m.style.left = `${r.left}px`; m.style.top = `${r.bottom + 4}px`; document.body.append(m);
    autoClose(m);
  }
  function viewMenu(anchor, v) {
    document.querySelector('.ctx-menu')?.remove();
    const items = [['Renommer', 'pencil', async () => { const n = (await ask('Nom de la vue', 'Nom', v.name))?.trim(); if (n) { v.name = n; await saveViews(); draw(); } }],
      ['Dupliquer', 'copy', async () => { const c = { ...JSON.parse(JSON.stringify(v)), id: uuid(), name: `${v.name} (copie)` }; views = [...views, c]; activeId = c.id; await saveViews(); draw(); }]];
    items.push([fullDefault() ? 'Ouvrir les entrées dans un aperçu latéral' : 'Ouvrir les entrées en plein écran par défaut', fullDefault() ? 'panel-right' : 'maximize-2', async () => {
      page.props = { ...(page.props || {}), dw_open_full: !fullDefault() }; await api.patch(`/api/pages/${page.id}`, { props: page.props }); toast(fullDefault() ? 'Les entrées s’ouvrent en plein écran' : 'Les entrées s’ouvrent dans un aperçu latéral');
    }]);
    if (views.length > 1) items.push(['Supprimer la vue', 'trash-2', async () => { if (await confirmBox(`Supprimer la vue « ${v.name} » ? Les données ne sont pas supprimées.`)) { views = views.filter((x) => x.id !== v.id); activeId = views[0].id; await saveViews(); draw(); } }, true]);
    const m = h('div', { class: 'ctx-menu' }, items.map(([l, ico, fn, danger]) => h('button', { class: danger ? 'danger' : '', onclick: () => { m.remove(); Promise.resolve().then(fn).catch((e) => toast(e.message, 'error')); } }, vi(ico, 16), l)));
    const r = anchor.getBoundingClientRect(); m.style.left = `${r.left}px`; m.style.top = `${r.bottom + 4}px`; document.body.append(m);
    autoClose(m);
  }

  draw();
}

// ====================================================================== TABLEAU
function drawTable(root, v, c) {
  const { schema, tk, editable } = c, cols = c.visibleProps(v);
  const list = c.sorted(c.rows.filter(c.matches), v);
  let sortBy = null, sortDir = 1;
  const table = h('table', { class: 'db-table' });
  /** Numérote (1, 2, 3…) les lignes qui n'ont pas encore de valeur dans la colonne, à la suite de la plus grande valeur existante. */
  const numberRows = async (col) => {
    let m = 0; for (const r of c.rows) { const n = r.props?.[col]?.number; if (Number.isFinite(n) && n > m) m = n; }
    for (const r of c.rows) if (!Number.isFinite(r.props?.[col]?.number)) await c.commitRow(r, col, { type: 'number', number: ++m });
  };
  const toggleAuto = async (col) => {
    const d = schema[col], on = !d.number?.auto_increment;
    if (on && !(await confirmBox(`Activer la numérotation automatique de « ${col} » ? Les nouvelles lignes recevront automatiquement le numéro suivant, et les lignes sans numéro seront numérotées maintenant.`))) return;
    d.number = { ...(d.number || {}), auto_increment: on }; await c.saveSchema();
    if (on) await numberRows(col);
    c.redraw();
  };
  const addColumn = async () => {
    const name = (await ask('Nouvelle colonne', 'Nom de la propriété'))?.trim();
    if (!name || schema[name]) return;
    const types = [['rich_text', 'Texte'], ['number', 'Nombre'], ['auto_number', 'Numéro automatique'], ['select', 'Sélection'], ['multi_select', 'Multi-sélection'], ['date', 'Date'], ['checkbox', 'Case à cocher'], ['url', 'URL'], ['email', 'E-mail'], ['phone_number', 'Téléphone']];
    const sel = h('select', { class: 'input' }, types.map(([t, l]) => h('option', { value: t }, l)));
    const m = modal('Type de propriété', h('div', {}, sel, h('div', { class: 'row-end' }, h('button', { class: 'btn primary', onclick: async () => {
      const auto = sel.value === 'auto_number', t = auto ? 'number' : sel.value;
      schema[name] = { id: `c${Date.now().toString(36)}`, name, type: t, [t]: ['select', 'multi_select'].includes(t) ? { options: [] } : auto ? { format: 'number', auto_increment: true } : {} };
      m.close(); await c.saveSchema();
      if (auto) await numberRows(name);
      c.redraw();
    } }, 'Ajouter'))));
  };
  const head = h('tr', {}, cols.map((col) => h('th', { onclick: () => { sortDir = sortBy === col ? -sortDir : 1; sortBy = col; v.sort = { prop: col, dir: sortDir > 0 ? 'asc' : 'desc' }; c.redraw(); }, title: 'Trier' },
    h('span', { class: 'th-type' }, schema[col].type === 'title' ? 'Aa' : '·'), ` ${col}`, v.sort?.prop === col ? (v.sort.dir === 'desc' ? ' ▼' : ' ▲') : '',
    editable && schema[col].type === 'number' ? h('button', { class: `th-auto ${schema[col].number?.auto_increment ? 'on' : ''}`, title: schema[col].number?.auto_increment ? 'Numérotation automatique activée (cliquer pour désactiver)' : 'Activer la numérotation automatique', onclick: (e) => { e.stopPropagation(); toggleAuto(col); } }, '#') : null,
    editable && col !== tk ? h('button', { class: 'th-x', title: 'Supprimer la colonne', onclick: async (e) => { e.stopPropagation(); if (await confirmBox(`Supprimer la colonne « ${col} » ? Les valeurs restent dans les lignes mais ne seront plus affichées.`)) { delete schema[col]; await c.saveSchema(); c.redraw(); } } }, '✕') : null)),
  editable ? h('th', { class: 'add-col', onclick: addColumn, title: 'Ajouter une propriété' }, '＋') : null);
  const body = list.map((r) => h('tr', {}, cols.map((col) => h('td', { class: col === tk ? 'title-cell' : '' },
    col === tk ? h('div', { class: 'title-wrap' }, h('a', { href: `/#/page/${r.id}`, class: 'open-row', title: 'Ouvrir' }, iconNode(r.icon, 16, 'file-text')),
      propEditor(schema[col], r.props?.[col] || { type: 'title', title: plainRt(r.title) }, editable, (np) => c.commitRow(r, col, np), c.saveSchema))
      : propEditor(schema[col], r.props?.[col], editable, (np) => c.commitRow(r, col, np), c.saveSchema))),
  editable ? h('td', { class: 'row-x' }, h('button', { class: 'icon-btn', title: 'Supprimer la ligne', onclick: async () => { await api.del(`/api/pages/${r.id}`); c.rows.splice(c.rows.indexOf(r), 1); c.redraw(); } }, vi('trash-2', 15))) : null));
  table.replaceChildren(h('thead', {}, head), h('tbody', {}, body));
  root.replaceChildren(h('div', { class: 'db-scroll' }, table), h('div', { class: 'muted small dbv-count' }, `${list.length} ligne${list.length > 1 ? 's' : ''}`));
}

// ====================================================================== KANBAN
function drawBoard(root, v, c) {
  const { schema, tk, editable } = c, gp = v.group_by || c.allProps.find((p) => ['select', 'status'].includes(schema[p].type));
  if (!gp || !schema[gp]) {
    root.replaceChildren(h('div', { class: 'dbv-empty' }, h('p', {}, 'Un Kanban a besoin d’une propriété de type Sélection ou Statut pour former ses colonnes.'),
      editable ? h('button', { class: 'btn primary', onclick: async () => {
        schema.Statut = { id: `c${Date.now().toString(36)}`, name: 'Statut', type: 'select', select: { options: [{ name: 'À faire', color: 'gray' }, { name: 'En cours', color: 'blue' }, { name: 'Terminé', color: 'green' }] } };
        v.group_by = 'Statut'; await c.saveSchema(); await c.saveViews(); c.redraw();
      } }, 'Créer une propriété « Statut »') : null));
    return;
  }
  const def = schema[gp], type = def.type, options = def[type]?.options || [];
  const list = c.rows.filter(c.matches);
  const valueOf = (r) => r.props?.[gp]?.[type]?.name ?? null;
  const groups = [...options.map((o) => ({ key: o.name, opt: o })), { key: null, opt: null }];
  const moveTo = async (rowId, key) => {
    const r = c.rows.find((x) => x.id === rowId); if (!r || valueOf(r) === key) return;
    const opt = options.find((o) => o.name === key);
    await c.commitRow(r, gp, { type, [type]: key == null ? null : opt || { name: key, color: 'default' } }); c.redraw();
  };
  const cols = groups.map(({ key, opt }) => {
    const cards = list.filter((r) => valueOf(r) === key);
    if (key == null && !cards.length && options.length) return null; // « Sans valeur » masquée quand elle est vide
    const col = h('div', { class: 'kb-col', 'data-key': key ?? '' });
    col.addEventListener('dragover', (e) => { if (editable && e.dataTransfer.types.includes('text/dw-row')) { e.preventDefault(); col.classList.add('over'); } });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', (e) => { col.classList.remove('over'); const id = e.dataTransfer.getData('text/dw-row'); if (id) { e.preventDefault(); moveTo(id, key); } });
    const addBtn = editable ? h('button', { class: 'kb-add', onclick: async () => {
      const t = await ask(`Nouvelle carte${key ? ` — ${key}` : ''}`, 'Titre');
      if (t === null) return; const r = await c.createRow(t.trim(), { [gp]: { type, [type]: key == null ? null : opt } }); c.redraw();
    } }, vi('plus', 14), 'Nouvelle carte') : null;
    col.append(h('div', { class: 'kb-head' }, opt ? chip(opt) : h('span', { class: 'chip' }, 'Sans valeur'), h('span', { class: 'muted small' }, cards.length)),
      h('div', { class: 'kb-cards' }, c.sorted(cards, v).map((r) => card(r))), addBtn);
    return col;
  }).filter(Boolean);
  function card(r) {
    const props = c.cardProps(v).filter((p) => p !== gp).map((p) => propBadge(schema[p], r.props?.[p])).filter(Boolean);
    const el = h('div', { class: 'kb-card', draggable: editable ? 'true' : null, onclick: () => c.open(r) },
      h('div', { class: 'kb-title' }, iconNode(r.icon, 16, 'file-text'), r.title || 'Sans titre'), props.length ? h('div', { class: 'kb-props' }, props) : null);
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/dw-row', r.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  }
  const addGroup = editable ? h('button', { class: 'kb-newcol', onclick: async () => {
    const n = (await ask('Nouveau groupe', 'Nom de la colonne'))?.trim(); if (!n || options.some((o) => o.name === n)) return;
    def[type] = { ...def[type], options: [...options, { name: n, color: 'default' }] }; await c.saveSchema(); c.redraw();
  } }, vi('plus', 14), 'Groupe') : null;
  const board = h('div', { class: 'kb-board' }, ...cols, addGroup);
  // Barre de navigation en haut : toujours visible quand le Kanban déborde ; on tire le curseur, ou on clique pour sauter.
  const thumb = h('div', { class: 'kb-thumb' }), track = h('div', { class: 'kb-track', title: 'Faire défiler les colonnes' }, thumb);
  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, s0 = board.scrollLeft, k = board.scrollWidth / track.clientWidth;
    const move = (m) => { board.scrollLeft = s0 + (m.clientX - x0) * k; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); thumb.classList.remove('drag'); };
    thumb.classList.add('drag'); document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  track.addEventListener('mousedown', (e) => { if (e.target === thumb) return; e.preventDefault(); const r = track.getBoundingClientRect(); board.scrollLeft = ((e.clientX - r.left) / r.width) * board.scrollWidth - board.clientWidth / 2; });
  const wrap = h('div', { class: 'kb-wrap' }, track, board,
    h('button', { class: 'kb-nav prev', title: 'Colonnes précédentes', 'aria-label': 'Colonnes précédentes', onclick: () => board.scrollBy({ left: -Math.max(240, board.clientWidth * 0.8), behavior: 'smooth' }) }, vi('chevron-left', 18)),
    h('button', { class: 'kb-nav next', title: 'Colonnes suivantes', 'aria-label': 'Colonnes suivantes', onclick: () => board.scrollBy({ left: Math.max(240, board.clientWidth * 0.8), behavior: 'smooth' }) }, vi('chevron-right', 18)));
  const sync = () => {
    const max = board.scrollWidth - board.clientWidth; wrap.classList.toggle('can-prev', board.scrollLeft > 2); wrap.classList.toggle('can-next', board.scrollLeft < max - 2); wrap.classList.toggle('can-scroll', max > 2);
    if (max > 2) { thumb.style.width = `${(board.clientWidth / board.scrollWidth) * 100}%`; thumb.style.left = `${(board.scrollLeft / board.scrollWidth) * 100}%`; }
  };
  board.addEventListener('scroll', sync, { passive: true });
  // Molette : sur le fond ou l'en-tête d'une colonne, elle fait défiler le Kanban de gauche à droite (dans une colonne, elle reste verticale).
  board.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.target.closest('.kb-cards') || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || board.scrollWidth <= board.clientWidth) return;
    e.preventDefault(); board.scrollLeft += e.deltaY;
  }, { passive: false });
  // Carte glissée vers un bord : le tableau (et la page, vers le haut / le bas de l'écran) défile tout seul.
  let raf = 0, vx = 0, vy = 0, lastOver = 0;
  const pageScroller = () => board.closest('.scroll') || document.scrollingElement;
  // plus de survol (carte lâchée ailleurs) pendant 0,4 s : on s'arrête
  const loop = () => { if ((!vx && !vy) || performance.now() - lastOver > 400) { vx = vy = 0; raf = 0; return; } board.scrollLeft += vx; if (vy) pageScroller().scrollTop += vy; raf = requestAnimationFrame(loop); };
  const speed = (d, edge) => Math.min(26, 4 + Math.round((Math.min(d, edge) / edge) * 22));
  board.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('text/dw-row')) return;
    lastOver = performance.now();
    const r = board.getBoundingClientRect(), sc = pageScroller().getBoundingClientRect(), edge = 80;
    vx = e.clientX < r.left + edge ? -speed(r.left + edge - e.clientX, edge) : e.clientX > r.right - edge ? speed(e.clientX - (r.right - edge), edge) : 0;
    const top = Math.max(sc.top, 0), bottom = Math.min(sc.bottom, innerHeight);
    vy = e.clientY < top + edge ? -speed(top + edge - e.clientY, edge) : e.clientY > bottom - edge ? speed(e.clientY - (bottom - edge), edge) : 0;
    if ((vx || vy) && !raf) raf = requestAnimationFrame(loop);
  });
  const stopAuto = () => { vx = vy = 0; };
  board.addEventListener('dragleave', (e) => { const r = board.getBoundingClientRect(); if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) stopAuto(); }); // (relatedTarget n'est pas fiable pendant un glisser)
  board.addEventListener('drop', stopAuto); board.addEventListener('dragend', stopAuto);
  root.replaceChildren(wrap);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(board);
  requestAnimationFrame(sync);
}

// ====================================================================== CALENDRIER
function drawCalendar(root, v, c) {
  const { schema, editable } = c, dp = v.date_prop || c.allProps.find((p) => schema[p].type === 'date');
  if (!dp || !schema[dp]) {
    root.replaceChildren(h('div', { class: 'dbv-empty' }, h('p', {}, 'Un calendrier a besoin d’une propriété de type Date.'),
      editable ? h('button', { class: 'btn primary', onclick: async () => { schema.Date = { id: `c${Date.now().toString(36)}`, name: 'Date', type: 'date', date: {} }; v.date_prop = 'Date'; await c.saveSchema(); await c.saveViews(); c.redraw(); } }, 'Créer une propriété « Date »') : null));
    return;
  }
  const today = todayIso(), t0 = new Date(today + 'T12:00:00Z');
  const cal = c.cal; if (cal.y === undefined) { cal.y = t0.getUTCFullYear(); cal.m = t0.getUTCMonth(); }
  const first = new Date(Date.UTC(cal.y, cal.m, 1)), startOffset = (first.getUTCDay() + 6) % 7; // semaine commençant le lundi
  const gridStart = new Date(Date.UTC(cal.y, cal.m, 1 - startOffset)), daysInGrid = Math.ceil((startOffset + new Date(Date.UTC(cal.y, cal.m + 1, 0)).getUTCDate()) / 7) * 7;
  const key = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const dayOf = (iso) => (iso ? toInputs(iso).date : null);
  const byDay = new Map(), undated = [];
  for (const r of c.sorted(c.rows.filter(c.matches), v)) {
    const d = r.props?.[dp]?.date, s = dayOf(d?.start);
    if (!s) { undated.push(r); continue; }
    const e = dayOf(d.end) || s;
    for (let t = new Date(`${s}T12:00:00Z`), n = 0; key(t) <= e && n < 62; t = new Date(t.getTime() + 86400000), n++) { const k = key(t); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(r); }
  }
  const moveDate = async (rowId, newDay) => {
    const r = c.rows.find((x) => x.id === rowId), d = r?.props?.[dp]?.date; if (!r) return;
    const s = toInputs(d?.start), delta = Math.round((new Date(`${newDay}T12:00:00Z`) - new Date(`${s.date || newDay}T12:00:00Z`)) / 86400000);
    const shift = (iso) => { if (!iso) return null; const i = toInputs(iso), nd = new Date(new Date(`${i.date}T12:00:00Z`).getTime() + delta * 86400000); return fromInputs(key(nd), i.time); };
    await c.commitRow(r, dp, { type: 'date', date: { start: d?.start ? shift(d.start) : newDay, end: shift(d?.end), time_zone: null } }); c.redraw();
  };
  const monthName = new Intl.DateTimeFormat(navigator.language || 'fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const dow = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(navigator.language || 'fr-FR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))));
  const nav = (dm) => { const d = new Date(Date.UTC(cal.y, cal.m + dm, 1)); cal.y = d.getUTCFullYear(); cal.m = d.getUTCMonth(); c.redraw(); };
  const cells = Array.from({ length: daysInGrid }, (_, i) => {
    const d = new Date(gridStart.getTime() + i * 86400000), k = key(d), items = byDay.get(k) || [];
    const cell = h('div', { class: `cal-cell ${d.getUTCMonth() !== cal.m ? 'other' : ''} ${k === today ? 'today' : ''}`, 'data-day': k },
      h('div', { class: 'cal-num' }, h('span', {}, d.getUTCDate()), editable ? h('button', { class: 'cal-plus', title: 'Ajouter', onclick: async () => { const t = await ask(`Nouvel élément le ${formatDate(k)}`, 'Titre'); if (t === null) return; await c.createRow(t.trim(), { [dp]: { type: 'date', date: { start: k, end: null, time_zone: null } } }); c.redraw(); } }, vi('plus', 13)) : null),
      ...items.slice(0, 3).map((r) => { const el = h('div', { class: 'cal-item', draggable: editable ? 'true' : null, title: r.title, onclick: () => c.open(r) }, iconNode(r.icon, 13, 'file-text'), h('span', {}, r.title || 'Sans titre'));
        const pb = c.cardProps(v).filter((p) => p !== dp).map((p) => propBadge(schema[p], r.props?.[p])).filter(Boolean); if (pb.length) el.append(h('div', { class: 'cal-props' }, pb));
        const ex = h('div', { class: 'cal-ex muted' }); ex.hidden = true; el.append(ex); c.excerpts().then((m) => { if (m[r.id]) { ex.textContent = m[r.id]; ex.hidden = false; } });
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/dw-row', r.id); e.dataTransfer.effectAllowed = 'move'; }); return el; }),
      items.length > 3 ? h('div', { class: 'cal-more muted small' }, `+ ${items.length - 3} autre${items.length - 3 > 1 ? 's' : ''}`) : null);
    cell.addEventListener('dragover', (e) => { if (editable && e.dataTransfer.types.includes('text/dw-row')) { e.preventDefault(); cell.classList.add('over'); } });
    cell.addEventListener('dragleave', () => cell.classList.remove('over'));
    cell.addEventListener('drop', (e) => { cell.classList.remove('over'); const id = e.dataTransfer.getData('text/dw-row'); if (id) { e.preventDefault(); moveDate(id, k); } });
    return cell;
  });
  root.replaceChildren(
    h('div', { class: 'cal-bar' }, h('strong', { class: 'cal-title' }, monthName),
      h('button', { class: 'icon-btn', onclick: () => nav(-1), title: 'Mois précédent' }, vi('chevron-left', 16)), h('button', { class: 'btn small', onclick: () => { cal.y = undefined; c.redraw(); } }, 'Aujourd’hui'), h('button', { class: 'icon-btn', onclick: () => nav(1), title: 'Mois suivant' }, vi('chevron-right', 16))),
    h('div', { class: 'cal-grid' }, dow.map((d) => h('div', { class: 'cal-dow' }, d)), cells),
    undated.length ? h('details', { class: 'cal-undated' }, h('summary', {}, `Sans date (${undated.length})`), undated.map((r) => h('a', { class: 'cal-item', href: `/#/page/${r.id}` }, iconNode(r.icon, 13, 'file-text'), r.title || 'Sans titre'))) : null);
}

// ====================================================================== GALERIE
function drawGallery(root, v, c) {
  const { schema } = c, list = c.sorted(c.rows.filter(c.matches), v);
  root.replaceChildren(h('div', { class: 'gal-grid' }, list.map((r) => {
    const props = c.cardProps(v).map((p) => propBadge(schema[p], r.props?.[p])).filter(Boolean);
    const cover = r.cover && safeUrl(r.cover);
    return h('a', { class: 'gal-card', href: `/#/page/${r.id}` },
      h('div', { class: 'gal-cover', style: cover ? `background-image:url("${cover.replace(/["\\]/g, '')}")` : '' }, cover ? null : iconNode(r.icon, 32, 'file-text')),
      h('div', { class: 'gal-info' }, h('div', { class: 'kb-title' }, iconNode(r.icon, 16, 'file-text'), r.title || 'Sans titre'), props.length ? h('div', { class: 'kb-props' }, props) : null));
  }), list.length ? null : h('div', { class: 'muted pad' }, 'Aucune ligne')));
}

// ====================================================================== LISTE
function drawList(root, v, c) {
  const { schema } = c, list = c.sorted(c.rows.filter(c.matches), v);
  root.replaceChildren(h('div', { class: 'lst' }, list.map((r) => {
    const props = c.cardProps(v).map((p) => propBadge(schema[p], r.props?.[p])).filter(Boolean);
    return h('a', { class: 'lst-row', href: `/#/page/${r.id}` }, iconNode(r.icon, 18, 'file-text'), h('span', { class: 'lst-title' }, r.title || 'Sans titre'), props.length ? h('span', { class: 'lst-props' }, props) : null);
  }), list.length ? null : h('div', { class: 'muted pad' }, 'Aucune ligne')));
}
