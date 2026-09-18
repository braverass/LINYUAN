export interface PatchContract {
  allowed_scope: unknown;
  preserve: string[];
  required_change: string[];
}

export function patch(draft: string, _contract: PatchContract): string {
  return draft;
}
