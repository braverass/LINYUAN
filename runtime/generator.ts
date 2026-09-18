import type { ActiveContext } from './compiler';

export interface GeneratorPayload {
  system: string;
  request: string;
  activeContext: ActiveContext;
}

export interface GenerationResult {
  draft: string;
}

export function buildGeneratorPayload(
  system: string,
  request: string,
  activeContext: ActiveContext
): GeneratorPayload {
  const payload = { system, request, activeContext };
  assertNoCanonLeak(payload);
  return payload;
}

export async function generate(payload: GeneratorPayload): Promise<GenerationResult> {
  assertNoCanonLeak(payload);
  return { draft: '' };
}

export function assertNoCanonLeak(payload: unknown): void {
  const text = JSON.stringify(payload);
  const forbidden = [
    'rawCanon',
    'raw_canon',
    'provenance',
    'source_path',
    'canon_excerpt',
    'evidence_refs'
  ];
  for (const item of forbidden) {
    if (text.includes(item)) {
      throw new Error(`RAW CANON LEAK DETECTED: ${item}`);
    }
  }
}
