import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-lock-'));
process.env.DATA_DIR = dir;
let server, base, cookie = '';
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'x-dw': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
before(async () => {
  const { app } = await import('../server/index.js');
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/register', { email: 'l@b.fr', name: 'L', password: 'motdepasse1' })).status, 200);
});
after(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('lignes verrouillées d\'une base : masquées, code partagé entre pages, reverrouillage', async () => {
  const db = (await api('POST', '/api/pages', { kind: 'database', title: 'Dossiers' })).body;
  const mk = async (title) => { const r = (await api('POST', '/api/pages', { parent_id: db.id, title })).body; await api('PATCH', `/api/pages/${r.id}`, { props: { Statut: { type: 'select', select: { name: 'Secret' } } } }); return r; };
  const [a, b, c, d] = [await mk('Alpha-secret'), await mk('Bravo-secret'), await mk('Charlie-secret'), await mk('Delta-public')];
  assert.equal((await api('PUT', `/api/pages/${a.id}/lock`, { pin: '1234', idle_min: 5 })).status, 200);
  assert.equal((await api('PUT', `/api/pages/${b.id}/lock`, { pin: '1234', idle_min: 0 })).status, 200); // même code, autres réglages
  assert.equal((await api('PUT', `/api/pages/${c.id}/lock`, { pin: '9999' })).status, 200);
  await api('POST', `/api/pages/${a.id}/lock/now`); // tout est refermé (a, b, c)
  let kids = (await api('GET', `/api/pages/${db.id}`)).body.children;
  const byId = Object.fromEntries(kids.map((k) => [k.id, k]));
  for (const x of [a, b, c]) { assert.equal(byId[x.id].locked, true); assert.equal(byId[x.id].title, ''); assert.deepEqual(byId[x.id].props, {}); }
  assert.equal(byId[d.id].title, 'Delta-public'); assert.ok(!byId[d.id].locked);
  assert.ok(!JSON.stringify([a, b, c].map((x) => byId[x.id])).match(/secret/i));
  // arbre et recherche : titres introuvables
  assert.ok(!JSON.stringify((await api('GET', '/api/pages/tree')).body).includes('Alpha-secret'));
  assert.equal((await api('GET', '/api/pages/search?q=Alpha')).body.length, 0);
  // écriture à l'aveugle refusée
  assert.equal((await api('PATCH', `/api/pages/${a.id}`, { props: {} })).status, 423);
  assert.equal((await api('PATCH', `/api/pages/${a.id}`, { title: 'x' })).status, 423);
  // l'écran du code n'affiche pas le titre d'une ligne
  assert.equal((await api('GET', `/api/pages/${a.id}`)).body.page.title, '');
  // mauvais code
  assert.equal((await api('POST', `/api/pages/${a.id}/lock/unlock`, { pin: '0000' })).status, 403);
  // bon code sur A : B (même code) s'ouvre aussi, pas C
  assert.equal((await api('POST', `/api/pages/${a.id}/lock/unlock`, { pin: '1234' })).status, 200);
  kids = (await api('GET', `/api/pages/${db.id}`)).body.children;
  const k2 = Object.fromEntries(kids.map((k) => [k.id, k]));
  assert.equal(k2[a.id].title, 'Alpha-secret'); assert.equal(k2[b.id].title, 'Bravo-secret'); assert.equal(k2[b.id].props.Statut.select.name, 'Secret');
  assert.equal(k2[c.id].locked, true);
  assert.equal((await api('GET', `/api/pages/${b.id}`)).status, 200);
  assert.equal((await api('GET', `/api/pages/${c.id}`)).status, 423);
  // « verrouiller maintenant » referme aussi les pages ouvertes par le même code
  await api('POST', `/api/pages/${a.id}/lock/now`);
  assert.equal((await api('GET', `/api/pages/${b.id}`)).status, 423);
  // durée par défaut : 24 h
  assert.equal((await api('GET', `/api/pages/${c.id}/lock`)).body.idle_min, 1440);
});
