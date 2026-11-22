/**
 * Dates : tout est stocké en ISO (comme Notion : « 2026-08-26T19:25:00.000+02:00 » ou « 2026-08-26 »)
 * et AFFICHÉ dans le fuseau horaire choisi par l'utilisateur (par défaut : celui de son appareil),
 * au format de son choix. Les dates sans heure restent des dates calendaires (jamais décalées).
 */
import { h, modal } from './util.js';

const KEY = 'dw_date_prefs';
const DEFAULTS = { tz: 'auto', dateFmt: 'long', timeFmt: '24' };
export const getPrefs = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
export const setPrefs = (p) => { try { localStorage.setItem(KEY, JSON.stringify({ ...getPrefs(), ...p })); } catch {} };
export const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const userTz = () => { const t = getPrefs().tz; return t && t !== 'auto' ? t : deviceTz(); };
const locale = () => navigator.language || 'fr-FR';
export const allTimezones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return [deviceTz(), 'UTC', 'Europe/Paris']; } };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const pad = (n) => String(n).padStart(2, '0');

/** Composantes (année, mois, jour, heure, minute) d'un instant dans un fuseau. */
export function partsInTz(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}
const offsetMs = (date, tz) => { const p = partsInTz(date, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000; };
/** Heure « murale » (sans décalage) d'un fuseau -> instant réel. */
export function wallToInstant(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz); // 2e passe : gère les changements d'heure
  return new Date(t);
}
export function offsetString(date, tz) {
  const m = Math.round(offsetMs(date, tz) / 60000), sign = m < 0 ? '-' : '+', a = Math.abs(m);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Analyse une date Notion : { allDay, y,m,d } ou { allDay:false, instant }. */
export function parseNotionDate(str, timeZone) {
  if (!str) return null;
  if (DATE_ONLY.test(str)) { const [y, m, d] = str.split('-').map(Number); return { allDay: true, y, m, d }; }
  if (HAS_OFFSET.test(str)) { const t = new Date(str); return isNaN(t) ? null : { allDay: false, instant: t }; }
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const t = new Date(str); return isNaN(t) ? null : { allDay: false, instant: t }; }
  return { allDay: false, instant: wallToInstant(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), timeZone || userTz()) };
}

function fmtDay(p, tz) {
  const prefs = getPrefs();
  const dt = p.allDay ? new Date(Date.UTC(p.y, p.m - 1, p.d, 12)) : p.instant, zone = p.allDay ? 'UTC' : tz;
  const q = partsInTz(dt, zone);
  if (prefs.dateFmt === 'iso') return `${q.y}-${pad(q.m)}-${pad(q.d)}`;
  if (prefs.dateFmt === 'short') return new Intl.DateTimeFormat(locale(), { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt);
  if (prefs.dateFmt === 'relative') {
    const today = partsInTz(new Date(), tz), diff = Math.round((Date.UTC(q.y, q.m - 1, q.d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000);
    if (Math.abs(diff) <= 1) { const s = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(diff, 'day'); return s[0].toUpperCase() + s.slice(1); }
  }
  return new Intl.DateTimeFormat(locale(), { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric' }).format(dt);
}
const fmtTime = (p, tz) => new Intl.DateTimeFormat(locale(), { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: getPrefs().timeFmt === '12' }).format(p.instant);

/** « 26 août 2026, 19:25 » dans le fuseau de l'utilisateur ; accepte {start,end,time_zone} ou une chaîne ISO. */
export function formatDate(d, { withTz = false } = {}) {
  if (!d) return '';
  if (typeof d === 'string') d = { start: d };
  const tz = userTz(), a = parseNotionDate(d.start, d.time_zone);
  if (!a) return String(d.start || '');
  const one = (p) => (p.allDay ? fmtDay(p, tz) : `${fmtDay(p, tz)}, ${fmtTime(p, tz)}`);
  let out;
  const b = d.end ? parseNotionDate(d.end, d.time_zone) : null;
  if (b && !a.allDay && !b.allDay && fmtDay(a, tz) === fmtDay(b, tz)) out = `${fmtDay(a, tz)}, ${fmtTime(a, tz)} → ${fmtTime(b, tz)}`;
  else out = b ? `${one(a)} → ${one(b)}` : one(a);
  return withTz && !a.allDay ? `${out} (${tz})` : out;
}

const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
/** Remplace les dates ISO « brutes » d'un texte (ex. titres importés) par leur version locale. */
export const prettify = (text) => (typeof text === 'string' && /\d{4}-\d{2}-\d{2}/.test(text) ? text.replace(ISO_IN_TEXT, (m) => formatDate(m) || m) : text);

// --- saisie ---
/** { date:'YYYY-MM-DD', time:'HH:MM'|'' } dans le fuseau utilisateur, à partir d'une date Notion. */
export function toInputs(str, timeZone) {
  const p = parseNotionDate(str, timeZone);
  if (!p) return { date: '', time: '' };
  if (p.allDay) return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: '' };
  const q = partsInTz(p.instant, userTz());
  return { date: `${q.y}-${pad(q.m)}-${pad(q.d)}`, time: `${pad(q.h)}:${pad(q.mi)}` };
}
/** Inverse : date + heure saisies (fuseau utilisateur) -> chaîne ISO Notion avec décalage. */
export function fromInputs(date, time) {
  if (!date) return null;
  if (!time) return date;
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number), tz = userTz();
  const inst = wallToInstant(y, m, d, hh, mm, 0, tz);
  return `${date}T${pad(hh)}:${pad(mm)}:00.000${offsetString(inst, tz)}`;
}
export const todayIso = (plusDays = 0) => { const p = partsInTz(new Date(), userTz()), t = new Date(Date.UTC(p.y, p.m - 1, p.d + plusDays)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };

/** Fenêtre de choix de date (avec heure et fin optionnelles). Résout {start,end,time_zone:null} ou null. */
export function pickDate(initial = {}) {
  return new Promise((resolve) => {
    const s = toInputs(initial.start || todayIso(), initial.time_zone), e = toInputs(initial.end, initial.time_zone);
    const d1 = h('input', { type: 'date', class: 'input', value: s.date }), t1 = h('input', { type: 'time', class: 'input', value: s.time });
    const d2 = h('input', { type: 'date', class: 'input', value: e.date }), t2 = h('input', { type: 'time', class: 'input', value: e.time });
    const withTime = h('input', { type: 'checkbox' }), withEnd = h('input', { type: 'checkbox' });
    withTime.checked = !!s.time; withEnd.checked = !!initial.end;
    const timeRow = h('div', { class: 'share-row' }, h('span', { class: 'muted small' }, 'Heure'), t1), endRow = h('div', { class: 'share-row' }, d2, t2);
    const preview = h('div', { class: 'muted small' });
    const sync = () => {
      timeRow.hidden = !withTime.checked; endRow.hidden = !withEnd.checked; t2.hidden = !withTime.checked;
      const v = value(); preview.textContent = v ? `Affiché : ${formatDate(v)} — fuseau ${userTz()}` : '';
    };
    const value = () => {
      const start = fromInputs(d1.value, withTime.checked ? t1.value || '00:00' : '');
      if (!start) return null;
      const end = withEnd.checked ? fromInputs(d2.value || d1.value, withTime.checked ? t2.value || t1.value || '00:00' : '') : null;
      return { start, end, time_zone: null };
    };
    let done = false; const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    [d1, t1, d2, t2, withTime, withEnd].forEach((x) => x.addEventListener('input', sync));
    const m = modal('Date', h('form', { onsubmit: (ev) => { ev.preventDefault(); finish(value()); } },
      d1, h('label', { class: 'check' }, withTime, 'Inclure l’heure'), timeRow, h('label', { class: 'check' }, withEnd, 'Date de fin'), endRow, preview,
      h('div', { class: 'row-end' }, initial.start ? h('button', { type: 'button', class: 'btn danger', onclick: () => finish({ remove: true }) }, 'Supprimer') : null,
        h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Annuler'), h('button', { class: 'btn primary' }, 'OK'))), { onClose: () => finish(null) });
    sync();
  });
}
