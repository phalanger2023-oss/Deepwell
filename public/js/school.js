/**
 * Panneau « Réglages de la base » : Mode scolaire et ses options (activables individuellement).
 * Chargé à la demande depuis dbviews.js. Le réglage vit dans `page.props.dw_school` (voir server/school.js).
 * Désactiver le mode ou une option ne supprime aucune donnée et ne touche pas aux fichiers déjà présents sur Drive.
 */
import { h, modal, toast } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';

// [clé, titre, description, disponible] — « disponible » passe à true quand la fonction est livrée
export const SCHOOL_OPTIONS = [
  ['drive', 'Stockage Drive', 'Dossier du chapitre créé automatiquement, fichiers envoyés directement vers Google Drive.', true],
  ['search', 'Recherche plein texte des documents', 'Le texte des PDF est indexé pour la barre de recherche.', false],
  ['progress', 'Suivi de progression', 'Statut par chapitre, Kanban par matière, avancement par cours.', false],
  ['autodrop', 'Dépôt automatique depuis Drive', 'Un fichier déposé dans le dossier Drive d’un chapitre apparaît dans la page.', false],
  ['archive', 'Archivage de fin d’année', 'Déplace une matière ou une année dans « Archives » sur Drive.', false],
  ['offline', 'Disponible hors ligne', 'Bouton par chapitre : fichiers conservés dans le navigateur.', false],
  ['pdf', 'Intégration de l’éditeur de PDF', 'Bouton « Ouvrir dans l’éditeur » sur la page du chapitre.', false],
];

const current = (page) => {
  const s = page.props?.dw_school || {};
  return { enabled: s.enabled === true, options: Object.fromEntries(SCHOOL_OPTIONS.map(([k]) => [k, s.options?.[k] === true])) };
};

async function save(page, next) {
  const props = { ...(page.props || {}), dw_school: next };
  await api.patch(`/api/pages/${page.id}`, { props });
  page.props = props;
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Rattachement des cours existants : aperçu (rien n'est modifié), puis lancement et suivi. */
async function importDialog(page) {
  let plan;
  try { plan = await api.post('/api/school/import/preview', { database_id: page.id }); } catch (e) { toast(e.message, 'error'); return; }
  const t = plan.totals;
  let timer = null;
  const status = h('div', { class: 'muted' });
  const go = h('button', { class: 'btn primary', onclick: start }, 'Lancer le rattachement');
  const cancel = h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler');
  const lines = [
    `${plural(t.supports, 'support sera rangé', 'supports seront rangés')} dans des dossiers Drive (${plural(t.new_folders, 'nouveau dossier', 'nouveaux dossiers')}).`,
    `${plural(t.server_files, 'fichier du serveur sera envoyé', 'fichiers du serveur seront envoyés')} sur Drive. Les copies du serveur sont conservées.`,
    `${plural(t.drive_files + t.drive_folders, 'lien Drive existant sera rattaché', 'liens Drive existants seront rattachés')} au bon chapitre, sans être déplacés.`,
    `${plural(t.canva_links, 'lien Canva reste', 'liens Canva restent')} des liens (Canva ne passe pas par Drive).`,
  ];
  if (t.too_big) lines.push(`${plural(t.too_big, 'fichier dépasse', 'fichiers dépassent')} 25 Mo : à envoyer à la main depuis la page du chapitre.`);
  const body = h('div', { class: 'imp' },
    h('p', {}, 'Voici ce qui va se passer. Rien n’est encore modifié : tu peux annuler.'),
    h('ul', {}, lines.map((l) => h('li', {}, l))),
    h('details', {}, h('summary', {}, 'Voir les dossiers qui seront utilisés'),
      h('ul', { class: 'imp-paths small' }, plan.supports.map((s) => h('li', {}, s.path, s.has_folder ? h('span', { class: 'rel-tag' }, 'déjà créé') : null)))),
    status, h('div', { class: 'row-end' }, cancel, go));
  const m = modal('Rattacher mes cours existants', body, { onClose: () => clearInterval(timer) });
  async function start() {
    go.disabled = true; cancel.textContent = 'Fermer';
    try {
      const r = await api.post('/api/school/import/run', { database_id: page.id });
      const poll = async () => {
        const s = await api.get(`/api/school/import/status?batch=${r.batch}`);
        status.textContent = s.waiting ? `En cours… ${s.done} sur ${s.total} supports terminés.` : s.failed
          ? `Terminé avec ${plural(s.failed, 'erreur', 'erreurs')} (${s.done} sur ${s.total} réussis). Google réessaie automatiquement ; ${s.errors[0] || ''}` : `Terminé : ${plural(s.done, 'support rangé', 'supports rangés')} sur Drive.`;
        if (!s.waiting) clearInterval(timer);
      };
      status.textContent = 'Démarrage…';
      timer = setInterval(() => poll().catch(() => {}), 3000); poll().catch(() => {});
    } catch (e) { go.disabled = false; toast(e.message, 'error'); }
  }
}

export function openDatabaseSettings(page, { onSaved } = {}) {
  const state = current(page);
  const list = h('div', { class: 'school-opts' });
  const tools = h('div', { class: 'school-tools' });
  const drawList = () => {
    list.classList.toggle('off', !state.enabled);
    list.replaceChildren(...SCHOOL_OPTIONS.map(([k, title, desc, ready]) => {
      const box = h('input', { type: 'checkbox', checked: state.options[k], disabled: !state.enabled || !ready });
      box.addEventListener('change', () => change(() => { state.options[k] = box.checked; }));
      return h('label', { class: `school-opt ${ready ? '' : 'soon'}` }, box,
        h('span', { class: 'school-txt' }, h('b', {}, title, ready ? null : h('span', { class: 'rel-tag' }, 'Bientôt')), h('small', { class: 'muted' }, desc)));
    }));
    tools.replaceChildren(...(state.enabled && state.options.drive ? [
      h('button', { class: 'btn small', onclick: () => importDialog(page) }, vi('folder', 14), 'Rattacher mes cours existants…'),
      h('small', { class: 'muted' }, 'Range tes cours déjà présents dans les dossiers Drive. Un aperçu s’affiche d’abord, rien ne bouge sans ta confirmation.')] : []));
  };
  async function change(apply) {
    const before = JSON.stringify(state);
    try { apply(); await save(page, state); onSaved?.(); drawList(); }
    catch (e) { Object.assign(state, JSON.parse(before)); toast(e.message, 'error'); drawList(); }
  }
  const sw = h('input', { type: 'checkbox', checked: state.enabled });
  sw.addEventListener('change', () => change(() => { state.enabled = sw.checked; }));
  drawList();
  modal('Réglages de la base', h('div', { class: 'school' },
    h('label', { class: 'school-main' }, sw, h('span', { class: 'school-txt' },
      h('b', {}, vi('graduation-cap', 16), 'Mode scolaire'),
      h('small', { class: 'muted' }, 'Regroupe les fonctions pour les cours. Désactivé, la base se comporte comme une base ordinaire.'))),
    list, tools,
    h('p', { class: 'muted small' }, 'Désactiver le mode ou une option ne supprime aucune donnée et ne touche pas aux fichiers déjà présents sur Drive.')));
}
