/** Page « Notes de version » : chargée à la demande (import dynamique depuis app.js), une seule requête à l'ouverture.
 *  Nouveautés depuis la dernière visite et dernière version dépliées, le reste replié ; filtre par type ; résumé chiffré par version. */
import { h } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';

const SECTIONS = [['nouveautes', 'Nouveautés', 'sparkles'], ['ameliorations', 'Améliorations', 'trending-up'], ['corrections', 'Corrections', 'wrench']];
const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { dateStyle: 'long' }) : '');
const seenVersion = () => { try { return localStorage.getItem('dw_seen_version'); } catch { return null; } };

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
      h('button', { class: 'btn small', onclick: () => { const open = detailsOf.some((d) => !d.open); detailsOf.forEach((d) => { d.open = open; }); } }, 'Tout déplier / replier'));
    detailsOf.length = 0;
    const rows = list.map((r, i) => {
      const secs = SECTIONS.filter(([k]) => r[k]?.length && (!filter || filter === k));
      if (!secs.length) return null;
      const d = h('details', { class: 'rel' },
        h('summary', { class: 'rel-head' }, h('h2', {}, `Alpha ${r.version}`),
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
