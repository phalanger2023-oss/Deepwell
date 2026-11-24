import { sortRanks } from './sortrank.js';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, uid, now, tx, parse, textOf, norm, keepIcon, UPLOAD_DIR, getSetting } from './db.js';
import { saveFile } from './files.js';
import { importNotionIcon } from './icons-local.js';
import { requireAuth } from './auth.js';
import { accessFor, can, isDescendant } from './access.js';
import { gcalTouch } from './gcal.js';
import { lockRouter, lockGuard, lockedIds, closedIds, lockFor } from './locks.js';
import { cleanProps } from './school.js';
import { isLegacyRow } from './templates.js';
import { schoolAutoTitle } from './school-naming.js';
import { sortAddenda } from './school-naming.js';
import { schoolPageChanged, schoolPagesDeleting, schoolPdmBackfill, schoolAddendumChanged, schoolAddendaBackfill } from './school-drive.js';
import { templatesRoutes } from './templates.js';

export const pagesRouter = express.Router();
pagesRouter.use(lockRouter);          // /:id/lock… (statut, déverrouillage, gestion)
pagesRouter.param('id', lockGuard);  // tout le reste : 423 tant qu'une page verrouillée n'est pas ouverte
const pageRow = (p) => ({
  id: p.id, parent_id: p.parent_id, owner_id: p.owner_id, kind: p.kind, title: p.title, icon: p.icon, cover: p.cover,
  props: parse(p.props, {}), schema: p.schema ? parse(p.schema, {}) : null, views: p.views ? parse(p.views, []) : [], position: p.position,
  archived: !!p.archived, created_at: p.created_at, updated_at: p.updated_at,
});
/** Propriétés « Créé le » / « Modifié le » : calculées à partir des vraies dates de la page (elles n'étaient pas stockées pour les lignes créées dans DeepWell). */
const withTimes = (props, schema, created, updated) => {
  const keys = Object.entries(schema || {}).filter(([, d]) => d?.type === 'created_time' || d?.type === 'last_edited_time');
  if (!keys.length) return props;
  const out = { ...(props || {}) };
  for (const [k, d] of keys) out[k] = { type: d.type, [d.type]: new Date(d.type === 'created_time' ? created : updated).toISOString() };
  return out;
};
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const token = (req) => (typeof req.query.token === 'string' ? req.query.token : null);

/** Résout un jeton de lien public vers la page partagée. */
pagesRouter.get('/public/:token', (req, res) => {
  const s = db.prepare('SELECT page_id FROM shares WHERE public_token=?').get(req.params.token);
  if (!s) return res.status(404).json({ error: 'Lien invalide ou désactivé' });
  res.json({ page_id: s.page_id });
});

// --- Favoris (propres à chaque utilisateur, ordre libre) ---
const favIds = (u) => db.prepare('SELECT f.page_id FROM favorites f JOIN pages p ON p.id=f.page_id WHERE f.user_id=? AND p.archived=0 ORDER BY f.position, f.page_id').all(u.id).map((r) => r.page_id).filter((id) => accessFor(u, id));
pagesRouter.get('/favorites', requireAuth, (req, res) => res.json(favIds(req.user)));
pagesRouter.post('/favorites', requireAuth, (req, res) => {
  const id = str(req.body?.page_id, 64);
  if (!id || !accessFor(req.user, id)) return res.status(404).json({ error: 'Page introuvable' });
  const max = db.prepare('SELECT COALESCE(MAX(position), 0) m FROM favorites WHERE user_id=?').get(req.user.id).m;
  db.prepare('INSERT OR IGNORE INTO favorites(user_id,page_id,position) VALUES(?,?,?)').run(req.user.id, id, max + 1);
  res.json(favIds(req.user));
});
pagesRouter.put('/favorites/order', requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string').slice(0, 500) : [];
  tx(() => ids.forEach((id, i) => db.prepare('UPDATE favorites SET position=? WHERE user_id=? AND page_id=?').run(i + 1, req.user.id, id)));
  res.json(favIds(req.user));
});
pagesRouter.delete('/favorites/:pid', requireAuth, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id=? AND page_id=?').run(req.user.id, req.params.pid);
  res.json(favIds(req.user));
});

pagesRouter.get('/tree', requireAuth, (req, res) => {
  const cols = 'id,parent_id,kind,title,icon,position,archived,owner_id,(notion_id IS NOT NULL) AS imported, EXISTS(SELECT 1 FROM page_locks l WHERE l.page_id=pages.id) AS locked';
  const mine = db.prepare(`SELECT ${cols} FROM pages WHERE owner_id=? AND kind != 'template' ORDER BY position, created_at`).all(req.user.id);
  const roots = db.prepare('SELECT page_id FROM shares WHERE user_id=?').all(req.user.id).map((r) => r.page_id);
  const shared = db.prepare(`WITH RECURSIVE d(id) AS (
      SELECT page_id FROM shares WHERE user_id=?1
      UNION SELECT p.id FROM pages p JOIN d ON p.parent_id=d.id)
    SELECT ${cols} FROM pages WHERE id IN (SELECT id FROM d) AND owner_id != ?1 AND kind != 'template' ORDER BY position`).all(req.user.id);
  const kind = new Map([...mine, ...shared].map((p) => [p.id, p.kind]));
  const redact = (list) => { const c = closedIds(req, list.filter((p) => kind.get(p.parent_id) === 'database').map((p) => p.id)); return list.map((p) => (c.has(p.id) ? { ...p, title: '', icon: null } : p)); };
  res.json({ pages: redact(mine), shared: redact(shared), sharedRoots: roots });
});

pagesRouter.get('/search', requireAuth, (req, res) => {
  // multi-mots (tous requis), insensible à la casse ET aux accents
  const words = norm(String(req.query.q || '').trim().slice(0, 100)).split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return res.json([]);
  const likes = words.map((w) => `%${w.replace(/[\\%_]/g, '\\$&')}%`);
  const cond = (col) => words.map((_, i) => `norm(${col}) LIKE ?${i + 2} ESCAPE '\\'`).join(' AND ');
  const acc = `WITH RECURSIVE acc(id) AS (
      SELECT id FROM pages WHERE owner_id=?1
      UNION SELECT page_id FROM shares WHERE user_id=?1
      UNION SELECT p.id FROM pages p JOIN acc ON p.parent_id=acc.id)`;
  const prefix = `${likes[0].slice(1)}`; // « mot% » : les titres qui commencent par le mot passent en premier
  const byTitle = db.prepare(`${acc} SELECT p.id,p.title,p.icon,p.kind,par.title AS parent_title FROM pages p
    LEFT JOIN pages par ON par.id=p.parent_id WHERE p.id IN (SELECT id FROM acc) AND p.archived=0 AND p.kind != 'template' AND ${cond('p.title')}
    ORDER BY CASE WHEN norm(p.title) LIKE ?${words.length + 2} ESCAPE '\\' THEN 0 ELSE 1 END, p.updated_at DESC LIMIT 20`)
    .all(req.user.id, ...likes, prefix);
  const byText = db.prepare(`${acc} SELECT p.id,p.title,p.icon,p.kind,par.title AS parent_title,substr(b.text,1,1000) AS snippet
    FROM blocks b JOIN pages p ON p.id=b.page_id LEFT JOIN pages par ON par.id=p.parent_id
    WHERE p.id IN (SELECT id FROM acc) AND p.archived=0 AND p.kind != 'template' AND ${cond('b.text')} LIMIT 60`).all(req.user.id, ...likes);
  const hidden = lockedIds([...new Set(byText.map((r) => r.id))]); // le contenu d'une page verrouillée n'apparaît pas dans la recherche
  const dbRows = byTitle.filter((p) => db.prepare("SELECT 1 FROM pages WHERE id=(SELECT parent_id FROM pages WHERE id=?) AND kind='database'").get(p.id)).map((p) => p.id);
  const shut = closedIds(req, dbRows); // titre d'une ligne de base verrouillée : introuvable tant que le code n'a pas été saisi
  for (let i = byTitle.length - 1; i >= 0; i--) if (shut.has(byTitle[i].id)) byTitle.splice(i, 1);
  const seen = new Set(byTitle.map((p) => p.id)), out = [...byTitle];
  for (const r of byText) {
    if (seen.has(r.id) || hidden.has(r.id) || out.length >= 30) continue;
    seen.add(r.id);
    const at = Math.max(0, norm(r.snippet).indexOf(words[0]) - 40); // extrait centré sur la correspondance
    out.push({ ...r, snippet: (at ? '…' : '') + r.snippet.slice(at, at + 140) });
  }
  res.json(out);
});

/**
 * Propriétés à remplissage automatique d'une base : colonnes « Nombre » marquées auto_increment et colonnes « ID unique » (Notion).
 * Une nouvelle ligne reçoit (plus grande valeur existante) + 1 ; la valeur reste modifiable à la main ensuite.
 */
function autoProps(parentId) {
  const par = parentId && db.prepare('SELECT kind, schema FROM pages WHERE id=?').get(parentId);
  if (!par || par.kind !== 'database') return {};
  const schema = parse(par.schema, {}) || {}, out = {};
  const auto = Object.entries(schema).filter(([, d]) => (d?.type === 'number' && d.number?.auto_increment) || d?.type === 'unique_id');
  if (!auto.length) return out;
  const rows = db.prepare('SELECT props FROM pages WHERE parent_id=?').all(parentId).map((r) => parse(r.props, {}) || {});
  for (const [k, d] of auto) {
    let m = 0;
    for (const p of rows) { const n = d.type === 'unique_id' ? p[k]?.unique_id?.number : p[k]?.number; if (Number.isFinite(n) && n > m) m = n; }
    out[k] = d.type === 'unique_id' ? { type: 'unique_id', unique_id: { prefix: d.unique_id?.prefix ?? null, number: m + 1 } } : { type: 'number', number: m + 1 };
  }
  return out;
}

/**
 * Valeurs par défaut d'une base (réglage « Valeurs par défaut ») : enregistrées dans les propriétés de la base (`dw_defaults`, une valeur par propriété).
 * Une nouvelle ligne les reçoit ; les valeurs qui ne correspondent plus à une propriété existante du même type sont ignorées.
 */
const DEFAULT_TYPES = new Set(['select', 'status', 'multi_select', 'checkbox', 'number', 'rich_text', 'url', 'email', 'phone_number']);
function defaultProps(parentId) {
  const par = parentId && db.prepare('SELECT kind, schema, props FROM pages WHERE id=?').get(parentId);
  if (!par || par.kind !== 'database') return {};
  const schema = parse(par.schema, {}) || {}, defs = parse(par.props, {})?.dw_defaults, out = {};
  if (!defs || typeof defs !== 'object') return out;
  for (const [k, v] of Object.entries(defs)) {
    const d = schema[k];
    if (d && DEFAULT_TYPES.has(d.type) && v && v.type === d.type) out[k] = v;
  }
  return out;
}

pagesRouter.post('/', requireAuth, (req, res) => {
  const { parent_id = null, title = '', kind = 'page', icon = null } = req.body || {};
  let owner = req.user.id;
  if (parent_id) {
    const role = accessFor(req.user, parent_id);
    if (!can(role, 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
    owner = db.prepare('SELECT owner_id FROM pages WHERE id=?').get(parent_id).owner_id;
  }
  const id = uid(), t = now();
  const max = db.prepare('SELECT COALESCE(MAX(position),0) m FROM pages WHERE parent_id IS ? AND owner_id=?').get(parent_id, owner).m;
  const schema = kind === 'database'
    ? JSON.stringify({ Name: { id: 'title', name: 'Name', type: 'title', title: {} } }) : null;
  const props = JSON.stringify({ ...defaultProps(parent_id), ...autoProps(parent_id) });
  db.prepare(`INSERT INTO pages(id,parent_id,owner_id,kind,title,icon,props,schema,position,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, parent_id, owner, ['database', 'folder'].includes(kind) ? kind : 'page',
    String(title).slice(0, 500), str(icon, 200) ?? null, props, schema, max + 1, t, t);
  if (parent_id) sortAddenda(parent_id); // mode scolaire : un nouvel addendum se range à son numéro
  res.json(pageRow(db.prepare('SELECT * FROM pages WHERE id=?').get(id)));
});

templatesRoutes(pagesRouter, { autoProps, defaultProps, schoolPageChanged, writeBlocks, snapshot, schoolPdmBackfill, schoolAddendaBackfill });

pagesRouter.get('/:id', (req, res) => {
  const role = accessFor(req.user, req.params.id, token(req));
  if (!role) return res.status(req.user ? 404 : 401).json({ error: 'Page introuvable' });
  const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  const blocks = db.prepare('SELECT id,parent_id,type,content FROM blocks WHERE page_id=? ORDER BY position').all(p.id)
    .map((b) => ({ ...b, content: parse(b.content, {}) }));
  const school = p.kind === 'database' && !!parse(p.props, {})?.dw_school?.enabled;
  const children = db.prepare('SELECT id,kind,title,icon,cover,props,position,created_at,updated_at FROM pages WHERE parent_id=? AND archived=0 AND kind != \'template\' ORDER BY position')
    .all(p.id).map(({ created_at, updated_at, ...c }) => ({ ...c, props: p.kind === 'database' ? withTimes(parse(c.props, {}), parse(p.schema, {}), created_at, updated_at) : undefined, ...(school && c.kind === 'page' && isLegacyRow(created_at, parse(c.props, {})) ? { legacy: true } : {}) }));
  if (p.kind === 'database') { // ligne verrouillée et non ouverte : ni titre, ni icône, ni propriétés (seul son identifiant sert à ouvrir l'écran du code)
    const closed = closedIds(req, children.map((c) => c.id));
    const ranks = closed.size ? sortRanks(children, [...closed], Object.keys(parse(p.schema, {}))) : null; // position de tri seulement (jamais les valeurs)
    children.forEach((c, i) => { if (closed.has(c.id)) children[i] = { id: c.id, kind: c.kind, title: '', icon: null, cover: null, props: {}, position: c.position, locked: true, srank: ranks.get(c.id), total: children.length }; });
  }
  const crumbs = []; let cur = p.parent_id, g = 0;
  while (cur && g++ < 50) {
    const c = db.prepare('SELECT id,parent_id,title,icon,kind FROM pages WHERE id=?').get(cur);
    if (!c || !accessFor(req.user, c.id, token(req))) break;
    crumbs.unshift({ id: c.id, title: c.title, icon: c.icon, kind: c.kind }); cur = c.parent_id;
  }
  const parent = p.parent_id && db.prepare('SELECT kind,schema FROM pages WHERE id=?').get(p.parent_id);
  res.json({
    page: parent?.kind === 'database' ? { ...pageRow(p), props: withTimes(parse(p.props, {}), parse(parent.schema, {}), p.created_at, p.updated_at) } : pageRow(p), blocks, children, crumbs, role,
    parentSchema: parent?.kind === 'database' && accessFor(req.user, p.parent_id, token(req)) ? parse(parent.schema, {}) : null,
  });
});

/** Début du texte de chaque sous-page d'une base (vue Calendrier). Les pages verrouillées sont exclues. */
pagesRouter.get('/:id/excerpts', (req, res) => {
  const role = accessFor(req.user, req.params.id, token(req));
  if (!role) return res.status(req.user ? 404 : 401).json({ error: 'Page introuvable' });
  const kids = db.prepare('SELECT id FROM pages WHERE parent_id=? AND archived=0 AND kind != \'template\' LIMIT 1000').all(req.params.id).map((r) => r.id);
  const hidden = lockedIds(kids), out = {};
  const q = db.prepare("SELECT text FROM blocks WHERE page_id=? AND text<>'' ORDER BY position LIMIT 6");
  for (const id of kids) {
    if (hidden.has(id)) continue;
    const t = q.all(id).map((b) => b.text.trim()).filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 160);
    if (t) out[id] = t;
  }
  res.json(out);
});

pagesRouter.patch('/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const role = accessFor(req.user, id);
  if (!can(role, 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  const b = req.body || {}, sets = [], vals = [];
  const set = (col, v) => { sets.push(`${col}=?`); vals.push(v); };
  if (typeof b.title === 'string') set('title', b.title.slice(0, 500));
  if ('icon' in b) { set('icon', str(b.icon, 2000) ?? null); if (typeof b.icon === 'string' && /^\/files\/[0-9a-f-]{36}$/.test(b.icon)) keepIcon(req.user.id, b.icon, db.prepare('SELECT name FROM files WHERE id=?').get(b.icon.slice(7))?.name || ''); } // toute image devenue icône rejoint la collection
  if ('cover' in b) set('cover', str(b.cover, 2000) ?? null);
  if (b.props && typeof b.props === 'object') {
    const keep = parse(db.prepare('SELECT props FROM pages WHERE id=?').get(id)?.props, {})?.dw_autotitle; // titre généré par DeepWell : conservé même si le client renvoie des propriétés sans lui
    set('props', JSON.stringify(cleanProps(keep && !('dw_autotitle' in b.props) ? { ...b.props, dw_autotitle: keep } : b.props)));
  }
  if (b.schema && typeof b.schema === 'object') set('schema', JSON.stringify(b.schema));
  if (Array.isArray(b.views) && b.views.length <= 50 && JSON.stringify(b.views).length < 200000) set('views', JSON.stringify(b.views));
  if (typeof b.position === 'number') set('position', b.position);
  if (typeof b.archived === 'boolean') set('archived', b.archived ? 1 : 0);
  if ('parent_id' in b) {
    const np = b.parent_id;
    if (np) {
      if (np === id || isDescendant(np, id)) return res.status(400).json({ error: 'Déplacement impossible dans soi-même' });
      if (!can(accessFor(req.user, np), 'edit')) return res.status(403).json({ error: 'Droits insuffisants sur la destination' });
    } else if (role !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut placer une page à la racine' });
    set('parent_id', np || null);
  }
  if (!sets.length) return res.json({ ok: true });
  tx(() => {
    db.prepare(`UPDATE pages SET ${sets.join(',')}, updated_at=? WHERE id=?`).run(...vals, now(), id);
    if ('parent_id' in b && typeof b.position !== 'number') {
      db.prepare('UPDATE pages SET position=(SELECT COALESCE(MAX(position),0)+1 FROM pages WHERE parent_id IS ?1 AND id != ?2) WHERE id=?2').run(b.parent_id || null, id);
    }
    if ('parent_id' in b && b.parent_id) {
      const owner = db.prepare('SELECT owner_id FROM pages WHERE id=?').get(b.parent_id).owner_id;
      db.prepare(`WITH RECURSIVE d(id) AS (SELECT ?1 UNION SELECT p.id FROM pages p JOIN d ON p.parent_id=d.id)
        UPDATE pages SET owner_id=?2 WHERE id IN (SELECT id FROM d)`).run(id, owner);
    }
  });
  const autoTitle = b.props ? schoolAutoTitle(id) : null; // mode scolaire : matière choisie sur une fiche sans nom → titre « P.S.A. #n-année-abréviation »
  if (b.title !== undefined) { const par = db.prepare('SELECT parent_id FROM pages WHERE id=?').get(id)?.parent_id; if (par) sortAddenda(par); } // titre changé : l'addendum reprend sa place selon son numéro
  schoolPageChanged(id); // mode scolaire : titre ou matière changés → dossier Drive à aligner (tâche de fond)
  gcalTouch(id); // base synchronisée avec Google Agenda : mise à jour de l'événement (tâche de fond)
  res.json(autoTitle ? { ok: true, title: autoTitle } : { ok: true });
});

/** Duplique une page avec son contenu et toutes ses sous-pages (la copie n'est liée à aucun import Notion). */
pagesRouter.post('/:id/duplicate', requireAuth, (req, res) => {
  const src = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!src || !can(accessFor(req.user, src.id), 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  if (src.parent_id && !can(accessFor(req.user, src.parent_id), 'edit')) return res.status(403).json({ error: 'Droits insuffisants sur le dossier parent' });
  const idMap = new Map();
  const result = tx(() => {
    let count = 0;
    const copy = (srcId, parentId, top) => {
      if (++count > 2000) throw Object.assign(new Error('Trop de pages à dupliquer (2000 maximum)'), { status: 400 });
      const p = db.prepare('SELECT * FROM pages WHERE id=?').get(srcId), id = uid(), t = now();
      idMap.set(srcId, id);
      db.prepare(`INSERT INTO pages(id,parent_id,owner_id,kind,title,icon,cover,props,schema,views,position,archived,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, parentId, src.owner_id, p.kind, top ? `${p.title} (copie)` : p.title, p.icon, p.cover, p.props, p.schema, p.views, top ? p.position + 0.5 : p.position, t, t);
      const blocks = db.prepare('SELECT * FROM blocks WHERE page_id=? ORDER BY position').all(srcId), bmap = new Map(blocks.map((b) => [b.id, uid()]));
      const ins = db.prepare('INSERT INTO blocks(id,page_id,parent_id,type,content,text,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
      for (const b of blocks) ins.run(bmap.get(b.id), id, b.parent_id ? bmap.get(b.parent_id) || null : null, b.type, b.content, b.text, b.position, t, t);
      for (const c of db.prepare('SELECT id FROM pages WHERE parent_id=? AND archived=0 ORDER BY position').all(srcId)) copy(c.id, id, false);
      return id;
    };
    const newId = copy(src.id, src.parent_id, true);
    // les blocs « sous-page » des copies doivent pointer vers les sous-pages COPIÉES, pas vers les originales
    for (const nid of idMap.values()) {
      for (const b of db.prepare("SELECT id,content FROM blocks WHERE page_id=? AND type IN ('child_page','child_database')").all(nid)) {
        let c = b.content; for (const [o, n] of idMap) c = c.split(o).join(n);
        if (c !== b.content) db.prepare('UPDATE blocks SET content=? WHERE id=?').run(c, b.id);
      }
    }
    return newId;
  });
  gcalTouch(result);
  res.json(pageRow(db.prepare('SELECT * FROM pages WHERE id=?').get(result)));
});

/** Supprime : corbeille par défaut, définitif avec ?permanent=1 (propriétaire uniquement). */
pagesRouter.delete('/:id', requireAuth, (req, res) => {
  const role = accessFor(req.user, req.params.id);
  if (!can(role, 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  const isTpl = db.prepare("SELECT 1 FROM pages WHERE id=? AND kind='template'").get(req.params.id);
  gcalTouch(req.params.id); // programmé avec 5 s de recul : la suppression est faite quand la tâche s'exécute
  if (isTpl) db.prepare('DELETE FROM pages WHERE id=?').run(req.params.id); // modèle : suppression définitive, sans corbeille
  else if (req.query.permanent === '1') {
    if (role !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut supprimer définitivement' });
    schoolPagesDeleting(req.params.id); // mode scolaire : dossiers Drive concernés → corbeille de Drive (récupérable)
    db.prepare('DELETE FROM pages WHERE id=?').run(req.params.id);
  } else db.prepare('UPDATE pages SET archived=1, updated_at=? WHERE id=?').run(now(), req.params.id);
  res.json({ ok: true });
});

// --- Historique des versions ---
const MIN_GAP_MS = 5 * 60_000, MAX_VERSIONS = 120;
const versionRow = (v) => ({ id: v.id, created_at: v.created_at, user: v.user_name || '', title: v.title, n: v.n, preview: v.preview, reason: v.reason });
/** Enregistre l'état ACTUEL de la page (avant une modification) si rien n'a été gardé depuis `minGap` ms et si le contenu a changé. */
function snapshot(pageId, user, reason = '', minGap = MIN_GAP_MS) {
  const lastAt = db.prepare('SELECT created_at FROM page_versions WHERE page_id=? ORDER BY created_at DESC LIMIT 1').get(pageId);
  if (lastAt && now() - lastAt.created_at < minGap) return null; // le plus fréquent : on n'a pas besoin de charger l'instantané précédent
  const last = lastAt && db.prepare('SELECT created_at, data FROM page_versions WHERE page_id=? ORDER BY created_at DESC LIMIT 1').get(pageId);
  const blocks = db.prepare('SELECT id,parent_id,type,content FROM blocks WHERE page_id=? ORDER BY position').all(pageId).map((b) => ({ ...b, content: parse(b.content, {}) }));
  const p = db.prepare('SELECT title,icon FROM pages WHERE id=?').get(pageId);
  if (!p || (!blocks.length && !last)) return null; // page vide sans historique : rien à garder
  const data = zlib.deflateSync(JSON.stringify(blocks));
  if (last && Buffer.compare(Buffer.from(last.data), data) === 0) return null;
  const preview = blocks.map((b) => textOf(b.content)).filter(Boolean).join(' · ').slice(0, 160);
  const id = uid();
  db.prepare('INSERT INTO page_versions(id,page_id,user_id,user_name,title,icon,data,n,preview,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, pageId, user?.id || null, user?.name || user?.email || '', p.title, p.icon, data, blocks.length, preview, reason, now());
  db.prepare(`DELETE FROM page_versions WHERE page_id=?1 AND id NOT IN (SELECT id FROM page_versions WHERE page_id=?1 ORDER BY created_at DESC LIMIT ?2)`).run(pageId, MAX_VERSIONS);
  return id;
}
const loadVersion = (pageId, vid) => {
  const v = db.prepare('SELECT * FROM page_versions WHERE id=? AND page_id=?').get(vid, pageId);
  return v && { v, blocks: parse(zlib.inflateSync(Buffer.from(v.data)).toString('utf8'), []) };
};
pagesRouter.get('/:id/versions', requireAuth, (req, res) => {
  if (!can(accessFor(req.user, req.params.id), 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  res.json(db.prepare('SELECT id,user_name,title,n,preview,reason,created_at FROM page_versions WHERE page_id=? ORDER BY created_at DESC').all(req.params.id).map(versionRow));
});
pagesRouter.get('/:id/versions/:vid', requireAuth, (req, res) => {
  if (!can(accessFor(req.user, req.params.id), 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  const r = loadVersion(req.params.id, req.params.vid);
  r ? res.json({ ...versionRow(r.v), icon: r.v.icon, blocks: r.blocks }) : res.status(404).json({ error: 'Version introuvable' });
});
/** Restaure une version : l'état actuel est d'abord gardé comme version (« avant restauration »), donc rien n'est perdu. */
pagesRouter.post('/:id/versions/:vid/restore', requireAuth, (req, res) => {
  const pageId = req.params.id;
  if (!can(accessFor(req.user, pageId), 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  const r = loadVersion(pageId, req.params.vid);
  if (!r) return res.status(404).json({ error: 'Version introuvable' });
  tx(() => {
    snapshot(pageId, req.user, 'Avant restauration', 0);
    writeBlocks(pageId, r.blocks);
    db.prepare('UPDATE pages SET title=?, icon=?, updated_at=? WHERE id=?').run(r.v.title, r.v.icon, now(), pageId);
  });
  res.json({ ok: true });
});

// --- Icônes personnalisées (collection persistante, propre à chaque utilisateur) ---
pagesRouter.get('/icons/collection', requireAuth, (req, res) =>
  res.json(db.prepare("SELECT c.id,c.url,c.name,c.created_at,c.source,(f.mime='image/svg+xml') AS svg FROM custom_icons c LEFT JOIN files f ON '/files/'||f.id=c.url WHERE c.owner_id=? ORDER BY c.created_at DESC").all(req.user.id)));
pagesRouter.post('/icons/notion', requireAuth, async (req, res) => {
  try { res.json(await importNotionIcon(req.user.id, req.body?.name, req.body?.color || 'gray')); }
  catch (e) { res.status(e.status || 502).json({ error: e.status ? e.message : 'Notion est injoignable pour le moment' }); }
});
// Recolore une icône SVG de la collection : une copie est créée (l'original reste intact) et rangée dans la même section
const ICON_PALETTE = { gray: '#9b9a97', lightgray: '#d3d1cb', brown: '#9f6b53', orange: '#d9730d', yellow: '#cb912f', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47' };
pagesRouter.post('/icons/recolor', requireAuth, (req, res) => {
  const url = str(req.body?.url, 200) || '', c = str(req.body?.color, 20) || '';
  const color = ICON_PALETTE[c] || (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);
  const m = /^\/files\/([0-9a-f-]{36})$/.exec(url);
  if (!m || !color) return res.status(400).json({ error: 'Icône ou couleur invalide' });
  const f = db.prepare("SELECT f.name FROM files f JOIN custom_icons c ON c.url='/files/'||f.id WHERE f.id=? AND c.owner_id=? AND f.mime='image/svg+xml'").get(m[1], req.user.id);
  if (!f) return res.status(404).json({ error: 'Icône SVG introuvable dans votre collection' });
  const stem = f.name.replace(/\.svg$/i, '').replace(/_(gray|lightgray|brown|orange|yellow|green|blue|purple|pink|red|[0-9a-f]{6})$/i, '');
  const name = stem + '_' + color.slice(1);
  const dup = db.prepare('SELECT url FROM custom_icons WHERE owner_id=? AND name=?').get(req.user.id, name);
  if (dup) return res.json({ url: dup.url, name });
  let svg = fs.readFileSync(path.join(UPLOAD_DIR, m[1]), 'utf8');
  const paint = /(fill|stroke)="(?!none|url)[^"]*"/gi;
  svg = paint.test(svg) ? svg.replace(paint, '$1="' + color + '"') : svg.replace(/<svg\b/, '<svg fill="' + color + '"');
  const saved = saveFile(req.user.id, name + '.svg', 'image/svg+xml', Buffer.from(svg));
  const src = db.prepare('SELECT source FROM custom_icons WHERE owner_id=? AND url=?').get(req.user.id, url)?.source || 'upload';
  keepIcon(req.user.id, saved.url, name, src);
  res.json({ url: saved.url, name });
});

pagesRouter.post('/icons/collection', requireAuth, (req, res) => {
  const url = str(req.body?.url, 2000), name = str(req.body?.name, 200) || '';
  if (!url || !/^(\/files\/|https?:\/\/)/.test(url)) return res.status(400).json({ error: 'Adresse d’image invalide' });
  const dup = db.prepare('SELECT id FROM custom_icons WHERE owner_id=? AND url=?').get(req.user.id, url);
  if (dup) return res.json({ id: dup.id, url, name });
  const id = uid();
  db.prepare('INSERT INTO custom_icons(id,owner_id,url,name,created_at) VALUES(?,?,?,?,?)').run(id, req.user.id, url, name, now());
  res.json({ id, url, name });
});
pagesRouter.delete('/icons/collection/:iid', requireAuth, (req, res) => {
  db.prepare('DELETE FROM custom_icons WHERE id=? AND owner_id=?').run(req.params.iid, req.user.id);
  res.json({ ok: true });
});

pagesRouter.put('/:id/blocks', requireAuth, (req, res) => {
  const pageId = req.params.id;
  if (!can(accessFor(req.user, pageId), 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  const list = req.body?.blocks;
  if (!Array.isArray(list) || list.length > 50000) return res.status(400).json({ error: 'Blocs invalides' });
  let t;
  tx(() => { snapshot(pageId, req.user); t = writeBlocks(pageId, list); });
  schoolAddendumChanged(pageId); // addendum d'un chapitre sur Drive : résumé écrit à mettre à jour
  res.json({ ok: true, saved_at: t });
});

/** Remplace tous les blocs d'une page (identifiants conservés si possible). */
function writeBlocks(pageId, list) {
  const t = now();
  {
    const existing = new Set(db.prepare('SELECT id FROM blocks WHERE page_id=?').all(pageId).map((r) => r.id));
    const foreign = db.prepare('SELECT 1 FROM blocks WHERE id=? AND page_id!=?');
    const ins = db.prepare(`INSERT INTO blocks(id,page_id,parent_id,type,content,text,position,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,type=excluded.type,
      content=excluded.content,text=excluded.text,position=excluded.position,updated_at=excluded.updated_at`);
    const counters = new Map(), keep = new Set();
    for (const b of list) {
      if (typeof b?.id !== 'string' || b.id.length > 64 || typeof b.type !== 'string' || b.type.length > 40) throw Object.assign(new Error('Bloc invalide'), { status: 400 });
      if (foreign.get(b.id, pageId)) throw Object.assign(new Error('Identifiant de bloc en conflit'), { status: 409 });
      const par = b.parent_id || null, pos = counters.get(par) || 0;
      counters.set(par, pos + 1); keep.add(b.id);
      const content = b.content && typeof b.content === 'object' ? b.content : {};
      ins.run(b.id, pageId, par, b.type, JSON.stringify(content), textOf(content), pos, t, t);
    }
    const del = db.prepare('DELETE FROM blocks WHERE id=?');
    for (const id of existing) if (!keep.has(id)) del.run(id);
    db.prepare('UPDATE pages SET updated_at=? WHERE id=?').run(t, pageId);
  }
  return t;
}

// --- Commentaires ---
const commentRow = (c) => ({ id: c.id, block_id: c.block_id, parent_id: c.parent_id, author_id: c.author_id, author: c.author_name, body: c.body, quote: c.quote, anchor: c.anchor ?? null, resolved: !!c.resolved, created_at: c.created_at, updated_at: c.updated_at, imported: !!c.notion_id });

pagesRouter.get('/:id/comments', requireAuth, (req, res) => {
  if (!accessFor(req.user, req.params.id)) return res.status(404).json({ error: 'Page introuvable' });
  const rows = db.prepare(`SELECT c.*, COALESCE(NULLIF(u.name,''), u.email, c.author_name) AS author_name FROM comments c
    LEFT JOIN users u ON u.id=c.author_id WHERE c.page_id=? ORDER BY c.created_at`).all(req.params.id);
  res.json(rows.map(commentRow));
});

pagesRouter.post('/:id/comments', requireAuth, (req, res) => {
  const role = accessFor(req.user, req.params.id);
  if (!can(role, 'comment')) return res.status(403).json({ error: 'Vous n’avez pas le droit de commenter cette page' });
  const { body, block_id = null, parent_id = null, quote = '', anchor = null } = req.body || {};
  const text = String(body || '').trim().slice(0, 10000);
  if (!text) return res.status(400).json({ error: 'Commentaire vide' });
  if (parent_id && !db.prepare('SELECT 1 FROM comments WHERE id=? AND page_id=?').get(parent_id, req.params.id)) return res.status(400).json({ error: 'Fil introuvable' });
  const id = uid(), t = now();
  db.prepare('INSERT INTO comments(id,page_id,block_id,parent_id,author_id,author_name,body,quote,anchor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.params.id, block_id ? String(block_id).slice(0, 64) : null, parent_id, req.user.id, req.user.name || req.user.email, text, String(quote).slice(0, 300), Number.isInteger(anchor) && anchor >= 0 && quote ? anchor : null, t, t);
  res.json(commentRow({ ...db.prepare('SELECT * FROM comments WHERE id=?').get(id), author_name: req.user.name || req.user.email }));
});

pagesRouter.patch('/:id/comments/:cid', requireAuth, (req, res) => {
  const role = accessFor(req.user, req.params.id), c = db.prepare('SELECT * FROM comments WHERE id=? AND page_id=?').get(req.params.cid, req.params.id);
  if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });
  const { resolved, body, created_at } = req.body || {};
  if (created_at !== undefined) {
    // date d'ajout d'origine : modifiable uniquement avec le mode développeur (Réglages), par l'auteur ou le propriétaire de la page
    if (getSetting('dev_mode', '0') !== '1') return res.status(403).json({ error: 'Mode développeur désactivé : la date de création d’un commentaire n’est pas modifiable' });
    if (c.author_id !== req.user.id && role !== 'owner') return res.status(403).json({ error: 'Seul l’auteur ou le propriétaire peut modifier cette date' });
    const t = typeof created_at === 'number' ? created_at : Date.parse(created_at);
    if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now() + 86400000) return res.status(400).json({ error: 'Date invalide' });
    db.prepare('UPDATE comments SET created_at=? WHERE id=?').run(Math.round(t), c.id);
  }
  if (typeof resolved === 'boolean') {
    if (!can(role, 'comment')) return res.status(403).json({ error: 'Droits insuffisants' });
    // résoudre un fil = résoudre le commentaire racine et ses réponses
    const root = c.parent_id || c.id;
    db.prepare('UPDATE comments SET resolved=?, updated_at=? WHERE page_id=? AND (id=? OR parent_id=?)').run(resolved ? 1 : 0, now(), req.params.id, root, root);
  }
  if (typeof body === 'string') {
    if (c.author_id !== req.user.id) return res.status(403).json({ error: 'Seul l’auteur peut modifier son commentaire' });
    if (!body.trim()) return res.status(400).json({ error: 'Commentaire vide' });
    db.prepare('UPDATE comments SET body=?, updated_at=? WHERE id=?').run(body.trim().slice(0, 10000), now(), c.id);
  }
  res.json({ ok: true });
});

pagesRouter.delete('/:id/comments/:cid', requireAuth, (req, res) => {
  const role = accessFor(req.user, req.params.id), c = db.prepare('SELECT * FROM comments WHERE id=? AND page_id=?').get(req.params.cid, req.params.id);
  if (!c) return res.status(404).json({ error: 'Commentaire introuvable' });
  if (c.author_id !== req.user.id && role !== 'owner') return res.status(403).json({ error: 'Seul l’auteur ou le propriétaire peut supprimer' });
  db.prepare('DELETE FROM comments WHERE id=? OR parent_id=?').run(c.id, c.id);
  res.json({ ok: true });
});

// --- Partage ---
pagesRouter.get('/:id/shares', requireAuth, (req, res) => {
  if (!can(accessFor(req.user, req.params.id), 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  res.json(db.prepare(`SELECT s.id,s.role,s.public_token,u.email,u.name FROM shares s
    LEFT JOIN users u ON u.id=s.user_id WHERE s.page_id=? ORDER BY s.created_at`).all(req.params.id));
});

pagesRouter.post('/:id/shares', requireAuth, (req, res) => {
  if (accessFor(req.user, req.params.id) !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut partager' });
  const { email, role = 'view', public: isPublic } = req.body || {};
  if (isPublic) {
    db.prepare("DELETE FROM shares WHERE page_id=? AND public_token IS NOT NULL").run(req.params.id);
    const tk = crypto.randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO shares(id,page_id,role,public_token,created_at) VALUES(?,?,?,?,?)').run(uid(), req.params.id, 'view', tk, now());
    return res.json({ public_token: tk });
  }
  if (!['view', 'comment', 'edit'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
  if (!u) return res.status(404).json({ error: "Aucun utilisateur avec cet e-mail. Créez d'abord son compte." });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Vous êtes déjà propriétaire' });
  db.prepare('DELETE FROM shares WHERE page_id=? AND user_id=?').run(req.params.id, u.id);
  db.prepare('INSERT INTO shares(id,page_id,user_id,role,created_at) VALUES(?,?,?,?,?)').run(uid(), req.params.id, u.id, role, now());
  res.json({ ok: true });
});

pagesRouter.delete('/:id/shares/:shareId', requireAuth, (req, res) => {
  if (accessFor(req.user, req.params.id) !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut modifier le partage' });
  db.prepare('DELETE FROM shares WHERE id=? AND page_id=?').run(req.params.shareId, req.params.id);
  res.json({ ok: true });
});

// --- Remplacer les liens vers des documents par les documents eux-mêmes ---
const EMPTY_ANN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
const blocksOf = (pageId) => db.prepare('SELECT id,parent_id,type,content FROM blocks WHERE page_id=? ORDER BY position').all(pageId).map((b) => ({ ...b, content: parse(b.content, {}) }));
const TEXTY = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'heading_4', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout']);
const PAGE_HREF = /\/#\/page\/([0-9a-f-]{36})/i;
/** Pages référencées par un bloc : lien/sous-page (bloc entier), ou mention / lien dans un texte (« solo » = rien d'autre dans le bloc), ou dans les cellules d'un tableau. */
function linkTargets(b) {
  const c = b.content || {};
  if (b.type === 'child_page' || b.type === 'link_to_page') { const t = c.page_id || c.id; return t ? [{ target: t, solo: true }] : []; }
  const lists = TEXTY.has(b.type) ? [c.rich_text || []] : b.type === 'table_row' ? (c.cells || []) : [];
  const out = [], seen = new Set();
  for (const rt of lists) {
    const real = rt.filter((r) => !(r.type === 'text' && !r.text?.link && !String(r.plain_text ?? r.text?.content ?? '').trim()));
    for (const r of rt) {
      const t = r.type === 'mention' && r.mention?.type === 'page' ? r.mention.page?.id : PAGE_HREF.exec(r.text?.link?.url || r.href || '')?.[1];
      if (t && !seen.has(t)) { seen.add(t); out.push({ target: t, solo: TEXTY.has(b.type) && real.length === 1 }); }
    }
  }
  return out;
}
/** Liens vers des documents présents sur CETTE page (les sous-pages ne sont pas traitées). */
function inlineCandidates(hostId, user) {
  const h = db.prepare('SELECT id,title FROM pages WHERE id=?').get(hostId), out = [];
  if (!h || !can(accessFor(user, h.id), 'edit')) return out;
  for (const b of blocksOf(h.id)) {
    for (const lt of linkTargets(b)) {
    const t = lt.target;
    const tp = db.prepare("SELECT id,title,parent_id FROM pages WHERE id=? AND kind='page' AND archived=0").get(t);
    const par = tp && tp.parent_id && db.prepare('SELECT kind FROM pages WHERE id=?').get(tp.parent_id);
    if (!tp || par?.kind === 'database' || tp.parent_id === h.id || isDescendant(h.id, tp.id) || !can(accessFor(user, tp.id), 'edit') || lockFor(tp.id)) continue;
    const loc = tp.parent_id && db.prepare('SELECT title FROM pages WHERE id=?').get(tp.parent_id);
    out.push({ target: tp.id, target_title: tp.title, host: h.id, host_title: h.title, block_id: b.id, cid: lt.solo ? b.id : b.id + '#' + tp.id, solo: lt.solo, kind: b.type, location: loc?.title ?? null, in_page: tp.parent_id === h.id, excerpt: textOf(b.content).slice(0, 80) });
    }
  }
  return out;
}
/**
 * Transforme le lien en SOUS-PAGE : la page ciblée est déplacée sous cette page (son contenu n'est pas copié ni inséré) et le lien
 * devient un bloc « sous-page ». Elle disparaît de son ancien emplacement (le bloc sous-page qui y pointait est retiré).
 */
function inlineOne(user, c) {
  const host = blocksOf(c.host), i = host.findIndex((b) => b.id === c.block_id);
  if (i < 0) return false;
  const t = db.prepare('SELECT id,title,parent_id FROM pages WHERE id=?').get(c.target);
  if (!t) return false;
  // l'ancien emplacement perd son bloc « sous-page » (sinon il pointerait vers une page qui n'y est plus)
  const old = db.prepare("SELECT DISTINCT page_id FROM blocks WHERE type='child_page' AND page_id!=? AND content LIKE ?").all(c.host, '%' + c.target + '%');
  for (const o of old) {
    const rows = blocksOf(o.page_id), keep = rows.filter((b) => !(b.type === 'child_page' && b.content?.page_id === c.target));
    if (keep.length !== rows.length) { snapshot(o.page_id, user, 'Avant déplacement d’une sous-page', 0); writeBlocks(o.page_id, keep.map((b) => (b.parent_id && !keep.some((k) => k.id === b.parent_id) ? { ...b, parent_id: null } : b))); }
  }
  const owner = db.prepare('SELECT owner_id FROM pages WHERE id=?').get(c.host).owner_id;
  db.prepare('UPDATE pages SET parent_id=?, position=(SELECT COALESCE(MAX(position),0)+1 FROM pages WHERE parent_id=?1), updated_at=? WHERE id=?').run(c.host, now(), c.target);
  db.prepare(`WITH RECURSIVE d(id) AS (SELECT ?1 UNION SELECT p.id FROM pages p JOIN d ON p.parent_id=d.id) UPDATE pages SET owner_id=?2 WHERE id IN (SELECT id FROM d)`).run(c.target, owner);
  snapshot(c.host, user, 'Avant remplacement des liens', 0);
  const cp = { id: c.solo ? host[i].id : uid(), parent_id: host[i].parent_id, type: 'child_page', content: { title: t.title, page_id: c.target } };
  if (c.solo) host[i] = cp;
  else { // texte mixte ou cellule de tableau : la sous-page est ajoutée juste après le bloc (ou le tableau) qui contient la mention
    const anchor = host[i].type === 'table_row' ? host.findIndex((b) => b.id === host[i].parent_id) : i;
    const at = anchor >= 0 ? anchor : i; cp.parent_id = host[at].parent_id; host.splice(at + 1, 0, cp);
  }
  writeBlocks(c.host, host);
  return true;
}
pagesRouter.post('/:id/inline-links', requireAuth, (req, res) => {
  const pageId = req.params.id;
  if (getSetting('dev_mode', '0') !== '1') return res.status(403).json({ error: 'Cette fonction nécessite le mode développeur (Réglages → Développeur)' });
  if (!can(accessFor(req.user, pageId), 'edit')) return res.status(403).json({ error: 'Droits insuffisants' });
  const cands = inlineCandidates(pageId, req.user);
  if (!Array.isArray(req.body?.block_ids)) return res.json({ links: cands });
  const want = new Set(req.body.block_ids.map(String)), doneT = new Set(); let inlined = 0;
  tx(() => {
    for (const c of cands) {
      if (!want.has(c.cid) || doneT.has(c.target)) continue; // doublon : un seul emplacement garde le document, les autres restent des liens
      if (inlineOne(req.user, c)) { doneT.add(c.target); inlined++; }
    }
  });
  res.json({ ok: true, inlined });
});
