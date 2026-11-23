/**
 * Logo du site (l'icône choisie dans Réglages → Apparence) sous forme d'image SVG autonome, pour PDM :
 * emoji, icône vectorielle (même rendu que l'onglet du navigateur) ou image envoyée / en ligne (intégrée en base64).
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, UPLOAD_DIR } from './db.js';

const COLORS = { gray: '#9b9a97', brown: '#9f6b53', orange: '#d9730d', yellow: '#cb912f', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${inner}</svg>`;
const ICONS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'icons');

async function imageData(url) {
  const m = /^\/files\/([0-9a-f-]{36})$/.exec(url);
  if (m) {
    const f = db.prepare('SELECT mime FROM files WHERE id=?').get(m[1]);
    const p = path.join(UPLOAD_DIR, m[1]);
    if (!f || !fs.existsSync(p)) return null;
    return { mime: f.mime, buf: fs.readFileSync(p) };
  }
  if (/^https?:\/\//i.test(url)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 3_000_000 ? null : { mime: (r.headers.get('content-type') || 'image/png').split(';')[0], buf };
  }
  return null;
}

/** Le SVG du logo choisi, ou null si aucune icône n'est définie (PDM garde alors son logo de base). */
export async function siteLogoSvg() {
  const icon = String(getSetting('favicon', '') || '').trim();
  if (!icon) return null;
  const v = /^lucide:([a-z0-9-]+)(?::([a-z]+|#[0-9a-f]{3,8}))?$/i.exec(icon);
  if (v) {
    const file = path.join(ICONS_DIR, `${v[1]}.svg`);
    if (!fs.existsSync(file)) return null;
    const inner = (fs.readFileSync(file, 'utf8').match(/<svg[^>]*>([\s\S]*?)<\/svg>/) || [])[1] || '';
    const accent = /^#[0-9a-f]{6}$/i.test(getSetting('accent', '')) ? getSetting('accent', '') : '#2383e2';
    const color = COLORS[v[2]] || (/^#[0-9a-f]{3,8}$/i.test(v[2] || '') ? v[2] : accent);
    return wrap(`<rect width="32" height="32" rx="7" fill="${color}"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`);
  }
  if (/^(\/|https?:)/.test(icon)) {
    const img = await imageData(icon).catch(() => null);
    if (!img || !/^image\/[a-z0-9.+-]+$/i.test(img.mime)) return null; // intégrée comme image (un SVG ainsi inclus ne peut exécuter aucun script)
    return wrap(`<image width="32" height="32" preserveAspectRatio="xMidYMid meet" href="data:${img.mime};base64,${img.buf.toString('base64')}"/>`);
  }
  return wrap(`<text x="16" y="25" font-size="25" text-anchor="middle">${esc(icon)}</text>`);
}
