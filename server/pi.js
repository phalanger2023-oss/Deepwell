/** Jeu « décimales de π » : historique des parties de chaque utilisateur (mémorisation). */
import express from 'express';
import { db, uid, getSetting } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';

db.exec(`CREATE TABLE IF NOT EXISTS pi_runs(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL,
  mode TEXT NOT NULL, digits INTEGER NOT NULL, target INTEGER NOT NULL DEFAULT 0, seconds REAL NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS pi_runs_user ON pi_runs(user_id, at DESC);`);

export const piRouter = express.Router();
// Classement lisible sans compte, uniquement avec le lien public d'une page π (noms et scores, rien d'autre)
piRouter.get('/public-leaderboard', (req, res) => {
  const tk = typeof req.query.token === 'string' ? req.query.token : '';
  const row = tk ? db.prepare('SELECT p.props FROM shares s JOIN pages p ON p.id=s.page_id WHERE s.public_token=?').get(tk) : null;
  let isPi = false; try { isPi = !!JSON.parse(row?.props || '{}').dw_pi; } catch { /* props illisibles : refus */ }
  if (!isPi) return res.status(404).json({ error: 'Lien invalide ou page sans jeu de π' });
  res.json({ players: leaderboard(null) });
});
piRouter.use(requireAuth);
const int = (v, max) => Math.min(Math.max(Math.trunc(Number(v)) || 0, 0), max);
piRouter.get('/', (req, res) => {
  const runs = db.prepare('SELECT id, at, mode, digits, target, seconds, errors FROM pi_runs WHERE user_id=? ORDER BY at DESC LIMIT 200').all(req.user.id);
  const best = db.prepare("SELECT MAX(digits) m FROM pi_runs WHERE user_id=? AND mode='recall'").get(req.user.id).m || 0;
  res.json({ runs, best });
});
piRouter.post('/', (req, res) => {
  const { mode, digits, target, seconds, errors } = req.body || {};
  if (!['recall', 'learn'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
  const run = { id: uid(), at: Date.now(), mode, digits: int(digits, 100000), target: int(target, 100000), seconds: Math.min(Math.max(Number(seconds) || 0, 0), 86400), errors: int(errors, 100000) };
  db.prepare('INSERT INTO pi_runs(id,user_id,at,mode,digits,target,seconds,errors) VALUES(?,?,?,?,?,?,?,?)').run(run.id, req.user.id, run.at, run.mode, run.digits, run.target, run.seconds, run.errors);
  res.json(run);
});
piRouter.delete('/', (req, res) => { db.prepare('DELETE FROM pi_runs WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });

// ---------- classement (tous les comptes) et vue développeur (détails de tous les comptes) ----------
const statsOf = (userId) => {
  const one = (sql, ...a) => db.prepare(sql).get(userId, ...a);
  const recall = one("SELECT COUNT(*) n, COALESCE(MAX(digits),0) best, COALESCE(SUM(digits),0) digits, COALESCE(SUM(seconds),0) secs, COALESCE(SUM(errors),0) errs, SUM(CASE WHEN target>0 AND digits>=target THEN 1 ELSE 0 END) wins FROM pi_runs WHERE user_id=? AND mode='recall'");
  const learn = one("SELECT COUNT(*) n, COALESCE(MAX(digits),0) best FROM pi_runs WHERE user_id=? AND mode='learn'");
  const bestRun = recall.best ? one("SELECT seconds FROM pi_runs WHERE user_id=? AND mode='recall' AND digits=? ORDER BY seconds LIMIT 1", recall.best) : null;
  const last = one('SELECT MAX(at) a FROM pi_runs WHERE user_id=?').a || null;
  return { best: recall.best, best_seconds: bestRun?.seconds ?? null, recall_runs: recall.n, wins: recall.wins || 0, learn_runs: learn.n, learn_best: learn.best,
    total_digits: recall.digits, total_seconds: Math.round(recall.secs), digits_per_min: recall.secs > 0 ? Math.round((recall.digits / recall.secs) * 600) / 10 : 0,
    error_rate: recall.digits + recall.errs > 0 ? Math.round((recall.errs / (recall.digits + recall.errs)) * 1000) / 10 : 0, last_at: last };
};
const leaderboard = (meId) => db.prepare('SELECT DISTINCT u.id, u.name FROM users u JOIN pi_runs r ON r.user_id=u.id').all()
  .map((u) => ({ name: u.name || 'Sans nom', me: !!meId && u.id === meId, ...statsOf(u.id) }))
  .sort((a, b) => b.best - a.best || (a.best_seconds ?? 1e9) - (b.best_seconds ?? 1e9));
piRouter.get('/leaderboard', (req, res) => res.json({ players: leaderboard(req.user.id) }));
piRouter.get('/admin', requireAdmin, (req, res) => {
  if (getSetting('dev_mode', '0') !== '1') return res.status(403).json({ error: 'Cette vue nécessite le mode développeur (Réglages → Développeur)' });
  const users = db.prepare('SELECT id, name, email, role FROM users ORDER BY name').all().map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, ...statsOf(u.id),
    days_active: db.prepare("SELECT COUNT(DISTINCT date(at/1000,'unixepoch')) n FROM pi_runs WHERE user_id=?").get(u.id).n,
    best_by_target: db.prepare("SELECT target, MAX(digits) best, COUNT(*) n FROM pi_runs WHERE user_id=? AND mode='recall' GROUP BY target ORDER BY target").all(u.id),
    runs: db.prepare('SELECT id, at, mode, digits, target, seconds, errors FROM pi_runs WHERE user_id=? ORDER BY at DESC LIMIT 60').all(u.id),
  }));
  res.json({ users, total_runs: db.prepare('SELECT COUNT(*) n FROM pi_runs').get().n });
});
