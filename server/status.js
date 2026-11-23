/**
 * État du serveur (administrateur) : ressources, base de données, tâches, temps de réponse des requêtes API.
 * + « ping » léger sans authentification, utilisé par la page pour mesurer sa latence réseau (aller-retour).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { db, DATA_DIR } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';
import { listBackups } from './backup.js';

const startedAt = Date.now();
const RING = []; // dernières requêtes API : { at, ms, status }
/** Middleware : mesure la durée de chaque requête /api (sans le ping, pour ne pas fausser la moyenne). */
export function timingMiddleware(req, res, next) {
  if (!req.path.startsWith('/api') || req.path.startsWith('/api/ping')) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => { RING.push({ at: Date.now(), ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.statusCode }); if (RING.length > 300) RING.shift(); });
  next();
}

// Retard de la boucle d'événements (Node) : si la valeur monte, le serveur est saturé
let lag = 0, lagMax = 0;
{ let last = process.hrtime.bigint();
  setInterval(() => { const now = process.hrtime.bigint(), d = Number(now - last) / 1e6 - 500; last = now; lag = lag * 0.8 + Math.max(0, d) * 0.2; lagMax = Math.max(lagMax * 0.995, d); }, 500).unref(); }

export const pingRouter = express.Router();
pingRouter.get('/', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ t: Date.now() }); });

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const count = (sql, ...a) => db.prepare(sql).get(...a).c;

export const statusRouter = express.Router();
statusRouter.use(requireAuth, requireAdmin);
statusRouter.get('/', (_req, res) => {
  let disk = null;
  try { const s = fs.statfsSync(DATA_DIR); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { /* non disponible */ }
  const dbFile = process.env.DB_PATH || path.join(DATA_DIR, 'deepwell.db');
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  let uploads = 0;
  try { const up = path.join(DATA_DIR, 'uploads'); for (const f of fs.readdirSync(up)) uploads += size(path.join(up, f)); } catch { /* pas d'uploads */ }
  const ms = RING.map((r) => r.ms), recent = RING.filter((r) => Date.now() - r.at < 10 * 60_000);
  const mem = process.memoryUsage();
  const last = listBackups()[0] || null;
  const jobs = db.prepare("SELECT status, COUNT(*) c FROM jobs GROUP BY status").all();
  res.json({
    now: Date.now(), uptime_s: Math.round(process.uptime()), started_at: startedAt, node: process.version, platform: `${os.type()} ${os.release()}`,
    cpu: { cores: os.cpus().length, load: os.loadavg().map((x) => Math.round(x * 100) / 100) },
    memory: { rss: mem.rss, heap_used: mem.heapUsed, heap_total: mem.heapTotal, system_total: os.totalmem(), system_free: os.freemem() },
    event_loop_lag_ms: Math.round(lag * 10) / 10, event_loop_lag_max_ms: Math.round(lagMax * 10) / 10,
    disk, db: { size: size(dbFile), wal: size(`${dbFile}-wal`), uploads },
    counts: { users: count('SELECT COUNT(*) c FROM users'), pages: count('SELECT COUNT(*) c FROM pages'), blocks: count('SELECT COUNT(*) c FROM blocks'), sessions: count('SELECT COUNT(*) c FROM sessions WHERE expires_at>?', Date.now()) },
    requests: { sampled: RING.length, last_10min: recent.length, errors_5xx: recent.filter((r) => r.status >= 500).length,
      avg_ms: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length * 10) / 10 : 0, p50_ms: Math.round(pct(ms, 0.5) * 10) / 10, p95_ms: Math.round(pct(ms, 0.95) * 10) / 10, max_ms: Math.round(Math.max(0, ...ms) * 10) / 10 },
    jobs: Object.fromEntries(jobs.map((j) => [j.status, j.c])),
    backup: last ? { name: last.name, size: last.size, created_at: last.created_at } : null,
    env: { cookie_secure: process.env.COOKIE_SECURE === '1', trust_proxy: process.env.TRUST_PROXY === '1' },
  });
});
