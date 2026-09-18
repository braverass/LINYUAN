export interface Violation {
  id: string;
  severity: 'hard' | 'soft';
  location?: unknown;
  actual?: unknown;
  required_state?: unknown;
}

export function validate(_draft: string): Violation[] {
  return [];
}
