import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { db, BACKUP_DIR, UPLOAD_DIR, getSetting } from './db.js';

const KEEP = Number(process.env.BACKUP_KEEP || 14);
const INTERVAL_H = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
const FILES_MIRROR = path.join(BACKUP_DIR, 'uploads');

export function listBackups() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^deepwell-.*\.db\.gz$/.test(f)).sort().reverse()
    .map((name) => { const st = fs.statSync(path.join(BACKUP_DIR, name)); return { name, size: st.size, created_at: st.mtimeMs }; });
}

/**
 * Sauvegarde cohérente à chaud : instantané SQLite (VACUUM INTO) compressé en .gz,
 * + copie incrémentale du dossier uploads vers backups/uploads (jamais d'écrasement : les fichiers sont immuables).
 */
export async function createBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tmp = path.join(BACKUP_DIR, `tmp-${stamp}.db`);
  const out = path.join(BACKUP_DIR, `deepwell-${stamp}.db.gz`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), fs.createWriteStream(out));
  fs.rmSync(tmp);
  fs.mkdirSync(FILES_MIRROR, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    const dest = path.join(FILES_MIRROR, f);
    if (!fs.existsSync(dest)) { fs.copyFileSync(path.join(UPLOAD_DIR, f), dest); copied++; }
  }
  for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name));
  return { name: path.basename(out), size: fs.statSync(out).size, filesCopied: copied };
}

export function backupPath(name) {
  if (!/^deepwell-[\w.-]+\.db\.gz$/.test(name)) return null;
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

export function startScheduler(onDone = () => {}) {
  const tick = async () => {
    if (getSetting('backup_enabled', '1') !== '1') return;
    const last = listBackups()[0]?.created_at || 0;
    if (Date.now() - last < INTERVAL_H * 3600 * 1000) return;
    try { const r = await createBackup(); console.log(`[backup] ${r.name} (${r.size} octets)`); await onDone(r); }
    catch (e) { console.error('[backup] échec :', e.message); }
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 30 * 60 * 1000).unref();
}
