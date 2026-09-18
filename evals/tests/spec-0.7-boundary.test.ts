import test from 'node:test';
import assert from 'node:assert/strict';

import { splitEvalCase } from '../candidate-boundary';
import { loadEvalCases } from '../loader';

test('candidate-visible eval input contains no evaluator gold fields or labels', async () => {
  const cases = await loadEvalCases();

  for (const testCase of cases) {
    const { candidate, gold } = splitEvalCase(testCase);
    assert.deepEqual(Object.keys(candidate).sort(), [
      'request',
      'scene_state',
      'synthetic_canon',
      'version',
    ]);

    const serialized = JSON.stringify(candidate);
    assert.equal(serialized.includes(gold.id), false);
    for (const requirement of gold.requirements) {
      assert.equal(serialized.includes(requirement.id), false);
    }
    for (const forbidden of gold.forbidden_inferences) {
      assert.equal(serialized.includes(forbidden.id), false);
    }
    for (const forbidden of gold.forbidden_overconstraints) {
      assert.equal(serialized.includes(forbidden.id), false);
    }
    for (const expected of gold.expected_need_context) {
      assert.equal(serialized.includes(expected), false);
    }
    for (const id of [
      ...gold.validator.gold_violations,
      ...gold.validator.gold_non_violations,
    ]) {
      assert.equal(serialized.includes(id), false);
    }
  }
});
