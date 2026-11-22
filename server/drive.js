/**
 * Intégration Google Drive « basique » (OAuth 2.0, sans SDK) :
 *  - connecter un compte Google par utilisateur ;
 *  - parcourir/rechercher ses fichiers Drive et les insérer comme bloc dans une page ;
 *  - envoyer les sauvegardes vers un dossier Drive.
 * Configuration : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_URL (voir README).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import express from 'express';
import { db, secretKey } from './db.js';
import { requireAuth } from './auth.js';
import { backupPath } from './backup.js';

export const CAL_SCOPES = ['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events']; // agenda dédié « DeepWell » + événements de l'agenda principal
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file', ...CAL_SCOPES, 'openid', 'email'];
const cfg = () => ({
  id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET,
  redirect: `${(process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '')}/api/drive/callback`,
});
export const driveConfigured = () => !!(cfg().id && cfg().secret);

// Jetons chiffrés (AES-256-GCM) avec la clé locale data/secret.key, absente des sauvegardes de la base.
export const enc = (txt) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const d = Buffer.concat([c.update(txt, 'utf8'), c.final()]); return [iv, c.getAuthTag(), d].map((b) => b.toString('base64')).join('.'); };
export const dec = (s) => { const [iv, tag, d] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const c = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv); c.setAuthTag(tag); return Buffer.concat([c.update(d), c.final()]).toString('utf8'); };

const states = new Map(); // state -> {userId, exp}

export async function accessToken(userId) {
  const row = db.prepare('SELECT refresh_token FROM drive_tokens WHERE user_id=?').get(userId);
  if (!row) throw Object.assign(new Error('Google Drive non connecté'), { status: 400 });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg().id, client_secret: cfg().secret, refresh_token: dec(row.refresh_token), grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(`Google : ${j.error_description || j.error}`), { status: 502 });
  return j.access_token;
}

export const driveRouter = express.Router();
export const driveCallback = express.Router();

try { db.exec('ALTER TABLE drive_tokens ADD COLUMN scope TEXT'); } catch { /* colonne déjà là */ }
/** Le compte relié a-t-il autorisé Google Agenda ? (les anciennes connexions, faites avant, doivent être refaites une fois) */
export const hasCalendarScope = (userId) => { const t = db.prepare('SELECT scope FROM drive_tokens WHERE user_id=?').get(userId); return !!t?.scope && CAL_SCOPES.every((c) => t.scope.includes(c)); };

driveRouter.get('/status', requireAuth, (req, res) => {
  const t = db.prepare('SELECT email FROM drive_tokens WHERE user_id=?').get(req.user.id);
  res.json({ configured: driveConfigured(), connected: !!t, email: t?.email || null, calendar: !!t && hasCalendarScope(req.user.id), redirect: cfg().redirect });
});

driveRouter.post('/connect', requireAuth, (req, res) => {
  if (!driveConfigured()) return res.status(400).json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET non configurés sur le serveur' });
  const state = crypto.randomBytes(16).toString('base64url');
  states.set(state, { userId: req.user.id, exp: Date.now() + 10 * 60 * 1000 });
  const q = new URLSearchParams({ client_id: cfg().id, redirect_uri: cfg().redirect, response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: SCOPES.join(' '), state });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
});

driveRouter.post('/disconnect', requireAuth, (req, res) => {
  db.prepare('DELETE FROM drive_tokens WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

driveRouter.get('/files', requireAuth, async (req, res) => {
  const token = await accessToken(req.user.id);
  const q = String(req.query.q || '').replace(/['\\]/g, '');
  const params = new URLSearchParams({
    pageSize: '30', orderBy: 'modifiedTime desc', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    fields: 'nextPageToken,files(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime)',
    q: `trashed=false${q ? ` and name contains '${q}'` : ''}`,
  });
  if (req.query.pageToken) params.set('pageToken', String(req.query.pageToken));
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) return res.status(502).json({ error: j.error?.message || 'Erreur Drive' });
  res.json(j);
});

/** Envoie une sauvegarde vers un dossier « Deepwell Backups » du Drive de l'utilisateur. */
export async function uploadBackupToDrive(userId, name) {
  const p = backupPath(name);
  if (!p) throw Object.assign(new Error('Sauvegarde introuvable'), { status: 404 });
  const token = await accessToken(userId), H = { Authorization: `Bearer ${token}` };
  const find = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name='Deepwell Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id)`, { headers: H })).json();
  let folder = find.files?.[0]?.id;
  if (!folder) {
    folder = (await (await fetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Deepwell Backups', mimeType: 'application/vnd.google-apps.folder' }) })).json()).id;
  }
  const boundary = `dw${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
    fs.readFileSync(p), Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: { ...H, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Échec de l’envoi vers Drive');
  return j;
}
export const hasDrive = (userId) => !!db.prepare('SELECT 1 FROM drive_tokens WHERE user_id=?').get(userId);

driveCallback.get('/callback', async (req, res) => {
  const st = states.get(String(req.query.state));
  states.delete(String(req.query.state));
  if (!st || st.exp < Date.now() || !req.query.code) return res.status(400).send('Connexion Google invalide ou expirée.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(req.query.code), client_id: cfg().id, client_secret: cfg().secret, redirect_uri: cfg().redirect, grant_type: 'authorization_code' }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) return res.status(400).send(`Google : ${j.error_description || 'aucun refresh_token reçu'}`);
  let email = null;
  try { email = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString()).email; } catch {}
  db.prepare('INSERT INTO drive_tokens(user_id,refresh_token,email,scope) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET refresh_token=excluded.refresh_token,email=excluded.email,scope=excluded.scope')
    .run(st.userId, enc(j.refresh_token), email, String(j.scope || ''));
  res.redirect('/#/settings');
});
