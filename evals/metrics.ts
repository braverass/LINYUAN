import type {
  EvalCase,
  EvalMetricReport,
  EvalObservation,
  EvalSuiteReport,
  EvalThresholds,
} from './types';

function intersectionSize(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((item) => rightSet.has(item))).size;
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function evaluateSuite(
  cases: EvalCase[],
  observations: EvalObservation[]
): EvalSuiteReport {
  const byId = new Map(observations.map((item) => [item.case_id, item]));

  let retrievalHit = 0;
  let retrievalExpected = 0;
  let requirementHit = 0;
  let requirementExpected = 0;
  let forbiddenTriggered = 0;
  let forbiddenExpected = 0;
  let overconstraintTriggered = 0;
  let overconstraintExpected = 0;
  let needContextTP = 0;
  let needContextFP = 0;
  let needContextFN = 0;
  let diversityScore = 0;
  let diversityCases = 0;
  let validatorFP = 0;
  let validatorTN = 0;
  let validatorFN = 0;
  let validatorTP = 0;
  let patchCount = 0;
  let patchOutside = 0;

  const caseResults: EvalSuiteReport['case_results'] = [];

  for (const testCase of cases) {
    const observation = byId.get(testCase.id);
    if (!observation) {
      throw new Error(`Missing observation for eval case: ${testCase.id}`);
    }

    caseResults.push({
      case_id: testCase.id,
      observation,
    });

    retrievalHit += intersectionSize(
      observation.retrieved_sources,
      testCase.required_sources
    );
    retrievalExpected += new Set(testCase.required_sources).size;

    const expectedRequirementIds = testCase.requirements.map((item) => item.id);
    requirementHit += intersectionSize(
      observation.satisfied_requirement_ids,
      expectedRequirementIds
    );
    requirementExpected += new Set(expectedRequirementIds).size;

    const forbiddenIds = testCase.forbidden_inferences.map((item) => item.id);
    forbiddenTriggered += intersectionSize(
      observation.triggered_forbidden_inference_ids,
      forbiddenIds
    );
    forbiddenExpected += new Set(forbiddenIds).size;

    const overconstraintIds = testCase.forbidden_overconstraints.map(
      (item) => item.id
    );
    overconstraintTriggered += intersectionSize(
      observation.triggered_overconstraint_ids,
      overconstraintIds
    );
    overconstraintExpected += new Set(overconstraintIds).size;

    const predictedNeed = new Set(observation.predicted_need_context_ids);
    const expectedNeed = new Set(testCase.expected_need_context);

    for (const id of predictedNeed) {
      if (expectedNeed.has(id)) {
        needContextTP += 1;
      } else {
        needContextFP += 1;
      }
    }
    for (const id of expectedNeed) {
      if (!predictedNeed.has(id)) {
        needContextFN += 1;
      }
    }

    if (testCase.behavioral_diversity.sample_count > 0) {
      const unique = new Set(observation.behavior_signatures).size;
      const required = testCase.behavioral_diversity.minimum_unique_signatures;
      diversityScore += required === 0 ? 1 : clamp01(unique / required);
      diversityCases += 1;
    }

    const validatorPositive = new Set(observation.validator_positive_ids);
    for (const id of testCase.validator.gold_violations) {
      if (validatorPositive.has(id)) {
        validatorTP += 1;
      } else {
        validatorFN += 1;
      }
    }
    for (const id of testCase.validator.gold_non_violations) {
      if (validatorPositive.has(id)) {
        validatorFP += 1;
      } else {
        validatorTN += 1;
      }
    }

    patchCount += observation.patch_count;
    patchOutside += observation.patch_changes_outside_scope;
  }

  let metamorphicGroups = 0;
  let invariantGroups = 0;
  const groups = new Map<string, EvalObservation[]>();

  for (const testCase of cases) {
    if (testCase.metamorphic_group === null) {
      continue;
    }
    const observation = byId.get(testCase.id);
    if (!observation) {
      continue;
    }
    const list = groups.get(testCase.metamorphic_group) ?? [];
    list.push(observation);
    groups.set(testCase.metamorphic_group, list);
  }

  for (const observationsInGroup of groups.values()) {
    if (observationsInGroup.length < 2) {
      continue;
    }
    metamorphicGroups += 1;

    const irHashes = new Set(
      observationsInGroup.map((item) => item.normalized_ir_hash)
    );
    const payloadHashes = new Set(
      observationsInGroup.map((item) => item.generator_payload_hash)
    );

    if (
      !irHashes.has(null) &&
      !payloadHashes.has(null) &&
      irHashes.size === 1 &&
      payloadHashes.size === 1
    ) {
      invariantGroups += 1;
    }
  }

  const metrics: EvalMetricReport = {
    retrieval_recall: ratio(retrievalHit, retrievalExpected, 1),
    constraint_fidelity: ratio(requirementHit, requirementExpected, 1),
    forbidden_inference_rate: ratio(
      forbiddenTriggered,
      forbiddenExpected,
      0
    ),
    ir_overconstraint_rate: ratio(
      overconstraintTriggered,
      overconstraintExpected,
      0
    ),
    need_context_precision: ratio(
      needContextTP,
      needContextTP + needContextFP,
      needContextFN === 0 ? 1 : 0
    ),
    need_context_recall: ratio(
      needContextTP,
      needContextTP + needContextFN,
      1
    ),
    behavioral_diversity: ratio(diversityScore, diversityCases, 1),
    validator_false_positive_rate: ratio(
      validatorFP,
      validatorFP + validatorTN,
      0
    ),
    validator_false_negative_rate: ratio(
      validatorFN,
      validatorFN + validatorTP,
      0
    ),
    patch_locality: patchCount === 0
      ? 1
      : clamp01(1 - patchOutside / patchCount),
    metamorphic_invariance_rate: ratio(
      invariantGroups,
      metamorphicGroups,
      1
    ),
  };

  return {
    version: '0.6',
    cases: cases.length,
    metrics,
    case_results: caseResults,
  };
}

export function assertThresholds(
  report: EvalSuiteReport,
  thresholds: EvalThresholds
): void {
  const failures: string[] = [];

  for (const [key, threshold] of Object.entries(thresholds.minimum)) {
    if (threshold === undefined) continue;
    const metric = key as keyof EvalMetricReport;
    const actual = report.metrics[metric];
    if (actual < threshold) {
      failures.push(
        `${metric}: expected >= ${threshold}, got ${actual.toFixed(4)}`
      );
    }
  }

  for (const [key, threshold] of Object.entries(thresholds.maximum)) {
    if (threshold === undefined) continue;
    const metric = key as keyof EvalMetricReport;
    const actual = report.metrics[metric];
    if (actual > threshold) {
      failures.push(
        `${metric}: expected <= ${threshold}, got ${actual.toFixed(4)}`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      ['Spec 0.6 evaluation thresholds failed:', ...failures].join('\n')
    );
  }
}
