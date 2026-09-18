import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNoCanonLeak,
  buildGeneratorPayload,
} from '../generator';
import {
  ActiveContext,
  envelope,
} from '../types';

const context: ActiveContext = {
  version: '0.5',
  facts: [
    {
      id: 'F1',
      type: 'character',
      proposition: 'A relationship state does not determine the next action.',
    },
  ],
  constraints: [],
  unknowns: [],
  inference_barriers: [
    {
      id: 'IB1',
      rule: 'Relationship state alone is insufficient to determine the next action.',
    },
  ],
  open_dimensions: {
    action_selection: true,
    dialogue_realization: true,
    pacing: true,
    nonverbal_behavior: true,
    emotional_expression: true,
  },
};

test('Generator payload accepts only clean runtime origins', () => {
  const payload = buildGeneratorPayload({
    system: envelope('SYSTEM_FICTION', 'fiction'),
    request: envelope('USER_REQUEST', 'write scene'),
    sceneState: envelope('SCENE_STATE', {}),
    activeContext: envelope('ACTIVE_CONTEXT', context),
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    'activeContext',
    'request',
    'sceneState',
    'system',
  ]);
  assert.doesNotThrow(() => assertNoCanonLeak(payload));
});

test('RAW_CANON origin cannot be smuggled into Generator', () => {
  assert.throws(
    () =>
      buildGeneratorPayload({
        system: envelope('SYSTEM_FICTION', 'fiction'),
        request: envelope('USER_REQUEST', 'write scene'),
        sceneState: envelope('SCENE_STATE', {}),
        activeContext: envelope('RAW_CANON', context),
      }),
    /DISALLOWED RUNTIME ORIGIN/
  );
});

test('provenance/evidence keys are rejected recursively', () => {
  assert.throws(
    () =>
      assertNoCanonLeak({
        activeContext: {
          facts: [],
          nested: {
            provenance: {
              source_id: 'AUTHOR.PERSONALITY',
            },
          },
        },
      }),
    /GENERATOR CONTEXT LEAK/
  );
});
