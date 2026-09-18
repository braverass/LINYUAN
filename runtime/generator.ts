import {
  ActiveContext,
  Envelope,
  MissingContext,
  envelope,
  unwrapAllowed,
} from './types';

export interface GeneratorPayload {
  system: string;
  request: string;
  sceneState: Record<string, unknown>;
  activeContext: ActiveContext;
}

export type GenerationResult =
  | {
      status: 'DRAFT';
      draft: string;
    }
  | {
      status: 'NEED_CONTEXT';
      missing: MissingContext[];
    };

export type GeneratorAdapter = (
  payload: GeneratorPayload
) => Promise<GenerationResult>;

const FORBIDDEN_KEYS = new Set([
  'rawCanon',
  'raw_canon',
  'canon_excerpt',
  'canonExcerpt',
  'provenance',
  'source_id',
  'sourceId',
  'source_path',
  'sourcePath',
  'evidence_refs',
  'evidenceRefs',
  'retrieval_result',
  'retrievalResult',
  'validator_evidence',
  'validatorEvidence',
]);

function assertNoForbiddenKeys(value: unknown, path = 'generator_payload'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoForbiddenKeys(item, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`GENERATOR CONTEXT LEAK at ${path}.${key}`);
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

export function assertNoCanonLeak(payload: unknown): void {
  assertNoForbiddenKeys(payload);
}

export function buildGeneratorPayload(input: {
  system: Envelope<string>;
  request: Envelope<string>;
  sceneState: Envelope<Record<string, unknown>>;
  activeContext: Envelope<ActiveContext>;
}): GeneratorPayload {
  const payload: GeneratorPayload = {
    system: unwrapAllowed(input.system, ['SYSTEM_FICTION']),
    request: unwrapAllowed(input.request, ['USER_REQUEST']),
    sceneState: structuredClone(
      unwrapAllowed(input.sceneState, ['SCENE_STATE'])
    ),
    activeContext: structuredClone(
      unwrapAllowed(input.activeContext, ['ACTIVE_CONTEXT'])
    ),
  };

  assertNoCanonLeak(payload);

  const keys = Object.keys(payload).sort().join(',');
  if (keys !== 'activeContext,request,sceneState,system') {
    throw new Error(`Unexpected Generator payload shape: ${keys}`);
  }

  return payload;
}

export async function generateIsolated(
  adapter: GeneratorAdapter,
  payload: GeneratorPayload
): Promise<GenerationResult> {
  assertNoCanonLeak(payload);
  const result = await adapter(structuredClone(payload));

  if (result.status === 'NEED_CONTEXT') {
    return {
      status: 'NEED_CONTEXT',
      missing: result.missing.map((item) => ({ ...item })),
    };
  }

  return {
    status: 'DRAFT',
    draft: result.draft,
  };
}

export function asDraftEnvelope(draft: string) {
  return envelope('DRAFT', draft);
}
