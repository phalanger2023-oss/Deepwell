import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-test-s2-'));
process.env.JOB_BASE_DELAY_MS = '1';
process.env.GOOGLE_CLIENT_ID = 'id'; process.env.GOOGLE_CLIENT_SECRET = 'secret';

// ---- faux Google Drive (en mémoire) : les appels vers googleapis.com n'atteignent jamais Internet ----
const F = new Map(); let seq = 0, down = false;
const addF = (o) => { const id = `fake${String(++seq).padStart(8, '0')}x`; F.set(id, { id, trashed: false, parents: [], size: '0', mimeType: '', ...o }); return id; };
const byName = (name, parent) => [...F.values()].find((f) => f.name === name && f.parents.includes(parent) && !f.trashed);
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
// ---- faux PDM : enregistre les dépôts (clé, dossier, source) ----
const PDM = { docs: [], key: 'CLE-PDM' };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (/^https:\/\/pdm\.test/.test(u)) {
    if (opts.headers?.['X-PDM-Key'] !== PDM.key) return J({ error: 'Clé d\'intégration refusée' }, 401);
    if (u.endsWith('/api/integration/ping')) return J({ ok: true });
    if (u.endsWith('/api/integration/docs')) {
      const fd = opts.body, src = fd.get('source'), ex = PDM.docs.find((d) => d.source === src);
      if (ex) return J({ name: ex.name, existing: true });
      const name = fd.get('file').name; PDM.docs.push({ name, folder: fd.get('folder'), source: src, size: fd.get('file').size });
      return J({ name, folder: fd.get('folder'), existing: false });
    }
  }
  if (!/googleapis\.com/.test(u)) return realFetch(url, opts);
  if (down) return J({ error: { message: 'panne simulée' } }, 503);
  if (u.includes('oauth2.googleapis.com/token')) return J({ access_token: 'tok', expires_in: 3600 });
  const m = opts.method || 'GET', url2 = new URL(u), p = url2.pathname;
  if (p.startsWith('/upload/drive/v3/files/') && m === 'PATCH') { const f = F.get(p.split('/').pop()); if (!f) return J({}, 404); f.content = Buffer.from(opts.body).toString('utf8'); return J({ id: f.id }); }
  if (p === '/upload/drive/v3/files') {
    const body = Buffer.from(opts.body).toString('latin1'), meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(body)[1]);
    const id = addF({ name: meta.name, parents: meta.parents, mimeType: 'text/plain', size: '5', content: body.split('\r\n\r\n').slice(2).join('\r\n\r\n').replace(/\r\n--[^\r]*--$/, '') });
    return J({ id, name: meta.name, mimeType: 'text/plain', size: '5' });
  }
  if (p === '/drive/v3/files' && m === 'GET') {
    const q = url2.searchParams.get('q') || '', name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1].replace(/\\'/g, "'"), parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (!name && parent) return J({ files: [...F.values()].filter((f) => !f.trashed && f.parents.includes(parent)).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size })) });
    return J({ files: [...F.values()].filter((f) => f.name === name && f.mimeType.endsWith('folder') && !f.trashed && f.parents.includes(parent)).map((f) => ({ id: f.id })) });
  }
  if (p === '/drive/v3/files' && m === 'POST') { const b = JSON.parse(opts.body); return J({ id: addF({ name: b.name, mimeType: b.mimeType, parents: b.parents || ['root'] }) }); }
  const f = F.get(p.split('/').pop());
  if (!f) return J({ error: { message: 'File not found' } }, 404);
  if (url2.searchParams.get('alt') === 'media') return new Response('%PDF-1.4 faux pdf');
  if (m === 'GET') return J(f);
  if (m === 'PATCH') {
    const b = JSON.parse(opts.body || '{}'), add = url2.searchParams.get('addParents'), rem = url2.searchParams.get('removeParents');
    if (b.name) f.name = b.name; if (b.trashed) f.trashed = true;
    if (add) f.parents = f.parents.filter((x) => x !== rem).concat(add);
    return J({ id: f.id });
  }
  return J({}, 405);
};
const pathOf = (id) => { const out = []; for (let f = F.get(id); f; f = F.get(f.parents[0])) out.unshift(f.name); return out.join(' / '); };

let server, base, cookie = '', DB, jobs;
async function api(method, url, body, raw) {
  const r = await fetch(base + url, { method, headers: { 'x-dw': '1', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(raw ? raw : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const settle = async () => { DB.db.prepare('UPDATE jobs SET next_run_at=0 WHERE status=?').run('pending'); await jobs.runDueJobs(100); };

before(async () => {
  const { app } = await import('../server/index.js');
  DB = await import('../server/db.js'); jobs = await import('../server/jobs.js');
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); setTimeout(() => process.exit(0), 100).unref(); });

let ctx = {};
const matiere = (name) => ({ Matière: { type: 'status', status: { name, color: 'default' } } });

test('préparation : base scolaire avec stockage Drive, compte Drive connecté', async () => {
  const reg = await api('POST', '/api/auth/register', { email: 'a@x.fr', password: 'motdepasse1', name: 'A' });
  ctx.user = reg.body.user.id;
  const d = (await api('POST', '/api/pages', { title: 'Recueil 5A6 (2026-2027)', kind: 'database' })).body; ctx.db = d.id;
  const schema = { Name: { id: 'title', name: 'Name', type: 'title', title: {} }, Matière: { id: 'm', name: 'Matière', type: 'status', status: { options: [] } } };
  await api('PATCH', `/api/pages/${d.id}`, { schema, props: { dw_school: { enabled: true, options: { drive: true } } } });
  const { secretKey } = DB, iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update('refresh', 'utf8'), c.final()]);
  DB.db.prepare('INSERT INTO drive_tokens(user_id,refresh_token,email) VALUES(?,?,?)').run(ctx.user, [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.'), 'a@x.fr');
  // base ordinaire (mode scolaire absent) : rien de scolaire n'apparaît
  const plain = (await api('POST', '/api/pages', { title: 'Autre', kind: 'database' })).body;
  const row = (await api('POST', '/api/pages', { title: 'Ligne', parent_id: plain.id })).body;
  assert.equal((await api('GET', `/api/school/pages/${row.id}`)).body.applicable, false);
  assert.equal((await api('POST', `/api/school/pages/${row.id}/folder`)).status, 409);
});

test('nouveau chapitre : dossier Année / Matière / Support créé sur Drive, sans doublon', async () => {
  const row = (await api('POST', '/api/pages', { title: 'P.S.A. #0001-FR', parent_id: ctx.db })).body; ctx.s1 = row.id;
  await api('PATCH', `/api/pages/${row.id}`, { props: matiere('Français') });
  const r = await api('POST', `/api/school/pages/${row.id}/folder`);
  assert.equal(r.status, 200);
  assert.equal(pathOf(r.body.drive_id), 'DeepWell Cours / Français / P.S.A. #0001-FR');
  assert.equal((await api('POST', `/api/school/pages/${row.id}/folder`)).body.drive_id, r.body.drive_id, 'même dossier au second appel');
  // deux supports de la même matière : mêmes dossiers parents réutilisés, dossiers de support distincts
  const row2 = (await api('POST', '/api/pages', { title: 'P.S.A. #0001-FR', parent_id: ctx.db })).body; ctx.s2 = row2.id;
  await api('PATCH', `/api/pages/${row2.id}`, { props: matiere('Français') });
  const r2 = await api('POST', `/api/school/pages/${row2.id}/folder`);
  assert.notEqual(r2.body.drive_id, r.body.drive_id);
  assert.equal([...F.values()].filter((f) => f.name === 'Français' && !f.trashed).length, 1);
  assert.equal([...F.values()].filter((f) => f.name === 'DeepWell Cours').length, 1);
  ctx.f1 = r.body.drive_id;
});

test('ajout de fichier : jeton temporaire, vérification auprès de Drive, addendum dans « Addenda »', async () => {
  const s = (await api('POST', `/api/school/pages/${ctx.s1}/upload-session`)).body;
  assert.equal(s.token, 'tok'); assert.equal(pathOf(s.folder_id), 'DeepWell Cours / Français / P.S.A. #0001-FR / Document principal'); assert.notEqual(s.folder_id, ctx.f1);
  const fid = addF({ name: 'cours.pdf', mimeType: 'application/pdf', parents: [s.folder_id], size: '1234' });
  const reg = await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: fid });
  assert.equal(reg.status, 200); assert.equal(reg.body.name, 'cours.pdf'); assert.equal(reg.body.size, 1234);
  const stray = addF({ name: 'ailleurs.pdf', mimeType: 'application/pdf', parents: ['root'] });
  assert.equal((await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: stray })).status, 409, 'fichier hors du dossier du chapitre refusé');
  const info = (await api('GET', `/api/school/pages/${ctx.s1}`)).body;
  assert.deepEqual([info.applicable, info.files.length, info.all_files.length], [true, 1, 1]);
  // addendum : sous-page du support → fichiers dans le sous-dossier Addenda
  const add = (await api('POST', '/api/pages', { title: 'Addendum 1', parent_id: ctx.s1 })).body;
  const sa = (await api('POST', `/api/school/pages/${add.id}/upload-session`)).body;
  assert.equal(pathOf(sa.folder_id), 'DeepWell Cours / Français / P.S.A. #0001-FR / Registre des addenda / Addendum 1');
  const f2 = addF({ name: 'note.txt', mimeType: 'text/plain', parents: [sa.folder_id] });
  await api('POST', `/api/school/pages/${add.id}/files`, { drive_id: f2 });
  const sup = (await api('GET', `/api/school/pages/${ctx.s1}`)).body;
  assert.equal(sup.all_files.length, 2); assert.equal(sup.all_files.find((f) => f.name === 'note.txt').where, 'Registre des addenda/Addendum 1');
  assert.equal((await api('GET', `/api/school/pages/${add.id}`)).body.is_addendum, true);
  ctx.fileId = reg.body.id; ctx.fileDrive = fid;
});

test('renommer / supprimer un fichier : répercuté sur Drive (corbeille de Drive)', async () => {
  assert.equal((await api('PATCH', `/api/school/files/${ctx.fileId}`, { name: 'Cours 1.pdf' })).body.synced, true);
  assert.equal(F.get(ctx.fileDrive).name, 'Cours 1.pdf');
  assert.equal((await api('PATCH', `/api/school/files/${ctx.fileId}`, { name: '   ' })).status, 400);
  assert.equal((await api('DELETE', `/api/school/files/${ctx.fileId}`)).body.synced, true);
  assert.equal(F.get(ctx.fileDrive).trashed, true, 'corbeille de Drive, pas suppression définitive');
});

test('renommer un chapitre ou changer sa matière : le dossier Drive suit (en tâche de fond)', async () => {
  await api('PATCH', `/api/pages/${ctx.s1}`, { title: 'P.S.A. #0001-FR (revu)' });
  await settle();
  assert.equal(pathOf(ctx.f1), 'DeepWell Cours / Français / P.S.A. #0001-FR (revu)');
  await api('PATCH', `/api/pages/${ctx.s1}`, { props: matiere('Histoire') });
  await settle();
  assert.equal(pathOf(ctx.f1), 'DeepWell Cours / Histoire / P.S.A. #0001-FR (revu)');
  assert.equal([...F.values()].filter((f) => f.name === 'Histoire').length, 1);
});

test('panne de Google : le chapitre est créé quand même, le dossier suit à la tentative suivante', async () => {
  const row = (await api('POST', '/api/pages', { title: 'Support en panne', parent_id: ctx.db })).body;
  await api('PATCH', `/api/pages/${row.id}`, { props: matiere('Sciences 3H') });
  down = true;
  const r = await api('POST', `/api/school/pages/${row.id}/folder`);
  assert.equal(r.status, 202); assert.equal(r.body.pending, true);
  down = false; await settle();
  const f = DB.db.prepare('SELECT drive_id FROM school_folders WHERE page_id=?').get(row.id);
  assert.equal(pathOf(f.drive_id), 'DeepWell Cours / Sciences 3H / Support en panne');
});

test('suppression définitive d’un chapitre : dossier Drive à la corbeille de Drive ; la corbeille de DeepWell n’y touche pas', async () => {
  await api('DELETE', `/api/pages/${ctx.s2}`); await settle();
  assert.equal(F.get(DB.db.prepare('SELECT drive_id FROM school_folders WHERE page_id=?').get(ctx.s2).drive_id).trashed, false);
  const fid = DB.db.prepare('SELECT drive_id FROM school_folders WHERE page_id=?').get(ctx.s2).drive_id;
  await api('DELETE', `/api/pages/${ctx.s2}?permanent=1`); await settle();
  assert.equal(F.get(fid).trashed, true);
});

test('rattacher les cours existants : aperçu sans effet, puis dossiers, fichiers du serveur envoyés, liens Drive rattachés', async () => {
  const up = await api('POST', '/api/files', Buffer.from('hello'), { 'Content-Type': 'text/plain', 'x-filename': 'ancien.txt' });
  const row = (await api('POST', '/api/pages', { title: 'Cours existant', parent_id: ctx.db })).body;
  await api('PATCH', `/api/pages/${row.id}`, { props: matiere('Géographie') });
  const link = (url, t) => ({ type: 'text', text: { content: t, link: { url } }, plain_text: t });
  await api('PUT', `/api/pages/${row.id}/blocks`, { blocks: [
    { id: 'b1', parent_id: null, type: 'paragraph', content: { rich_text: [link('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing', 'Syllabus')] } },
    { id: 'b2', parent_id: null, type: 'paragraph', content: { rich_text: [link('https://www.canva.com/design/DAF123/view', 'Canva')] } },
    { id: 'b3', parent_id: null, type: 'file', content: { file: { url: up.body.url }, name: 'ancien.txt' } }] });
  const before = F.size;
  const pre = (await api('POST', '/api/school/import/preview', { database_id: ctx.db })).body;
  const s = pre.supports.find((x) => x.id === row.id);
  assert.deepEqual([s.drive_files, s.canva_links, s.server_files, s.has_folder], [1, 1, 1, false]);
  assert.match(s.path, /^DeepWell Cours \/ Géographie \/ Cours existant$/);
  assert.equal(F.size, before, 'l’aperçu ne crée rien sur Drive');
  const run = (await api('POST', '/api/school/import/run', { database_id: ctx.db })).body;
  await settle();
  const st = (await api('GET', `/api/school/import/status?batch=${run.batch}`)).body;
  assert.equal(st.failed, 0); assert.equal(st.waiting, 0); assert.equal(st.done, st.total);
  const files = DB.db.prepare('SELECT * FROM school_files WHERE page_id=?').all(row.id);
  assert.deepEqual(files.map((f) => f.kind).sort(), ['link', 'upload']);
  const sent = files.find((f) => f.kind === 'upload');
  assert.equal(pathOf(sent.drive_id), 'DeepWell Cours / Géographie / Cours existant / Document principal / ancien.txt');
  assert.equal(files.find((f) => f.kind === 'link').drive_id, '1AbCdEfGhIjKlMnOpQr', 'le lien Drive existant est rattaché tel quel, pas déplacé');
  assert.ok(fs.existsSync(path.join(DB.UPLOAD_DIR, up.body.id)), 'la copie du serveur est conservée');
  // rejouable sans doublon
  await api('POST', '/api/school/import/run', { database_id: ctx.db }); await settle();
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM school_files WHERE page_id=?').get(row.id).n, 2);
  assert.equal([...F.values()].filter((f) => f.name === 'ancien.txt').length, 1);
});

test('analyse des liens : formats Drive courants', async () => {
  const { parseDriveUrl } = await import('../server/school-drive.js');
  assert.deepEqual(parseDriveUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view'), { id: '1AbCdEfGhIjKlMnOpQr', folder: false });
  assert.deepEqual(parseDriveUrl('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQr'), { id: '1AbCdEfGhIjKlMnOpQr', folder: false });
  assert.deepEqual(parseDriveUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQr?usp=sharing'), { id: '1AbCdEfGhIjKlMnOpQr', folder: true });
  assert.equal(parseDriveUrl('https://drive.google.com/'), null);
});

test('PDM : clé vérifiée, PDF de référence déposé dans année / matière / chapitre, liens fournis, pas de doublon, addenda inclus', async () => {
  // configuration : mauvaise clé refusée, bonne clé enregistrée (chiffrée)
  assert.equal((await api('PUT', '/api/pdm/config', { url: 'https://pdm.test', key: 'mauvaise' })).status, 401);
  assert.equal((await api('GET', '/api/pdm/config')).body.configured, false);
  assert.equal((await api('PUT', '/api/pdm/config', { url: 'https://pdm.test/', key: PDM.key })).status, 200);
  assert.equal((await api('GET', '/api/pdm/config')).body.url, 'https://pdm.test');
  assert.ok(!JSON.stringify(DB.db.prepare("SELECT value FROM settings WHERE key='pdm_key'").get()).includes(PDM.key)); // jamais en clair
  // option « Intégration de l'éditeur de PDF » + PDF déjà présent avant l'option (rattrapage)
  await api('PATCH', `/api/pages/${ctx.db}`, { props: { dw_school: { enabled: true, options: { drive: true, pdf: true } } } });
  const s1 = (await api('POST', `/api/school/pages/${ctx.s1}/upload-session`)).body;
  const pdfId = addF({ name: 'cours.pdf', mimeType: 'application/pdf', parents: [s1.folder_id], size: '999' });
  const pre = (await api('POST', `/api/pages/${ctx.db}/architecture`, { dry: true })).body; assert.equal(pre.pdm.enabled, true); assert.ok(pre.pdm.files >= 0);
  const saved = (await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: pdfId })).body;
  await settle();
  assert.equal(PDM.docs.length, 1); assert.equal(PDM.docs[0].folder, 'Recueil 5A6 (2026-2027)/Histoire/P.S.A. #0001-FR (revu)'); assert.equal(PDM.docs[0].source, `deepwell:${saved.id}`);
  const info = (await api('GET', `/api/school/pages/${ctx.s1}`)).body, f = info.files.find((x) => x.id === saved.id);
  assert.equal(info.pdm, true); assert.equal(f.pdm.url, 'https://pdm.test/#/cours.pdf'); assert.equal(f.pdm.original_url, 'https://pdm.test/api/docs/cours.pdf/pdf?dl=1'); assert.ok(!f.pdm_pending);
  // idempotent : rien n'est renvoyé ; un PDF d'addendum est déposé à part, dans …/Addenda/<addendum>
  await settle(); assert.equal(PDM.docs.length, 1);
  const add = (await api('POST', '/api/pages', { title: 'Addendum', parent_id: ctx.s1 })).body;
  const sa = (await api('POST', `/api/school/pages/${add.id}/upload-session`)).body;
  await api('POST', `/api/school/pages/${add.id}/files`, { drive_id: addF({ name: 'annexe.pdf', mimeType: 'application/pdf', parents: [sa.folder_id] }) }); await settle();
  assert.equal(PDM.docs.length, 2); assert.equal(PDM.docs[1].folder, 'Recueil 5A6 (2026-2027)/Histoire/P.S.A. #0001-FR (revu)/Registre des addenda/Addendum');
  const addInfo = (await api('GET', `/api/school/pages/${add.id}`)).body; assert.equal(addInfo.pdm, true); assert.ok(addInfo.files[0].pdm.url.includes('annexe.pdf'));
  // version annotée (ex. faite sur Canva) : rangée à côté de l'original vierge, nommée « … (annoté) », déposée dans PDM comme document à part
  const annId = addF({ name: 'canva-export.pdf', mimeType: 'application/pdf', parents: [s1.folder_id], size: '500' });
  assert.equal((await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: annId, annotates: saved.id })).status, 409, 'chapitre récent : pas de version annotée');
  assert.equal((await api('GET', `/api/school/pages/${ctx.s1}`)).body.legacy, false);
  DB.db.prepare('UPDATE pages SET props=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(DB.db.prepare('SELECT props FROM pages WHERE id=?').get(ctx.s1).props), dw_arch: 'todo' }), ctx.s1); // « à mettre à jour »
  assert.equal((await api('GET', `/api/school/pages/${ctx.s1}`)).body.legacy, true);
  assert.equal((await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: annId, annotates: 'inconnu' })).status, 404, 'original inconnu refusé');
  const ann = (await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: annId, annotates: saved.id })).body;
  assert.equal(ann.annotates, saved.id); assert.equal(ann.name, 'cours (annoté).pdf');
  await settle();
  assert.equal(PDM.docs.length, 3); assert.equal(PDM.docs[2].source, `deepwell:${ann.id}`); assert.equal(PDM.docs[2].folder, PDM.docs[0].folder);
  const o = (await api('GET', `/api/school/pages/${ctx.s1}`)).body.files; assert.equal(o.find((x) => x.id === saved.id).annotates, null, 'l’original reste l’original');
  const again = addF({ name: 'deuxieme.pdf', mimeType: 'application/pdf', parents: [s1.folder_id] });
  assert.equal((await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: again, annotates: saved.id })).status, 409, 'une seule version annotée par original');
  assert.ok(!(await api('GET', `/api/school/pages/${ctx.s1}`)).body.files.some((x) => x.name === 'deuxieme.pdf'), 'refus : rien n’est enregistré');
  DB.db.prepare('UPDATE pages SET props=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(DB.db.prepare('SELECT props FROM pages WHERE id=?').get(ctx.s1).props), dw_arch: 'done' }), ctx.s1); // mise à jour faite
  assert.equal((await api('GET', `/api/school/pages/${ctx.s1}`)).body.legacy, false, 'plus d’option une fois la carte à jour');
  // option désactivée : plus rien n'est déposé
  await api('PATCH', `/api/pages/${ctx.db}`, { props: { dw_school: { enabled: true, options: { drive: true } } } });
  await api('DELETE', `/api/school/files/${ann.id}`);
  await api('POST', `/api/school/pages/${ctx.s1}/files`, { drive_id: addF({ name: 'autre.pdf', mimeType: 'application/pdf', parents: [s1.folder_id] }) }); await settle();
  assert.equal(PDM.docs.length, 3);
});

test('addenda : un dossier par addendum (nom de la page) avec ses fichiers et un petit fichier .txt, rattrapage des anciens, renommage', async () => {
  const add = (await api('POST', '/api/pages', { title: 'Addendum 00', parent_id: ctx.s1 })).body;
  await api('PUT', `/api/pages/${add.id}/blocks`, { blocks: [
    { id: 'h1', parent_id: null, type: 'heading_2', content: { rich_text: [{ type: 'text', text: { content: 'Verbes' }, plain_text: 'Verbes', annotations: {} }] } },
    { id: 'p1', parent_id: null, type: 'paragraph', content: { rich_text: [{ type: 'text', text: { content: 'Chanter' }, plain_text: 'Chanter', annotations: { bold: true } }] } }] });
  // ancien fichier d'addendum : directement dans « Addenda » (organisation précédente)
  const frow = DB.db.prepare('SELECT * FROM school_folders WHERE page_id=?').get(ctx.s1);
  const old = addF({ name: 'ancien.pdf', mimeType: 'application/pdf', parents: [frow.addenda_id] });
  DB.db.prepare("INSERT INTO school_files(id,page_id,drive_id,name,mime,size,kind,created_at) VALUES('oldf',?,?,?,?,0,'upload',1)").run(add.id, old, 'ancien.pdf', 'application/pdf');
  const pre = (await api('POST', `/api/pages/${ctx.db}/architecture`, { dry: true })).body;
  assert.ok(pre.addenda_drive.addenda >= 1, 'l’aperçu annonce les addenda à ranger');
  await api('POST', `/api/pages/${ctx.db}/architecture`, { dry: false }); await settle();
  const dirs = [...F.values()].filter((f) => f.name === 'Addendum 00' && f.mimeType.endsWith('folder'));
  assert.equal(dirs.length, 1); assert.equal(pathOf(dirs[0].id), 'DeepWell Cours / Histoire / P.S.A. #0001-FR (revu) / Registre des addenda / Addendum 00'.replace('Histoire / P.S.A. #0001-FR (revu)', pathOf(frow.drive_id).split(' / ').slice(1).join(' / ')));
  assert.deepEqual(F.get(old).parents, [dirs[0].id], 'ancien fichier rangé dans le dossier de son addendum');
  const doc = [...F.values()].find((f) => f.name === 'Addendum 00.txt' && f.parents.includes(dirs[0].id));
  assert.ok(doc, 'résumé écrit présent'); assert.match(doc.content, /^# Addendum 00\n\n## Verbes\n\*\*Chanter\*\*\n$/);
  // idempotent + mise à jour du contenu + renommage
  const n = F.size; await api('POST', `/api/pages/${ctx.db}/architecture`, { dry: false }); await settle(); assert.equal(F.size, n, 'rien de dupliqué');
  await api('PUT', `/api/pages/${add.id}/blocks`, { blocks: [{ id: 'p1', parent_id: null, type: 'paragraph', content: { rich_text: [{ type: 'text', text: { content: 'Finir' }, plain_text: 'Finir', annotations: {} }] } }] }); await settle();
  assert.match(doc.content, /Finir/); assert.doesNotMatch(doc.content, /Chanter/);
  await api('PATCH', `/api/pages/${add.id}`, { title: 'Addendum 01' }); await settle();
  assert.equal(F.get(dirs[0].id).name, 'Addendum 01'); assert.equal(doc.name, 'Addendum 01.txt');
  // nouveau fichier joint : va dans le dossier de l'addendum
  assert.equal(pathOf((await api('POST', `/api/school/pages/${add.id}/upload-session`)).body.folder_id).split(' / ').slice(-2).join(' / '), 'Registre des addenda / Addendum 01');
});

// ───────── lot 2 : titres automatiques, réorganisation, doublons, corbeille des addenda ─────────
const dbRow = (id) => DB.db.prepare('SELECT title, props FROM pages WHERE id=?').get(id);

test('titre automatique : « P.S.A. #n-année-abréviation » dès que la matière est choisie, recalculé tant que la fiche n’a pas de nom', async () => {
  const a = (await api('POST', '/api/pages', { title: 'P.S.A. #00-26-', parent_id: ctx.db })).body; ctx.m1 = a.id;
  const r = await api('PATCH', `/api/pages/${a.id}`, { props: matiere('Mathématiques') });
  assert.equal(r.body.title, 'P.S.A. #0001-26-MTH'); assert.equal(dbRow(a.id).title, 'P.S.A. #0001-26-MTH');
  const b = (await api('POST', '/api/pages', { title: '', parent_id: ctx.db })).body; ctx.m2 = b.id;
  assert.equal((await api('PATCH', `/api/pages/${b.id}`, { props: matiere('Mathématiques') })).body.title, 'P.S.A. #0002-26-MTH', 'numéro suivant dans la même matière');
  // matière changée tant que le titre est celui que DeepWell a généré : recalculé
  assert.match((await api('PATCH', `/api/pages/${b.id}`, { props: matiere('Français') })).body.title, /^P\.S\.A\. #0\d{3}-26-FRN$/);
  assert.equal((await api('PATCH', `/api/pages/${b.id}`, { props: matiere('Mathématiques') })).body.title, 'P.S.A. #0002-26-MTH');
  // un nom propre ajouté : plus jamais touché
  await api('PATCH', `/api/pages/${b.id}`, { title: 'P.S.A. #0002-26-MTH Les fractions' });
  assert.equal((await api('PATCH', `/api/pages/${b.id}`, { props: matiere('Français') })).body.title, undefined);
  assert.equal(dbRow(b.id).title, 'P.S.A. #0002-26-MTH Les fractions');
  // abréviation choisie dans les réglages de la base
  await api('PATCH', `/api/pages/${ctx.db}`, { props: { dw_school: { enabled: true, options: { drive: true }, abbrevs: { Chimie: 'chm' } } } });
  const c = (await api('POST', '/api/pages', { title: '', parent_id: ctx.db })).body;
  assert.equal((await api('PATCH', `/api/pages/${c.id}`, { props: matiere('Chimie') })).body.title, 'P.S.A. #0001-26-CHM');
});

test('addendum : titre « Addendum #<n° P.S.A.>/<nn>-<année>-<abréviation> », numéro suivant à chaque addendum', async () => {
  assert.equal((await api('GET', `/api/school/titles/addendum?page_id=${ctx.m1}`)).body.title, 'Addendum #0001/01-26-MTH ');
  await api('POST', '/api/pages', { title: 'Addendum #0001/01-26-MTH Les angles', parent_id: ctx.m1 });
  assert.equal((await api('GET', `/api/school/titles/addendum?page_id=${ctx.m1}`)).body.title, 'Addendum #0001/02-26-MTH ');
  const sub = (await api('POST', '/api/pages', { title: 'Sous-page', parent_id: ctx.m1 })).body;
  assert.equal((await api('GET', `/api/school/titles/addendum?page_id=${sub.id}`)).body.title, 'Addendum #0001/02-26-MTH ', 'depuis une sous-page : même support');
  const plain = (await api('POST', '/api/pages', { title: 'Hors scolaire' })).body;
  assert.equal((await api('GET', `/api/school/titles/addendum?page_id=${plain.id}`)).body.title, null);
});

test('plusieurs requêtes simultanées : un seul dossier Drive par support (pas de doublon)', async () => {
  const p = (await api('POST', '/api/pages', { title: 'Course parallèle', parent_id: ctx.db })).body;
  await api('PATCH', `/api/pages/${p.id}`, { props: matiere('Course') });
  const rs = await Promise.all([1, 2, 3, 4].map(() => api('POST', `/api/school/pages/${p.id}/folder`)));
  assert.equal(new Set(rs.map((x) => x.body.drive_id)).size, 1);
  assert.equal([...F.values()].filter((f) => f.name === 'Course' && !f.trashed).length, 1, 'dossier de matière unique');
  assert.equal([...F.values()].filter((f) => f.name === p.title || f.name === dbRow(p.id).title).filter((f) => !f.trashed && f.mimeType.endsWith('folder')).length, 1);
});

test('réorganisation : essai à blanc sans effet, puis supports déplacés, « Registre des addenda », doublons retirés', async () => {
  const sup = (await api('POST', '/api/pages', { title: 'Ancien rangement', parent_id: ctx.db })).body;
  await api('PATCH', `/api/pages/${sup.id}`, { props: matiere('Latin') });
  const fo = (await api('POST', `/api/school/pages/${sup.id}/folder`)).body;
  const add = (await api('POST', '/api/pages', { title: 'Addendum #0001/01-26-LTN Test', parent_id: sup.id })).body;
  const sa = (await api('POST', `/api/school/pages/${add.id}/upload-session`)).body;
  // ancienne organisation : support sous un dossier « année », dossier des addenda sous l'ancien nom
  const oldYear = addF({ name: 'Recueil 5A6 (2026-2027)', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
  const old = DB.db.prepare('SELECT * FROM school_folders WHERE page_id=?').get(sup.id);
  F.get(old.drive_id).parents = [oldYear]; F.get(old.addenda_id).name = 'Addenda';
  DB.db.prepare('UPDATE school_folders SET parent_id=?, addenda_name=NULL WHERE page_id=?').run(oldYear, sup.id);
  const mk = (name) => addF({ name, mimeType: 'text/plain', parents: [sa.folder_id], size: '12' });
  const f1 = (await api('POST', `/api/school/pages/${add.id}/files`, { drive_id: mk('notes.txt') })).body;
  // doublon déjà présent avant la correction : inséré directement
  const dupDrive = mk('notes.txt');
  DB.db.prepare("INSERT INTO school_files(id,page_id,drive_id,name,mime,size,kind,created_at) VALUES('dupe1',?,?,?,?,?,?,?)").run(add.id, dupDrive, 'notes.txt', 'text/plain', 12, 'upload', Date.now() + 5);
  const before = JSON.stringify([...F.values()].map((f) => [f.id, f.name, f.parents, f.trashed]));
  const pre = (await api('POST', '/api/school/reorganize/preview', { database_id: ctx.db })).body;
  const mine = pre.supports.find((s) => s.id === sup.id);
  assert.ok(mine.move && mine.rename_addenda && mine.duplicates === 1); assert.equal(mine.to, 'DeepWell Cours / Latin / Ancien rangement');
  assert.equal(JSON.stringify([...F.values()].map((f) => [f.id, f.name, f.parents, f.trashed])), before, 'l’essai à blanc ne touche pas à Drive');
  assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM school_files WHERE page_id=?').get(add.id).c, 2);
  const ghost1 = addF({ name: 'fantome.pdf', mimeType: 'application/pdf', parents: [old.drive_id], size: '99' }), ghost2 = addF({ name: 'fantome.pdf', mimeType: 'application/pdf', parents: [old.drive_id], size: '99' });
  const run = (await api('POST', '/api/school/reorganize/run', { database_id: ctx.db })).body; assert.ok(run.total >= 1);
  await settle();
  assert.equal(pathOf(old.drive_id), 'DeepWell Cours / Latin / Ancien rangement');
  assert.equal(F.get(old.addenda_id).name, 'Registre des addenda');
  assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM school_files WHERE page_id=?').get(add.id).c, 1);
  assert.equal(F.get(dupDrive).trashed, true, 'la copie va à la corbeille de Drive'); assert.equal(F.get(f1.drive_id).trashed, false, 'l’original reste');
  assert.ok(!F.get(ghost1).trashed, 'le premier exemplaire reste'); assert.equal(F.get(ghost2).trashed, true, 'doublon présent seulement sur Drive : à la corbeille');
  const after = (await api('POST', '/api/school/reorganize/preview', { database_id: ctx.db })).body.supports.find((s) => s.id === sup.id);
  assert.ok(!after.move && !after.rename_addenda && after.duplicates === 0, 'plus rien à déplacer, renommer ou dédoublonner ensuite');
  const kids = [...F.values()].filter((f) => !f.trashed && f.parents.includes(DB.db.prepare('SELECT drive_id FROM school_addenda WHERE page_id=?').get(add.id).drive_id)).map((f) => f.name).sort();
  assert.ok(kids.includes('Addendum #0001-01-26-LTN Test.txt') || kids.some((n) => /\.txt$/.test(n) && /Addendum/.test(n)), 'petit fichier texte descriptif dans le dossier de l’addendum');
  ctx.latin = { sup: sup.id, add: add.id };
});

test('même fichier envoyé deux fois : la copie est mise à la corbeille de Drive, l’existant est gardé', async () => {
  const sa = (await api('POST', `/api/school/pages/${ctx.latin.add}/upload-session`)).body;
  const again = addF({ name: 'NOTES.txt', mimeType: 'text/plain', parents: [sa.folder_id], size: '12' });
  const r = (await api('POST', `/api/school/pages/${ctx.latin.add}/files`, { drive_id: again })).body;
  assert.equal(r.duplicate, true); await settle();
  assert.equal(F.get(again).trashed, true);
  assert.equal(DB.db.prepare('SELECT COUNT(*) c FROM school_files WHERE page_id=?').get(ctx.latin.add).c, 1);
});

test('suppression définitive d’un addendum seul : son dossier Drive part à la corbeille de Drive', async () => {
  const dir = DB.db.prepare('SELECT drive_id FROM school_addenda WHERE page_id=?').get(ctx.latin.add).drive_id;
  assert.equal(F.get(dir).trashed, false);
  await api('DELETE', `/api/pages/${ctx.latin.add}?permanent=1`); await settle();
  assert.equal(F.get(dir).trashed, true);
  assert.equal(F.get(DB.db.prepare('SELECT drive_id FROM school_folders WHERE page_id=?').get(ctx.latin.sup).drive_id).trashed, false, 'le support, lui, reste');
});
