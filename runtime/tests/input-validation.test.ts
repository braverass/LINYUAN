import test from 'node:test';
import assert from 'node:assert/strict';

import { runProductionFiction } from '../production-fiction';

test('production runtime rejects context-round counts outside safe integer range', async () => {
  await assert.rejects(
    () =>
      runProductionFiction({
        request: 'fixture',
        maxContextRounds: Number.MAX_SAFE_INTEGER + 1,
      }),
    /positive safe integer/
  );
});


test('production runtime rejects non-object scene state from programmatic callers', async () => {
  await assert.rejects(
    () =>
      runProductionFiction({
        request: 'fixture',
        sceneState: [] as any,
      }),
    /plain JSON object/
  );
});

test('production runtime rejects blank explicit semantic IDs', async () => {
  await assert.rejects(
    () =>
      runProductionFiction({
        request: 'fixture',
        semanticIds: ['AUTHOR.PERSONALITY', '   '],
      }),
    /array of non-empty strings/
  );
});

test('production runtime rejects an empty custom system contract', async () => {
  await assert.rejects(
    () =>
      runProductionFiction({
        request: 'fixture',
        system: '   ',
      }),
    /system must be a non-empty string/
  );
});

test('production runtime rejects non-plain scene objects', async () => {
  await assert.rejects(
    () =>
      runProductionFiction({
        request: 'fixture',
        sceneState: new Date() as any,
      }),
    /plain JSON object/
  );
});
