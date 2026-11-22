import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'deepwell.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pages(
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'page',            -- page | database
  title TEXT NOT NULL DEFAULT '', icon TEXT, cover TEXT,
  props TEXT NOT NULL DEFAULT '{}',             -- valeurs de propriétés (format Notion) si ligne de base
  schema TEXT,                                  -- schéma de propriétés (format Notion) si base
  position REAL NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  notion_id TEXT, raw TEXT,                     -- objet Notion d'origine (aucune perte)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pages_parent ON pages(parent_id);
CREATE INDEX IF NOT EXISTS pages_owner ON pages(owner_id);
CREATE INDEX IF NOT EXISTS pages_notion ON pages(owner_id, notion_id);
CREATE TABLE IF NOT EXISTS blocks(
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  parent_id TEXT, type TEXT NOT NULL, content TEXT NOT NULL DEFAULT '{}',
  text TEXT NOT NULL DEFAULT '', position REAL NOT NULL DEFAULT 0,
  notion_id TEXT, raw TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS blocks_page ON blocks(page_id);
CREATE TABLE IF NOT EXISTS shares(
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL,
  public_token TEXT UNIQUE, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS shares_page ON shares(page_id);
CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id);
CREATE TABLE IF NOT EXISTS files(
  id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS comments(
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  block_id TEXT,                                   -- NULL = commentaire de page ; sinon bloc visé
  parent_id TEXT,                                  -- réponse dans un fil
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL, author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '', resolved INTEGER NOT NULL DEFAULT 0,
  notion_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS comments_page ON comments(page_id);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drive_tokens(
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL, email TEXT);
`);

// historique des versions d'une page (instantané compressé des blocs) et collection d'icônes personnalisées
db.exec(`
CREATE TABLE IF NOT EXISTS page_versions(
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, user_id TEXT, user_name TEXT,
  title TEXT NOT NULL DEFAULT '', icon TEXT, data BLOB NOT NULL, n INTEGER NOT NULL DEFAULT 0, preview TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS page_versions_page ON page_versions(page_id, created_at);
CREATE TABLE IF NOT EXISTS custom_icons(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS custom_icons_owner ON custom_icons(owner_id);
`);
// les boutons Notion importés avant la prise en charge des boutons étaient stockés comme blocs « unsupported »
db.exec(`UPDATE blocks SET type='button', content='{"label":"Bouton Notion","actions":[],"imported":true}'
  WHERE type='unsupported' AND content LIKE '%"block_type":"button"%'`);

// migration : vues d'une base de données (tableau, kanban, calendrier…)
if (!db.prepare('PRAGMA table_info(comments)').all().some((c) => c.name === 'anchor')) db.exec('ALTER TABLE comments ADD COLUMN anchor INTEGER'); // position du texte commenté dans son bloc
if (!db.prepare('PRAGMA table_info(pages)').all().some((c) => c.name === 'views')) db.exec('ALTER TABLE pages ADD COLUMN views TEXT');

/** Minuscules + sans accents : « Éléphant » == « elephant » (recherche française). */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
db.function('norm', { deterministic: true }, norm);

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

export const getSetting = (k, d = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  return r ? r.value : d;
};
export const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

export const parse = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };

/** Texte brut d'un contenu de bloc (pour la recherche). */
export function textOf(content) {
  if (!content || typeof content !== 'object') return '';
  const rt = (a) => Array.isArray(a) ? a.map((r) => r.plain_text ?? r.text?.content ?? '').join('') : '';
  const parts = [rt(content.rich_text), rt(content.caption), content.title, content.expression, content.name, content.url];
  if (Array.isArray(content.cells)) parts.push(content.cells.map(rt).join(' '));
  return parts.filter((x) => typeof x === 'string').join(' ').slice(0, 20000);
}

/** Clé secrète locale (hors base) pour chiffrer les jetons Google. */
export function secretKey() {
  const p = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'hex');
}

db.exec(`CREATE TABLE IF NOT EXISTS favorites(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  position REAL NOT NULL DEFAULT 0, PRIMARY KEY(user_id, page_id));`);
// provenance : 'import' (transfert Notion, ZIP…) ou 'upload' (envoyée à la main)
if (!db.prepare('PRAGMA table_info(custom_icons)').all().some((c) => c.name === 'source')) db.exec("ALTER TABLE custom_icons ADD COLUMN source TEXT NOT NULL DEFAULT 'upload'");
/** Toute image utilisée comme icône (importée de Notion, téléversée…) est gardée dans la collection d'icônes de son propriétaire. */
export function keepIcon(ownerId, url, name = '', source = 'upload') {
  if (!ownerId || !/^\/files\/[0-9a-f-]{36}$/.test(url || '')) return;
  if (db.prepare('SELECT 1 FROM custom_icons WHERE owner_id=? AND url=?').get(ownerId, url)) return;
  db.prepare('INSERT INTO custom_icons(id,owner_id,url,name,created_at,source) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), ownerId, url, String(name).slice(0, 200), Date.now(), source);
}
// rattrapage : icônes déjà utilisées par des pages (imports précédents)
for (const r of db.prepare("SELECT DISTINCT owner_id, icon, (notion_id IS NOT NULL) AS imp FROM pages WHERE icon LIKE '/files/%'").all()) keepIcon(r.owner_id, r.icon, (db.prepare('SELECT name FROM files WHERE id=?').get(r.icon.slice(7))?.name) || '', r.imp ? 'import' : 'upload');
db.exec("UPDATE custom_icons SET source='import' WHERE source!='import' AND url IN (SELECT icon FROM pages WHERE notion_id IS NOT NULL AND icon IS NOT NULL)");
for (const r of db.prepare("SELECT DISTINCT p.owner_id, b.content FROM blocks b JOIN pages p ON p.id=b.page_id WHERE b.type='callout' AND b.content LIKE '%\"type\":\"dw\"%'").all()) {
  try { const v = JSON.parse(r.content).icon?.value; if (v) keepIcon(r.owner_id, v, '', 'import'); } catch { /* contenu illisible : ignoré */ }
}
