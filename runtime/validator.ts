import {
  ActiveContext,
  Provenance,
  Violation,
} from './types';
import type { RawCanonFragment } from './compiler';
import { validateViolations } from './contracts';

export interface ValidatorInput {
  draft: string;
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
  return validateViolations(violations);
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
