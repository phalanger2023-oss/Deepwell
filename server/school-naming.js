/**
 * Mode scolaire : noms automatiques.
 * - Fiche (support) : « P.S.A. #<n° de l'entrée dans la matière>-<année de début d'année scolaire>-<abréviation de la matière> », ex. « P.S.A. #0007-26-MTH ».
 * - Addendum : « Addendum [<n° du P.S.A.>/<n° de l'addendum>]-<année>-<abréviation> : », ex. « Addendum [0007/2]-26-MTH : Fiche outils » (le nom vient ensuite, à la main).
 * L'abréviation vient de `dw_school.abbrevs` (réglage de la base) ou, à défaut, des 3 premières consonnes de la matière (Mathématiques → MTH).
 */
import { db, parse, norm } from './db.js';
import { schoolContext, subjectOf } from './school-drive.js';

const pad = (n, w = 4) => String(n).padStart(w, '0');
const subjectKey = (dbPage) => Object.keys(parse(dbPage.schema, {}) || {}).find((k) => /^mati/.test(norm(k).trim()));

/** Abréviation d'une matière : réglage de la base, sinon les 3 premières consonnes (complétées par les voyelles s'il en manque). */
export function abbrevOf(cfg, subject) {
  const set = cfg?.abbrevs?.[subject]; if (typeof set === 'string' && set.trim()) return set.trim().toUpperCase().slice(0, 6);
  const m = /\(([A-Za-z0-9]{2,6})\)\s*$/.exec(subject); if (m) return m[1].toUpperCase(); // « Mathématiques (MTH) »
  const letters = norm(subject).replace(/[^a-z]/g, '').toUpperCase();
  const cons = letters.replace(/[AEIOUY]/g, '');
  return ((cons + letters.replace(/[^AEIOUY]/g, '')).slice(0, 3) || 'XXX').padEnd(3, 'X');
}
/** Année de début d'année scolaire (2 chiffres) : 1ʳᵉ année du titre de la base (« … (2026-2027) »), sinon selon la date (septembre → nouvelle année). */
export function schoolYear(dbPage, at = new Date()) {
  const m = /(20\d{2})/.exec(dbPage.title || '');
  const y = m ? Number(m[1]) : (at.getMonth() >= 8 ? at.getFullYear() : at.getFullYear() - 1);
  return pad(y % 100, 2);
}
const numOf = (title) => { const m = /#\s*0*(\d+)/.exec(title || ''); return m ? Number(m[1]) : null; };

/** Titre automatique d'une fiche : numéro = plus grand numéro déjà utilisé dans la même matière + 1. */
export function psaTitle(dbPage, cfg, row) {
  const subject = subjectOf(dbPage, row), key = subjectKey(dbPage);
  let max = 0;
  for (const r of db.prepare("SELECT id,title,props FROM pages WHERE parent_id=? AND archived=0 AND kind='page' AND id != ?").all(dbPage.id, row.id)) {
    if (subjectOf(dbPage, r) !== subject) continue;
    const n = numOf(r.title); if (n && n > max) max = n;
  }
  return { title: `P.S.A. #${pad(max + 1)}-${schoolYear(dbPage)}-${abbrevOf(cfg, subject)}`, subject, key };
}
/** Un titre « pas encore nommé » : vide, ou seulement le gabarit de matricule (« P.S.A. #00-26- »). Un matricule généré par DeepWell est aussi recalculé tant qu'on n'y a pas ajouté de nom (props.dw_autotitle). */
export const isUnnamedPsa = (t) => !String(t || '').trim() || /^\s*(?:P\.?\s?S\.?\s?A\.?\s*)?#\s*0*\s*-?\s*\d{0,2}\s*-?\s*$/.test(t);

/** Fiche d'une base scolaire dont la matière vient d'être choisie : le titre est rempli (ou recalculé) tant que la fiche n'a pas de nom propre. */
export function schoolAutoTitle(pageId) {
  const row = db.prepare('SELECT id,parent_id,kind,title,props FROM pages WHERE id=?').get(pageId);
  if (!row || row.kind !== 'page' || !row.parent_id) return null;
  const d = db.prepare('SELECT id,kind,title,props,schema FROM pages WHERE id=?').get(row.parent_id);
  const cfg = d?.kind === 'database' ? parse(d.props, {})?.dw_school : null;
  const props0 = parse(row.props, {}) || {};
  if (!cfg?.enabled || !(isUnnamedPsa(row.title) || (props0.dw_autotitle && props0.dw_autotitle === row.title))) return null;
  const key = subjectKey(d); if (!key || !parse(row.props, {})?.[key]?.[(parse(d.schema, {})[key] || {}).type]?.name) return null; // pas de matière : rien à calculer
  const { title } = psaTitle(d, cfg, row);
  if (title === row.title) return null;
  const tk = Object.keys(parse(d.schema, {}) || {}).find((k) => parse(d.schema, {})[k].type === 'title'), props = { ...props0, dw_autotitle: title };
  if (tk) props[tk] = { type: 'title', title: [{ type: 'text', text: { content: title, link: null }, plain_text: title, annotations: {}, href: null }] };
  db.prepare('UPDATE pages SET title=?, props=? WHERE id=?').run(title, JSON.stringify(props), pageId);
  return title;
}

/** Titre du prochain addendum d'une page du support : « Addendum #<n° P.S.A.>/<nn>-<année>-<abréviation> » (+ espace : le nom suit). */
export function addendumTitle(pageId) {
  const ctx = schoolContext(pageId); if (!ctx) return null;
  const psa = numOf(ctx.support.title) ?? 0, subject = subjectOf(ctx.db, ctx.support);
  const ids = db.prepare(`WITH RECURSIVE d(id,depth) AS (SELECT ?1,0 UNION ALL SELECT p.id,d.depth+1 FROM pages p JOIN d ON p.parent_id=d.id WHERE p.archived=0 AND p.kind != 'template' AND d.depth<8) SELECT id FROM d WHERE id != ?1`).all(ctx.support.id).map((r) => r.id);
  let max = 0;
  for (const id of ids) { const m = /^\s*Addendum\s*(?:#|\[)\s*\d+\s*\/\s*0*(\d+)/i.exec(db.prepare('SELECT title FROM pages WHERE id=?').get(id)?.title || ''); if (m && Number(m[1]) > max) max = Number(m[1]); }
  return `Addendum [${pad(psa)}/${max + 1}]-${schoolYear(ctx.db)}-${abbrevOf(ctx.cfg, subject)} : `; // ex. « Addendum [0001/1]-26-FR : Fiche outils »
}
