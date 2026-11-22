/**
 * File de tâches persistante (SQLite) avec nouvelles tentatives espacées.
 * Sert aux opérations qui peuvent échouer temporairement (Drive, réseau) : une tâche échouée est rejouée
 * après un délai croissant (30 s, 1 min, 2 min… plafonné à 1 h) jusqu'à `max_attempts`, puis passe en « failed ».
 * Aucune interrogation continue : un seul minuteur lent, qui ne fait rien tant qu'aucune tâche n'est due.
 */
import { db, uid, now, parse } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at INTEGER NOT NULL, dedupe_key TEXT, last_error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, next_run_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending','running');
`);

const handlers = new Map();
export const BASE_DELAY_MS = Number(process.env.JOB_BASE_DELAY_MS || 30_000);
export const MAX_DELAY_MS = 3600_000;
export const backoff = (attempts) => Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));

/** Enregistre le code qui exécute un type de tâche : `fn(payload, job)` ; lever une erreur déclenche une nouvelle tentative. */
export function registerJob(type, fn) { handlers.set(type, fn); }

/** Ajoute une tâche. Avec `dedupeKey`, une tâche identique encore en attente n'est pas dupliquée. */
export function enqueueJob(type, payload = {}, { maxAttempts = 5, delayMs = 0, dedupeKey = null } = {}) {
  if (dedupeKey) {
    const ex = db.prepare("SELECT id FROM jobs WHERE dedupe_key=? AND status IN ('pending','running')").get(dedupeKey);
    if (ex) return ex.id;
  }
  const id = uid(), t = now();
  db.prepare('INSERT INTO jobs(id,type,payload,max_attempts,next_run_at,dedupe_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, type, JSON.stringify(payload), maxAttempts, t + delayMs, dedupeKey, t, t);
  return id;
}

/** Exécute les tâches dues, une fois chacune par passage (une tâche qui échoue attend son délai). Renvoie le nombre de tâches traitées. */
export async function runDueJobs(limit = 20) {
  const due = db.prepare("SELECT * FROM jobs WHERE status='pending' AND next_run_at<=? ORDER BY next_run_at LIMIT ?").all(now(), limit);
  for (const job of due) {
    db.prepare("UPDATE jobs SET status='running', attempts=attempts+1, updated_at=? WHERE id=?").run(now(), job.id);
    const attempts = job.attempts + 1, fn = handlers.get(job.type);
    try {
      if (!fn) throw Object.assign(new Error(`Type de tâche inconnu : ${job.type}`), { fatal: true });
      await fn(parse(job.payload, {}), { ...job, attempts });
      db.prepare("UPDATE jobs SET status='done', last_error=NULL, updated_at=? WHERE id=?").run(now(), job.id);
    } catch (e) {
      const final = e.fatal || attempts >= job.max_attempts;
      db.prepare('UPDATE jobs SET status=?, last_error=?, next_run_at=?, updated_at=? WHERE id=?')
        .run(final ? 'failed' : 'pending', String(e.message || e).slice(0, 500), now() + backoff(attempts), now(), job.id);
    }
  }
  return due.length;
}

export function jobStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** Démarre le traitement : reprise des tâches interrompues par un arrêt, puis vérification toutes les `intervalMs`. */
export function startJobWorker(intervalMs = 15_000) {
  db.prepare("UPDATE jobs SET status='pending' WHERE status='running'").run();
  const tick = () => {
    db.prepare("DELETE FROM jobs WHERE status='done' AND updated_at<?").run(now() - 7 * 86400_000);
    return runDueJobs().catch((e) => console.error('[jobs]', e.message));
  };
  setTimeout(tick, 5_000).unref();
  return setInterval(tick, intervalMs).unref();
}
