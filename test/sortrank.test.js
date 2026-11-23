import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRanks } from '../server/sortrank.js';
const T = (s) => ({ type: 'title', title: [{ plain_text: s }] }), N = (n) => ({ type: 'number', number: n });
test('rang de tri : texte (insensible aux chiffres), nombres vides en dernier', () => {
  const rows = [{ id: 'a', props: { Nom: T('Bravo'), N: N(5) } }, { id: 'b', props: { Nom: T('Alpha'), N: N(null) } }, { id: 'c', props: { Nom: T('Charlie 10'), N: N(1) } }, { id: 'd', props: { Nom: T('Charlie 2'), N: N(9) } }];
  const r = sortRanks(rows, ['a', 'b'], ['Nom', 'N']);
  assert.deepEqual(r.get('a'), { Nom: 1, N: 1 });
  assert.deepEqual(r.get('b'), { Nom: 0, N: 3 });
  assert.equal(sortRanks(rows, ['d'], ['Nom']).get('d').Nom, 2); // « Charlie 2 » avant « Charlie 10 »
});
