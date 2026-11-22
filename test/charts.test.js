import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
const { niceScale, aggregate } = await import('../public/js/charts.js');
const { parseIcon, makeIcon } = await import('../public/js/icons.js');

const rt = (t) => [{ type: 'text', text: { content: t }, plain_text: t, annotations: {} }];
const sel = (name) => ({ type: 'select', select: name ? { name } : null });
const rows = [
  { title: 'A', props: { Statut: sel('En cours'), Budget: { type: 'number', number: 100 } } },
  { title: 'B', props: { Statut: sel('Terminé'), Budget: { type: 'number', number: 50 } } },
  { title: 'C', props: { Statut: sel('En cours'), Budget: { type: 'number', number: 25 } } },
  { title: 'D', props: { Statut: sel(null), Budget: { type: 'number', number: 5 } } },
  { title: 'E', props: { Tags: { type: 'multi_select', multi_select: [{ name: 'x' }, { name: 'y' }] }, Fait: { type: 'checkbox', checkbox: true } } },
];
const schema = { Statut: { type: 'select', select: { options: [{ name: 'À faire' }, { name: 'En cours' }, { name: 'Terminé' }] } }, Budget: { type: 'number' }, Tags: { type: 'multi_select' }, Fait: { type: 'checkbox' } };

test('graduations « rondes »', () => {
  assert.deepEqual(niceScale(19), { max: 20, step: 5 });
  assert.deepEqual(niceScale(7), { max: 8, step: 2 });
  assert.deepEqual(niceScale(950), { max: 1000, step: 200 });
  assert.deepEqual(niceScale(0), { max: 1, step: 0.2 });
});

test('agrégation d’une base : comptage, somme, ordre des options, multi-sélection, vide', () => {
  const c = aggregate(rows, schema, { x: 'Statut', y: 'count' });
  assert.deepEqual(Object.fromEntries(c.labels.map((l, i) => [l, c.series[0].values[i]])), { 'En cours': 2, Terminé: 1, '(vide)': 2 });
  assert.ok(c.labels.indexOf('En cours') < c.labels.indexOf('Terminé'), 'ordre des options de la base respecté');
  const s = aggregate(rows, schema, { x: 'Statut', y: 'sum', yProp: 'Budget' });
  assert.equal(s.series[0].values[s.labels.indexOf('En cours')], 125);
  assert.equal(s.series[0].name, 'Somme de Budget');
  const m = aggregate(rows, schema, { x: 'Tags', y: 'count' });
  assert.deepEqual(Object.fromEntries(m.labels.map((l, i) => [l, m.series[0].values[i]])), { x: 1, y: 1, '(vide)': 4 });
  const t = aggregate(rows, schema, { x: '__title', y: 'count' });
  assert.equal(t.labels.length, 5);
  assert.equal(aggregate(rows, schema, { x: 'Fait', y: 'count' }).labels.includes('Oui'), true);
});

test('format des icônes de page : emoji, vectorielle (avec couleur), image', () => {
  assert.deepEqual(parseIcon('🚀'), { kind: 'emoji', text: '🚀' });
  assert.deepEqual(parseIcon('lucide:rocket'), { kind: 'vector', name: 'rocket', color: null });
  assert.deepEqual(parseIcon('lucide:rocket:blue'), { kind: 'vector', name: 'rocket', color: 'blue' });
  assert.equal(parseIcon('/files/abc').kind, 'image');
  assert.equal(parseIcon('javascript:alert(1)').kind, 'emoji', 'une URL non sûre n’est jamais traitée comme une image');
  assert.equal(makeIcon('star', 'red'), 'lucide:star:red');
  assert.equal(parseIcon(null), null);
});
