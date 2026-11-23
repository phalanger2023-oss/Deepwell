// Export PDF d'une page : mise en page « papier » (marges, pagination automatique, numéros de page), via l'impression du navigateur
// (« Enregistrer au format PDF »). Option cours / addendum : titre sans matricule ni intitulé « Addendum ».
import { h, modal, toast } from './util.js';
import { api } from './api.js';
import { createEditor } from './editor.js';
import { prettify } from './dates.js';

/** « P.S.A. #0001-26-MTH — Les fractions » ou « Addendum #12 : Les fractions » → « Les fractions ». Si rien ne suit le préfixe (« Addendum du 3 mars »), le titre reste tel quel. */
export function simplifyTitle(raw) {
  const orig = String(raw || '').trim();
  let t = orig, changed = false;
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(/^(?:P\.?\s?S\.?\s?A\.?|Addend(?:um|a))\b\.?\s*/i, () => { changed = true; return ''; }); // préfixe
    t = t.replace(/^(?:n°\s*|no\.?\s*)?(?:#\s*[\w.\-/]+|\d{1,6}(?:[-/.][\w]+)+)\s*/i, ''); // matricule : #0001-26-MTH, 0001-26-MTH…
    t = t.replace(/^[\s\-–—:·|,.]+/, '');
    if (t === before) break;
  }
  if (!changed || !t || /^du\s/i.test(t)) return orig; // pas de nom derrière le préfixe : on ne dénature pas le titre
  return t;
}

const PAPER = { a4: 'A4', letter: 'Letter' };
const SIZES = { normal: '11pt', compact: '10pt', large: '12.5pt' };
const FONTS = { serif: "Georgia, 'Times New Roman', serif", sans: "'Helvetica Neue', Arial, 'Segoe UI', sans-serif", calibri: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif", mono: "'Courier New', Courier, monospace" };

function pageCss(o) {
  const m = o.margins === 'narrow' ? '12mm 12mm 16mm' : '20mm 18mm 22mm';
  return `@page { size: ${PAPER[o.paper]} ${o.orient}; margin: ${m};${o.numbers ? ' @bottom-center { content: counter(page) " / " counter(pages); font: 9pt system-ui, sans-serif; color: #777; }' : ''} }
#print-root { --pr-size: ${SIZES[o.size]}; --pr-font: ${FONTS[o.font] || FONTS.serif}; }`;
}

/** Construit le document imprimable (titre + contenu de chaque page) dans #print-root. */
async function buildDocs(docs, o, pageInfo) {
  document.getElementById('print-root')?.remove(); document.getElementById('print-style')?.remove();
  const root = h('div', { id: 'print-root', class: o.continuous ? 'pr-continuous' : 'pr-cols' });
  const style = h('style', { id: 'print-style' }, pageCss(o));
  document.head.append(style); document.body.append(root);
  // Papier = toujours les couleurs du thème clair (sinon un thème sombre imprime des cadres bleu nuit et du texte blanc)
  if (window.__prTheme === undefined) window.__prTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'light');
  const imgs = [];
  for (const [i, d] of docs.entries()) {
    const data = await api.get(`/api/pages/${d.id}`);
    const host = h('div', {});
    const sec = h('section', { class: `pr-doc${i ? ' pr-next' : ''}` }, h('h1', { class: 'pr-title' }, d.title || 'Sans titre'), host);
    root.append(sec);
    createEditor(host, { blocks: data.blocks, editable: false, openAll: o.expand, hooks: { pageInfo } });
    host.querySelectorAll('img').forEach((im) => imgs.push(im));
  }
  await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; })))); // images chargées avant l'impression
  return root;
}

export function cleanupPrint() {
  document.getElementById('print-root')?.remove(); document.getElementById('print-style')?.remove();
  if (window.__prTheme !== undefined) { // thème d'origine rétabli
    if (window.__prTheme === null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', window.__prTheme);
    window.__prTheme = undefined;
  }
}

/** Boîte de dialogue d'export. subpages : [{ id, title }] (sous-pages directes, ex. addenda). */
export function exportPdfDialog(page, { pageInfo, subpages = [], school = false, noPrint = false } = {}) {
  const isCourse = school || /^\s*(?:P\.?\s?S\.?\s?A\.?|Addend)/i.test(page.title || '');
  const ck = (checked) => h('input', { type: 'checkbox', checked: checked || null });
  const title = h('input', { class: 'input', type: 'text' });
  const simplify = ck(isCourse), withSubs = ck(false), expand = ck(true), numbers = ck(true), continuous = ck(false);
  const sel = (opts, v) => h('select', { class: 'input' }, opts.map(([k, l]) => h('option', { value: k, selected: k === v ? true : null }, l)));
  const paper = sel([['a4', 'A4'], ['letter', 'Lettre (US)']], 'a4'), orient = sel([['portrait', 'Portrait'], ['landscape', 'Paysage']], 'portrait');
  const font = sel([['serif', 'Serif (Georgia)'], ['sans', 'Sans empattement (Arial)'], ['calibri', 'Calibri'], ['mono', 'Machine à écrire']], 'serif');
  const size = sel([['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Grand']], 'normal'), margins = sel([['normal', 'Normales'], ['narrow', 'Étroites']], 'normal');
  const info = h('div', { class: 'muted small pr-info' });
  const titleOf = (raw) => (simplify.checked ? simplifyTitle(prettify(raw)) : prettify(raw)) || 'Sans titre';
  let edited = false;
  const refresh = () => {
    if (!edited) title.value = titleOf(page.title);
    info.textContent = withSubs.checked && subpages.length ? `Sous-pages à la suite (une par page) : ${subpages.map((s) => titleOf(s.title)).join(' · ')}` : '';
  };
  title.addEventListener('input', () => { edited = true; });
  simplify.addEventListener('change', () => { edited = false; refresh(); }); withSubs.addEventListener('change', refresh);
  refresh();
  const row = (label, ctl) => h('label', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, label), ctl);
  const chk = (c, label) => h('label', { class: 'pr-chk' }, c, ' ', label);
  const m = modal('Exporter en PDF', h('div', { class: 'btn-dlg pr-dlg' },
    h('p', { class: 'muted small' }, 'Mise en page pour le papier : marges, retours à la ligne et changements de page automatiques. Dans la fenêtre d’impression qui s’ouvre, choisissez « Enregistrer au format PDF » comme imprimante.'),
    row('Titre en tête du document', title),
    isCourse ? chk(simplify, 'Titre simplifié : retirer le matricule (P.S.A. #…) et l’intitulé « Addendum », garder le nom qui suit') : null,
    subpages.length ? chk(withSubs, `Inclure les sous-pages à la suite (${subpages.length}) — addenda, chapitres…`) : null, info,
    chk(expand, 'Déplier tous les blocs dépliants'), chk(numbers, 'Numéroter les pages'),
    chk(continuous, 'Texte continu : empiler les colonnes (sinon elles restent côte à côte, comme à l’écran)'),
    h('div', { class: 'pr-grid' }, row('Papier', paper), row('Orientation', orient), row('Taille du texte', size), row('Marges', margins), row('Police', font)),
    h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler'),
      h('button', { class: 'btn primary', onclick: async () => {
        const o = { paper: paper.value, orient: orient.value, size: size.value, margins: margins.value, numbers: numbers.checked, expand: expand.checked, font: font.value, continuous: continuous.checked };
        const docs = [{ id: page.id, title: title.value.trim() || titleOf(page.title) }];
        if (withSubs.checked) for (const s of subpages) docs.push({ id: s.id, title: titleOf(s.title) });
        m.close();
        try {
          await buildDocs(docs, o, pageInfo);
          if (!noPrint) { window.addEventListener('afterprint', cleanupPrint, { once: true }); setTimeout(() => window.print(), 100); }
        } catch (e) { cleanupPrint(); toast(e.message || 'Export impossible', 'error'); }
      } }, 'Exporter'))));
  return m;
}
