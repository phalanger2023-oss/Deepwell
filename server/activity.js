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
import { locate } from './geo.js';

const MAX_GAP = 90_000;
const DAYMS = 24 * 3600_000;
const geo = (r) => ({ ...r, geo: locate(r.ip).label });
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Recherche libre (IP, compte, e-mail, page, appareil, localisation…) : tous les mots doivent se retrouver quelque part dans la ligne. */
const matches = (q, ...fields) => { const hay = norm(fields.filter(Boolean).join(' ')); return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w)); };
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
  res.json(db.prepare(`SELECT substr(s.token_hash,1,16) AS id, s.user_id, u.email, u.name, s.created_at, s.last_seen, s.expires_at, s.ip, s.ua
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>? ORDER BY COALESCE(s.last_seen,s.created_at) DESC LIMIT 200`).all(now())
    .map((r) => ({ ...geo(r), device: deviceName(r.ua), current: r.id === me })));
});
activityRouter.delete('/sessions/:id', (req, res) => {
  if (!/^[0-9a-f]{16}$/.test(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide' });
  db.prepare('DELETE FROM sessions WHERE substr(token_hash,1,16)=?').run(req.params.id); res.json({ ok: true });
});

/** Journal de connexion (réussies, échouées, déconnexions). `q` : recherche libre ; `kind` : login | login_fail | logout | register ; `days` : période. */
const KIND_FR = { login: 'connexion', login_fail: 'échec de connexion', logout: 'déconnexion', register: 'création de compte' };
activityRouter.get('/log', (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 90)), q = String(req.query.q || '').trim().slice(0, 100);
  const kind = ['login', 'login_fail', 'logout', 'register'].includes(req.query.kind) ? req.query.kind : null;
  let rows = db.prepare(`SELECT l.at,l.kind,l.email,l.ip,l.ua,l.user_id,u.name AS user_name FROM connection_log l LEFT JOIN users u ON u.id=l.user_id
    WHERE l.at>=? ${kind ? 'AND l.kind=?' : ''} ORDER BY l.at DESC LIMIT 5000`).all(...(kind ? [now() - days * DAYMS, kind] : [now() - days * DAYMS]))
    .map((r) => ({ ...geo(r), device: deviceName(r.ua) }));
  if (q) rows = rows.filter((r) => matches(q, r.email, r.user_name, r.ip, r.geo, r.device, KIND_FR[r.kind]));
  res.json(rows.slice(0, 500));
});

/** Consultations : résumé par page + dernières consultations. `kind` : all | link | user ; `days` : période ; `q` : recherche libre ; `user` : un compte précis. */
activityRouter.get('/visits', (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30)), since = now() - days * DAYMS, q = String(req.query.q || '').trim().slice(0, 100);
  const kind = ['link', 'user'].includes(req.query.kind) ? req.query.kind : null, user = typeof req.query.user === 'string' && req.query.user.length < 64 ? req.query.user : null;
  const conds = ['v.last_seen>=?'], args = [since];
  if (kind) { conds.push('v.actor=?'); args.push(kind); }
  if (user) { conds.push('v.user_id=?'); args.push(user); }
  let rows = db.prepare(`SELECT v.id,v.actor,v.started_at,v.last_seen,v.seconds,v.ip,v.ua,v.page_id,v.user_id,p.title AS page_title,u.name AS user_name,u.email AS user_email
    FROM visits v LEFT JOIN pages p ON p.id=v.page_id LEFT JOIN users u ON u.id=v.user_id WHERE ${conds.join(' AND ')} ORDER BY v.started_at DESC LIMIT 5000`).all(...args)
    .map((r) => ({ ...geo(r), device: deviceName(r.ua) }));
  if (q) rows = rows.filter((r) => matches(q, r.user_name, r.user_email, r.ip, r.geo, r.device, r.page_title, r.actor === 'link' ? 'lien public' : 'compte'));
  // résumé par page, calculé sur les lignes retenues (donc cohérent avec la recherche)
  const by = new Map();
  for (const r of rows) {
    const g = by.get(r.page_id) || { page_id: r.page_id, page_title: r.page_title, visits: 0, seconds: 0, keys: new Set(), link_visits: 0, last_seen: 0 };
    g.visits++; g.seconds += r.seconds; g.keys.add(r.user_id || r.ip); if (r.actor === 'link') g.link_visits++; g.last_seen = Math.max(g.last_seen, r.last_seen); by.set(r.page_id, g);
  }
  const pages = [...by.values()].map(({ keys, ...g }) => ({ ...g, visitors: keys.size })).sort((x, y) => y.seconds - x.seconds).slice(0, 100);
  res.json({ pages, visits: rows.slice(0, 300) });
});

/** Fiche d'un compte : pages consultées (avec temps passé), dernières connexions, appareils. */
activityRouter.get('/account/:id', (req, res) => {
  const u = db.prepare('SELECT id,email,name,role,created_at FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable' });
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 90)), since = now() - days * DAYMS;
  const pages = db.prepare(`SELECT v.page_id, p.title AS page_title, p.icon AS page_icon, COUNT(*) AS visits, SUM(v.seconds) AS seconds, MAX(v.last_seen) AS last_seen
    FROM visits v LEFT JOIN pages p ON p.id=v.page_id WHERE v.user_id=? AND v.last_seen>=? GROUP BY v.page_id ORDER BY last_seen DESC LIMIT 300`).all(u.id, since);
  const log = db.prepare('SELECT at,kind,ip,ua FROM connection_log WHERE user_id=? AND at>=? ORDER BY at DESC LIMIT 100').all(u.id, since).map((r) => ({ ...geo(r), device: deviceName(r.ua) }));
  const total = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(seconds),0) AS s FROM visits WHERE user_id=? AND last_seen>=?').get(u.id, since);
  res.json({ user: u, days, visits: total.n, seconds: total.s, pages, log });
});

// ---------- Suivi de liens (clic droit sur un lien d'une page) + statistiques d'une page ----------
const cleanUrl = (u) => (typeof u === 'string' && u.length <= 2000 && /^(https?:|mailto:|tel:|\/|#)/i.test(u.trim()) ? u.trim() : null);

/** Liens suivis d'une page (public : l'application doit savoir quels clics signaler). */
pingRouter.get('/links', (req, res) => {
  const pageId = String(req.query.page_id || ''), tk = typeof req.query.token === 'string' && req.query.token.length < 200 ? req.query.token : null;
  if (!pageId || !accessFor(req.user, pageId, tk)) return res.json({ urls: [] });
  res.json({ urls: db.prepare('SELECT url FROM tracked_links WHERE page_id=?').all(pageId).map((r) => r.url) });
});
/** Un clic sur un lien suivi (qui, quand, d'où). */
pingRouter.post('/link', (req, res) => {
  const { page_id: pageId, url, token } = req.body || {};
  const u = cleanUrl(url), tk = typeof token === 'string' && token.length < 200 ? token : null;
  if (typeof pageId !== 'string' || !u || !accessFor(req.user, pageId, tk)) return res.json({ ok: false });
  const link = db.prepare('SELECT id FROM tracked_links WHERE page_id=? AND url=?').get(pageId, u);
  if (!link) return res.json({ ok: false });
  const { ip, ua } = clientInfo(req), viaLink = !req.user || (!!tk && !accessFor(req.user, pageId, null));
  db.prepare('INSERT INTO link_clicks(id,link_id,at,user_id,actor_key,ip,ua) VALUES(?,?,?,?,?,?,?)')
    .run(uid(), link.id, now(), viaLink ? null : req.user.id, viaLink ? `l:${sha(`${ip}|${ua}`)}` : `u:${req.user.id}`, ip, ua);
  res.json({ ok: true });
});
/** Activer / désactiver le suivi d'un lien (administrateur). */
activityRouter.put('/links', (req, res) => {
  const { page_id: pageId, url, on } = req.body || {}, u = cleanUrl(url);
  if (typeof pageId !== 'string' || !u || !db.prepare('SELECT 1 FROM pages WHERE id=?').get(pageId)) return res.status(400).json({ error: 'Page ou lien invalide' });
  if (on === false) db.prepare('DELETE FROM tracked_links WHERE page_id=? AND url=?').run(pageId, u);
  else db.prepare('INSERT OR IGNORE INTO tracked_links(id,page_id,url,created_by,created_at) VALUES(?,?,?,?,?)').run(uid(), pageId, u, req.user.id, now());
  res.json({ ok: true, tracked: on !== false });
});

/** Statistiques d'une page (administrateur) : consultations, visiteurs, temps passé, liens suivis, interactions. */
activityRouter.get('/page/:id', (req, res) => {
  const page = db.prepare('SELECT id,title,icon,kind,created_at,updated_at FROM pages WHERE id=?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Page introuvable' });
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30)), since = now() - days * DAYMS;
  const vis = db.prepare(`SELECT v.id,v.actor,v.started_at,v.last_seen,v.seconds,v.ip,v.ua,v.user_id,u.name AS user_name,u.email AS user_email
    FROM visits v LEFT JOIN users u ON u.id=v.user_id WHERE v.page_id=? AND v.last_seen>=? ORDER BY v.started_at DESC LIMIT 5000`).all(page.id, since).map((r) => ({ ...geo(r), device: deviceName(r.ua) }));
  const keys = new Set(vis.map((v) => v.user_id || v.ip)), seconds = vis.reduce((s, v) => s + v.seconds, 0);
  const perDay = {}; for (const v of vis) { const d = new Date(v.started_at).toISOString().slice(0, 10); perDay[d] = (perDay[d] || 0) + 1; }
  const days_ = []; for (let i = days - 1; i >= 0; i--) { const d = new Date(now() - i * DAYMS).toISOString().slice(0, 10); days_.push({ day: d, visits: perDay[d] || 0 }); }
  const people = new Map();
  for (const v of vis) {
    const k = v.user_id || `ip:${v.ip}`, p = people.get(k) || { who: v.user_id ? (v.user_name || v.user_email || 'Compte') : 'Visiteur (lien public)', user_id: v.user_id, ip: v.ip, geo: v.geo, visits: 0, seconds: 0, last_seen: 0, device: v.device };
    p.visits++; p.seconds += v.seconds; p.last_seen = Math.max(p.last_seen, v.last_seen); people.set(k, p);
  }
  const links = db.prepare('SELECT id,url,created_at FROM tracked_links WHERE page_id=? ORDER BY created_at').all(page.id).map((l) => {
    const clicks = db.prepare(`SELECT c.at,c.ip,c.ua,c.user_id,u.name AS user_name,u.email AS user_email FROM link_clicks c LEFT JOIN users u ON u.id=c.user_id WHERE c.link_id=? AND c.at>=? ORDER BY c.at DESC LIMIT 200`).all(l.id, since)
      .map((c) => ({ ...geo(c), device: deviceName(c.ua), who: c.user_id ? (c.user_name || c.user_email) : 'Visiteur (lien public)' }));
    return { ...l, clicks_total: db.prepare('SELECT COUNT(*) AS n FROM link_clicks WHERE link_id=?').get(l.id).n, clicks };
  });
  const cm = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(resolved=0 AND parent_id IS NULL),0) AS open_ FROM comments WHERE page_id=?').get(page.id);
  const ver = db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM page_versions WHERE page_id=?').get(page.id);
  const editors = db.prepare('SELECT COALESCE(user_name,\'—\') AS name, COUNT(*) AS n FROM page_versions WHERE page_id=? GROUP BY user_name ORDER BY n DESC LIMIT 10').all(page.id);
  res.json({
    page, days, visits: vis.length, visitors: keys.size, link_visits: vis.filter((v) => v.actor === 'link').length, seconds, avg_seconds: vis.length ? Math.round(seconds / vis.length) : 0,
    last_visit: vis[0]?.started_at || null, per_day: days_, people: [...people.values()].sort((a, b) => b.last_seen - a.last_seen).slice(0, 50), recent: vis.slice(0, 60),
    links, interactions: { comments: cm.n, open_threads: cm.open_, versions: ver.n, last_edit: ver.last, editors },
  });
});
