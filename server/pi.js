/** Jeu « décimales de π » : historique des parties de chaque utilisateur (mémorisation). */
import express from 'express';
import { db, uid } from './db.js';
import { requireAuth } from './auth.js';

db.exec(`CREATE TABLE IF NOT EXISTS pi_runs(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL,
  mode TEXT NOT NULL, digits INTEGER NOT NULL, target INTEGER NOT NULL DEFAULT 0, seconds REAL NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS pi_runs_user ON pi_runs(user_id, at DESC);`);

export const piRouter = express.Router();
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
