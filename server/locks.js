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

db.exec(`CREATE TABLE IF NOT EXISTS page_locks(
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE, hash TEXT NOT NULL, idle_min INTEGER NOT NULL DEFAULT 15, created_at INTEGER NOT NULL)`);

const sessKey = (req) => {
  const m = /(?:^|;\s*)dw_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? crypto.createHash('sha256').update(decodeURIComponent(m[1])).digest('hex').slice(0, 32) : null;
};
const unlocked = new Map(); // `${session}|${page_verrouillée}` -> dernière activité
const tries = new Map();

/** Verrou effectif d'une page : le plus proche, en remontant vers la racine (la page elle-même incluse). */
export function lockFor(pageId) {
  return db.prepare(`WITH RECURSIVE up(id,parent_id,d) AS (SELECT id,parent_id,0 FROM pages WHERE id=?
      UNION ALL SELECT p.id,p.parent_id,d+1 FROM pages p JOIN up ON p.id=up.parent_id WHERE d<200)
    SELECT l.page_id, l.hash, l.idle_min FROM page_locks l JOIN up ON up.id=l.page_id ORDER BY up.d LIMIT 1`).get(pageId) || null;
}
export const isOpen = (req, lock) => {
  const k = `${sessKey(req)}|${lock.page_id}`, last = unlocked.get(k);
  if (!req.user || !last) return false;
  if (lock.idle_min > 0 && now() - last > lock.idle_min * 60_000) { unlocked.delete(k); return false; }
  unlocked.set(k, now()); return true;
};

/** Middleware `router.param('id')` : refuse (423) tout accès au contenu d'une page verrouillée tant qu'elle n'est pas ouverte. */
export function lockGuard(req, res, next, id) {
  if (['public', 'tree', 'search', 'icons'].includes(id)) return next();
  const rest = req.path.split('/').filter(Boolean).slice(1).join('/'); // ce qui suit /:id
  if (rest.startsWith('lock')) return next(); // statut / déverrouillage / gestion : leur propre contrôle
  if ((req.method === 'PATCH' || req.method === 'DELETE') && !rest) return next(); // renommer, déplacer, icône, corbeille : pas de lecture du contenu
  const lock = lockFor(id);
  if (!lock || isOpen(req, lock)) return next();
  const p = db.prepare('SELECT id,title,icon FROM pages WHERE id=?').get(id);
  res.status(423).json({ error: 'Page verrouillée', locked: true, page: p, lock_page_id: lock.page_id });
}

export const lockedIds = (ids) => new Set(ids.filter((i) => lockFor(i)));

export const lockRouter = express.Router({ mergeParams: true });
const pinOk = (p) => typeof p === 'string' && p.length >= 4 && p.length <= 64;

lockRouter.get('/:id/lock', requireAuth, (req, res) => {
  if (!accessFor(req.user, req.params.id)) return res.status(404).json({ error: 'Page introuvable' });
  const own = db.prepare('SELECT idle_min FROM page_locks WHERE page_id=?').get(req.params.id), eff = lockFor(req.params.id);
  res.json({ own: !!own, idle_min: own?.idle_min ?? 15, inherited: !!eff && !own, lock_page_id: eff?.page_id || null, open: eff ? isOpen(req, eff) : true });
});
lockRouter.post('/:id/lock/unlock', requireAuth, (req, res) => {
  const lock = lockFor(req.params.id);
  if (!lock) return res.json({ ok: true });
  if (!accessFor(req.user, req.params.id)) return res.status(404).json({ error: 'Page introuvable' });
  const key = `${sessKey(req)}|${lock.page_id}`, t = (tries.get(key) || []).filter((x) => x > now() - 5 * 60_000);
  if (t.length >= 6) return res.status(429).json({ error: 'Trop d’essais : réessayez dans quelques minutes' });
  if (!verifyPassword(String(req.body?.pin ?? ''), lock.hash)) { t.push(now()); tries.set(key, t); return res.status(403).json({ error: 'Code incorrect' }); }
  tries.delete(key); unlocked.set(key, now()); res.json({ ok: true });
});
lockRouter.post('/:id/lock/now', requireAuth, (req, res) => {
  const lock = lockFor(req.params.id);
  if (lock) unlocked.delete(`${sessKey(req)}|${lock.page_id}`);
  res.json({ ok: true });
});
/** Active ou modifie le verrou (propriétaire). Si un verrou existe déjà : l'ancien code est exigé. */
lockRouter.put('/:id/lock', requireAuth, (req, res) => {
  const id = req.params.id;
  if (accessFor(req.user, id) !== 'owner') return res.status(403).json({ error: 'Seul le propriétaire peut verrouiller une page' });
  const own = db.prepare('SELECT hash FROM page_locks WHERE page_id=?').get(id);
  const { pin, current_pin, idle_min } = req.body || {};
  const idle = Math.max(0, Math.min(1440, Number.isFinite(Number(idle_min)) ? Math.round(Number(idle_min)) : 15));
  if (own && !verifyPassword(String(current_pin ?? ''), own.hash)) return res.status(403).json({ error: 'Code actuel incorrect' });
  if (!own && lockFor(id) && !isOpen(req, lockFor(id))) return res.status(423).json({ error: 'Page verrouillée' });
  if (pin === undefined || pin === '') { // seule la durée change
    if (!own) return res.status(400).json({ error: 'Code requis (4 caractères minimum)' });
    db.prepare('UPDATE page_locks SET idle_min=? WHERE page_id=?').run(idle, id); return res.json({ ok: true });
  }
  if (!pinOk(pin)) return res.status(400).json({ error: 'Le code doit faire de 4 à 64 caractères' });
  db.prepare('INSERT INTO page_locks(page_id,hash,idle_min,created_at) VALUES(?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET hash=excluded.hash, idle_min=excluded.idle_min')
    .run(id, hashPassword(pin), idle, now());
  unlocked.set(`${sessKey(req)}|${id}`, now()); // celui qui vient de définir le code reste connecté
  res.json({ ok: true });
});
lockRouter.post('/:id/lock/remove', requireAuth, (req, res) => {
  const id = req.params.id;
  if (!can(accessFor(req.user, id), 'owner')) return res.status(403).json({ error: 'Seul le propriétaire peut retirer le verrou' });
  const own = db.prepare('SELECT hash FROM page_locks WHERE page_id=?').get(id);
  if (!own) return res.json({ ok: true });
  if (!verifyPassword(String(req.body?.pin ?? ''), own.hash)) return res.status(403).json({ error: 'Code incorrect' });
  db.prepare('DELETE FROM page_locks WHERE page_id=?').run(id); res.json({ ok: true });
});
