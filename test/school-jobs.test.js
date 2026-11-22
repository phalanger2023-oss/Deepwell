import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-test-s1-'));
process.env.JOB_BASE_DELAY_MS = '1'; // nouvelles tentatives quasi immédiates pour les tests

let server, base, cookie = '';
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'x-dw': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

before(async () => {
  const { app } = await import('../server/index.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); setTimeout(() => process.exit(0), 100).unref(); });

test('mode scolaire : réglage rangé dans la base, valeurs nettoyées, base ordinaire par défaut', async () => {
  assert.equal((await api('POST', '/api/auth/register', { email: 'a@x.fr', password: 'motdepasse1', name: 'A' })).status, 200);
  const db = (await api('POST', '/api/pages', { title: 'Cours', kind: 'database' })).body;
  assert.equal((await api('GET', `/api/pages/${db.id}`)).body.page.props.dw_school, undefined, 'désactivé par défaut');
  // valeurs douteuses : seules les clés connues et les vrais booléens passent ; le reste des props est conservé
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_open_full: true, dw_school: { enabled: 'oui', options: { drive: true, search: 'oui', inconnue: true } } } });
  let p = (await api('GET', `/api/pages/${db.id}`)).body.page.props;
  assert.equal(p.dw_open_full, true);
  assert.equal(p.dw_school.enabled, false, '« oui » n’est pas un booléen');
  assert.equal(p.dw_school.options.drive, true);
  assert.equal(p.dw_school.options.search, false);
  assert.equal('inconnue' in p.dw_school.options, false);
  // activer le mode, puis le désactiver : la configuration des options est conservée
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_school: { enabled: true, options: { drive: true, progress: true } } } });
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_school: { enabled: false, options: { drive: true, progress: true } } } });
  p = (await api('GET', `/api/pages/${db.id}`)).body.page.props;
  assert.equal(p.dw_school.enabled, false);
  assert.deepEqual([p.dw_school.options.drive, p.dw_school.options.progress, p.dw_school.options.pdf], [true, true, false]);
  // une valeur qui n'est pas un objet est écartée sans casser le reste
  await api('PATCH', `/api/pages/${db.id}`, { props: { dw_open_full: false, dw_school: 'x' } });
  p = (await api('GET', `/api/pages/${db.id}`)).body.page.props;
  assert.equal('dw_school' in p, false);
});

test('notes de version : réservées aux connectés, version courante = première entrée', async () => {
  const saved = cookie; cookie = '';
  assert.equal((await api('GET', '/api/releases')).status, 401);
  cookie = saved;
  const list = (await api('GET', '/api/releases')).body;
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(list[0].version, pkg.version, 'package.json et première entrée des notes de version concordent');
  for (const r of list) assert.ok(Array.isArray(r.nouveautes) && Array.isArray(r.ameliorations) && Array.isArray(r.corrections));
});

test('file de tâches : succès, nouvelle tentative, échec définitif, doublons évités, type inconnu', async () => {
  const { enqueueJob, registerJob, runDueJobs, jobStats, backoff } = await import('../server/jobs.js');
  const { db } = await import('../server/db.js');
  const status = (id) => db.prepare('SELECT status, attempts, last_error FROM jobs WHERE id=?').get(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const seen = [];
  registerJob('ok', (p) => { seen.push(p.n); });
  const a = enqueueJob('ok', { n: 1 });
  await runDueJobs();
  assert.deepEqual(seen, [1]); assert.equal(status(a).status, 'done');

  let calls = 0;
  registerJob('flaky', () => { if (++calls < 3) throw new Error('réseau coupé'); });
  const b = enqueueJob('flaky', {}, { maxAttempts: 5 });
  await runDueJobs(); assert.equal(status(b).status, 'pending'); assert.match(status(b).last_error, /réseau coupé/);
  await wait(10); await runDueJobs(); await wait(10); await runDueJobs();
  assert.deepEqual([calls, status(b).status, status(b).attempts], [3, 'done', 3]);

  registerJob('broken', () => { throw new Error('toujours en échec'); });
  const c = enqueueJob('broken', {}, { maxAttempts: 2 });
  for (let i = 0; i < 4; i++) { await wait(10); await runDueJobs(); }
  assert.deepEqual([status(c).status, status(c).attempts], ['failed', 2]);

  const d1 = enqueueJob('ok', { n: 9 }, { dedupeKey: 'x', delayMs: 60_000 }), d2 = enqueueJob('ok', { n: 9 }, { dedupeKey: 'x', delayMs: 60_000 });
  assert.equal(d1, d2, 'une tâche identique en attente n’est pas dupliquée');

  const e = enqueueJob('inconnu', {}); await runDueJobs();
  assert.equal(status(e).status, 'failed'); assert.equal(status(e).attempts, 1, 'type inconnu : pas de nouvelle tentative inutile');

  assert.ok(jobStats().done >= 2);
  assert.ok(backoff(1) <= backoff(2) && backoff(30) === 3600_000, 'délai croissant, plafonné à 1 h');
});
