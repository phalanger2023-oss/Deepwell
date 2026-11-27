import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-nc-'));
process.env.DATA_DIR = dir; process.env.NOTION_MIN_GAP_MS = '0';

let server, base, cookie = '', notion, nbase, denyAll = false;
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'x-dw': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j };
}
const cm = (id, disc, text, who = 'Alice') => ({ id, discussion_id: disc, created_time: '2026-05-01T10:00:00.000Z', last_edited_time: '2026-05-01T10:00:00.000Z', created_by: { name: who }, rich_text: [{ plain_text: text }] });
const DATA = { 'page-n1': [cm('c1', 'd1', 'Premier'), cm('c2', 'd1', 'Réponse', 'Bob'), cm('c3', 'd2', 'Autre fil')], 'blk-n1': [cm('c4', 'd3', 'Sur le bloc')] };

before(async () => {
  notion = http.createServer((req, res) => {
    const id = new URL(req.url, 'http://x').searchParams.get('block_id');
    if (denyAll) { res.statusCode = 403; return res.end(JSON.stringify({ message: 'Insufficient permissions for this endpoint: comment read' })); }
    res.setHeader('content-type', 'application/json');
    if (!(id in DATA) && id !== 'page-n2') { res.statusCode = 404; return res.end('{}'); }
    res.end(JSON.stringify({ results: DATA[id] || [], has_more: false }));
  });
  await new Promise((r) => notion.listen(0, '127.0.0.1', r));
  process.env.NOTION_API_URL = `http://127.0.0.1:${notion.address().port}/v1`;
  const { app } = await import('../server/index.js');
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/register', { email: 'a@b.fr', name: 'A', password: 'motdepasse1' })).status, 200);
});
after(() => { server?.close(); notion?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function waitJob(id) { for (let i = 0; i < 100; i++) { const j = (await api('GET', '/api/import/' + id)).body; if (j.status !== 'running') return j; await new Promise((r) => setTimeout(r, 50)); } throw new Error('délai'); }

test('commentaires Notion : fils reconstruits, blocs optionnels, sans doublon', async () => {
  const { db, uid, now } = await import('../server/db.js');
  const u = db.prepare('SELECT id FROM users').get(), t = now();
  db.prepare("INSERT INTO pages(id,owner_id,kind,title,notion_id,created_at,updated_at) VALUES('p1',?,'page','Importée','page-n1',?,?)").run(u.id, t, t);
  db.prepare("INSERT INTO pages(id,owner_id,kind,title,notion_id,created_at,updated_at) VALUES('p2',?,'page','Sans commentaire','page-n2',?,?)").run(u.id, t, t);
  db.prepare("INSERT INTO blocks(id,page_id,type,content,text,position,notion_id,created_at,updated_at) VALUES('b1','p1','paragraph','{}','Du texte',0,'blk-n1',?,?)").run(t, t);

  let r = await api('POST', '/api/import/notion-comments', { token: 'secret_x' }); assert.equal(r.status, 200);
  let j = await waitJob(r.body.id); assert.equal(j.status, 'done', j.error);
  let rows = db.prepare('SELECT * FROM comments WHERE page_id=\'p1\' ORDER BY created_at, notion_id').all();
  assert.equal(rows.length, 3, 'pages seules : 3 commentaires'); // c1,c2,c3
  const c1 = rows.find((x) => x.notion_id === 'c1'), c2 = rows.find((x) => x.notion_id === 'c2'), c3 = rows.find((x) => x.notion_id === 'c3');
  assert.equal(c1.parent_id, null); assert.equal(c2.parent_id, c1.id, 'la réponse pointe sur la racine du fil'); assert.equal(c3.parent_id, null);
  assert.equal(c2.author_name, 'Bob'); assert.equal(c1.block_id, null);
  assert.equal(j.counts.comments, 2); assert.equal(j.counts.replies, 1);

  // relance avec les blocs : ajoute seulement le commentaire de bloc
  r = await api('POST', '/api/import/notion-comments', { token: 'secret_x', blocks: true }); j = await waitJob(r.body.id);
  rows = db.prepare('SELECT * FROM comments WHERE page_id=\'p1\'').all(); assert.equal(rows.length, 4);
  assert.equal(rows.find((x) => x.notion_id === 'c4').block_id, 'b1'); assert.equal(j.counts.skipped, 3);

  // intégration sans la capacité « commentaires »
  denyAll = true; r = await api('POST', '/api/import/notion-comments', { token: 'secret_x' }); j = await waitJob(r.body.id);
  assert.equal(j.status, 'error'); assert.match(j.error, /Lire les commentaires/); denyAll = false;
  // jeton manquant
  assert.equal((await api('POST', '/api/import/notion-comments', {})).status, 400);
});
