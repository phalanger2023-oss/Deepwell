/**
 * Modèles de base de données (comme Notion) : un modèle est une vraie page (kind = 'template') rangée DANS la base,
 * donc éditable avec l'éditeur habituel (propriétés + contenu). Il n'apparaît ni dans le tableau, ni dans l'arbre, ni dans la recherche.
 * Créer une ligne « depuis un modèle » copie ses propriétés et ses blocs dans une nouvelle ligne ordinaire.
 */
import { db, uid, now, tx, parse, textOf } from './db.js';
import { requireAuth } from './auth.js';
import { accessFor, can } from './access.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const TIME_PROPS = new Set(['created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id']); // recalculées pour chaque nouvelle ligne

const rt = (text, ann = {}) => ({ type: 'text', text: { content: text, link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...ann }, plain_text: text, href: null });
const mentionToday = () => ({ type: 'mention', mention: { type: 'template_mention', template_mention: { type: 'template_mention_date', template_mention_date: 'today' } }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, plain_text: '@Today', href: null });

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
  const psa = [dateLine(), div(), head(1, 'Cours : '), orig, para('', orig.id), modif, para('', modif.id), div(), head(1, 'Addenda :'), e, para('', e.id), l, para('', l.id)];
  // 2. Fiche de révision
  const revision = [dateLine(), div(), head(1, 'À retenir'), para(), head(1, 'Définitions et formules'), para(), head(1, 'Exemples'), para(), head(1, 'Points à revoir'),
    B('to_do', { rich_text: [], checked: false, color: 'default' }), B('to_do', { rich_text: [], checked: false, color: 'default' })];
  // 3. Exercices
  const exo = [dateLine(), div(), head(1, 'Énoncé'), para(), head(1, 'Résolution'), para(), head(1, 'Correction'), para(), head(1, 'Remarques'), para()];
  return [{ title: 'P.S.A. #00-26-', icon: null, blocks: psa }, { title: 'Fiche de révision', icon: null, blocks: revision }, { title: 'Exercices', icon: null, blocks: exo }];
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

export function templatesRoutes(router, { autoProps, schoolPageChanged }) {
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
      const tprops = parse(tpl.props, {}) || {}, props = {};
      for (const [k, v] of Object.entries(tprops)) if (!TIME_PROPS.has(v?.type) && !k.startsWith('dw_')) props[k] = v;
      Object.assign(props, autoProps(d.id));
      db.prepare(`INSERT INTO pages(id,parent_id,owner_id,kind,title,icon,cover,props,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, d.id, d.owner_id, 'page', tpl.title, tpl.icon, tpl.cover, JSON.stringify(props), max + 1, t, t);
      const rows = db.prepare('SELECT * FROM blocks WHERE page_id=? ORDER BY position').all(tpl.id), map = new Map(rows.map((b) => [b.id, uid()]));
      insertBlocks(id, rows.map((b) => {
        const content = resolveMentions(parse(b.content, {}), today);
        return { id: map.get(b.id), parent_id: b.parent_id ? map.get(b.parent_id) || null : null, type: b.type, content };
      }), t);
    });
    schoolPageChanged(id);
    res.json({ id, title: tpl.title, icon: tpl.icon, props: parse(db.prepare('SELECT props FROM pages WHERE id=?').get(id).props, {}) });
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
