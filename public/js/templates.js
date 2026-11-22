/**
 * Modèles de base de données : menu « Nouvelle ligne depuis un modèle », création et gestion des modèles.
 * Un modèle est une page de la base (kind « template ») : on le modifie avec l'éditeur habituel (propriétés + contenu).
 * Chargé à la demande depuis dbviews.js.
 */
import { h, modal, ask, confirmBox, toast } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';
import { popMenu } from './menus.js';

const list = (dbId) => api.get(`/api/pages/${dbId}/templates`);

async function createTemplate(page) {
  const name = (await ask('Nouveau modèle', 'Nom du modèle'))?.trim();
  if (!name) return;
  const t = await api.post(`/api/pages/${page.id}/templates`, { title: name });
  location.hash = `#/page/${t.id}`; // on arrive directement dans l'éditeur du modèle
}

/** Fenêtre « Gérer les modèles » : modifier, dupliquer, supprimer. */
async function manage(page) {
  const body = h('div', { class: 'tpl-manage' });
  const m = modal('Modèles de la base', body);
  const draw = async () => {
    let tpls; try { tpls = await list(page.id); } catch (e) { toast(e.message, 'error'); return; }
    body.replaceChildren(
      tpls.length ? h('div', { class: 'tpl-list' }, tpls.map((t) => h('div', { class: 'tpl-row' },
        h('span', { class: 'tpl-name' }, vi('file-text', 15), t.title || 'Sans titre', page.props?.dw_default_template === t.id ? h('span', { class: 'muted small' }, ' · par défaut') : null),
        h('button', { class: 'btn small', title: 'Modèle présélectionné quand on crée une carte dans le Kanban', onclick: async () => {
          const on = page.props?.dw_default_template === t.id, props = { ...(page.props || {}) };
          if (on) delete props.dw_default_template; else props.dw_default_template = t.id;
          try { await api.patch(`/api/pages/${page.id}`, { props }); page.props = props; draw(); } catch (e) { toast(e.message, 'error'); }
        } }, vi('star', 13), page.props?.dw_default_template === t.id ? 'Retirer par défaut' : 'Par défaut'),
        h('button', { class: 'btn small', onclick: () => { m.close(); location.hash = `#/page/${t.id}`; } }, vi('pencil', 13), 'Modifier'),
        h('button', { class: 'btn small', onclick: async () => { try { await api.post(`/api/pages/${page.id}/templates/${t.id}/duplicate`); draw(); } catch (e) { toast(e.message, 'error'); } } }, vi('copy', 13), 'Dupliquer'),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (!await confirmBox(`Supprimer le modèle « ${t.title || 'Sans titre'} » ? Les lignes déjà créées avec ce modèle ne changent pas.`)) return;
          try { await api.del(`/api/pages/${t.id}`); draw(); } catch (e) { toast(e.message, 'error'); }
        } }, vi('trash-2', 13), 'Supprimer')))) : h('p', { class: 'muted' }, 'Aucun modèle pour l’instant.'),
      h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => { m.close(); createTemplate(page).catch((e) => toast(e.message, 'error')); } }, vi('plus', 14), 'Nouveau modèle')));
  };
  draw();
}

/** Ouvre le menu sous le bouton `anchor`. `onPick(template)` crée la ligne. */
export async function openTemplateMenu(anchor, { page, onPick }) {
  let tpls;
  try { tpls = await list(page.id); } catch (e) { toast(e.message, 'error'); return; }
  const r = anchor.getBoundingClientRect();
  popMenu(r.left, r.bottom + 4, [
    { header: 'Nouvelle ligne depuis un modèle' },
    ...(tpls.length ? tpls.map((t) => ({ label: t.title || 'Sans titre', icon: 'file-text', fn: () => onPick(t) })) : [{ label: 'Aucun modèle pour l’instant', disabled: true, fn() {} }]),
    'sep',
    { label: 'Nouveau modèle…', icon: 'plus', fn: () => createTemplate(page) },
    tpls.length ? { label: 'Gérer les modèles…', icon: 'settings', fn: () => manage(page) } : null,
  ]);
}
