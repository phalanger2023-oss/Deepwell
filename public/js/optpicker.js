/** Sélecteur d'options « à la Notion » pour les propriétés Sélection, Statut et Multi-sélection : liste de pastilles colorées, recherche, création. */
import { h } from './util.js';
import { ICON_COLORS, vi } from './icons.js';

const NEW_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'red', 'yellow', 'brown', 'gray'];
export const colorHex = (c) => ICON_COLORS[c] || '#9b9a97';
/** Pastille colorée d'une option (la couleur du schéma prime sur celle copiée dans la valeur). */
export const optChip = (o, def) => {
  const color = (def?.options || []).find((x) => x.name === o?.name)?.color ?? o?.color;
  return h('span', { class: 'chip opt-chip', style: `background:color-mix(in srgb, ${colorHex(color)} 24%, transparent)` }, o?.name ?? '');
};

/**
 * Ouvre la liste sous `anchor`.
 * def : { options: [{ name, color }] } (le schéma : de nouvelles options y sont ajoutées) ; selected : noms déjà choisis.
 * onChange(names) est appelé à chaque changement ; en mode simple, la liste se ferme après le choix.
 */
export function openOptionPicker({ anchor, def, multi, selected, onChange, onSchema }) {
  document.querySelectorAll('.opt-pop').forEach((p) => p.remove());
  const sel = new Set(selected || []);
  let active = 0, query = '';
  const search = h('input', { class: 'opt-search', placeholder: multi ? 'Rechercher ou créer une option…' : 'Choisir ou créer une option…', 'aria-label': 'Rechercher une option' });
  const list = h('div', { class: 'opt-list', role: 'listbox' });
  const pop = h('div', { class: 'opt-pop' }, search, list);
  const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };

  const rows = () => {
    const q = query.trim().toLowerCase(), opts = (def.options || []).filter((o) => !q || o.name.toLowerCase().includes(q));
    const out = opts.map((o) => ({ kind: 'opt', o }));
    if (q && !(def.options || []).some((o) => o.name.toLowerCase() === q)) out.push({ kind: 'new', name: query.trim() });
    if (!multi && sel.size && !q) out.unshift({ kind: 'clear' });
    return out;
  };
  const apply = async (r) => {
    if (r.kind === 'clear') { sel.clear(); onChange([]); close(); return; }
    let name = r.kind === 'new' ? r.name : r.o.name;
    if (r.kind === 'new') {
      def.options = [...(def.options || []), { name, color: NEW_COLORS[(def.options || []).length % NEW_COLORS.length] }];
      try { await onSchema?.(); } catch { /* l'enregistrement du schéma signalera lui-même l'erreur */ }
    }
    if (multi) { sel.has(name) ? sel.delete(name) : sel.add(name); onChange([...sel]); query = ''; search.value = ''; draw(); search.focus(); }
    else { sel.clear(); sel.add(name); onChange([name]); close(); }
  };
  function draw() {
    const rs = rows(); active = Math.max(0, Math.min(active, rs.length - 1));
    list.replaceChildren(...(rs.length ? rs.map((r, i) => {
      const row = h('div', { class: `opt-row ${i === active ? 'active' : ''}`, role: 'option', onmousedown: (e) => { e.preventDefault(); apply(r); }, onmouseenter: () => { active = i; list.querySelectorAll('.opt-row').forEach((x, j) => x.classList.toggle('active', j === i)); } });
      if (r.kind === 'clear') row.append(h('span', { class: 'muted' }, 'Aucune valeur'));
      else if (r.kind === 'new') row.append(h('span', { class: 'muted' }, 'Créer'), optChip({ name: r.name, color: NEW_COLORS[(def.options || []).length % NEW_COLORS.length] }));
      else { row.append(optChip(r.o, def), h('span', { class: 'ip-spacer' })); if (sel.has(r.o.name)) row.append(vi('check', 15)); }
      return row;
    }) : [h('div', { class: 'muted small pad' }, 'Aucune option. Tapez un nom pour en créer une.')]));
    list.querySelector('.opt-row.active')?.scrollIntoView({ block: 'nearest' });
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus?.(); return; }
    const n = rows().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, n); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + Math.max(1, n)) % Math.max(1, n); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows()[active]; if (r) apply(r); }
  };
  search.addEventListener('input', () => { query = search.value; active = 0; draw(); });
  document.body.append(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect(), w = Math.min(Math.max(r.width, 260), 340);
    pop.style.width = `${w}px`; pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    const below = innerHeight - r.bottom, h0 = Math.min(pop.offsetHeight, 330);
    pop.style.top = below >= h0 + 12 || below >= r.top ? `${r.bottom + 4}px` : `${Math.max(8, r.top - h0 - 4)}px`;
  };
  draw(); place(); search.focus();
  document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true);
  return { close };
}
