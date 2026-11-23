import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-test-aw-'));
const { agendaWords } = await import('../server/gcal.js');

test('Google Agenda : TST → test, DVR → devoir, PRP → devoir côté (mots entiers seulement)', () => {
  assert.equal(agendaWords('TST #0003-26-MTH'), 'test #0003-26-MTH');
  assert.equal(agendaWords('DVR fractions'), 'devoir fractions');
  assert.equal(agendaWords('PRP : tableau'), 'devoir côté : tableau');
  assert.equal(agendaWords('Type : TST, DVR'), 'Type : test, devoir');
  assert.equal(agendaWords('ASTST DVRX PRPS TSTA'), 'ASTST DVRX PRPS TSTA', 'les mots qui contiennent ces lettres restent intacts');
  assert.equal(agendaWords('Sans changement'), 'Sans changement');
});
