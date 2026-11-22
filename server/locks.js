/**
 * Accès restreint : un code (PIN ou mot de passe) à saisir pour ouvrir une page et ses sous-pages.
 * - Le verrou s'applique à la page et à toutes ses sous-pages (héritage), y compris pour son propriétaire.
 * - Le déverrouillage est mémorisé côté serveur pour la session en cours ; il expire après `idle_min` minutes d'inactivité
 *   (0 = jamais, jusqu'à la déconnexion/au redémarrage du serveur).
 * - Les liens publics ne peuvent pas ouvrir une page verrouillée.
 * Limites : le titre/l'icône d'une page verrouillée restent visibles dans l'arborescence ; l'export JSON et les sauvegardes
 * contiennent le contenu (protégez-les comme le reste des données).
 */
import crypto from 'node:crypto';
import express from 'express';
import { db, now } from './db.js';
import { hashPassword, verifyPassword, requireAuth } from './auth.js';
import { accessFor, can } from './access.js';
import { gcalTouch } from './gcal.js';

db.exec(`CREATE TABLE IF NOT EXISTS page_locks(
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE, hash TEXT NOT NULL, idle_min INTEGER NOT NULL DEFAULT 1440, created_at INTEGER NOT NULL)`);

// 22/11/2026 : durée par défaut portée à 24 h ; les verrous restés sur l'ancien défaut (15 min) passent à 24 h, une seule fois
db.exec('CREATE TABLE IF NOT EXISTS lock_migr(k TEXT PRIMARY KEY)');
if (!db.prepare("SELECT 1 FROM lock_migr WHERE k='idle24h'").get()) { db.prepare('UPDATE page_locks SET idle_min=1440 WHERE idle_min=15').run(); db.prepare("INSERT INTO lock_migr(k) VALUES('idle24h')").run(); }

const sessKey = (req) => {
  const m = /(?:^|;\s*)dw_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? crypto.createHash('sha256').update(decodeURIComponent(m[1])).digest('hex').slice(0, 32) : null;
};
const unlocked = new Map(); // `${session}|${page_verrouillée}` -> dernière activité
const codes = new Map(); // session -> Map(code saisi -> heure de saisie) : un code saisi reste valable CODE_TTL_MS pour toutes les pages qui ont le même code
const CODE_TTL_MS = 24 * 3600_000;
const tries = new Map();
const liveCodes = (sess) => {
  const m = codes.get(sess); if (!m) return [];
  for (const [c, at] of m) if (now() - at > CODE_TTL_MS) m.delete(c);
  return [...m.keys()];
};
const rememberCode = (sess, pin) => { if (!codes.has(sess)) codes.set(sess, new Map()); codes.get(sess).set(pin, now()); };

/** Verrou effectif d'une page : le plus proche, en remontant vers la racine (la page elle-même incluse). */
export function lockFor(pageId) {
  return db.prepare(`WITH RECURSIVE up(id,parent_id,d) AS (SELECT id,parent_id,0 FROM pages WHERE id=?
      UNION ALL SELECT p.id,p.parent_id,d+1 FROM pages p JOIN up ON p.id=up.parent_id WHERE d<200)
    SELECT l.page_id, l.hash, l.idle_min FROM page_locks l JOIN up ON up.id=l.page_id ORDER BY up.d LIMIT 1`).get(pageId) || null;
}
export const isOpen = (req, lock) => {
  const sess = sessKey(req), k = `${sess}|${lock.page_id}`, last = unlocked.get(k);
  if (!req.user) return false;
  if (last) {
    if (!(lock.idle_min > 0 && now() - last > lock.idle_min * 60_000)) { unlocked.set(k, now()); return true; }
    unlocked.delete(k);
  }
  // même code que celui saisi récemment (≤ 24 h) pour une autre page : cette page s'ouvre aussi, quels que soient ses autres réglages
  for (const c of liveCodes(sess)) if (verifyPassword(c, lock.hash)) { unlocked.set(k, now()); return true; }
  return false;
};
/** Pages de `ids` verrouillées ET non ouvertes pour cette requête. */
const hasLocks = db.prepare('SELECT 1 FROM page_locks LIMIT 1');
export const closedIds = (req, ids) => !hasLocks.get() ? new Set() : new Set(ids.filter((i) => { const l = lockFor(i); return l && !isOpen(req, l); }));

/** Middleware `router.param('id')` : refuse (423) tout accès au contenu d'une page verrouillée tant qu'elle n'est pas ouverte. */
export function lockGuard(req, res, next, id) {
  if (['public', 'tree', 'search', 'icons'].includes(id)) return next();
  const rest = req.path.split('/').filter(Boolean).slice(1).join('/'); // ce qui suit /:id
  if (rest.startsWith('lock')) return next(); // statut / déverrouillage / gestion : leur propre contrôle
  const lock = lockFor(id);
  if (!lock || isOpen(req, lock)) return next();
  if ((req.method === 'PATCH' || req.method === 'DELETE') && !rest) { // renommer, déplacer, icône, corbeille : pas de lecture du contenu…
    const row = req.method === 'PATCH' && db.prepare("SELECT 1 FROM pages WHERE id=(SELECT parent_id FROM pages WHERE id=?) AND kind='database'").get(id);
    const blind = req.method === 'PATCH' && (req.body?.props !== undefined || (row && req.body?.title !== undefined)); // …mais pas d'écriture à l'aveugle des propriétés/du titre masqués
    if (!blind) return next();
  }
  const p = db.prepare('SELECT id,title,icon,parent_id FROM pages WHERE id=?').get(id);
  if (p && db.prepare("SELECT 1 FROM pages WHERE id=? AND kind='database'").get(p.parent_id)) { p.title = ''; p.icon = null; } // ligne d'une base : titre masqué aussi
  delete p?.parent_id;
  res.status(423).json({ error: 'Page verrouillée', locked: true, page: p, lock_page_id: lock.page_id });
}

export const lockedIds = (ids) => !hasLocks.get() ? new Set() : new Set(ids.filter((i) => lockFor(i)));

export const lockRouter = express.Router({ mergeParams: true });
const pinOk = (p) => typeof p === 'string' && p.length >= 4 && p.length <= 64;

lockRouter.get('/:id/lock', requireAuth, (req, res) => {
  if (!accessFor(req.user, req.params.id)) return res.status(404).json({ error: 'Page introuvable' });
  const own = db.prepare('SELECT idle_min FROM page_locks WHERE page_id=?').get(req.params.id), eff = lockFor(req.params.id);
  res.json({ own: !!own, idle_min: own?.idle_min ?? 1440, inherited: !!eff && !own, lock_page_id: eff?.page_id || null, open: eff ? isOpen(req, eff) : true });
});
lockRouter.post('/:id/lock/unlock', requireAuth, (req, res) => {
  const lock = lockFor(req.params.id);
  if (!lock) return res.json({ ok: true });
  if (!accessFor(req.user, req.params.id)) return res.status(404).json({ error: 'Page introuvable' });
  const key = `${sessKey(req)}|${lock.page_id}`, t = (tries.get(key) || []).filter((x) => x > now() - 5 * 60_000);
  if (t.length >= 6) return res.status(429).json({ error: 'Trop d’essais : réessayez dans quelques minutes' });
  if (!verifyPassword(String(req.body?.pin ?? ''), lock.hash)) { t.push(now()); tries.set(key, t); return res.status(403).json({ error: 'Code incorrect' }); }
  tries.delete(key); unlocked.set(key, now()); rememberCode(sessKey(req), String(req.body.pin)); res.json({ ok: true });
});
lockRouter.post('/:id/lock/now', requireAuth, (req, res) => {
  const lock = lockFor(req.params.id);
  if (lock) { const sess = sessKey(req); unlocked.delete(`${sess}|${lock.page_id}`); codes.delete(sess); for (const k of [...unlocked.keys()]) if (k.startsWith(`${sess}|`)) unlocked.delete(k); } // reverrouille tout ce que ce code ouvrait
  res.json({ ok: true });
});
/** Active ou modifie le verrou (propriétaire). Si un verrou existe déjà : l'ancien code est exigé. */
lockRouter.put('/:id/lock', requireAuth, (req, res) => {
  const id = req.params.id;
  if (accessFor(req.user, id) !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut verrouiller une page' });
  const own = db.prepare('SELECT hash FROM page_locks WHERE page_id=?').get(id);
  const { pin, current_pin, idle_min } = req.body || {};
  const idle = Math.max(0, Math.min(1440, Number.isFinite(Number(idle_min)) ? Math.round(Number(idle_min)) : 1440));
  if (own && !verifyPassword(String(current_pin ?? ''), own.hash)) return res.status(403).json({ error: 'Code actuel incorrect' });
  if (!own && lockFor(id) && !isOpen(req, lockFor(id))) return res.status(423).json({ error: 'Page verrouillée' });
  if (pin === undefined || pin === '') { // seule la durée change
    if (!own) return res.status(400).json({ error: 'Code requis (4 caractères minimum)' });
    db.prepare('UPDATE page_locks SET idle_min=? WHERE page_id=?').run(idle, id); return res.json({ ok: true });
  }
  if (!pinOk(pin)) return res.status(400).json({ error: 'Le code doit faire de 4 à 64 caractères' });
  db.prepare('INSERT INTO page_locks(page_id,hash,idle_min,created_at) VALUES(?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET hash=excluded.hash, idle_min=excluded.idle_min')
    .run(id, hashPassword(pin), idle, now());
  gcalTouch(id); // une ligne verrouillée n'apparaît jamais dans Google Agenda
  // La page se verrouille aussitôt (il faut saisir le code pour la rouvrir) ; le même code mémorisé sur d'autres pages se referme avec elle.
  unlocked.delete(`${sessKey(req)}|${id}`); codes.get(sessKey(req))?.delete(String(pin));
  res.json({ ok: true });
});
lockRouter.post('/:id/lock/remove', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!can(accessFor(req.user, id), 'owner')) return res.status(403).json({ error: 'Seul le propriétaire peut retirer le verrou' });
  const own = db.prepare('SELECT hash FROM page_locks WHERE page_id=?').get(id);
  if (!own) return res.json({ ok: true });
  if (!verifyPassword(String(req.body?.pin ?? ''), own.hash)) return res.status(403).json({ error: 'Code incorrect' });
  db.prepare('DELETE FROM page_locks WHERE page_id=?').run(id); gcalTouch(id); res.json({ ok: true });
});
