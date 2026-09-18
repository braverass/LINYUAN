import { assertNoCanonLeak } from '../generator';

const payload = {
  system: 'fiction',
  request: 'write scene',
  activeContext: {
    facts: [],
    constraints: [],
    unknowns: [],
    inference_barriers: [],
    scene_state: {}
  }
};

assertNoCanonLeak(payload);

// This test represents the invariant:
// RAW_CANON -> GENERATOR payload must be impossible.
