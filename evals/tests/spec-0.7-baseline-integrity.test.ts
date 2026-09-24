import test from 'node:test';
import assert from 'node:assert/strict';

import { stableHash } from '../../runtime/trace';
import { assertBaselinePair } from '../baseline-integrity';
import type { RealEvalManifest } from '../run-manifest';
import type { EvalSuiteReport } from '../types';

const report: EvalSuiteReport = {
  version: '0.6',
  cases: 0,
  metrics: {
    retrieval_recall: 1,
    constraint_fidelity: 1,
    forbidden_inference_rate: 0,
    ir_overconstraint_rate: 0,
    need_context_precision: 1,
    need_context_recall: 1,
    behavioral_diversity: 1,
    validator_false_positive_rate: 0,
    validator_false_negative_rate: 0,
    patch_locality: 1,
    metamorphic_invariance_rate: 1,
  },
  case_results: [],
};

function manifestFor(value: EvalSuiteReport): RealEvalManifest {
  return {
    version: '0.7',
    created_at: '2026-09-18T00:00:00.000Z',
    commit_sha: 'fixture',
    case_set_hash: 'fixture',
    report_hash: stableHash(value),
    stage_models: {},
    prompt_template_hashes: {},
    evaluation_contract_hashes: {},
    source_hashes: {},
    calls: [],
  };
}

test('baseline manifest is cryptographically bound to its report', () => {
  const manifest = manifestFor(report);
  assert.doesNotThrow(() => assertBaselinePair(report, manifest));

  const changed = structuredClone(report);
  changed.metrics.retrieval_recall = 0.5;

  assert.throws(
    () => assertBaselinePair(changed, manifest),
    /report\/manifest mismatch/
  );
});
