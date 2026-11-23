/** Vue tableau d'une base de données. Les propriétés sont au format Notion (types conservés à l'import). */
import { h, ask, modal, toast, safeUrl, confirmBox } from './util.js';
import { rtPlain, plainRt, richTitleNodes } from './richtext.js';
import { titleToDom, domToRt, attachTitleMentions } from './titlemention.js';
import { api } from './api.js';
import { formatDate, prettify, pickDate } from './dates.js';
import { openOptionPicker, optChip } from './optpicker.js';
import { vi } from './icons.js';

const EDITABLE = ['title', 'rich_text', 'number', 'unique_id', 'select', 'status', 'multi_select', 'checkbox', 'date', 'url', 'email', 'phone_number'];
const TYPE_LABELS = { title: 'Titre', rich_text: 'Texte', number: 'Nombre', select: 'Sélection', multi_select: 'Multi-sélection', checkbox: 'Case à cocher', date: 'Date', url: 'URL', email: 'E-mail', phone_number: 'Téléphone' };
/** Icône (Lucide) du type d'une propriété, affichée devant son nom. */
export const typeIcon = (t) => ({ title: 'type', rich_text: 'align-left', number: 'hash', select: 'chevron-down', status: 'list-checks', multi_select: 'list', date: 'calendar', checkbox: 'square-check', url: 'link-2', email: 'at-sign', phone_number: 'phone', people: 'users', files: 'paperclip', relation: 'arrow-up-right', formula: 'sigma', rollup: 'sigma', created_time: 'clock', last_edited_time: 'clock', created_by: 'user', last_edited_by: 'user' }[t] || 'tag');
const NEW_TYPES = Object.keys(TYPE_LABELS).filter((t) => t !== 'title');

export function propText(p) {
  if (!p) return '';
  const v = p[p.type];
  switch (p.type) {
    case 'title': return prettify(rtPlain(v));
    case 'rich_text': return rtPlain(v);
    case 'number': return v == null ? '' : String(v);
    case 'select': case 'status': return v?.name || '';
    case 'multi_select': return (v || []).map((o) => o.name).join(', ');
    case 'date': return v ? formatDate(v) : ''; // dans le fuseau horaire de l'utilisateur
    case 'created_time': case 'last_edited_time': return v ? formatDate(v) : '';
    case 'checkbox': return v ? '✓' : '';
    case 'people': return (v || []).map(userLabel).join(', ');
    case 'files': return (v || []).map((f) => f.name).join(', ');
    case 'relation': return v?.length ? `${v.length} lié(s)` : '';
    case 'formula': return v ? (v.type === 'date' ? formatDate(v.date) : String(v[v.type] ?? '')) : '';
    case 'rollup': return v ? (v.type === 'array' ? `${v.array.length} valeur(s)` : v.type === 'date' ? formatDate(v.date) : String(v[v.type] ?? '')) : '';
    case 'unique_id': return v ? `${v.prefix ? `${v.prefix}-` : ''}${v.number}` : '';
    case 'created_by': case 'last_edited_by': return v ? userLabel(v) : '';
    default: return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  }
}

/** Valeur numérique d'une propriété (Nombre, ID unique) pour le tri ; null si vide ou non numérique. */
export function numKey(p) {
  if (!p) return null;
  const n = p.type === 'number' ? p.number : p.type === 'unique_id' ? p.unique_id?.number : null;
  return Number.isFinite(n) ? n : null;
}
/** Comparaison pour le tri d'une base : numérique pour les nombres et ID (vides toujours en dernier), sinon alphabétique « humain ». */
export function compareProps(a, b, dir = 'asc') {
  const na = numKey(a), nb = numKey(b), sgn = dir === 'desc' ? -1 : 1;
  if (a?.type === 'number' || a?.type === 'unique_id' || b?.type === 'number' || b?.type === 'unique_id') {
    if (na == null && nb == null) return 0;
    if (na == null) return 1; if (nb == null) return -1;
    return (na - nb) * sgn;
  }
  return sortKey(a).localeCompare(sortKey(b), 'fr', { numeric: true }) * sgn;
}

/** Clé de tri : les dates se trient sur l'instant, pas sur le texte affiché. */
export function sortKey(p) {
  if (!p) return '';
  if (p.type === 'date') return p.date?.start || '';
  if (p.type === 'created_time' || p.type === 'last_edited_time') return p[p.type] || '';
  return propText(p);
}

/** Nom lisible d'un utilisateur (les imports n'ont parfois qu'un identifiant : on évite d'afficher un UUID). */
export function userLabel(u) { const n = u?.name || u?.email || ''; if (n) return n; const id = String(u?.id || ''); return !id || /^[0-9a-f-]{16,}$/i.test(id) ? 'Utilisateur' : id; }

export function titleKey(schema) { return Object.keys(schema).find((k) => schema[k].type === 'title') || 'Name'; }

/** Cellule éditable pour une valeur de propriété. `commit(newProp)` enregistre. */
export function propEditor(def, prop, editable, commit, onSchema) {
  const type = def.type, cur = prop?.[type];
  const ro = !editable || !EDITABLE.includes(type);
  if (ro) {
    const nodes = (type === 'title' || type === 'rich_text') ? richTitleNodes(cur) : null; // dates et mentions lisibles, comme dans les aperçus
    if (type === 'people' || type === 'created_by' || type === 'last_edited_by') { const us = type === 'people' ? cur || [] : cur ? [cur] : []; return h('span', { class: 'cell-ro chips' }, us.length ? us.map((u) => h('span', { class: 'person-chip', title: userLabel(u) }, h('span', { class: 'person-dot' }, userLabel(u).slice(0, 1).toUpperCase()), userLabel(u))) : h('span', { class: 'opt-empty' }, 'Vide')); }
    return h('span', { class: `cell-ro${nodes ? ' rt-title' : ''}` }, ...(nodes || [propText(prop)]));
  }
  const field = (el) => { el.classList.add('cell-input'); return el; };
  switch (type) {
    case 'title': case 'rich_text': {
      // zone de texte sur une ligne : « @ » insère une date ou une mention de page ; les mentions existantes sont conservées à l'édition
      const rt0 = Array.isArray(cur) ? cur : [];
      const el = field(h('div', { class: 'cell-input cell-rich', contenteditable: 'true', role: 'textbox', 'aria-label': 'Texte' }));
      titleToDom(el, rt0.length || type !== 'title' ? rt0 : []);
      if (type === 'title' && !rt0.some((r) => r.type === 'mention')) el.textContent = prettify(rtPlain(rt0));
      const snap = () => JSON.stringify(domToRt(el));
      let base = snap();
      attachTitleMentions(el, { searchPages: (q) => api.get(`/api/pages/search?q=${encodeURIComponent(q)}`) });
      el.addEventListener('keydown', (e) => { if (e.defaultPrevented) return; if (e.key === 'Enter') { e.preventDefault(); el.blur(); } else if (e.key === 'Escape') { titleToDom(el, JSON.parse(base)); el.blur(); } });
      el.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\s*\n+\s*/g, ' ')); });
      el.addEventListener('blur', () => { setTimeout(() => { const now = snap(); if (now === base) return; base = now; commit({ type, [type]: domToRt(el) }); }, 0); });
      return el;
    }
    case 'url': case 'email': case 'phone_number': {
      const i = field(h('input', { type: 'text', value: cur || '' }));
      i.addEventListener('change', () => commit({ type, [type]: i.value || null }));
      return i;
    }
    case 'number': {
      const i = field(h('input', { type: 'number', step: 'any', value: cur ?? '' }));
      i.addEventListener('change', () => commit({ type, number: i.value === '' ? null : Number(i.value) }));
      return i;
    }
    case 'unique_id': {
      const pre = def.unique_id?.prefix ?? cur?.prefix ?? '';
      const i = field(h('input', { type: 'number', step: '1', min: '0', value: cur?.number ?? '', title: 'Numéro (modifiable à la main)', class: 'cell-input uid-num' }));
      i.addEventListener('change', () => commit({ type, unique_id: i.value === '' ? null : { prefix: pre || null, number: Math.trunc(Number(i.value)) } }));
      return h('div', { class: 'uid-cell' }, pre ? h('span', { class: 'muted' }, pre + '-') : null, i);
    }
    case 'checkbox': {
      const i = h('input', { type: 'checkbox' }); i.checked = !!cur;
      i.addEventListener('change', () => commit({ type, checkbox: i.checked }));
      return i;
    }
    case 'date': {
      // affichage lisible (date, heure, fin) ; un clic ouvre la fenêtre de choix (date, heure facultative, fin) dans le fuseau de l'utilisateur
      const b = h('button', { type: 'button', class: 'cell-input date-btn', title: 'Choisir la date' }, cur?.start ? [vi('calendar', 14), h('span', {}, formatDate(cur))] : [h('span', { class: 'opt-empty' }, 'Vide')]);
      b.addEventListener('click', async () => {
        const d = await pickDate(cur || {}); if (!d) return;
        commit({ type, date: d.remove ? null : { start: d.start, end: d.end ?? null, time_zone: null } });
      });
      return b;
    }
    case 'select': case 'status': case 'multi_select': {
      // liste « à la Notion » : pastilles colorées, recherche, création (voir optpicker.js)
      const multi = type === 'multi_select';
      def[type] = def[type] || {}; def[type].options = def[type].options || [];
      const box = h('button', { type: 'button', class: 'opt-trigger cell-input', 'aria-haspopup': 'listbox' });
      let value = multi ? cur || [] : cur ? [cur] : [];
      const draw = () => {
        box.replaceChildren(...(value.length ? value.map((o) => optChip(o, def[type])) : [h('span', { class: 'opt-empty' }, 'Vide')]));
      };
      box.addEventListener('click', () => openOptionPicker({
        anchor: box, def: def[type], multi, selected: value.map((o) => o.name), onSchema,
        onChange: (names) => {
          value = names.map((n) => def[type].options.find((o) => o.name === n) || { name: n, color: 'default' });
          draw(); commit({ type, [type]: multi ? value : value[0] || null });
        } }));
      draw(); return box;
    }
  }
}
