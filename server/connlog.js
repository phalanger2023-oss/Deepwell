/**
 * Journal des connexions et des consultations (supervision par l'administrateur).
 * - `sessions` : appareils connectés (création, dernière activité, IP, navigateur, durée de validité) ;
 * - `connection_log` : connexions réussies / échouées, déconnexions ;
 * - `visits` : consultations d'une page, par un compte ou par un lien public (sans compte), avec le temps passé.
 * Conservation : 1 an (purge automatique).
 */
import { db, now, uid } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS connection_log(
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, user_id TEXT, email TEXT, ip TEXT, ua TEXT);
CREATE INDEX IF NOT EXISTS connlog_at ON connection_log(at);
CREATE TABLE IF NOT EXISTS visits(
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, actor_key TEXT NOT NULL, user_id TEXT, share_id TEXT,
  page_id TEXT NOT NULL, started_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, pings INTEGER NOT NULL DEFAULT 1,
  ip TEXT, ua TEXT);
CREATE INDEX IF NOT EXISTS visits_last ON visits(last_seen);
CREATE INDEX IF NOT EXISTS visits_page ON visits(page_id);
CREATE INDEX IF NOT EXISTS visits_user ON visits(user_id, last_seen);
CREATE INDEX IF NOT EXISTS connlog_user ON connection_log(user_id, at);
CREATE TABLE IF NOT EXISTS tracked_links(
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, url TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL,
  UNIQUE(page_id, url));
CREATE TABLE IF NOT EXISTS link_clicks(
  id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES tracked_links(id) ON DELETE CASCADE, at INTEGER NOT NULL, user_id TEXT, actor_key TEXT, ip TEXT, ua TEXT);
CREATE INDEX IF NOT EXISTS link_clicks_link ON link_clicks(link_id, at);`);
const cols = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name));
for (const [c, t] of [['created_at', 'INTEGER'], ['last_seen', 'INTEGER'], ['ip', 'TEXT'], ['ua', 'TEXT'], ['ttl_ms', 'INTEGER']]) if (!cols.has(c)) db.exec(`ALTER TABLE sessions ADD COLUMN ${c} ${t}`);

export const clientInfo = (req) => ({ ip: String(req.ip || '').slice(0, 64), ua: String(req.headers['user-agent'] || '').slice(0, 300) });
export function logConn(req, kind, { userId = null, email = null } = {}) {
  try { const { ip, ua } = clientInfo(req); db.prepare('INSERT INTO connection_log(id,at,kind,user_id,email,ip,ua) VALUES(?,?,?,?,?,?,?)').run(uid(), now(), kind, userId, email ? String(email).slice(0, 200) : null, ip, ua); } catch { /* le journal ne doit jamais bloquer une connexion */ }
}
/** Navigateur / système en clair (« Chrome · Android »), à partir du user-agent. */
export function deviceName(ua = '') {
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ua ? 'Navigateur' : '—';
  const os = /CrOS/.test(ua) ? 'ChromeOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${br} · ${os}` : br;
}
const DAY = 24 * 3600_000;
export function purgeOld() {
  const t = now() - 365 * DAY;
  db.prepare('DELETE FROM connection_log WHERE at<?').run(t); db.prepare('DELETE FROM visits WHERE last_seen<?').run(t); db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
}
export const purgeClicks = () => db.prepare('DELETE FROM link_clicks WHERE at<?').run(now() - 365 * DAY);
purgeOld(); purgeClicks(); setInterval(purgeOld, DAY).unref();
