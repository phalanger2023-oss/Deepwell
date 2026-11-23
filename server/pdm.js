/**
 * Liaison avec PDM (l'éditeur de PDF) : DeepWell y dépose, de serveur à serveur, le document de référence de chaque cours
 * (dossiers année / matière / chapitre). PDM donne une clé secrète (sur son accueil, « Lier à DeepWell ») ; elle est recopiée ici
 * par l'administrateur et conservée chiffrée (clé locale data/secret.key, comme les jetons Google).
 */
import crypto from 'node:crypto';
import express from 'express';
import { getSetting, setSetting } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import { enc, dec } from './drive.js';
import { siteLogoSvg } from './site-logo.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

/** { url, key } si PDM est configuré, sinon null. */
export function pdmConfig() {
  const url = getSetting('pdm_url'), k = getSetting('pdm_key');
  if (!url || !k) return null;
  try { return { url: clean(url), key: dec(k) }; } catch { return null; }
}

/** Adresses utiles d'un document de PDM : l'éditeur (version annotée) et le PDF d'origine, vierge. */
export const pdmLinks = (cfg, name) => ({ name, url: `${cfg.url}/#/${encodeURIComponent(name)}`, original_url: `${cfg.url}/api/docs/${encodeURIComponent(name)}/pdf?dl=1` });

async function call(cfg, path, init = {}) {
  let r;
  try { r = await fetch(`${cfg.url}${path}`, { ...init, headers: { 'X-PDM-Key': cfg.key, ...(init.headers || {}) }, signal: AbortSignal.timeout(120_000) }); }
  catch (e) { throw err(`PDM injoignable (${e.cause?.code || e.message})`, 502); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(`PDM : ${j.error || r.status}`, r.status === 401 ? 401 : 502);
  return j;
}

export const pdmPing = (cfg) => call(cfg, '/api/integration/ping');

/** Dépose un PDF dans PDM. `source` évite les doublons si la demande est rejouée. Renvoie { name, folder, existing }. */
export async function pdmUpload(cfg, { buffer, filename, folder, source, user }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
  form.append('folder', folder); form.append('source', source);
  if (user) { form.append('user_id', user.id); form.append('user_role', user.role === 'admin' ? 'admin' : 'user'); } // le document va dans l'espace de cette personne dans PDM
  return call(cfg, '/api/integration/docs', { method: 'POST', body: form });
}

/** Envoie à PDM le logo choisi dans les réglages (fond de son accueil). Sans icône choisie, PDM revient à son logo de base. Jamais bloquant. */
export async function pdmPushLogo(force = true) {
  const cfg = pdmConfig(); if (!cfg) return false;
  try {
    const svg = (await siteLogoSvg()) || '';
    const fp = `${cfg.url}|${crypto.createHash('sha256').update(svg).digest('hex')}`;
    if (!force && getSetting('pdm_logo_sent', '') === fp) return true; // déjà chez PDM
    await call(cfg, '/api/integration/logo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ svg }) });
    setSetting('pdm_logo_sent', fp);
    return true;
  } catch (e) { console.warn('[pdm] logo non envoyé :', e.message); return false; }
}

/** Adresse publique de DeepWell (celle où PDM renvoie pour se connecter) : PUBLIC_URL si défini, sinon celle utilisée par l'administrateur. */
const publicUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

/** Apprend à PDM où se trouve DeepWell (connexion unique). Rien n'est envoyé si l'adresse n'a pas changé depuis le dernier envoi réussi. */
export async function pdmLink(req, force = false) {
  const cfg = pdmConfig(); if (!cfg) return false;
  const url = publicUrl(req);
  if (!force && getSetting('pdm_link_sent', '') === `${cfg.url}|${url}`) return true;
  try {
    await call(cfg, '/api/integration/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deepwell_url: url }) });
    setSetting('pdm_link_sent', `${cfg.url}|${url}`);
    return true;
  } catch (e) { console.warn('[pdm] liaison non envoyée :', e.message); return false; }
}

const b64u = (b) => Buffer.from(b).toString('base64url');
/** Jeton de connexion pour PDM : identité du compte, valable une minute, signé avec la clé d'intégration que PDM connaît aussi. */
export function pdmSsoToken(cfg, user) {
  const body = b64u(JSON.stringify({ uid: user.id, name: user.name || '', role: user.role, exp: Date.now() / 1000 + 60, jti: crypto.randomUUID() }));
  return `${body}.${b64u(crypto.createHmac('sha256', cfg.key).update(body).digest())}`;
}

export const pdmRouter = express.Router();
pdmRouter.get('/config', requireAuth, (req, res) => {
  if (req.user.role === 'admin') pdmLink(req).then(() => pdmPushLogo(false)); // on en profite pour dire à PDM où est DeepWell (une fois, puis à chaque changement d'adresse)
  const c = pdmConfig(); res.json({ configured: !!c, url: c?.url || clean(getSetting('pdm_url', '')), admin: req.user.role === 'admin' }); });
pdmRouter.put('/config', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const url = clean(req.body?.url), key = String(req.body?.key || '').trim() || pdmConfig()?.key;
    if (!/^https?:\/\/[^\s/]+/i.test(url)) throw err('Adresse de PDM invalide (ex. https://pdm.louisharicuisine.com).');
    if (!key) throw err('Colle la clé affichée par PDM (accueil → « Lier à DeepWell »).');
    await pdmPing({ url, key }); // on ne garde rien si PDM ne répond pas ou refuse la clé
    setSetting('pdm_url', url); setSetting('pdm_key', enc(key));
    pdmLink(req, true).then(() => pdmPushLogo());
    res.json({ configured: true, url });
  } catch (e) { next(e); }
});
pdmRouter.post('/sso', requireAuth, (req, res, next) => {
  try {
    const cfg = pdmConfig(); if (!cfg) throw err('PDM n’est pas relié à DeepWell.');
    const back = new URL(String(req.body?.return || ''));
    if (back.origin !== new URL(cfg.url).origin) throw err('Adresse de retour inconnue : ce n’est pas le PDM relié à DeepWell.');
    const next_ = back.pathname === '/' ? '/' : `${back.pathname}${back.search}`;
    res.json({ url: `${cfg.url}/sso/callback?token=${pdmSsoToken(cfg, req.user)}&next=${encodeURIComponent(next_)}` });
  } catch (e) { next(e instanceof TypeError ? err('Adresse de retour invalide.') : e); }
});
pdmRouter.post('/logo', requireAuth, requireAdmin, async (_req, res) => res.json({ sent: await pdmPushLogo() }));
pdmRouter.delete('/config', requireAuth, requireAdmin, (_req, res) => { setSetting('pdm_url', ''); setSetting('pdm_key', ''); res.json({ configured: false }); });
pdmRouter.use((e, _req, res, _next) => res.status(e.status || 500).json({ error: e.message || 'Erreur' }));

/** Au démarrage de DeepWell : PDM reçoit (ou reçoit de nouveau) l'icône du site, et l'adresse de DeepWell si PUBLIC_URL est défini. Sans bruit si tout est déjà à jour. */
export function pdmSyncAtStart() {
  setTimeout(async () => {
    if (!pdmConfig()) return;
    if (process.env.PUBLIC_URL) await pdmLink({ protocol: 'https', get: () => '' }).catch(() => {});
    await pdmPushLogo(false);
  }, 8000).unref();
}
