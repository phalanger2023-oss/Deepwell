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
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_school: { enabled: true, options: {} } }, schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, 'Matière': { id: 'm', name: 'Matière', type: 'select', select: { options: [{ name: 'Français', color: 'blue' }] } } } });
  const tpls = (await api('GET', `/api/pages/${db.id}/templates`)).body, psa = tpls.find((x) => x.title.startsWith('P.S.A.'));
  const tx = (text, extra = {}) => ({ rich_text: [{ type: 'text', text: { content: text, link: null }, annotations: {}, plain_text: text, href: null }], color: 'default', ...extra });
  const mk = async (title, blocks) => { const r = (await api('POST', '/api/pages', { parent_id: db.id, title })).body; await api('PUT', `/api/pages/${r.id}/blocks`, { blocks }); return r; };
  const A = '00000000-0000-4000-8000-00000000000';
  const old = await mk('Ancien cours', [{ id: A + '1', parent_id: null, type: 'heading_1', content: tx('Addenda :', { is_toggleable: false }) }, { id: A + '2', parent_id: null, type: 'toggle', content: tx('Émanant du P.S.A.') }, { id: A + '3', parent_id: A + '2', type: 'paragraph', content: tx('texte existant') }, { id: A + '4', parent_id: null, type: 'toggle', content: tx('Lié à la P.S.A.') }, { id: A + '6', parent_id: null, type: 'button', content: { label: 'Bouton', color: 'default', actions: [] } }, { id: A + '7', parent_id: null, type: 'button', content: { label: 'Utile', color: 'default', actions: [{ type: 'notify', message: 'x' }] } }]);
  const none = await mk('Sans section', [{ id: A + '5', parent_id: null, type: 'paragraph', content: tx('rien') }]);
  const fromTpl = (await api('POST', `/api/pages/${db.id}/from-template/${psa.id}`, { today: '2026-11-22' })).body;
  const dry = (await api('POST', `/api/pages/${db.id}/architecture`, { dry: true })).body;
  assert.equal(dry.dry, true); assert.equal(dry.removed_count, 1); assert.equal(dry.tbd, 'create'); assert.deepEqual(dry.updated, ['Ancien cours']); assert.equal(dry.buttons, 2);
  assert.ok(dry.already.includes('P.S.A. #00-26- (modèle)') && dry.already.includes(fromTpl.title || 'Sans titre') || dry.already.length >= 1);
  assert.deepEqual(dry.no_section.filter((t) => t === 'Sans section'), ['Sans section']);
  assert.equal((await api('GET', `/api/pages/${old.id}`)).body.blocks.filter((b) => b.type === 'button').length, 2); // l'aperçu ne modifie rien
  const run = (await api('POST', `/api/pages/${db.id}/architecture`, { dry: false })).body; assert.deepEqual(run.updated, ['Ancien cours']);
  const bl = (await api('GET', `/api/pages/${old.id}`)).body.blocks, btns = bl.filter((b) => b.type === 'button');
  assert.deepEqual(btns.filter((b) => b.id !== A + '7').map((b) => b.parent_id).sort(), [A + '2', A + '4']);
  assert.equal(bl.filter((b) => b.parent_id === A + '2')[0].type, 'button'); // premier enfant du bloc déroulant
  assert.equal(bl.find((b) => b.id === A + '3').content.rich_text[0].plain_text, 'texte existant');
  const nb0 = btns.find((b) => b.parent_id === A + '2'); assert.equal(nb0.content.actions[0].type, 'add_subpage'); assert.ok(nb0.content.actions[0].text.includes('!> @Today'));
  assert.ok(!bl.some((b) => b.id === A + '6') && bl.some((b) => b.id === A + '7')); // bouton vide retiré, bouton avec action gardé
  const dbp = (await api('GET', `/api/pages/${db.id}`)).body.page;
  assert.equal(dbp.props.dw_defaults['Matière'].select.name, 'TBD'); assert.ok(dbp.schema['Matière'].select.options.some((o) => o.name === 'TBD'));
  const nr = (await api('POST', '/api/pages', { parent_id: db.id, title: 'Nouvelle' })).body; assert.equal(nr.props['Matière'].select.name, 'TBD'); // nouvelle ligne : TBD
  assert.equal((await api('GET', `/api/pages/${none.id}`)).body.blocks.length, 1);
  const again = (await api('POST', `/api/pages/${db.id}/architecture`, { dry: true })).body; assert.equal(again.updated.length, 0); // idempotent
});

test('création depuis un modèle : titre et valeurs imposées (colonne du Kanban) l’emportent sur le modèle', async () => {
  const d = (await api('POST', '/api/pages', { title: 'Base cartes', kind: 'database' })).body;
  const schema = { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, Statut: { id: 's', name: 'Statut', type: 'select', select: { options: [{ name: 'A', color: 'gray' }, { name: 'B', color: 'blue' }] } } };
  await api('PATCH', `/api/pages/${d.id}`, { schema });
  const t = (await api('POST', `/api/pages/${d.id}/templates`, { title: 'Mon modèle' })).body;
  const r1 = (await api('POST', `/api/pages/${d.id}/from-template/${t.id}`, { title: 'Ma carte', props: { Statut: { type: 'select', select: { name: 'B', color: 'blue' } }, dw_school: { x: 1 }, Inconnue: { type: 'select', select: null } } })).body;
  assert.equal(r1.title, 'Ma carte');
  assert.equal(r1.props.Statut.select.name, 'B');
  assert.equal(r1.props.Name.title[0].plain_text, 'Ma carte');
  assert.ok(!('dw_school' in r1.props) && !('Inconnue' in r1.props), 'clés internes ou inconnues ignorées');
  const r2 = (await api('POST', `/api/pages/${d.id}/from-template/${t.id}`, {})).body;
  assert.equal(r2.title, 'Mon modèle', 'sans titre donné : titre du modèle');
});

test('ancienne page : détection, aperçu, suppression choisie, bouton addendum, version de secours, marquage réservé au mode développeur', async () => {
  const d = (await api('POST', '/api/pages', { title: 'Recueil ancien', kind: 'database' })).body;
  await api('PATCH', `/api/pages/${d.id}`, { schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} } }, props: { dw_school: { enabled: true, options: {} } } });
  const mk = async (title) => (await api('POST', `/api/pages`, { title, parent_id: d.id })).body;
  const old = await mk('Vieux cours'), fresh = await mk('Récent');
  const DB = await import('../server/db.js');
  DB.db.prepare('UPDATE pages SET created_at=? WHERE id=?').run(Date.UTC(2026, 9, 1), old.id);
  const T = (type, text, id, parent = null, extra = {}) => ({ id, parent_id: parent, type, content: { rich_text: [{ type: 'text', text: { content: text, link: null }, plain_text: text, annotations: {} }], ...extra } });
  await api('PUT', `/api/pages/${old.id}/blocks`, { blocks: [T('heading_1', 'Cours :', 'a'), T('toggle', 'Original :', 'b'), T('paragraph', 'texte interne', 'c', 'b'), T('toggle', 'Modifié :', 'e'), T('heading_1', 'Addenda :', 'f'), T('toggle', 'Émanant du P.S.A.', 'g')] });
  assert.equal((await api('GET', `/api/pages/${old.id}/modernize`)).body.legacy, true);
  assert.equal((await api('GET', `/api/pages/${fresh.id}/modernize`)).body.legacy, false, 'une page récente n’est jamais concernée');
  const plan = (await api('POST', `/api/pages/${old.id}/modernize`, { dry: true })).body;
  assert.deepEqual(plan.blocks.filter((b) => b.suggested).map((b) => b.id), ['b', 'e']);
  assert.equal(plan.blocks.find((b) => b.id === 'b').size, 2);
  const r = (await api('POST', `/api/pages/${old.id}/modernize`, { dry: false, remove: ['b', 'e'] })).body;
  assert.equal(r.removed, 3); assert.equal(r.buttons, 1);
  const rest = (await api('GET', `/api/pages/${old.id}`)).body.blocks;
  assert.deepEqual(rest.filter((b) => !b.parent_id).map((b) => b.id).sort(), ['a', 'f', 'g']);
  assert.ok(rest.some((b) => b.type === 'button' && b.parent_id === 'g'));
  assert.equal((await api('GET', `/api/pages/${old.id}/modernize`)).body.legacy, false, 'plus de pastille ni de bouton ensuite');
  assert.equal((await api('POST', `/api/pages/${old.id}/modernize`, { dry: true })).status, 409);
  // marquage manuel : refusé hors mode développeur
  const old2 = await mk('Autre ancien'); DB.db.prepare('UPDATE pages SET created_at=? WHERE id=?').run(Date.UTC(2026, 9, 1), old2.id);
  assert.equal((await api('POST', `/api/pages/${old2.id}/modernize/mark`)).status, 403);
  DB.setSetting('dev_mode', '1');
  assert.equal((await api('POST', `/api/pages/${old2.id}/modernize/mark`)).status, 200);
  assert.equal((await api('GET', `/api/pages/${old2.id}/modernize`)).body.legacy, false);
  DB.setSetting('dev_mode', '0');
});

test('lignes d’une base scolaire : drapeau « legacy » renvoyé pour les anciennes pages seulement', async () => {
  const d = (await api('POST', '/api/pages', { title: 'Recueil flag', kind: 'database' })).body;
  await api('PATCH', `/api/pages/${d.id}`, { schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} } }, props: { dw_school: { enabled: true, options: {} } } });
  const o = (await api('POST', '/api/pages', { title: 'Ancienne', parent_id: d.id })).body, n = (await api('POST', '/api/pages', { title: 'Nouvelle', parent_id: d.id })).body;
  (await import('../server/db.js')).db.prepare('UPDATE pages SET created_at=? WHERE id=?').run(Date.UTC(2026, 9, 1), o.id);
  const kids = (await api('GET', `/api/pages/${d.id}`)).body.children;
  assert.equal(kids.find((k) => k.id === o.id).legacy, true); assert.ok(!kids.find((k) => k.id === n.id).legacy);
  assert.ok(!('created_at' in kids[0]), 'created_at n’est pas exposé');
});

test('architecture de référence : capture réservée au mode développeur, reconstruction de l’ancienne page avec recasement du contenu', async () => {
  const d = (await api('POST', '/api/pages', { title: 'Recueil réf', kind: 'database' })).body;
  await api('PATCH', `/api/pages/${d.id}`, { schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} } }, props: { dw_school: { enabled: true, options: {} } } });
  const mk = async (title) => (await api('POST', `/api/pages`, { title, parent_id: d.id })).body;
  const ref = await mk('P.S.A. #0001-26-MTH'), old = await mk('Vieux');
  const DB = await import('../server/db.js');
  DB.db.prepare('UPDATE pages SET created_at=? WHERE id=?').run(Date.UTC(2026, 9, 1), old.id);
  const T = (type, text, id, parent = null, extra = {}) => ({ id, parent_id: parent, type, content: { rich_text: text ? [{ type: 'text', text: { content: text, link: null }, plain_text: text, annotations: {} }] : [], ...extra } });
  await api('PUT', `/api/pages/${ref.id}/blocks`, { blocks: [T('heading_1', 'Cours', 'r1'), T('paragraph', 'texte du modèle', 'r1p'), T('divider', '', 'r2'), T('heading_1', 'Addenda', 'r3'), T('toggle', 'Émanant du P.S.A.', 'r4'), { id: 'r5', parent_id: 'r4', type: 'button', content: { label: 'Nouvel addendum', actions: [{ type: 'add_subpage', title: 'x', text: '', where: 'below' }] } }, T('toggle', 'Lié à la P.S.A.', 'r6')] });
  assert.equal((await api('POST', `/api/pages/${ref.id}/arch-reference`)).status, 403, 'réservé au mode développeur');
  DB.setSetting('dev_mode', '1');
  const cap = (await api('POST', `/api/pages/${ref.id}/arch-reference`)).body; assert.equal(cap.ok, true, JSON.stringify(cap));
  const dbp = (await api('GET', `/api/pages/${d.id}`)).body.page; assert.equal(dbp.props.dw_default_template, cap.template_id, 'devient le modèle par défaut');
  const nc = (await api('POST', `/api/pages/${d.id}/from-template/${cap.template_id}`, { title: 'Nouvelle carte' })).body;
  const nb = (await api('GET', `/api/pages/${nc.id}`)).body.blocks, ntxt = (b) => (b.content.rich_text || []).map((x) => x.plain_text).join('');
  assert.ok(nb.some((b) => ntxt(b) === 'Émanant du P.S.A.') && !nb.some((b) => ntxt(b) === 'texte du modèle'), 'nouvelle carte = structure de la référence, sans son texte');
  const cap2 = (await api('POST', `/api/pages/${ref.id}/arch-reference`)).body;
  assert.equal((await api('GET', `/api/pages/${d.id}/templates`)).body.filter((t) => t.title === 'Architecture de référence').length, 1, 'un seul modèle de référence, remplacé à chaque définition'); assert.notEqual(cap2.template_id, cap.template_id);
  await api('PUT', `/api/pages/${old.id}/blocks`, { blocks: [T('paragraph', 'Note orpheline', 'xz'), T('heading_1', 'Cours :', 'xa'), T('heading_2', 'Original :', 'xb', null, { is_toggleable: true }), T('paragraph', 'ancien texte', 'xbp', 'xb'), T('paragraph', 'Mon cours important', 'xc'), T('heading_1', 'Addenda :', 'xf'), T('toggle', 'Émanant du P.S.A.', 'xg'), T('paragraph', 'addendum perdu', 'xgp', 'xg')] });
  const plan = (await api('POST', `/api/pages/${old.id}/modernize`, { dry: true })).body; assert.equal(plan.reference, 'P.S.A. #0001-26-MTH');
  const r = (await api('POST', `/api/pages/${old.id}/modernize`, { dry: false, remove: ['xb'] })).body; assert.equal(r.rebuilt, true);
  const got = (await api('GET', `/api/pages/${old.id}`)).body.blocks;
  const txt = (b) => (b.content.rich_text || []).map((x) => x.plain_text).join('');
  const by = (t) => got.find((b) => txt(b) === t);
  assert.ok(by('Cours') && by('Addenda') && by('Émanant du P.S.A.') && by('Lié à la P.S.A.'), 'structure de la référence');
  assert.ok(!by('texte du modèle'), 'le texte de la référence n’est pas copié');
  assert.ok(!by('ancien texte'), 'Original/Modifié coché : retiré');
  assert.equal(by('Mon cours important').parent_id ?? null, null, 'recasé après le titre « Cours » (titre non déroulant)');
  const idx = (t) => got.findIndex((b) => txt(b) === t);
  assert.ok(idx('Cours') < idx('Mon cours important') && idx('Mon cours important') < idx('Addenda'));
  assert.equal(by('addendum perdu').parent_id, by('Émanant du P.S.A.').id, 'recasé dans le bloc déroulant de même nom');
  assert.ok(idx('À classer') > idx('Lié à la P.S.A.') && by('Note orpheline'), 'le reste en bas sous « À classer »');
  assert.equal(got.filter((b) => b.type === 'button').length, 1, 'un seul bouton (celui de la référence)');
});

test('mode développeur : « Marquer comme à mettre à jour » remet la pastille sur une carte récente', async () => {
  const d = (await api('POST', '/api/pages', { title: 'Recueil unmark', kind: 'database' })).body;
  await api('PATCH', `/api/pages/${d.id}`, { schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} } }, props: { dw_school: { enabled: true, options: {} } } });
  const c = (await api('POST', '/api/pages', { title: 'Récente', parent_id: d.id })).body;
  const DB = await import('../server/db.js');
  DB.setSetting('dev_mode', '0'); assert.equal((await api('POST', `/api/pages/${c.id}/modernize/unmark`)).status, 403);
  DB.setSetting('dev_mode', '1');
  assert.equal((await api('GET', `/api/pages/${c.id}/modernize`)).body.legacy, false);
  assert.equal((await api('POST', `/api/pages/${c.id}/modernize/unmark`)).status, 200);
  assert.equal((await api('GET', `/api/pages/${c.id}/modernize`)).body.legacy, true);
  assert.equal((await api('GET', `/api/pages/${d.id}`)).body.children.find((k) => k.id === c.id).legacy, true, 'pastille dans les vues');
  await api('POST', `/api/pages/${c.id}/modernize/mark`); assert.equal((await api('GET', `/api/pages/${c.id}/modernize`)).body.legacy, false);
});

test('architecture de référence : l\'espace (bloc de texte vide) entre deux listes dépliantes est conservé', async () => {
  const { captureReference, rebuildFromReference } = await import('../server/templates.js');
  const rt = (t) => (t ? [{ type: 'text', text: { content: t, link: null }, plain_text: t, annotations: {} }] : []);
  const B = (id, type, content = {}, parent = null) => ({ id, parent_id: parent, type, content });
  const ref = [B('1', 'toggle', { rich_text: rt('Émanant') }), B('2', 'paragraph', { rich_text: [] }, '1'), B('3', 'paragraph', { rich_text: [] }), B('4', 'toggle', { rich_text: rt('Lié') }), B('5', 'paragraph', { rich_text: rt('texte du cours') })];
  const tree = captureReference(ref);
  assert.deepEqual(tree.map((n) => n.type), ['toggle', 'paragraph', 'toggle']); // l'espace du milieu est gardé, le texte du cours non
  const out = rebuildFromReference(tree, [B('a', 'toggle', { rich_text: rt('Émanant') }), B('b', 'paragraph', { rich_text: rt('contenu') }, 'a')]);
  const roots = out.filter((b) => !b.parent_id).map((b) => b.type);
  assert.deepEqual(roots, ['toggle', 'paragraph', 'toggle']);
  assert.ok(out.some((b) => b.type === 'paragraph' && b.parent_id && JSON.stringify(b.content).includes('contenu'))); // le contenu de l'ancienne page est recasé dans le toggle
});
