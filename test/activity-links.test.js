import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-act-'));
process.env.DATA_DIR = dir;
let server, base, cookie = '', db, now;
async function api(method, url, body, opt = {}) {
  const r = await fetch(base + url, { method, headers: { 'x-dw': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(!opt.anon && cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set && !opt.anon) cookie = set.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j };
}
before(async () => {
  ({ db, now } = await import('../server/db.js'));
  const { app } = await import('../server/index.js');
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/register', { email: 'admin@test.fr', name: 'Admin', password: 'motdepasse1' })).status, 200);
});
after(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('journal : localisation estimée par IP et recherche libre', async () => {
  const u = db.prepare('SELECT id FROM users').get();
  const ins = db.prepare('INSERT INTO connection_log(id,at,kind,user_id,email,ip,ua) VALUES(?,?,?,?,?,?,?)');
  ins.run('l1', now() - 1000, 'login', u.id, 'admin@test.fr', '81.2.69.142', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537');
  ins.run('l2', now() - 2000, 'login_fail', null, 'intrus@mal.fr', '8.8.8.8', 'curl/8');
  ins.run('l3', now() - 3000, 'login', u.id, 'admin@test.fr', '192.168.1.20', 'Mozilla/5.0 (Android) Chrome/120');
  const get = async (q) => (await api('GET', '/api/admin/activity/log?' + q)).body;
  const all = await get('days=30'); assert.ok(all.length >= 3);
  const a = all.find((r) => r.ip === '81.2.69.142'); assert.match(a.geo, /St Albans/); assert.match(a.geo, /Royaume-Uni/);
  assert.equal(all.find((r) => r.ip === '192.168.1.20').geo, 'Réseau local');
  assert.deepEqual((await get('q=8.8.8.8')).map((r) => r.ip), ['8.8.8.8'], 'par IP');
  assert.ok((await get('q=intrus')).every((r) => r.email === 'intrus@mal.fr'), 'par compte');
  assert.ok((await get('q=royaume%20uni')).some((r) => r.ip === '81.2.69.142'), 'par localisation, sans accent ni casse');
  assert.ok((await get('q=%C3%A9chec')).every((r) => r.kind === 'login_fail'), 'par type');
  assert.ok((await get('q=android')).every((r) => /Android/.test(r.device)), 'par appareil');
  assert.deepEqual((await get('kind=login_fail&days=30')).map((r) => r.kind), ['login_fail']);
});

test('suivi de lien, statistiques de page et fiche de compte', async () => {
  const me = (await api('GET', '/api/auth/me')).body.user ?? (await api('GET', '/api/auth/me')).body;
  const page = (await api('POST', '/api/pages', { title: 'Page suivie' })).body;
  // un lien non suivi ne produit rien
  let r = await api('POST', '/api/activity/link', { page_id: page.id, url: 'https://exemple.fr/a' }); assert.equal(r.body.ok, false);
  // l'admin active le suivi
  r = await api('PUT', '/api/admin/activity/links', { page_id: page.id, url: 'https://exemple.fr/a', on: true }); assert.equal(r.body.tracked, true);
  r = await api('PUT', '/api/admin/activity/links', { page_id: page.id, url: 'javascript:alert(1)', on: true }); assert.equal(r.status, 400, 'schéma refusé');
  assert.deepEqual((await api('GET', `/api/activity/links?page_id=${page.id}`)).body.urls, ['https://exemple.fr/a']);
  // clic de l'admin
  assert.equal((await api('POST', '/api/activity/link', { page_id: page.id, url: 'https://exemple.fr/a' })).body.ok, true);
  // un visiteur sans compte n'a pas accès à la page (privée) : aucun clic enregistré
  assert.equal((await api('POST', '/api/activity/link', { page_id: page.id, url: 'https://exemple.fr/a' }, { anon: true })).body.ok, false);
  // lien public : le visiteur anonyme clique
  const sh = (await api('POST', `/api/pages/${page.id}/shares`, { public: true }));
  const tok = sh.body?.public_token || sh.body?.token || db.prepare('SELECT public_token FROM shares WHERE page_id=? AND public_token IS NOT NULL').get(page.id)?.public_token;
  if (tok) {
    assert.equal((await api('POST', '/api/activity/link', { page_id: page.id, url: 'https://exemple.fr/a', token: tok }, { anon: true })).body.ok, true);
    await api('POST', '/api/activity', { page_id: page.id, token: tok }, { anon: true });
  }
  await api('POST', '/api/activity', { page_id: page.id }); // consultation de l'admin
  const st = (await api('GET', `/api/admin/activity/page/${page.id}`)).body;
  assert.equal(st.page.title, 'Page suivie'); assert.ok(st.visits >= 1); assert.equal(st.links.length, 1);
  assert.equal(st.links[0].clicks_total, tok ? 2 : 1);
  assert.ok(st.links[0].clicks.some((c) => c.who === 'Admin')); if (tok) assert.ok(st.links[0].clicks.some((c) => /public/.test(c.who)));
  assert.equal(st.per_day.length, 30); assert.ok(st.people.length >= 1); assert.ok('comments' in st.interactions);
  const acc = (await api('GET', `/api/admin/activity/account/${db.prepare('SELECT id FROM users').get().id}`)).body;
  assert.ok(acc.pages.some((p) => p.page_id === page.id), 'pages consultées par le compte');
  assert.ok(acc.log.length >= 1);
  // désactivation
  await api('PUT', '/api/admin/activity/links', { page_id: page.id, url: 'https://exemple.fr/a', on: false });
  assert.deepEqual((await api('GET', `/api/activity/links?page_id=${page.id}`)).body.urls, []);
});

test('réservé à l’administrateur', async () => {
  for (const u of ['/api/admin/activity/log', '/api/admin/activity/page/x', '/api/admin/activity/account/x']) assert.equal((await api('GET', u, null, { anon: true })).status, 401);
});
