import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-test-status-'));
let server, base; const cookies = {};
async function api(who, method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'x-dw': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookies[who] ? { Cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookies[who] = set.split(';')[0];
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
before(async () => {
  const { app } = await import('../server/index.js');
  await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); }); base = `http://127.0.0.1:${server.address().port}`;
  await api('admin', 'POST', '/api/auth/register', { email: 'admin@t.fr', password: 'motdepasse1', name: 'Admin' });
});
after(() => server?.close());

test('ping : sans compte, rapide, jamais mis en cache', async () => {
  const r = await fetch(`${base}/api/ping`);
  assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /no-store/);
  const { t } = await r.json(); assert.ok(Math.abs(Date.now() - t) < 5000);
});

test('état du serveur : réservé à l’administrateur, valeurs cohérentes', async () => {
  assert.equal((await api('anon', 'GET', '/api/admin/status')).status, 401);
  await api('admin', 'POST', '/api/auth/register', { email: 'm@t.fr', password: 'motdepasse1' }); // inscriptions fermées : 403, le compte reste admin
  await api('admin', 'GET', '/api/pages/tree');
  const { status, body: s } = await api('admin', 'GET', '/api/admin/status');
  assert.equal(status, 200);
  assert.ok(s.uptime_s >= 0 && s.node.startsWith('v') && s.cpu.cores >= 1 && s.cpu.load.length === 3);
  assert.ok(s.memory.rss > 0 && s.memory.system_total > s.memory.system_free);
  assert.ok(s.counts.users === 1 && s.counts.sessions >= 1);
  assert.ok(s.requests.sampled >= 1 && s.requests.avg_ms >= 0 && s.requests.p95_ms >= s.requests.p50_ms);
  assert.ok(typeof s.event_loop_lag_ms === 'number' && s.db.size > 0);
});

test('jeu de π : historique par compte, validation, effacement', async () => {
  assert.equal((await api('anon', 'GET', '/api/pi')).status, 401);
  assert.equal((await api('admin', 'POST', '/api/pi', { mode: 'triche', digits: 5 })).status, 400);
  await api('admin', 'POST', '/api/pi', { mode: 'recall', digits: 42, target: 50, seconds: 33.3, errors: 1 });
  await api('admin', 'POST', '/api/pi', { mode: 'recall', digits: 17, target: 20, seconds: 9, errors: 0 });
  await api('admin', 'POST', '/api/pi', { mode: 'learn', digits: 30, target: 30, seconds: 120, errors: 0 });
  const g = (await api('admin', 'GET', '/api/pi')).body;
  assert.equal(g.runs.length, 3); assert.equal(g.best, 42); assert.equal(g.runs[0].mode, 'learn');
  await api('admin', 'POST', '/api/pi', { mode: 'recall', digits: 99999999, target: 1, seconds: -5, errors: -3 });
  const clamped = (await api('admin', 'GET', '/api/pi')).body.runs.find((r) => r.target === 1);
  assert.equal(clamped.digits, 100000); assert.equal(clamped.seconds, 0); assert.equal(clamped.errors, 0);
  await api('admin', 'DELETE', '/api/pi');
  assert.equal((await api('admin', 'GET', '/api/pi')).body.runs.length, 0);
});

test('décimales de π : 1000 décimales exactes', async () => {
  const { piDigits } = await import('../public/js/pigame.js');
  const d = piDigits(1000);
  assert.equal(d.length, 1000);
  assert.equal(d.slice(0, 50), '14159265358979323846264338327950288419716939937510');
  assert.equal(d.slice(990), '2164201989'); // décimales 991 à 1000
});
