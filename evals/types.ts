export type EvalCategory =
  | 'personality'
  | 'behavior'
  | 'knowledge'
  | 'ability'
  | 'continuity'
  | 'daily_life'
  | 'adversarial';

export interface EvalRequirement {
  id: string;
  kind: 'fact' | 'constraint' | 'inference_barrier';
  description: string;
}

export interface EvalForbiddenItem {
  id: string;
  description: string;
}

export interface EvalCase {
  version: '0.6';
  id: string;
  category: EvalCategory;
  description: string;
  request: string;
  scene_state: Record<string, unknown>;
  required_sources: string[];
  allowed_sources?: string[];
  requirements: EvalRequirement[];
  forbidden_inferences: EvalForbiddenItem[];
  forbidden_overconstraints: EvalForbiddenItem[];
  expected_need_context: string[];
  behavioral_diversity: {
    sample_count: number;
    minimum_unique_signatures: number;
  };
  validator: {
    gold_violations: string[];
    gold_non_violations: string[];
  };
  metamorphic_group: string | null;
  synthetic_canon: string | null;
}

export interface EvalObservation {
  case_id: string;
  retrieved_sources: string[];
  satisfied_requirement_ids: string[];
  triggered_forbidden_inference_ids: string[];
  triggered_overconstraint_ids: string[];
  predicted_need_context_ids: string[];
  behavior_signatures: string[];
  validator_positive_ids: string[];
  patch_count: number;
  patch_changes_outside_scope: number;
  normalized_ir_hash: string | null;
  generator_payload_hash: string | null;
}

export interface EvalMetricReport {
  retrieval_recall: number;
  retrieval_precision: number;
  constraint_fidelity: number;
  forbidden_inference_rate: number;
  ir_overconstraint_rate: number;
  need_context_precision: number;
  need_context_recall: number;
  behavioral_diversity: number;
  validator_false_positive_rate: number;
  validator_false_negative_rate: number;
  patch_locality: number;
  metamorphic_invariance_rate: number;
}

export interface EvalSuiteReport {
  version: '0.6';
  cases: number;
  metrics: EvalMetricReport;
  case_results: Array<{
    case_id: string;
    observation: EvalObservation;
  }>;
}

export interface EvalThresholds {
  minimum: Partial<Record<keyof EvalMetricReport, number>>;
  maximum: Partial<Record<keyof EvalMetricReport, number>>;
}

export type EvalExecutor = (testCase: EvalCase) => Promise<EvalObservation>;
