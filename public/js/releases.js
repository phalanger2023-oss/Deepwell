/** Page « Notes de version » : chargée à la demande (import dynamique depuis app.js), une seule requête à l'ouverture.
 *  Nouveautés depuis la dernière visite et dernière version dépliées, le reste replié ; filtre par type ; résumé chiffré par version. */
import { h, modal, toast } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';

const SECTIONS = [['nouveautes', 'Nouveautés', 'sparkles'], ['ameliorations', 'Améliorations', 'trending-up'], ['corrections', 'Corrections', 'wrench']];
const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : '');
const seenVersion = () => { try { return localStorage.getItem('dw_seen_version'); } catch { return null; } };

/** Fenêtre « Crédits » : lecture pour tous, formulaire libre (lignes « titre : texte » + citation) pour l'administrateur. */
async function openCredits() {
  let c; try { c = await api.get('/api/credits'); } catch (e) { return toast(e.message, 'error'); }
  const body = h('div', { class: 'credits' });
  const show = () => {
    const none = !c.lines.length && !c.quote;
    body.replaceChildren(...[
      none ? h('p', { class: 'muted' }, 'Aucun crédit renseigné pour l’instant.') : null,
      ...c.lines.map((l) => h('p', { class: 'credit-line' }, l.label ? h('span', { class: 'muted' }, `${l.label} `) : null, h('b', {}, l.value))),
      c.quote ? h('blockquote', { class: 'credit-quote' }, `« ${c.quote} »`, c.quote_author ? h('footer', { class: 'muted small' }, `— ${c.quote_author}`) : null) : null,
      c.editable ? h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: edit }, 'Modifier')) : null].filter(Boolean));
  };
  const edit = () => {
    const rows = h('div', {}), add = (l = { label: '', value: '' }) => {
      const label = h('input', { class: 'input', placeholder: 'Titre (ex. Réalisé par)', value: l.label, maxlength: 60 }), value = h('input', { class: 'input', placeholder: 'Texte (ex. Julien)', value: l.value, maxlength: 300 });
      const row = h('div', { class: 'pi-row credit-row' }, label, value, h('button', { class: 'icon-btn', title: 'Retirer cette ligne', onclick: () => row.remove() }, '✕'));
      row._get = () => ({ label: label.value, value: value.value }); rows.append(row);
    };
    (c.lines.length ? c.lines : [{ label: 'Réalisé par', value: '' }, { label: 'En partenariat avec', value: '' }]).forEach(add);
    const quote = h('textarea', { class: 'input', rows: 3, placeholder: 'Une citation, un petit mot…', maxlength: 500 }, c.quote), author = h('input', { class: 'input', placeholder: 'Auteur de la citation (facultatif)', value: c.quote_author, maxlength: 100 });
    body.replaceChildren(rows, h('button', { class: 'btn small', onclick: () => add() }, '+ Ajouter une ligne'), h('h4', {}, 'Citation'), quote, author,
      h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: show }, 'Annuler'),
        h('button', { class: 'btn primary', onclick: async () => { try { c = await api.put('/api/credits', { lines: [...rows.children].map((r) => r._get()), quote: quote.value, quote_author: author.value }); toast('Crédits enregistrés'); show(); } catch (e) { toast(e.message, 'error'); } } }, 'Enregistrer')));
  };
  show(); modal('Crédits', body);
}

export async function renderReleases(panel, currentVersion) {
  const list = await api.get('/api/releases');
  const seen = seenVersion(), seenIdx = list.findIndex((r) => r.version === seen);
  const isNew = (i) => i === 0 || (seenIdx > 0 && i < seenIdx); // dernière version + tout ce qui est plus récent que la dernière visite
  let filter = ''; // '' = tout
  const wrap = h('div', { class: 'rel-list' }), bar = h('div', { class: 'rel-filters' });
  const detailsOf = [];

  const draw = () => {
    bar.replaceChildren(
      ...[['', 'Tout', null], ...SECTIONS.map(([k, l, i]) => [k, l, i])].map(([k, l, i]) => h('button', { class: `rel-chip ${filter === k ? 'on' : ''}`, onclick: () => { filter = k; draw(); } }, i ? vi(i, 14) : null, l)),
      h('span', { class: 'rel-spacer' }),
      h('button', { class: 'btn small', onclick: openCredits }, vi('heart', 14), ' Crédits'),
      h('button', { class: 'btn small', onclick: () => { const open = detailsOf.some((d) => !d.open); detailsOf.forEach((d) => { d.open = open; }); } }, 'Tout déplier / replier'));
    detailsOf.length = 0;
    const rows = list.map((r, i) => {
      const secs = SECTIONS.filter(([k]) => r[k]?.length && (!filter || filter === k));
      if (!secs.length) return null;
      const d = h('details', { class: 'rel' },
        h('summary', { class: 'rel-head' }, h('h2', {}, `${r.alpha ? 'Alpha' : 'Version'} ${r.version}`),
          i === 0 ? h('span', { class: 'rel-tag' }, 'Dernière version') : null,
          r.date ? h('span', { class: 'muted small' }, fmt(r.date)) : null,
          h('span', { class: 'rel-counts muted small' }, SECTIONS.filter(([k]) => r[k]?.length).map(([k, l]) => `${r[k].length} ${l.toLowerCase()}`).join(' · '))),
        secs.map(([k, label, ico]) => h('div', { class: 'rel-block' }, h('h4', {}, vi(ico, 15), label), h('ul', {}, r[k].map((t) => h('li', {}, t))))));
      d.open = isNew(i) || !!filter; detailsOf.push(d); return d;
    }).filter(Boolean);
    wrap.replaceChildren(...(rows.length ? rows : [h('div', { class: 'muted pad' }, 'Aucune entrée de ce type.')]));
  };
  draw();
  panel.replaceChildren(bar, wrap);
  return currentVersion;
}
