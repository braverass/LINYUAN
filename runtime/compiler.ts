import {
  ActiveContext,
  Envelope,
  MissingContext,
  Provenance,
  envelope,
} from './types';

export interface RawCanonFragment {
  semanticId: string;
  content: string;
  hash?: string;
}

export interface CompilerModelInput {
  request: string;
  sceneState: Record<string, unknown>;
  canonFragments: RawCanonFragment[];
}

export interface CompilerModelOutput {
  status: 'READY' | 'NEED_CONTEXT' | 'CONFLICT';
  activeContext?: ActiveContext;
  provenance?: Provenance;
  missing?: MissingContext[];
  conflict?: string;
}

export type CompilerAdapter = (
  input: CompilerModelInput
) => Promise<CompilerModelOutput>;

export type CompileResult =
  | {
      status: 'READY';
      activeContext: Envelope<ActiveContext>;
      provenance: Envelope<Provenance>;
    }
  | {
      status: 'NEED_CONTEXT';
      missing: MissingContext[];
    }
  | {
      status: 'CONFLICT';
      conflict: string;
    };

const FORBIDDEN_IR_KEYS = new Set([
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
]);

function assertNoForbiddenKeys(value: unknown, path = 'active_context'): void {
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
    if (FORBIDDEN_IR_KEYS.has(key)) {
      throw new Error(`FORBIDDEN IR FIELD at ${path}.${key}`);
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

export function sanitizeActiveContext(context: ActiveContext): ActiveContext {
  assertNoForbiddenKeys(context);

  if (context.version !== '0.5') {
    throw new Error('ACTIVE_CONTEXT version must be 0.5');
  }

  const requiredDimensions = [
    'action_selection',
    'dialogue_realization',
    'pacing',
    'nonverbal_behavior',
    'emotional_expression',
  ] as const;

  for (const key of requiredDimensions) {
    if (typeof context.open_dimensions?.[key] !== 'boolean') {
      throw new Error(`ACTIVE_CONTEXT open_dimensions.${key} must be boolean`);
    }
  }

  return structuredClone(context);
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function normalizeActiveContext(context: ActiveContext): string {
  const normalized: ActiveContext = {
    ...context,
    facts: sortById(context.facts),
    constraints: sortById(context.constraints),
    unknowns: sortById(context.unknowns),
    inference_barriers: sortById(context.inference_barriers),
  };
  return JSON.stringify(canonicalize(normalized));
}

export async function compileWithAdapter(
  adapter: CompilerAdapter,
  input: CompilerModelInput
): Promise<CompileResult> {
  const output = await adapter({
    request: input.request,
    sceneState: structuredClone(input.sceneState),
    canonFragments: input.canonFragments.map((fragment) => ({ ...fragment })),
  });

  if (output.status === 'NEED_CONTEXT') {
    return {
      status: 'NEED_CONTEXT',
      missing: output.missing ?? [],
    };
  }

  if (output.status === 'CONFLICT') {
    return {
      status: 'CONFLICT',
      conflict: output.conflict ?? 'Unresolved Canon conflict',
    };
  }

  if (!output.activeContext) {
    throw new Error('Compiler returned READY without ACTIVE_CONTEXT');
  }

  const activeContext = sanitizeActiveContext(output.activeContext);
  return {
    status: 'READY',
    activeContext: envelope('ACTIVE_CONTEXT', activeContext),
    provenance: envelope('PROVENANCE', output.provenance ?? {}),
  };
}
