import test from 'node:test';
import assert from 'node:assert/strict';

import { assertThresholds, evaluateSuite } from '../metrics';
import type {
  EvalCase,
  EvalObservation,
  EvalThresholds,
} from '../types';

const testCase: EvalCase = {
  version: '0.6',
  id: 'unit.metrics',
  category: 'adversarial',
  description: 'metric arithmetic',
  request: 'x',
  scene_state: {},
  required_sources: ['A', 'B'],
  requirements: [
    { id: 'R1', kind: 'constraint', description: 'one' },
    { id: 'R2', kind: 'constraint', description: 'two' },
  ],
  forbidden_inferences: [
    { id: 'F1', description: 'bad inference' },
  ],
  forbidden_overconstraints: [
    { id: 'O1', description: 'bad overconstraint' },
  ],
  expected_need_context: ['N1', 'N2'],
  behavioral_diversity: {
    sample_count: 4,
    minimum_unique_signatures: 2,
  },
  validator: {
    gold_violations: ['V1', 'V2'],
    gold_non_violations: ['NV1', 'NV2'],
  },
  metamorphic_group: null,
  synthetic_canon: null,
};

const observation: EvalObservation = {
  case_id: 'unit.metrics',
  retrieved_sources: ['A'],
  satisfied_requirement_ids: ['R1'],
  triggered_forbidden_inference_ids: ['F1'],
  triggered_overconstraint_ids: [],
  predicted_need_context_ids: ['N1', 'N3'],
  behavior_signatures: ['a', 'b'],
  validator_positive_ids: ['V1', 'NV1'],
  patch_count: 2,
  patch_changes_outside_scope: 1,
  normalized_ir_hash: null,
  generator_payload_hash: null,
};

test('metrics compute micro rates and penalize incomplete behavior sampling', () => {
  const report = evaluateSuite([testCase], [observation]);

  assert.equal(report.metrics.retrieval_recall, 0.5);
  assert.equal(report.metrics.constraint_fidelity, 0.5);
  assert.equal(report.metrics.forbidden_inference_rate, 1);
  assert.equal(report.metrics.ir_overconstraint_rate, 0);
  assert.equal(report.metrics.need_context_precision, 0.5);
  assert.equal(report.metrics.need_context_recall, 0.5);
  assert.equal(report.metrics.behavioral_diversity, 0.5);
  assert.equal(report.metrics.validator_false_positive_rate, 0.5);
  assert.equal(report.metrics.validator_false_negative_rate, 0.5);
  assert.equal(report.metrics.patch_locality, 0.5);
});

test('threshold enforcement rejects bad reports', () => {
  const report = evaluateSuite([testCase], [observation]);
  const thresholds: EvalThresholds = {
    minimum: {
      retrieval_recall: 0.9,
    },
    maximum: {
      forbidden_inference_rate: 0.1,
    },
  };

  assert.throws(
    () => assertThresholds(report, thresholds),
    /evaluation thresholds failed/
  );
});


test('synthetic Canon cases do not contaminate retrieval recall', () => {
  const syntheticCase: EvalCase = {
    ...structuredClone(testCase),
    id: 'unit.metrics.synthetic',
    required_sources: ['GOLD.SOURCE'],
    synthetic_canon: 'synthetic fixture',
  };
  const syntheticObservation: EvalObservation = {
    ...structuredClone(observation),
    case_id: syntheticCase.id,
    retrieved_sources: ['EVAL.SYNTHETIC'],
  };

  const report = evaluateSuite(
    [testCase, syntheticCase],
    [observation, syntheticObservation]
  );

  assert.equal(report.metrics.retrieval_recall, 0.5);
});
