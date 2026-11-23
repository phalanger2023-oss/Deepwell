/**
 * Synchronisation DeepWell → Google Agenda (sens unique) : chaque ligne datée d'une base devient un événement.
 * Pensé pour « Ok Google, quels sont mes devoirs pour mardi ? » : l'assistant lit l'agenda Google, DeepWell l'alimente.
 *
 * Principe : RÉCONCILIATION. À chaque changement (ou toutes les 30 min, par sécurité), une tâche de fond compare les lignes de la base
 * avec les événements déjà créés (table gcal_events) et crée / modifie / supprime ce qui diffère. Idempotent : rejouer ne duplique rien,
 * et un échec temporaire de Google est simplement réessayé (file de tâches).
 *  - Date sans heure → événement sur la journée ; avec heure (et fin éventuelle) → événement à l'heure ; sans fin → 1 h.
 *  - Une ligne sans date, archivée, supprimée ou verrouillée (code d'accès) n'a pas d'événement (jamais de titre verrouillé chez Google).
 *  - Agenda « DeepWell » dédié (créé au besoin) ou agenda principal.
 *  - Désactiver la synchronisation retire les événements créés par DeepWell (et seulement ceux-là).
 */
import crypto from 'node:crypto';
import express from 'express';
import { db, now, parse } from './db.js';
import { requireAuth } from './auth.js';
import { accessFor } from './access.js';
import { accessToken, driveConfigured, hasCalendarScope } from './drive.js';
import { enqueueJob, registerJob, runDueJobs } from './jobs.js';

db.exec(`
CREATE TABLE IF NOT EXISTS gcal_config(
  database_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, date_prop TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'dedicated', tz TEXT NOT NULL DEFAULT 'Europe/Brussels', updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gcal_calendars(user_id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, summary TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gcal_events(
  page_id TEXT PRIMARY KEY, database_id TEXT NOT NULL, user_id TEXT NOT NULL, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, hash TEXT NOT NULL, synced_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS gcal_events_db ON gcal_events(database_id);`);

const API = 'https://www.googleapis.com/calendar/v3';
const CAL_NAME = 'DeepWell';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
const appUrl = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');

// ---------- Google ----------
class GErr extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function g(token, method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new GErr(r.status, `Google Agenda : ${j.error?.message || r.status}`);
  return j;
}

/** Agenda cible : « primary », ou l'agenda « DeepWell » du compte (créé au premier besoin). */
async function calendarFor(cfg, token) {
  if (cfg.target === 'primary') return 'primary';
  const row = db.prepare('SELECT calendar_id FROM gcal_calendars WHERE user_id=?').get(cfg.user_id);
  if (row) return row.calendar_id;
  const c = await g(token, 'POST', '/calendars', { summary: CAL_NAME, description: 'Alimenté automatiquement par DeepWell (ne pas modifier ici : les changements sont écrasés).', timeZone: cfg.tz });
  db.prepare('INSERT INTO gcal_calendars(user_id,calendar_id,summary) VALUES(?,?,?)').run(cfg.user_id, c.id, CAL_NAME);
  return c.id;
}
/** L'agenda dédié a été supprimé côté Google : on l'oublie, ainsi que les événements qui y étaient rattachés. */
function forgetCalendar(userId, calendarId) {
  db.prepare('DELETE FROM gcal_calendars WHERE user_id=? AND calendar_id=?').run(userId, calendarId);
  db.prepare('DELETE FROM gcal_events WHERE user_id=? AND calendar_id=?').run(userId, calendarId);
}

// ---------- dates -> événement ----------
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/, HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const pad = (n) => String(n).padStart(2, '0');
const dayPlus = (iso, n) => { const [y, m, d] = iso.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
/** Heure « murale » (sans fuseau) + n minutes, sans passer par le fuseau du serveur. */
const wallPlus = (s, min) => { const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s); const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + min, +(m[6] || 0))); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`; };
const timed = (s, tz) => (HAS_OFFSET.test(s) ? { dateTime: new Date(s).toISOString(), timeZone: tz } : { dateTime: s.replace(' ', 'T').replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/, '$1:00'), timeZone: tz });
/** {start,end} Notion → début/fin d'événement Google ; null si la date est inutilisable. */
export function eventTimes(date, tz) {
  const s = date?.start, e = date?.end || null;
  if (typeof s !== 'string') return null;
  if (DATE_ONLY.test(s)) {
    const last = e && DATE_ONLY.test(e.slice(0, 10)) && e.slice(0, 10) >= s ? e.slice(0, 10) : s;
    return { start: { date: s }, end: { date: dayPlus(last, 1) } }; // fin « exclusive » chez Google
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  const start = timed(s, tz);
  let end;
  if (e && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(e)) end = timed(e, tz);
  else if (HAS_OFFSET.test(s)) end = { dateTime: new Date(new Date(s).getTime() + 3600_000).toISOString(), timeZone: tz };
  else end = { dateTime: wallPlus(s, 60), timeZone: tz };
  return { start, end };
}

const plain = (rt) => (Array.isArray(rt) ? rt.map((x) => x.plain_text ?? x.text?.content ?? '').join('') : '');
function propLine(name, p) {
  if (!p) return null;
  const t = p.type, v = p[t];
  const val = t === 'select' || t === 'status' ? v?.name : t === 'multi_select' ? (v || []).map((x) => x.name).join(', ') : t === 'rich_text' ? plain(v) : t === 'number' ? (v == null ? '' : String(v)) : t === 'checkbox' ? (v ? 'oui' : '') : t === 'url' ? v || '' : '';
  return val ? `${name} : ${val}` : null;
}

/** Dans Google Agenda uniquement (jamais dans les bases) : TST → test, DVR → devoir, PRP → devoir côté. */
const AGENDA_WORDS = { TST: 'test', DVR: 'devoir', PRP: 'devoir côté' };
export const agendaWords = (text) => String(text ?? '').replace(/(?<![A-Za-zÀ-ÿ0-9])(TST|DVR|PRP)(?![A-Za-zÀ-ÿ0-9])/g, (m) => AGENDA_WORDS[m]);

/** Événements voulus pour une base : page_id → {summary, description, start, end}. */
export function desiredEvents(databaseId, cfg) {
  const dbRow = db.prepare('SELECT schema FROM pages WHERE id=?').get(databaseId), schema = parse(dbRow?.schema, {}) || {};
  const textProps = Object.keys(schema).filter((k) => schema[k].type !== 'title' && k !== cfg.date_prop && ['select', 'status', 'multi_select', 'rich_text', 'number', 'url'].includes(schema[k].type)).slice(0, 8);
  const anyLock = !!db.prepare('SELECT 1 FROM page_locks LIMIT 1').get();
  const locked = anyLock ? db.prepare(`WITH RECURSIVE up(id,parent_id,d) AS (SELECT id,parent_id,0 FROM pages WHERE id=?1 UNION ALL SELECT p.id,p.parent_id,d+1 FROM pages p JOIN up ON p.id=up.parent_id WHERE d<200)
    SELECT 1 FROM page_locks l JOIN up ON up.id=l.page_id LIMIT 1`) : null;
  const out = new Map();
  for (const r of db.prepare("SELECT id,title,props FROM pages WHERE parent_id=? AND kind='page' AND archived=0").all(databaseId)) {
    const props = parse(r.props, {});
    const times = eventTimes(props?.[cfg.date_prop]?.date, cfg.tz);
    if (!times || (locked && locked.get(r.id))) continue;
    const lines = textProps.map((k) => propLine(k, props[k])).filter(Boolean).map(agendaWords);
    const subjKey = Object.keys(schema).find((k) => /^mati/i.test(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) && ['select', 'status'].includes(schema[k].type)), subject = subjKey ? props[subjKey]?.[schema[subjKey].type]?.name : '';
    if (appUrl()) lines.push(`Ouvrir dans DeepWell : ${appUrl()}/#/page/${r.id}`);
    const base = agendaWords((r.title || '').trim() || 'Sans titre'); // la matière (propriété) est précisée dans le titre de l'événement
    out.set(r.id, { summary: subject && !base.toLowerCase().includes(subject.toLowerCase()) ? `${base} — ${subject}` : base, description: lines.join('\n'), ...times, extendedProperties: { private: { dw_page: r.id, dw_db: databaseId } } });
  }
  return out;
}

// ---------- réconciliation ----------
const chain = new Map(); // un seul passage à la fois par base (pas de doublons si deux tâches se chevauchent)
const serial = (key, fn) => { const run = (chain.get(key) || Promise.resolve()).catch(() => {}).then(fn); chain.set(key, run); run.finally(() => { if (chain.get(key) === run) chain.delete(key); }).catch(() => {}); return run; };

async function removeEvent(token, ev) {
  try { await g(token, 'DELETE', `/calendars/${encodeURIComponent(ev.calendar_id)}/events/${encodeURIComponent(ev.event_id)}`); }
  catch (e) { if (e.status !== 404 && e.status !== 410) throw e; } // déjà supprimé côté Google : parfait
  db.prepare('DELETE FROM gcal_events WHERE page_id=?').run(ev.page_id);
}

export function syncDatabase(databaseId) {
  return serial(`sync:${databaseId}`, async () => {
    const cfg = db.prepare('SELECT * FROM gcal_config WHERE database_id=?').get(databaseId);
    if (!cfg) return { created: 0, updated: 0, removed: 0 };
    const dbExists = !!db.prepare('SELECT 1 FROM pages WHERE id=? AND archived=0').get(databaseId);
    const stats = { created: 0, updated: 0, removed: 0 };
    const want = cfg.enabled && dbExists ? desiredEvents(databaseId, cfg) : new Map();
    const have = new Map(db.prepare('SELECT * FROM gcal_events WHERE database_id=?').all(databaseId).map((e) => [e.page_id, e]));
    const target = cfg.target === 'primary' ? 'primary' : db.prepare('SELECT calendar_id FROM gcal_calendars WHERE user_id=?').get(cfg.user_id)?.calendar_id || null;
    const work = [...have].some(([pid, ev]) => !want.has(pid) || ev.calendar_id !== target) || [...want].some(([pid, b]) => have.get(pid)?.hash !== sha(JSON.stringify([b, target])));
    if (!work) { if (!dbExists) db.prepare('DELETE FROM gcal_config WHERE database_id=?').run(databaseId); return stats; } // rien à faire : aucun appel à Google
    const token = await accessToken(cfg.user_id);
    let calId = want.size ? await calendarFor(cfg, token) : null;
    for (const [pid, ev] of have) if (!want.has(pid) || ev.calendar_id !== calId) { await removeEvent(token, ev); have.delete(pid); stats.removed++; }
    for (const [pid, body] of want) {
      const h = sha(JSON.stringify([body, calId])), ev = have.get(pid);
      if (ev && ev.hash === h) continue;
      const save = (id) => db.prepare('INSERT INTO gcal_events(page_id,database_id,user_id,calendar_id,event_id,hash,synced_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET calendar_id=excluded.calendar_id,event_id=excluded.event_id,hash=excluded.hash,synced_at=excluded.synced_at')
        .run(pid, databaseId, cfg.user_id, calId, id, h, now());
      const create = async () => {
        try { return (await g(token, 'POST', `/calendars/${encodeURIComponent(calId)}/events`, body)).id; }
        catch (e) { // agenda dédié supprimé par l'utilisateur : on le recrée une fois
          if (e.status !== 404 || cfg.target === 'primary') throw e;
          forgetCalendar(cfg.user_id, calId); calId = await calendarFor(cfg, token); return (await g(token, 'POST', `/calendars/${encodeURIComponent(calId)}/events`, body)).id;
        }
      };
      if (!ev) { save(await create()); stats.created++; continue; }
      try { await g(token, 'PATCH', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(ev.event_id)}`, body); save(ev.event_id); stats.updated++; }
      catch (e) { if (e.status !== 404 && e.status !== 410) throw e; save(await create()); stats.created++; } // événement supprimé à la main chez Google : recréé
    }
    if (!cfg.enabled || !dbExists) db.prepare('DELETE FROM gcal_events WHERE database_id=?').run(databaseId);
    if (!dbExists) db.prepare('DELETE FROM gcal_config WHERE database_id=?').run(databaseId);
    return stats;
  });
}
registerJob('gcal.sync', async ({ database_id }) => { await syncDatabase(database_id); });

/** Programme une réconciliation (au plus une en attente par base ; les changements qui arrivent pendant un passage en déclenchent un autre). */
export function scheduleSync(databaseId, delayMs = 5000) {
  const payload = JSON.stringify({ database_id: databaseId });
  if (db.prepare("SELECT 1 FROM jobs WHERE type='gcal.sync' AND status='pending' AND payload=?").get(payload)) return;
  enqueueJob('gcal.sync', { database_id: databaseId }, { maxAttempts: 6, delayMs });
}
/** À appeler après toute modification d'une page : si elle (ou sa base) est synchronisée, une mise à jour est programmée. */
export function gcalTouch(pageId) {
  try {
    if (!db.prepare('SELECT 1 FROM gcal_config LIMIT 1').get()) return; // chemin rapide : aucune base synchronisée
    const p = db.prepare('SELECT id,parent_id FROM pages WHERE id=?').get(pageId);
    for (const id of new Set([pageId, p?.parent_id].filter(Boolean))) if (db.prepare('SELECT 1 FROM gcal_config WHERE database_id=?').get(id)) scheduleSync(id);
  } catch { /* la synchronisation ne doit jamais empêcher une modification */ }
}
/** Sécurité : toutes les 30 min, chaque base synchronisée est re-vérifiée (rattrape un changement manqué). */
export function startGcalSweep() {
  const sweep = () => { for (const c of db.prepare('SELECT database_id FROM gcal_config').all()) scheduleSync(c.database_id, 0); };
  setTimeout(sweep, 60_000).unref(); return setInterval(sweep, 30 * 60_000).unref();
}

// ---------- API ----------
export const gcalRouter = express.Router();
const ownerOf = (req, res) => {
  const p = db.prepare("SELECT id,schema,title FROM pages WHERE id=? AND kind='database'").get(req.params.dbId);
  if (!p) { res.status(404).json({ error: 'Base introuvable' }); return null; }
  if (accessFor(req.user, p.id) !== 'owner') { res.status(403).json({ error: 'Seul le propriétaire de la base peut régler Google Agenda' }); return null; }
  return p;
};
const dateProps = (schema) => Object.entries(parse(schema, {}) || {}).filter(([, d]) => d.type === 'date').map(([k]) => k);

gcalRouter.get('/:dbId', requireAuth, (req, res) => {
  const p = ownerOf(req, res); if (!p) return;
  const cfg = db.prepare('SELECT * FROM gcal_config WHERE database_id=?').get(p.id);
  const last = db.prepare("SELECT status,last_error FROM jobs WHERE type='gcal.sync' AND payload=? ORDER BY updated_at DESC LIMIT 1").get(JSON.stringify({ database_id: p.id }));
  const pending = last?.status === 'pending' || last?.status === 'running';
  const t = db.prepare('SELECT email FROM drive_tokens WHERE user_id=?').get(req.user.id);
  res.json({ configured: driveConfigured(), connected: !!t, email: t?.email || null, calendar: !!t && hasCalendarScope(req.user.id),
    date_props: dateProps(p.schema), config: cfg ? { enabled: !!cfg.enabled, date_prop: cfg.date_prop, target: cfg.target } : null,
    synced: db.prepare('SELECT COUNT(*) c FROM gcal_events WHERE database_id=?').get(p.id).c, pending, error: last && last.status !== 'done' ? last.last_error || null : null });
});

gcalRouter.put('/:dbId', requireAuth, (req, res) => {
  const p = ownerOf(req, res); if (!p) return;
  const { enabled, date_prop: dp, target, tz } = req.body || {};
  const prev = db.prepare('SELECT * FROM gcal_config WHERE database_id=?').get(p.id);
  if (enabled === false) {
    if (prev) { db.prepare('UPDATE gcal_config SET enabled=0, updated_at=? WHERE database_id=?').run(now(), p.id); scheduleSync(p.id, 0); setTimeout(() => runDueJobs().catch(() => {}), 50).unref(); }
    return res.json({ ok: true });
  }
  if (!hasCalendarScope(req.user.id)) return res.status(400).json({ error: 'Autorisez d’abord Google Agenda (Réglages → Google Drive → reconnecter).' });
  const props = dateProps(p.schema), prop = typeof dp === 'string' && props.includes(dp) ? dp : prev?.date_prop && props.includes(prev.date_prop) ? prev.date_prop : props[0];
  if (!prop) return res.status(400).json({ error: 'Cette base n’a pas de propriété de type Date' });
  const tgt = target === 'primary' ? 'primary' : target === 'dedicated' ? 'dedicated' : prev?.target || 'dedicated';
  const zone = typeof tz === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : prev?.tz || 'Europe/Brussels';
  try { new Intl.DateTimeFormat('fr', { timeZone: zone }); } catch { return res.status(400).json({ error: 'Fuseau horaire inconnu' }); }
  db.prepare(`INSERT INTO gcal_config(database_id,user_id,enabled,date_prop,target,tz,updated_at) VALUES(?,?,1,?,?,?,?)
    ON CONFLICT(database_id) DO UPDATE SET user_id=excluded.user_id,enabled=1,date_prop=excluded.date_prop,target=excluded.target,tz=excluded.tz,updated_at=excluded.updated_at`).run(p.id, req.user.id, prop, tgt, zone, now());
  scheduleSync(p.id, 0); setTimeout(() => runDueJobs().catch(() => {}), 50).unref();
  res.json({ ok: true });
});

gcalRouter.post('/:dbId/sync', requireAuth, (req, res) => {
  const p = ownerOf(req, res); if (!p) return;
  if (!db.prepare('SELECT 1 FROM gcal_config WHERE database_id=? AND enabled=1').get(p.id)) return res.status(400).json({ error: 'La synchronisation n’est pas activée' });
  if (req.body?.full) db.prepare("UPDATE gcal_events SET hash='' WHERE database_id=?").run(p.id); // « tout renvoyer » : chaque événement est remis à jour (ou recréé s'il a disparu chez Google)
  scheduleSync(p.id, 0); setTimeout(() => runDueJobs().catch(() => {}), 50).unref();
  res.json({ ok: true });
});
