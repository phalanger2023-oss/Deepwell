import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import express from 'express';
import { db, getSetting, setSetting, parse } from './db.js';
import { sessionMiddleware, authRouter, adminUsersRouter, requireAuth, requireAdmin } from './auth.js';
import { pagesRouter } from './pages.js';
import { filesRouter, serveFile } from './files.js';
import { createBackup, listBackups, backupPath, startScheduler } from './backup.js';
import { driveRouter, driveCallback, uploadBackupToDrive, hasDrive } from './drive.js';
import { startNotionImport, jobs } from './import-notion.js';
import { startZipImport } from './import-zip.js';
import { localizeRemoteIcons } from './icons-local.js';
import { RELEASES } from './releases.js';
import { startJobWorker } from './jobs.js';
import { schoolRouter } from './school-drive.js';
import { pdmRouter, pdmPushLogo, pdmSyncAtStart, readCredits, cleanCredits, pdmPushCredits } from './pdm.js';
import { pingRouter, activityRouter } from './activity.js';
import { gcalRouter, startGcalSweep } from './gcal.js';
import { pingRouter as latencyRouter, statusRouter, timingMiddleware } from './status.js';
import { piRouter } from './pi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});
const GZ = new Map();
/** Compression gzip des réponses texte (JSON, JS, CSS, HTML, SVG) : pages volumineuses et chargement initial bien plus rapides. */
app.use((req, res, next) => {
  if (!/gzip/.test(req.headers['accept-encoding'] || '') || req.path.startsWith('/files/') || /\/(files|export|backups)(\/|$)/.test(req.path)) return next();
  const chunks = [], end = res.end.bind(res);
  res.write = (c, enc, cb) => { if (c) chunks.push(Buffer.from(c, typeof enc === 'string' ? enc : undefined)); (typeof enc === 'function' ? enc : cb)?.(); return true; };
  res.end = (c, enc, cb) => {
    if (c && typeof c !== 'function') chunks.push(Buffer.from(c, typeof enc === 'string' ? enc : undefined));
    const body = Buffer.concat(chunks), type = String(res.getHeader('Content-Type') || '');
    if (body.length < 1024 || !/json|javascript|css|html|svg|^text\//.test(type) || res.getHeader('Content-Encoding') || res.statusCode === 304 || req.method === 'HEAD') return end(body, typeof enc === 'function' ? enc : cb);
    // fichiers statiques (JS/CSS/HTML) : la version compressée est gardée en mémoire tant que le fichier ne change pas (au lieu de recompresser à chaque requête)
    const etag = !req.path.startsWith('/api') && res.getHeader('ETag'), ck = etag && `${req.path}|${etag}`;
    let z = ck && GZ.get(ck);
    if (!z) { z = zlib.gzipSync(body, { level: ck ? 9 : 5 }); if (ck) { if (GZ.size >= 80) GZ.delete(GZ.keys().next().value); GZ.set(ck, z); } }
    res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('Content-Length', z.length);
    return end(z, typeof enc === 'function' ? enc : cb);
  };
  next();
});
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(timingMiddleware);
app.use('/api/ping', latencyRouter); // latence : sans authentification, sans corps
app.use(sessionMiddleware);
// Anti-CSRF : toute requête modifiante doit porter l'en-tête personnalisé (impossible en formulaire cross-site)
app.use('/api', (req, res, next) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.headers['x-dw'] ? next() : res.status(403).json({ error: 'En-tête X-DW manquant' }));
app.get('/files/:id', serveFile);
app.use('/api/files', filesRouter);
app.use('/api/drive', driveCallback);
app.use(express.json({ limit: '30mb' }));
app.use('/api/auth', authRouter);
app.use('/api/pages', pagesRouter);
app.use('/api/drive', driveRouter);
app.use('/api/school', schoolRouter);
app.use('/api/pdm', pdmRouter);
pdmSyncAtStart();
app.use('/api/gcal', gcalRouter);
app.use('/api/activity', pingRouter);
app.use('/api/admin/activity', activityRouter);
app.use('/api/admin/status', statusRouter);
app.use('/api/pi', piRouter);

// --- Réglages (personnalisation) ---
const PUBLIC_KEYS = ['site_name', 'accent', 'font', 'radius', 'custom_css', 'default_theme', 'content_width', 'divider_color', 'text_size', 'favicon', 'dev_mode'];
// version de Deepwell : une seule source, package.json
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
app.get('/api/settings', (_req, res) =>
  res.json({ ...Object.fromEntries(PUBLIC_KEYS.map((k) => [k, getSetting(k, '')])), version: APP_VERSION, alpha: !!RELEASES[0]?.alpha }));
app.put('/api/settings', requireAuth, requireAdmin, (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if ([...PUBLIC_KEYS, 'allow_signup', 'backup_enabled', 'backup_to_drive'].includes(k) && typeof v === 'string') setSetting(k, v.slice(0, 100_000));
  }
  if (req.body && ('favicon' in req.body || 'accent' in req.body)) pdmPushLogo(); // le fond de l'accueil de PDM suit l'icône choisie
  res.json({ ok: true });
});
// Notes de version : chargées à la demande par la page « Notes de version »
app.get('/api/releases', requireAuth, (_req, res) => res.json(RELEASES));
// Crédits (bouton de la page Notes de version) : lus par tous, modifiés par l'administrateur ; copiés vers PDM
app.get('/api/credits', requireAuth, (req, res) => res.json({ ...readCredits(), editable: req.user.role === 'admin' }));
app.put('/api/credits', requireAuth, requireAdmin, (req, res) => { const { out } = cleanCredits(req.body); pdmPushCredits(true); res.json({ ...out, editable: true }); });
app.get('/api/admin/settings', requireAuth, requireAdmin, (_req, res) =>
  res.json({ allow_signup: getSetting('allow_signup', '0'), backup_enabled: getSetting('backup_enabled', '1'), backup_to_drive: getSetting('backup_to_drive', '0') }));
app.use('/api/admin/users', requireAuth, requireAdmin, adminUsersRouter);

// --- Backups (admin) ---
app.get('/api/admin/backups', requireAuth, requireAdmin, (_req, res) => res.json(listBackups()));
app.post('/api/admin/backups', requireAuth, requireAdmin, async (_req, res) => res.json(await createBackup()));
app.get('/api/admin/backups/:name', requireAuth, requireAdmin, (req, res) => {
  const p = backupPath(req.params.name);
  p ? res.download(p) : res.status(404).json({ error: 'Introuvable' });
});
app.post('/api/admin/backups/:name/drive', requireAuth, requireAdmin, async (req, res) =>
  res.json(await uploadBackupToDrive(req.user.id, req.params.name)));

// Membres de l'espace (mentions @personne, partage)
app.get('/api/users', requireAuth, (_req, res) =>
  res.json(db.prepare('SELECT id,name,email FROM users ORDER BY name, email').all()));

// --- Export complet de ses données (JSON) ---
app.get('/api/export', requireAuth, (req, res) => {
  const pages = db.prepare('SELECT * FROM pages WHERE owner_id=?').all(req.user.id);
  const blocks = db.prepare('SELECT b.* FROM blocks b JOIN pages p ON p.id=b.page_id WHERE p.owner_id=?').all(req.user.id);
  res.set('Content-Disposition', 'attachment; filename="deepwell-export.json"');
  res.json({ version: 1, exported_at: Date.now(), pages: pages.map((p) => ({ ...p, props: parse(p.props, {}), schema: parse(p.schema), raw: parse(p.raw) })),
    blocks: blocks.map((b) => ({ ...b, content: parse(b.content, {}), raw: parse(b.raw) })) });
});

// --- Imports ---
app.post('/api/import/notion', requireAuth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Jeton d’intégration Notion requis' });
  const job = startNotionImport(req.user.id, token, { overwrite: req.body?.overwrite === true });
  res.json({ id: job.id });
});
app.post('/api/import/zip', requireAuth, express.raw({ type: () => true, limit: `${process.env.MAX_UPLOAD_MB || 500}mb` }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ZIP manquant' });
  res.json({ id: startZipImport(req.user.id, req.body).id });
});
app.get('/api/import/:id', requireAuth, (req, res) => {
  const j = jobs.get(req.params.id);
  j ? res.json({ id: j.id, status: j.status, error: j.error, counts: j.counts, progress: j.progress, missing: j.missing, log: j.log.slice(-40) }) : res.status(404).json({ error: 'Import inconnu' });
});

app.use('/icons', express.static(path.join(here, '..', 'public', 'icons'), { maxAge: '7d' })); // icônes : cache long
app.use("/fonts", express.static(path.join(here, "..", "public", "fonts"), { maxAge: "30d" })); // police d emojis : cache long
app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'] }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.use((err, _req, res, _next) => {
  if (err.status !== 400 && err.status !== 409 || !err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : err.message || 'Erreur serveur' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  startScheduler(async (b) => {
    // envoi automatique vers Drive si un admin l'a connecté et activé
    if (getSetting('backup_to_drive', '0') !== '1') return;
    const admin = db.prepare("SELECT id FROM users WHERE role='admin'").all().find((u) => hasDrive(u.id));
    if (admin) await uploadBackupToDrive(admin.id, b.name);
  });
  startJobWorker();
  startGcalSweep();
  localizeRemoteIcons().then((n) => n && console.log(`Icônes Notion rapatriées : ${n}`)).catch(() => {});
  app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Deepwell : http://localhost:${port}`));
}
