/** Graphiques SVG sans dépendance : barres, barres horizontales, courbe, aire, anneau, camembert. */
import { h, modal } from './util.js';
import { propText } from './database.js';

export const CHART_TYPES = [['bar', 'Barres', 'chart-column'], ['hbar', 'Barres horizontales', 'chart-bar'], ['line', 'Courbe', 'chart-line'], ['area', 'Aire', 'chart-area'], ['donut', 'Anneau', 'chart-pie'], ['pie', 'Camembert', 'chart-pie']];
export const PALETTES = {
  notion: ['#2383e2', '#e56b6f', '#f0a202', '#4daa57', '#9065b0', '#c14c8a', '#448361', '#9f6b53', '#787774', '#d9730d'],
  pastel: ['#8ecae6', '#ffb4a2', '#ffd166', '#b5e48c', '#cdb4db', '#f4acb7', '#a8dadc', '#e9c46a', '#d6ccc2', '#bde0fe'],
  sobre: ['#37352f', '#787774', '#9b9a97', '#b9b7b2', '#d3d1cb', '#e3e2e0', '#5a5853', '#8b8985', '#a8a6a1', '#c7c5bf'],
};
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const fmt = (n) => (Math.abs(n) >= 1000 ? new Intl.NumberFormat(navigator.language || 'fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : String(Math.round(n * 100) / 100));
const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Graduations « rondes » : { max, step }. */
export function niceScale(maxValue, ticks = 5) {
  if (!(maxValue > 0)) return { max: 1, step: 0.2 };
  const raw = maxValue / ticks, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(maxValue / step) * step, step };
}

/**
 * Dessine un graphique. cfg : { type, labels:[], series:[{name, values:[]}], title, palette, showLegend, showValues }
 * Retourne un <div class="chart"> (SVG + légende) ; les couleurs de texte/grille suivent le thème.
 */
export function renderChart(cfg) {
  const type = cfg.type || 'bar', labels = cfg.labels || [], series = (cfg.series || []).filter((s) => s.values?.length || labels.length);
  const colors = PALETTES[cfg.palette] || PALETTES.notion, color = (i) => colors[i % colors.length];
  const box = h('div', { class: `chart chart-${type}` });
  if (cfg.title) box.append(h('div', { class: 'chart-title' }, cfg.title));
  if (!labels.length || !series.length) { box.append(h('div', { class: 'chart-empty' }, 'Aucune donnée à afficher')); return box; }
  const W = 640, H = 300;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': cfg.title || 'Graphique' });
  const legendItems = [];

  if (type === 'pie' || type === 'donut') {
    const s = series[0], total = s.values.reduce((a, b) => a + Math.max(0, +b || 0), 0) || 1;
    const cx = 160, cy = H / 2, R = 120, r = type === 'donut' ? 72 : 0;
    let ang = -Math.PI / 2;
    s.values.forEach((v0, i) => {
      const v = Math.max(0, +v0 || 0); if (!v) return;
      const a2 = ang + (v / total) * Math.PI * 2, big = a2 - ang > Math.PI ? 1 : 0;
      const P = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      const [x1, y1] = P(R, ang), [x2, y2] = P(R, a2), [x3, y3] = P(r, a2), [x4, y4] = P(r, ang);
      const d = v / total >= 0.9999 ? `M ${cx - R} ${cy} a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 ${r ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 1 ${2 * r} 0 a ${r} ${r} 0 1 1 ${-2 * r} 0` : ''} Z`
        : `M ${x1} ${y1} A ${R} ${R} 0 ${big} 1 ${x2} ${y2} ${r ? `L ${x3} ${y3} A ${r} ${r} 0 ${big} 0 ${x4} ${y4}` : `L ${cx} ${cy}`} Z`;
      svg.append(el('path', { d, fill: color(i), 'fill-rule': 'evenodd', stroke: 'var(--bg)', 'stroke-width': 2 }, el('title', {}, `${labels[i]} : ${fmt(v)} (${Math.round((v / total) * 100)} %)`)));
      if (cfg.showValues && v / total > 0.05) { const [tx, ty] = P(r ? (R + r) / 2 : R * 0.65, (ang + a2) / 2); svg.append(el('text', { x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': 13, 'font-weight': 600 }, `${Math.round((v / total) * 100)}%`)); }
      ang = a2;
    });
    if (type === 'donut') svg.append(el('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'chart-total', 'font-size': 26, 'font-weight': 600, fill: 'currentColor' }, fmt(total)), el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor', opacity: .55 }, s.name || 'Total'));
    labels.forEach((l, i) => legendItems.push([color(i), `${l} — ${fmt(+s.values[i] || 0)}`]));
  } else {
    const horizontal = type === 'hbar';
    const m = { l: horizontal ? 96 : 46, r: 16, t: 14, b: horizontal ? 28 : 44 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = series.flatMap((s) => s.values.map((v) => +v || 0));
    const { max, step } = niceScale(Math.max(0, ...all));
    const n = labels.length, vx = (v) => (v / max) * (horizontal ? iw : ih);
    for (let v = 0; v <= max + 1e-9; v += step) {
      const p = horizontal ? m.l + vx(v) : m.t + ih - vx(v);
      svg.append(horizontal ? el('line', { x1: p, x2: p, y1: m.t, y2: m.t + ih, stroke: 'currentColor', opacity: v ? 0.08 : 0.25 }) : el('line', { x1: m.l, x2: m.l + iw, y1: p, y2: p, stroke: 'currentColor', opacity: v ? 0.08 : 0.25 }),
        horizontal ? el('text', { x: p, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor', opacity: 0.55 }, fmt(v)) : el('text', { x: m.l - 8, y: p + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'currentColor', opacity: 0.55 }, fmt(v)));
    }
    const band = (horizontal ? ih : iw) / n;
    labels.forEach((l, i) => {
      const c = (horizontal ? m.t + band * (i + 0.5) : m.l + band * (i + 0.5));
      svg.append(el('text', horizontal ? { x: m.l - 8, y: c + 4, 'text-anchor': 'end', 'font-size': 12, fill: 'currentColor', opacity: 0.7 } : { x: c, y: H - m.b + 18, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor', opacity: 0.7 }, trunc(l, horizontal ? 14 : Math.max(6, Math.floor(band / 7))), el('title', {}, l)));
    });
    if (type === 'bar' || type === 'hbar') {
      const k = series.length, gw = band * 0.72, bw = gw / k;
      series.forEach((s, si) => s.values.forEach((v0, i) => {
        const v = +v0 || 0, off = (band - gw) / 2 + si * bw, len = Math.max(0, vx(v));
        const attrs = horizontal ? { x: m.l, y: m.t + band * i + off, width: len, height: bw - 2 } : { x: m.l + band * i + off, y: m.t + ih - len, width: bw - 2, height: len };
        svg.append(el('rect', { ...attrs, rx: 3, fill: color(k > 1 || cfg.varyColors === false ? si : (cfg.varyColors ? i : si)) }, el('title', {}, `${labels[i]} — ${s.name || ''} : ${fmt(v)}`)));
        if (cfg.showValues) svg.append(el('text', horizontal ? { x: m.l + len + 5, y: m.t + band * i + off + bw / 2 + 3, 'font-size': 11, fill: 'currentColor', opacity: 0.8 } : { x: m.l + band * i + off + bw / 2, y: m.t + ih - len - 5, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor', opacity: 0.8 }, fmt(v)));
      }));
    } else {
      series.forEach((s, si) => {
        const pts = s.values.map((v0, i) => [m.l + band * (i + 0.5), m.t + ih - vx(+v0 || 0), +v0 || 0]);
        const path = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
        if (type === 'area') svg.append(el('path', { d: `${path} L ${pts.at(-1)[0]} ${m.t + ih} L ${pts[0][0]} ${m.t + ih} Z`, fill: color(si), opacity: 0.16 }));
        svg.append(el('path', { d: path, fill: 'none', stroke: color(si), 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        pts.forEach((p, i) => { svg.append(el('circle', { cx: p[0], cy: p[1], r: 4, fill: 'var(--bg)', stroke: color(si), 'stroke-width': 2 }, el('title', {}, `${labels[i]} — ${s.name || ''} : ${fmt(p[2])}`))); if (cfg.showValues) svg.append(el('text', { x: p[0], y: p[1] - 9, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor', opacity: 0.8 }, fmt(p[2]))); });
      });
    }
    if (series.length > 1 || cfg.showLegend) series.forEach((s, i) => legendItems.push([color(i), s.name || `Série ${i + 1}`]));
  }
  box.append(svg);
  if (cfg.showLegend !== false && legendItems.length > (type === 'pie' || type === 'donut' ? 0 : 0)) box.append(h('div', { class: 'chart-legend' }, legendItems.map(([c, t]) => h('span', {}, h('i', { style: `background:${c}` }), t))));
  return box;
}

/** Agrège les lignes d'une base : { labels, series } à partir d'une propriété « catégorie » (x) et d'un comptage ou d'une somme (y). */
export function aggregate(rows, schema, cfg) {
  const x = cfg.x, def = schema?.[x], sums = new Map(), counts = new Map();
  const keysOf = (r) => {
    const p = x === '__title' ? { type: 'title', title: [{ plain_text: r.title }] } : r.props?.[x];
    if (!p) return ['(vide)'];
    switch (p.type) {
      case 'select': case 'status': return [p[p.type]?.name || '(vide)'];
      case 'multi_select': return p.multi_select?.length ? p.multi_select.map((o) => o.name) : ['(vide)'];
      case 'checkbox': return [p.checkbox ? 'Oui' : 'Non'];
      case 'date': return [p.date?.start ? p.date.start.slice(0, 7) : '(vide)'];
      default: return [propText(p) || '(vide)'];
    }
  };
  for (const r of rows) {
    const yv = cfg.y === 'sum' ? Number(r.props?.[cfg.yProp]?.number ?? r.props?.[cfg.yProp]?.formula?.number ?? 0) || 0 : 1;
    for (const k of keysOf(r)) { counts.set(k, (counts.get(k) || 0) + 1); sums.set(k, (sums.get(k) || 0) + yv); }
  }
  let labels = [...sums.keys()];
  const opts = def?.[def.type]?.options?.map((o) => o.name) || [];
  if (opts.length) labels.sort((a, b) => (opts.indexOf(a) + 1 || 1e9) - (opts.indexOf(b) + 1 || 1e9));
  else if (def?.type === 'date' || def?.type === 'number') labels.sort();
  else labels.sort((a, b) => (sums.get(b) || 0) - (sums.get(a) || 0));
  return { labels, series: [{ name: cfg.y === 'sum' ? `Somme de ${cfg.yProp}` : 'Nombre', values: labels.map((l) => sums.get(l) || 0) }] };
}

/** Fenêtre de configuration d'un bloc graphique. Résout le nouveau contenu du bloc ou null. */
export function chartDialog(content, hooks) {
  return new Promise((resolve) => {
    const c = JSON.parse(JSON.stringify(content));
    c.source ||= { type: 'manual', labels: [], series: [] };
    let done = false, dbData = null;
    const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const toText = (s) => [['Libellé', ...(s.series || []).map((x) => x.name)].join(';'), ...(s.labels || []).map((l, i) => [l, ...(s.series || []).map((x) => x.values[i] ?? '')].join(';'))].join('\n');
    const fromText = (t) => {
      const lines = t.split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length) return { labels: [], series: [] };
      const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
      const rows = lines.map((l) => l.split(sep).map((x) => x.trim())), head = rows[0], body = rows.slice(1);
      return { labels: body.map((r) => r[0] ?? ''), series: head.slice(1).map((name, si) => ({ name, values: body.map((r) => Number(String(r[si + 1] ?? '').replace(',', '.')) || 0) })) };
    };
    const preview = h('div', { class: 'chart-preview' });
    const sel = (opts, cur) => h('select', { class: 'input' }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    const field = (label, input, help) => h('label', { class: 'field' }, h('span', {}, label), input, help ? h('small', { class: 'muted' }, help) : null);

    const types = h('div', { class: 'chart-types' }, CHART_TYPES.map(([k, l]) => h('button', { type: 'button', class: k === c.chart_type ? 'on' : '', title: l, onclick: () => { c.chart_type = k; types.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', CHART_TYPES[i][0] === k)); redraw(); } }, l)));
    const title = h('input', { class: 'input', value: c.title || '', placeholder: 'Titre (facultatif)', oninput: (e) => { c.title = e.target.value; redraw(); } });
    const palette = sel([['notion', 'Couleurs vives'], ['pastel', 'Pastel'], ['sobre', 'Sobre (gris)']], c.palette || 'notion'); palette.onchange = () => { c.palette = palette.value; redraw(); };
    const chk = (key, label, def) => { const i = h('input', { type: 'checkbox' }); i.checked = c[key] ?? def; i.onchange = () => { c[key] = i.checked; redraw(); }; return h('label', { class: 'check' }, i, label); };

    const srcType = sel([['manual', 'Saisie manuelle'], ['database', 'Une base de données']], c.source.type); srcType.onchange = () => { c.source.type = srcType.value; drawSource(); redraw(); };
    const srcBox = h('div', {});
    async function drawSource() {
      if (c.source.type === 'manual') {
        const ta = h('textarea', { class: 'input code', rows: 8, spellcheck: false, oninput: () => { Object.assign(c.source, fromText(ta.value)); redraw(); } }, toText(c.source));
        srcBox.replaceChildren(field('Données', ta, 'Une ligne par catégorie : « Libellé ; valeur ; valeur… ». La première ligne donne le nom des séries. Séparateur : point-virgule, tabulation ou virgule.'));
      } else {
        const dbs = (await hooks.listDatabases?.()) || [];
        const dbSel = sel([['', '— choisir une base —'], ...dbs.map((d) => [d.id, d.title || 'Sans titre'])], c.source.database_id || '');
        const xSel = h('select', { class: 'input' }), ySel = sel([['count', 'Nombre de lignes'], ['sum', 'Somme d’une propriété numérique']], c.source.y || 'count'), yProp = h('select', { class: 'input' });
        const yField = field('Propriété à additionner', yProp);
        const syncY = () => { yField.hidden = ySel.value !== 'sum'; };
        const fill = async () => {
          dbData = c.source.database_id ? await hooks.loadDatabase(c.source.database_id).catch(() => null) : null;
          const props = Object.keys(dbData?.schema || {});
          xSel.replaceChildren(h('option', { value: '__title' }, 'Titre de la ligne'), ...props.map((p) => h('option', { value: p, selected: p === c.source.x }, p)));
          yProp.replaceChildren(...props.filter((p) => ['number', 'formula', 'rollup'].includes(dbData.schema[p].type)).map((p) => h('option', { value: p, selected: p === c.source.y_prop }, p)));
          if (!c.source.x || (c.source.x !== '__title' && !props.includes(c.source.x))) c.source.x = props.find((p) => ['select', 'status'].includes(dbData.schema[p].type)) || props[0] || '__title';
          xSel.value = c.source.x; c.source.y_prop = yProp.value || null; syncY(); redraw();
        };
        dbSel.onchange = () => { c.source.database_id = dbSel.value; fill(); };
        xSel.onchange = () => { c.source.x = xSel.value; redraw(); };
        ySel.onchange = () => { c.source.y = ySel.value; syncY(); redraw(); };
        yProp.onchange = () => { c.source.y_prop = yProp.value; redraw(); };
        srcBox.replaceChildren(field('Base de données', dbSel), field('Regrouper par (axe horizontal)', xSel), field('Valeur', ySel), yField);
        syncY(); if (c.source.database_id) fill();
      }
    }
    async function redraw() {
      const cfg = { type: c.chart_type, title: c.title, palette: c.palette, showLegend: c.show_legend !== false, showValues: !!c.show_values, varyColors: c.vary_colors };
      if (c.source.type === 'database') {
        if (!dbData) { preview.replaceChildren(h('div', { class: 'chart-empty' }, 'Choisissez une base de données')); return; }
        Object.assign(cfg, aggregate(dbData.rows, dbData.schema, { x: c.source.x, y: c.source.y, yProp: c.source.y_prop }));
      } else Object.assign(cfg, { labels: c.source.labels || [], series: c.source.series || [] });
      preview.replaceChildren(renderChart(cfg));
    }
    const m = modal('Graphique', h('div', { class: 'chart-dialog' },
      h('div', { class: 'chart-form' }, field('Type', types), field('Titre', title), field('Source des données', srcType), srcBox, field('Palette', palette),
        h('div', { class: 'chk-row' }, chk('show_legend', 'Légende', true), chk('show_values', 'Valeurs', false), chk('vary_colors', 'Une couleur par barre', false))),
      h('div', { class: 'chart-side' }, h('div', { class: 'muted small' }, 'Aperçu'), preview)), { wide: true, onClose: () => finish(null) });
    m.el.querySelector('.modal-body').append(h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => finish(null) }, 'Annuler'), h('button', { class: 'btn primary', onclick: () => finish(c) }, 'Enregistrer')));
    drawSource(); redraw();
  });
}
