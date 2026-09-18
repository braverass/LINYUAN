import type { ActiveContext } from './compiler';

export interface GeneratorPayload {
  system: string;
  request: string;
  activeContext: ActiveContext;
}

export function buildGeneratorPayload(
  system: string,
  request: string,
  activeContext: ActiveContext
): GeneratorPayload {
  return { system, request, activeContext };
}

export function assertNoCanonLeak(payload: unknown): void {
  const text = JSON.stringify(payload);
  const forbidden = ['rawCanon', 'provenance', 'source_path', 'canon_excerpt'];
  for (const item of forbidden) {
    if (text.includes(item)) {
      throw new Error(`RAW CANON LEAK DETECTED: ${item}`);
    }
  }
}
