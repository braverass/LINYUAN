import { randomUUID } from 'node:crypto';
import {
  compileWithAdapter,
  CompilerAdapter,
  RawCanonFragment,
} from './compiler';
import {
  buildGeneratorPayload,
  generateIsolated,
  GeneratorAdapter,
} from './generator';
import {
  patchWithAdapter,
  PatchAdapter,
} from './patcher';
import {
  envelope,
  MissingContext,
  Provenance,
  Violation,
} from './types';
import {
  stripEvidenceForPatcher,
  validateWithAdapter,
  ValidatorAdapter,
} from './validator';
import {
  newRunTrace,
  RunTrace,
  stableHash,
} from './trace';

export type RetrieverAdapter = (
  semanticIds: string[]
) => Promise<RawCanonFragment[]>;

export type RetrievalPlannerAdapter = (
  missing: MissingContext[],
  request: string,
  sceneState: Record<string, unknown>,
  retrievedIds: string[]
) => Promise<string[]>;

export type InitialRetrievalPlannerAdapter = (
  request: string,
  sceneState: Record<string, unknown>
) => Promise<string[]>;

export interface RuntimeAdapters {
  retrieve: RetrieverAdapter;
  planInitialRetrieval?: InitialRetrievalPlannerAdapter;
  planAdditionalRetrieval: RetrievalPlannerAdapter;
  compile: CompilerAdapter;
  generate: GeneratorAdapter;
  validate: ValidatorAdapter;
  patch: PatchAdapter;
}

export interface FictionRunInput {
  system: string;
  request: string;
  sceneState: Record<string, unknown>;
  semanticIds?: string[];
  maxContextRounds?: number;
}

export type FictionRunResult =
  | {
      status: 'OUTPUT';
      output: string;
      trace: RunTrace;
    }
  | {
      status: 'NEED_CONTEXT';
      missing: MissingContext[];
      trace: RunTrace;
    }
  | {
      status: 'CONFLICT';
      conflict: string;
      trace: RunTrace;
    };

function mergeFragments(
  current: RawCanonFragment[],
  incoming: RawCanonFragment[]
): RawCanonFragment[] {
  const map = new Map(current.map((item) => [item.semanticId, item]));
  for (const item of incoming) {
    map.set(item.semanticId, item);
  }
  return [...map.values()];
}

function recordRetrieval(trace: RunTrace, fragments: RawCanonFragment[]): void {
  const seen = new Set(trace.retrieval.map((item) => item.semantic_id));
  for (const fragment of fragments) {
    if (seen.has(fragment.semanticId)) {
      continue;
    }
    trace.retrieval.push({
      semantic_id: fragment.semanticId,
      content_hash: fragment.hash ?? stableHash(fragment.content),
    });
    seen.add(fragment.semanticId);
  }
}

function sortViolationsForLocalPatching(violations: Violation[]): Violation[] {
  return [...violations].sort((a, b) => {
    if (a.location.paragraph !== b.location.paragraph) {
      return b.location.paragraph - a.location.paragraph;
    }
    return b.location.sentence_start - a.location.sentence_start;
  });
}

export async function runFiction(
  input: FictionRunInput,
  adapters: RuntimeAdapters
): Promise<FictionRunResult> {
  const trace = newRunTrace(randomUUID());
  const maxRounds = input.maxContextRounds ?? 3;

  let initialSemanticIds: string[];
  if (input.semanticIds !== undefined) {
    initialSemanticIds = [...input.semanticIds];
  } else if (adapters.planInitialRetrieval) {
    initialSemanticIds = await adapters.planInitialRetrieval(
      input.request,
      structuredClone(input.sceneState)
    );
  } else {
    throw new Error(
      'FictionRunInput.semanticIds or RuntimeAdapters.planInitialRetrieval is required'
    );
  }

  let canonFragments = await adapters.retrieve(initialSemanticIds);
  recordRetrieval(trace, canonFragments);

  for (let round = 0; round < maxRounds; round += 1) {
    const compiled = await compileWithAdapter(adapters.compile, {
      request: input.request,
      sceneState: input.sceneState,
      canonFragments,
    });

    if (compiled.status === 'CONFLICT') {
      return {
        status: 'CONFLICT',
        conflict: compiled.conflict,
        trace,
      };
    }

    if (compiled.status === 'NEED_CONTEXT') {
      const ids = await adapters.planAdditionalRetrieval(
        compiled.missing,
        input.request,
        structuredClone(input.sceneState),
        canonFragments.map((fragment) => fragment.semanticId)
      );
      const unseen = ids.filter((id) => !canonFragments.some((fragment) => fragment.semanticId === id));
      if (unseen.length === 0) {
        return {
          status: 'NEED_CONTEXT',
          missing: compiled.missing,
          trace,
        };
      }
      const added = await adapters.retrieve(unseen);
      canonFragments = mergeFragments(canonFragments, added);
      recordRetrieval(trace, added);
      continue;
    }

    const provenance: Provenance = compiled.provenance.value;
    trace.compiler.provenance.push(structuredClone(provenance));
    trace.compiler.active_context_hashes.push(
      stableHash(compiled.activeContext.value)
    );

    const generatorPayload = buildGeneratorPayload({
      system: envelope('SYSTEM_FICTION', input.system),
      request: envelope('USER_REQUEST', input.request),
      sceneState: envelope('SCENE_STATE', input.sceneState),
      activeContext: compiled.activeContext,
    });

    trace.generator.call_count += 1;
    trace.generator.payload_hashes.push(stableHash(generatorPayload));

    const generation = await generateIsolated(
      adapters.generate,
      generatorPayload
    );

    if (generation.status === 'NEED_CONTEXT') {
      trace.generator.need_context.push(
        generation.missing.map((item) => ({ ...item }))
      );
      const ids = await adapters.planAdditionalRetrieval(
        generation.missing,
        input.request,
        structuredClone(input.sceneState),
        canonFragments.map((fragment) => fragment.semanticId)
      );
      const unseen = ids.filter((id) => !canonFragments.some((fragment) => fragment.semanticId === id));
      if (unseen.length === 0 || round === maxRounds - 1) {
        return {
          status: 'NEED_CONTEXT',
          missing: generation.missing,
          trace,
        };
      }

      const added = await adapters.retrieve(unseen);
      canonFragments = mergeFragments(canonFragments, added);
      recordRetrieval(trace, added);
      continue;
    }

    const violations = await validateWithAdapter(adapters.validate, {
      draft: generation.draft,
      request: input.request,
      sceneState: structuredClone(input.sceneState),
      activeContext: compiled.activeContext.value,
      evidence: {
        rawCanon: canonFragments.map((fragment) => ({ ...fragment })),
        provenance: structuredClone(provenance),
      },
    });

    trace.validator.violations = violations.map((violation) => ({
      id: violation.id,
      severity: violation.severity,
      evidence_refs: [...(violation.evidence_refs ?? [])],
    }));

    let output = generation.draft;
    for (const violation of sortViolationsForLocalPatching(violations)) {
      const patchVisible = stripEvidenceForPatcher(violation);
      trace.patcher.scopes.push(
        structuredClone(patchVisible.patch_contract.allowed_scope)
      );
      output = await patchWithAdapter(
        adapters.patch,
        output,
        patchVisible
      );
    }

    return {
      status: 'OUTPUT',
      output,
      trace,
    };
  }

  return {
    status: 'NEED_CONTEXT',
    missing: [
      {
        type: 'runtime',
        question: 'Context compilation did not reach READY within maxContextRounds',
      },
    ],
    trace,
  };
}
