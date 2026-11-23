/**
 * Éditeur à blocs. Le modèle en mémoire est un arbre {id,type,content,children} ; `content` garde exactement
 * la forme Notion (rich_text, checked, language, …) pour que les imports restent sans perte.
 * Pour ajouter un type de bloc : l'ajouter à BLOCK_DEFAULTS, SLASH_ITEMS et au `switch` de renderBlock.
 */
import { h, esc, uuid, safeUrl, ask, toast, $$ } from './util.js';
import { equationBlock } from './math.js';
import { rtToHtml, htmlToRt, plainRt, rtPlain, colorClass } from './richtext.js';
import { formatDate, prettify, pickDate, todayIso } from './dates.js';
import { iconNode, vi, ICON_COLORS, kindIcon, parseIcon, pickIcon } from './icons.js';
import { popMenu } from './menus.js';
import { renderChart, aggregate, chartDialog } from './charts.js';
import { buttonDialog, runButton, describe as describeAction, richFromText } from './buttons.js';

const TEXT_TYPES = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout']);
const MEDIA = { image: 'une image', file: 'un fichier', video: 'une vidéo', pdf: 'un PDF', audio: 'un audio' };
const LANGS = ['plain text', 'javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'sql', 'java', 'c', 'c++', 'c#', 'go', 'rust', 'php', 'ruby', 'markdown', 'yaml', 'xml'];
const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

const rtc = () => ({ rich_text: [] });
const BLOCK_DEFAULTS = {
  paragraph: () => ({ ...rtc(), color: 'default' }),
  heading_1: () => ({ ...rtc(), color: 'default', is_toggleable: false }),
  heading_2: () => ({ ...rtc(), color: 'default', is_toggleable: false }),
  heading_3: () => ({ ...rtc(), color: 'default', is_toggleable: false }),
  bulleted_list_item: () => ({ ...rtc(), color: 'default' }),
  numbered_list_item: () => ({ ...rtc(), color: 'default' }),
  to_do: () => ({ ...rtc(), checked: false, color: 'default' }),
  toggle: () => ({ ...rtc(), color: 'default' }),
  quote: () => ({ ...rtc(), color: 'default' }),
  callout: () => ({ ...rtc(), icon: { type: 'emoji', emoji: '💡' }, color: 'gray_background' }),
  code: () => ({ ...rtc(), language: 'plain text', caption: [] }),
  divider: () => ({}),
  equation: () => ({ expression: '' }),
  bookmark: () => ({ url: '', caption: [] }),
  embed: () => ({ url: '', caption: [] }),
  image: () => ({ type: 'external', external: { url: '' }, caption: [] }),
  file: () => ({ type: 'external', external: { url: '' }, caption: [], name: '' }),
  video: () => ({ type: 'external', external: { url: '' }, caption: [] }),
  pdf: () => ({ type: 'external', external: { url: '' }, caption: [] }),
  audio: () => ({ type: 'external', external: { url: '' }, caption: [] }),
  table_of_contents: () => ({ color: 'default' }),
  school_files: () => ({}),
  button: () => ({ label: 'Bouton', color: 'default', actions: [] }),
  chart: () => ({ chart_type: 'bar', title: '', palette: 'notion', show_legend: true, show_values: false, source: { type: 'manual', labels: ['Janvier', 'Février', 'Mars', 'Avril'], series: [{ name: 'Série 1', values: [12, 19, 8, 15] }] } }),
};

const SLASH_ITEMS = [
  ['Texte', 'paragraph', 'texte paragraphe'], ['Titre 1', 'heading_1', 'titre h1 heading'], ['Titre 2', 'heading_2', 'titre h2 heading'], ['Titre 3', 'heading_3', 'titre h3 heading'],
  ['Liste à puces', 'bulleted_list_item', 'liste puces bullet'], ['Liste numérotée', 'numbered_list_item', 'liste numerotee number'], ['À faire', 'to_do', 'tâche todo case cocher'],
  ['Toggle', 'toggle', 'liste dépliante toggle'], ['Citation', 'quote', 'citation quote'], ['Cadre', 'callout', 'cadre encadré callout info'], ['Code', 'code', 'code bloc'],
  ['Séparateur', 'divider', 'séparateur divider ligne'], ['Image', 'image', 'image photo'], ['Fichier', 'file', 'fichier pièce jointe'], ['Vidéo', 'video', 'vidéo'], ['PDF', 'pdf', 'pdf'], ['Audio', 'audio', 'audio son'],
  ['Marque-page', 'bookmark', 'lien marque-page bookmark'], ['Intégration', 'embed', 'embed intégrer iframe'], ['Tableau', 'table', 'tableau table'], ['2 colonnes', 'column_list2', 'colonnes'], ['3 colonnes', 'column_list3', 'colonnes'],
  ['Équation', 'equation', 'équation maths'], ['Table des matières', 'table_of_contents', 'sommaire table des matières'], ['Fichiers du chapitre', 'school_files', 'fichiers chapitre drive pièces jointes scolaire'], ['Sous-page', 'child_page', 'page sous-page'], ['Google Drive', 'drive_file', 'google drive fichier'],
  ['Bouton', 'button', 'bouton button action automatisation routine'], ['Graphique', 'chart', 'graphique chart diagramme statistiques'], ['Graphique en courbe', 'chart:line', 'graphique courbe ligne'], ['Graphique en anneau', 'chart:donut', 'graphique anneau camembert pie'],
];
const SLASH_ICONS = { school_files: '📎', paragraph: 'T', heading_1: 'H1', heading_2: 'H2', heading_3: 'H3', bulleted_list_item: '•', numbered_list_item: '1.', to_do: '☑', toggle: '▸', quote: '❝', callout: '💡', code: '</>', divider: '—', image: '🖼', file: '📎', video: '🎬', pdf: '📄', audio: '🎵', bookmark: '🔖', embed: '🌐', table: '▦', column_list2: '▥', column_list3: '▥', equation: '∑', table_of_contents: '☰', child_page: '📄', drive_file: '△', button: '▶', chart: '📊', 'chart:line': '📈', 'chart:donut': '◔' };

const SHORTCUTS = [
  [/^#{1}\s$/, 'heading_1'], [/^#{2}\s$/, 'heading_2'], [/^#{3}\s$/, 'heading_3'], [/^[-*+]\s$/, 'bulleted_list_item'],
  [/^1[.)]\s$/, 'numbered_list_item'], [/^\[\s?\]\s$/, 'to_do'], [/^>\s$/, 'quote'], [/^\|\s$/, 'quote'], [/^"\s$/, 'quote'],
];
const nbsp = (s) => s.replace(/ /g, ' ');

export function buildTree(flat) {
  const byId = new Map(flat.map((b) => [b.id, { id: b.id, type: b.type, content: b.content || {}, children: [] }]));
  const roots = [];
  for (const b of flat) { const n = byId.get(b.id), p = b.parent_id && byId.get(b.parent_id); (p ? p.children : roots).push(n); }
  return roots;
}
export function flatten(tree, parent = null, out = []) {
  for (const n of tree) { out.push({ id: n.id, parent_id: parent, type: n.type, content: n.content }); flatten(n.children, n.id, out); }
  return out;
}

function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el); pre.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return pre.toString().length;
}
function setCaret(el, off) {
  const range = document.createRange(), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n, acc = 0, placed = false;
  while ((n = w.nextNode())) {
    const len = n.nodeValue.length;
    if (acc + len >= off) {
      const atom = n.parentElement.closest('[data-rt]');
      if (atom) range.setStartAfter(atom); else range.setStart(n, Math.max(0, off - acc));
      placed = true; break;
    }
    acc += len;
  }
  if (!placed) {
    // bloc vide : le curseur va AVANT le <br> de remplissage ; sinon en fin de texte
    if (!el.textContent) { range.setStart(el, 0); range.collapse(true); } else { range.selectNodeContents(el); range.collapse(false); }
  } else range.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
}
const splitAtCaret = (el) => {
  const r = getSelection().getRangeAt(0);
  if (!r.collapsed) r.deleteContents();
  const a = document.createRange(); a.selectNodeContents(el); a.setEnd(r.startContainer, r.startOffset);
  const b = document.createRange(); b.selectNodeContents(el); b.setStart(r.startContainer, r.startOffset);
  const conv = (rg) => { const d = document.createElement('div'); d.append(rg.cloneContents()); return htmlToRt(d); };
  return [conv(a), conv(b)];
};
function caretOnEdge(el, dir) {
  const sel = getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const rect = r.getClientRects()[0];
  const box = el.getBoundingClientRect();
  if (!rect || (!rect.height && !rect.width)) return true;
  const lh = parseFloat(getComputedStyle(el).lineHeight) || rect.height || 20;
  return dir < 0 ? rect.top - box.top < lh * 0.8 : box.bottom - rect.bottom < lh * 0.8;
}

export function createEditor(host, { blocks, editable, hooks, openAll = false }) {
  let tree = buildTree(blocks);
  const opened = new Set();
  let index = new Map();
  let slash = null, dragId = null;
  host.classList.add('editor');
  host.classList.toggle('readonly', !editable);
  // UNE SEULE zone d'édition pour toute la page (comme un document) : les correcteurs orthographiques/grammaticaux
  // (Antidote, LanguageTool, Grammarly…) voient ainsi le texte de la page en continu, et non un bloc isolé à la fois.
  // Les blocs non textuels (médias, tableaux, code, équations) restent des îlots non éditables avec leurs propres champs.
  if (editable) {
    host.contentEditable = 'true'; host.spellcheck = true; host.lang = document.documentElement.lang || 'fr';
    host.setAttribute('role', 'textbox'); host.setAttribute('aria-multiline', 'true'); host.setAttribute('aria-label', 'Contenu de la page');
  }

  let rendering = false, commentCounts = {};
  const mo = new MutationObserver((muts) => onMutations(muts));
  // ---- Annuler / rétablir (Ctrl+Z, Ctrl+Y) : instantanés de l'arbre, pris après une courte pause de frappe ----
  // (l'annulation native du navigateur ne suit pas nos re-rendus ni les changements de structure de blocs)
  let snap = '', histTimer = 0;
  const undoS = [], redoS = [];
  const commitHist = () => {
    clearTimeout(histTimer); histTimer = 0;
    const cur = JSON.stringify(tree);
    if (cur === snap) return;
    undoS.push(snap); if (undoS.length > 200) undoS.shift();
    snap = cur; redoS.length = 0;
  };
  const changed = () => { if (editable) { clearTimeout(histTimer); histTimer = setTimeout(commitHist, 500); } hooks.onChange?.(); };
  function stepHistory(redo) {
    pendingSync.forEach((el) => { if (el.isConnected) readTxt(el); }); pendingSync.clear();
    commitHist();
    const from = redo ? redoS : undoS, to = redo ? undoS : redoS;
    if (!from.length) { toast(redo ? 'Rien à rétablir' : 'Rien à annuler'); return; }
    to.push(snap); snap = from.pop();
    const before = new Map(flatten(tree).map((b) => [b.id, JSON.stringify([b.type, b.content, b.parent_id])]));
    tree = JSON.parse(snap);
    const target = flatten(tree).find((b) => before.get(b.id) !== JSON.stringify([b.type, b.content, b.parent_id]) && TEXT_TYPES.has(b.type));
    closeSlash();
    render(target ? { id: target.id } : undefined);
    hooks.onChange?.();
  }
  // --- repères DOM de la zone unique ---
  const isControl = (t) => !!t?.matches?.('input,select,textarea,button');
  const txtAt = (n) => (n && (n.nodeType === 1 ? n : n.parentElement))?.closest?.('.txt') || null;
  const isRootTxt = (el) => !!el && !el.hasAttribute('contenteditable'); // texte des blocs « normaux » (partagent la zone unique)
  const rootTxts = () => [...host.querySelectorAll('.txt')].filter(isRootTxt);
  const hostOf = (el) => (el.hasAttribute('contenteditable') ? el : host);
  const focusEl = (el) => hostOf(el).focus({ preventScroll: true });
  const curRange = () => { const s = getSelection(); return s.rangeCount && host.contains(s.anchorNode) ? s.getRangeAt(0) : null; };
  /** Bloc de texte visé par un évènement : la cible elle-même (champ isolé) ou le bloc contenant le curseur. */
  const eventTxt = (e) => (e.target.closest?.('.txt')) || txtAt(curRange()?.startContainer);
  /** La sélection part d'un bloc et finit dans un autre ? */
  const spansBlocks = () => { const r = curRange(); if (!r || r.collapsed) return false; const a = txtAt(r.startContainer), b = txtAt(r.endContainer); return !(a && a === b); };
  const reindex = (arr = tree, parent = null) => arr.forEach((n, i) => { index.set(n.id, { node: n, arr, i, parent }); reindex(n.children, n); });
  const info = (id) => index.get(id);
  const blockEl = (id) => host.querySelector(`.block[data-id="${id}"]`);
  const txtOf = (id, sel = '.txt') => blockEl(id)?.querySelector(sel);
  const newBlock = (type, content) => ({ id: uuid(), type, content: content ?? (BLOCK_DEFAULTS[type]?.() || {}), children: [] });

  // ---------- rendu ----------
  /** Titres/icônes à jour pour les liens et mentions de pages ; signale ceux dont la cible n'existe pas (non importée, supprimée…). */
  function decorate() {
    if (!hooks.pageInfo) return;
    host.querySelectorAll('a.atom-page[data-page], a.page-link[data-pid]').forEach((a) => {
      const id = a.dataset.page || a.dataset.pid, p = id && hooks.pageInfo(id);
      if (p) {
        // mention (@) : toujours une icône minimaliste (vectorielle de la page, sinon celle par défaut), jamais un emoji
        const ic = a.classList.contains('atom-page') && parseIcon(p.icon)?.kind === 'emoji' ? null : p.icon;
        a.replaceChildren(iconNode(ic, 16, kindIcon(p.kind)), ' ', prettify(p.title) || 'Sans titre'); a.classList.remove('unresolved'); a.removeAttribute('title');
      } else if (p === null) { a.classList.add('unresolved'); a.title = 'Cette page n’a pas été importée (non partagée avec l’intégration Notion) ou a été supprimée'; }
    });
  }
  /** Pastille « n commentaires » à droite des blocs qui ont des fils ouverts. */
  /** Commentaire sur le texte sélectionné : on retient le texte et sa position dans le bloc pour le surligner ensuite. */
  function commentSelection() {
    const r = curRange(); if (!r || r.collapsed || !hooks.commentBlock) return;
    const txt = txtAt(r.startContainer), b = txt?.closest('.block'); if (!b) return;
    const pre = document.createRange(); pre.setStart(txt, 0); pre.setEnd(r.startContainer, r.startOffset);
    let quote = r.toString(); const anchor = pre.toString().length;
    if (!txt.contains(r.endContainer)) { const rest = document.createRange(); rest.setStart(r.startContainer, r.startOffset); rest.setEnd(txt, txt.childNodes.length); quote = rest.toString(); }
    quote = quote.slice(0, 300); if (!quote.trim()) return;
    bar.hidden = true; getSelection().removeAllRanges();
    const nd = info(b.dataset.id)?.node;
    hooks.commentBlock(b.dataset.id, nd ? nodePlain(nd).slice(0, 40) : '', quote, anchor);
  }
  // surlignage des textes commentés (CSS Custom Highlight API : le contenu de la page n'est pas modifié)
  let commentMarks = [], markRanges = [];
  function paintMarks() {
    markRanges = [];
    if (typeof CSS === 'undefined' || !CSS.highlights) return;
    for (const m of commentMarks) {
      const txt = rootTxts().find((t) => t.closest('.block')?.dataset.id === m.block_id); if (!txt) continue;
      const nodes = []; const w = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT); let n, full = '';
      while ((n = w.nextNode())) { if (n.parentElement?.closest('[contenteditable="false"]')) continue; nodes.push([n, full.length]); full += n.data; }
      const at = full.substr(m.anchor, m.quote.length) === m.quote ? m.anchor : full.indexOf(m.quote);
      if (at < 0) continue;
      const loc = (pos, end) => { for (const [nd, st] of nodes) if (pos >= st && (pos < st + nd.data.length || (end && pos === st + nd.data.length))) return [nd, pos - st]; return null; };
      const a = loc(at, false), z = loc(at + m.quote.length, true); if (!a || !z) continue;
      const rg = document.createRange(); try { rg.setStart(...a); rg.setEnd(...z); } catch { continue; }
      markRanges.push({ rg, block_id: m.block_id });
    }
    if (markRanges.length) CSS.highlights.set('cm-hl', new Highlight(...markRanges.map((x) => x.rg))); else CSS.highlights.delete('cm-hl');
  }
  let markTimer = 0; const repaintSoon = () => { clearTimeout(markTimer); markTimer = setTimeout(paintMarks, 250); };
  host.addEventListener('input', repaintSoon);
  host.addEventListener('click', () => {
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed || !markRanges.length) return;
    const hit = markRanges.find((x) => { try { return x.rg.isPointInRange(s.anchorNode, s.anchorOffset); } catch { return false; } });
    if (hit) hooks.openComments?.(hit.block_id);
  });
  host.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm' && hooks.commentBlock) { e.preventDefault(); commentSelection(); } });
  function decorateComments() {
    paintMarks();
    host.querySelectorAll('.cm-badge').forEach((b) => b.remove());
    for (const [id, n] of Object.entries(commentCounts)) {
      const row = blockEl(id)?.querySelector(':scope > .row'); if (!row) continue;
      row.append(h('button', { class: 'cm-badge', contenteditable: 'false', 'data-n': String(n), title: `${n} fil${n > 1 ? 's' : ''} de commentaires`, 'aria-label': 'Voir les commentaires',
        onclick: (e) => { e.preventDefault(); hooks.openComments?.(id); } }, vi('message-square', 14)));
    }
  }
  function render(focus) {
    rendering = true;
    index = new Map(); reindex();
    host.classList.toggle('big', index.size > 150); // grandes pages : le navigateur ne dessine que ce qui est visible (CSS content-visibility)
    host.replaceChildren(...renderList(tree));
    decorate(); decorateComments();
    if (sel.size) paintSel();
    if (editable) host.append(h('div', { class: 'tail', contenteditable: 'false', onclick: () => { const last = tree.at(-1); if (last && TEXT_TYPES.has(last.type) && !rtPlain(last.content.rich_text)) focusBlock(last.id, 'end'); else { const b = newBlock('paragraph'); tree.push(b); render({ id: b.id }); changed(); } } }));
    mo.takeRecords(); rendering = false; // nos propres modifications DOM ne doivent pas être « resynchronisées »
    if (focus) focusBlock(focus.id, focus.offset ?? 'end', focus.sel);
  }
  function focusBlock(id, offset = 'end', sel = '.txt') {
    const el = txtOf(id, sel) || blockEl(id)?.querySelector('[contenteditable=true]');
    if (!el) return;
    focusEl(el);
    if (offset === 'end') setCaret(el, 1e9); else if (offset === 'start') setCaret(el, 0); else setCaret(el, offset);
  }
  function renderList(nodes) {
    let n = 0;
    return nodes.map((node) => { n = node.type === 'numbered_list_item' ? n + 1 : 0; return renderBlock(node, n); });
  }
  const txt = (node, { field = 'rich_text', ph = '', cls = '' } = {}) => {
    const rt = node.content[field] || [], empty = !rtPlain(rt) && !rt.some((r) => r.type !== 'text');
    // <br> : un bloc vide dans une zone d'édition partagée ne peut pas recevoir le curseur sans contenu.
    // ​ après un atome final (mention) : permet de placer le curseur après lui.
    const tail = rt.length && rt.at(-1).type !== 'text' ? '​' : '';
    // un fond coloré est déjà porté par la ligne du bloc (.row) : le répéter sur le texte dessinait un second cadre gris dans les callouts
    const el = h('div', { class: `txt ${cls} ${String(node.content.color || '').endsWith('_background') ? '' : colorClass(node.content.color)} ${node.content.dw_font ? `ff-${String(node.content.dw_font).replace(/[^a-z]/g, '')}` : ''} ${empty ? 'is-empty' : ''}`, html: empty ? (editable ? '<br>' : '') : rtToHtml(rt) + tail, 'data-ph': ph, 'data-field': field });
    return el; // pas de contenteditable propre : le bloc fait partie de la zone d'édition unique
  };
  const fileUrl = (c) => safeUrl(c?.external?.url || c?.file?.url || '');
  const kids = (node, open = true) => (node.children.length && open ? h('div', { class: 'kids' }, renderList(node.children)) : null);

  function renderBlock(node, num) {
    const c = node.content, el = h('div', { class: `block t-${node.type}`, dataset: { id: node.id } });
    const row = h('div', { class: `row ${c.color?.endsWith('_background') ? colorClass(c.color) : ''}` });
    if (editable) row.append(h('span', { class: 'add-line', title: 'Ajouter une ligne au-dessus (Alt + clic : en dessous)', contenteditable: 'false', 'aria-hidden': 'true' }),
      h('span', { class: 'handle', draggable: 'true', title: 'Glisser pour déplacer', contenteditable: 'false', 'aria-hidden': 'true' }));
    const isTog = node.type === 'toggle' || (node.type.startsWith('heading_') && c.is_toggleable);
    const open = openAll || opened.has(node.id);
    let body = null;
    const lead = (x) => row.append(typeof x === 'string' ? h('span', { class: 'lead glyph', 'data-g': x, contenteditable: 'false', 'aria-hidden': 'true' }) : h('span', { class: 'lead', contenteditable: 'false' }, x));
    switch (node.type) {
      case 'paragraph': row.append(txt(node, { ph: editable ? "Tapez '/' pour insérer un bloc" : '' })); break;
      case 'heading_1': case 'heading_2': case 'heading_3':
        if (isTog) lead(h('button', { class: `caret ${open ? 'open' : ''}`, 'aria-label': 'Déplier ou replier', onclick: () => toggleOpen(node.id) }));
        row.append(txt(node, { ph: `Titre ${node.type.slice(-1)}`, cls: node.type.replace('_', '') })); break;
      case 'bulleted_list_item': lead('•'); row.append(txt(node, { ph: 'Élément de liste' })); break;
      case 'numbered_list_item': lead(`${num}.`); row.append(txt(node, { ph: 'Élément de liste' })); break;
      case 'to_do': {
        const cb = h('input', { type: 'checkbox', class: 'todo-cb' }); cb.checked = !!c.checked; cb.disabled = !editable;
        cb.addEventListener('change', () => { c.checked = cb.checked; row.classList.toggle('done', cb.checked); changed(); });
        row.classList.toggle('done', !!c.checked); lead(cb); row.append(txt(node, { ph: 'À faire' })); break;
      }
      case 'toggle': lead(h('button', { class: `caret ${open ? 'open' : ''}`, 'aria-label': 'Déplier ou replier', onclick: () => toggleOpen(node.id) })); row.append(txt(node, { ph: 'Toggle' })); break;
      case 'quote': row.append(txt(node, { ph: 'Citation' })); break;
      case 'callout': {
        const em = c.icon?.type === 'emoji' ? c.icon.emoji : c.icon?.external?.url ? '' : '💡', dw = c.icon?.type === 'dw' ? c.icon.value : null;
        lead(h('button', { class: 'callout-icon', onclick: async () => { if (!editable) return; const v = await pickIcon(dw || em, { title: 'Icône du cadre' }); if (v === null) return; setCalloutIcon(c, v); render(); changed(); } }, dw ? iconNode(dw, 20) : em));
        row.append(txt(node, { ph: 'Cadre' })); break;
      }
      case 'code': {
        const sel = h('select', { class: 'lang', contenteditable: 'false', disabled: !editable, onchange: (e) => { c.language = e.target.value; changed(); } },
          [h('option', { value: c.language || 'plain text', selected: true }, c.language || 'plain text')]);
        const fillLangs = () => { if (sel.options.length > 1) return; const cur = c.language || 'plain text'; sel.replaceChildren(...[...new Set([cur, ...LANGS])].map((l) => h('option', { value: l, selected: l === cur }, l))); };
        sel.addEventListener('mousedown', fillLangs); sel.addEventListener('focus', fillLangs);
        const pre = h('div', { class: 'txt code-txt', 'data-field': 'code', 'data-ph': 'Code' }, rtPlain(c.rich_text));
        if (editable) { pre.contentEditable = 'plaintext-only'; pre.spellcheck = false; if (pre.contentEditable !== 'plaintext-only') pre.contentEditable = 'true'; }
        row.append(h('div', { class: 'code-wrap' }, sel, pre)); break;
      }
      case 'divider': {
        const hr = h('hr'), col = c.color;
        const hex = ICON_COLORS[col] || (/^#[0-9a-f]{3,8}$/i.test(col || '') ? col : null);
        if (hex) hr.style.setProperty('--div-c', hex);
        row.append(hr); break;
      }
      case 'chart': row.append(chartBlock(node)); break;
      case 'button': row.append(buttonBlock(node)); break;
      case 'equation': row.append(equationBlock(c.expression, editable)); break;
      case 'image': case 'file': case 'video': case 'pdf': case 'audio': body = mediaBlock(node); row.append(body); break;
      case 'bookmark': case 'embed': case 'link_preview': body = linkBlock(node); row.append(body); break;
      case 'table': row.append(tableBlock(node)); break;
      case 'column_list': row.append(h('div', { class: 'columns' }, node.children.map((col) => h('div', { class: 'column', dataset: { id: col.id } }, renderList(col.children))))); el.classList.add('has-cols'); break;
      case 'child_page': case 'child_database': case 'link_to_page': {
        const id = c.page_id || c.database_id || c.id;
        if (node.type === 'child_database' && id && hooks.mountDatabase && !c.no_preview) { row.append(inlineDatabase(id, c)); break; }
        row.append(h('a', { class: 'page-link', href: id ? `/#/page/${id}` : '#', contenteditable: 'false', dataset: { pid: id || '', kind: node.type } }, iconNode(null, 18, node.type === 'child_database' ? 'database' : 'file-text'), ' ', prettify(c.title) || 'Page')); break;
      }
      case 'drive_file': row.append(h('a', { class: 'drive-card', href: safeUrl(c.url), target: '_blank', rel: 'noopener noreferrer', contenteditable: 'false' },
        c.iconLink && safeUrl(c.iconLink) ? h('img', { src: safeUrl(c.iconLink), alt: '' }) : '△', h('span', {}, c.name || 'Fichier Google Drive'), h('small', {}, 'Google Drive'))); break;
      case 'school_files': { const box = h('div', { class: 'school-files-block', contenteditable: 'false' }); row.append(box); if (hooks.mountSchoolFiles) hooks.mountSchoolFiles(box); else box.append(h('div', { class: 'muted small' }, 'Fichiers du chapitre (visibles dans une base scolaire)')); break; }
      case 'table_of_contents': row.append(h('div', { class: 'toc', dataset: { toc: '1' } })); break;
      case 'synced_block': row.append(h('div', { class: 'synced', contenteditable: 'false' }, c.synced_from ? '🔗 Bloc synchronisé (copie)' : '🔗 Bloc synchronisé')); break;
      default: row.append(h('div', { class: 'unsupported', contenteditable: 'false', title: 'Conservé tel quel dans la base' }, `Bloc « ${node.type} » non éditable ici (conservé)`));
    }
    // les blocs non textuels sont des îlots non éditables ; leurs champs (code, légende, cellule, équation) sont des zones isolées
    if (editable && !TEXT_TYPES.has(node.type) && node.type !== 'column_list') row.setAttribute('contenteditable', 'false');
    el.append(row);
    if (node.type === 'column_list' || node.type === 'table') return el; // leurs enfants sont rendus par le bloc lui-même
    const k = kids(node, !isTog || open);
    if (k) el.append(k);
    if (node.type === 'table_of_contents') queueMicrotask(() => buildToc(el));
    return el;
  }
  const setCalloutIcon = (c, v) => { c.icon = !v ? { type: 'emoji', emoji: '💡' } : parseIcon(v)?.kind === 'emoji' ? { type: 'emoji', emoji: v } : { type: 'dw', value: v }; };
  function buildToc(el) {
    const box = el.querySelector('.toc'); if (!box) return;
    const hs = [...host.querySelectorAll('.t-heading_1,.t-heading_2,.t-heading_3')];
    box.replaceChildren(...(hs.length ? hs.map((b) => h('a', { class: `toc-item l${b.className.match(/heading_(\d)/)[1]}`, href: '#', onclick: (e) => { e.preventDefault(); b.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, b.querySelector('.txt')?.textContent || 'Sans titre')) : [h('span', { class: 'muted' }, 'Ajoutez des titres pour générer le sommaire')]));
  }
  function toggleOpen(id) { opened.has(id) ? opened.delete(id) : opened.add(id); render(); }

  // ---------- bloc bouton : clic = exécute ses actions ; engrenage = configuration ----------
  async function configureButton(node) {
    const r = await buttonDialog(node.content, hooks);
    if (r) { node.content = r; render(); changed(); }
  }
  function insertFromButton(button, items, where) {
    const blocks = items.map(([t, text, extra]) => newBlock(t, t === 'divider' ? {} : { ...(BLOCK_DEFAULTS[t]?.() || {}), rich_text: richFromText(text), ...(extra || {}) }));
    if (!blocks.length) return;
    if (where === 'start') tree.unshift(...blocks);
    else if (where === 'end') tree.push(...blocks);
    else { const i = info(button.id); (i ? i.arr : tree).splice(i ? i.i + 1 : tree.length, 0, ...blocks); }
    render(); changed();
  }
  async function clickButton(node) {
    if (!editable) { toast('Seuls les éditeurs de la page peuvent exécuter ce bouton'); return; }
    if (!node.content.actions?.length) { configureButton(node); return; }
    await runButton(node.content, { hooks, vars: () => ({ utilisateur: hooks.userName?.() || '', titre: hooks.pageTitle?.() || '' }), insert: (items, where) => insertFromButton(node, items, where) });
  }
  function buttonBlock(node) {
    const c = node.content, acts = c.actions || [];
    const btn = h('button', { type: 'button', class: `nbtn nb-${c.color || 'default'}`, title: acts.length ? acts.map(describeAction).join('\n') : 'Aucune action configurée', onclick: () => clickButton(node) }, vi('zap', 15), c.label || 'Bouton');
    return h('div', { class: 'nbtn-wrap', contenteditable: 'false' }, btn,
      editable ? h('button', { type: 'button', class: 'icon-btn nbtn-cfg', title: 'Configurer le bouton', 'aria-label': 'Configurer le bouton', onclick: () => configureButton(node) }, vi('settings-2', 14)) : null,
      c.imported && !acts.length ? h('span', { class: 'muted small' }, 'Importé de Notion — à configurer') : null);
  }

  /** Bloc graphique : données saisies ou agrégées depuis une base de données, rendu SVG. */
  function chartBlock(node) {
    const c = node.content, wrap = h('figure', { class: 'chart-block', contenteditable: 'false' });
    const edit = () => chartDialog(c, hooks).then((upd) => { if (upd) { node.content = upd; render(); changed(); } });
    (async () => {
      const cfg = { type: c.chart_type, title: c.title, palette: c.palette, showLegend: c.show_legend !== false, showValues: !!c.show_values, varyColors: c.vary_colors };
      const src = c.source || {};
      if (src.type === 'database') {
        wrap.replaceChildren(h('div', { class: 'chart-empty' }, 'Chargement des données…'));
        try { const d = await hooks.loadDatabase(src.database_id); Object.assign(cfg, aggregate(d.rows, d.schema, { x: src.x, y: src.y, yProp: src.y_prop })); }
        catch { wrap.replaceChildren(h('div', { class: 'chart-empty' }, 'Base de données introuvable ou inaccessible'), editable ? h('button', { class: 'btn small', onclick: edit }, 'Modifier') : null); return; }
      } else Object.assign(cfg, { labels: src.labels || [], series: src.series || [] });
      wrap.replaceChildren(renderChart(cfg), editable ? h('div', { class: 'chart-tools' }, h('button', { class: 'btn small', onclick: edit }, vi('settings-2', 14), 'Modifier le graphique')) : null);
    })();
    return wrap;
  }

  // ---------- menu d'un bloc (clic sur la poignée) ----------
  const COLOR_NAMES = { default: 'Par défaut', gray: 'Gris', brown: 'Marron', orange: 'Orange', yellow: 'Jaune', green: 'Vert', blue: 'Bleu', purple: 'Violet', pink: 'Rose', red: 'Rouge' };
  const cloneNode = (n) => ({ id: uuid(), type: n.type, content: JSON.parse(JSON.stringify(n.content)), children: n.children.map(cloneNode) });
  const swatch = (name, kind) => {
    const hex = ICON_COLORS[name];
    return h('span', { class: `sw sw-${kind}`, style: kind === 'text' ? (hex ? `color:${hex}` : '') : (hex ? `background:color-mix(in srgb, ${hex} 28%, transparent)` : '') }, kind === 'text' ? 'A' : '');
  };
  function blockMenu(anchor, node, pos) {
    document.querySelector('.block-menu')?.remove();
    const label = SLASH_ITEMS.find(([, t]) => t === node.type)?.[0] || node.type;
    const m = h('div', { class: 'ctx-menu block-menu', contenteditable: 'false' });
    const close = () => { m.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onEsc, true); };
    const outside = (e) => { if (!m.contains(e.target)) close(); };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    const apply = (fn) => { fn(); close(); render({ id: node.id }); changed(); };
    const item = (icon, text, fn, cls = '') => h('button', { class: cls, onclick: () => { close(); fn(); } }, vi(icon, 16), text);
    // grille compacte de pastilles (le nom de la couleur est dans l'infobulle)
    const grid = (title, kind, key, suffix) => h('div', { class: 'bm-group' }, h('div', { class: 'bm-title' }, title),
      h('div', { class: 'bm-grid' }, Object.keys(COLOR_NAMES).map((n) => { const val = n === 'default' ? 'default' : n + suffix; return h('button', { class: `bm-cell ${(node.content[key] || 'default') === val ? 'on' : ''}`, title: COLOR_NAMES[n], 'aria-label': COLOR_NAMES[n], onclick: () => apply(() => { node.content[key] = val; }) }, swatch(n, kind)); })));
    const text = TEXT_TYPES.has(node.type);

    m.append(h('div', { class: 'bm-head' }, label));
    // 1) actions (comme dans Notion : en premier)
    if (node.type === 'chart') m.append(item('settings-2', 'Modifier le graphique', () => chartDialog(node.content, hooks).then((u) => { if (u) { node.content = u; render({ id: node.id }); changed(); } })));
    if (hooks.moveBlockTo) m.append(item('arrow-right', 'Déplacer vers…', () => hooks.moveBlockTo(flatten([cloneNode(node)]), nodePlain(node) || label,
      () => { removeNode(node.id); if (!tree.length) tree.push(newBlock('paragraph')); render(); changed(); })));
    if (node.type === 'button') m.append(item('settings-2', 'Configurer le bouton', () => configureButton(node)));
    if (node.type === 'child_database') m.append(item(node.content.no_preview ? 'table' : 'eye-off', node.content.no_preview ? 'Afficher l’aperçu de la base' : 'Masquer l’aperçu (garder le lien)', () => { node.content.no_preview = node.content.no_preview ? undefined : true; if (!node.content.no_preview) delete node.content.no_preview; render({ id: node.id }); changed(); }));
    m.append(item('copy', 'Dupliquer', () => { const i = info(node.id); i.arr.splice(i.i + 1, 0, cloneNode(node)); render({ id: node.id }); changed(); }));
    if (hooks.commentBlock) m.append(item('message-square-plus', 'Commenter', () => hooks.commentBlock(node.id, label, nodePlain(node))));
    if (nodePlain(node)) m.append(item('text', 'Copier le texte', () => navigator.clipboard?.writeText(nodePlain(node)).then(() => toast('Texte copié'))));
    m.append(item('trash-2', 'Supprimer', () => { removeNode(node.id); if (!tree.length) tree.push(newBlock('paragraph')); render(); changed(); }, 'danger'));

    // 2) transformer, puis mise en forme du bloc
    if (text) {
      const kinds = [['paragraph', 'T', 'Texte'], ['heading_1', 'H1', 'Titre 1'], ['heading_2', 'H2', 'Titre 2'], ['heading_3', 'H3', 'Titre 3'], ['bulleted_list_item', '•', 'Puces'], ['numbered_list_item', '1.', 'Numérotée'], ['to_do', '☑', 'À faire'], ['toggle', '▸', 'Toggle'], ['quote', '❝', 'Citation'], ['callout', '!', 'Cadre']];
      m.append(h('div', { class: 'bm-sep' }), h('div', { class: 'bm-group' }, h('div', { class: 'bm-title' }, 'Transformer en'), h('div', { class: 'bm-kinds' }, kinds.map(([t, g, l]) => h('button', { class: node.type === t ? 'on' : '', title: l, 'aria-label': l, onclick: () => apply(() => convert(node, t)) }, g)))));
    }
    if (node.type === 'divider') {
      const cur = node.content.color, custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#9b9a97', title: 'Couleur personnalisée' });
      custom.addEventListener('change', () => apply(() => { node.content.color = custom.value; }));
      m.append(h('div', { class: 'bm-sep' }), h('div', { class: 'bm-group' }, h('div', { class: 'bm-title' }, 'Couleur du séparateur'),
        h('div', { class: 'bm-grid' }, Object.keys(COLOR_NAMES).map((n) => h('button', { class: `bm-cell ${(cur || 'default') === n ? 'on' : ''}`, title: COLOR_NAMES[n], 'aria-label': COLOR_NAMES[n], onclick: () => apply(() => { node.content.color = n; }) }, h('span', { class: 'sw sw-line', style: ICON_COLORS[n] ? `background:${ICON_COLORS[n]}` : '' }))),
          h('label', { class: 'bm-cell custom', title: 'Couleur personnalisée' }, custom))));
    }
    if (text) {
      const f = node.content.dw_font || 'default';
      m.append(grid('Couleur du texte', 'text', 'color', ''), grid('Arrière-plan', 'bg', 'color', '_background'),
        h('div', { class: 'bm-group' }, h('div', { class: 'bm-title' }, 'Police du bloc'), h('div', { class: 'bm-kinds' },
          [['default', 'Par défaut'], ['serif', 'Serif'], ['mono', 'Mono']].map(([v, l]) => h('button', { class: `wide ${f === v ? 'on' : ''}`, onclick: () => apply(() => { if (v === 'default') delete node.content.dw_font; else node.content.dw_font = v; }) }, h('span', { class: `ff-${v}` }, l))))));
    }
    document.body.append(m);
    const r = pos ? { left: pos.x, right: pos.x - 6, top: pos.y } : anchor.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.right + 6, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.max(8, Math.min(r.top, innerHeight - m.offsetHeight - 8))}px`;
    document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onEsc, true);
  }
  const nodePlain = (n) => (rtPlain(n.content.rich_text) || n.content.title || n.content.expression || '').slice(0, 120);

  function mediaBlock(node) {
    const c = node.content, url = fileUrl(c);
    const cap = h('div', { class: 'txt cap', 'data-field': 'caption', 'data-ph': editable ? 'Légende' : '', html: rtToHtml(c.caption), contenteditable: editable ? 'true' : null });
    if (!url) {
      if (!editable) return h('div', { class: 'media-empty' }, 'Média vide');
      const inp = h('input', { class: 'input', placeholder: `Coller un lien vers ${MEDIA[node.type]} puis Entrée` });
      const fi = h('input', { type: 'file', hidden: true, accept: node.type === 'image' ? 'image/*' : node.type === 'video' ? 'video/*' : node.type === 'audio' ? 'audio/*' : node.type === 'pdf' ? 'application/pdf' : '' });
      const setUrl = (u, name) => { c.type = 'external'; c.external = { url: u }; if (name) c.name = name; render(); changed(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && safeUrl(inp.value)) setUrl(inp.value.trim()); });
      fi.addEventListener('change', async () => { if (!fi.files[0]) return; try { const f = await hooks.upload(fi.files[0]); setUrl(f.url, f.name); } catch (e) { toast(e.message, 'error'); } });
      return h('div', { class: 'media-empty', contenteditable: 'false' }, h('span', {}, `Ajouter ${MEDIA[node.type]}`), h('button', { class: 'btn', onclick: () => fi.click() }, 'Importer un fichier'), inp, fi);
    }
    let m;
    if (node.type === 'image') m = h('img', { src: url, alt: rtPlain(c.caption), loading: 'lazy' });
    else if (node.type === 'video') {
      const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/), vm = url.match(/vimeo\.com\/(\d+)/);
      m = yt ? h('iframe', { src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, allowfullscreen: true, referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-presentation' })
        : vm ? h('iframe', { src: `https://player.vimeo.com/video/${vm[1]}`, allowfullscreen: true, sandbox: 'allow-scripts allow-same-origin allow-presentation' })
          : h('video', { src: url, controls: true, preload: 'metadata' });
    } else if (node.type === 'audio') m = h('audio', { src: url, controls: true });
    else if (node.type === 'pdf') m = h('iframe', { src: url, class: 'pdf', sandbox: '' });
    else m = h('a', { class: 'file-card', href: url, target: '_blank', rel: 'noopener noreferrer', download: c.name || '' }, '📎 ', c.name || decodeURIComponent(url.split('/').pop().split('?')[0]));
    return h('figure', { class: `media m-${node.type}`, contenteditable: 'false' }, m, rtPlain(c.caption) || editable ? cap : null);
  }
  function linkBlock(node) {
    const c = node.content, url = safeUrl(c.url);
    if (!url) {
      if (!editable) return h('div', { class: 'media-empty' }, 'Lien vide');
      const inp = h('input', { class: 'input', placeholder: 'Coller une URL puis Entrée' });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && safeUrl(inp.value)) { c.url = inp.value.trim(); render(); changed(); } });
      return h('div', { class: 'media-empty', contenteditable: 'false' }, inp);
    }
    if (node.type === 'embed' && /^https:/.test(url)) return h('iframe', { src: url, class: 'embed', sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation', referrerpolicy: 'no-referrer', loading: 'lazy' });
    return h('a', { class: 'bookmark', href: url, target: '_blank', rel: 'noopener noreferrer', contenteditable: 'false' }, h('b', {}, url), rtPlain(c.caption) ? h('small', {}, rtPlain(c.caption)) : null);
  }
  /** Base de données placée dans la page : s'affiche directement (chargée seulement quand elle approche de l'écran). Le titre reste un lien vers la base seule. */
  function inlineDatabase(id, c) {
    const bodyEl = h('div', { class: 'inline-db-body' }, h('div', { class: 'muted small pad' }, 'Chargement de la base…'));
    const wrap = h('div', { class: 'inline-db', contenteditable: 'false' },
      h('a', { class: 'page-link', href: `/#/page/${id}`, dataset: { pid: id, kind: 'child_database' } }, iconNode(null, 18, 'database'), ' ', prettify(c.title) || 'Base de données'), bodyEl);
    const fail = () => bodyEl.replaceChildren(h('div', { class: 'muted small pad' }, 'Base de données introuvable ou inaccessible'));
    const load = () => Promise.resolve(hooks.mountDatabase(bodyEl, id)).then((ok) => { if (!ok) fail(); }).catch(fail);
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '300px' }); io.observe(wrap); } else load();
    return wrap;
  }
  function tableBlock(node) {
    const c = node.content, rows = node.children, width = c.table_width || rows[0]?.content.cells?.length || 1;
    const t = h('table', { class: 'tbl' }, h('tbody', {}, rows.map((r, ri) => h('tr', {}, Array.from({ length: width }, (_, ci) => {
      const cell = (r.content.cells ||= [])[ci] || [];
      const head = (c.has_column_header && ri === 0) || (c.has_row_header && ci === 0);
      return h(head ? 'th' : 'td', { class: 'txt cell', html: rtToHtml(cell), contenteditable: editable ? 'true' : null, dataset: { row: r.id, col: ci }, 'data-field': 'cell' });
    })))));
    if (!editable) return t;
    const addRow = () => { node.children.push(newBlock('table_row', { cells: Array.from({ length: width }, () => []) })); render(); changed(); };
    const addCol = () => { c.table_width = width + 1; node.children.forEach((r) => (r.content.cells ||= []).push([])); render(); changed(); };
    const delRow = () => { if (node.children.length > 1) { node.children.pop(); render(); changed(); } };
    const delCol = () => { if (width > 1) { c.table_width = width - 1; node.children.forEach((r) => r.content.cells?.pop()); render(); changed(); } };
    return h('div', { class: 'tbl-wrap' }, t, h('div', { class: 'tbl-tools', contenteditable: 'false' },
      h('button', { class: 'btn small tool', 'data-t': '+ ligne', 'aria-label': 'Ajouter une ligne', onclick: addRow }), h('button', { class: 'btn small tool', 'data-t': '+ colonne', 'aria-label': 'Ajouter une colonne', onclick: addCol }),
      h('button', { class: 'btn small tool', 'data-t': '− ligne', 'aria-label': 'Supprimer une ligne', onclick: delRow }), h('button', { class: 'btn small tool', 'data-t': '− colonne', 'aria-label': 'Supprimer une colonne', onclick: delCol })));
  }

  // ---------- opérations structurelles ----------
  const textLike = (n) => n && (TEXT_TYPES.has(n.type) || n.type === 'code');
  function convert(node, type) {
    const keep = node.content;
    node.type = type;
    node.content = { ...(BLOCK_DEFAULTS[type]?.() || {}) };
    if ('rich_text' in node.content) node.content.rich_text = keep.rich_text || [];
    if (keep.color && 'color' in node.content && !String(keep.color).endsWith('_background')) node.content.color = keep.color;
  }
  function insertAfter(id, nb) { const i = info(id); i.arr.splice(i.i + 1, 0, nb); }
  function removeNode(id) { const i = info(id); i.arr.splice(i.i, 1); }
  function indent(id) {
    const i = info(id); if (!i || i.i === 0) return false;
    const prev = i.arr[i.i - 1]; i.arr.splice(i.i, 1); prev.children.push(i.node); opened.add(prev.id); return true;
  }
  function outdent(id) {
    const i = info(id); if (!i?.parent) return false;
    const p = info(i.parent.id); i.arr.splice(i.i, 1); p.arr.splice(p.i + 1, 0, i.node); return true;
  }
  const flatText = () => $$('.txt', host).filter((e) => !e.closest('.media, .tbl-tools') && !e.classList.contains('cap') && !e.classList.contains('cell'));
  function moveBlock(id, targetId, after) {
    const src = info(id), tgt = info(targetId);
    if (!src || !tgt || id === targetId) return;
    if (blockEl(id)?.contains(blockEl(targetId))) return;
    src.arr.splice(src.i, 1);
    const t2 = info(targetId); // indices ont pu changer ; on recalcule
    const arr = t2.arr, i = arr.indexOf(t2.node);
    arr.splice(after ? i + 1 : i, 0, src.node);
    render({ id }); changed();
  }

  // ---------- menu « / » ----------
  const menu = h('div', { class: 'slash-menu', hidden: true });
  document.body.append(menu);
  // Menu contextuel unique : « / » (blocs) et « @ » (pages, personnes, dates). Item = { icon, label, sub?, section?, run }.
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let mentionSeq = 0;
  function openSlash(el, node, q) {
    const nq = norm(q);
    const items = SLASH_ITEMS.filter(([, type]) => type !== 'school_files' || hooks.mountSchoolFiles).filter(([label, , kw]) => !nq || norm(label).includes(nq) || norm(kw).includes(nq))
      .map(([label, type]) => ({ icon: SLASH_ICONS[type] || '+', label, run: () => applySlash(type) }));
    if (!items.length) return closeSlash();
    slash = { kind: 'slash', el, node, q, items, sel: Math.min(slash?.sel ?? 0, items.length - 1) };
    drawPopup();
  }
  function drawPopup() {
    if (!slash) return;
    let lastSection = null;
    const rows = [];
    slash.items.forEach((it, i) => {
      if (it.section && it.section !== lastSection) { rows.push(h('div', { class: 'slash-section' }, it.section)); lastSection = it.section; }
      rows.push(h('div', { class: `slash-item ${i === slash.sel ? 'sel' : ''}`, onmousedown: (e) => { e.preventDefault(); slash.sel = i; runPopup(); } },
        h('span', { class: 'ico' }, it.icon), h('span', { class: 'lbl' }, it.label, it.sub ? h('small', {}, it.sub) : null)));
    });
    menu.replaceChildren(...rows);
    const r = getSelection().getRangeAt(0).getBoundingClientRect(), box = (r.height ? r : slash.el.getBoundingClientRect());
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 300))}px`;
    menu.style.top = `${box.bottom + 6 + menu.offsetHeight > innerHeight ? Math.max(8, box.top - menu.offsetHeight - 6) : box.bottom + 6}px`;
    menu.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  const runPopup = () => { const it = slash?.items[slash.sel]; if (it) it.run(); };
  function closeSlash() { slash = null; mentionSeq++; menu.hidden = true; }
  /** Retire le texte déclencheur (« /requête » ou « @requête ») et ferme le menu. */
  function takeTrigger() {
    const { el, node, q } = slash; closeSlash();
    const sel = getSelection();
    if (sel.rangeCount) { const r = sel.getRangeAt(0), nd = r.startContainer; if (nd.nodeType === 3) { r.setStart(nd, Math.max(0, r.startOffset - q.length - 1)); r.deleteContents(); } }
    return { el, node };
  }

  // ----- mentions « @ » -----
  const rtAnn = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
  const mentionItem = (mention, plain) => ({ type: 'mention', mention, annotations: { ...rtAnn }, plain_text: plain, href: null });
  /** Insère une mention (atome non éditable) au curseur, suivie d'une espace, curseur placé APRÈS la mention. */
  function insertAtom(el, rt) {
    focusEl(el);
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tmp = document.createElement('div');
    tmp.innerHTML = rtToHtml([rt]);
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.insertNode(tmp.firstElementChild);
    const r = document.createRange(); r.setStart(space, 1); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    el.dispatchEvent(new Event('input', { bubbles: true })); // synchronise le modèle
  }
  function insertMention(rt) { const { el } = takeTrigger(); insertAtom(el, rt); }
  async function openMention(el, node, q) {
    const my = ++mentionSeq, nq = norm(q);
    const dateItems = [['Aujourd’hui', 0], ['Demain', 1], ['Hier', -1]].filter(([l]) => !nq || norm(l).includes(nq) || 'date'.startsWith(nq))
      .map(([l, d]) => ({ section: 'Dates', icon: '📅', label: l, sub: formatDate(todayIso(d)), run: () => insertMention(mentionItem({ type: 'date', date: { start: todayIso(d), end: null, time_zone: null } }, todayIso(d))) }));
    if (!nq || 'choisir une date calendrier'.includes(nq) || nq.startsWith('dat')) {
      dateItems.push({ section: 'Dates', icon: '🗓', label: 'Choisir une date…', run: async () => {
        const { el: e2 } = takeTrigger(); const saved = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
        const d = await pickDate({});
        focusEl(e2); if (saved) { getSelection().removeAllRanges(); getSelection().addRange(saved); }
        if (d && !d.remove) insertAtom(e2, mentionItem({ type: 'date', date: d }, d.start));
      } });
    }
    const people = (await (hooks.users?.() ?? [])).filter((u) => !nq || norm(`${u.name} ${u.email}`).includes(nq)).slice(0, 5)
      .map((u) => ({ section: 'Personnes', icon: '👤', label: u.name || u.email, sub: u.name ? u.email : '', run: () => insertMention(mentionItem({ type: 'user', user: { object: 'user', id: u.id, name: u.name || u.email } }, `@${u.name || u.email}`)) }));
    const pageRows = (list) => list.slice(0, 8).map((p) => ({ section: 'Pages', icon: iconNode(p.icon, 18, kindIcon(p.kind)), label: prettify(p.title) || 'Sans titre', sub: p.parent_title ? prettify(p.parent_title) : '',
      run: () => insertMention(mentionItem({ type: 'page', page: { id: p.id } }, p.title || 'Sans titre')) }));
    const show = (pages, final) => {
      if (my !== mentionSeq) return;
      const items = [...pages, ...people, ...dateItems];
      // pas de résultat local : on attend la recherche de pages (asynchrone) avant de fermer le menu
      if (!items.length) { if (final) closeSlash(); return; }
      slash = { kind: 'mention', el, node, q, items, sel: Math.min(slash?.kind === 'mention' ? slash.sel : 0, items.length - 1) };
      drawPopup();
    };
    show(pageRows(nq ? [] : (hooks.recentPages?.() || [])), !nq);
    if (nq) { try { show(pageRows(await hooks.searchPages(q)), true); } catch { show([], true); /* hors ligne : on garde dates et personnes */ } }
  }
  async function applySlash(type) {
    const { el, node } = takeTrigger();
    node.content.rich_text = htmlToRt(el);
    const empty = !rtPlain(node.content.rich_text) && TEXT_TYPES.has(node.type);
    const place = (nb, focusSel) => {
      if (empty && node.children.length === 0) { const i = info(node.id); i.arr.splice(i.i, 1, nb); } else insertAfter(node.id, nb);
      render({ id: nb.id, sel: focusSel }); changed();
    };
    if (TEXT_TYPES.has(type) || type === 'code') {
      if (empty) { convert(node, type); render({ id: node.id }); changed(); } else place(newBlock(type));
    } else if (type === 'table') {
      const t = newBlock('table', { table_width: 3, has_column_header: true, has_row_header: false });
      t.children = Array.from({ length: 3 }, () => newBlock('table_row', { cells: [[], [], []] })); place(t, '.cell');
    } else if (type.startsWith('column_list')) {
      const cl = newBlock('column_list', {}); cl.children = Array.from({ length: Number(type.slice(-1)) }, () => { const col = newBlock('column', {}); col.children = [newBlock('paragraph')]; return col; }); place(cl);
    } else if (type === 'chart' || type.startsWith('chart:')) {
      const b = newBlock('chart'); if (type.includes(':')) b.content.chart_type = type.split(':')[1]; place(b);
    } else if (type === 'button') {
      const b = newBlock('button'); place(b); configureButton(b);
    } else if (type === 'child_page') {
      try { const p = await hooks.createSubpage(); place(newBlock('child_page', { title: p.title || 'Sans titre', page_id: p.id })); } catch (e) { toast(e.message, 'error'); }
    } else if (type === 'drive_file') {
      try { const f = await hooks.pickDrive(); if (f) place(newBlock('drive_file', { file_id: f.id, name: f.name, url: f.webViewLink, mimeType: f.mimeType, iconLink: f.iconLink })); } catch (e) { toast(e.message, 'error'); }
    } else if (type === 'divider') { // un séparateur est toujours suivi d'un bloc de texte prêt à écrire
      const nb = newBlock('divider'), nxt = newBlock('paragraph');
      if (empty && node.children.length === 0) { const i = info(node.id); i.arr.splice(i.i, 1, nb, nxt); } else { insertAfter(node.id, nb); insertAfter(nb.id, nxt); }
      render({ id: nxt.id }); changed();
    } else place(newBlock(type), type === 'equation' ? '[data-field=expression]' : undefined);
  }

  // ---------- événements ----------
  const nodeOf = (el) => info(el.closest('.block')?.dataset.id)?.node;
  /** Relit un bloc depuis le DOM vers le modèle. Retourne true si le contenu a réellement changé. */
  function readTxt(el) {
    const field = el.dataset.field, differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
    if (field === 'cell') {
      const r = info(el.dataset.row)?.node; if (!r) return false;
      const cells = (r.content.cells ||= []), i = Number(el.dataset.col), nv = htmlToRt(el), ch = differs(cells[i] || [], nv);
      cells[i] = nv; return ch;
    }
    const node = nodeOf(el); if (!node) return false;
    const key = { expression: 'expression', caption: 'caption' }[field] || 'rich_text';
    const nv = field === 'code' ? plainRt(el.textContent) : field === 'expression' ? el.textContent : htmlToRt(el);
    const ch = differs(node.content[key] ?? (key === 'expression' ? '' : []), nv);
    node.content[key] = nv; return ch;
  }
  // Filet de sécurité : un correcteur (Antidote, LanguageTool…) ou une extension peut modifier le DOM sans émettre d'évènement « input ».
  const pendingSync = new Set(); let syncTimer = 0;
  function onMutations(muts) {
    if (rendering || !editable) return;
    for (const m of muts) { const el = txtAt(m.target); if (el?.isConnected) pendingSync.add(el); }
    if (pendingSync.size && !syncTimer) {
      syncTimer = setTimeout(() => {
        syncTimer = 0; const els = [...pendingSync]; pendingSync.clear();
        let any = false; for (const el of els) if (el.isConnected && readTxt(el)) any = true;
        if (any) changed();
      }, 60);
    }
  }
  /**
   * Supprime une sélection qui couvre plusieurs blocs, comme dans un traitement de texte : le début du premier bloc et la fin
   * du dernier fusionnent, les blocs intermédiaires disparaissent (leurs enfants éventuels sont remontés).
   */
  function deleteAcross() {
    const r = curRange(); if (!r || r.collapsed) return false;
    const ends = rootTxts().filter((t) => r.intersectsNode(t));
    if (!ends.length) return false;
    const a = ends[0], b = ends.at(-1), aBlock = a.closest('.block'), bBlock = b.closest('.block'), an = nodeOf(a), bn = nodeOf(b);
    if (!an || !bn) return false;
    const conv = (rg) => { const d = document.createElement('div'); d.append(rg.cloneContents()); return htmlToRt(d); };
    let before = [], after = [], joinAt = 0;
    if (a.contains(r.startContainer)) { const ra = document.createRange(); ra.selectNodeContents(a); ra.setEnd(r.startContainer, r.startOffset); before = conv(ra); joinAt = ra.toString().length; }
    if (b.contains(r.endContainer)) { const rb = document.createRange(); rb.selectNodeContents(b); rb.setStart(r.endContainer, r.endOffset); after = conv(rb); }
    const FOLLOW = Node.DOCUMENT_POSITION_FOLLOWING;
    const inRange = (el) => r.comparePoint(el, 0) >= 0 && r.comparePoint(el, el.childNodes.length) <= 0;
    const doomed = [...host.querySelectorAll('.block')].filter((el) => el !== aBlock && el !== bBlock
      && (((aBlock.compareDocumentPosition(el) & FOLLOW) && (el.compareDocumentPosition(bBlock) & FOLLOW)) || (inRange(el) && !el.contains(aBlock) && !el.contains(bBlock))));
    // un bloc non textuel (colonnes, tableau…) qui contient une extrémité de la sélection ne peut pas être supprimé : on annule
    if (doomed.some((el) => !TEXT_TYPES.has(info(el.dataset.id)?.node.type) && (el.contains(aBlock) || el.contains(bBlock)))) return false;
    for (const el of doomed) {
      const i = info(el.dataset.id); if (!i) continue;
      if (TEXT_TYPES.has(i.node.type)) i.arr.splice(i.i, 1, ...i.node.children); else i.arr.splice(i.i, 1);
      index = new Map(); reindex();
    }
    if (a !== b) { const bi = info(bn.id); if (bi) bi.arr.splice(bi.i, 1, ...bn.children); }
    an.content.rich_text = [...before, ...after];
    render({ id: an.id, offset: joinAt }); changed();
    return true;
  }

  host.addEventListener('beforeinput', (e) => {
    if (!editable || isControl(e.target)) return;
    const t = e.inputType || '', r = curRange();
    if (t === 'deleteByDrag' || t === 'insertFromDrop') { e.preventDefault(); return; } // déplacer du texte entre blocs casserait la structure
    if (t === 'historyUndo' || t === 'historyRedo') { e.preventDefault(); stepHistory(t === 'historyRedo'); return; }
    if (!r || !/^(insert|delete)/.test(t)) return;
    if (r.collapsed && !txtAt(r.startContainer)) {
      // curseur dans une zone « morte » (à côté d'une puce, d'un média…) : on refuse et on replace le curseur dans le texte voisin
      e.preventDefault();
      const row = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest('.row');
      const target = row?.querySelector('.txt');
      if (isRootTxt(target)) { focusEl(target); setCaret(target, 1e9); }
      return;
    }
    if (spansBlocks() && !t.startsWith('insertFromPaste')) {
      e.preventDefault();
      if (deleteAcross() && t.startsWith('insert') && e.data) document.execCommand('insertText', false, e.data);
    }
  });

  /**
   * Quand on efface d'un coup tout le contenu d'un bloc (typiquement une mention seule), certains navigateurs retirent le conteneur du texte
   * lui-même. Le bloc n'a alors plus de zone d'écriture et le modèle garde l'ancien contenu (la mention revenait au prochain rendu) :
   * on vide le modèle et on redessine le bloc avec un conteneur neuf.
   */
  function repairLostTxt() {
    const base = getSelection().anchorNode;
    const blockEl = (base?.nodeType === 1 ? base : base?.parentElement)?.closest?.('.block');
    if (!blockEl || !host.contains(blockEl) || blockEl.querySelector(':scope > .row .txt')) return;
    const node = info(blockEl.dataset.id)?.node;
    if (!node || !TEXT_TYPES.has(node.type)) return;
    node.content.rich_text = [];
    render({ id: node.id, offset: 'start' }); changed();
  }
  host.addEventListener('input', (e) => {
    if (!editable || isControl(e.target)) return;
    const el = eventTxt(e); if (!el) { repairLostTxt(); return; }
    // sélection multi-blocs (mise en forme, correction…) : resynchroniser tous les blocs touchés
    const rg = curRange();
    if (rg && !rg.collapsed) rootTxts().filter((t) => t !== el && rg.intersectsNode(t)).forEach((t) => { if (readTxt(t)) changed(); });
    el.classList.toggle('is-empty', !el.textContent.replace(/​/g, '') && !el.querySelector('[data-rt]'));
    const field = el.dataset.field;
    if (field !== 'rich_text') { if (readTxt(el)) changed(); return; }
    const node = nodeOf(el); if (!node) return;
    {
      const prevText = rtPlain(node.content.rich_text);
      if (e.data === ':' && field0(el)) stripUnderlineColon(el);
      node.content.rich_text = htmlToRt(el);
      const text = nbsp(el.textContent);
      if (node.type === 'paragraph' && /^(---|___|\*\*\*)$/.test(text.trim())) {
        const i = info(node.id), nxt = newBlock('paragraph'); i.arr.splice(i.i, 1, newBlock('divider'), nxt); render({ id: nxt.id }); changed(); return;
      }
      if (node.type === 'paragraph' && /^```\s*$/.test(text)) { convert(node, 'code'); node.content.rich_text = []; render({ id: node.id, sel: '.code-txt' }); changed(); return; }
      if (node.type === 'paragraph') {
        // raccourci Markdown : « # », « ## », « - », « 1. », « [] », « > »… Il agit quand on tape l'espace juste après le préfixe,
        // AU DÉBUT du bloc, même s'il y a déjà du texte derrière (la mise en forme du reste est conservée) ;
        // ou quand « # Titre » est inséré d'un coup dans un bloc vide (dictée, collage, saisie automatisée).
        const n = text.search(/\s/) + 1;
        const typedSpace = !!e.data && /\s$/.test(e.data) && caretOffset(el) === n;
        const sc = n > 0 && SHORTCUTS.find(([re]) => re.test(text.slice(0, n)) && (!prevText || typedSpace));
        if (sc) {
          const dropChars = (rt, k) => { const out = []; for (const r of rt) { if (k <= 0 || r.type !== 'text') { out.push(r); continue; } const t = r.text?.content ?? r.plain_text ?? ''; if (t.length <= k) { k -= t.length; continue; } const rest = t.slice(k); k = 0; out.push({ ...r, text: { ...r.text, content: rest }, plain_text: rest }); } return out; };
          const kept = dropChars(node.content.rich_text, n);
          convert(node, sc[1]); node.content.rich_text = kept; render({ id: node.id, offset: 0 }); changed(); return;
        }
      }
      // texte avant le curseur ; les mentions (atomes) sont remplacées par un caractère neutre pour ne pas redéclencher le menu
      const before = (() => {
        const sel = getSelection(); if (!sel.rangeCount || !el.contains(sel.anchorNode)) return '';
        const r = document.createRange(); r.selectNodeContents(el); r.setEnd(sel.anchorNode, sel.anchorOffset);
        const frag = r.cloneContents(); frag.querySelectorAll('[data-rt]').forEach((a) => a.replaceWith('\u0001'));
        return nbsp(frag.textContent);
      })();
      const m = before.match(/(?:^|\s)\/([^\s/]*)$/), mm = before.match(/(?:^|\s)@([^@\n\u0001]{0,30})$/);
      if (m && node.type !== 'code') openSlash(el, node, m[1]);
      else if (mm && !/^\s/.test(mm[1]) && node.type !== 'code') openMention(el, node, mm[1]);
      else closeSlash();
    }
    changed();
  });

  const field0 = (el) => el.dataset.field !== 'code' && el.dataset.field !== 'cell';
  /** Texte souligné suivi de « : » : le « : » (et l'espace qui le précède) sortent du soulignement. */
  function stripUnderlineColon(el) {
    const g = getSelection(); if (!g.rangeCount || !g.isCollapsed) return;
    const n = g.anchorNode; if (!n || n.nodeType !== 3 || g.anchorOffset !== n.data.length || !n.data.endsWith(':')) return;
    const u = n.parentElement?.closest('u'); if (!u || !el.contains(u) || u.lastChild !== n) return;
    const m = /(\s?):$/.exec(n.data), tail = m[0]; n.data = n.data.slice(0, n.data.length - tail.length);
    const out = document.createTextNode(tail); u.after(out);
    if (!n.data) { const keep = u.childNodes.length === 1; if (keep) u.remove(); }
    const r = document.createRange(); r.setStart(out, out.data.length); r.collapse(true); g.removeAllRanges(); g.addRange(r);
  }
  host.addEventListener('keydown', async (e) => {
    if (!editable || isControl(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl+Z annuler · Ctrl+Y / Ctrl+Maj+Z rétablir (hors champs isolés : code, cellules… gardent l'annulation native)
    if (mod && !e.altKey && !e.isComposing && ['z', 'y'].includes(e.key.toLowerCase())) {
      const f = e.target.closest?.('.txt')?.dataset.field;
      if (!f || f === 'rich_text') { e.preventDefault(); stepHistory(e.key.toLowerCase() === 'y' || e.shiftKey); return; }
    }
    if (!mod && !e.altKey && !e.isComposing && ['Enter', 'Backspace', 'Delete'].includes(e.key) && spansBlocks()) {
      // sélection multi-blocs : on la supprime (fusion des blocs) ; Entrée coupe ensuite à cet endroit
      e.preventDefault();
      if (deleteAcross() && e.key === 'Enter') host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return;
    }
    // Ctrl+A et sélections qui débutent « entre » deux blocs : on prend le premier bloc de texte touché
    const rg0 = curRange();
    const el = eventTxt(e) || (rg0 && !rg0.collapsed ? rootTxts().find((t) => rg0.intersectsNode(t)) : null);
    if (!el) { if (e.key === 'Backspace' || e.key === 'Delete') e.preventDefault(); return; } // jamais de suppression « à l'aveugle » hors d'un bloc de texte
    const node = nodeOf(el), field = el.dataset.field;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a' && field !== 'cell' && field !== 'code') {
      // Ctrl+A : 1ʳᵉ fois le texte du bloc, 2ᵉ fois (déjà tout sélectionné) tous les blocs de la page
      const rg = curRange(), whole = document.createRange(); whole.selectNodeContents(el);
      const full = !!rg && !rg.collapsed && rg.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 && rg.compareBoundaryPoints(Range.END_TO_END, whole) >= 0;
      e.preventDefault();
      if (!full && el.textContent.length) { const g = getSelection(); g.removeAllRanges(); g.addRange(whole); }
      else selectAllBlocks();
      return;
    }
    if (slash && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) closeSlash();
    if (slash) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slash.sel = (slash.sel + (e.key === 'ArrowDown' ? 1 : slash.items.length - 1)) % slash.items.length; drawPopup(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runPopup(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
    }
    if (field === 'cell') return cellKeys(e, el);
    if (field === 'caption' || field === 'expression') { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } return; }
    if (!node) return;
    // formatage
    if (mod && !e.shiftKey && field !== 'code') {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); toggleFormat('bold'); return; }
      if (k === 'i') { e.preventDefault(); toggleFormat('italic'); return; }
      if (k === 'u') { e.preventDefault(); toggleFormat('underline'); return; }
      if (k === 'k') { e.preventDefault(); linkSelection(); return; }
      if (k === 'e') { e.preventDefault(); toggleCode(); return; }
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); toggleFormat('strikeThrough'); return; }
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); const i = info(node.id), j = i.i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j >= 0 && j < i.arr.length) { [i.arr[i.i], i.arr[j]] = [i.arr[j], i.arr[i.i]]; render({ id: node.id, offset: caretOffset(el) ?? 'end' }); changed(); }
      return;
    }
    const off = caretOffset(el);
    const sel = getSelection(), collapsed = sel.isCollapsed;
    if (e.key === 'Enter' && !e.isComposing) {
      if (field === 'code') {
        if (mod || e.shiftKey) { e.preventDefault(); const nb = newBlock('paragraph'); insertAfter(node.id, nb); render({ id: nb.id }); changed(); return; }
        e.preventDefault(); document.execCommand('insertText', false, '\n'); return;
      }
      if (e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
      e.preventDefault();
      const text = nbsp(el.textContent);
      if (node.type === 'paragraph' && /^---+$/.test(text) && collapsed) { convert(node, 'divider'); const nb = newBlock('paragraph'); insertAfter(node.id, nb); render({ id: nb.id }); changed(); return; }
      if (node.type === 'paragraph' && /^```\w*$/.test(text) && collapsed) { const lang = text.slice(3); convert(node, 'code'); if (lang) node.content.language = LANGS.includes(lang) ? lang : 'plain text'; render({ id: node.id }); changed(); return; }
      if (!text && ['bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'toggle'].includes(node.type)) {
        if (info(node.id).parent && outdent(node.id)) render({ id: node.id }); else { convert(node, 'paragraph'); render({ id: node.id }); }
        changed(); return;
      }
      const [a, b] = splitAtCaret(el);
      node.content.rich_text = a;
      const cont = ['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(node.type);
      const nb = newBlock(cont ? node.type : 'paragraph');
      nb.content.rich_text = b;
      if (node.type === 'to_do') nb.content.checked = false;
      if ((cont || node.type === 'toggle') && (node.children.length || node.type === 'toggle' && opened.has(node.id))) { node.children.unshift(nb); if (node.type === 'toggle') opened.add(node.id); }
      else insertAfter(node.id, nb);
      render({ id: nb.id, offset: 'start' }); changed(); return;
    }
    if (e.key === 'Backspace' && collapsed && off === 0 && field !== 'code') {
      e.preventDefault(); // la fusion native de deux <div> casserait le modèle : on gère toujours le début de bloc nous-mêmes
      if (node.type !== 'paragraph') { e.preventDefault(); convert(node, 'paragraph'); render({ id: node.id, offset: 0 }); changed(); return; }
      const all = flatText(), k = all.indexOf(el), prevEl = all[k - 1];
      if (!rtPlain(node.content.rich_text)) { // bloc de texte vide : retour arrière = suppression (même juste après un séparateur ou un bloc non textuel)
        const tgt = nodeOf(prevEl || all[k + 1]), mine0 = info(node.id);
        if (!tgt && !node.children.length && mine0.arr.length <= 1 && !mine0.parent) return; // dernier bloc de la page : on le garde
        mine0.arr.splice(mine0.i, 1, ...node.children);
        if (!tgt && !mine0.arr.length) mine0.arr.push(newBlock('paragraph'));
        render(tgt ? { id: tgt.id, offset: prevEl ? 'end' : 'start' } : { id: mine0.arr[0].id }); changed(); return;
      }
      if (!prevEl) return;
      e.preventDefault();
      const pn = nodeOf(prevEl), mine = info(node.id);
      if (pn && textLike(pn) && pn.type !== 'code') {
        const joinAt = prevEl.textContent.length;
        pn.content.rich_text = [...(pn.content.rich_text || []), ...node.content.rich_text];
        mine.arr.splice(mine.i, 1, ...node.children);
        render({ id: pn.id, offset: joinAt });
      } else if (!rtPlain(node.content.rich_text)) { mine.arr.splice(mine.i, 1, ...node.children); render({ id: pn?.id || node.id }); }
      else return;
      changed(); return;
    }
    if (e.key === 'Delete' && collapsed && field !== 'code' && off === el.textContent.length) {
      e.preventDefault();
      const all = flatText(), nextEl = all[all.indexOf(el) + 1], nn = nextEl && nodeOf(nextEl);
      if (nn && textLike(nn) && nn.type !== 'code' && !nn.children.length && info(nn.id).parent === info(node.id).parent) {
        const joinAt = el.textContent.length;
        node.content.rich_text = [...node.content.rich_text, ...nn.content.rich_text]; removeNode(nn.id); render({ id: node.id, offset: joinAt }); changed();
      }
      return;
    }
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      if (field === 'code' && !e.shiftKey) { document.execCommand('insertText', false, '  '); return; }
      if (e.shiftKey ? outdent(node.id) : indent(node.id)) { render({ id: node.id, offset: off ?? 'end' }); changed(); }
      return;
    }
    if (e.key === 'Escape') { (document.activeElement || el).blur?.(); return; }
    // flèches haut/bas : navigation native entre blocs (c'est une seule zone d'édition)
  });

  function cellKeys(e, el) {
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    e.preventDefault();
    const cells = $$('.cell', el.closest('table')), i = cells.indexOf(el);
    const w = el.closest('tr').children.length;
    const t = e.key === 'Tab' ? cells[i + (e.shiftKey ? -1 : 1)] : cells[i + (e.shiftKey ? -w : w)];
    if (t) { t.focus(); setCaret(t, 1e9); }
  }

  host.addEventListener('paste', async (e) => {
    if (!editable || isControl(e.target)) return;
    if (spansBlocks()) { if (!deleteAcross()) { e.preventDefault(); return; } } // le collage remplace la sélection multi-blocs
    const el = eventTxt(e); if (!el) { e.preventDefault(); return; }
    const files = [...(e.clipboardData?.files || [])];
    const node = nodeOf(el);
    if (files.length && node) {
      e.preventDefault();
      for (const f of files) { try { const up = await hooks.upload(f); const nb = newBlock(f.type.startsWith('image/') ? 'image' : 'file', { type: 'external', external: { url: up.url }, caption: [], name: up.name }); insertAfter(node.id, nb); render({ id: nb.id }); changed(); } catch (err) { toast(err.message, 'error'); } }
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    const field = el.dataset.field;
    if (field !== 'rich_text' || !node || node.type === 'code' || !/\n/.test(text.trim())) { document.execCommand('insertText', false, field === 'rich_text' ? text.replace(/\r?\n/g, ' ') : text); return; }
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    document.execCommand('insertText', false, lines.shift());
    node.content.rich_text = htmlToRt(el);
    let last = node;
    for (const l of lines) {
      let type = 'paragraph', body = l.trim(), m;
      if ((m = body.match(/^(#{1,3})\s+(.*)/))) { type = `heading_${m[1].length}`; body = m[2]; }
      else if ((m = body.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/))) { type = 'to_do'; body = m[2]; }
      else if ((m = body.match(/^[-*+]\s+(.*)/))) { type = 'bulleted_list_item'; body = m[1]; }
      else if ((m = body.match(/^\d+[.)]\s+(.*)/))) { type = 'numbered_list_item'; body = m[1]; }
      else if ((m = body.match(/^>\s?(.*)/))) { type = 'quote'; body = m[1]; }
      const nb = newBlock(type); nb.content.rich_text = plainRt(body); if (type === 'to_do') nb.content.checked = /\[[xX]\]/.test(l);
      insertAfter(last.id, nb); last = nb; reindex();
    }
    render({ id: last.id }); changed();
  });

  // Clic droit sur un bloc : menu du bloc. Maj/Ctrl + clic droit, ou clic droit sur du texte sélectionné, gardent le menu du navigateur
  // (copier/coller, suggestions d'orthographe) ; un réglage personnel permet aussi de le conserver partout.
  host.addEventListener('contextmenu', (e) => {
    if (!editable || e.shiftKey || e.ctrlKey || hooks.rightClickMode?.() === 'native' || isControl(e.target)) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.containsNode(e.target, true)) return;
    const n = info(e.target.closest?.('.block')?.dataset.id)?.node;
    if (!n) return;
    e.preventDefault();
    blockMenu(null, n, { x: e.clientX, y: e.clientY });
  });
  async function editDateAtom(a) {
    const item = JSON.parse(a.dataset.rt), txtEl = a.closest('.txt');
    const d = await pickDate(item.mention?.date || {});
    if (!d) return;
    if (d.remove) a.remove();
    else { item.mention.date = d; item.plain_text = d.start; a.dataset.rt = JSON.stringify(item); a.textContent = formatDate(d); a.title = formatDate(d, { withTz: true }); }
    txtEl?.dispatchEvent(new Event('input', { bubbles: true }));
  }
  host.addEventListener('click', (e) => {
    const al = e.target.closest('.add-line');
    if (al && editable) {
      e.preventDefault(); const bn = info(al.closest('.block')?.dataset.id);
      if (bn) { const nb = newBlock('paragraph'); bn.arr.splice(bn.i + (e.altKey ? 1 : 0), 0, nb); render({ id: nb.id }); changed(); }
      return;
    }
    const hd = e.target.closest('.handle');
    if (hd && editable) { e.preventDefault(); const n = info(hd.closest('.block')?.dataset.id)?.node; if (n) blockMenu(hd, n); return; }
    const da = e.target.closest('.atom-date');
    if (da && editable) { e.preventDefault(); editDateAtom(da); return; }
    const a = e.target.closest('a[href]');
    if (a && editable && !a.classList.contains('drive-card') && !a.classList.contains('file-card') && !a.classList.contains('bookmark')) {
      const href = a.getAttribute('href');
      if (href && href !== '#') { e.preventDefault(); if (href.startsWith('/#/')) location.hash = href.slice(1); else window.open(href, '_blank', 'noopener'); }
    }
  });
  host.addEventListener('mousedown', () => closeSlash()); // un clic ailleurs ferme le menu « / » ou « @ »

  // glisser-déposer
  const dropLine = h('div', { class: 'drop-line', hidden: true, contenteditable: 'false' });
  host.addEventListener('dragstart', (e) => {
    if (e.target.closest?.('.inline-db-body')) return; // une base intégrée gère elle-même ses glissers (cartes du Kanban, calendrier)
    const hd = e.target.closest?.('.handle');
    if (!hd) { if (editable && !e.target.closest?.('img,a,figure')) e.preventDefault(); return; } // pas de glisser-déposer de texte entre blocs
    dragId = hd.closest('.block').dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
    hd.closest('.block').classList.add('dragging');
  });
  host.addEventListener('dragend', () => { dragId = null; dropLine.hidden = true; $$('.dragging', host).forEach((x) => x.classList.remove('dragging')); });
  host.addEventListener('dragover', (e) => {
    const target = e.target.closest?.('.block'); if (!target) return;
    if (!dragId && ![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    const r = target.querySelector(':scope > .row').getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    const hr = host.getBoundingClientRect();
    dropLine.hidden = false; dropLine.style.top = `${(after ? r.bottom : r.top) - hr.top + host.scrollTop}px`; dropLine.style.left = `${r.left - hr.left}px`; dropLine.style.width = `${r.width}px`;
    dropLine.dataset.target = target.dataset.id; dropLine.dataset.after = after ? '1' : '';
    if (!dropLine.isConnected) host.append(dropLine);
  });
  host.addEventListener('drop', async (e) => {
    if (!editable) return;
    const tid = dropLine.dataset.target, after = !!dropLine.dataset.after; dropLine.hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length && tid) {
      e.preventDefault();
      let at = tid;
      for (const f of files) { try { const up = await hooks.upload(f); const nb = newBlock(f.type.startsWith('image/') ? 'image' : 'file', { type: 'external', external: { url: up.url }, caption: [], name: up.name }); insertAfter(at, nb); at = nb.id; } catch (err) { toast(err.message, 'error'); } }
      render({ id: at }); changed(); return;
    }
    if (dragId && tid) { e.preventDefault(); moveBlock(dragId, tid, after); }
  });

  // barre flottante de mise en forme
  const bar = h('div', { class: 'fmt-bar', hidden: true });
  const pop = h('div', { class: 'fmt-pop', hidden: true });
  const showPop = (btn, content) => {
    pop.replaceChildren(content); pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`; pop.style.top = `${Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)}px`;
  };
  const onDocDown = (e) => { if (!pop.hidden && !pop.contains(e.target) && !bar.contains(e.target)) pop.hidden = true; };
  document.addEventListener('mousedown', onDocDown);
  const popItem = (inner, onPick) => h('button', { class: 'fp-item', onmousedown: (e) => { e.preventDefault(); onPick(); pop.hidden = true; } }, inner);
  const colorPop = () => h('div', {}, h('div', { class: 'bm-title' }, 'Couleur du texte'),
    Object.keys(COLOR_NAMES).map((n) => popItem([swatch(n, 'text'), COLOR_NAMES[n]], () => applyInline('c', n))),
    h('div', { class: 'bm-title' }, 'Surlignage'),
    Object.keys(COLOR_NAMES).filter((n) => n !== 'default').map((n) => popItem([swatch(n, 'bg'), COLOR_NAMES[n]], () => applyInline('c', n + '_background'))),
    popItem([swatch('default', 'bg'), 'Retirer le surlignage'], () => applyInline('c', 'default')));
  const fontPop = () => h('div', {}, h('div', { class: 'bm-title' }, 'Police du texte sélectionné'),
    [['default', 'Par défaut'], ['serif', 'Serif'], ['mono', 'Monospace']].map(([v, l]) => popItem([h('span', { class: `sw sw-font ff-${v}` }, 'Ag'), l], () => applyInline('f', v))));
  const fmtBtn = (label, title, fn) => h('button', { title, 'aria-label': title, onmousedown: (e) => { e.preventDefault(); fn(e.currentTarget); } }, label);
  bar.append(fmtBtn(h('b', {}, 'B'), 'Gras (Ctrl+B)', () => toggleFormat('bold')), fmtBtn(h('i', {}, 'I'), 'Italique (Ctrl+I)', () => toggleFormat('italic')),
    fmtBtn(h('u', {}, 'U'), 'Souligné (Ctrl+U)', () => toggleFormat('underline')), fmtBtn(h('s', {}, 'S'), 'Barré', () => toggleFormat('strikeThrough')),
    fmtBtn('</>', 'Code', toggleCode), fmtBtn(vi('link-2', 15), 'Lien (Ctrl+K)', linkSelection),
    fmtBtn(h('span', { class: 'fmt-A' }, 'A'), 'Couleur et surlignage', (btn) => showPop(btn, colorPop())),
    fmtBtn(h('span', { class: 'fmt-Aa' }, 'Aa'), 'Police', (btn) => showPop(btn, fontPop())),
    hooks.commentBlock ? fmtBtn(h('span', { class: 'fmt-cm' }, vi('message-square-plus', 15), ' Commenter'), 'Commenter le texte sélectionné (Ctrl+Maj+M)', () => commentSelection()) : null);
  document.body.append(pop);
  document.body.append(bar);
  /**
   * Applique `fn` à chaque morceau de la sélection, bloc par bloc. Les navigateurs refusent souvent les commandes de mise en forme
   * quand la sélection traverse des éléments non éditables (puces, poignées) : on opère donc dans chaque bloc séparément.
   */
  function perBlock(fn) {
    const sel = getSelection(), r = curRange();
    if (!r || r.collapsed) return;
    if (!spansBlocks()) { fn(); return; }
    const saved = r.cloneRange();
    const parts = rootTxts().filter((t) => saved.intersectsNode(t)).map((t) => {
      const sub = document.createRange(); sub.selectNodeContents(t);
      if (t.contains(saved.startContainer)) sub.setStart(saved.startContainer, saved.startOffset);
      if (t.contains(saved.endContainer)) sub.setEnd(saved.endContainer, saved.endOffset);
      return sub;
    }).filter((sub) => !sub.collapsed);
    for (const sub of parts) { sel.removeAllRanges(); sel.addRange(sub); fn(); }
    sel.removeAllRanges(); try { sel.addRange(saved); } catch { /* le DOM a changé : on laisse la sélection telle quelle */ }
  }
  /** Gras/italique/souligné/barré : si tout est déjà appliqué on retire, sinon on applique partout (comme un traitement de texte). */
  function toggleFormat(cmd) {
    if (!spansBlocks()) { document.execCommand(cmd); return; }
    const states = []; perBlock(() => states.push(document.queryCommandState(cmd)));
    const target = !states.every(Boolean); let i = 0;
    perBlock(() => { if (states[i++] !== target) document.execCommand(cmd); });
  }
  /**
   * Couleur (data-c), surlignage (data-c « *_background ») ou police (data-f) sur la sélection. On retire d'abord les marques de même
   * nature à l'intérieur pour que la dernière gagne ; « default » est un marqueur explicite (annule une couleur héritée).
   */
  function applyInline(attr, value) {
    perBlock(() => {
      const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
      // API Range plutôt que execCommand('insertHTML') : Chrome réécrit le HTML inséré (classes -> styles inline) et perdrait l'attribut data-*
      const range = sel.getRangeAt(0), frag = range.extractContents();
      frag.querySelectorAll(`[data-${attr}]`).forEach((sp) => sp.replaceWith(...sp.childNodes));
      const span = document.createElement('span');
      span.setAttribute(`data-${attr}`, value); span.className = attr === 'c' ? colorClass(value) : `f-${value}`;
      span.append(frag); range.insertNode(span);
      const keep = document.createRange(); keep.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(keep);
      txtAt(span)?.dispatchEvent(new Event('input', { bubbles: true })); // synchronise le modèle
    });
  }
  function toggleCode() {
    perBlock(() => {
      const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
      if (sel.anchorNode.parentElement?.closest('code')) document.execCommand('insertText', false, sel.toString());
      else document.execCommand('insertHTML', false, `<code>${esc(sel.toString())}</code>`);
    });
  }
  async function linkSelection() {
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
    const saved = sel.getRangeAt(0).cloneRange();
    const url = await ask('Lien', 'https://…');
    sel.removeAllRanges(); sel.addRange(saved);
    if (url === null) return;
    if (!url.trim()) perBlock(() => document.execCommand('unlink'));
    else if (safeUrl(url)) perBlock(() => document.execCommand('createLink', false, url.trim()));
    else toast('URL non valide', 'error');
  }
  const onSel = () => {
    if (!editable) return;
    const sel = getSelection();
    // repère le bloc qui contient le curseur (pour n'afficher l'invite « / » que sur le paragraphe vide courant)
    host.querySelectorAll('.has-caret').forEach((x) => x.classList.remove('has-caret'));
    if (sel.rangeCount && sel.isCollapsed && host.contains(sel.anchorNode)) txtAt(sel.anchorNode)?.classList.add('has-caret');
    if (!sel.rangeCount || sel.isCollapsed || !host.contains(sel.anchorNode) || sel.anchorNode.parentElement?.closest('.code-txt, .eq-block, .cap')) { bar.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    bar.hidden = false; bar.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - bar.offsetWidth / 2, innerWidth - bar.offsetWidth - 8))}px`; bar.style.top = `${Math.max(8, r.top - bar.offsetHeight - 8)}px`;
  };
  document.addEventListener('selectionchange', onSel);

  // ---------- sélection de blocs : Ctrl+clic, rectangle (clic et glisser dans les marges), actions groupées ----------
  const sel = new Set();
  const selBar = h('div', { class: 'blk-bar', hidden: true, contenteditable: 'false' });
  document.body.append(selBar);
  const topmost = () => [...sel].map((id) => info(id)).filter((i) => i && !(() => { let p = i.parent; while (p) { if (sel.has(p.id)) return true; p = info(p.id)?.parent; } return false; })());
  function selectAllBlocks() { getSelection().removeAllRanges(); sel.clear(); tree.forEach((n) => sel.add(n.id)); paintSel(); }
  function paintSel() {
    for (const id of [...sel]) if (!info(id)) sel.delete(id);
    host.querySelectorAll('.block.sel').forEach((e) => e.classList.remove('sel'));
    sel.forEach((id) => blockEl(id)?.classList.add('sel'));
    drawSelBar();
  }
  const clearSel = () => { if (sel.size) { sel.clear(); paintSel(); } };
  const reidx = () => { index = new Map(); reindex(); };
  const afterSel = () => { render(); paintSel(); changed(); };
  const eachTop = (fn) => { for (const i of topmost().map((x) => x.node)) { const cur = info(i.id); if (cur) { fn(cur); reidx(); } } };
  const selTextNodes = () => topmost().map((i) => i.node).filter((n) => TEXT_TYPES.has(n.type));
  function colorGrid(anchor, kind) {
    const suffix = kind === 'bg' ? '_background' : '', m = h('div', { class: 'ctx-menu pop sel-pop' }, h('div', { class: 'bm-grid' }, Object.keys(COLOR_NAMES).map((n) => h('button', { class: 'bm-cell', title: COLOR_NAMES[n],
      onclick: () => { m.remove(); selTextNodes().forEach((x) => { x.content.color = n === 'default' ? 'default' : n + suffix; }); afterSel(); } }, swatch(n, kind)))));
    document.body.append(m); const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - 270)) + 'px'; m.style.top = Math.max(8, r.top - m.offsetHeight - 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } }, true), 0);
  }
  function drawSelBar() {
    if (!editable || !sel.size) { selBar.hidden = true; return; }
    const n = topmost().length, btn = (icon, title, fn) => h('button', { class: 'icon-btn', title, 'aria-label': title, onclick: (e) => fn(e.currentTarget) }, icon instanceof Node ? icon : /^[a-z0-9-]{3,}$/.test(icon) ? vi(icon, 16) : icon);
    selBar.replaceChildren(h('span', { class: 'blk-n' }, n + ' bloc' + (n > 1 ? 's' : '')),
      btn(h('b', {}, 'G'), 'Gras', () => { const ns = selTextNodes(), all = ns.every((x) => (x.content.rich_text || []).every((r) => r.annotations?.bold)); ns.forEach((x) => { x.content.rich_text = (x.content.rich_text || []).map((r) => ({ ...r, annotations: { ...(r.annotations || {}), bold: !all } })); }); afterSel(); }),
      btn(h('span', { class: 'fmt-A' }, 'A'), 'Couleur du texte', (b) => colorGrid(b, 'text')), btn('▮', 'Arrière-plan', (b) => colorGrid(b, 'bg')),
      btn('type', 'Transformer en…', (b) => { const r = b.getBoundingClientRect(); popMenu(r.left, r.top - 330, [['paragraph', 'Texte'], ['heading_1', 'Titre 1'], ['heading_2', 'Titre 2'], ['heading_3', 'Titre 3'], ['bulleted_list_item', 'Puces'], ['numbered_list_item', 'Numérotée'], ['to_do', 'À faire'], ['quote', 'Citation'], ['callout', 'Cadre']].map(([t, l]) => ({ label: l, fn: () => { selTextNodes().forEach((x) => convert(x, t)); afterSel(); } }))); }),
      btn('smile-plus', 'Changer l’icône', async () => {
        const callouts = topmost().map((i) => i.node).filter((x) => x.type === 'callout'), pages = topmost().map((i) => i.node).filter((x) => ['child_page', 'child_database', 'link_to_page'].includes(x.type)).map((x) => x.content.page_id || x.content.database_id || x.content.id).filter(Boolean);
        if (!callouts.length && !pages.length) { toast('Aucun cadre ni lien de page dans la sélection'); return; }
        const v = await pickIcon(null, { title: 'Icône des éléments sélectionnés' }); if (v === null) return;
        callouts.forEach((x) => setCalloutIcon(x.content, v));
        if (pages.length) await hooks.setPageIcons?.(pages, v);
        afterSel();
      }),
      btn('copy', 'Dupliquer', () => { eachTop((i) => { i.arr.splice(i.i + 1, 0, cloneNode(i.node)); }); afterSel(); }),
      hooks.moveBlockTo ? btn('arrow-right', 'Déplacer vers une page…', () => { const nodes = topmost().map((i) => i.node); hooks.moveBlockTo(flatten(nodes.map(cloneNode)), n + ' blocs', () => { nodes.forEach((x) => removeNode(x.id)); if (!tree.length) tree.push(newBlock('paragraph')); sel.clear(); afterSel(); }); }) : null,
      btn('trash-2', 'Supprimer (Suppr)', deleteSel), btn('x', 'Désélectionner (Échap)', clearSel));
    selBar.hidden = false;
  }
  function deleteSel() { eachTop((i) => { i.arr.splice(i.i, 1); }); sel.clear(); if (!tree.length) tree.push(newBlock('paragraph')); afterSel(); }
  function moveSel(dir) {
    const top = new Set(topmost().map((i) => i.node.id)); if (!top.size) return;
    const arrs = new Set(topmost().map((i) => i.arr));
    for (const arr of arrs) {
      const idxs = arr.map((x, k) => (top.has(x.id) ? k : -1)).filter((k) => k >= 0); if (dir > 0) idxs.reverse();
      for (const k of idxs) { const j = k + dir; if (j >= 0 && j < arr.length && !top.has(arr[j].id)) [arr[k], arr[j]] = [arr[j], arr[k]]; }
    }
    afterSel();
  }
  const toggleSel = (id) => { sel.has(id) ? sel.delete(id) : sel.add(id); paintSel(); };
  host.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) { const b = e.target.closest('.block'); if (!b || isControl(e.target)) return; e.preventDefault(); getSelection().removeAllRanges(); toggleSel(b.dataset.id); }
    else if (sel.size && !e.shiftKey) clearSel();
  }, true);
  host.addEventListener('click', (e) => { if ((e.ctrlKey || e.metaKey) && e.target.closest('a')) e.preventDefault(); }, true);
  // indulgence en début de bloc : appuyer juste à gauche du premier caractère (marge, puce, espace de la ligne) place le début de la sélection AU début du texte
  const onLeadDown = (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || !editable) return;
    const sc = scroller(); if (!sc || !sc.contains(e.target)) return;
    if (e.target.closest?.('.title, .props, .page-controls, .page-icon, .topbar, .blk-bar, .ctx-menu, .modal, .tail, .inline-db-body')) return;
    let bl = host.contains(e.target) ? e.target.closest('.block') : null;
    if (!bl) { // appui dans la marge, juste à gauche du texte : on retrouve le bloc par sa hauteur
      const hr = host.getBoundingClientRect(); if (e.clientX >= hr.left + 120 + 60 || e.clientX < hr.left - 80) return;
      bl = [...host.querySelectorAll(':scope > .block')].find((b) => { const r = b.querySelector(':scope > .row')?.getBoundingClientRect(); return r && e.clientY >= r.top && e.clientY <= r.bottom; }) || null;
    }
    const row = bl?.querySelector(':scope > .row'); if (!row || !host.contains(row)) return;
    if (e.target.closest('.txt, .handle, .add-line, .cm-badge, button, input, select, textarea, a')) return;
    const txt = row.querySelector('.txt'); if (!txt || !isRootTxt(txt)) return;
    const tr = txt.getBoundingClientRect(); if (e.clientX >= tr.left || e.clientX < tr.left - 18 || e.clientY < tr.top - 6 || e.clientY > tr.bottom + 6) return;
    e.preventDefault(); e.stopPropagation();
    const first = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT).nextNode();
    const a = first ? { n: first, o: 0 } : { n: txt, o: 0 };
    txt.focus?.(); getSelection().collapse(a.n, a.o);
    const pos = (x, y) => { const p = document.caretPositionFromPoint?.(x, y); if (p) return { n: p.offsetNode, o: p.offset }; const r = document.caretRangeFromPoint?.(x, y); return r ? { n: r.startContainer, o: r.startOffset } : null; };
    const move = (ev) => { const p = pos(ev.clientX, ev.clientY); if (p && host.contains(p.n)) getSelection().setBaseAndExtent(a.n, a.o, p.n, p.o); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up, true); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up, true);
  };
  document.addEventListener('mousedown', onLeadDown, true);
  // rectangle de sélection : on part d'une zone « vide » (marges) de la zone de défilement
  const scroller = () => host.closest('.scroll');
  const onBandDown = (e) => {
    const sc = scroller();
    if (e.button !== 0 || !sc || !sc.contains(e.target) || host.contains(e.target) && e.target.closest('.txt, .row > :not(.handle):not(.lead)') ) return;
    if (host.contains(e.target) && e.target.closest('.block')) return; // dans un bloc : sélection de texte (voir plus bas), pas de rectangle
    if (e.target.closest('.title, .props, .page-controls, .page-icon, .topbar, button, a, input, select, textarea, [contenteditable="true"], .blk-bar, .ctx-menu, .modal, .tail, .inline-db-body')) return;
    const x0 = e.clientX, y0 = e.clientY, base = new Set(e.ctrlKey || e.metaKey || e.shiftKey ? sel : []);
    let band = null;
    const move = (ev) => {
      if (!band && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!band) { band = h('div', { class: 'rubber' }); document.body.append(band); getSelection().removeAllRanges(); }
      const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY), w = Math.abs(ev.clientX - x0), hh = Math.abs(ev.clientY - y0);
      Object.assign(band.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: hh + 'px' });
      sel.clear(); base.forEach((i) => sel.add(i));
      host.querySelectorAll('.block').forEach((b) => { const r = b.querySelector(':scope > .row')?.getBoundingClientRect(); if (r && r.right >= l && r.left <= l + w && r.bottom >= t && r.top <= t + hh) sel.add(b.dataset.id); });
      paintSel();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up, true); band?.remove(); if (!band && !(e.ctrlKey || e.metaKey || e.shiftKey)) clearSel(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up, true);
    if (!host.contains(e.target)) e.preventDefault();
  };
  const onSelKey = (e) => {
    if (!sel.size || isControl(e.target) || e.target.closest?.('.modal, .palette')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { clearSel(); return; }
    if (!editable) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); deleteSel(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); eachTop((i) => { i.arr.splice(i.i + 1, 0, cloneNode(i.node)); }); afterSel(); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); moveSel(e.key === 'ArrowUp' ? -1 : 1); }
    else if (!mod && !e.altKey && e.key.length === 1) clearSel(); // on se remet à écrire
  };
  document.addEventListener('mousedown', onBandDown); document.addEventListener('keydown', onSelKey, true);

  if (editable && !tree.length) tree.push(newBlock('paragraph')); // page vide : un premier bloc prêt à écrire
  snap = JSON.stringify(tree);
  render();
  if (editable) mo.observe(host, { subtree: true, childList: true, characterData: true });
  return {
    getFlat: () => flatten(tree),
    setCommentMarks: (list) => { commentMarks = (list || []).filter((c) => c.quote && c.anchor != null && c.block_id); paintMarks(); },
    setComments: (counts) => { commentCounts = counts || {}; rendering = true; decorateComments(); mo.takeRecords(); rendering = false; },
    scrollToBlock: (id) => { const el = blockEl(id); if (!el) return false; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); return true; },
    insertBlockAt: (type, at = 0) => { if (!editable) return; const nb = newBlock(type, BLOCK_DEFAULTS[type]?.() || {}); tree.splice(Math.min(at, tree.length), 0, nb); render(); changed(); },
    focusFirst: () => { const f = tree[0]; if (f && editable) focusBlock(f.id, 'end'); },
    destroy: () => { selBar.remove(); document.removeEventListener('mousedown', onBandDown); document.removeEventListener('mousedown', onLeadDown, true); document.removeEventListener('keydown', onSelKey, true); document.querySelectorAll('.rubber,.sel-pop').forEach((x) => x.remove()); pop.remove(); document.removeEventListener('mousedown', onDocDown); mo.disconnect(); clearTimeout(syncTimer); document.removeEventListener('selectionchange', onSel); menu.remove(); bar.remove(); host.replaceChildren(); },
  };
}
