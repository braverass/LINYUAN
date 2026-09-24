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
    /positive integer/
  );
});
