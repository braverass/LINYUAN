// Spec 0.5 Canon-to-Generation compilation runtime
//
// Hard rule:
// RAW_CANON must never enter generator payload.

export interface ActiveContext {
  facts: unknown[];
  constraints: unknown[];
  unknowns: unknown[];
  inference_barriers: unknown[];
  scene_state: Record<string, unknown>;
}

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
  const payload = {
    system,
    request,
    activeContext,
  };

  assertNoCanonLeak(payload);
  return payload;
}

function assertNoCanonLeak(payload: unknown): void {
  const serialized = JSON.stringify(payload);

  const forbidden = [
    "raw_canon",
    "canon_excerpt",
    "source_path",
    "provenance",
    "evidence_refs",
  ];

  for (const field of forbidden) {
    if (serialized.includes(field)) {
      throw new Error(`RAW CANON LEAK DETECTED: ${field}`);
    }
  }
}
