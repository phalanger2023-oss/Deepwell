import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-act-'));
process.env.DATA_DIR = dir;
let server, base, DB;
async function call(cookie, method, url, body, headers = {}) {
  const r = await fetch(base + url, { method, headers: { 'x-dw': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, set: r.headers.get('set-cookie') };
}
before(async () => {
  const { app } = await import('../server/index.js'); DB = (await import('../server/db.js')).db;
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('sessions 90 j / 30 j, journal, consultations par lien public avec temps passé, droits admin', async () => {
  const reg = await call(null, 'POST', '/api/auth/register', { email: 'a@b.fr', name: 'Admin', password: 'motdepasse1' });
  const admin = reg.set.split(';')[0];
  assert.match(reg.set, /Max-Age=7776000/); // 90 j
  const short = await call(null, 'POST', '/api/auth/login', { email: 'a@b.fr', password: 'motdepasse1', remember: false });
  assert.match(short.set, /Max-Age=2592000/); // 30 j
  const bad = await call(null, 'POST', '/api/auth/login', { email: 'a@b.fr', password: 'faux-faux-faux' });
  assert.equal(bad.status, 401);
  // page partagée par lien public
  const pg = (await call(admin, 'POST', '/api/pages', { title: 'Cours partagé' })).body;
  const tk = (await call(admin, 'POST', `/api/pages/${pg.id}/shares`, { public: true })).body.public_token;
  assert.ok(tk);
  // visiteur sans compte : 1er battement crée la consultation, les suivants cumulent le temps (écart simulé)
  const v1 = (await call(null, 'POST', '/api/activity', { page_id: pg.id, token: tk }, { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' })).body;
  assert.ok(v1.ok && v1.visit);
  DB.prepare('UPDATE visits SET last_seen=last_seen-30000 WHERE id=?').run(v1.visit);
  const v2 = (await call(null, 'POST', '/api/activity', { page_id: pg.id, token: tk, visit: v1.visit }, { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' })).body;
  assert.equal(v2.visit, v1.visit);
  const row = DB.prepare('SELECT seconds,pings,actor FROM visits WHERE id=?').get(v1.visit);
  assert.equal(row.actor, 'link'); assert.equal(row.pings, 2); assert.ok(row.seconds >= 29 && row.seconds <= 31);
  // mauvais jeton / page inconnue : rien d'enregistré
  assert.equal((await call(null, 'POST', '/api/activity', { page_id: pg.id, token: 'nope' })).body.ok, false);
  assert.equal(DB.prepare('SELECT COUNT(*) c FROM visits').get().c, 1);
  // le propriétaire consulte sa page : consultation « compte »
  await call(admin, 'POST', '/api/activity', { page_id: pg.id });
  // vues d'administration
  const vis = (await call(admin, 'GET', '/api/admin/activity/visits?days=7')).body;
  assert.equal(vis.pages[0].visits, 2); assert.equal(vis.pages[0].page_title, 'Cours partagé'); assert.equal(vis.visits.find((v) => v.actor === 'link').device, 'Chrome · Android');
  assert.equal((await call(admin, 'GET', '/api/admin/activity/visits?kind=link')).body.visits.length, 1);
  const log = (await call(admin, 'GET', '/api/admin/activity/log')).body.map((l) => l.kind);
  assert.ok(log.includes('login') && log.includes('login_fail') && log.includes('register'));
  const ses = (await call(admin, 'GET', '/api/admin/activity/sessions')).body;
  assert.equal(ses.length, 2); assert.equal(ses.filter((s) => s.current).length, 1);
  // révocation d'une session
  const other = ses.find((s) => !s.current);
  assert.equal((await call(admin, 'DELETE', `/api/admin/activity/sessions/${other.id}`)).status, 200);
  assert.equal((await call(short.set.split(';')[0], 'GET', '/api/pages/tree')).status, 401);
  // non-admin : refusé
  await call(admin, 'PUT', '/api/settings', { allow_signup: '1' });
  const m = (await call(null, 'POST', '/api/auth/register', { email: 'm@b.fr', password: 'motdepasse1' })).set.split(';')[0];
  assert.equal((await call(m, 'GET', '/api/admin/activity/visits')).status, 403);
});
