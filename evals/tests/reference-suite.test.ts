import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

import { loadEvalCases } from '../loader';
import { assertThresholds, evaluateSuite } from '../metrics';
import { referenceExecutor } from '../reference-executor';
import type { EvalThresholds } from '../types';

test('reference executor proves the evaluation harness and thresholds are wired', async () => {
  const cases = await loadEvalCases();
  const observations = [];

  for (const testCase of cases) {
    observations.push(await referenceExecutor(testCase));
  }

  const report = evaluateSuite(cases, observations);
  const thresholds = parse(
    await readFile('evals/thresholds.yaml', 'utf8')
  ) as EvalThresholds;

  assert.doesNotThrow(() => assertThresholds(report, thresholds));
  assert.equal(report.metrics.retrieval_recall, 1);
  assert.equal(report.metrics.constraint_fidelity, 1);
  assert.equal(report.metrics.forbidden_inference_rate, 0);
  assert.equal(report.metrics.ir_overconstraint_rate, 0);
  assert.equal(report.metrics.metamorphic_invariance_rate, 1);
});
