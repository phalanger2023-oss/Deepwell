/**
 * Section « Google Agenda » du panneau « Réglages de la base » : synchronise les lignes datées de la base vers Google Agenda
 * (sens unique DeepWell → Google), pour interroger l'agenda par la voix (Google Home / Assistant).
 */
import { h, toast } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';
import { userTz } from './dates.js';

export function gcalSection(page) {
  const box = h('div', { class: 'gcal-box' });
  const draw = async () => {
    let st;
    try { st = await api.get(`/api/gcal/${page.id}`); } catch (e) { box.replaceChildren(h('small', { class: 'muted' }, e.message)); return; }
    const head = h('b', {}, vi('calendar', 16), 'Google Agenda');
    if (!st.configured) { box.replaceChildren(head, h('small', { class: 'muted' }, 'Google n’est pas configuré sur le serveur (voir Réglages → Google Drive).')); return; }
    if (!st.connected || !st.calendar) {
      box.replaceChildren(head,
        h('small', { class: 'muted' }, 'Envoie les éléments datés de cette base dans Google Agenda, pour demander à Google Home « quels sont mes devoirs pour mardi ? ». Il faut d’abord autoriser Google Agenda.'),
        h('button', { class: 'btn small', onclick: async () => { const r = await api.post('/api/drive/connect'); location.href = r.url; } }, st.connected ? 'Autoriser aussi Google Agenda' : 'Connecter Google'));
      return;
    }
    const cfg = st.config || { enabled: false, date_prop: st.date_props[0], target: 'dedicated' };
    if (!st.date_props.length) { box.replaceChildren(head, h('small', { class: 'muted' }, 'Cette base n’a pas de propriété de type Date : ajoute-en une pour pouvoir la synchroniser.')); return; }
    const save = async (patch) => { try { await api.put(`/api/gcal/${page.id}`, { ...patch, tz: userTz() }); toast(patch.enabled === false ? 'Synchronisation désactivée : les événements sont retirés d’Agenda' : 'Google Agenda : synchronisation en cours'); setTimeout(draw, 1500); } catch (e) { toast(e.message, 'error'); draw(); } };
    const on = h('input', { type: 'checkbox', checked: cfg.enabled ? true : null, onchange: (e) => save({ enabled: e.target.checked, date_prop: prop.value, target: tgt.value }) });
    const prop = h('select', { class: 'input', onchange: () => cfg.enabled && save({ enabled: true, date_prop: prop.value, target: tgt.value }) }, st.date_props.map((p) => h('option', { value: p, selected: p === cfg.date_prop ? true : null }, p)));
    const tgt = h('select', { class: 'input', onchange: () => cfg.enabled && save({ enabled: true, date_prop: prop.value, target: tgt.value }) },
      h('option', { value: 'dedicated', selected: cfg.target !== 'primary' ? true : null }, 'Un agenda « DeepWell » à part (recommandé)'), h('option', { value: 'primary', selected: cfg.target === 'primary' ? true : null }, 'Mon agenda principal'));
    box.replaceChildren(h('label', { class: 'school-main' }, on, h('span', { class: 'school-txt' }, head,
      h('small', { class: 'muted' }, 'Chaque ligne datée devient un événement Google Agenda (journée entière sans heure, à l’heure sinon). Sens unique : DeepWell → Google ; les pages verrouillées ne sont jamais envoyées.'))),
      cfg.enabled ? h('div', { class: 'gcal-opts' },
        h('label', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, 'Propriété de date'), prop),
        h('label', { class: 'btn-field' }, h('span', { class: 'btn-fl' }, 'Où ranger les événements'), tgt),
        h('div', { class: 'row-end', style: 'justify-content:flex-start;gap:8px;align-items:center' },
          h('span', { class: 'muted small' }, st.pending ? '⏳ Synchronisation en cours…' : `✅ ${st.synced} événement${st.synced > 1 ? 's' : ''} dans Google Agenda`),
          h('button', { class: 'btn small', onclick: async () => { try { await api.post(`/api/gcal/${page.id}/sync`, { full: true }); toast('Tout est renvoyé à Google Agenda'); setTimeout(draw, 1500); } catch (e) { toast(e.message, 'error'); } } }, vi('refresh-cw', 14), 'Tout renvoyer')),
        st.error ? h('div', { class: 'form-err' }, st.error, ' (nouvelle tentative automatique)') : null,
        h('small', { class: 'muted' }, 'Google Home lit l’agenda de ton compte : « Ok Google, qu’est-ce que j’ai à faire mardi ? ». Si rien ne revient avec l’agenda « DeepWell » à part, choisis « Mon agenda principal ».')) : null);
  };
  draw();
  return box;
}
