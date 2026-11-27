/**
 * Import Notion via l'API officielle — la voie « sans perte ».
 *
 * Les blocs, propriétés et schémas de bases sont conservés au format JSON natif de Notion
 * (champ `content` + objet d'origine complet dans `raw`). Les fichiers hébergés par Notion
 * (dont les URL expirent après 1 h) sont téléchargés immédiatement. Les liens/mentions
 * internes sont réécrits vers les nouvelles pages. L'import est rejouable : les pages déjà
 * importées (même notion_id) sont mises à jour au lieu d'être dupliquées.
 */
import { keepIcon, db, uid, now, tx, textOf, parse } from './db.js';
import { saveFile } from './files.js';
import { NOTION_ICON_URL } from './icons-local.js';
import { createBackup } from './backup.js';

const API = (process.env.NOTION_API_URL || 'https://api.notion.com/v1').replace(/\/$/, '');
const VERSION = '2022-06-28';
// Les icônes natives de Notion (jeu d'icônes « minimalistes ») ne sont renvoyées que par les versions récentes de l'API : lecture ciblée avec NEWV.
const NEWV = process.env.NOTION_NEW_VERSION || '2026-03-11';
const ICON_BASE = (process.env.NOTION_ICON_BASE || 'https://www.notion.so/icons').replace(/\/$/, '');
const MIN_GAP_MS = Number(process.env.NOTION_MIN_GAP_MS ?? 340); // ~3 requêtes/s (limite Notion)
const FILE_TYPES = new Set(['image', 'file', 'pdf', 'video', 'audio']);
const NO_RECURSE = new Set(['child_page', 'child_database']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const NOTION_URL_RE = /https?:\/\/(?:www\.)?notion\.(?:so|site)\/(?:[^\s"'\\/?#]*\/)*(?:[^\s"'\\/?#]*-)?([0-9a-f]{32})(?:[^\s"'\\]*)?/g;
const dash = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export const jobs = new Map();

class Notion {
  constructor(token) { this.token = token; this.last = 0; }
  async req(method, path, body, version = VERSION) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = this.last + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const r = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': version, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 1) * 1000 + 200); continue; }
      if (r.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (!r.ok) throw Object.assign(new Error(`Notion ${r.status} ${path.split('?')[0]}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
      return r.json();
    }
    throw new Error(`Notion : trop de tentatives sur ${path}`);
  }
  async *paginate(path, method = 'GET', body = {}) {
    let cursor;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const data = method === 'GET'
        ? await this.req('GET', `${path}${sep}page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
        : await this.req(method, path, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      yield* data.results;
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);
  }
}

const plain = (rt) => (rt || []).map((r) => r.plain_text ?? r.text?.content ?? '').join('');

export function startNotionImport(userId, token, opts = {}) {
  const job = { id: uid(), kind: 'notion', overwrite: !!opts.overwrite, status: 'running', startedAt: now(), log: [], counts: { pages: 0, databases: 0, blocks: 0, files: 0, unsupported: 0, warnings: 0, missing: 0 } };
  jobs.set(job.id, job);
  runImport(job, userId, token).then(
    () => { job.status = 'done'; job.log.push('Import terminé.'); },
    (e) => { job.status = 'error'; job.error = e.message; job.log.push(`Erreur : ${e.message}`); },
  );
  return job;
}

async function runImport(job, userId, token) {
  const n = new Notion(token);
  const log = (m) => { job.log.push(m); if (job.log.length > 500) job.log.shift(); };
  const warn = (m) => { job.counts.warnings++; log(`⚠ ${m}`); };
  const fileCache = new Map();

  async function download(url, name) {
    if (!url) return null;
    const key = url.split('?')[0];
    if (fileCache.has(key)) return fileCache.get(key);
    const r = await fetch(url, { headers: { 'User-Agent': 'Deepwell/3.0 (self-hosted)' } }); // notion.so refuse les requêtes sans nom de client
    if (!r.ok) throw new Error(`téléchargement ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const fname = name || decodeURIComponent(new URL(url).pathname.split('/').pop() || 'fichier');
    const f = saveFile(userId, fname, r.headers.get('content-type')?.split(';')[0], buf);
    job.counts.files++;
    fileCache.set(key, f.url);
    return f.url;
  }
  /** Rapatrie un objet fichier Notion {type:'file'|'external'}. Les URL externes sont conservées telles quelles. */
  async function localizeFile(obj, name) {
    if (obj?.type !== 'file' || !obj.file?.url) return obj;
    try {
      const url = await download(obj.file.url, name);
      return { ...obj, type: 'external', external: { url }, local: true, file: undefined };
    } catch (e) { warn(`fichier non téléchargé (${name || obj.file.url.slice(0, 60)}) : ${e.message}`); return obj; }
  }
  // lecture d'un objet avec la version récente de l'API (icône native, configuration éventuelle d'un bouton) ; jamais bloquant
  let newOk = true;
  async function viaNew(path) {
    if (!newOk) return null;
    try { return await n.req('GET', path, undefined, NEWV); }
    catch (e) { if (e.status === 400) { newOk = false; warn(`version d'API ${NEWV} refusée par Notion : icônes natives et boutons non lus (${e.message.slice(0, 120)})`); } return null; }
  }
  /** Icône native Notion {type:'icon', icon:{name,color}} : le SVG identique est téléchargé et gardé chez toi. */
  async function nativeIcon(o) {
    const name = o?.icon?.name; if (!name) return null;
    const url = `${ICON_BASE}/${encodeURIComponent(name)}_${encodeURIComponent(o.icon.color || 'gray')}.svg`;
    try { const local = await download(url, `${name}_${o.icon.color || 'gray'}.svg`); job.counts.icons = (job.counts.icons || 0) + 1; return local; }
    catch (e) { warn(`icône native « ${name} » non téléchargée (${e.message}) : lien distant conservé`); return url; }
  }
  async function localizeIconOrCover(o) {
    if (o?.type === 'icon') return nativeIcon(o);
    if (!o) return null;
    if (o.type === 'emoji') return o.emoji;
    if (o.type === 'external') {
      const u = o.external.url, m = NOTION_ICON_URL.test(u) && /\/([^/_]+(?:-[^/_]+)*)_([a-z]+)\.svg/.exec(u);
      // l'API renvoie souvent les icônes natives comme des liens « notion.so/icons/… » : on les télécharge aussi
      if (m) return nativeIcon({ icon: { name: m[1], color: m[2] } });
      return u;
    }
    if (o.type === 'file') { const l = await localizeFile(o); return l.type === 'external' ? l.external.url : null; }
    return null;
  }
  async function localizeProps(props) {
    for (const p of Object.values(props || {})) {
      if (p?.type === 'files') p.files = await Promise.all((p.files || []).map((f) => localizeFile(f, f.name)));
    }
    return props;
  }

  // 1. Découverte : tout ce que l'intégration peut voir
  log('Recherche des pages et bases accessibles à l’intégration…');
  // L'endpoint /search de Notion est incomplet (index en retard, résultats tronqués) : on s'en sert comme point de départ,
  // puis on SUIT toutes les références (sous-pages, mentions, liens, bases, lignes de bases) pour ne rien laisser derrière.
  const items = [], seen = new Set();
  const ids = new Map();         // notion id (dashed) -> id local (pages ET blocs)
  const blockToPage = new Map(); // notion block id -> notion page id
  const pagePos = new Map();     // notion page id -> position issue de l'ordre des blocs child_page
  const refs = new Map();        // id référencé -> { kind: 'page'|'database', title }
  const missing = new Map();     // id référencé mais inaccessible -> titre
  const register = (it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id); items.push(it);
    const ex = db.prepare('SELECT id FROM pages WHERE owner_id=? AND notion_id=?').get(userId, it.id);
    ids.set(it.id, ex?.id || uid());
    return true;
  };
  const found = [];
  for await (const it of n.paginate('/search', 'POST', {})) found.push(it);
  if (!found.length) throw new Error("Aucune page visible. Dans Notion : ouvrez la page racine → ••• → Connexions → ajoutez votre intégration.");
  if (job.overwrite) {
    // Écrasement : on ne touche à rien tant que la connexion à Notion n'est pas validée (ci-dessus). Sauvegarde de sécurité d'abord,
    // puis suppression des pages déjà importées (et de leurs sous-pages/blocs/partages) avant de tout réimporter à neuf.
    const b = await createBackup();
    log(`Sauvegarde de sécurité créée : ${b.name} (restaurable avec « npm run restore »).`);
    const n0 = db.prepare('SELECT COUNT(*) c FROM pages WHERE owner_id=? AND notion_id IS NOT NULL').get(userId).c;
    db.prepare('DELETE FROM pages WHERE owner_id=? AND notion_id IS NOT NULL').run(userId);
    job.counts.replaced = n0;
    log(`Écrasement : ${n0} page(s) importées précédemment ont été supprimées. Réimport complet…`);
  }
  found.forEach(register);
  log(`${items.length} pages/bases trouvées par la recherche Notion (d'autres seront ajoutées en suivant les liens).`);
  const noteRef = (id, kind, title) => { if (id && !refs.has(id)) refs.set(id, { kind, title }); };
  function collectRefs(type, content, blockId) {
    if (type === 'child_page') noteRef(blockId, 'page', content.title);
    else if (type === 'child_database') noteRef(blockId, 'database', content.title);
    else if (type === 'link_to_page') { noteRef(content.page_id, 'page'); noteRef(content.database_id, 'database'); }
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.type === 'mention' && o.mention) {
        if (o.mention.type === 'page') noteRef(o.mention.page?.id, 'page', o.plain_text);
        else if (o.mention.type === 'database') noteRef(o.mention.database?.id, 'database', o.plain_text);
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
    };
    walk(content);
  }
  async function fetchObject(id, kind) {
    const order = kind === 'database' ? ['databases', 'pages'] : ['pages', 'databases'];
    let last;
    for (const ep of order) {
      try { return await n.req('GET', `/${ep}/${id}`); } catch (e) { last = e; if (![400, 403, 404].includes(e.status)) throw e; }
    }
    throw last;
  }

  const blockRows = new Map(); // page notion id -> lignes de blocs

  async function fetchBlocks(notionParentId, pageNotionId, localParent, out) {
    let pos = 0;
    for await (const b of n.paginate(`/blocks/${notionParentId}/children`)) {
      const local = uid();
      blockToPage.set(b.id, pageNotionId);
      let content = b[b.type] ?? {};
      if (b.type === 'child_page' || b.type === 'child_database') {
        // l'id d'un bloc child_page EST l'id de la page enfant : ne pas écraser la correspondance de la page
        pagePos.set(b.id, pos);
        content = { ...content, page_id: b.id };
      } else ids.set(b.id, local);
      if (b.type === 'callout' && !content.icon) {
        const full = await viaNew(`/blocks/${b.id}`);
        if (full?.callout?.icon?.type === 'icon') { const u = await nativeIcon(full.callout.icon); if (u) { keepIcon(userId, u, full.callout.icon.icon?.name || '', 'import'); content = { ...content, icon: { type: 'dw', value: u } }; } }
      }
      collectRefs(b.type, content, b.id);
      if (FILE_TYPES.has(b.type)) content = await localizeFile(content, content.name);
      let type = b.type;
      if (type === 'unsupported' && content?.block_type === 'button') {
        // L'API Notion ne renvoie AUCUNE configuration pour un bouton (ni nom, ni actions) : on crée un vrai bloc « bouton »
        // à reconfigurer dans Deepwell, au même endroit de la page, plutôt qu'un bloc mort.
        type = 'button'; content = { label: 'Bouton Notion', actions: [], imported: true };
        // une version récente de l'API expose peut-être davantage : on garde la réponse brute (rien n'est perdu, et elle permet de reconstruire la configuration)
        const full = await viaNew(`/blocks/${b.id}`);
        if (full && full.type !== 'unsupported') { content.notion = full[full.type] ?? full; job.counts.buttons_config = (job.counts.buttons_config || 0) + 1; }
        job.counts.buttons = (job.counts.buttons || 0) + 1;
      } else if (type === 'unsupported') { job.counts.unsupported++; warn(`bloc non supporté par l'API Notion (conservé en brut) dans ${pageNotionId}`); }
      const { has_children, ...rawNoKids } = b;
      out.push({ id: local, parent_id: localParent, type, content, position: pos++, notion_id: b.id, raw: rawNoKids, created: Date.parse(b.created_time) || now() });
      job.counts.blocks++;
      if (b.has_children && !NO_RECURSE.has(b.type)) await fetchBlocks(b.id, pageNotionId, local, out);
    }
  }

  // 3. Contenu de chaque page
  let i = 0;
  async function processItem(it) {
    i++;
    const isDb = it.object === 'database';
    job.progress = { done: i, total: items.length };
    let title = isDb ? plain(it.title) : plain(Object.values(it.properties || {}).find((p) => p.type === 'title')?.title);
    log(`(${i}/${items.length}) ${isDb ? '🗄' : '📄'} ${title || 'Sans titre'}`);
    try {
      const rows = [];
      if (!isDb) await fetchBlocks(it.id, it.id, null, rows);
      else {
        // lignes de la base (la recherche Notion ne les renvoie pas toujours toutes)
        try { for await (const row of n.paginate(`/databases/${it.id}/query`, 'POST', {})) register(row); }
        catch (e) { warn(`lignes de la base « ${title} » non lues : ${e.message}`); }
      }
      blockRows.set(it.id, rows);
      let comments = [];
      if (!isDb) {
        try { for await (const c of n.paginate(`/comments?block_id=${it.id}`)) comments.push(c); } catch { /* capacité « lire les commentaires » non accordée */ }
      }
      let iconObj = it.icon;
      if (!iconObj) iconObj = (await viaNew(`/${isDb ? 'databases' : 'pages'}/${it.id}`))?.icon || null;
      const icon = await localizeIconOrCover(iconObj); keepIcon(userId, icon, iconObj?.icon?.name || '', 'import'); const cover = await localizeIconOrCover(it.cover);
      const props = isDb ? {} : await localizeProps(it.properties);
      const schema = isDb ? it.properties : null;
      const raw = { ...it, comments: comments.length ? comments : undefined };
      const local = ids.get(it.id);
      tx(() => {
        const exists = db.prepare('SELECT 1 FROM pages WHERE id=?').get(local);
        const t = now();
        if (exists) {
          db.prepare('UPDATE pages SET kind=?,title=?,icon=?,cover=?,props=?,schema=?,archived=?,raw=?,updated_at=? WHERE id=?')
            .run(isDb ? 'database' : 'page', title, icon, cover, JSON.stringify(props), schema ? JSON.stringify(schema) : null, it.archived ? 1 : 0, JSON.stringify(raw), t, local);
        } else {
          db.prepare(`INSERT INTO pages(id,parent_id,owner_id,kind,title,icon,cover,props,schema,position,archived,notion_id,raw,created_at,updated_at)
            VALUES(?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(local, userId, isDb ? 'database' : 'page', title, icon, cover, JSON.stringify(props),
            schema ? JSON.stringify(schema) : null, 0, it.archived ? 1 : 0, it.id, JSON.stringify(raw), Date.parse(it.created_time) || t, Date.parse(it.last_edited_time) || t);
        }
        job.counts[isDb ? 'databases' : 'pages']++;
        // commentaires Notion de la page (la capacité « lire les commentaires » doit avoir été accordée à l'intégration)
        db.prepare('DELETE FROM comments WHERE page_id=? AND notion_id IS NOT NULL').run(local);
        for (const cm of comments) {
          db.prepare('INSERT INTO comments(id,page_id,block_id,parent_id,author_id,author_name,body,quote,resolved,notion_id,created_at,updated_at) VALUES(?,?,NULL,NULL,NULL,?,?,\'\',0,?,?,?)')
            .run(uid(), local, cm.created_by?.name || 'Notion', plain(cm.rich_text) || '(commentaire vide)', cm.id, Date.parse(cm.created_time) || t, Date.parse(cm.last_edited_time) || t);
          job.counts.comments = (job.counts.comments || 0) + 1;
        }
      });
    } catch (e) { warn(`« ${title} » ignorée : ${e.message}`); ids.delete(it.id); }
  }
  for (let cursor = 0; ;) {
    while (cursor < items.length) await processItem(items[cursor++]);
    const todo = [...refs.entries()].filter(([id]) => !seen.has(id) && !missing.has(id));
    if (!todo.length) break;
    log(`Suivi de ${todo.length} référence(s) (sous-pages, mentions, liens) hors résultats de recherche…`);
    for (const [id, r] of todo) {
      try { register(await fetchObject(id, r.kind)); }
      catch (e) { missing.set(id, r.title || id); }
    }
  }
  job.missing = [...missing.values()].slice(0, 100);
  job.counts.missing = missing.size;
  if (missing.size) warn(`${missing.size} page(s) référencée(s) mais inaccessible(s) à l'intégration : ${[...missing.values()].slice(0, 8).join(' · ')}${missing.size > 8 ? ' …' : ''}. Dans Notion, partagez-les (ou leur page parente) avec l'intégration (••• → Connexions), puis relancez l'import : seul le complément sera ajouté.`);

  // 4. Hiérarchie, réécriture des liens, insertion des blocs
  log('Reconstruction de la hiérarchie et des liens internes…');
  const remap = (str) => str
    .replace(UUID_RE, (m) => ids.get(m) || m)
    .replace(NOTION_URL_RE, (m, h) => (ids.get(dash(h)) ? `/#/page/${ids.get(dash(h))}` : m));

  tx(() => {
    const setParent = db.prepare('UPDATE pages SET parent_id=?, position=? WHERE id=?');
    let order = 0;
    for (const it of items) {
      const local = ids.get(it.id);
      if (!local) continue;
      const p = it.parent || {};
      let parentNotion = p.type === 'page_id' ? p.page_id : p.type === 'database_id' ? p.database_id
        : p.type === 'block_id' ? blockToPage.get(p.block_id) : null;
      let parent = parentNotion ? ids.get(parentNotion) : null;
      if (parent === local) parent = null;
      setParent.run(parent || null, pagePos.get(it.id) ?? 1000 + order++, local);
    }
    const insBlock = db.prepare(`INSERT INTO blocks(id,page_id,parent_id,type,content,text,position,notion_id,raw,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const upd = db.prepare('UPDATE pages SET props=?, schema=? WHERE id=?');
    for (const it of items) {
      const local = ids.get(it.id);
      if (!local) continue;
      // la configuration d'un bouton (faite dans Deepwell, Notion ne la fournit pas) survit à un réimport
      const keptButtons = new Map(db.prepare("SELECT notion_id, content FROM blocks WHERE page_id=? AND type='button' AND notion_id IS NOT NULL").all(local).map((r) => [r.notion_id, parse(r.content, {})]));
      db.prepare('DELETE FROM blocks WHERE page_id=?').run(local);
      for (const b of blockRows.get(it.id) || []) {
        let content = parse(remap(JSON.stringify(b.content)), {});
        const kept = b.type === 'button' ? keptButtons.get(b.notion_id) : null;
        if (kept && (kept.actions?.length || !kept.imported)) content = kept;
        insBlock.run(b.id, local, b.parent_id, b.type, JSON.stringify(content), textOf(content), b.position, b.notion_id,
          JSON.stringify(b.raw), b.created, now());
      }
      // props (relations, mentions…) et schéma (relations entre bases) pointent vers les nouveaux ids ; `raw` reste intact
      const row = db.prepare('SELECT props, schema FROM pages WHERE id=?').get(local);
      upd.run(remap(row.props), row.schema ? remap(row.schema) : null, local);
    }
  });
  log(`Terminé : ${job.counts.pages} pages, ${job.counts.databases} bases, ${job.counts.blocks} blocs, ${job.counts.files} fichiers.`);
}

// ---------------------------------------------------------------------------------------------
// Commentaires Notion seuls : on les (re)lit pour les pages DÉJÀ importées, sans rien réimporter d'autre.
// L'API Notion ne renvoie que les commentaires non résolus, et uniquement quand on interroge la page ou le bloc visé :
//   - commentaires de page : 1 requête par page ;
//   - commentaires de blocs (discussions en ligne) : 1 requête par bloc de texte → plus long, donc optionnel.
// Idempotent : un commentaire déjà présent (même identifiant Notion) n'est jamais dupliqué ni modifié.
// Les fils (discussion_id) sont reconstruits : le premier commentaire est la racine, les suivants des réponses.
// ---------------------------------------------------------------------------------------------
const COMMENTABLE = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code', 'image', 'file', 'pdf', 'video', 'bookmark', 'embed', 'equation', 'table'];

export function startNotionComments(userId, token, opts = {}) {
  const job = { id: uid(), kind: 'notion-comments', status: 'running', startedAt: now(), log: [], counts: { pages: 0, blocks: 0, comments: 0, replies: 0, skipped: 0, warnings: 0, files: 0, databases: 0, unsupported: 0, missing: 0 }, progress: { done: 0, total: 0 } };
  jobs.set(job.id, job);
  runComments(job, userId, token, !!opts.blocks).then(
    () => { job.status = 'done'; job.log.push('Import des commentaires terminé.'); },
    (e) => { job.status = 'error'; job.error = e.message; job.log.push(`Erreur : ${e.message}`); },
  );
  return job;
}

async function runComments(job, userId, token, withBlocks) {
  const n = new Notion(token), log = (m) => job.log.push(m);
  const pages = db.prepare("SELECT id,notion_id,title FROM pages WHERE owner_id=? AND notion_id IS NOT NULL AND archived=0 ORDER BY created_at").all(userId);
  if (!pages.length) throw new Error("Aucune page importée de Notion : lancez d'abord l'import complet.");
  const targets = []; // { page, blockId|null, notionId }
  for (const p of pages) {
    targets.push({ page: p.id, title: p.title, block: null, notion: p.notion_id });
    if (withBlocks) for (const b of db.prepare(`SELECT id,notion_id FROM blocks WHERE page_id=? AND notion_id IS NOT NULL AND type IN (${COMMENTABLE.map(() => '?').join(',')})`).all(p.id, ...COMMENTABLE)) targets.push({ page: p.id, title: p.title, block: b.id, notion: b.notion_id });
  }
  job.progress.total = targets.length;
  log(`${pages.length} page(s) à lire${withBlocks ? `, ${targets.length - pages.length} bloc(s) de texte compris` : ''}.`);
  const findByNotion = db.prepare('SELECT id FROM comments WHERE page_id=? AND notion_id=?');
  const ins = db.prepare('INSERT INTO comments(id,page_id,block_id,parent_id,author_id,author_name,body,quote,resolved,notion_id,created_at,updated_at) VALUES(?,?,?,?,NULL,?,?,\'\',0,?,?,?)');
  let denied = 0;
  for (const t of targets) {
    job.progress.done++;
    let list = [];
    try { for await (const c of n.paginate(`/comments?block_id=${t.notion}`)) list.push(c); }
    catch (e) {
      if (e.status === 403 && /comment/i.test(e.message)) { throw new Error("L'intégration Notion n'a pas la capacité « Lire les commentaires » : activez-la sur notion.so/my-integrations puis relancez."); }
      if (e.status === 404 || e.status === 403) { if (!t.block && ++denied <= 5) { job.counts.warnings++; log(`« ${t.title || 'Sans titre'} » : page inaccessible à l'intégration.`); } continue; }
      job.counts.warnings++; log(`« ${t.title || 'Sans titre'} » : ${e.message}`); continue;
    }
    if (!list.length) continue;
    t.block ? job.counts.blocks++ : job.counts.pages++;
    const roots = new Map(); // discussion_id -> id local du premier commentaire du fil
    tx(() => {
      for (const c of list) {
        const had = findByNotion.get(t.page, c.id);
        const disc = c.discussion_id || c.id;
        if (had) { job.counts.skipped++; if (!roots.has(disc)) roots.set(disc, had.id); continue; }
        const id = uid(), parent = roots.get(disc) || null;
        if (!parent) roots.set(disc, id);
        const t0 = Date.parse(c.created_time) || now();
        ins.run(id, t.page, t.block, parent, c.created_by?.name || 'Notion', plain(c.rich_text) || '(commentaire vide)', c.id, t0, Date.parse(c.last_edited_time) || t0);
        parent ? job.counts.replies++ : job.counts.comments++;
      }
    });
  }
  log(`${job.counts.comments} commentaire(s) et ${job.counts.replies} réponse(s) ajouté(s), ${job.counts.skipped} déjà présent(s).`);
}
