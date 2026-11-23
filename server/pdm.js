/**
 * Liaison avec PDM (l'éditeur de PDF) : DeepWell y dépose, de serveur à serveur, le document de référence de chaque cours
 * (dossiers année / matière / chapitre). PDM donne une clé secrète (sur son accueil, « Lier à DeepWell ») ; elle est recopiée ici
 * par l'administrateur et conservée chiffrée (clé locale data/secret.key, comme les jetons Google).
 */
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
export async function pdmUpload(cfg, { buffer, filename, folder, source }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
  form.append('folder', folder); form.append('source', source);
  return call(cfg, '/api/integration/docs', { method: 'POST', body: form });
}

/** Envoie à PDM le logo choisi dans les réglages (fond de son accueil). Sans icône choisie, PDM revient à son logo de base. Jamais bloquant. */
export async function pdmPushLogo() {
  const cfg = pdmConfig(); if (!cfg) return false;
  try {
    const svg = await siteLogoSvg();
    await call(cfg, '/api/integration/logo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ svg: svg || '' }) });
    return true;
  } catch (e) { console.warn('[pdm] logo non envoyé :', e.message); return false; }
}

export const pdmRouter = express.Router();
pdmRouter.get('/config', requireAuth, (req, res) => { const c = pdmConfig(); res.json({ configured: !!c, url: c?.url || clean(getSetting('pdm_url', '')), admin: req.user.role === 'admin' }); });
pdmRouter.put('/config', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const url = clean(req.body?.url), key = String(req.body?.key || '').trim() || pdmConfig()?.key;
    if (!/^https?:\/\/[^\s/]+/i.test(url)) throw err('Adresse de PDM invalide (ex. https://pdm.louisharicuisine.com).');
    if (!key) throw err('Colle la clé affichée par PDM (accueil → « Lier à DeepWell »).');
    await pdmPing({ url, key }); // on ne garde rien si PDM ne répond pas ou refuse la clé
    setSetting('pdm_url', url); setSetting('pdm_key', enc(key));
    pdmPushLogo();
    res.json({ configured: true, url });
  } catch (e) { next(e); }
});
pdmRouter.post('/logo', requireAuth, requireAdmin, async (_req, res) => res.json({ sent: await pdmPushLogo() }));
pdmRouter.delete('/config', requireAuth, requireAdmin, (_req, res) => { setSetting('pdm_url', ''); setSetting('pdm_key', ''); res.json({ configured: false }); });
pdmRouter.use((e, _req, res, _next) => res.status(e.status || 500).json({ error: e.message || 'Erreur' }));
