import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
const D = await import('../public/js/dates.js');
const use = (p) => D.setPrefs({ dateFmt: 'long', timeFmt: '24', ...p });

test('affichage dans le fuseau choisi, sans décaler les dates sans heure', () => {
  use({ tz: 'Europe/Paris' });
  assert.match(D.formatDate('2026-08-26T19:25:00.000+02:00'), /26 août 2026.*19:25/);
  use({ tz: 'America/New_York' });
  assert.match(D.formatDate('2026-08-26T19:25:00.000+02:00'), /26 août 2026.*13:25/);
  use({ tz: 'Asia/Tokyo' });
  assert.match(D.formatDate('2026-08-26T19:25:00.000+02:00'), /27 août 2026.*02:25/, 'passe au lendemain à Tokyo');
  assert.match(D.formatDate('2026-08-26'), /^26 août 2026$/, 'date sans heure : jamais décalée');
  use({ tz: 'Europe/Paris' });
  assert.match(D.formatDate({ start: '2026-08-26T10:00:00', time_zone: 'America/New_York' }), /26 août 2026.*16:00/, 'heure murale + time_zone Notion');
});

test('formats : court, ISO, 12 h, plage', () => {
  use({ tz: 'Europe/Paris', dateFmt: 'short' });
  assert.match(D.formatDate('2026-08-26T19:25:00+02:00'), /26\/08\/2026/);
  use({ tz: 'Europe/Paris', dateFmt: 'iso', timeFmt: '12' });
  assert.match(D.formatDate('2026-08-26T19:25:00+02:00'), /^2026-08-26, 0?7:25\s?PM$/i);
  use({ tz: 'Europe/Paris' });
  assert.match(D.formatDate({ start: '2026-08-26T09:00:00+02:00', end: '2026-08-26T10:30:00+02:00' }), /26 août 2026, 09:00 → 10:30/);
});

test('titres importés : dates ISO remplacées, le reste intact', () => {
  use({ tz: 'Europe/Paris' });
  assert.match(D.prettify('Entrée du 2026-09-03T11:29:00.000+02:00 '), /^Entrée du 3 septembre 2026, 11:29 $/);
  assert.equal(D.prettify('Calendrier 2026-2027 v1.1'), 'Calendrier 2026-2027 v1.1');
});

test('saisie : aller-retour fuseau, changement d’heure', () => {
  use({ tz: 'Europe/Paris' });
  assert.equal(D.fromInputs('2026-07-01', '10:00'), '2026-07-01T10:00:00.000+02:00', 'été');
  assert.equal(D.fromInputs('2026-12-01', '10:00'), '2026-12-01T10:00:00.000+01:00', 'hiver');
  assert.equal(D.fromInputs('2026-07-01', ''), '2026-07-01');
  assert.deepEqual(D.toInputs('2026-07-01T10:00:00.000+02:00'), { date: '2026-07-01', time: '10:00' });
  use({ tz: 'America/New_York' });
  assert.deepEqual(D.toInputs('2026-07-01T10:00:00.000+02:00'), { date: '2026-07-01', time: '04:00' });
  assert.equal(D.fromInputs('2026-07-01', '04:00'), '2026-07-01T04:00:00.000-04:00');
});
