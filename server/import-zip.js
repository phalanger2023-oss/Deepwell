/**
 * Import d'un ZIP d'export Notion (« Markdown & CSV »).
 * Moins fidèle que l'import API (l'export Notion lui-même est lossy : types de propriétés,
 * vues, mentions, couleurs… sont perdus avant même d'arriver ici), mais ne nécessite aucun jeton.
 * Conserve : hiérarchie, texte riche, listes imbriquées, cases à cocher, toggles, callouts,
 * citations, code, tableaux, images/fichiers (rapatriés), bases CSV (colonnes typées par déduction).
 */
import path from 'node:path';
import AdmZip from 'adm-zip';
import { db, uid, now, tx, textOf } from './db.js';
import { saveFile } from './files.js';
import { jobs } from './import-notion.js';

const ID_RE = /\s([0-9a-f]{32})(?=\.[a-z0-9]+$|$)/i;
const cleanName = (n) => n.replace(/\.[a-z0-9]+$/i, '').replace(/\s[0-9a-f]{32}$/i, '').trim();
const idOf = (n) => (n.match(/\s([0-9a-f]{32})(?:\.[a-z0-9]+)?$/i) || [])[1]?.toLowerCase();
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', mp3: 'audio/mpeg' };

// ---------- texte riche ----------
const ann = (o = {}) => ({ bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...o });
const item = (text, a, href) => ({ type: 'text', text: { content: text, link: href ? { url: href } : null }, annotations: ann(a), plain_text: text, href: href || null });

export function inlineToRt(s, resolveHref = (h) => h, a = {}, href = null) {
  const out = [];
  while (s.length) {
    const pats = [
      ['code', /`([^`]+)`/], ['link', /\[([^\]]*)\]\(([^)\s]+)\)/], ['bold', /\*\*(.+?)\*\*|__(.+?)__/],
      ['strike', /~~(.+?)~~/], ['under', /<u>(.+?)<\/u>/], ['italic', /\*(?!\s)(.+?)\*|(?<![\w])_(?!\s)(.+?)_(?![\w])/],
    ];
    let best = null;
    for (const [k, re] of pats) { const m = re.exec(s); if (m && (!best || m.index < best.m.index)) best = { k, m }; }
    if (!best) { out.push(item(s, a, href)); break; }
    const { k, m } = best;
    if (m.index) out.push(item(s.slice(0, m.index), a, href));
    const inner = m[1] ?? m[2];
    if (k === 'code') out.push(item(inner, { ...a, code: true }, href));
    else if (k === 'link') out.push(...inlineToRt(inner || m[2], resolveHref, a, resolveHref(decodeURIComponent(m[2]))));
    else out.push(...inlineToRt(inner, resolveHref, { ...a, [{ bold: 'bold', strike: 'strikethrough', under: 'underline', italic: 'italic' }[k]]: true }, href));
    s = s.slice(m.index + m[0].length);
  }
  return out.filter((x) => x.text.content !== '');
}

// ---------- CSV ----------
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

function inferSchema(header, rows) {
  const schema = {};
  header.forEach((name, i) => {
    const vals = rows.map((r) => r[i] ?? '').filter((v) => v !== '');
    let type = 'rich_text';
    if (i === 0) type = 'title';
    else if (vals.length && vals.every((v) => /^-?\d+([.,]\d+)?$/.test(v))) type = 'number';
    else if (vals.length && vals.every((v) => /^(yes|no|true|false)$/i.test(v))) type = 'checkbox';
    else if (vals.length && vals.every((v) => /^https?:\/\//.test(v))) type = 'url';
    else if (vals.length && vals.every((v) => /^[^@\s]+@[^@\s]+$/.test(v))) type = 'email';
    else if (vals.length >= 4 && vals.every((v) => /^\w+ \d{1,2}, \d{4}|^\d{4}-\d{2}-\d{2}/.test(v))) type = 'date';
    else if (vals.length >= 4) {
      const set = new Set(vals);
      if (set.size <= 10 && vals.every((v) => !v.includes(','))) type = 'select';
      else if (vals.some((v) => v.includes(',')) && new Set(vals.flatMap((v) => v.split(/,\s*/))).size <= 25) type = 'multi_select';
    }
    const def = { id: i === 0 ? 'title' : `c${i}`, name, type, [type]: {} };
    if (type === 'select') def.select = { options: [...new Set(vals)].map((v) => ({ name: v, color: 'default' })) };
    if (type === 'multi_select') def.multi_select = { options: [...new Set(vals.flatMap((v) => v.split(/,\s*/)))].map((v) => ({ name: v, color: 'default' })) };
    schema[name] = def;
  });
  return schema;
}

function cellToProp(def, v) {
  const rt = (t) => (t ? [item(t, {})] : []);
  switch (def.type) {
    case 'title': return { type: 'title', title: rt(v) };
    case 'number': return { type: 'number', number: v === '' ? null : Number(v.replace(',', '.')) };
    case 'checkbox': return { type: 'checkbox', checkbox: /^(yes|true)$/i.test(v) };
    case 'url': return { type: 'url', url: v || null };
    case 'email': return { type: 'email', email: v || null };
    case 'date': { const d = v && new Date(v); return { type: 'date', date: d && !isNaN(d) ? { start: d.toISOString().slice(0, 10), end: null, time_zone: null } : null }; }
    case 'select': return { type: 'select', select: v ? { name: v, color: 'default' } : null };
    case 'multi_select': return { type: 'multi_select', multi_select: v ? v.split(/,\s*/).map((x) => ({ name: x, color: 'default' })) : [] };
    default: return { type: 'rich_text', rich_text: rt(v) };
  }
}

// ---------- Markdown -> blocs ----------
const mk = (type, content = {}, children = []) => ({ id: uid(), type, content, children });
const width = (l) => l.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
const EMOJI_ONLY = /^\p{Extended_Pictographic}[\p{Extended_Pictographic}️‍]*$/u;

export function mdToBlocks(md, ctx) {
  const rt = (s) => inlineToRt(s, ctx.resolveHref);
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const root = [], stack = [{ indent: -1, children: root }];
  const parentFor = (ind, push) => {
    while (stack.length > 1 && stack.at(-1).indent >= ind) stack.pop();
    const holder = stack.at(-1);
    return { holder, add: (b) => { holder.children.push(b); if (push) stack.push({ indent: ind, children: b.children }); } };
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const ind = width(raw), t = raw.trim();
    let m;
    if ((m = t.match(/^(```|~~~)\s*([\w+-]*)/))) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(m[1])) { buf.push(lines[i].slice(Math.min(ind, width(lines[i])))); i++; }
      parentFor(ind).add(mk('code', { rich_text: [item(buf.join('\n'), {})], language: m[2] || 'plain text', caption: [] }));
    } else if (t === '<details>' || t.startsWith('<details')) {
      let summary = '', inner = [], depth = 1; i++;
      while (i < lines.length && depth > 0) {
        const l = lines[i].trim();
        if (l.startsWith('<details')) depth++;
        if (l === '</details>') { depth--; if (!depth) break; }
        const sm = l.match(/^<summary>(.*?)<\/summary>$/);
        if (sm && !summary) summary = sm[1]; else inner.push(lines[i]);
        i++;
      }
      parentFor(ind).add(mk('toggle', { rich_text: rt(summary) }, mdToBlocks(inner.join('\n'), ctx)));
    } else if (t.startsWith('<aside>')) {
      const inner = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith('</aside>')) { inner.push(lines[i]); i++; }
      let icon = null; const first = inner.findIndex((l) => l.trim());
      if (first >= 0 && EMOJI_ONLY.test(inner[first].trim())) { icon = inner[first].trim(); inner.splice(first, 1); }
      const kids = mdToBlocks(inner.join('\n'), ctx);
      const head = kids[0]?.type === 'paragraph' ? kids.shift() : null;
      parentFor(ind).add(mk('callout', { rich_text: head?.content.rich_text || [], icon: { type: 'emoji', emoji: icon || '💡' }, color: 'gray_background' }, kids));
    } else if (/^---+$|^\*\*\*+$/.test(t)) parentFor(ind).add(mk('divider'));
    else if ((m = t.match(/^(#{1,6})\s+(.*)$/))) parentFor(ind).add(mk(`heading_${Math.min(3, m[1].length)}`, { rich_text: rt(m[2]), is_toggleable: false, color: 'default' }));
    else if ((m = t.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/))) { const p = parentFor(ind, true); p.add(mk('to_do', { rich_text: rt(m[2]), checked: m[1] !== ' ' })); }
    else if ((m = t.match(/^[-*+]\s+(.*)$/))) { const p = parentFor(ind, true); p.add(mk('bulleted_list_item', { rich_text: rt(m[1]) })); }
    else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { const p = parentFor(ind, true); p.add(mk('numbered_list_item', { rich_text: rt(m[1]) })); }
    else if (t.startsWith('>')) {
      const buf = [t.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) buf.push(lines[++i].trim().replace(/^>\s?/, ''));
      parentFor(ind).add(mk('quote', { rich_text: rt(buf.join('\n')) }));
    } else if (t.startsWith('|') && /^\|?[\s:-]+\|/.test((lines[i + 1] || '').trim())) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => rt(c.trim().replace(/\\\|/g, '|')));
      const rows = [cells(t)]; i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      parentFor(ind).add(mk('table', { table_width: rows[0].length, has_column_header: true, has_row_header: false },
        rows.map((r) => mk('table_row', { cells: r }))));
    } else if ((m = t.match(/^!\[([^\]]*)\]\(([^)]+)\)$/))) {
      const url = ctx.resolveFile(decodeURIComponent(m[2]));
      parentFor(ind).add(mk('image', { type: 'external', external: { url }, caption: m[1] ? rt(m[1]) : [] }));
    } else if ((m = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)) && ctx.hasFile(decodeURIComponent(m[2]))) {
      const url = ctx.resolveFile(decodeURIComponent(m[2]));
      parentFor(ind).add(mk('file', { type: 'external', external: { url }, name: m[1], caption: [] }));
    } else {
      const p = parentFor(ind);
      p.add(mk('paragraph', { rich_text: rt(t) }));
    }
  }
  return root;
}

function flatten(blocks, parent = null, out = []) {
  blocks.forEach((b, i) => { out.push({ id: b.id, parent_id: parent, type: b.type, content: b.content, position: i }); flatten(b.children || [], b.id, out); });
  return out;
}

// ---------- import ----------
function collectFiles(buf, files = new Map(), prefix = '') {
  const zip = new AdmZip(buf);
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = e.entryName.normalize('NFC');
    if (name.includes('..') || path.isAbsolute(name)) continue; // zip-slip
    if (/\.zip$/i.test(name)) collectFiles(e.getData(), files, prefix);
    else files.set(prefix + name, e.getData());
  }
  return files;
}

export function startZipImport(userId, buffer) {
  const job = { id: uid(), kind: 'zip', status: 'running', startedAt: now(), log: [], counts: { pages: 0, databases: 0, blocks: 0, files: 0, unsupported: 0, warnings: 0 } };
  jobs.set(job.id, job);
  setImmediate(() => {
    try { importZip(job, userId, buffer); job.status = 'done'; job.log.push('Import terminé.'); }
    catch (e) { job.status = 'error'; job.error = e.message; job.log.push(`Erreur : ${e.message}`); }
  });
  return job;
}

export function importZip(job, userId, buffer) {
  const files = collectFiles(buffer);
  if (!files.size) throw new Error('ZIP vide');
  const dec = (b) => b.toString('utf8');
  const pagesByDir = new Map();  // chemin sans extension -> {id, ...}
  const idByNotion = new Map();  // id32 -> id local
  const uploaded = new Map();
  const mdPaths = [...files.keys()].filter((p) => /\.md$/i.test(p)).sort();
  const csvPaths = [...files.keys()].filter((p) => /\.csv$/i.test(p) && !/_all\.csv$/i.test(p)).sort();

  const strip = (p) => p.replace(/\.[a-z0-9]+$/i, '');
  // 1. Création des identifiants (pages et bases) avant de traiter les liens
  const nodes = [];
  for (const p of mdPaths) nodes.push({ path: p, key: strip(p), kind: 'page' });
  for (const p of csvPaths) {
    const key = strip(p);
    const existing = nodes.find((n) => n.key === key);
    if (existing) { existing.kind = 'database'; existing.csv = p; } else nodes.push({ path: null, key, kind: 'database', csv: p });
  }
  // les parents (dossiers moins profonds) doivent être insérés avant leurs enfants (clé étrangère)
  nodes.sort((a, b) => a.key.split('/').length - b.key.split('/').length || a.key.localeCompare(b.key));
  for (const n of nodes) {
    n.id = uid(); n.title = cleanName(path.posix.basename(n.key)); n.nid = idOf(path.posix.basename(n.key));
    if (n.nid) idByNotion.set(n.nid, n.id);
    pagesByDir.set(n.key, n);
  }

  const ownerDir = (p) => path.posix.dirname(p);
  const resolveFile = (rel, from) => {
    const key = path.posix.normalize(path.posix.join(ownerDir(from), rel)).normalize('NFC');
    if (!files.has(key)) return rel;
    if (!uploaded.has(key)) {
      const ext = key.split('.').pop().toLowerCase();
      uploaded.set(key, saveFile(userId, path.posix.basename(key), MIME[ext], files.get(key)).url);
      job.counts.files++;
    }
    return uploaded.get(key);
  };
  const hasFile = (rel, from) => files.has(path.posix.normalize(path.posix.join(ownerDir(from), rel)).normalize('NFC'));

  tx(() => {
    const insPage = db.prepare(`INSERT INTO pages(id,parent_id,owner_id,kind,title,icon,props,schema,position,created_at,updated_at)
      VALUES(?,?,?,?,?,NULL,?,?,?,?,?)`);
    const insBlock = db.prepare(`INSERT INTO blocks(id,page_id,parent_id,type,content,text,position,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const t = now();
    const writeBlocks = (pageId, blocks) => {
      for (const b of flatten(blocks)) {
        insBlock.run(b.id, pageId, b.parent_id, b.type, JSON.stringify(b.content), textOf(b.content), b.position, t, t);
        job.counts.blocks++;
      }
    };
    const findParent = (n) => {
      const dir = ownerDir(n.key);
      return dir !== '.' ? pagesByDir.get(dir) || null : null;
    };
    let order = 0;
    const rowOf = new Map(); // key de page -> ligne de base à laquelle elle appartient (props déjà prêtes)

    // Bases : pages de base + lignes issues du CSV
    for (const n of nodes.filter((x) => x.kind === 'database')) {
      const rows = parseCsv(dec(files.get(n.csv)));
      const [header = [], ...data] = rows;
      const schema = header.length ? inferSchema(header, data) : { Name: { id: 'title', name: 'Name', type: 'title', title: {} } };
      n.schema = schema; n.header = header;
      n.rows = data.map((r) => ({ title: r[0] || '', props: Object.fromEntries(header.map((h, i) => [h, cellToProp(schema[h], r[i] ?? '')])) }));
    }

    for (const n of nodes) {
      const parent = findParent(n);
      const isDb = n.kind === 'database';
      let blocks = [];
      if (n.path) {
        const ctx = {
          resolveHref: (h) => {
            if (/^https?:|^mailto:|^#/.test(h)) return h;
            const id = idOf(h.split('#')[0]);
            return id && idByNotion.get(id) ? `/#/page/${idByNotion.get(id)}` : h;
          },
          resolveFile: (rel) => resolveFile(rel, n.path),
          hasFile: (rel) => hasFile(rel, n.path) && !/\.md$/i.test(rel),
        };
        let md = dec(files.get(n.path));
        const parentIsDb = parent?.kind === 'database';
        md = md.replace(/^﻿/, '').replace(/^#\s+.*\n+/, '');
        if (parentIsDb) md = md.replace(/^(?:[^\n:]{1,60}: [^\n]*\n)+\n?/, ''); // propriétés déjà prises du CSV
        blocks = mdToBlocks(md, ctx);
      }
      n.blocks = blocks;
    }

    for (const n of nodes) {
      const parent = findParent(n);
      const props = {}; let title = n.title;
      if (parent?.kind === 'database') {
        const row = parent.rows?.find((r) => r.title === n.title || r.title === title);
        if (row) { Object.assign(props, row.props); row.used = true; }
        else props[parent.header?.[0] || 'Name'] = { type: 'title', title: [item(title, {})] };
      }
      insPage.run(n.id, parent?.id || null, userId, n.kind, title, JSON.stringify(props), n.schema ? JSON.stringify(n.schema) : null, order++, t, t);
      job.counts[n.kind === 'database' ? 'databases' : 'pages']++;
      writeBlocks(n.id, n.blocks || []);
    }
    // Lignes de CSV sans fichier .md associé
    for (const n of nodes.filter((x) => x.kind === 'database')) {
      for (const row of n.rows || []) {
        if (row.used) continue;
        insPage.run(uid(), n.id, userId, 'page', row.title, JSON.stringify(row.props), null, order++, t, t);
        job.counts.pages++;
      }
    }
  });
  job.log.push(`Importé : ${job.counts.pages} pages, ${job.counts.databases} bases, ${job.counts.blocks} blocs, ${job.counts.files} fichiers.`);
}
