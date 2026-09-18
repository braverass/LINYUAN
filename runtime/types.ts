export type RuntimeOrigin =
  | 'SYSTEM_FICTION'
  | 'USER_REQUEST'
  | 'SCENE_STATE'
  | 'ACTIVE_CONTEXT'
  | 'RAW_CANON'
  | 'PROVENANCE'
  | 'RETRIEVAL_RESULT'
  | 'VALIDATOR_EVIDENCE'
  | 'PATCH_CONTRACT'
  | 'DRAFT';

export interface Envelope<T> {
  readonly origin: RuntimeOrigin;
  readonly value: T;
}

export function envelope<T>(origin: RuntimeOrigin, value: T): Envelope<T> {
  return Object.freeze({ origin, value });
}

export function unwrapAllowed<T>(
  wrapped: Envelope<T>,
  allowed: readonly RuntimeOrigin[]
): T {
  if (!allowed.includes(wrapped.origin)) {
    throw new Error(`DISALLOWED RUNTIME ORIGIN: ${wrapped.origin}`);
  }
  return wrapped.value;
}

export interface Fact {
  id: string;
  type: string;
  proposition: string;
}

export interface Constraint {
  id: string;
  type: string;
  proposition: string;
  severity: 'hard' | 'soft';
}

export interface Unknown {
  id: string;
  question: string;
  blocking: boolean;
}

export interface InferenceBarrier {
  id: string;
  rule: string;
}

export interface OpenDimensions {
  action_selection: boolean;
  dialogue_realization: boolean;
  pacing: boolean;
  nonverbal_behavior: boolean;
  emotional_expression: boolean;
}

export interface ActiveContext {
  version: '0.5';
  facts: Fact[];
  constraints: Constraint[];
  unknowns: Unknown[];
  inference_barriers: InferenceBarrier[];
  open_dimensions: OpenDimensions;
  scene_state: Record<string, unknown>;
}

export interface MissingContext {
  type: string;
  subject?: string;
  question: string;
}

export interface ProvenanceRecord {
  source_id: string;
  evidence?: Array<{
    section?: string;
    locator?: string;
    hash?: string;
  }>;
}

export type Provenance = Record<string, ProvenanceRecord>;

export interface PatchScope {
  paragraph: number;
  sentences: [number, number];
}

export interface PatchContract {
  allowed_scope: PatchScope;
  preserve: string[];
  required_change: string[];
}

export interface ViolationLocation {
  paragraph: number;
  sentence_start: number;
  sentence_end: number;
}

export interface Violation {
  id: string;
  severity: 'hard' | 'soft';
  location: ViolationLocation;
  actual: {
    semantic_claim: string;
  };
  required_state: Record<string, unknown>;
  patch_contract: PatchContract;
  evidence_refs?: string[];
}
