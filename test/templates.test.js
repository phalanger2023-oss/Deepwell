import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-tpl-'));
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
  assert.equal((await api('POST', '/api/auth/register', { email: 'a@b.fr', name: 'A', password: 'motdepasse1' })).status, 200);
});
after(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('modèles : cycle complet (création, copie dans une ligne, @Today, exclusion des listes, suppression)', async () => {
  const db = (await api('POST', '/api/pages', { kind: 'database', title: 'Cours' })).body;
  await api('PATCH', `/api/pages/${db.id}`, { schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, Niveau: { id: 'n', name: 'Niveau', type: 'select', select: { options: [{ name: 'Bleu', color: 'blue' }] } } } });
  assert.deepEqual((await api('GET', `/api/pages/${db.id}/templates`)).body, []); // base ordinaire : pas de modèle de départ
  const t = (await api('POST', `/api/pages/${db.id}/templates`, { title: 'Fiche' })).body;
  const mention = { type: 'mention', mention: { type: 'template_mention', template_mention: { type: 'template_mention_date', template_mention_date: 'today' } }, annotations: {}, plain_text: '@Today', href: null };
  await api('PUT', `/api/pages/${t.id}/blocks`, { blocks: [{ id: '55555555-5555-4555-8555-555555555555', parent_id: null, type: 'callout', content: { rich_text: [mention], icon: null, color: 'default' } }] });
  await api('PATCH', `/api/pages/${t.id}`, { props: { Niveau: { type: 'select', select: { name: 'Bleu', color: 'blue' } } } });
  // le modèle reste invisible : lignes de la base, arbre, recherche
  assert.ok(!(await api('GET', `/api/pages/${db.id}`)).body.children.some((c) => c.id === t.id));
  assert.ok(!(await api('GET', '/api/pages/tree')).body.pages.some((p) => p.id === t.id));
  assert.ok(!(await api('GET', '/api/pages/search?q=Fiche')).body.some((p) => p.id === t.id));
  const row = (await api('POST', `/api/pages/${db.id}/from-template/${t.id}`, { today: '2026-11-22' })).body;
  const full = (await api('GET', `/api/pages/${row.id}`)).body;
  assert.equal(full.page.kind, 'page');
  assert.equal(full.page.props.Niveau.select.name, 'Bleu');
  assert.ok(!JSON.stringify(full.blocks).includes('template_mention') && JSON.stringify(full.blocks).includes('2026-11-22'));
  assert.ok((await api('GET', `/api/pages/${db.id}`)).body.children.some((c) => c.id === row.id)); // la ligne créée, elle, est bien dans la base
  // une autre base ne peut pas utiliser ce modèle
  const db2 = (await api('POST', '/api/pages', { kind: 'database', title: 'Autre' })).body;
  assert.equal((await api('POST', `/api/pages/${db2.id}/from-template/${t.id}`, {})).status, 404);
  // duplication puis suppression définitive
  const d = (await api('POST', `/api/pages/${db.id}/templates/${t.id}/duplicate`)).body;
  assert.equal((await api('GET', `/api/pages/${db.id}/templates`)).body.length, 2);
  assert.equal((await api('DELETE', `/api/pages/${d.id}`)).status, 200);
  assert.equal((await api('GET', `/api/pages/${db.id}/templates`)).body.length, 1);
});

test('modèles de départ du mode scolaire : créés une seule fois', async () => {
  const db = (await api('POST', '/api/pages', { kind: 'database', title: 'Scolaire' })).body;
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_school: { enabled: true, options: {} } } });
  const l = (await api('GET', `/api/pages/${db.id}/templates`)).body;
  assert.deepEqual(l.map((x) => x.title), ['P.S.A. #00-26-', 'Fiche de révision', 'Exercices']);
  for (const x of l) await api('DELETE', `/api/pages/${x.id}`);
  assert.deepEqual((await api('GET', `/api/pages/${db.id}/templates`)).body, []);
});
