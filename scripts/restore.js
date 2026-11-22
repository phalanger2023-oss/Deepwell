// Restauration : arrêtez le serveur, puis  npm run restore -- data/backups/deepwell-XXXX.db.gz
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('Usage : npm run restore -- <sauvegarde .db.gz>'); process.exit(1); }
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const dest = process.env.DB_PATH || path.join(dataDir, 'deepwell.db');
if (fs.existsSync(dest)) {
  const keep = `${dest}.avant-restauration-${Date.now()}`;
  fs.renameSync(dest, keep);
  console.log(`Base actuelle conservée : ${keep}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(dest + ext, { force: true });
fs.writeFileSync(dest, zlib.gunzipSync(fs.readFileSync(src)));
console.log(`Base restaurée : ${dest}`);
console.log(`Fichiers : copiez le contenu de ${path.join(dataDir, 'backups', 'uploads')} vers ${path.join(dataDir, 'uploads')} si nécessaire.`);
