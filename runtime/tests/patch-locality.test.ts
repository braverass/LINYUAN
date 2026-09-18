import { validatePatchScope } from '../patcher';

const patch = {
  allowed_scope: {
    paragraph: 1,
    sentences: [1, 2]
  },
  preserve: [
    'POV',
    'scene_goal',
    'emotional_state'
  ]
};

validatePatchScope(patch);

// Invariant:
// PATCHER changes must remain inside declared locality.
