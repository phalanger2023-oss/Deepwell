import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-test-'));
process.env.DATA_DIR = dir;
process.env.NOTION_MIN_GAP_MS = '0';

const P1 = '11111111-1111-1111-1111-111111111111', P2 = '22222222-2222-2222-2222-222222222222';
const D1 = '33333333-3333-3333-3333-333333333333', R1 = '44444444-4444-4444-4444-444444444444';
const rt = (t, extra = {}) => ({ type: 'text', text: { content: t, link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, plain_text: t, href: null, ...extra });

let notionSrv, server, base, AdmZip;
const cookies = {};
async function api(who, method, url, body, headers = {}) {
  const raw = body instanceof Buffer;
  const r = await fetch(base + url, {
    method, redirect: 'manual',
    headers: { 'x-dw': '1', ...(raw ? {} : body ? { 'Content-Type': 'application/json' } : {}), ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set) cookies[who] = set.split(';')[0];
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

before(async () => {
  const mockPages = {
    [P1]: { object: 'page', id: P1, created_time: '2024-01-01T00:00:00Z', last_edited_time: '2024-01-02T00:00:00Z', archived: false, icon: { type: 'emoji', emoji: '🚀' }, cover: null, parent: { type: 'workspace', workspace: true }, properties: { title: { id: 'title', type: 'title', title: [rt('Racine')] } } },
    [P2]: { object: 'page', id: P2, created_time: '2024-01-01T00:00:00Z', last_edited_time: '2024-01-02T00:00:00Z', archived: false, icon: null, cover: null, parent: { type: 'page_id', page_id: P1 }, properties: { title: { id: 'title', type: 'title', title: [rt('Sous-page')] } } },
    [D1]: { object: 'database', id: D1, created_time: '2024-01-01T00:00:00Z', last_edited_time: '2024-01-02T00:00:00Z', archived: false, icon: null, cover: null, parent: { type: 'page_id', page_id: P1 }, title: [rt('Tâches')], properties: { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, Statut: { id: 's', name: 'Statut', type: 'select', select: { options: [{ name: 'Fait', color: 'green' }] } } } },
    [R1]: { object: 'page', id: R1, created_time: '2024-01-01T00:00:00Z', last_edited_time: '2024-01-02T00:00:00Z', archived: false, icon: null, cover: null, parent: { type: 'database_id', database_id: D1 }, properties: { Name: { id: 'title', type: 'title', title: [rt('Ligne 1')] }, Statut: { id: 's', type: 'select', select: { name: 'Fait', color: 'green' } } } },
  };
  const blocks = {
    [P1]: [
      { object: 'block', id: 'b1000000-0000-0000-0000-000000000001', type: 'heading_1', has_children: false, created_time: '2024-01-01T00:00:00Z', heading_1: { rich_text: [rt('Bonjour', { annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'red' } })], color: 'default', is_toggleable: false } },
      { object: 'block', id: 'b1000000-0000-0000-0000-000000000002', type: 'paragraph', has_children: false, created_time: '2024-01-01T00:00:00Z', paragraph: { color: 'default', rich_text: [rt('Lien: '), { type: 'mention', mention: { type: 'page', page: { id: P2 } }, annotations: rt('').annotations, plain_text: 'Sous-page', href: `https://www.notion.so/${P2.replace(/-/g, '')}` }, rt(' et URL', { text: { content: ' et URL', link: { url: `https://www.notion.so/Sous-page-${P2.replace(/-/g, '')}` } } }), { type: 'mention', mention: { type: 'page', page: { id: '99999999-9999-9999-9999-999999999999' } }, annotations: rt('').annotations, plain_text: 'Page privée', href: null }] } },
      { object: 'block', id: 'b1000000-0000-0000-0000-000000000003', type: 'image', has_children: false, created_time: '2024-01-01T00:00:00Z', image: { type: 'file', file: { url: `http://127.0.0.1:${notionSrv?.address().port}/img.png?sig=1`, expiry_time: 'x' }, caption: [] } },
      { object: 'block', id: 'b1000000-0000-0000-0000-000000000004', type: 'toggle', has_children: true, created_time: '2024-01-01T00:00:00Z', toggle: { rich_text: [rt('Plus')], color: 'default' } },
      { object: 'block', id: P2, type: 'child_page', has_children: true, created_time: '2024-01-01T00:00:00Z', child_page: { title: 'Sous-page' } },
      { object: 'block', id: 'b1000000-0000-0000-0000-000000000006', type: 'unsupported', has_children: false, created_time: '2024-01-01T00:00:00Z', unsupported: {} },
      { object: 'block', id: 'b1000000-0000-0000-0000-000000000007', type: 'unsupported', has_children: false, created_time: '2024-01-01T00:00:00Z', unsupported: { block_type: 'button' } },
    ],
    'b1000000-0000-0000-0000-000000000004': [{ object: 'block', id: 'b2000000-0000-0000-0000-000000000001', type: 'paragraph', has_children: false, created_time: '2024-01-01T00:00:00Z', paragraph: { color: 'default', rich_text: [rt('caché')] } }],
    [P2]: [{ object: 'block', id: 'b3000000-0000-0000-0000-000000000001', type: 'to_do', has_children: false, created_time: '2024-01-01T00:00:00Z', to_do: { rich_text: [rt('à faire')], checked: true, color: 'default' } }],
    [R1]: [],
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  notionSrv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname === '/img.png') { res.setHeader('content-type', 'image/png'); return res.end(png); }
    if (u.pathname === '/icons/document_blue.svg') { res.setHeader('content-type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'); }
    if (req.headers.authorization !== 'Bearer secret_ok') { res.statusCode = 401; return send({ message: 'unauthorized' }); }
    // la recherche Notion est incomplète : elle ne renvoie que la racine et la base ; le reste doit être trouvé via les liens
    if (u.pathname === '/v1/search') return send({ results: [mockPages[P1], mockPages[D1]], has_more: false });
    const pg = u.pathname.match(/^\/v1\/(pages|databases)\/([^/]+)$/);
    if (pg) {
      let o = mockPages[pg[2]];
      if (o && pg[2] === P2 && req.headers['notion-version'] === '2026-03-11') o = { ...o, icon: { type: 'icon', icon: { name: 'document', color: 'blue' } } }; // icône native : seulement avec la version récente
      if (!o || o.object !== (pg[1] === 'pages' ? 'page' : 'database')) { res.statusCode = 404; return send({ code: 'object_not_found' }); }
      return send(o);
    }
    if (u.pathname === `/v1/databases/${D1}/query`) return send({ results: [mockPages[R1]], has_more: false });
    const m = u.pathname.match(/^\/v1\/blocks\/([^/]+)\/children$/);
    if (m) return send({ results: blocks[m[1]] || [], has_more: false });
    if (u.pathname === '/v1/comments') return send({ results: u.searchParams.get('block_id') === P1 ? [{ id: 'c0000000-0000-0000-0000-000000000001', created_time: '2024-01-03T00:00:00Z', last_edited_time: '2024-01-03T00:00:00Z', created_by: { object: 'user', id: 'u1' }, rich_text: [rt('Super page')] }] : [], has_more: false });
    res.statusCode = 404; send({});
  });
  await new Promise((r) => notionSrv.listen(0, '127.0.0.1', r));
  // l'URL du fichier dépend du port : on la corrige maintenant que le port est connu
  blocks[P1][2].image.file.url = `http://127.0.0.1:${notionSrv.address().port}/img.png?sig=1`;
  process.env.NOTION_ICON_BASE = `http://127.0.0.1:${notionSrv.address().port}/icons`;
  process.env.NOTION_API_URL = `http://127.0.0.1:${notionSrv.address().port}/v1`;

  const { app } = await import('../server/index.js');
  AdmZip = (await import('adm-zip')).default;
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); notionSrv?.close(); setTimeout(() => process.exit(0), 100).unref(); });

test('auth : premier compte admin, CSRF, login, inscriptions fermées', async () => {
  assert.equal((await api('a', 'GET', '/api/auth/me')).body.needsSetup, true);
  const noHeader = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  assert.equal((await api('a', 'POST', '/api/auth/register', { email: 'admin@x.fr', password: 'short' })).status, 400);
  const r = await api('a', 'POST', '/api/auth/register', { email: 'admin@x.fr', password: 'motdepasse1', name: 'Admin' });
  assert.equal(r.body.user.role, 'admin');
  assert.equal((await api('x', 'POST', '/api/auth/register', { email: 'b@x.fr', password: 'motdepasse1' })).status, 403);
  assert.equal((await api('x', 'POST', '/api/auth/login', { email: 'admin@x.fr', password: 'faux' })).status, 401);
  assert.equal((await api('b', 'POST', '/api/admin/users', { email: 'b@x.fr', password: 'motdepasse1' })).status, 401);
  assert.equal((await api('a', 'POST', '/api/admin/users', { email: 'b@x.fr', password: 'motdepasse1' })).status, 200);
  assert.equal((await api('b', 'POST', '/api/auth/login', { email: 'b@x.fr', password: 'motdepasse1' })).status, 200);
  assert.equal((await api('b', 'GET', '/api/admin/backups')).status, 403);
});

test('pages, blocs, sous-pages, partage et liens publics', async () => {
  const root = (await api('a', 'POST', '/api/pages', { title: 'Projet' })).body;
  const sub = (await api('a', 'POST', '/api/pages', { title: 'Sous', parent_id: root.id })).body;
  const subsub = (await api('a', 'POST', '/api/pages', { title: 'Sous-sous', parent_id: sub.id })).body;
  assert.equal((await api('b', 'GET', `/api/pages/${root.id}`)).status, 404);
  const blocks = [
    { id: 'blk-1', parent_id: null, type: 'toggle', content: { rich_text: [rt('Titre toggle')] } },
    { id: 'blk-2', parent_id: 'blk-1', type: 'paragraph', content: { rich_text: [rt('contenu imbriqué zéphyr')] } },
  ];
  assert.equal((await api('a', 'PUT', `/api/pages/${root.id}/blocks`, { blocks })).status, 200);
  const got = (await api('a', 'GET', `/api/pages/${root.id}`)).body;
  assert.equal(got.blocks.length, 2);
  assert.equal(got.blocks[1].parent_id, 'blk-1');
  // un autre utilisateur ne peut pas réutiliser un id de bloc d'une autre page
  assert.equal((await api('a', 'PUT', `/api/pages/${sub.id}/blocks`, { blocks: [blocks[0]] })).status, 409);
  // partage à un utilisateur en lecture, hérité par les sous-pages
  assert.equal((await api('a', 'POST', `/api/pages/${root.id}/shares`, { email: 'b@x.fr', role: 'view' })).status, 200);
  assert.equal((await api('b', 'GET', `/api/pages/${subsub.id}`)).body.role, 'view');
  assert.equal((await api('b', 'PUT', `/api/pages/${subsub.id}/blocks`, { blocks: [] })).status, 403);
  const tree = (await api('b', 'GET', '/api/pages/tree')).body;
  assert.ok(tree.shared.some((p) => p.id === subsub.id) && tree.sharedRoots.includes(root.id));
  // passage en édition : B peut créer une sous-page qui reste propriété de A
  await api('a', 'POST', `/api/pages/${root.id}/shares`, { email: 'b@x.fr', role: 'edit' });
  const made = (await api('b', 'POST', '/api/pages', { title: 'Par B', parent_id: root.id })).body;
  assert.equal(made.owner_id, root.owner_id);
  assert.equal((await api('b', 'DELETE', `/api/pages/${made.id}?permanent=1`)).status, 403);
  // recherche
  assert.equal((await api('b', 'GET', '/api/pages/search?q=z%C3%A9phyr')).body[0].id, root.id);
  assert.equal((await api('b', 'GET', '/api/pages/search?q=ZEPHYR%20contenu')).body[0].id, root.id, 'insensible aux accents/casse, multi-mots');
  assert.ok((await api('b', 'GET', '/api/pages/search?q=zephyr')).body[0].snippet.includes('zéphyr'), 'extrait fourni');
  assert.deepEqual((await api('a', 'GET', '/api/pages/search?q=%25')).body, []);
  // lien public (lecture seule, sans compte)
  const { public_token } = (await api('a', 'POST', `/api/pages/${sub.id}/shares`, { public: true })).body;
  const resolved = (await api('anon', 'GET', `/api/pages/public/${public_token}`)).body;
  assert.equal(resolved.page_id, sub.id);
  assert.equal((await api('anon', 'GET', `/api/pages/${subsub.id}?token=${public_token}`)).body.role, 'view');
  assert.equal((await api('anon', 'GET', `/api/pages/${root.id}?token=${public_token}`)).status, 401);
  assert.equal((await api('anon', 'PUT', `/api/pages/${sub.id}/blocks`, { blocks: [] })).status, 401);
  // déplacement : pas de cycle
  assert.equal((await api('a', 'PATCH', `/api/pages/${root.id}`, { parent_id: subsub.id })).status, 400);
  // corbeille puis restauration
  await api('a', 'DELETE', `/api/pages/${subsub.id}`);
  assert.equal((await api('a', 'GET', '/api/pages/tree')).body.pages.find((p) => p.id === subsub.id).archived, 1);
  await api('a', 'PATCH', `/api/pages/${subsub.id}`, { archived: false });
});

test('fichiers : upload puis lecture sandboxée', async () => {
  const up = await api('a', 'POST', '/api/files', Buffer.from('hello'), { 'Content-Type': 'text/html', 'x-filename': encodeURIComponent('é.html') });
  assert.equal(up.status, 200);
  const r = await fetch(base + up.body.url);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.match(r.headers.get('content-disposition'), /^attachment/);
});

test('import Notion API : hiérarchie, blocs natifs, fichiers, liens réécrits, rejouable', async () => {
  assert.equal((await api('a', 'POST', '/api/import/notion', {})).status, 400);
  const run = async (token, extra = {}) => {
    const { body } = await api('a', 'POST', '/api/import/notion', { token, ...extra });
    for (let i = 0; i < 100; i++) {
      const j = (await api('a', 'GET', `/api/import/${body.id}`)).body;
      if (j.status !== 'running') return j;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timeout');
  };
  assert.equal((await run('mauvais')).status, 'error');
  const j = await run('secret_ok');
  assert.equal(j.status, 'done', JSON.stringify(j));
  assert.deepEqual([j.counts.pages, j.counts.databases, j.counts.files, j.counts.unsupported], [3, 1, 2, 1]);
  assert.equal(j.counts.missing, 1, 'la page privée est signalée comme inaccessible');
  assert.equal(j.counts.comments, 1, 'commentaire Notion importé');
  assert.deepEqual(j.missing, ['Page privée']);

  const tree = (await api('a', 'GET', '/api/pages/tree')).body.pages;
  const root = tree.find((p) => p.title === 'Racine'), sub = tree.find((p) => p.title === 'Sous-page'), db = tree.find((p) => p.title === 'Tâches'), row = tree.find((p) => p.title === 'Ligne 1');
  assert.match(sub.icon, /^\/files\//, 'icône native Notion téléchargée et stockée localement');
  assert.equal(j.counts.icons, 1);
  assert.match(await (await fetch(base + sub.icon)).text(), /<svg/);
  assert.equal(root.icon, '🚀'); assert.equal(sub.parent_id, root.id); assert.equal(db.parent_id, root.id); assert.equal(row.parent_id, db.id);
  const page = (await api('a', 'GET', `/api/pages/${root.id}`)).body;
  const byType = (t) => page.blocks.filter((b) => b.type === t);
  assert.equal(byType('heading_1')[0].content.rich_text[0].annotations.color, 'red');
  const para = byType('paragraph').find((b) => b.content.rich_text.some((r) => r.type === 'mention')).content.rich_text;
  assert.equal(para[1].mention.page.id, sub.id, 'mention réécrite vers la nouvelle page');
  assert.equal(para[2].text.link.url, `/#/page/${sub.id}`, 'lien notion.so réécrit');
  const img = byType('image')[0].content;
  assert.match(img.external.url, /^\/files\//);
  assert.equal((await fetch(base + img.external.url)).headers.get('content-type'), 'image/png');
  const toggle = byType('toggle')[0];
  assert.equal(page.blocks.find((b) => b.parent_id === toggle.id).content.rich_text[0].plain_text, 'caché');
  assert.equal(byType('unsupported').length, 1);
  assert.equal(j.counts.buttons, 1, 'bouton Notion compté');
  const btn = byType('button');
  assert.equal(btn.length, 1, 'le bouton Notion devient un vrai bloc bouton');
  assert.deepEqual(btn[0].content.actions, []); assert.equal(btn[0].content.imported, true);
  // configuré dans Deepwell, il survit à un réimport
  const cfg = { label: 'Ajouter une tâche', color: 'blue', actions: [{ type: 'insert_blocks', text: '[] Nouvelle tâche', where: 'below' }] };
  await api('a', 'PUT', `/api/pages/${root.id}/blocks`, { blocks: page.blocks.map((b) => (b.id === btn[0].id ? { ...b, content: cfg } : b)) });
  assert.equal(byType('child_page').length, 1); assert.equal(byType('child_page')[0].content.page_id, sub.id, 'child_page pointe vers la page importée');
  const dbp = (await api('a', 'GET', `/api/pages/${db.id}`)).body;
  assert.equal(dbp.page.kind, 'database'); assert.equal(dbp.page.schema.Statut.type, 'select');
  assert.equal(dbp.children[0].props.Statut.select.name, 'Fait');

  const before = (await api('a', 'GET', '/api/pages/tree')).body.pages.length;
  assert.equal((await run('secret_ok')).status, 'done');
  const kept = (await api('a', 'GET', `/api/pages/${root.id}`)).body.blocks.find((b) => b.type === 'button');
  assert.deepEqual(kept.content, cfg, 'la configuration du bouton est conservée au réimport');
  assert.equal((await api('a', 'GET', '/api/pages/tree')).body.pages.length, before, 'ré-import sans doublon');

  // Écrasement : sauvegarde de sécurité d'abord, puis suppression des pages importées (et de ce qui est dessous), puis réimport à neuf
  const added = (await api('a', 'POST', '/api/pages', { title: 'Ajout utilisateur', parent_id: root.id })).body;
  const oldIds = new Set((await api('a', 'GET', '/api/pages/tree')).body.pages.map((p) => p.id));
  const backupsBefore = (await api('a', 'GET', '/api/admin/backups')).body.length;
  const bad = await run('mauvais', { overwrite: true });
  assert.equal(bad.status, 'error');
  assert.ok((await api('a', 'GET', `/api/pages/${added.id}`)).body.page, 'jeton refusé : rien ne doit être supprimé');
  const ow = await run('secret_ok', { overwrite: true });
  assert.equal(ow.status, 'done', JSON.stringify(ow));
  assert.equal(ow.counts.replaced, 4, 'pages importées précédemment supprimées');
  assert.equal((await api('a', 'GET', '/api/admin/backups')).body.length, backupsBefore + 1, 'sauvegarde de sécurité créée');
  const after = (await api('a', 'GET', '/api/pages/tree')).body.pages;
  assert.ok(after.every((p) => !oldIds.has(p.id) || !p.imported), 'les pages importées ont été recréées à neuf');
  assert.equal((await api('a', 'GET', `/api/pages/${added.id}`)).status, 404, 'ce qui était sous une page importée disparaît');
  assert.equal(after.filter((p) => p.imported).length, 4);
  const root2 = after.find((p) => p.title === 'Racine');
  assert.ok(root2 && !oldIds.has(root2.id), 'nouvelle page racine');
});

test('import ZIP Markdown/CSV', async () => {
  const z = new AdmZip();
  z.addFile('Mon projet aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md', Buffer.from('# Mon projet\n\nTexte **gras** et [lien](Enfant%20bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md)\n\n- a\n    - b\n- [x] fait\n\n> citation\n\n```js\nlet x = 1;\n```\n\n![img](img.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<details>\n<summary>Plus</summary>\n\n    caché\n\n</details>\n'));
  z.addFile('Mon projet aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Enfant bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md', Buffer.from('# Enfant\n\nbonjour\n'));
  z.addFile('Mon projet aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/img.png', Buffer.from('PNG'));
  z.addFile('Base cccccccccccccccccccccccccccccccc.csv', Buffer.from('﻿Nom,Prix,Fait\nA,"1,5",Yes\nB,2,No\n'));
  z.addFile('Base cccccccccccccccccccccccccccccccc/A dddddddddddddddddddddddddddddddd.md', Buffer.from('# A\n\nPrix: 1,5\n\ncorps de A\n'));
  const { body } = await api('a', 'POST', '/api/import/zip', z.toBuffer());
  let j; for (let i = 0; i < 50; i++) { j = (await api('a', 'GET', `/api/import/${body.id}`)).body; if (j.status !== 'running') break; await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(j.status, 'done', JSON.stringify(j));
  const tree = (await api('a', 'GET', '/api/pages/tree')).body.pages;
  const proj = tree.find((p) => p.title === 'Mon projet'), child = tree.find((p) => p.title === 'Enfant'), dbp = tree.find((p) => p.title === 'Base');
  assert.equal(child.parent_id, proj.id); assert.equal(dbp.kind, 'database');
  const pg = (await api('a', 'GET', `/api/pages/${proj.id}`)).body;
  const types = pg.blocks.map((b) => b.type);
  for (const t of ['paragraph', 'bulleted_list_item', 'to_do', 'quote', 'code', 'image', 'table', 'table_row', 'toggle']) assert.ok(types.includes(t), `bloc ${t} manquant (${types})`);
  const nested = pg.blocks.find((b) => b.type === 'bulleted_list_item' && b.content.rich_text[0].plain_text === 'b');
  assert.equal(pg.blocks.find((b) => b.id === nested.parent_id).content.rich_text[0].plain_text, 'a');
  const link = pg.blocks[0].content.rich_text.find((r) => r.href);
  assert.equal(link.href, `/#/page/${child.id}`);
  assert.equal(pg.blocks[0].content.rich_text[1].annotations.bold, true);
  const d = (await api('a', 'GET', `/api/pages/${dbp.id}`)).body;
  assert.equal(d.page.schema.Prix.type, 'number'); assert.equal(d.page.schema.Fait.type, 'checkbox');
  assert.equal(d.children.length, 2);
  const rowA = d.children.find((c) => c.title === 'A');
  assert.equal(rowA.props.Prix.number, 1.5);
  assert.ok((await api('a', 'GET', `/api/pages/${rowA.id}`)).body.blocks.some((b) => b.content.rich_text[0].plain_text.includes('corps de A')));
});

test('backup : instantané restaurable + export JSON + réglages', async () => {
  const r = await api('a', 'POST', '/api/admin/backups');
  assert.equal(r.status, 200);
  assert.equal((await api('a', 'GET', '/api/admin/backups')).body.length, 2, 'la sauvegarde de sécurité de l’écrasement + celle-ci');
  const gz = fs.readFileSync(path.join(dir, 'backups', r.body.name));
  assert.equal(zlib.gunzipSync(gz).subarray(0, 15).toString(), 'SQLite format 3');
  const exp = (await api('a', 'GET', '/api/export')).body;
  assert.ok(exp.pages.length > 5 && exp.blocks.length > 10);
  assert.equal((await api('b', 'PUT', '/api/settings', { accent: 'red' })).status, 403);
  await api('a', 'PUT', '/api/settings', { accent: '#ff0000', custom_css: 'body{}' });
  assert.equal((await api('anon', 'GET', '/api/settings')).body.accent, '#ff0000');
});

test('commentaires (droits, fils, résolution) et vues de base de données', async () => {
  const pg = (await api('a', 'POST', '/api/pages', { title: 'Page commentée' })).body;
  await api('a', 'POST', `/api/pages/${pg.id}/shares`, { email: 'b@x.fr', role: 'view' });
  assert.equal((await api('b', 'POST', `/api/pages/${pg.id}/comments`, { body: 'salut' })).status, 403, 'lecture seule : pas de commentaire');
  assert.equal((await api('b', 'GET', `/api/pages/${pg.id}/comments`)).status, 200, 'mais il peut les lire');
  await api('a', 'POST', `/api/pages/${pg.id}/shares`, { email: 'b@x.fr', role: 'comment' });
  const c1 = (await api('b', 'POST', `/api/pages/${pg.id}/comments`, { body: 'Un avis', block_id: 'blk-9', quote: 'extrait' })).body;
  assert.equal(c1.author, 'b@x.fr'); assert.equal(c1.block_id, 'blk-9');
  const rep1 = (await api('a', 'POST', `/api/pages/${pg.id}/comments`, { body: 'Merci', parent_id: c1.id })).body;
  assert.equal(rep1.parent_id, c1.id);
  assert.equal((await api('b', 'PATCH', `/api/pages/${pg.id}/comments/${rep1.id}`, { body: 'piraté' })).status, 403, 'seul l’auteur modifie');
  assert.equal((await api('b', 'PUT', `/api/pages/${pg.id}/blocks`, { blocks: [] })).status, 403, 'commenter n’autorise pas à éditer');
  await api('b', 'PATCH', `/api/pages/${pg.id}/comments/${rep1.id}`, { resolved: true });
  const list = (await api('a', 'GET', `/api/pages/${pg.id}/comments`)).body;
  assert.equal(list.length, 2); assert.ok(list.every((c) => c.resolved), 'résoudre un fil résout toutes ses réponses');
  assert.equal((await api('a', 'DELETE', `/api/pages/${pg.id}/comments/${c1.id}`)).status, 200, 'le propriétaire peut supprimer');
  assert.equal((await api('a', 'GET', `/api/pages/${pg.id}/comments`)).body.length, 0, 'le fil entier est supprimé');
  assert.equal((await api('x', 'GET', `/api/pages/${pg.id}/comments`)).status, 401);

  const dbp = (await api('a', 'POST', '/api/pages', { title: 'Tâches', kind: 'database' })).body;
  const views = [{ id: 'v1', name: 'Tableau', type: 'table' }, { id: 'v2', name: 'Kanban', type: 'board', group_by: 'Statut' }];
  assert.equal((await api('a', 'PATCH', `/api/pages/${dbp.id}`, { views })).status, 200);
  assert.deepEqual((await api('a', 'GET', `/api/pages/${dbp.id}`)).body.page.views, views);
  assert.equal((await api('a', 'PATCH', `/api/pages/${dbp.id}`, { views: 'nimporte quoi' })).status, 200, 'valeur invalide ignorée');
  assert.deepEqual((await api('a', 'GET', `/api/pages/${dbp.id}`)).body.page.views, views);
});

test('dossiers, déplacement (position) et duplication récursive', async () => {
  const folder = (await api('a', 'POST', '/api/pages', { title: 'Dossier', kind: 'folder' })).body;
  assert.equal(folder.kind, 'folder');
  const p1 = (await api('a', 'POST', '/api/pages', { title: 'Un', parent_id: folder.id })).body;
  const p2 = (await api('a', 'POST', '/api/pages', { title: 'Deux', parent_id: folder.id })).body;
  const loose = (await api('a', 'POST', '/api/pages', { title: 'Libre' })).body;
  // « Déplacer vers… » : la page arrive à la fin du dossier
  assert.equal((await api('a', 'PATCH', `/api/pages/${loose.id}`, { parent_id: folder.id })).status, 200);
  const kids = (await api('a', 'GET', `/api/pages/${folder.id}`)).body.children;
  assert.deepEqual(kids.map((c) => c.title), ['Un', 'Deux', 'Libre'], 'ajoutée en dernier');
  assert.equal((await api('a', 'PATCH', `/api/pages/${folder.id}`, { parent_id: p1.id })).status, 400, 'pas de déplacement dans un descendant');
  // duplication : sous-pages, blocs et liens child_page remappés
  const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
  await api('a', 'PUT', `/api/pages/${p1.id}/blocks`, { blocks: [
    { id: 'dup-1', parent_id: null, type: 'paragraph', content: { rich_text: [{ type: 'text', text: { content: 'Contenu', link: null }, annotations: ann, plain_text: 'Contenu', href: null }] } },
    { id: 'dup-2', parent_id: null, type: 'child_page', content: { title: 'Deux', page_id: p2.id } },
  ] });
  const copy = (await api('a', 'POST', `/api/pages/${folder.id}/duplicate`)).body;
  assert.equal(copy.title, 'Dossier (copie)'); assert.equal(copy.kind, 'folder'); assert.notEqual(copy.id, folder.id);
  const copyKids = (await api('a', 'GET', `/api/pages/${copy.id}`)).body.children;
  assert.deepEqual(copyKids.map((c) => c.title), ['Un', 'Deux', 'Libre']);
  assert.ok(copyKids.every((c) => ![p1.id, p2.id, loose.id].includes(c.id)), 'ce sont de nouvelles pages');
  const copyUn = (await api('a', 'GET', `/api/pages/${copyKids[0].id}`)).body;
  assert.equal(copyUn.blocks.length, 2);
  assert.ok(copyUn.blocks.every((b) => !['dup-1', 'dup-2'].includes(b.id)), 'nouveaux identifiants de blocs');
  assert.equal(copyUn.blocks.find((b) => b.type === 'child_page').content.page_id, copyKids[1].id, 'le lien pointe vers la sous-page COPIÉE');
  assert.equal((await api('a', 'GET', `/api/pages/${folder.id}`)).body.children.length, 3, 'l’original est intact');
  // droits : lecture seule => pas de duplication
  await api('a', 'POST', `/api/pages/${folder.id}/shares`, { email: 'b@x.fr', role: 'view' });
  assert.equal((await api('b', 'POST', `/api/pages/${folder.id}/duplicate`)).status, 403);
});

test('historique des versions : instantanés, aperçu, restauration, droits', async () => {
  const pg = (await api('a', 'POST', '/api/pages', { title: 'Historique' })).body;
  const mk = (t) => ({ id: 'h-' + t, parent_id: null, type: 'paragraph', content: { rich_text: [{ type: 'text', text: { content: t, link: null }, plain_text: t }] } });
  assert.equal((await api('a', 'GET', `/api/pages/${pg.id}/versions`)).body.length, 0);
  await api('a', 'PUT', `/api/pages/${pg.id}/blocks`, { blocks: [mk('v1')] });      // page vide : pas de version
  await api('a', 'PUT', `/api/pages/${pg.id}/blocks`, { blocks: [mk('v2')] });      // garde l'état v1
  await api('a', 'PUT', `/api/pages/${pg.id}/blocks`, { blocks: [mk('v3')] });      // moins de 5 min : pas de nouvelle version
  const list = (await api('a', 'GET', `/api/pages/${pg.id}/versions`)).body;
  assert.equal(list.length, 1); assert.match(list[0].preview, /v1/);
  const v = (await api('a', 'GET', `/api/pages/${pg.id}/versions/${list[0].id}`)).body;
  assert.equal(v.blocks[0].content.rich_text[0].plain_text, 'v1');
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/versions/${list[0].id}/restore`)).status, 200);
  const cur = (await api('a', 'GET', `/api/pages/${pg.id}`)).body.blocks;
  assert.equal(cur[0].content.rich_text[0].plain_text, 'v1', 'version restaurée');
  const after = (await api('a', 'GET', `/api/pages/${pg.id}/versions`)).body;
  assert.equal(after.length, 2); assert.equal(after[0].reason, 'Avant restauration');
  const back = (await api('a', 'GET', `/api/pages/${pg.id}/versions/${after[0].id}`)).body;
  assert.equal(back.blocks[0].content.rich_text[0].plain_text, 'v3', 'l’état d’avant restauration est conservé');
  // droits : un lecteur ne voit pas l'historique
  await api('a', 'POST', `/api/pages/${pg.id}/shares`, { email: 'b@x.fr', role: 'view' });
  assert.equal((await api('b', 'GET', `/api/pages/${pg.id}/versions`)).status, 403);
  assert.equal((await api('b', 'POST', `/api/pages/${pg.id}/versions/${list[0].id}/restore`)).status, 403);
});

test('collection d’icônes personnalisées : ajout, doublon, privée, suppression', async () => {
  assert.equal((await api('a', 'POST', '/api/pages/icons/collection', { url: 'javascript:alert(1)' })).status, 400);
  const i1 = (await api('a', 'POST', '/api/pages/icons/collection', { url: '/files/abc', name: 'logo' })).body;
  const i2 = (await api('a', 'POST', '/api/pages/icons/collection', { url: '/files/abc', name: 'logo' })).body;
  assert.equal(i1.id, i2.id, 'pas de doublon');
  const baseline = (await api('a', 'GET', '/api/pages/icons/collection')).body;
  assert.ok(baseline.some((i) => i.url === '/files/abc'));
  assert.ok(baseline.some((i) => i.url.startsWith('/files/') && i.url !== '/files/abc'), 'icônes importées de Notion présentes dans la collection');
  assert.deepEqual((await api('b', 'GET', '/api/pages/icons/collection')).body, [], 'collection propre à chaque utilisateur');
  await api('b', 'DELETE', `/api/pages/icons/collection/${i1.id}`);
  assert.equal((await api('a', 'GET', '/api/pages/icons/collection')).body.length, baseline.length, 'un autre utilisateur ne peut pas la modifier');
  await api('a', 'DELETE', `/api/pages/icons/collection/${i1.id}`);
  assert.equal((await api('a', 'GET', '/api/pages/icons/collection')).body.length, baseline.length - 1);
});

test('accès restreint : code, héritage, déverrouillage, recherche, retrait', async () => {
  const pg = (await api('a', 'POST', '/api/pages', { title: 'Secret' })).body;
  const kid = (await api('a', 'POST', '/api/pages', { title: 'Enfant secret', parent_id: pg.id })).body;
  const para = (t) => ({ id: 'lk-' + t, parent_id: null, type: 'paragraph', content: { rich_text: [{ type: 'text', text: { content: t, link: null }, plain_text: t }] } });
  await api('a', 'PUT', `/api/pages/${pg.id}/blocks`, { blocks: [para('zorglub')] });
  assert.equal((await api('a', 'PUT', `/api/pages/${pg.id}/lock`, { pin: '12' })).status, 400, 'code trop court');
  assert.equal((await api('a', 'PUT', `/api/pages/${pg.id}/lock`, { pin: '1234', idle_min: 10 })).status, 200);
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/lock/now`)).status, 200);
  const r = await api('a', 'GET', `/api/pages/${pg.id}`);
  assert.equal(r.status, 423); assert.equal(r.body.page.title, 'Secret'); assert.equal(r.body.blocks, undefined, 'aucun contenu fuité');
  assert.equal((await api('a', 'GET', `/api/pages/${kid.id}`)).status, 423, 'verrou hérité par les sous-pages');
  assert.equal((await api('a', 'PUT', `/api/pages/${pg.id}/blocks`, { blocks: [] })).status, 423);
  assert.deepEqual((await api('a', 'GET', '/api/pages/search?q=zorglub')).body, [], 'contenu absent de la recherche');
  assert.ok((await api('a', 'GET', '/api/pages/tree')).body.pages.find((p) => p.id === pg.id).locked, 'indicateur dans l’arbre');
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/lock/unlock`, { pin: 'faux' })).status, 403);
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/lock/unlock`, { pin: '1234' })).status, 200);
  assert.equal((await api('a', 'GET', `/api/pages/${kid.id}`)).status, 200);
  assert.equal((await api('a', 'PUT', `/api/pages/${pg.id}/lock`, { pin: '5678' })).status, 403, 'ancien code exigé');
  assert.equal((await api('a', 'PUT', `/api/pages/${pg.id}/lock`, { pin: '5678', current_pin: '1234' })).status, 200);
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/lock/remove`, { pin: '0000' })).status, 403);
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/lock/remove`, { pin: '5678' })).status, 200);
  assert.equal((await api('a', 'GET', `/api/pages/${pg.id}`)).status, 200);
});

test('remplacer les liens par les documents : page courante, choix un par un, document déplacé, doublons', async () => {
  const mk = async (title, parent_id) => (await api('a', 'POST', '/api/pages', { title, parent_id })).body;
  const root = await mk('Racine liens'), sec = await mk('Section', root.id), docA = await mk('Doc A', sec.id), docB = await mk('Doc B', sec.id), deep = await mk('Sous-page', root.id), docC = await mk('Doc C', sec.id);
  const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
  const txt = (t) => ({ id: 'dc-' + t, parent_id: null, type: 'paragraph', content: { rich_text: [{ type: 'text', text: { content: t, link: null }, plain_text: t, annotations: ann }] } });
  await api('a', 'PUT', `/api/pages/${docA.id}/blocks`, { blocks: [txt('contenu A')] });
  await api('a', 'PUT', `/api/pages/${docB.id}/blocks`, { blocks: [txt('contenu B')] });
  await api('a', 'PUT', `/api/pages/${docC.id}/blocks`, { blocks: [txt('contenu C')] });
  const link = (id, page) => ({ id, parent_id: null, type: 'link_to_page', content: { page_id: page } });
  await api('a', 'PUT', `/api/pages/${root.id}/blocks`, { blocks: [link('l1', docA.id), link('l2', docB.id), link('l2b', docB.id), link('l4', docC.id)] });
  await api('a', 'PUT', `/api/pages/${deep.id}/blocks`, { blocks: [link('l3', docC.id)] });
  await api('a', 'PUT', '/api/settings', { dev_mode: '1' });
  const list = (await api('a', 'POST', `/api/pages/${root.id}/inline-links`, {})).body.links;
  assert.equal(list.length, 4, 'uniquement les liens de la page courante'); assert.equal(list[0].location, 'Section');
  // choix un par un : A et les deux liens de B (doublon : un seul reçoit la sous-page) ; C n'est pas choisi
  await api('a', 'PUT', `/api/pages/${sec.id}/blocks`, { blocks: [{ id: 'cp-a', parent_id: null, type: 'child_page', content: { title: 'Doc A', page_id: docA.id } }] });
  const r = (await api('a', 'POST', `/api/pages/${root.id}/inline-links`, { block_ids: ['l1', 'l2b', 'l2'] })).body;
  assert.equal(r.inlined, 2);
  const rb = (await api('a', 'GET', `/api/pages/${root.id}`)).body.blocks;
  const cps = rb.filter((b) => b.type === 'child_page').map((b) => b.content.page_id);
  assert.ok(cps.includes(docA.id) && cps.includes(docB.id), 'les liens sont devenus des sous-pages');
  assert.ok(!rb.some((b) => b.content.rich_text?.[0]?.plain_text === 'contenu A'), 'le contenu n’est PAS recopié dans la page');
  assert.equal(['l2', 'l2b'].filter((id) => rb.some((b) => b.id === id && b.type === 'link_to_page')).length, 1, 'un seul des doublons devient la sous-page, l’autre reste un lien');
  assert.ok(rb.some((b) => b.id === 'l4' && b.type === 'link_to_page'), 'lien non choisi intact');
  const a = (await api('a', 'GET', `/api/pages/${docA.id}`)).body;
  assert.equal(a.page.parent_id, root.id, 'la page a été déplacée sous la page courante');
  assert.equal(a.blocks[0].content.rich_text[0].plain_text, 'contenu A', 'contenu de la page intact');
  const secB = (await api('a', 'GET', `/api/pages/${sec.id}`)).body;
  assert.ok(!secB.children.some((c) => c.id === docA.id) && !secB.blocks.some((b) => b.type === 'child_page'), 'elle n’existe plus à l’ancien emplacement');
  assert.equal((await api('a', 'GET', `/api/pages/${deep.id}`)).body.blocks.length, 1, 'sous-page non traitée');
});

test('remplacer des liens : mentions dans une liste ou un tableau, liens /#/page/', async () => {
  const mk = async (title, parent_id) => (await api('a', 'POST', '/api/pages', { title, parent_id })).body;
  const reg = await mk('Registre'), arch = await mk('Archive'), d1 = await mk('PA001', arch.id), d2 = await mk('PA002', arch.id), d3 = await mk('PA003', arch.id);
  const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
  const men = (id, t) => ({ type: 'mention', mention: { type: 'page', page: { id } }, plain_text: t, annotations: ann, href: null });
  const txt = (t) => ({ type: 'text', text: { content: t, link: null }, plain_text: t, annotations: ann });
  await api('a', 'PUT', `/api/pages/${reg.id}/blocks`, { blocks: [
    { id: 'i1', parent_id: null, type: 'bulleted_list_item', content: { rich_text: [men(d1.id, 'PA001')] } },
    { id: 'i2', parent_id: null, type: 'bulleted_list_item', content: { rich_text: [txt('Voir '), men(d2.id, 'PA002'), txt(' en détail')] } },
    { id: 't1', parent_id: null, type: 'table', content: { table_width: 1, has_column_header: false } },
    { id: 'r1', parent_id: 't1', type: 'table_row', content: { cells: [[{ type: 'text', text: { content: 'PA003', link: { url: `/#/page/${d3.id}` } }, plain_text: 'PA003', annotations: ann }]] } },
  ] });
  await api('a', 'PUT', '/api/settings', { dev_mode: '1' });
  const list = (await api('a', 'POST', `/api/pages/${reg.id}/inline-links`, {})).body.links;
  assert.equal(list.length, 3); assert.deepEqual(list.map((l) => l.solo), [true, false, false]);
  const r = (await api('a', 'POST', `/api/pages/${reg.id}/inline-links`, { block_ids: list.map((l) => l.cid) })).body;
  assert.equal(r.inlined, 3);
  const b = (await api('a', 'GET', `/api/pages/${reg.id}`)).body.blocks;
  assert.ok(b.some((x) => x.id === 'i1' && x.type === 'child_page'), 'bloc contenant seulement la mention -> sous-page');
  assert.ok(b.some((x) => x.id === 'i2' && x.type === 'bulleted_list_item') && b.filter((x) => x.type === 'child_page').length === 3, 'texte mixte et tableau : sous-page ajoutée, texte conservé');
  assert.equal((await api('a', 'GET', `/api/pages/${d3.id}`)).body.page.parent_id, reg.id);
});

test('icônes : une image devenue icône de page est gardée (« Mes images »), celles des imports sont marquées « import »', async () => {
  const f = (await api('a', 'POST', '/api/files', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { 'Content-Type': 'image/svg+xml', 'X-Filename': 'mon-logo.svg' })).body;
  const pg = (await api('a', 'POST', '/api/pages', { title: 'Avec icône perso' })).body;
  await api('a', 'PATCH', `/api/pages/${pg.id}`, { icon: f.url });
  const col = (await api('a', 'GET', '/api/pages/icons/collection')).body;
  const mine = col.find((i) => i.url === f.url);
  assert.ok(mine && mine.source === 'upload' && mine.name === 'mon-logo.svg');
  assert.ok(col.some((i) => i.source === 'import'), 'icônes importées de Notion rangées à part');
});

test('icônes : recoloration d’un SVG de la collection (copie, doublon évité, validations)', async () => {
  const f = (await api('a', 'POST', '/api/files', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#d9730d"><path d="M1 1h5v5z"/></svg>'), { 'Content-Type': 'image/svg+xml', 'X-Filename': 'dossier_orange.svg' })).body;
  await api('a', 'POST', '/api/pages/icons/collection', { url: f.url, name: 'dossier_orange' });
  assert.ok((await api('a', 'GET', '/api/pages/icons/collection')).body.find((i) => i.url === f.url).svg, 'indicateur SVG');
  const r1 = await api('a', 'POST', '/api/pages/icons/recolor', { url: f.url, color: 'blue' });
  assert.equal(r1.status, 200); assert.notEqual(r1.body.url, f.url);
  const svg = (await fetch(`${base}${r1.body.url}`, { headers: { cookie: cookies.a } }).then((r) => r.text()));
  assert.match(svg, /fill="#337ea9"/); assert.doesNotMatch(svg, /#d9730d/);
  assert.equal((await api('a', 'POST', '/api/pages/icons/recolor', { url: f.url, color: 'blue' })).body.url, r1.body.url, 'même couleur : pas de doublon');
  assert.equal((await api('a', 'POST', '/api/pages/icons/recolor', { url: f.url, color: '#ff0000' })).status, 200);
  assert.equal((await api('a', 'POST', '/api/pages/icons/recolor', { url: f.url, color: 'xx' })).status, 400);
  assert.equal((await api('b', 'POST', '/api/pages/icons/recolor', { url: f.url, color: 'red' })).status, 404, 'collection d’un autre utilisateur');
});

test('icône Notion par son nom : validations', async () => {
  assert.equal((await api('a', 'POST', '/api/pages/icons/notion', { name: '../etc/passwd', color: 'orange' })).status, 400);
  assert.equal((await api('a', 'POST', '/api/pages/icons/notion', { name: 'folder', color: 'fuchsia' })).status, 400);
});

test('mode développeur : date de création d’un commentaire modifiable seulement s’il est activé', async () => {
  const pg = (await api('a', 'POST', '/api/pages', { title: 'Commentaires datés' })).body;
  const c = (await api('a', 'POST', `/api/pages/${pg.id}/comments`, { body: 'salut' })).body;
  const t = Date.UTC(2023, 4, 17, 10, 30);
  await api('a', 'PUT', '/api/settings', { dev_mode: '0' });
  assert.equal((await api('a', 'PATCH', `/api/pages/${pg.id}/comments/${c.id}`, { created_at: t })).status, 403, 'désactivé par défaut');
  assert.equal((await api('b', 'PUT', '/api/settings', { dev_mode: '1' })).status, 403, 'réglage réservé à l’administrateur');
  await api('a', 'PUT', '/api/settings', { dev_mode: '1' });
  assert.equal((await api('a', 'PATCH', `/api/pages/${pg.id}/comments/${c.id}`, { created_at: 'pas une date' })).status, 400);
  assert.equal((await api('a', 'PATCH', `/api/pages/${pg.id}/comments/${c.id}`, { created_at: Date.now() + 10 * 86400000 })).status, 400, 'pas dans le futur');
  assert.equal((await api('a', 'PATCH', `/api/pages/${pg.id}/comments/${c.id}`, { created_at: t })).status, 200);
  assert.equal((await api('a', 'GET', `/api/pages/${pg.id}/comments`)).body[0].created_at, t);
  await api('a', 'PUT', '/api/settings', { dev_mode: '0' });
  assert.equal((await api('a', 'PATCH', `/api/pages/${pg.id}/comments/${c.id}`, { created_at: t + 1 })).status, 403, 'à nouveau verrouillé');
});

test('commentaire sur un texte sélectionné : citation et position conservées', async () => {
  const pg = (await api('a', 'POST', '/api/pages', { title: 'Commentaire ancré' })).body;
  const c = (await api('a', 'POST', `/api/pages/${pg.id}/comments`, { body: 'à revoir', block_id: 'blk1', quote: 'mot clé', anchor: 12 })).body;
  assert.equal(c.anchor, 12); assert.equal(c.quote, 'mot clé');
  const g = (await api('a', 'GET', `/api/pages/${pg.id}/comments`)).body[0];
  assert.equal(g.anchor, 12);
  const page = (await api('a', 'POST', `/api/pages/${pg.id}/comments`, { body: 'général' })).body;
  assert.equal(page.anchor, null); assert.equal(page.block_id, null, 'commentaire de page');
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/comments`, { body: 'x', block_id: 'b', quote: '', anchor: 3 })).body.anchor, null, 'pas d’ancre sans texte cité');
});

test('favoris : ajout, ordre libre, retrait, propres à chaque utilisateur', async () => {
  const p1 = (await api('a', 'POST', '/api/pages', { title: 'Fav 1' })).body, p2 = (await api('a', 'POST', '/api/pages', { title: 'Fav 2' })).body;
  const sub = (await api('a', 'POST', '/api/pages', { title: 'Sous-page fav', parent_id: p1.id })).body;
  await api('a', 'POST', '/api/pages/favorites', { page_id: p1.id });
  await api('a', 'POST', '/api/pages/favorites', { page_id: p2.id });
  let l = (await api('a', 'POST', '/api/pages/favorites', { page_id: sub.id })).body;
  assert.deepEqual(l.slice(-3), [p1.id, p2.id, sub.id], 'ordre d’ajout');
  assert.deepEqual((await api('a', 'POST', '/api/pages/favorites', { page_id: p1.id })).body, l, 'pas de doublon');
  l = (await api('a', 'PUT', '/api/pages/favorites/order', { ids: [sub.id, p1.id, p2.id] })).body;
  assert.deepEqual(l.slice(-3), [sub.id, p1.id, p2.id], 'réordonné');
  assert.equal((await api('b', 'POST', '/api/pages/favorites', { page_id: p1.id })).status, 404, 'page non accessible');
  assert.ok(!(await api('b', 'GET', '/api/pages/favorites')).body.includes(p1.id), 'favoris privés');
  l = (await api('a', 'DELETE', `/api/pages/favorites/${p2.id}`)).body;
  assert.ok(!l.includes(p2.id));
  await api('a', 'DELETE', `/api/pages/${p1.id}`); // corbeille : disparaît des favoris
  assert.ok(!(await api('a', 'GET', '/api/pages/favorites')).body.includes(p1.id));
});

test('remplacement de liens : réservé au mode développeur', async () => {
  const pg = (await api('a', 'POST', '/api/pages', { title: 'Page liens' })).body;
  await api('a', 'PUT', '/api/settings', { dev_mode: '0' });
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/inline-links`, {})).status, 403);
  await api('a', 'PUT', '/api/settings', { dev_mode: '1' });
  assert.equal((await api('a', 'POST', `/api/pages/${pg.id}/inline-links`, {})).status, 200);
  await api('a', 'PUT', '/api/settings', { dev_mode: '0' });
});

test('version de Deepwell exposée avec les réglages publics', async () => {
  const s = (await api('a', 'GET', '/api/settings')).body;
  assert.match(s.version, /^\d+\.\d+\.\d+$/);
});

test('numérotation automatique : plus grande valeur + 1, modifiable, tri numérique', async () => {
  const dbp = (await api('a', 'POST', '/api/pages', { title: 'Registre auto', kind: 'database' })).body;
  const schema = { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, N: { id: 'n1', name: 'N', type: 'number', number: { format: 'number', auto_increment: true } }, ID: { id: 'u1', name: 'ID', type: 'unique_id', unique_id: { prefix: 'PA' } }, Libre: { id: 'l1', name: 'Libre', type: 'number', number: {} } };
  await api('a', 'PATCH', `/api/pages/${dbp.id}`, { schema });
  const r1 = (await api('a', 'POST', '/api/pages', { parent_id: dbp.id, title: 'un' })).body;
  assert.equal(r1.props.N.number, 1); assert.deepEqual(r1.props.ID.unique_id, { prefix: 'PA', number: 1 }); assert.equal(r1.props.Libre, undefined, 'colonne sans auto');
  const r2 = (await api('a', 'POST', '/api/pages', { parent_id: dbp.id, title: 'deux' })).body;
  assert.equal(r2.props.N.number, 2);
  // changement manuel : la prochaine valeur suit la plus haute
  await api('a', 'PATCH', `/api/pages/${r1.id}`, { props: { N: { type: 'number', number: 10 } } });
  assert.equal((await api('a', 'POST', '/api/pages', { parent_id: dbp.id, title: 'trois' })).body.props.N.number, 11);
  // une page ordinaire n'est pas numérotée
  assert.deepEqual((await api('a', 'POST', '/api/pages', { title: 'simple' })).body.props, {});
});
