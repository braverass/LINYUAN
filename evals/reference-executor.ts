import { createHash } from 'node:crypto';

import type {
  EvalCase,
  EvalExecutor,
  EvalObservation,
} from './types';

function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

/**
 * Harness self-test executor.
 *
 * This is NOT a model-quality baseline. It mirrors the gold annotations so CI can
 * verify that loading, metric aggregation, thresholds and metamorphic grouping
 * work. Real evaluations must provide EVAL_ADAPTER pointing at a candidate
 * executor.
 */
export const referenceExecutor: EvalExecutor = async (
  testCase: EvalCase
): Promise<EvalObservation> => {
  const metamorphicKey = testCase.metamorphic_group ?? testCase.id;
  const normalizedHash = hash({
    semantics: metamorphicKey,
    requirements: testCase.requirements.map((item) => item.id).sort(),
  });
  const payloadHash = hash({
    semantics: metamorphicKey,
    request: testCase.request,
    scene_state: testCase.scene_state,
  });

  const signatures = Array.from(
    {
      length: Math.max(
        testCase.behavioral_diversity.minimum_unique_signatures,
        1
      ),
    },
    (_, index) => `behavior-${index + 1}`
  );

  return {
    case_id: testCase.id,
    retrieved_sources: [...testCase.required_sources],
    satisfied_requirement_ids: testCase.requirements.map((item) => item.id),
    triggered_forbidden_inference_ids: [],
    triggered_overconstraint_ids: [],
    predicted_need_context_ids: [...testCase.expected_need_context],
    behavior_signatures: signatures,
    validator_positive_ids: [...testCase.validator.gold_violations],
    patch_count: testCase.validator.gold_violations.length,
    patch_changes_outside_scope: 0,
    normalized_ir_hash: normalizedHash,
    generator_payload_hash: payloadHash,
  };
};
