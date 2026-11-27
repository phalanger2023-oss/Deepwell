/**
 * Localisation estimée d'une adresse IP, 100 % hors ligne (base geoip-lite embarquée : aucune donnée ne quitte le serveur).
 * C'est une estimation : précise au niveau du pays, souvent de la région, parfois de la ville (la position de l'opérateur, pas de la personne).
 */
import geoip from 'geoip-lite';

let names; try { names = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { names = null; }
const cache = new Map();

const normalize = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '');
const isPrivate = (ip) => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip) || ip === 'localhost';

/** { label, country, region, city, ll } — label vide si inconnue. */
export function locate(rawIp) {
  const ip = normalize(rawIp);
  if (!ip) return { label: '' };
  if (cache.has(ip)) return cache.get(ip);
  let out;
  if (isPrivate(ip)) out = { label: 'Réseau local', local: true };
  else {
    let g = null; try { g = geoip.lookup(ip); } catch { /* adresse invalide */ }
    if (!g) out = { label: '' };
    else {
      const country = g.country ? (names?.of(g.country) || g.country) : '';
      const parts = [g.city, g.region && g.region !== g.city ? g.region : '', country].filter(Boolean);
      out = { label: parts.join(', '), country: g.country || '', region: g.region || '', city: g.city || '', ll: g.ll || null };
    }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(ip, out);
  return out;
}
export const geoLabel = (ip) => locate(ip).label;
