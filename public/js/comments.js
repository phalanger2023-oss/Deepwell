/**
 * Commentaires de page et de bloc : panneau latéral avec fils de discussion, réponses, résolution.
 * Droits : lecture pour tous ceux qui voient la page ; écrire/résoudre pour les rôles « commentaire », « édition » et propriétaire.
 */
import { h, toast, confirmBox } from './util.js';
import { api } from './api.js';
import { vi } from './icons.js';
import { formatDate } from './dates.js';

/** Nombre de fils ouverts par bloc : { blockId: n }. */
export function openThreadsByBlock(list) {
  const out = {};
  for (const c of list) if (!c.parent_id && c.block_id && !c.resolved) out[c.block_id] = (out[c.block_id] || 0) + 1;
  return out;
}
export const openThreadCount = (list) => list.filter((c) => !c.parent_id && !c.resolved).length;

/**
 * Ouvre (ou ferme) le panneau. Retourne { close, refresh }.
 * ctx : { page, role, me, list, reload(): Promise, onChange(list), goToBlock(id), target?: { block_id, quote, label } }
 */
export function openComments(ctx) {
  document.querySelector('.comments-drawer')?.remove();
  const canWrite = ['comment', 'edit', 'owner'].includes(ctx.role);
  let showResolved = false, target = ctx.target || null;
  const drawer = h('aside', { class: 'comments-drawer', role: 'complementary', 'aria-label': 'Commentaires' });
  const close = () => { drawer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('textarea')) close(); };
  document.addEventListener('keydown', onKey);

  const act = async (fn, okMsg) => { try { await fn(); await ctx.reload(); draw(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, 'error'); } };

  // mode développeur (Réglages) : la date d'ajout d'origine devient modifiable par l'auteur ou le propriétaire
  function dateSpan(c, mine) {
    const span = h('span', { class: 'muted small' }, formatDate({ start: new Date(c.created_at).toISOString() }));
    if (!ctx.devMode || !(mine || ctx.role === 'owner')) return span;
    const pad = (n) => String(n).padStart(2, '0'), d = new Date(c.created_at);
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return h('button', { class: 'cm-date-edit', title: 'Mode développeur : modifier la date d’ajout', onclick: (e) => {
      const inp = h('input', { type: 'datetime-local', class: 'input small', value: local });
      const ok = h('button', { class: 'btn small primary', onclick: () => act(() => api.patch(`/api/pages/${ctx.page.id}/comments/${c.id}`, { created_at: new Date(inp.value).getTime() }), 'Date modifiée') }, 'OK');
      e.currentTarget.replaceWith(h('span', { class: 'cm-date-form' }, inp, ok));
    } }, span.textContent);
  }

  function message(c, isRoot) {
    const mine = c.author_id === ctx.me?.id, canDelete = mine || ctx.role === 'owner';
    return h('div', { class: 'cm-msg' },
      h('span', { class: 'cm-avatar' }, (c.author || '?')[0].toUpperCase()),
      h('div', { class: 'cm-main' },
        h('div', { class: 'cm-meta' }, h('b', {}, c.author || 'Inconnu'), dateSpan(c, mine), c.imported ? h('span', { class: 'cm-tag' }, 'Notion') : null,
          canDelete ? h('button', { class: 'icon-btn cm-del', title: isRoot ? 'Supprimer le fil' : 'Supprimer', onclick: async () => { if (await confirmBox(isRoot ? 'Supprimer ce commentaire et toutes ses réponses ?' : 'Supprimer ce commentaire ?')) act(() => api.del(`/api/pages/${ctx.page.id}/comments/${c.id}`)); } }, vi('trash-2', 14)) : null),
        h('div', { class: 'cm-body' }, c.body)));
  }

  function thread(root) {
    const replies = ctx.list.filter((c) => c.parent_id === root.id);
    const box = h('div', { class: `cm-thread ${root.resolved ? 'resolved' : ''}` });
    if (root.quote || root.block_id) box.append(h('button', { class: 'cm-quote', title: 'Aller au bloc', onclick: () => ctx.goToBlock?.(root.block_id) }, vi('message-square-text', 14), h('span', {}, root.quote || 'Bloc de la page')));
    box.append(message(root, true), ...replies.map((r) => message(r, false)));
    if (canWrite) {
      const reply = h('textarea', { class: 'input cm-input', rows: 1, placeholder: 'Répondre…' });
      const send = () => { const body = reply.value.trim(); if (body) act(() => api.post(`/api/pages/${ctx.page.id}/comments`, { body, parent_id: root.id })); };
      reply.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
      box.append(h('div', { class: 'cm-reply' }, reply), h('div', { class: 'cm-actions' },
        h('button', { class: 'btn small', onclick: send }, 'Répondre')));
    }
    return box;
  }

  function draw() {
    const roots = ctx.list.filter((c) => !c.parent_id), open = roots.filter((c) => !c.resolved), done = roots.filter((c) => c.resolved);
    const shown = showResolved ? roots : open;
    const compose = canWrite ? (() => {
      const ta = h('textarea', { class: 'input cm-input', rows: 2, placeholder: target ? 'Votre commentaire sur ce bloc…' : 'Ajouter un commentaire à la page…' });
      const send = () => { const body = ta.value.trim(); if (!body) return; act(() => api.post(`/api/pages/${ctx.page.id}/comments`, { body, block_id: target?.block_id || null, quote: target?.quote || '', anchor: target?.anchor ?? null }).then(() => { target = null; })); };
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
      setTimeout(() => target && ta.focus(), 0);
      return h('div', { class: 'cm-compose' },
        target ? h('div', { class: 'cm-target' }, vi('message-square-text', 14), h('span', {}, target.quote || target.label || 'Bloc'), h('button', { class: 'icon-btn', title: 'Commenter la page entière', onclick: () => { target = null; draw(); } }, vi('x', 14))) : null,
        ta, h('div', { class: 'cm-actions' }, h('span', { class: 'muted small' }, 'Ctrl + Entrée pour envoyer'), h('span', { class: 'ip-spacer' }), h('button', { class: 'btn primary small', onclick: send }, 'Commenter')));
    })() : h('div', { class: 'muted small pad' }, 'Vous pouvez lire les commentaires. Pour en écrire, demandez le droit « Commentaire » au propriétaire.');
    drawer.replaceChildren(...[
      h('div', { class: 'cm-head' }, h('b', {}, 'Commentaires'), h('span', { class: 'muted small' }, `${open.length} ouvert${open.length > 1 ? 's' : ''}`), h('span', { class: 'ip-spacer' }), h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onclick: close }, vi('x', 16))),
      compose,
      h('div', { class: 'cm-list' }, shown.length ? shown.map(thread) : h('div', { class: 'muted pad' }, 'Aucun commentaire pour le moment.')),
      done.length ? h('label', { class: 'check cm-showres' }, h('input', { type: 'checkbox', checked: showResolved, onchange: (e) => { showResolved = e.target.checked; draw(); } }), `Afficher les ${done.length} fil${done.length > 1 ? 's' : ''} résolu${done.length > 1 ? 's' : ''}`) : null].filter(Boolean));
    ctx.onChange?.(ctx.list);
  }
  document.body.append(drawer);
  draw();
  return { close, refresh: draw };
}
