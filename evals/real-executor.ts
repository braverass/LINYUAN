import { readFile } from 'node:fs/promises';

import {
  normalizeActiveContext,
  type CompilerModelOutput,
} from '../runtime/compiler';
import { generateIsolated, type GeneratorPayload } from '../runtime/generator';
import {
  createModelBackedRuntime,
  type RuntimeModelClients,
} from '../runtime/adapters/model-backed';
import { runFiction, type FictionRunResult } from '../runtime/orchestrator';
import { stableHash, type RunTrace } from '../runtime/trace';
import type {
  ActiveContext,
  MissingContext,
  Violation,
} from '../runtime/types';
import type { ModelCallRecord, ModelClient } from '../runtime/model/types';
import {
  assertCandidateInputIsolation,
  splitEvalCase,
  type CandidateInput,
} from './candidate-boundary';
import { judgeCase } from './judge';
import { countPatchesOutsideScope } from './patch-audit';
import type { EvalCase, EvalObservation } from './types';

const SYNTHETIC_SOURCE_ID = 'EVAL.SYNTHETIC';

interface CandidateRun {
  result: FictionRunResult;
  trace: RunTrace;
  active_context: ActiveContext | null;
  generator_payload: GeneratorPayload | null;
  output: string | null;
  predicted_missing: MissingContext[];
  validator_violations: Violation[];
  samples: string[];
  patch_applications: import('../runtime/orchestrator').PatchApplication[];
  calls: ModelCallRecord[];
}

function lastReadyContext(
  outputs: CompilerModelOutput[]
): ActiveContext | null {
  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const output = outputs[index];
    if (output?.status === 'READY' && output.activeContext) {
      return structuredClone(output.activeContext);
    }
  }
  return null;
}

async function runCandidate(
  candidate: CandidateInput,
  clients: RuntimeModelClients,
  sampleCount: number
): Promise<CandidateRun> {
  assertCandidateInputIsolation(candidate);
  const runtime = await createModelBackedRuntime(clients);
  const adapters = { ...runtime.adapters };

  if (candidate.synthetic_canon !== null) {
    const originalRetrieve = adapters.retrieve;
    adapters.planInitialRetrieval = async () => [SYNTHETIC_SOURCE_ID];
    adapters.retrieve = async (ids) => {
      const regular = ids.filter((id) => id !== SYNTHETIC_SOURCE_ID);
      const fragments =
        regular.length > 0 ? await originalRetrieve(regular) : [];
      if (ids.includes(SYNTHETIC_SOURCE_ID)) {
        fragments.unshift({
          semanticId: SYNTHETIC_SOURCE_ID,
          content: candidate.synthetic_canon ?? '',
          hash: stableHash(candidate.synthetic_canon ?? ''),
        });
      }
      return fragments;
    };
  }

  const system = await readFile('MODE-FICTION.md', 'utf8');
  const result = await runFiction(
    {
      system,
      request: candidate.request,
      sceneState: structuredClone(candidate.scene_state),
    },
    adapters
  );

  const mainGeneratorCall =
    runtime.artifacts.generator_calls.length > 0
      ? runtime.artifacts.generator_calls[
          runtime.artifacts.generator_calls.length - 1
        ]
      : undefined;
  const generatorPayload = mainGeneratorCall
    ? structuredClone(mainGeneratorCall.payload)
    : null;

  const samples: string[] = [];
  if (generatorPayload && sampleCount > 0) {
    for (let index = 0; index < sampleCount; index += 1) {
      const generation = await generateIsolated(
        adapters.generate,
        generatorPayload
      );
      if (generation.status === 'DRAFT') {
        samples.push(generation.draft);
      } else {
        samples.push(
          'NEED_CONTEXT:' + JSON.stringify(generation.missing)
        );
      }
    }
  }

  const lastValidator =
    runtime.artifacts.validator_calls.length > 0
      ? runtime.artifacts.validator_calls[
          runtime.artifacts.validator_calls.length - 1
        ]
      : undefined;

  return {
    result,
    trace: result.trace,
    active_context: lastReadyContext(runtime.artifacts.compiler_outputs),
    generator_payload: generatorPayload,
    output: result.status === 'OUTPUT' ? result.output : null,
    predicted_missing:
      result.status === 'NEED_CONTEXT'
        ? structuredClone(result.missing)
        : [],
    validator_violations: lastValidator
      ? structuredClone(lastValidator.violations)
      : [],
    samples,
    patch_applications: runtime.artifacts.patch_applications.map((item) =>
      structuredClone(item)
    ),
    calls: runtime.calls.map((call) => structuredClone(call)),
  };
}

function retrievedSources(trace: RunTrace): string[] {
  return [
    ...new Set(trace.retrieval.map((item) => item.semantic_id)),
  ];
}

export async function executeRealEvalCase(
  testCase: EvalCase,
  clients: RuntimeModelClients,
  judgeClient: ModelClient
): Promise<{
  observation: EvalObservation;
  calls: ModelCallRecord[];
}> {
  const { candidate, gold } = splitEvalCase(testCase);
  const candidateRun = await runCandidate(
    candidate,
    clients,
    gold.behavioral_diversity.sample_count
  );

  const judged = await judgeCase(judgeClient, candidate, gold, {
    active_context: candidateRun.active_context,
    output: candidateRun.output,
    samples: candidateRun.samples,
    predicted_missing: candidateRun.predicted_missing,
    validator_violations: candidateRun.validator_violations,
  });

  const observation: EvalObservation = {
    case_id: gold.id,
    retrieved_sources: retrievedSources(candidateRun.trace),
    satisfied_requirement_ids:
      judged.result.satisfied_requirement_ids ?? [],
    triggered_forbidden_inference_ids:
      judged.result.triggered_forbidden_inference_ids ?? [],
    triggered_overconstraint_ids:
      judged.result.triggered_overconstraint_ids ?? [],
    predicted_need_context_ids:
      judged.result.predicted_need_context_ids ?? [],
    behavior_signatures: judged.result.behavior_signatures ?? [],
    validator_positive_ids:
      judged.result.validator_positive_ids ?? [],
    patch_count: candidateRun.trace.patcher.scopes.length,
    patch_changes_outside_scope: countPatchesOutsideScope(
      candidateRun.patch_applications
    ),
    normalized_ir_hash: candidateRun.active_context
      ? stableHash(normalizeActiveContext(candidateRun.active_context))
      : null,
    generator_payload_hash: candidateRun.generator_payload
      ? stableHash(candidateRun.generator_payload)
      : null,
  };

  return {
    observation,
    calls: [...candidateRun.calls, judged.call],
  };
}
