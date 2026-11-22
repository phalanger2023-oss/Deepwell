import { db } from './db.js';

const RANK = { view: 1, comment: 2, edit: 3, owner: 4 };
const NAMES = ['', 'view', 'comment', 'edit', 'owner'];

/**
 * Droit effectif d'un utilisateur (ou d'un jeton de lien public) sur une page.
 * Les droits sont hérités : un partage sur un parent s'applique aux sous-pages.
 */
const getPage = db.prepare('SELECT id,parent_id,owner_id FROM pages WHERE id=?'); // préparées une seule fois (chemin très fréquent)
const userShare = db.prepare('SELECT role FROM shares WHERE page_id=? AND user_id=?');
const tokenShare = db.prepare('SELECT role FROM shares WHERE page_id=? AND public_token=?');
const parentOf = db.prepare('SELECT parent_id FROM pages WHERE id=?');
export function accessFor(user, pageId, token) {
  let best = 0, id = pageId, guard = 0;
  while (id && guard++ < 500) {
    const p = getPage.get(id);
    if (!p) return null;
    if (user && p.owner_id === user.id) return 'owner';
    if (user) { const s = userShare.get(id, user.id); if (s) best = Math.max(best, RANK[s.role] || 0); }
    if (token) { const s = tokenShare.get(id, token); if (s) best = Math.max(best, RANK[s.role] || 0); }
    id = p.parent_id;
  }
  return NAMES[best] || null;
}

export const can = (role, need) => !!role && RANK[role] >= RANK[need];

export function isDescendant(pageId, ancestorId) {
  let id = pageId, guard = 0;
  while (id && guard++ < 500) {
    if (id === ancestorId) return true;
    id = parentOf.get(id)?.parent_id;
  }
  return false;
}
