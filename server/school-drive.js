/**
 * Mode scolaire × Google Drive (étape 2).
 * - Un « support » (ligne d'une base scolaire) = un dossier Drive : DeepWell Cours / <Année = titre de la base> / <Matière> / <Support>,
 *   avec deux sous-dossiers, créés au premier envoi : « Document principal » (fichiers de la page du chapitre) et « Addenda » (fichiers des sous-pages).
 * - Les fichiers vont directement du navigateur vers Drive (jeton temporaire) ; le serveur ne garde que les informations
 *   (identifiant Drive, nom, type, taille, date).
 * - Renommage / changement de matière / suppression définitive d'un support sont répercutés sur Drive (sens unique ; Drive ne reçoit
 *   que la corbeille de Drive, récupérable). Chaque opération qui échoue est rejouée par la file de tâches.
 * - Rattachement des cours existants : aperçu sans rien modifier, puis exécution par la file de tâches.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { db, uid, now, parse, norm, UPLOAD_DIR } from './db.js';
import { requireAuth } from './auth.js';
import { accessFor, can } from './access.js';
import { accessToken, hasDrive } from './drive.js';
import { enqueueJob, registerJob, runDueJobs } from './jobs.js';

db.exec(`
CREATE TABLE IF NOT EXISTS school_dirs(user_id TEXT NOT NULL, key TEXT NOT NULL, drive_id TEXT NOT NULL, PRIMARY KEY(user_id, key));
CREATE TABLE IF NOT EXISTS school_folders(
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL, drive_id TEXT NOT NULL,
  addenda_id TEXT, name TEXT NOT NULL DEFAULT '', parent_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS school_files(
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, drive_id TEXT NOT NULL,
  name TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'upload',            -- upload : envoyé via Deepwell · link : fichier Drive déjà existant, simplement rattaché
  src TEXT,                                       -- /files/<uuid> si migré depuis le serveur (évite les doublons)
  created_at INTEGER NOT NULL, UNIQUE(page_id, drive_id));
`);

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
export const ROOT_NAME = 'DeepWell Cours';
const MAX_SERVER_UPLOAD = 25 * 1024 * 1024; // migration depuis le serveur : au-delà, à envoyer à la main

const err = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
export const cleanName = (s, fallback) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || fallback;

async function dcall(token, method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(`Google Drive : ${j.error?.message || r.status}`, 502, { drive: r.status });
  return j;
}
const qs = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const createFolder = async (token, name, parent) =>
  (await dcall(token, 'POST', `${API}/files?fields=id`, { name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) })).id;

/** Dossier « partagé » (racine, année, matière, Addenda) : retrouvé par son nom ou créé, puis mémorisé. */
async function sharedFolder(token, userId, key, name, parent) {
  const cached = db.prepare('SELECT drive_id FROM school_dirs WHERE user_id=? AND key=?').get(userId, key);
  if (cached) return cached.drive_id;
  const found = await dcall(token, 'GET', `${API}/files?pageSize=1&fields=files(id)&q=${encodeURIComponent(
    `name='${qs(name)}' and mimeType='${FOLDER}' and trashed=false and '${parent || 'root'}' in parents`)}`);
  const id = found.files?.[0]?.id || await createFolder(token, name, parent);
  db.prepare('INSERT INTO school_dirs(user_id,key,drive_id) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET drive_id=excluded.drive_id').run(userId, key, id);
  return id;
}

// ---------- où se trouve une page dans le mode scolaire ----------
/** Support (ligne d'une base scolaire) auquel appartient la page : la page elle-même ou, pour un addendum, l'un de ses parents. */
export function schoolContext(pageId) {
  let id = pageId;
  for (let i = 0; i < 6 && id; i++) {
    const p = db.prepare('SELECT id,parent_id,kind,title,props FROM pages WHERE id=?').get(id);
    if (!p || p.kind === 'template') return null; // un modèle n'est pas un chapitre : pas de dossier Drive
    const par = p.parent_id && db.prepare('SELECT id,kind,title,props,schema FROM pages WHERE id=?').get(p.parent_id);
    if (par?.kind === 'database') {
      const cfg = parse(par.props, {})?.dw_school;
      if (!cfg?.enabled) return null;
      return { db: par, cfg, support: p, isAddendum: p.id !== pageId, drive: cfg.options?.drive === true };
    }
    id = p.parent_id;
  }
  return null;
}

/** Matière d'un support : valeur de la colonne « Matière » (Sélection ou Statut) ; « Sans matière » si vide. */
export function subjectOf(dbPage, row) {
  const schema = parse(dbPage.schema, {}) || {};
  const key = Object.keys(schema).find((k) => /^mati/.test(norm(k).trim()) && ['status', 'select'].includes(schema[k].type));
  const v = key ? parse(row.props, {})?.[key]?.[schema[key].type]?.name : '';
  return cleanName(v, 'Sans matière');
}

async function subjectFolder(token, userId, ctx) {
  const root = await sharedFolder(token, userId, 'root', ROOT_NAME, null);
  const year = await sharedFolder(token, userId, `year:${ctx.db.id}`, cleanName(ctx.db.title, 'Sans titre'), root);
  const subject = subjectOf(ctx.db, ctx.support);
  return sharedFolder(token, userId, `subject:${ctx.db.id}:${subject}`, subject, year);
}

/** Dossier du support (créé si besoin). Chaque support a son propre dossier, même si deux supports portent le même titre. */
export async function ensureSupportFolder(userId, ctx, token) {
  token = token || await accessToken(userId);
  let row = db.prepare('SELECT * FROM school_folders WHERE page_id=?').get(ctx.support.id);
  if (row) {
    if (row.user_id !== userId) throw err('Ce chapitre est lié au Google Drive d’un autre compte.', 403);
    try { const f = await dcall(token, 'GET', `${API}/files/${row.drive_id}?fields=id,trashed`); if (!f.trashed) return row; }
    catch (e) { if (e.drive !== 404) throw e; }
    db.prepare('DELETE FROM school_folders WHERE page_id=?').run(ctx.support.id); // dossier supprimé sur Drive : on le recrée
    row = null;
  }
  const parent = await subjectFolder(token, userId, ctx);
  const name = cleanName(ctx.support.title, 'Sans titre');
  const id = await createFolder(token, name, parent);
  db.prepare('INSERT INTO school_folders(page_id,user_id,drive_id,name,parent_id,created_at) VALUES(?,?,?,?,?,?)').run(ctx.support.id, userId, id, name, parent, now());
  return db.prepare('SELECT * FROM school_folders WHERE page_id=?').get(ctx.support.id);
}

if (!db.prepare('PRAGMA table_info(school_folders)').all().some((c) => c.name === 'main_id')) db.exec('ALTER TABLE school_folders ADD COLUMN main_id TEXT');
/** Sous-dossier « Document principal » : les fichiers de la page du chapitre elle-même (créé au premier envoi). */
async function ensureMain(token, row) {
  if (row.main_id) return row.main_id;
  const id = await createFolder(token, 'Document principal', row.drive_id);
  db.prepare('UPDATE school_folders SET main_id=? WHERE page_id=?').run(id, row.page_id);
  row.main_id = id;
  return id;
}
async function ensureAddenda(token, row) {
  if (row.addenda_id) return row.addenda_id;
  const id = await createFolder(token, 'Addenda', row.drive_id);
  db.prepare('UPDATE school_folders SET addenda_id=? WHERE page_id=?').run(id, row.page_id);
  return id;
}
const targetFolder = async (token, ctx, row) => (ctx.isAddendum ? ensureAddenda(token, row) : ensureMain(token, row));

// ---------- liens Drive / Canva / fichiers du serveur présents dans les pages ----------
const DRIVE_RE = /https?:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>\\)\]]+/g;
const CANVA_RE = /https?:\/\/(?:www\.)?canva\.com\/[^\s"'<>\\)\]]+/g;
const SERVER_RE = /\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
export function parseDriveUrl(url) {
  const m = /\/folders\/([\w-]{10,})/.exec(url);
  if (m) return { id: m[1], folder: true };
  const f = /\/d\/([\w-]{10,})/.exec(url) || /[?&]id=([\w-]{10,})/.exec(url);
  return f ? { id: f[1], folder: false } : null;
}
const descendants = (pageId) => db.prepare(`WITH RECURSIVE d(id,depth) AS (SELECT ?1,0 UNION ALL SELECT p.id,d.depth+1 FROM pages p JOIN d ON p.parent_id=d.id WHERE p.archived=0 AND p.kind != 'template' AND d.depth<8)
  SELECT id FROM d`).all(pageId).map((r) => r.id);

/** Ce qu'une page contient déjà : liens Drive (fichiers / dossiers), liens Canva, fichiers stockés sur le serveur. */
export function scanPage(pageId) {
  const out = { drive: new Map(), canva: new Set(), server: new Set() };
  for (const b of db.prepare('SELECT content FROM blocks WHERE page_id=?').all(pageId)) {
    for (const u of b.content.match(DRIVE_RE) || []) { const d = parseDriveUrl(u.replace(/&amp;/g, '&')); if (d && !out.drive.has(d.id)) out.drive.set(d.id, { ...d, url: u }); }
    for (const u of b.content.match(CANVA_RE) || []) out.canva.add(u);
    for (const m of b.content.matchAll(SERVER_RE)) if (db.prepare('SELECT 1 FROM files WHERE id=?').get(m[1])) out.server.add(m[1]);
  }
  return out;
}

// ---------- envoi d'un fichier du serveur vers Drive (multipart, petits fichiers) ----------
async function uploadBuffer(token, folderId, name, mime, buf) {
  const boundary = `dw${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`),
    buf, Buffer.from(`\r\n--${boundary}--`)]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(`Google Drive : ${j.error?.message || r.status}`, 502, { drive: r.status });
  return j;
}

const addFile = (pageId, f, kind, src = null) => {
  db.prepare('INSERT INTO school_files(id,page_id,drive_id,name,mime,size,kind,src,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(page_id,drive_id) DO NOTHING')
    .run(uid(), pageId, f.id, String(f.name || 'Document').slice(0, 255), f.mimeType || '', Number(f.size) || 0, kind, src, now());
  return db.prepare('SELECT * FROM school_files WHERE page_id=? AND drive_id=?').get(pageId, f.id);
};
const fileRow = (f) => ({ id: f.id, page_id: f.page_id, drive_id: f.drive_id, name: f.name, mime: f.mime, size: f.size, kind: f.kind, created_at: f.created_at, folder: f.mime === FOLDER });

// ---------- opérations répercutées vers Drive : tentées tout de suite, sinon rejouées par la file ----------
async function attempt(type, payload) {
  try { await RUN[type](payload); return true; }
  catch (e) { enqueueJob(type, payload, { delayMs: 30_000, dedupeKey: `${type}:${payload.drive_id || payload.page_id}` }); return false; }
}
const RUN = {
  async 'school.ensure_folder'({ page_id, user_id }) {
    const ctx = schoolContext(page_id);
    if (ctx?.drive) await ensureSupportFolder(user_id, ctx);
  },
  /** Aligne le dossier Drive sur le titre et la matière actuels du support. */
  async 'school.sync_folder'({ page_id, user_id }) {
    const row = db.prepare('SELECT * FROM school_folders WHERE page_id=?').get(page_id), ctx = row && schoolContext(page_id);
    if (!row || !ctx?.drive || ctx.support.id !== page_id) return;
    const token = await accessToken(user_id), name = cleanName(ctx.support.title, 'Sans titre'), parent = await subjectFolder(token, user_id, ctx);
    if (row.name === name && row.parent_id === parent) return;
    const q = row.parent_id !== parent ? `&addParents=${parent}&removeParents=${row.parent_id}` : '';
    await dcall(token, 'PATCH', `${API}/files/${row.drive_id}?fields=id${q}`, { name });
    db.prepare('UPDATE school_folders SET name=?, parent_id=? WHERE page_id=?').run(name, parent, page_id);
  },
  async 'school.trash'({ user_id, drive_id }) {
    try { await dcall(await accessToken(user_id), 'PATCH', `${API}/files/${drive_id}?fields=id`, { trashed: true }); }
    catch (e) { if (e.drive !== 404) throw e; } // déjà supprimé sur Drive : rien à faire
  },
  async 'school.rename_file'({ user_id, drive_id, name }) {
    await dcall(await accessToken(user_id), 'PATCH', `${API}/files/${drive_id}?fields=id`, { name });
  },
  /** Rattache un support existant : dossier, fichiers du serveur envoyés sur Drive, liens Drive déjà présents enregistrés. */
  async 'school.import_support'({ page_id, user_id }) {
    const ctx = schoolContext(page_id);
    if (!ctx?.drive || ctx.support.id !== page_id) return;
    const token = await accessToken(user_id), folder = await ensureSupportFolder(user_id, ctx, token);
    for (const pid of descendants(page_id)) {
      const pctx = schoolContext(pid), scan = scanPage(pid);
      const target = await targetFolder(token, pctx, folder);
      for (const fid of scan.server) {
        const f = db.prepare('SELECT * FROM files WHERE id=?').get(fid), p = path.join(UPLOAD_DIR, fid);
        if (!f || !fs.existsSync(p) || db.prepare('SELECT 1 FROM school_files WHERE page_id=? AND src=?').get(pid, `/files/${fid}`)) continue;
        if (f.size > MAX_SERVER_UPLOAD) continue; // trop gros pour cette voie : signalé dans l'aperçu, à envoyer à la main
        addFile(pid, await uploadBuffer(token, target, f.name, f.mime, fs.readFileSync(p)), 'upload', `/files/${fid}`);
      }
      for (const d of scan.drive.values()) {
        let meta = { id: d.id, name: d.folder ? 'Dossier Drive' : 'Document Drive', mimeType: d.folder ? FOLDER : '' };
        try { meta = { ...meta, ...(await dcall(token, 'GET', `${API}/files/${d.id}?fields=id,name,mimeType,size`)) }; } catch { /* inaccessible : on garde le lien tel quel */ }
        addFile(pid, meta, 'link');
      }
    }
  },
};
for (const [type, fn] of Object.entries(RUN)) registerJob(type, fn);

// ---------- appelés par pages.js ----------
/** Après une modification de page : titre ou matière changés → dossier Drive à renommer / déplacer (en tâche de fond). */
export function schoolPageChanged(pageId) {
  const row = db.prepare('SELECT user_id FROM school_folders WHERE page_id=?').get(pageId);
  if (row) enqueueJob('school.sync_folder', { page_id: pageId, user_id: row.user_id }, { dedupeKey: `sync:${pageId}` });
}
/** Avant une suppression définitive : les dossiers Drive concernés partent à la corbeille de Drive (récupérable). */
export function schoolPagesDeleting(pageId) {
  for (const id of descendants(pageId)) {
    const row = db.prepare('SELECT user_id,drive_id FROM school_folders WHERE page_id=?').get(id);
    if (row) enqueueJob('school.trash', { user_id: row.user_id, drive_id: row.drive_id });
  }
}

// ---------- API ----------
export const schoolRouter = express.Router();
schoolRouter.use(requireAuth);

function need(req, pageId, level) {
  const role = accessFor(req.user, pageId);
  if (!can(role, level)) throw err('Page introuvable', 404);
  const ctx = schoolContext(pageId);
  if (!ctx?.drive) throw err('Le stockage Drive n’est pas activé pour cette base (Réglages de la base → Mode scolaire).', 409);
  return ctx;
}
const needDrive = (req) => { if (!hasDrive(req.user.id)) throw err('Connectez Google Drive dans Réglages → Google Drive.', 400); };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

schoolRouter.get('/pages/:id', wrap(async (req, res) => {
  const role = accessFor(req.user, req.params.id);
  if (!role) return res.status(404).json({ error: 'Page introuvable' });
  const ctx = schoolContext(req.params.id);
  if (!ctx?.drive) return res.json({ applicable: false });
  const folder = db.prepare('SELECT drive_id,addenda_id,user_id FROM school_folders WHERE page_id=?').get(ctx.support.id);
  const files = db.prepare('SELECT * FROM school_files WHERE page_id=? ORDER BY created_at').all(req.params.id).map(fileRow);
  const out = { applicable: true, is_addendum: ctx.isAddendum, support_id: ctx.support.id, drive_connected: hasDrive(req.user.id), folder: !!folder, files, editable: can(role, 'edit') };
  if (!ctx.isAddendum) { // « Tout télécharger » : fichiers du support et de ses addendums
    out.all_files = db.prepare(`SELECT f.*, p.title AS page_title FROM school_files f JOIN pages p ON p.id=f.page_id WHERE f.page_id IN (${descendants(ctx.support.id).map(() => '?').join(',')}) ORDER BY f.created_at`)
      .all(...descendants(ctx.support.id)).filter((f) => f.mime !== FOLDER).map((f) => ({ ...fileRow(f), where: f.page_id === ctx.support.id ? '' : 'Addenda' }));
  }
  res.json(out);
}));

/** Jeton temporaire (1 h) pour que le navigateur parle directement à Drive : téléchargements et envois. */
schoolRouter.post('/token', wrap(async (req, res) => { needDrive(req); res.json({ token: await accessToken(req.user.id), expires_in: 3000 }); }));

schoolRouter.post('/pages/:id/folder', wrap(async (req, res) => {
  const ctx = need(req, req.params.id, 'edit'); needDrive(req);
  try { const row = await ensureSupportFolder(req.user.id, ctx); res.json({ folder: true, drive_id: row.drive_id }); }
  catch (e) {
    if (e.status === 403) throw e;
    enqueueJob('school.ensure_folder', { page_id: ctx.support.id, user_id: req.user.id }, { delayMs: 30_000, dedupeKey: `folder:${ctx.support.id}` });
    res.status(202).json({ folder: false, pending: true, error: e.message });
  }
}));

schoolRouter.post('/pages/:id/upload-session', wrap(async (req, res) => {
  const ctx = need(req, req.params.id, 'edit'); needDrive(req);
  const token = await accessToken(req.user.id), row = await ensureSupportFolder(req.user.id, ctx, token);
  res.json({ token, expires_in: 3000, folder_id: await targetFolder(token, ctx, row) });
}));

/** Le navigateur annonce un fichier qu'il vient d'envoyer : le serveur vérifie auprès de Drive avant d'enregistrer. */
schoolRouter.post('/pages/:id/files', wrap(async (req, res) => {
  const ctx = need(req, req.params.id, 'edit'); needDrive(req);
  const driveId = String(req.body?.drive_id || '');
  if (!/^[\w-]{10,}$/.test(driveId)) throw err('Identifiant Drive invalide');
  const token = await accessToken(req.user.id), row = await ensureSupportFolder(req.user.id, ctx, token), target = await targetFolder(token, ctx, row);
  const f = await dcall(token, 'GET', `${API}/files/${driveId}?fields=id,name,mimeType,size,parents,trashed`);
  if (f.trashed || !f.parents?.includes(target)) throw err('Ce fichier n’est pas dans le dossier du chapitre.', 409);
  res.json(fileRow(addFile(req.params.id, f, 'upload')));
}));

schoolRouter.patch('/files/:fid', wrap(async (req, res) => {
  const f = db.prepare('SELECT * FROM school_files WHERE id=?').get(req.params.fid);
  if (!f) throw err('Fichier introuvable', 404);
  need(req, f.page_id, 'edit');
  const name = cleanName(req.body?.name, '');
  if (!name) throw err('Nom invalide');
  db.prepare('UPDATE school_files SET name=? WHERE id=?').run(name, f.id);
  const synced = f.kind === 'upload' ? await attempt('school.rename_file', { user_id: req.user.id, drive_id: f.drive_id, name }) : true; // un fichier Drive rattaché garde son nom sur Drive
  res.json({ ok: true, name, synced });
}));

schoolRouter.delete('/files/:fid', wrap(async (req, res) => {
  const f = db.prepare('SELECT * FROM school_files WHERE id=?').get(req.params.fid);
  if (!f) throw err('Fichier introuvable', 404);
  need(req, f.page_id, 'edit');
  db.prepare('DELETE FROM school_files WHERE id=?').run(f.id);
  const synced = f.kind === 'upload' ? await attempt('school.trash', { user_id: req.user.id, drive_id: f.drive_id }) : true; // un fichier Drive rattaché n'est jamais supprimé de Drive
  res.json({ ok: true, synced });
}));

// ----- rattachement des cours existants -----
function importPlan(req, databaseId) {
  const role = accessFor(req.user, databaseId), dbp = db.prepare('SELECT id,kind,title,props,schema FROM pages WHERE id=?').get(databaseId);
  if (!dbp || dbp.kind !== 'database' || !can(role, 'edit')) throw err('Base introuvable', 404);
  const cfg = parse(dbp.props, {})?.dw_school;
  if (!cfg?.enabled || cfg.options?.drive !== true) throw err('Activez d’abord le Mode scolaire et le stockage Drive dans les réglages de la base.', 409);
  const rows = db.prepare("SELECT id,title,props FROM pages WHERE parent_id=? AND archived=0 AND kind != 'template' ORDER BY position").all(databaseId);
  const year = cleanName(dbp.title, 'Sans titre');
  const supports = rows.map((r) => {
    let drive = 0, folders = 0, canva = 0, server = 0, tooBig = 0, addenda = 0;
    for (const pid of descendants(r.id)) {
      if (pid !== r.id) addenda++;
      const s = scanPage(pid); canva += s.canva.size; server += s.server.size;
      for (const d of s.drive.values()) d.folder ? folders++ : drive++;
      for (const fid of s.server) if ((db.prepare('SELECT size FROM files WHERE id=?').get(fid)?.size || 0) > MAX_SERVER_UPLOAD) tooBig++;
    }
    return { id: r.id, title: cleanName(r.title, 'Sans titre'), path: `${ROOT_NAME} / ${year} / ${subjectOf(dbp, r)} / ${cleanName(r.title, 'Sans titre')}`,
      has_folder: !!db.prepare('SELECT 1 FROM school_folders WHERE page_id=?').get(r.id), addenda, drive_files: drive, drive_folders: folders, canva_links: canva, server_files: server, too_big: tooBig };
  });
  const sum = (k) => supports.reduce((n, s) => n + s[k], 0);
  return { database_id: databaseId, year, supports, totals: { supports: supports.length, new_folders: supports.filter((s) => !s.has_folder).length,
    drive_files: sum('drive_files'), drive_folders: sum('drive_folders'), canva_links: sum('canva_links'), server_files: sum('server_files'), too_big: sum('too_big') } };
}
/** Aperçu : ce qui serait fait. Ne modifie rien, n'appelle pas Google. */
schoolRouter.post('/import/preview', wrap(async (req, res) => res.json(importPlan(req, String(req.body?.database_id || '')))));
schoolRouter.post('/import/run', wrap(async (req, res) => {
  const plan = importPlan(req, String(req.body?.database_id || '')); needDrive(req);
  const batch = uid();
  for (const s of plan.supports) enqueueJob('school.import_support', { page_id: s.id, user_id: req.user.id, batch }, { maxAttempts: 6 });
  res.json({ batch, total: plan.supports.length });
  setTimeout(() => runDueJobs().catch(() => {}), 50).unref(); // démarre sans attendre le prochain passage du minuteur
}));
schoolRouter.get('/import/status', wrap(async (req, res) => {
  const batch = String(req.query.batch || '');
  const rows = db.prepare("SELECT status,last_error,payload FROM jobs WHERE type='school.import_support' AND json_extract(payload,'$.batch')=? AND json_extract(payload,'$.user_id')=?").all(batch, req.user.id);
  const count = (s) => rows.filter((r) => r.status === s).length;
  res.json({ total: rows.length, done: count('done'), waiting: count('pending') + count('running'), failed: count('failed'),
    errors: rows.filter((r) => r.status === 'failed').slice(0, 5).map((r) => r.last_error) });
}));
