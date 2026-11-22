/** Vue tableau d'une base de données. Les propriétés sont au format Notion (types conservés à l'import). */
import { h, ask, modal, toast, safeUrl, confirmBox } from './util.js';
import { rtPlain, plainRt } from './richtext.js';
import { api } from './api.js';
import { formatDate, prettify, toInputs, fromInputs } from './dates.js';
import { openOptionPicker, optChip } from './optpicker.js';

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
    case 'people': return (v || []).map((u) => u.name || u.id).join(', ');
    case 'files': return (v || []).map((f) => f.name).join(', ');
    case 'relation': return v?.length ? `${v.length} lié(s)` : '';
    case 'formula': return v ? (v.type === 'date' ? formatDate(v.date) : String(v[v.type] ?? '')) : '';
    case 'rollup': return v ? (v.type === 'array' ? `${v.array.length} valeur(s)` : v.type === 'date' ? formatDate(v.date) : String(v[v.type] ?? '')) : '';
    case 'unique_id': return v ? `${v.prefix ? `${v.prefix}-` : ''}${v.number}` : '';
    case 'created_by': case 'last_edited_by': return v?.name || '';
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

export function titleKey(schema) { return Object.keys(schema).find((k) => schema[k].type === 'title') || 'Name'; }

/** Cellule éditable pour une valeur de propriété. `commit(newProp)` enregistre. */
export function propEditor(def, prop, editable, commit, onSchema) {
  const type = def.type, cur = prop?.[type];
  const ro = !editable || !EDITABLE.includes(type);
  if (ro) return h('span', { class: 'cell-ro' }, propText(prop));
  const field = (el) => { el.classList.add('cell-input'); return el; };
  switch (type) {
    case 'title': case 'rich_text': case 'url': case 'email': case 'phone_number': {
      const i = field(h('input', { type: 'text', value: type === 'url' || type === 'email' || type === 'phone_number' ? cur || '' : type === 'title' ? prettify(rtPlain(cur)) : rtPlain(cur) }));
      i.addEventListener('change', () => commit({ type, [type]: type === 'title' || type === 'rich_text' ? plainRt(i.value) : i.value || null }));
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
      // date + heure facultative, saisies et affichées dans le fuseau horaire de l'utilisateur ; la fin éventuelle est conservée
      const cur0 = toInputs(cur?.start, cur?.time_zone);
      const d = field(h('input', { type: 'date', value: cur0.date })), t = field(h('input', { type: 'time', value: cur0.time, class: 'cell-input time', title: 'Heure (dans votre fuseau horaire)' }));
      const save = () => commit({ type, date: d.value ? { start: fromInputs(d.value, t.value), end: cur?.end ?? null, time_zone: null } : null });
      d.addEventListener('change', save); t.addEventListener('change', save);
      return h('div', { class: 'date-cell' }, d, t, cur?.end ? h('span', { class: 'muted small', title: 'Fin' }, `→ ${formatDate({ start: cur.end, time_zone: cur.time_zone })}`) : null);
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
