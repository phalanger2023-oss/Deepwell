/**
 * Export « écrit » d'une page en Markdown : texte seul, compact (pas de style, pas de lignes vides en trop), lisible partout.
 * Sert au petit fichier .md déposé dans le dossier de chaque addendum sur Drive.
 */
const rt = (arr) => (Array.isArray(arr) ? arr : []).map((r) => {
  let t = r.plain_text ?? r.text?.content ?? '';
  if (!t.trim()) return t;
  const a = r.annotations || {};
  if (a.code) t = `\`${t}\``;
  if (a.bold) t = `**${t}**`;
  if (a.italic) t = `*${t}*`;
  if (a.strikethrough) t = `~~${t}~~`;
  const href = r.href || r.text?.link?.url;
  return href && r.type !== 'mention' ? `[${t}](${href})` : t;
}).join('');

export function blocksToMarkdown(title, blocks) {
  const kids = new Map();
  for (const b of blocks) { const k = b.parent_id || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(b); }
  const out = [];
  const walk = (parent, depth) => {
    let num = 0;
    for (const b of kids.get(parent) || []) {
      const c = typeof b.content === 'string' ? JSON.parse(b.content || '{}') : b.content || {}, ind = '  '.repeat(depth), t = rt(c.rich_text);
      num = b.type === 'numbered_list_item' ? num + 1 : 0;
      switch (b.type) {
        case 'heading_1': out.push('', `# ${t}`); break;
        case 'heading_2': out.push('', `## ${t}`); break;
        case 'heading_3': out.push('', `### ${t}`); break;
        case 'bulleted_list_item': out.push(`${ind}- ${t}`); break;
        case 'numbered_list_item': out.push(`${ind}${num}. ${t}`); break;
        case 'to_do': out.push(`${ind}- [${c.checked ? 'x' : ' '}] ${t}`); break;
        case 'toggle': out.push(`${ind}- **${t}**`); break;
        case 'quote': case 'callout': if (t) out.push('', `> ${t}`); break;
        case 'code': out.push('', '```', rt(c.rich_text), '```'); break;
        case 'divider': out.push('', '---'); break;
        case 'equation': out.push('', `$$ ${c.expression || ''} $$`); break;
        case 'table_row': out.push(`| ${(c.cells || []).map((x) => rt(x).replace(/\|/g, '\\|')).join(' | ')} |`); break;
        case 'bookmark': case 'embed': case 'link_preview': case 'drive_file': case 'image': case 'file': case 'pdf': case 'video': case 'audio': {
          const u = c.url || c.external?.url || c.file?.url || ''; if (u) out.push(`[${rt(c.caption) || c.name || 'Lien'}](${u})`); break;
        }
        case 'child_page': if (c.title) out.push(`- ${c.title}`); break;
        default: if (t) out.push(t);
      }
      walk(b.id, b.type === 'table' || b.type === 'column_list' || b.type === 'column' ? depth : depth + 1);
    }
  };
  walk('', 0);
  return `# ${String(title || 'Sans titre').trim()}\n\n${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`.replace(/\n+$/, '\n');
}
