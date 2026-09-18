import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEvalCases } from '../loader';

test('Spec 0.6 golden corpus loads with unique ids and a metamorphic pair', async () => {
  const cases = await loadEvalCases();

  assert.ok(cases.length >= 7);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);

  const metamorphic = cases.filter(
    (item) => item.metamorphic_group === 'META_AFFECTION_NOT_ACTION'
  );
  assert.equal(metamorphic.length, 2);
  assert.notEqual(metamorphic[0]?.synthetic_canon, metamorphic[1]?.synthetic_canon);
});
