/**
 * Panneau « Réglages de la base » : Mode scolaire et ses options (activables individuellement).
 * Chargé à la demande depuis dbviews.js. Le réglage vit dans `page.props.dw_school` (voir server/school.js).
 * Désactiver le mode ou une option ne supprime aucune donnée et ne touche pas aux fichiers déjà présents sur Drive.
 */
import { h, modal, toast } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';
import { gcalSection } from './gcal.js';

// [clé, titre, description, disponible] — « disponible » passe à true quand la fonction est livrée
export const SCHOOL_OPTIONS = [
  ['drive', 'Stockage Drive', 'Dossier du chapitre créé automatiquement, fichiers envoyés directement vers Google Drive.', true],
  ['search', 'Recherche plein texte des documents', 'Le texte des PDF est indexé pour la barre de recherche.', false],
  ['progress', 'Suivi de progression', 'Statut par chapitre, Kanban par matière, avancement par cours.', false],
  ['autodrop', 'Dépôt automatique depuis Drive', 'Un fichier déposé dans le dossier Drive d’un chapitre apparaît dans la page.', false],
  ['archive', 'Archivage de fin d’année', 'Déplace une matière ou une année dans « Archives » sur Drive.', false],
  ['offline', 'Disponible hors ligne', 'Bouton par chapitre : fichiers conservés dans le navigateur.', false],
  ['pdf', 'Intégration de l’éditeur de PDF (PDM)', 'Le PDF de référence du chapitre est déposé automatiquement dans PDM (dossiers année / matière / chapitre) ; la page du chapitre donne les liens vers la version annotée et le PDF vierge. Nécessite Stockage Drive et la clé PDM (Réglages → Google Drive).', true],
];

const current = (page) => {
  const s = page.props?.dw_school || {};
  return { enabled: s.enabled === true, options: Object.fromEntries(SCHOOL_OPTIONS.map(([k]) => [k, s.options?.[k] === true])), ...(s.abbrevs ? { abbrevs: { ...s.abbrevs } } : {}) };
};

async function save(page, next) {
  const props = { ...(page.props || {}), dw_school: next };
  await api.patch(`/api/pages/${page.id}`, { props });
  page.props = props;
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Réorganisation des dossiers Drive (Matière / Support, « Registre des addenda », doublons) : essai à blanc, puis migration. */
async function reorganizeDialog(page) {
  let plan;
  try { plan = await api.post('/api/school/reorganize/preview', { database_id: page.id }); } catch (e) { toast(e.message, 'error'); return; }
  const t = plan.totals;
  let timer = null;
  const status = h('div', { class: 'muted' });
  const go = h('button', { class: 'btn primary', disabled: !t.supports, onclick: start }, t.supports ? 'Lancer la réorganisation' : 'Rien à réorganiser');
  const cancel = h('button', { class: 'btn', onclick: () => m.close() }, 'Annuler');
  const body = h('div', { class: 'imp' },
    h('p', {}, 'Essai à blanc : rien n’est modifié tant que tu ne lances pas la réorganisation. Organisation visée : DeepWell Cours → Matière → Support → « Document principal » + « Registre des addenda » → un dossier par addendum.'),
    h('ul', {}, [
      `${plural(t.moves, 'support sera déplacé', 'supports seront déplacés')} dans le dossier de sa matière (le niveau « année » disparaît).`,
      `${plural(t.renames, 'dossier « Addenda » sera renommé', 'dossiers « Addenda » seront renommés')} en « Registre des addenda ».`,
      `${plural(t.duplicates, 'fichier en double sera retiré', 'fichiers en double seront retirés')} (la copie va à la corbeille de Drive, récupérable ; l’original reste).`].map((l) => h('li', {}, l))),
    t.supports ? h('details', {}, h('summary', {}, 'Voir les supports concernés'), h('ul', { class: 'imp-paths small' }, plan.supports.map((x) => h('li', {}, x.to)))) : null,
    status, h('div', { class: 'row-end' }, cancel, go));
  const m = modal('Réorganiser les dossiers Drive', body, { onClose: () => clearInterval(timer) });
  async function start() {
    go.disabled = true; cancel.textContent = 'Fermer';
    try {
      const r = await api.post('/api/school/reorganize/run', { database_id: page.id });
      const poll = async () => {
        const st = await api.get(`/api/school/reorganize/status?batch=${r.batch}`);
        status.textContent = st.waiting ? `En cours… ${st.done} sur ${st.total} supports terminés.` : st.failed ? `Terminé avec ${plural(st.failed, 'erreur', 'erreurs')} (${st.done} sur ${st.total} réussis). Google réessaie automatiquement ; ${st.errors[0] || ''}` : `Terminé : ${plural(st.done, 'support réorganisé', 'supports réorganisés')}.`;
        if (!st.waiting) clearInterval(timer);
      };
      status.textContent = 'Démarrage…';
      timer = setInterval(() => poll().catch(() => {}), 3000); poll().catch(() => {});
    } catch (e) { go.disabled = false; toast(e.message, 'error'); }
  }
}

/** Abréviations des matières (titres automatiques « P.S.A. #0007-26-MTH ») : par défaut, les 3 premières consonnes. */
async function abbrevDialog(page, state, onSaved) {
  let subjects = [];
  try { const sch = page.schema || (await api.get(`/api/pages/${page.id}`)).page.schema || {}; const col = Object.values(sch).find((d) => /^mati/i.test(String(d.name).normalize('NFD').replace(/[̀-ͯ]/g, '')) && ['select', 'status'].includes(d.type)); subjects = (col?.[col.type]?.options || []).map((o) => o.name); } catch { /* base illisible */ }
  const inputs = subjects.map((n) => { const i = h('input', { class: 'input', maxlength: 6, placeholder: 'auto', value: state.abbrevs?.[n] || '', style: 'width:90px;text-transform:uppercase' }); return [n, i]; });
  const m = modal('Abréviations des matières', h('div', { class: 'imp' },
    h('p', { class: 'muted' }, 'Utilisées dans « P.S.A. #0007-26-MTH » et « Addendum #0007/02-26-MTH ». Laisse vide : les 3 premières consonnes de la matière sont utilisées.'),
    subjects.length ? h('div', {}, inputs.map(([n, i]) => h('label', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0' }, h('span', { style: 'flex:1' }, n), i))) : h('p', {}, 'Aucune matière trouvée dans la colonne « Matière ».'),
    h('div', { class: 'row-end' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Fermer'), h('button', { class: 'btn primary', onclick: async () => {
      const ab = {}; for (const [n, i] of inputs) if (i.value.trim()) ab[n] = i.value.trim().toUpperCase().slice(0, 6);
      try { const next = { ...state }; if (Object.keys(ab).length) next.abbrevs = ab; else delete next.abbrevs; await save(page, next); Object.assign(state, next); if (!next.abbrevs) delete state.abbrevs; onSaved?.(); toast('Abréviations enregistrées'); m.close(); } catch (e) { toast(e.message, 'error'); } } }, 'Enregistrer'))));
}

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

/** « Mettre à jour l'architecture » : aperçu de tout ce qui va changer, puis application après confirmation. */
async function architectureDialog(page, { onDone } = {}) {
  let plan;
  try { plan = await api.post(`/api/pages/${page.id}/architecture`, { dry: true }); } catch (e) { toast(e.message, 'error'); return; }
  const lst = (arr) => (arr.length ? h('details', {}, h('summary', {}, 'Voir la liste'), h('ul', { class: 'imp-paths small' }, arr.map((t) => h('li', {}, t)))) : null);
  const drive = !!page.props?.dw_school?.options?.drive;
  const tbd = { set: `La matière « TBD » deviendra la valeur par défaut de la colonne « ${plan.tbd_column} » : toute nouvelle ligne y sera rangée, sauf si tu la crées depuis la colonne d’une matière.`,
    create: `L’option « TBD » sera ajoutée à la colonne « ${plan.tbd_column} » et deviendra sa valeur par défaut : toute nouvelle ligne y sera rangée, sauf si tu la crées depuis la colonne d’une matière.`,
    already: `La colonne « ${plan.tbd_column} » a déjà une valeur par défaut : elle est conservée (modifiable avec « Par défaut »).`, no_column: 'Pas de colonne « Matière » (Sélection ou Statut) : aucune matière par défaut.' }[plan.tbd];
  const nothing = !plan.updated.length && !plan.removed_count && (plan.tbd === 'already' || plan.tbd === 'no_column') && !plan.pdm?.files && !plan.addenda_drive?.addenda;
  const status = h('div', { class: 'muted' });
  const go = h('button', { class: 'btn primary', disabled: nothing, onclick: start }, nothing ? 'Rien à mettre à jour' : 'Mettre à jour');
  const cancel = h('button', { class: 'btn', onclick: () => m.close() }, 'Fermer');
  const body = h('div', { class: 'imp' },
    h('p', {}, 'Voici ce qui va se passer. Rien n’est encore modifié : tu peux fermer cette fenêtre. Chaque page modifiée garde sa version d’avant dans son historique (page → Historique).'),
    h('ul', {},
      h('li', {}, plan.removed_count ? `${plural(plan.removed_count, 'bouton sans action sera retiré', 'boutons sans action seront retirés')} (pages et modèles).` : 'Aucun bouton sans action à retirer.'), lst(plan.removed),
      h('li', {}, plan.updated.length ? `Le bouton « ＋ Nouvel addendum » sera ajouté dans la section « Addenda » de ${plural(plan.updated.length, 'page', 'pages')} (modèles compris) : il crée un addendum avec la date du jour dans un encadré entre deux séparateurs.` : 'Aucune page ne reçoit de bouton « Nouvel addendum ».'), lst(plan.updated),
      plan.already.length ? h('li', {}, `${plural(plan.already.length, 'page a déjà', 'pages ont déjà')} un bouton de création de sous-page dans « Addenda » : pas touchée.`) : null, plan.already.length ? lst(plan.already) : null,
      plan.no_section.length ? h('li', {}, `${plural(plan.no_section.length, 'page n’a', 'pages n’ont')} pas de section « Addenda » : rien n’y est ajouté.`) : null, plan.no_section.length ? lst(plan.no_section) : null,
      h('li', {}, tbd),
      plan.addenda_drive?.enabled ? h('li', {}, plan.addenda_drive.addenda ? `${plural(plan.addenda_drive.addenda, 'addendum aura', 'addenda auront')} son propre dossier dans « Addenda » (fichiers joints rangés dedans + petit résumé écrit .md), en tâche de fond.` : 'Tous les addenda ont déjà leur dossier et leur résumé.') : null,
      plan.pdm?.enabled ? h('li', {}, plan.pdm.files ? `${plural(plan.pdm.files, 'PDF de cours sera déposé', 'PDF de cours seront déposés')} dans PDM (en tâche de fond ; les liens apparaissent sur la page de chaque chapitre).` : 'Tous les PDF de cours sont déjà dans PDM.') : null),
    drive ? h('p', { class: 'muted small' }, 'Ensuite, une seconde fenêtre te propose de ranger tes cours existants dans Google Drive (avec son propre aperçu).') : null,
    status, h('div', { class: 'row-end' }, cancel, go));
  const m = modal('Mettre à jour l’architecture', body);
  async function start() {
    go.disabled = true;
    try {
      const r = await api.post(`/api/pages/${page.id}/architecture`, { dry: false });
      status.textContent = `Terminé : ${plural(r.updated.length, 'page a reçu', 'pages ont reçu')} le bouton, ${plural(r.removed_count, 'bouton vide retiré', 'boutons vides retirés')}${r.tbd === 'set' || r.tbd === 'create' ? ', matière par défaut « TBD » activée' : ''}.`;
      onDone?.();
      if (drive) { m.close(); importDialog(page); }
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
    const addendaTool = state.enabled ? [h('button', { class: 'btn small', onclick: () => architectureDialog(page, { onDone: onSaved }) }, vi('refresh-cw', 14), 'Mettre à jour l’architecture…'),
      h('small', { class: 'muted' }, 'Ajoute le bouton « Nouvel addendum », retire les boutons vides, met la matière « TBD » par défaut et propose de ranger les cours existants dans Drive. Un aperçu s’affiche d’abord.')] : [];
    tools.replaceChildren(...addendaTool, ...(state.enabled && state.options.drive ? [
      h('button', { class: 'btn small', onclick: () => importDialog(page) }, vi('folder', 14), 'Rattacher mes cours existants…'),
      h('small', { class: 'muted' }, 'Range tes cours déjà présents dans les dossiers Drive. Un aperçu s’affiche d’abord, rien ne bouge sans ta confirmation.'),
      h('button', { class: 'btn small', onclick: () => reorganizeDialog(page) }, vi('folder', 14), 'Réorganiser les dossiers Drive…'),
      h('small', { class: 'muted' }, 'DeepWell Cours → Matière → Support → Document principal + Registre des addenda. Essai à blanc d’abord ; retire aussi les fichiers en double.')] : []),
      ...(state.enabled ? [h('button', { class: 'btn small', onclick: () => abbrevDialog(page, state, onSaved) }, vi('tag', 14), 'Abréviations des matières…'),
        h('small', { class: 'muted' }, 'Pour les titres automatiques « P.S.A. #0007-26-MTH » (par défaut : 3 premières consonnes).')] : []));
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
    gcalSection(page), h('hr'),
    h('label', { class: 'school-main' }, sw, h('span', { class: 'school-txt' },
      h('b', {}, vi('graduation-cap', 16), 'Mode scolaire'),
      h('small', { class: 'muted' }, 'Regroupe les fonctions pour les cours. Désactivé, la base se comporte comme une base ordinaire.'))),
    list, tools,
    h('p', { class: 'muted small' }, 'Désactiver le mode ou une option ne supprime aucune donnée et ne touche pas aux fichiers déjà présents sur Drive.')));
}
