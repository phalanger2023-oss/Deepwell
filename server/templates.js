/**
 * Modèles de base de données (comme Notion) : un modèle est une vraie page (kind = 'template') rangée DANS la base,
 * donc éditable avec l'éditeur habituel (propriétés + contenu). Il n'apparaît ni dans le tableau, ni dans l'arbre, ni dans la recherche.
 * Créer une ligne « depuis un modèle » copie ses propriétés et ses blocs dans une nouvelle ligne ordinaire.
 */
import { db, uid, now, tx, parse, textOf, getSetting } from './db.js';
import { requireAuth } from './auth.js';
import { accessFor, can } from './access.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
/** Ancienne page du recueil scolaire : créée avant le 22/11/2026 et pas encore modernisée (pastille jaune « À mettre à jour »). */
const LEGACY_CUTOFF = Date.UTC(2026, 10, 22);
export const isLegacyRow = (createdAt, props) => createdAt < LEGACY_CUTOFF && !props?.dw_arch;
const TIME_PROPS = new Set(['created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id']); // recalculées pour chaque nouvelle ligne

const rt = (text, ann = {}) => ({ type: 'text', text: { content: text, link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...ann }, plain_text: text, href: null });
const mentionToday = () => ({ type: 'mention', mention: { type: 'template_mention', template_mention: { type: 'template_mention_date', template_mention_date: 'today' } }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, plain_text: '@Today', href: null });

/** Bouton « Nouvel addendum » : crée une sous-page dont l'en-tête est la date du jour dans un encadré, entre deux séparateurs (comme les addenda existants). */
export const ADDENDUM_ACTION = { type: 'add_subpage', title: 'Addendum du {{date_longue}}', text: '---\n!> @Today\n---', where: 'below', open: true };
const addendumButton = (parent = null) => ({ id: uid(), parent_id: parent, type: 'button', content: { label: '＋ Nouvel addendum', color: 'blue', actions: [{ ...ADDENDUM_ACTION }] } });

/** Modèles de départ du mode scolaire. `props` est complété avec les valeurs « TBD » de la base si elles existent. */
function starters() {
  const B = (type, content = {}, parent = null, id = uid()) => ({ id, parent_id: parent, type, content });
  const para = (text = '', parent = null) => B('paragraph', { rich_text: text ? [rt(text)] : [], icon: null, color: 'default' }, parent);
  const head = (n, text, extra = {}) => B(`heading_${n}`, { rich_text: [rt(text)], is_toggleable: false, color: 'default', ...extra });
  const dateLine = () => B('callout', { rich_text: [mentionToday(), rt(' ')], icon: { type: 'emoji', emoji: '⌛' }, color: 'gray_background' });
  const toggle = (text, parent = null) => B('toggle', { rich_text: [rt(text, { bold: true })], color: 'default' }, parent);
  const div = (parent = null) => B('divider', {}, parent);
  // 1. Reproduit la fiche « P.S.A. #00-26- » (Cours, Original / Modifié, Addenda : Émanant du P.S.A. / Lié à la P.S.A.)
  const orig = head(2, 'Original : ', { is_toggleable: true }), modif = head(2, 'Modifié :', { is_toggleable: true });
  const e = toggle('Émanant du P.S.A.'), l = toggle('Lié à la P.S.A.');
  const psa = [dateLine(), div(), B('school_files'), head(1, 'Cours : '), orig, para('', orig.id), modif, para('', modif.id), div(), head(1, 'Addenda :'), e, addendumButton(e.id), para('', e.id), l, addendumButton(l.id), para('', l.id)];
  // 2. Fiche de révision
  const revision = [dateLine(), div(), head(1, 'À retenir'), para(), head(1, 'Définitions et formules'), para(), head(1, 'Exemples'), para(), head(1, 'Points à revoir'),
    B('to_do', { rich_text: [], checked: false, color: 'default' }), B('to_do', { rich_text: [], checked: false, color: 'default' })];
  // 3. Exercices
  const exo = [dateLine(), div(), head(1, 'Énoncé'), para(), head(1, 'Résolution'), para(), head(1, 'Correction'), para(), head(1, 'Remarques'), para()];
  return [{ title: 'P.S.A. #00-26-', icon: null, blocks: psa }, { title: 'Fiche de révision', icon: null, blocks: revision }, { title: 'Exercices', icon: null, blocks: exo }];
}


/* ───────── Architecture de référence (mise à jour des anciennes pages) ───────── */
const STRUCT = new Set(['heading_1', 'heading_2', 'heading_3', 'toggle', 'divider', 'callout', 'button', 'school_files']);
const normKey = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s:]+$/g, '').replace(/^titre\s+/, '').trim();
const isContainer = (b) => b.type === 'toggle' || /^heading_/.test(b.type);
const isAddBtn = (b) => b.type === 'button' && (b.content?.actions || []).some((a) => a.type === 'add_subpage');
const emptyText = (n) => !textOf(n.b.content).trim() && !['divider', 'button', 'school_files', 'child_page', 'child_database', 'image', 'file', 'pdf', 'video', 'audio', 'embed', 'bookmark', 'table', 'column_list'].includes(n.b.type);

/** Squelette d'une page : on garde la structure (titres, blocs déroulants, séparateurs, encadrés, boutons, panneau de fichiers), pas le texte du cours. */
export function captureReference(list) {
  const kids = (id) => list.filter((b) => (b.parent_id || null) === id);
  const walk = (id) => kids(id).filter((b) => STRUCT.has(b.type)).map((b) => ({ type: b.type, content: b.content || {}, children: walk(b.id) }));
  return walk(null);
}
const treeOf = (list) => {
  const nodes = new Map(list.map((b) => [b.id, { b, kids: [] }])), roots = [];
  for (const b of list) { const n = nodes.get(b.id); (b.parent_id && nodes.get(b.parent_id) ? nodes.get(b.parent_id).kids : roots).push(n); }
  return roots;
};

/** Reconstruit la page selon l'architecture de référence ; le contenu de l'ancienne page est recasé sous les sections de même nom. */
export function rebuildFromReference(ref, list) {
  const old = treeOf(list), used = new Set();
  const mk = (r, parent) => { const n = { b: { id: uid(), parent_id: parent, type: r.type, content: JSON.parse(JSON.stringify(r.content || {})) }, kids: [], after: [] }; n.kids = (r.children || []).map((c) => mk(c, n.b.id)); return n; };
  const fresh = ref.map((r) => mk(r, null));
  const eachOld = (nodes, fn, parent = null) => { for (const n of nodes) { fn(n, parent, nodes); eachOld(n.kids, fn, n); } };
  const consume = (n) => { used.add(n.b.id); n.kids.forEach(consume); };
  // 1. l'encadré de date de l'ancienne page remplace celui de la référence
  const oldDate = old.find((n) => n.b.type === 'callout' && JSON.stringify(n.b.content).includes('"mention"'));
  const eachNew = (nodes, fn) => { for (const n of nodes) { fn(n); eachNew(n.kids, fn); } };
  let dateDone = false;
  eachNew(fresh, (n) => { if (!dateDone && oldDate && n.b.type === 'callout' && JSON.stringify(n.b.content).includes('"mention"')) { n.b.content = oldDate.b.content; consume(oldDate); dateDone = true; } });
  // 2. chaque section de la référence reprend le contenu de la section de même nom
  const level = (t) => (/^heading_(\d)/.exec(t) || [])[1] * 1 || 9;
  const conts = []; eachNew(fresh, (n) => { if (isContainer(n.b)) conts.push(n); });
  const isFlat = (n) => !(n.b.type === 'toggle' || n.b.content?.is_toggleable);
  conts.sort((a, b) => isFlat(a) - isFlat(b)); // d'abord les blocs déroulants (précis), ensuite les titres « à plat » qui prennent ce qui reste
  conts.forEach((C) => {
    const k = normKey(textOf(C.b.content)); if (!k) return;
    let found = null; eachOld(old, (n, parent, sib) => { if (!found && !used.has(n.b.id) && isContainer(n.b) && normKey(textOf(n.b.content)) === k) found = { n, sib }; });
    if (!found) return;
    const { n: O, sib } = found; let body = O.kids;
    if (!body.length && !(O.b.type === 'toggle' || O.b.content?.is_toggleable)) { // titre « à plat » : ce qui le suit jusqu'au titre suivant de même niveau ou plus haut
      body = []; for (let i = sib.indexOf(O) + 1; i < sib.length; i++) { const x = sib[i]; if (used.has(x.b.id)) continue; if (x.b.type === 'divider' || (/^heading_/.test(x.b.type) && level(x.b.type) <= level(O.b.type))) break; body.push(x); }
    }
    consume(O); body.forEach(consume);
    const keep = body.filter((x) => !isAddBtn(x.b) && !(emptyText(x) && !x.kids.length));
    if (C.b.type === 'toggle' || C.b.content?.is_toggleable) C.kids.push(...keep); else C.after.push(...keep);
  });
  // 3. tout toggle sans contenu reçoit un bloc de texte vide pour pouvoir écrire dedans
  eachNew(fresh, (n) => { if ((n.b.type === 'toggle' || n.b.content?.is_toggleable) && !n.kids.some((k) => k.b.type !== 'button')) n.kids.push({ b: { id: uid(), parent_id: n.b.id, type: 'paragraph', content: { rich_text: [], icon: null, color: 'default' } }, kids: [], after: [] }); });
  // 4. ce qui n'a trouvé aucune place est conservé tel quel en bas de page
  const left = old.filter((n) => !used.has(n.b.id) && !isAddBtn(n.b) && n.b.type !== 'divider' && !(emptyText(n) && !n.kids.length));
  if (left.length) fresh.push({ b: { id: uid(), parent_id: null, type: 'heading_2', content: { rich_text: [{ type: 'text', text: { content: 'À classer' }, plain_text: 'À classer', annotations: {} }], is_toggleable: false, color: 'default' } }, kids: [], after: left });
  const out = []; const emit = (n, parent) => { out.push({ ...n.b, parent_id: parent }); n.kids.forEach((k) => emit(k, n.b.id)); (n.after || []).forEach((k) => emit(k, parent)); };
  fresh.forEach((n) => emit(n, null));
  return out;
}

function dbOf(req, id, level) {
  const d = db.prepare('SELECT id,kind,props,schema,owner_id FROM pages WHERE id=?').get(id);
  if (!d || d.kind !== 'database' || !accessFor(req.user, id)) throw err('Base introuvable', 404);
  if (level === 'edit' && !can(accessFor(req.user, id), 'edit')) throw err('Droits insuffisants', 403);
  return d;
}

function insertBlocks(pageId, blocks, t = now()) {
  const ins = db.prepare('INSERT INTO blocks(id,page_id,parent_id,type,content,text,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const pos = new Map();
  for (const b of blocks) { const k = b.parent_id || ''; const n = pos.get(k) || 0; pos.set(k, n + 1); ins.run(b.id, pageId, b.parent_id || null, b.type, JSON.stringify(b.content), textOf(b.content), n, t, t); }
}

function createTemplate(d, title, icon, blocks, props = {}) {
  const id = uid(), t = now();
  const max = db.prepare('SELECT COALESCE(MAX(position),0) m FROM pages WHERE parent_id=?').get(d.id).m;
  db.prepare(`INSERT INTO pages(id,parent_id,owner_id,kind,title,icon,props,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, d.id, d.owner_id, 'template', String(title).slice(0, 200), icon, JSON.stringify(props), max + 1, t, t);
  insertBlocks(id, blocks, t);
  return id;
}

/** Propriétés d'un modèle de départ : toutes vides, sauf le titre ; une propriété « Statut »/« Matière » reste à sa valeur par défaut. */
const listOf = (d) => db.prepare("SELECT id,title,icon FROM pages WHERE parent_id=? AND kind='template' AND archived=0 ORDER BY position, created_at").all(d.id);

/** Mode scolaire activé et jamais « amorcé » : on crée les modèles de départ (une seule fois ; les supprimer est définitif). */
function seedIfNeeded(d) {
  const props = parse(d.props, {}) || {};
  if (!props.dw_school?.enabled || props.dw_templates_seeded) return;
  tx(() => {
    for (const s of starters()) createTemplate(d, s.title, s.icon, s.blocks);
    db.prepare('UPDATE pages SET props=? WHERE id=?').run(JSON.stringify({ ...props, dw_templates_seeded: true }), d.id);
  });
}

/** Remplace les mentions « @Today / @Now » d'un modèle par la vraie date du jour. */
function resolveMentions(content, today) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (v.type === 'mention' && v.mention?.type === 'template_mention') {
        const kind = v.mention.template_mention?.template_mention_date || v.mention.template_mention?.type;
        if (String(kind).includes('today') || String(kind).includes('now')) return { ...v, mention: { type: 'date', date: { start: today, end: null, time_zone: null } }, plain_text: today };
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(content);
}

export function templatesRoutes(router, { autoProps, defaultProps, schoolPageChanged, writeBlocks, snapshot, schoolPdmBackfill, schoolAddendaBackfill }) {
  // ---- Mise à jour d'UNE ancienne page du recueil (créée avant le 22/11/2026, pas encore modernisée) ----
  const normT = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const legacyRow = (req, id, level) => {
    const p = db.prepare("SELECT id,parent_id,kind,title,props,created_at FROM pages WHERE id=? AND kind='page'").get(id);
    if (!p || !p.parent_id || !can(accessFor(req.user, id), level)) throw err('Page introuvable', 404);
    const d = db.prepare("SELECT id,props FROM pages WHERE id=? AND kind='database'").get(p.parent_id);
    if (!parse(d?.props, {})?.dw_school?.enabled) return { p, legacy: false };
    return { p, d, legacy: isLegacyRow(p.created_at, parse(p.props, {})) };
  };
  router.get('/:id/modernize', requireAuth, (req, res) => res.json({ legacy: legacyRow(req, req.params.id, 'view').legacy }));
  /** Aperçu (dry) : blocs de premier niveau, ceux de l'ancienne structure (Original / Modifié…) déjà cochés. Application : retire les blocs cochés (version de sauvegarde conservée). */
  router.post('/:id/modernize', requireAuth, (req, res) => {
    const { p, legacy } = legacyRow(req, req.params.id, 'edit');
    if (!legacy) throw err('Cette page est déjà à jour.', 409);
    const list = db.prepare('SELECT id,parent_id,type,content FROM blocks WHERE page_id=? ORDER BY position').all(p.id).map((b) => ({ id: b.id, parent_id: b.parent_id, type: b.type, content: parse(b.content, {}) }));
    const kids = (id) => list.filter((b) => b.parent_id === id);
    const count = (b) => 1 + kids(b.id).reduce((n, c) => n + count(c), 0);
    const top = list.filter((b) => !b.parent_id);
    const old = (b) => /^(titre )?(modifie|original)\b/.test(normT(textOf(b.content))) && ['toggle', 'heading_1', 'heading_2', 'heading_3', 'paragraph'].includes(b.type);
    const ref = parse(db.prepare('SELECT props FROM pages WHERE id=?').get(p.parent_id)?.props, {})?.dw_arch_ref;
    if (req.body?.dry !== false) return res.json({ dry: true, title: p.title, reference: ref?.title || null, blocks: top.map((b) => ({ id: b.id, type: b.type, text: textOf(b.content).slice(0, 80), size: count(b), suggested: old(b) })) });
    const remove = new Set((Array.isArray(req.body?.remove) ? req.body.remove : []).filter((id) => top.some((b) => b.id === id)));
    let grew = true; while (grew) { grew = false; for (const b of list) if (b.parent_id && remove.has(b.parent_id) && !remove.has(b.id)) { remove.add(b.id); grew = true; } }
    let out = list.filter((b) => !remove.has(b.id)), added = 0;
    if (ref?.tree?.length) out = rebuildFromReference(ref.tree, out);
    // le bouton « Nouvel addendum » doit être présent dans la section Addenda
    const t2 = out.filter((b) => !b.parent_id), hi = t2.findIndex((b) => /^heading_/.test(b.type) && /^addenda/i.test(textOf(b.content).trim()));
    if (hi >= 0 && !out.some((b) => b.type === 'button' && (b.content.actions || []).some((a) => a.type === 'add_subpage'))) {
      const after = []; for (const b of t2.slice(hi + 1)) { if (b.type === 'heading_1') break; after.push(b); }
      const toggles = after.filter((b) => b.type === 'toggle');
      if (toggles.length) for (const t of toggles) { out.unshift(addendumButton(t.id)); added++; }
      else { out.splice(out.findIndex((b) => b.id === t2[hi].id) + 1, 0, addendumButton(null)); added++; }
    }
    tx(() => {
      snapshot(p.id, req.user, 'Mise à jour de la page (nouvelle architecture)', 0);
      writeBlocks(p.id, out);
      const props = { ...(parse(p.props, {}) || {}), dw_arch: 'done' };
      db.prepare('UPDATE pages SET props=?, updated_at=? WHERE id=?').run(JSON.stringify(props), now(), p.id);
    });
    res.json({ ok: true, removed: remove.size, buttons: added, rebuilt: !!ref?.tree?.length });
  });
  /** Mode développeur : « Définir comme architecture de référence » : la structure de cette page sert de modèle à la mise à jour des anciennes pages de la base. */
  router.post('/:id/arch-reference', requireAuth, (req, res) => {
    if (getSetting('dev_mode', '0') !== '1') throw err('Cette action nécessite le mode développeur (Réglages → Développeur).', 403);
    const p = db.prepare("SELECT id,parent_id,title FROM pages WHERE id=? AND kind='page'").get(req.params.id);
    if (!p || !p.parent_id || !can(accessFor(req.user, p.id), 'edit')) throw err('Page introuvable', 404);
    const d = db.prepare("SELECT id,props FROM pages WHERE id=? AND kind='database'").get(p.parent_id);
    if (!d || !parse(d.props, {})?.dw_school?.enabled || !can(accessFor(req.user, d.id), 'edit')) throw err('Cette page n’appartient pas à une base scolaire.', 409);
    const list = db.prepare('SELECT id,parent_id,type,content FROM blocks WHERE page_id=? ORDER BY position').all(p.id).map((b) => ({ id: b.id, parent_id: b.parent_id, type: b.type, content: parse(b.content, {}) }));
    const tree = captureReference(list);
    if (!tree.length) throw err('Cette page n’a aucune structure (titres, blocs déroulants…) à utiliser comme référence.', 409);
    db.prepare('UPDATE pages SET props=?, updated_at=? WHERE id=?').run(JSON.stringify({ ...parse(d.props, {}), dw_arch_ref: { title: p.title, tree, at: now() } }), now(), d.id);
    res.json({ ok: true, blocks: list.length, kept: JSON.stringify(tree).split('"type"').length - 1 });
  });
  /** Mode développeur : « Marquer comme modifiée » (retire la pastille et le bouton sans toucher au contenu). */
  router.post('/:id/modernize/mark', requireAuth, (req, res) => {
    if (getSetting('dev_mode', '0') !== '1') throw err('Cette action nécessite le mode développeur (Réglages → Développeur).', 403);
    const { p } = legacyRow(req, req.params.id, 'edit');
    db.prepare('UPDATE pages SET props=?, updated_at=? WHERE id=?').run(JSON.stringify({ ...(parse(p.props, {}) || {}), dw_arch: 'done' }), now(), p.id);
    res.json({ ok: true });
  });

  /**
   * « Mettre à jour l'architecture » d'une base scolaire (aperçu avec `dry`, sinon application) :
   *  1. retire les boutons sans aucune action (pages et modèles de la base) ;
   *  2. ajoute le bouton « Nouvel addendum » dans la section « Addenda » : dans chaque bloc déroulant (ex. « Émanant du P.S.A. »),
   *     ou juste sous le titre « Addenda » s'il n'y en a pas — sauf si la section a déjà un bouton de création de sous-page ;
   *  3. matière par défaut « TBD » pour les nouvelles lignes (option créée si besoin ; un défaut déjà choisi est conservé).
   */
  router.post('/:id/architecture', requireAuth, (req, res) => {
    const d = dbOf(req, req.params.id, 'edit'), dry = req.body?.dry !== false;
    const pages = db.prepare("SELECT id,title,kind FROM pages WHERE parent_id=? AND kind IN ('page','template') AND archived=0 ORDER BY position").all(d.id);
    const plan = { dry, total: pages.length, updated: [], already: [], no_section: [], buttons: 0, removed: [], removed_count: 0, tbd: null };
    for (const p of pages) {
      let list = db.prepare('SELECT id,parent_id,type,content FROM blocks WHERE page_id=? ORDER BY position').all(p.id).map((b) => ({ id: b.id, parent_id: b.parent_id, type: b.type, content: parse(b.content, {}) }));
      const label = `${p.title || 'Sans titre'}${p.kind === 'template' ? ' (modèle)' : ''}`;
      // 1. boutons vides
      const empty = new Set(list.filter((b) => b.type === 'button' && !(b.content.actions || []).length).map((b) => b.id));
      let changed = false;
      if (empty.size) { // un bouton n'a pas d'enfants, mais on emporte tout ce qui en dépendrait
        let grew = true; while (grew) { grew = false; for (const b of list) if (b.parent_id && empty.has(b.parent_id) && !empty.has(b.id)) { empty.add(b.id); grew = true; } }
        list = list.filter((b) => !empty.has(b.id)); changed = true; plan.removed.push(`${label} : ${empty.size}`); plan.removed_count += empty.size;
      }
      // 2. boutons « Nouvel addendum »
      const top = list.filter((b) => !b.parent_id), hi = top.findIndex((b) => /^heading_/.test(b.type) && /^addenda/i.test(textOf(b.content).trim()));
      const adds = [];
      if (hi < 0) plan.no_section.push(label);
      else {
        const after = []; for (const b of top.slice(hi + 1)) { if (b.type === 'heading_1') break; after.push(b); } // jusqu'au titre suivant
        const sec = new Set(after.map((b) => b.id)); let grew = true; while (grew) { grew = false; for (const b of list) if (b.parent_id && sec.has(b.parent_id) && !sec.has(b.id)) { sec.add(b.id); grew = true; } }
        if (list.some((b) => sec.has(b.id) && b.type === 'button' && (b.content.actions || []).some((a) => a.type === 'add_subpage'))) plan.already.push(label);
        else {
          const toggles = after.filter((b) => b.type === 'toggle');
          if (toggles.length) for (const t of toggles) adds.push(addendumButton(t.id)); else adds.push({ ...addendumButton(null), after: top[hi].id });
          plan.updated.push(label); plan.buttons += adds.length;
        }
      }
      if (dry || (!changed && !adds.length)) continue;
      tx(() => {
        snapshot(p.id, req.user, 'Mise à jour de l’architecture', 0);
        const out = list;
        for (const a of adds) {
          const nb = { id: a.id, parent_id: a.parent_id, type: a.type, content: a.content };
          if (a.after) out.splice(out.findIndex((b) => b.id === a.after) + 1, 0, nb); else out.unshift(nb); // premier enfant du bloc déroulant
        }
        writeBlocks(p.id, out);
      });
    }
    // 3. matière par défaut « TBD »
    const props = parse(d.props, {}) || {}, schema = parse(d.schema, {}) || {};
    const key = Object.keys(schema).find((k) => /^mati/.test(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()) && ['select', 'status'].includes(schema[k].type));
    if (!key) plan.tbd = 'no_column';
    else if (props.dw_defaults?.[key]) plan.tbd = 'already';
    else {
      const type = schema[key].type, opts = schema[key][type]?.options || [], found = opts.find((o) => String(o.name).trim().toLowerCase() === 'tbd');
      plan.tbd = found ? 'set' : 'create';
      if (!dry) {
        const opt = found || { name: 'TBD', color: 'gray' };
        if (!found) schema[key][type] = { ...schema[key][type], options: [...opts, opt] };
        props.dw_defaults = { ...(props.dw_defaults || {}), [key]: { type, [type]: opt } };
        db.prepare('UPDATE pages SET schema=?, props=?, updated_at=? WHERE id=?').run(JSON.stringify(schema), JSON.stringify(props), now(), d.id);
      }
    }
    plan.tbd_column = key || null;
    plan.addenda_drive = schoolAddendaBackfill(d.id, req.user.id, dry); // addenda : un dossier chacun + résumé écrit
    plan.pdm = schoolPdmBackfill(d.id, req.user.id, dry); // PDF déjà présents pas encore dans PDM : envoyés (en tâche de fond)
    res.json(plan);
  });
  router.get('/:id/templates', requireAuth, (req, res) => {
    const d = dbOf(req, req.params.id, 'view');
    if (can(accessFor(req.user, d.id), 'edit')) seedIfNeeded(d);
    res.json(listOf(d));
  });

  /** Crée un modèle : vide, ou copié d'une ligne existante de la base (« Enregistrer comme modèle »). */
  router.post('/:id/templates', requireAuth, (req, res) => {
    const d = dbOf(req, req.params.id, 'edit');
    const { title = '', from_page = null } = req.body || {};
    let blocks = [], props = {}, name = String(title).trim() || 'Nouveau modèle', icon = null;
    if (from_page) {
      const src = db.prepare('SELECT id,parent_id,title,icon,props FROM pages WHERE id=?').get(from_page);
      if (!src || src.parent_id !== d.id) throw err('Page source introuvable dans cette base', 404);
      const map = new Map(), rows = db.prepare('SELECT * FROM blocks WHERE page_id=? ORDER BY position').all(src.id);
      rows.forEach((b) => map.set(b.id, uid()));
      blocks = rows.map((b) => ({ id: map.get(b.id), parent_id: b.parent_id ? map.get(b.parent_id) || null : null, type: b.type, content: parse(b.content, {}) }));
      props = parse(src.props, {}) || {}; icon = src.icon;
      if (!String(title).trim()) name = src.title || name;
    }
    const id = tx(() => createTemplate(d, name, icon, blocks, props));
    res.json({ id, title: name, icon });
  });

  /** Nouvelle ligne depuis un modèle : copie des propriétés et du contenu, mentions « @Today » résolues. */
  router.post('/:id/from-template/:tid', requireAuth, (req, res) => {
    const d = dbOf(req, req.params.id, 'edit');
    const tpl = db.prepare("SELECT * FROM pages WHERE id=? AND parent_id=? AND kind='template' AND archived=0").get(req.params.tid, d.id);
    if (!tpl) throw err('Modèle introuvable', 404);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.today || '') ? req.body.today : new Date().toISOString().slice(0, 10);
    const id = uid(), t = now();
    tx(() => {
      const max = db.prepare('SELECT COALESCE(MAX(position),0) m FROM pages WHERE parent_id=?').get(d.id).m;
      const tprops = parse(tpl.props, {}) || {}, props = { ...defaultProps(d.id) }; // valeurs par défaut de la base, que le modèle peut remplacer
      for (const [k, v] of Object.entries(tprops)) if (!TIME_PROPS.has(v?.type) && !k.startsWith('dw_')) props[k] = v;
      const sch = parse(d.schema, {}) || {};
      for (const [k, v] of Object.entries(req.body?.props || {})) if (sch[k] && !k.startsWith('dw_') && (v === null || typeof v === 'object')) props[k] = v; // ex. la colonne Kanban où l'on crée la carte
      Object.assign(props, autoProps(d.id));
      const given = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 300) : '', title = given || tpl.title;
      const tk = Object.keys(sch).find((k) => sch[k].type === 'title');
      if (given && tk) props[tk] = { type: 'title', title: [{ type: 'text', text: { content: given, link: null }, plain_text: given, annotations: {}, href: null }] };
      db.prepare(`INSERT INTO pages(id,parent_id,owner_id,kind,title,icon,cover,props,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, d.id, d.owner_id, 'page', title, tpl.icon, tpl.cover, JSON.stringify(props), max + 1, t, t);
      const rows = db.prepare('SELECT * FROM blocks WHERE page_id=? ORDER BY position').all(tpl.id), map = new Map(rows.map((b) => [b.id, uid()]));
      insertBlocks(id, rows.map((b) => {
        const content = resolveMentions(parse(b.content, {}), today);
        return { id: map.get(b.id), parent_id: b.parent_id ? map.get(b.parent_id) || null : null, type: b.type, content };
      }), t);
    });
    schoolPageChanged(id);
    res.json({ id, title: db.prepare('SELECT title FROM pages WHERE id=?').get(id).title, icon: tpl.icon, props: parse(db.prepare('SELECT props FROM pages WHERE id=?').get(id).props, {}) });
  });

  /** Duplique un modèle (« Copie de … »). */
  router.post('/:id/templates/:tid/duplicate', requireAuth, (req, res) => {
    const d = dbOf(req, req.params.id, 'edit');
    const tpl = db.prepare("SELECT * FROM pages WHERE id=? AND parent_id=? AND kind='template'").get(req.params.tid, d.id);
    if (!tpl) throw err('Modèle introuvable', 404);
    const rows = db.prepare('SELECT * FROM blocks WHERE page_id=? ORDER BY position').all(tpl.id), map = new Map(rows.map((b) => [b.id, uid()]));
    const blocks = rows.map((b) => ({ id: map.get(b.id), parent_id: b.parent_id ? map.get(b.parent_id) || null : null, type: b.type, content: parse(b.content, {}) }));
    const id = tx(() => createTemplate(d, `${tpl.title} (copie)`, tpl.icon, blocks, parse(tpl.props, {}) || {}));
    res.json({ id });
  });
}
