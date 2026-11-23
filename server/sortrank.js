/**
 * Rang de tri des lignes verrouillées. Une ligne verrouillée n'est pas lue par le client (titre et propriétés masqués) : il ne pouvait donc
 * pas la trier et elle tombait en bas. Le serveur, lui, connaît ses valeurs : il ne renvoie QUE sa position (0 = premier) parmi toutes les
 * lignes de la base pour chaque propriété triable — jamais les valeurs. Même règle que `compareProps` côté client (nombres d'abord, vides en dernier).
 */
const rtPlain = (v) => (v || []).map((r) => r.plain_text ?? r.text?.content ?? '').join('');
const label = (u) => u?.name || u?.email || '';
function text(p) {
  if (!p) return '';
  const v = p[p.type];
  switch (p.type) {
    case 'title': case 'rich_text': return rtPlain(v);
    case 'number': return v == null ? '' : String(v);
    case 'select': case 'status': return v?.name || '';
    case 'multi_select': return (v || []).map((o) => o.name).join(', ');
    case 'date': return v?.start || '';
    case 'created_time': case 'last_edited_time': return v || '';
    case 'checkbox': return v ? '✓' : '';
    case 'people': return (v || []).map(label).join(', ');
    case 'unique_id': return v ? `${v.prefix ? `${v.prefix}-` : ''}${v.number}` : '';
    case 'created_by': case 'last_edited_by': return v ? label(v) : '';
    default: return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  }
}
const num = (p) => { if (!p) return null; const n = p.type === 'number' ? p.number : p.type === 'unique_id' ? p.unique_id?.number : null; return Number.isFinite(n) ? n : null; };
const isNum = (p) => p?.type === 'number' || p?.type === 'unique_id';
function compare(a, b) {
  if (isNum(a) || isNum(b)) { const x = num(a), y = num(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return x - y; }
  return text(a).localeCompare(text(b), 'fr', { numeric: true });
}
/** rows : [{ id, props }] (valeurs complètes) ; renvoie Map(id → { propriété: position }) pour les ids demandés. */
export function sortRanks(rows, wantedIds, propNames) {
  const out = new Map(wantedIds.map((id) => [id, {}]));
  for (const name of propNames) {
    const order = [...rows].sort((r1, r2) => compare(r1.props?.[name], r2.props?.[name]));
    order.forEach((r, i) => { if (out.has(r.id)) out.get(r.id)[name] = i; });
  }
  return out;
}
