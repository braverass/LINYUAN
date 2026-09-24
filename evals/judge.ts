import { stableHash } from '../runtime/trace';
import { parseJsonObject } from '../runtime/model/json';
import type {
  ModelCallRecord,
  ModelClient,
  ModelRequest,
} from '../runtime/model/types';
import type {
  ActiveContext,
  MissingContext,
  Violation,
} from '../runtime/types';
import type { CandidateInput, EvalGold } from './candidate-boundary';

export interface JudgeArtifacts {
  active_context: ActiveContext | null;
  output: string | null;
  samples: string[];
  predicted_missing: MissingContext[];
  validator_violations: Violation[];
}

export interface JudgeResult {
  satisfied_requirement_ids: string[];
  triggered_forbidden_inference_ids: string[];
  triggered_overconstraint_ids: string[];
  predicted_need_context_ids: string[];
  behavior_signatures: string[];
  validator_positive_ids: string[];
}

function setting(
  explicit: number | undefined,
  fallback: number | undefined
): number | null {
  return explicit ?? fallback ?? null;
}

export async function judgeCase(
  client: ModelClient,
  candidate: CandidateInput,
  gold: EvalGold,
  artifacts: JudgeArtifacts
): Promise<{ result: JudgeResult; call: ModelCallRecord }> {
  const request: ModelRequest = {
    stage: 'eval_judge',
    responseFormat: 'json',
    system:
      'You are an evaluator only. The candidate system never saw the gold labels below. Compare candidate artifacts against the gold semantics and return JSON only. Do not reward claims merely because they use similar wording.',
    prompt: JSON.stringify({
      candidate_visible_input: candidate,
      evaluator_gold: {
        requirements: gold.requirements,
        forbidden_inferences: gold.forbidden_inferences,
        forbidden_overconstraints: gold.forbidden_overconstraints,
        expected_need_context: gold.expected_need_context,
        validator: gold.validator,
      },
      candidate_artifacts: artifacts,
      instructions: {
        satisfied_requirement_ids:
          'Return only requirement ids actually preserved by ACTIVE_CONTEXT/output.',
        triggered_forbidden_inference_ids:
          'Return forbidden inference ids that the candidate actually made.',
        triggered_overconstraint_ids:
          'Return forbidden overconstraint ids that the candidate actually introduced.',
        predicted_need_context_ids:
          'Map each candidate missing-context item to an expected id when semantically equivalent. For unmatched extra missing items, emit a stable label beginning UNEXPECTED_.',
        behavior_signatures:
          'Return exactly one concise semantic behavior signature per sample, in sample order. Equivalent actions must share a signature; wording-only differences must not create new signatures.',
        validator_positive_ids:
          'From the union of gold_violations and gold_non_violations, return ids that the candidate validator behavior should count as positive.',
      },
      output_contract: {
        satisfied_requirement_ids: [],
        triggered_forbidden_inference_ids: [],
        triggered_overconstraint_ids: [],
        predicted_need_context_ids: [],
        behavior_signatures: [],
        validator_positive_ids: [],
      },
    }),
  };

  const started = Date.now();
  const response = await client.complete(request);
  const result = parseJsonObject<JudgeResult>(response.text);
  const call: ModelCallRecord = {
    stage: 'eval_judge',
    provider: response.provider,
    model: response.model,
    requested_model: client.model,
    request_hash: stableHash(request),
    response_hash: stableHash(response.text),
    response_format: 'json',
    latency_ms: response.latencyMs || Date.now() - started,
    request_id: response.requestId ?? null,
    response_id: response.responseId ?? null,
    usage: response.usage ? structuredClone(response.usage) : null,
    settings: {
      temperature: setting(request.temperature, client.defaults.temperature),
      top_p: setting(request.topP, client.defaults.topP),
      max_output_tokens: setting(
        request.maxOutputTokens,
        client.defaults.maxOutputTokens
      ),
      seed: setting(request.seed, client.defaults.seed),
    },
  };

  return { result, call };
}
