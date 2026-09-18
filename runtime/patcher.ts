export interface PatchContract {
  allowed_scope: unknown;
  preserve: string[];
  required_change: string[];
}

export interface PatchInput {
  draft: string;
  contract: PatchContract;
}

export function patch(draft: string, _contract: PatchContract): string {
  return draft;
}

export function assertNoEvidenceLeak(input: unknown): void {
  const text = JSON.stringify(input);
  if (text.includes('evidence_refs') || text.includes('provenance')) {
    throw new Error('PATCHER EVIDENCE LEAK DETECTED');
  }
}
