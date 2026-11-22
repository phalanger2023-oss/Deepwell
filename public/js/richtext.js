/** Conversion entre le « rich_text » (format Notion, conservé tel quel) et le HTML éditable. */
import { esc, safeUrl } from './util.js';
import { formatDate, prettify } from './dates.js';

const DEF = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
const itemOf = (content, st) => ({
  type: 'text', text: { content, link: st.href ? { url: st.href } : null },
  annotations: { bold: !!st.bold, italic: !!st.italic, strikethrough: !!st.strikethrough, underline: !!st.underline, code: !!st.code, color: st.color || 'default', ...(st.font && st.font !== 'default' ? { font: st.font } : {}) },
  plain_text: content, href: st.href || null,
});

export const rtPlain = (rt) => (rt || []).map((r) => r.plain_text ?? r.text?.content ?? '').join('');
export const plainRt = (text) => (text ? [itemOf(text, {})] : []);

export function atomLabel(r) {
  if (r.type === 'equation') return r.equation?.expression || r.plain_text || '';
  if (r.type === 'mention') {
    const m = r.mention || {};
    if (m.type === 'user') return `@${r.plain_text || m.user?.name || 'utilisateur'}`;
    if (m.type === 'date') return `${m.date ? formatDate(m.date) : r.plain_text || ''}`; // affichée dans TON fuseau horaire
    if (m.type === 'user') return `@${r.plain_text || m.user?.name || 'utilisateur'}`;
    return prettify(r.plain_text) || m[m.type]?.url || '…';
  }
  return r.plain_text || '';
}

export function rtToHtml(rt) {
  let out = '';
  for (const r of rt || []) {
    const a = { ...DEF, ...(r.annotations || {}) };
    const data = esc(JSON.stringify(r));
    if (r.type !== 'text') {
      const pageId = r.type === 'mention' && r.mention?.type === 'page' ? r.mention.page?.id : null;
      const href = pageId ? `/#/page/${pageId}` : safeUrl(r.href);
      const kind = r.type === 'mention' ? r.mention?.type : r.type;
      const cls = `atom atom-${esc(kind || 'x')}${r.type === 'equation' ? ' eq' : ''}`;
      out += href
        ? `<a class="${cls}" href="${esc(href)}" contenteditable="false" data-rt="${data}"${pageId ? ` data-page="${esc(pageId)}"` : ''}>${pageId ? `<span class="vicon" aria-hidden="true" style="--m:url(/icons/file-text.svg);--s:16px"></span> ${esc(prettify(atomLabel(r)))}` : esc(atomLabel(r))}</a>`
        : `<span class="${cls}" contenteditable="false" data-rt="${data}"${kind === 'date' && r.mention?.date ? ` title="${esc(formatDate(r.mention.date, { withTz: true }))}"` : ''}>${esc(atomLabel(r))}</span>`;
      continue;
    }
    let s = esc(r.text?.content ?? r.plain_text ?? '').replace(/\n/g, '<br>');
    if (a.code) s = `<code>${s}</code>`;
    if (a.bold) s = `<b>${s}</b>`;
    if (a.italic) s = `<i>${s}</i>`;
    if (a.underline) s = `<u>${s}</u>`;
    if (a.strikethrough) s = `<s>${s}</s>`;
    if (a.font && a.font !== 'default') s = `<span data-f="${esc(a.font)}" class="f-${esc(String(a.font).replace(/[^a-z]/g, ''))}">${s}</span>`;
    if (a.color && a.color !== 'default') s = `<span data-c="${esc(a.color)}" class="${esc(colorClass(a.color))}">${s}</span>`;
    const href = safeUrl(r.text?.link?.url || r.href);
    if (href) s = `<a href="${esc(href)}" ${/^https?:/.test(href) ? 'target="_blank" rel="noopener noreferrer"' : ''}>${s}</a>`;
    out += s;
  }
  return out;
}

export const colorClass = (c) => (!c || c === 'default' ? '' : c.endsWith('_background') ? `bg-${c.replace('_background', '')}` : `c-${c}`);

export function htmlToRt(root) {
  const out = [];
  const push = (text, st) => {
    if (!text) return;
    const last = out[out.length - 1];
    const a = itemOf('', st);
    if (last && last.type === 'text' && last.href === a.href && JSON.stringify(last.annotations) === JSON.stringify(a.annotations)) {
      last.text.content += text; last.plain_text += text;
    } else out.push(itemOf(text, st));
  };
  const walk = (node, st) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) push(n.nodeValue.replace(/​/g, ''), st);
      else if (n.nodeType === 1) {
        if (n.dataset?.rt) { try { out.push(JSON.parse(n.dataset.rt)); } catch { push(n.textContent, st); } continue; }
        const tag = n.tagName, s = { ...st };
        if (tag === 'BR') { if (n !== root.lastChild) push('\n', st); continue; } // le <br> final est le marqueur de ligne vide du navigateur
        if (tag === 'B' || tag === 'STRONG') s.bold = true;
        if (tag === 'I' || tag === 'EM') s.italic = true;
        if (tag === 'U') s.underline = true;
        if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.strikethrough = true;
        if (tag === 'CODE') s.code = true;
        if (tag === 'A') s.href = safeUrl(n.getAttribute('href')) || null;
        if (n.dataset?.c) s.color = n.dataset.c;
        if (n.dataset?.f) s.font = n.dataset.f;
        if (n.style?.fontWeight === 'bold' || Number(n.style?.fontWeight) >= 600) s.bold = true;
        if (n.style?.fontStyle === 'italic') s.italic = true;
        if ((tag === 'DIV' || tag === 'P') && out.length) push('\n', st);
        walk(n, s);
      }
    }
  };
  walk(root, { ...DEF });
  return out;
}

/**
 * Titre de ligne (cartes, listes, tableau…) avec ses mentions : dates lisibles, mentions de pages/personnes en « @ » grisé comme dans le texte.
 * Rend des <span> seulement (la ligne entière est déjà un lien). Renvoie null s'il n'y a aucune mention (le titre texte suffit).
 */
export function richTitleNodes(rt) {
  if (!(rt || []).some((r) => r.type === 'mention')) return null;
  return rt.map((r) => {
    if (r.type !== 'mention') return document.createTextNode(prettify(r.plain_text ?? r.text?.content ?? ''));
    const kind = r.mention?.type || 'x', el = document.createElement('span');
    el.className = `atom atom-${kind}`; el.textContent = kind === 'page' ? prettify(atomLabel(r)) : atomLabel(r);
    return el;
  });
}
