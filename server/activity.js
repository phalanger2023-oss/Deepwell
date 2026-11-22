/**
 * Supervision (administrateur) : appareils connectés, journal des connexions, consultations de pages avec temps passé
 * — comptes ET liens publics (visiteurs sans compte).
 * Temps passé : l'application envoie un « battement » (≈ toutes les 30 s) tant que la page est visible et que l'utilisateur est actif ;
 * le serveur additionne l'intervalle écoulé (plafonné à 90 s, pour qu'un onglet oublié ne gonfle pas le total).
 */
import crypto from 'node:crypto';
import express from 'express';
import { db, now, uid } from './db.js';
import { requireAdmin, requireAuth, sessionId } from './auth.js';
import { accessFor } from './access.js';
import { clientInfo, deviceName } from './connlog.js';

const MAX_GAP = 90_000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);

/** Enregistrement des consultations (accessible sans compte : lien public). */
export const pingRouter = express.Router();
pingRouter.post('/', (req, res) => {
  const { page_id: pageId, visit, token } = req.body || {};
  if (typeof pageId !== 'string' || pageId.length > 64) return res.json({ ok: false });
  const tk = typeof token === 'string' && token.length < 200 ? token : null;
  const role = accessFor(req.user, pageId, tk);
  if (!role) return res.json({ ok: false });
  const viaLink = !req.user || (!!tk && !accessFor(req.user, pageId, null)); // lien public : sans compte, ou compte qui n'a accès que par le lien
  const share = tk ? db.prepare('SELECT id FROM shares WHERE public_token=?').get(tk) : null;
  const { ip, ua } = clientInfo(req);
  const key = req.user && !viaLink ? `u:${req.user.id}` : `l:${sha(`${ip}|${ua}`)}`; // visiteur anonyme : empreinte IP + navigateur (non réversible)
  const t = now();
  const cur = typeof visit === 'string' ? db.prepare('SELECT id,last_seen,seconds,actor_key,page_id FROM visits WHERE id=?').get(visit) : null;
  if (cur && cur.actor_key === key && cur.page_id === pageId) {
    db.prepare('UPDATE visits SET seconds=seconds+?, last_seen=?, pings=pings+1 WHERE id=?').run(Math.round(Math.min(t - cur.last_seen, MAX_GAP) / 1000), t, cur.id);
    return res.json({ ok: true, visit: cur.id });
  }
  const id = uid();
  db.prepare('INSERT INTO visits(id,actor,actor_key,user_id,share_id,page_id,started_at,last_seen,seconds,ip,ua) VALUES(?,?,?,?,?,?,?,?,0,?,?)')
    .run(id, viaLink ? 'link' : 'user', key, viaLink ? null : req.user.id, share?.id ?? null, pageId, t, t, ip, ua);
  res.json({ ok: true, visit: id });
});

export const activityRouter = express.Router();
activityRouter.use(requireAuth, requireAdmin);

/** Appareils connectés (sessions). */
activityRouter.get('/sessions', (req, res) => {
  const me = sessionId(req);
  res.json(db.prepare(`SELECT substr(s.token_hash,1,16) AS id, u.email, u.name, s.created_at, s.last_seen, s.expires_at, s.ip, s.ua
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>? ORDER BY COALESCE(s.last_seen,s.created_at) DESC LIMIT 200`).all(now())
    .map((r) => ({ ...r, device: deviceName(r.ua), current: r.id === me })));
});
activityRouter.delete('/sessions/:id', (req, res) => {
  if (!/^[0-9a-f]{16}$/.test(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide' });
  db.prepare('DELETE FROM sessions WHERE substr(token_hash,1,16)=?').run(req.params.id); res.json({ ok: true });
});

/** Journal de connexion (réussies, échouées, déconnexions). */
activityRouter.get('/log', (_req, res) =>
  res.json(db.prepare('SELECT at,kind,email,ip,ua FROM connection_log ORDER BY at DESC LIMIT 200').all().map((r) => ({ ...r, device: deviceName(r.ua) }))));

/** Consultations : résumé par page + dernières consultations. `kind` : all | link | user ; `days` : période. */
activityRouter.get('/visits', (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30)), since = now() - days * 24 * 3600_000;
  const kind = ['link', 'user'].includes(req.query.kind) ? req.query.kind : null, w = kind ? 'AND v.actor=?' : '';
  const args = kind ? [since, kind] : [since];
  const rows = db.prepare(`SELECT v.id,v.actor,v.started_at,v.last_seen,v.seconds,v.ip,v.ua,v.page_id,p.title AS page_title,u.name AS user_name,u.email AS user_email
    FROM visits v LEFT JOIN pages p ON p.id=v.page_id LEFT JOIN users u ON u.id=v.user_id WHERE v.last_seen>=? ${w} ORDER BY v.started_at DESC LIMIT 300`).all(...args)
    .map((r) => ({ ...r, device: deviceName(r.ua) }));
  const pages = db.prepare(`SELECT v.page_id, p.title AS page_title, COUNT(*) AS visits, SUM(v.seconds) AS seconds, COUNT(DISTINCT v.actor_key) AS visitors, SUM(v.actor='link') AS link_visits, MAX(v.last_seen) AS last_seen
    FROM visits v LEFT JOIN pages p ON p.id=v.page_id WHERE v.last_seen>=? ${w} GROUP BY v.page_id ORDER BY seconds DESC LIMIT 100`).all(...args);
  res.json({ pages, visits: rows });
});
