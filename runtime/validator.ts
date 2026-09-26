import {
  ActiveContext,
  Provenance,
  Violation,
} from './types';
import type { RawCanonFragment } from './compiler';

export interface ValidatorInput {
  draft: string;
  request: string;
  sceneState: Record<string, unknown>;
  activeContext: ActiveContext;
  evidence: {
    rawCanon: RawCanonFragment[];
    provenance: Provenance;
  };
}

export type ValidatorAdapter = (
  input: ValidatorInput
) => Promise<Violation[]>;

export async function validateWithAdapter(
  adapter: ValidatorAdapter,
  input: ValidatorInput
): Promise<Violation[]> {
  const violations = await adapter(structuredClone(input));

  for (const violation of violations) {
    if (!violation.id || !violation.patch_contract) {
      throw new Error('Validator must return structured violations');
    }
  }

  return violations.map((violation) => structuredClone(violation));
}

export function stripEvidenceForPatcher(
  violation: Violation
): Omit<Violation, 'evidence_refs'> {
  const {
    evidence_refs: _evidenceRefs,
    ...patchVisibleViolation
  } = violation;

  return structuredClone(patchVisibleViolation);
}
