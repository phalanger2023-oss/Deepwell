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

test('valeurs par défaut : nouvelle ligne, modèle prioritaire, valeurs périmées ignorées', async () => {
  const db = (await api('POST', '/api/pages', { kind: 'database', title: 'Taches' })).body;
  const sel = (n) => ({ type: 'select', select: { name: n, color: 'blue' } });
  await api('PATCH', `/api/pages/${db.id}`, {
    schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, Statut: { id: 's', name: 'Statut', type: 'select', select: { options: [{ name: 'A faire', color: 'gray' }, { name: 'Fini', color: 'green' }] } }, Prio: { id: 'p', name: 'Prio', type: 'select', select: { options: [{ name: 'Haute', color: 'red' }] } } },
    props: { dw_defaults: { Statut: sel('A faire'), Prio: sel('Haute'), Disparue: sel('X'), Name: { type: 'title', title: [] } } },
  });
  const r1 = (await api('POST', '/api/pages', { parent_id: db.id, title: 'T1' })).body;
  assert.equal(r1.props.Statut.select.name, 'A faire');
  assert.equal(r1.props.Prio.select.name, 'Haute');
  assert.ok(!('Disparue' in r1.props) && !('Name' in r1.props)); // propriété supprimée / titre : ignorées
  // un modèle qui définit Statut garde sa valeur ; Prio vient du défaut
  const t = (await api('POST', `/api/pages/${db.id}/templates`, { title: 'Modele' })).body;
  await api('PATCH', `/api/pages/${t.id}`, { props: { Statut: sel('Fini') } });
  const r2 = (await api('POST', `/api/pages/${db.id}/from-template/${t.id}`, { today: '2026-11-22' })).body;
  assert.equal(r2.props.Statut.select.name, 'Fini');
  assert.equal(r2.props.Prio.select.name, 'Haute');
  // un type devenu différent n'est plus appliqué
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_defaults: { Statut: { type: 'number', number: 3 } } } });
  assert.ok(!('Statut' in (await api('POST', '/api/pages', { parent_id: db.id, title: 'T3' })).body.props));
});

test('boutons « Nouvel addendum » : aperçu, ajout dans les blocs déroulants, pages déjà équipées ou sans section laissées', async () => {
  const db = (await api('POST', '/api/pages', { kind: 'database', title: 'Scolaire2' })).body;
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_school: { enabled: true, options: {} } } });
  const tpls = (await api('GET', `/api/pages/${db.id}/templates`)).body, psa = tpls.find((x) => x.title.startsWith('P.S.A.'));
  const tx = (text, extra = {}) => ({ rich_text: [{ type: 'text', text: { content: text, link: null }, annotations: {}, plain_text: text, href: null }], color: 'default', ...extra });
  const mk = async (title, blocks) => { const r = (await api('POST', '/api/pages', { parent_id: db.id, title })).body; await api('PUT', `/api/pages/${r.id}/blocks`, { blocks }); return r; };
  const A = '00000000-0000-4000-8000-00000000000';
  const old = await mk('Ancien cours', [{ id: A + '1', parent_id: null, type: 'heading_1', content: tx('Addenda :', { is_toggleable: false }) }, { id: A + '2', parent_id: null, type: 'toggle', content: tx('Émanant du P.S.A.') }, { id: A + '3', parent_id: A + '2', type: 'paragraph', content: tx('texte existant') }, { id: A + '4', parent_id: null, type: 'toggle', content: tx('Lié à la P.S.A.') }]);
  const none = await mk('Sans section', [{ id: A + '5', parent_id: null, type: 'paragraph', content: tx('rien') }]);
  const fromTpl = (await api('POST', `/api/pages/${db.id}/from-template/${psa.id}`, { today: '2026-11-22' })).body;
  const dry = (await api('POST', `/api/pages/${db.id}/addenda-buttons`, { dry: true })).body;
  assert.equal(dry.dry, true); assert.deepEqual(dry.updated, ['Ancien cours']); assert.equal(dry.buttons, 2);
  assert.ok(dry.already.includes('P.S.A. #00-26- (modèle)') && dry.already.includes(fromTpl.title || 'Sans titre') || dry.already.length >= 1);
  assert.deepEqual(dry.no_section.filter((t) => t === 'Sans section'), ['Sans section']);
  assert.equal((await api('GET', `/api/pages/${old.id}`)).body.blocks.filter((b) => b.type === 'button').length, 0); // l'aperçu ne modifie rien
  const run = (await api('POST', `/api/pages/${db.id}/addenda-buttons`, { dry: false })).body; assert.deepEqual(run.updated, ['Ancien cours']);
  const bl = (await api('GET', `/api/pages/${old.id}`)).body.blocks, btns = bl.filter((b) => b.type === 'button');
  assert.deepEqual(btns.map((b) => b.parent_id).sort(), [A + '2', A + '4']);
  assert.equal(bl.filter((b) => b.parent_id === A + '2')[0].type, 'button'); // premier enfant du bloc déroulant
  assert.equal(bl.find((b) => b.id === A + '3').content.rich_text[0].plain_text, 'texte existant');
  assert.equal(btns[0].content.actions[0].type, 'add_subpage'); assert.ok(btns[0].content.actions[0].text.includes('!> @Today'));
  assert.equal((await api('GET', `/api/pages/${none.id}`)).body.blocks.length, 1);
  const again = (await api('POST', `/api/pages/${db.id}/addenda-buttons`, { dry: true })).body; assert.equal(again.updated.length, 0); // idempotent
});
