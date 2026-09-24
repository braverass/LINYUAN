import {
  ActiveContext,
  Envelope,
  MissingContext,
  Provenance,
  envelope,
} from './types';
import {
  validateActiveContextShape,
  validateMissingContexts,
  validateProvenance,
} from './contracts';

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
  const validated = validateActiveContextShape(context);
  assertNoForbiddenKeys(validated);
  return canonicalizeActiveContext(validated);
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

export function canonicalizeActiveContext(
  context: ActiveContext
): ActiveContext {
  return {
    ...structuredClone(context),
    facts: sortById(context.facts),
    constraints: sortById(context.constraints),
    unknowns: sortById(context.unknowns),
    inference_barriers: sortById(context.inference_barriers),
  };
}

export function normalizeActiveContext(context: ActiveContext): string {
  return JSON.stringify(canonicalize(canonicalizeActiveContext(context)));
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

  if (
    output.status !== 'READY' &&
    output.status !== 'NEED_CONTEXT' &&
    output.status !== 'CONFLICT'
  ) {
    throw new Error('Compiler returned an unsupported status');
  }

  if (output.status === 'NEED_CONTEXT') {
    return {
      status: 'NEED_CONTEXT',
      missing: validateMissingContexts(output.missing ?? [], 'compiler.missing'),
    };
  }

  if (output.status === 'CONFLICT') {
    if (typeof output.conflict !== 'string' || output.conflict.trim().length === 0) {
      throw new Error('Compiler returned CONFLICT without a non-empty conflict');
    }
    return {
      status: 'CONFLICT',
      conflict: output.conflict,
    };
  }

  if (!output.activeContext) {
    throw new Error('Compiler returned READY without ACTIVE_CONTEXT');
  }

  const activeContext = sanitizeActiveContext(output.activeContext);
  return {
    status: 'READY',
    activeContext: envelope('ACTIVE_CONTEXT', activeContext),
    provenance: envelope(
      'PROVENANCE',
      validateProvenance(output.provenance ?? {})
    ),
  };
}
