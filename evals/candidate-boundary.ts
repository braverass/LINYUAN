import type {
  EvalCase,
  EvalCategory,
  EvalForbiddenItem,
  EvalRequirement,
} from './types';

export interface CandidateInput {
  version: '0.7';
  request: string;
  scene_state: Record<string, unknown>;
  synthetic_canon: string | null;
}

export interface EvalGold {
  id: string;
  category: EvalCategory;
  description: string;
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
}

const FORBIDDEN_CANDIDATE_KEYS = new Set([
  'id',
  'category',
  'description',
  'required_sources',
  'allowed_sources',
  'requirements',
  'forbidden_inferences',
  'forbidden_overconstraints',
  'expected_need_context',
  'behavioral_diversity',
  'validator',
  'gold_violations',
  'gold_non_violations',
  'metamorphic_group',
]);

export function assertCandidateInputIsolation(
  value: unknown,
  path = 'candidate_input'
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertCandidateInputIsolation(item, path + '[' + index + ']')
    );
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (FORBIDDEN_CANDIDATE_KEYS.has(key)) {
      throw new Error('EVAL GOLD LEAK at ' + path + '.' + key);
    }
    assertCandidateInputIsolation(child, path + '.' + key);
  }
}

export function splitEvalCase(testCase: EvalCase): {
  candidate: CandidateInput;
  gold: EvalGold;
} {
  const candidate: CandidateInput = {
    version: '0.7',
    request: testCase.request,
    scene_state: structuredClone(testCase.scene_state),
    synthetic_canon: testCase.synthetic_canon,
  };
  assertCandidateInputIsolation(candidate);

  return {
    candidate,
    gold: {
      id: testCase.id,
      category: testCase.category,
      description: testCase.description,
      required_sources: [...testCase.required_sources],
      ...(testCase.allowed_sources ? { allowed_sources: [...testCase.allowed_sources] } : {}),
      requirements: structuredClone(testCase.requirements),
      forbidden_inferences: structuredClone(testCase.forbidden_inferences),
      forbidden_overconstraints: structuredClone(
        testCase.forbidden_overconstraints
      ),
      expected_need_context: [...testCase.expected_need_context],
      behavioral_diversity: structuredClone(testCase.behavioral_diversity),
      validator: structuredClone(testCase.validator),
      metamorphic_group: testCase.metamorphic_group,
    },
  };
}
