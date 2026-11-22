import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-gcal-'));
process.env.DATA_DIR = dir; process.env.JOB_BASE_DELAY_MS = '1';
process.env.GOOGLE_CLIENT_ID = 'id'; process.env.GOOGLE_CLIENT_SECRET = 'secret'; process.env.PUBLIC_URL = 'https://dw.test';

// ---- faux Google Agenda (en mémoire) ----
const CAL = new Map(); let seq = 0, down = false; const calls = [];
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!/googleapis\.com/.test(u)) return realFetch(url, opts);
  if (u.includes('oauth2.googleapis.com/token')) return J({ access_token: 'tok', expires_in: 3600 });
  calls.push(`${opts.method || 'GET'} ${new URL(u).pathname}`);
  if (down) return J({ error: { message: 'panne simulée' } }, 503);
  const m = opts.method || 'GET', p = new URL(u).pathname, body = opts.body ? JSON.parse(opts.body) : null;
  if (p === '/calendar/v3/calendars' && m === 'POST') { const id = `cal${++seq}@group.calendar.google.com`; CAL.set(id, { summary: body.summary, events: new Map() }); return J({ id, summary: body.summary }); }
  const mm = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(p);
  if (mm) {
    const cal = CAL.get(decodeURIComponent(mm[1])); if (!cal) return J({ error: { message: 'Not Found' } }, 404);
    if (m === 'POST') { const id = `ev${++seq}`; cal.events.set(id, { id, ...body }); return J({ id }); }
    const ev = cal.events.get(decodeURIComponent(mm[2])); if (!ev) return J({ error: { message: 'Not Found' } }, 404);
    if (m === 'PATCH') { Object.assign(ev, body); return J({ id: ev.id }); }
    if (m === 'DELETE') { cal.events.delete(ev.id); return new Response(null, { status: 204 }); }
  }
  return J({ error: { message: 'route inconnue ' + p } }, 404);
};

let server, base, cookie = '', DB, jobs, enc;
async function api(method, url, body) {
  const r = await realFetch(base + url, { method, headers: { 'x-dw': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; } return { status: r.status, body: json };
}
const flush = async () => { DB.prepare("UPDATE jobs SET next_run_at=0 WHERE status='pending'").run(); for (let i = 0; i < 4; i++) await jobs.runDueJobs(); };
const events = () => [...CAL.values()].flatMap((c) => [...c.events.values()]);
const date = (start, end = null) => ({ type: 'date', date: { start, end, time_zone: null } });

before(async () => {
  const { app } = await import('../server/index.js'); DB = (await import('../server/db.js')).db; jobs = await import('../server/jobs.js'); enc = (await import('../server/drive.js')).enc;
  server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/register', { email: 'g@b.fr', name: 'G', password: 'motdepasse1' })).status, 200);
});
after(() => { server?.close(); globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

test('Google Agenda : création, modification, suppression, verrouillage, agenda supprimé, désactivation', async () => {
  const uidv = DB.prepare('SELECT id FROM users').get().id;
  const dbp = (await api('POST', '/api/pages', { kind: 'database', title: 'Agenda' })).body;
  await api('PATCH', `/api/pages/${dbp.id}`, { schema: { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, Date: { id: 'd', name: 'Date', type: 'date', date: {} }, Matière: { id: 'm', name: 'Matière', type: 'select', select: { options: [] } } } });
  const mk = async (title, d, extra = {}) => { const r = (await api('POST', '/api/pages', { parent_id: dbp.id, title })).body; await api('PATCH', `/api/pages/${r.id}`, { props: { Date: d, ...extra } }); return r; };
  const hw = await mk('Devoir de maths p.12', date('2026-12-01'), { Matière: { type: 'select', select: { name: 'Maths' } } });
  const exam = await mk('Présentation orale', date('2026-12-03T14:00:00.000+01:00'));
  const stage = await mk('Stage', date('2026-12-07', '2026-12-09'));
  const wall = await mk('Réunion', date('2026-12-04T09:30', '2026-12-04T11:00'));
  const nodate = await mk('Sans date', null);
  const secret = await mk('Page secrète', date('2026-12-05'));
  await api('PUT', `/api/pages/${secret.id}/lock`, { pin: '1234' });
  await flush(); // rien n'est synchronisé tant que ce n'est pas activé
  assert.equal(CAL.size, 0);

  // pas d'autorisation Agenda : refusé
  assert.equal((await api('PUT', `/api/gcal/${dbp.id}`, { enabled: true })).status, 400);
  DB.prepare('INSERT INTO drive_tokens(user_id,refresh_token,email,scope) VALUES(?,?,?,?)').run(uidv, enc('refresh'), 'g@gmail.com', 'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.events');
  assert.equal((await api('GET', `/api/gcal/${dbp.id}`)).body.calendar, true);
  assert.equal((await api('PUT', `/api/gcal/${dbp.id}`, { enabled: true, date_prop: 'Date', target: 'dedicated', tz: 'Europe/Brussels' })).status, 200);
  await flush();

  assert.equal(CAL.size, 1); assert.equal([...CAL.values()][0].summary, 'DeepWell');
  let evs = events(); assert.equal(evs.length, 4); // secrète et sans date exclues
  const by = (t) => evs.find((e) => e.summary === t);
  assert.deepEqual(by('Devoir de maths p.12').start, { date: '2026-12-01' }); assert.deepEqual(by('Devoir de maths p.12').end, { date: '2026-12-02' });
  assert.match(by('Devoir de maths p.12').description, /Matière : Maths/); assert.match(by('Devoir de maths p.12').description, new RegExp(`https://dw.test/#/page/${hw.id}`));
  assert.equal(by('Présentation orale').start.dateTime, '2026-12-03T13:00:00.000Z'); assert.equal(by('Présentation orale').end.dateTime, '2026-12-03T14:00:00.000Z'); // sans fin : 1 h
  assert.deepEqual(by('Stage').end, { date: '2026-12-10' }); // fin exclusive
  assert.deepEqual(by('Réunion').start, { dateTime: '2026-12-04T09:30:00', timeZone: 'Europe/Brussels' }); assert.equal(by('Réunion').end.dateTime, '2026-12-04T11:00:00');
  assert.ok(!evs.some((e) => /secrète|Sans date/.test(e.summary)));
  const st = (await api('GET', `/api/gcal/${dbp.id}`)).body; assert.equal(st.synced, 4); assert.equal(st.config.enabled, true);

  // rejouer ne change rien (idempotent)
  const before = calls.length; await flush(); assert.equal(calls.length, before); assert.equal(events().length, 4);

  // renommer + changer la date → l'événement est modifié, pas dupliqué
  await api('PATCH', `/api/pages/${hw.id}`, { title: 'Devoir de maths p.14', props: { Date: date('2026-12-02'), Matière: { type: 'select', select: { name: 'Maths' } } } });
  await flush(); evs = events(); assert.equal(evs.length, 4);
  assert.ok(evs.find((e) => e.summary === 'Devoir de maths p.14' && e.start.date === '2026-12-02'));

  // retirer la date / corbeille / verrouiller → événement supprimé ; déverrouiller → recréé
  await api('PATCH', `/api/pages/${exam.id}`, { props: { Date: null } }); await flush(); assert.equal(events().length, 3);
  await api('DELETE', `/api/pages/${stage.id}`); await flush(); assert.equal(events().length, 2);
  await api('PUT', `/api/pages/${wall.id}/lock`, { pin: '4321' }); await flush(); assert.equal(events().length, 1);
  await api('POST', `/api/pages/${wall.id}/lock/remove`, { pin: '4321' }); await flush(); assert.equal(events().length, 2);

  // un événement supprimé à la main chez Google est recréé ; l'agenda supprimé aussi
  const cal = [...CAL.values()][0]; cal.events.clear(); await api('POST', `/api/gcal/${dbp.id}/sync`); await flush(); // rien à faire en base → mais la base sait ce qu'elle a envoyé
  assert.equal(events().length, 0); // la réconciliation ne regarde pas Google : le prochain changement de la ligne recrée
  await api('PATCH', `/api/pages/${hw.id}`, { title: 'Devoir bis' }); await flush(); assert.ok(events().some((e) => e.summary === 'Devoir bis'));
  CAL.clear(); await api('PATCH', `/api/pages/${hw.id}`, { title: 'Devoir ter' }); await flush();
  assert.equal(CAL.size, 1); assert.ok(events().some((e) => e.summary === 'Devoir ter'));

  // panne Google : tâche réessayée, jamais de doublon
  down = true; await api('PATCH', `/api/pages/${hw.id}`, { title: 'Devoir panne' }); await flush();
  assert.match((await api('GET', `/api/gcal/${dbp.id}`)).body.error || '', /panne simulée|Google Agenda/);
  down = false; await flush(); assert.ok(events().some((e) => e.summary === 'Devoir panne')); assert.equal(events().filter((e) => /Devoir/.test(e.summary)).length, 1);

  // désactiver : tout ce que DeepWell avait créé disparaît
  assert.equal((await api('PUT', `/api/gcal/${dbp.id}`, { enabled: false })).status, 200); await flush();
  assert.equal(events().length, 0); assert.equal((await api('GET', `/api/gcal/${dbp.id}`)).body.synced, 0);
});
