export interface ActiveContext {
  facts: unknown[];
  constraints: unknown[];
  unknowns: unknown[];
  inference_barriers: unknown[];
  scene_state: Record<string, unknown>;
}

export interface CompileInput {
  request: string;
  canonFragments: unknown[];
}

export function compile(input: CompileInput): ActiveContext {
  return {
    facts: [],
    constraints: [],
    unknowns: [],
    inference_barriers: [],
    scene_state: { request: input.request }
  };
}
