import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileWithAdapter,
  CompilerAdapter,
  normalizeActiveContext,
} from '../compiler';
import { buildGeneratorPayload } from '../generator';
import { envelope } from '../types';

const semanticCompiler: CompilerAdapter = async (input) => {
  const text = input.canonFragments.map((x) => x.content).join('\n').toLowerCase();
  const relationRule =
    text.includes('affection') ||
    text.includes('likes') ||
    text.includes('喜欢') ||
    text.includes('情感');

  return {
    status: 'READY',
    activeContext: {
      version: '0.5',
      facts: relationRule
        ? [
            {
              id: 'F1',
              type: 'character',
              proposition:
                'Affection does not by itself determine the next action.',
            },
          ]
        : [],
      constraints: [],
      unknowns: [],
      inference_barriers: relationRule
        ? [
            {
              id: 'IB1',
              rule:
                'Relationship state alone is insufficient to determine the next action.',
            },
          ]
        : [],
      open_dimensions: {
        action_selection: true,
        dialogue_realization: true,
        pacing: true,
        nonverbal_behavior: true,
        emotional_expression: true,
      },
      scene_state: input.sceneState,
    },
    provenance: {
      F1: {
        source_id: 'AUTHOR.PERSONALITY',
      },
    },
  };
};

test('semantic-equivalent Canon yields normalized-equivalent IR and identical Generator payload', async () => {
  const base = {
    request: 'write the same scene',
    sceneState: { location: 'room' },
  };

  const a = await compileWithAdapter(semanticCompiler, {
    ...base,
    canonFragments: [
      {
        semanticId: 'AUTHOR.PERSONALITY',
        content: 'LinYuan likes a person, but affection alone does not choose his action.',
      },
    ],
  });

  const b = await compileWithAdapter(semanticCompiler, {
    ...base,
    canonFragments: [
      {
        semanticId: 'AUTHOR.PERSONALITY',
        content: '零渊对某人有情感，并不意味着这种情感自动决定下一步行为。',
      },
    ],
  });

  assert.equal(a.status, 'READY');
  assert.equal(b.status, 'READY');
  if (a.status !== 'READY' || b.status !== 'READY') return;

  assert.equal(
    normalizeActiveContext(a.activeContext.value),
    normalizeActiveContext(b.activeContext.value)
  );

  const payloadA = buildGeneratorPayload({
    system: envelope('SYSTEM_FICTION', 'fiction'),
    request: envelope('USER_REQUEST', base.request),
    sceneState: envelope('SCENE_STATE', base.sceneState),
    activeContext: a.activeContext,
  });
  const payloadB = buildGeneratorPayload({
    system: envelope('SYSTEM_FICTION', 'fiction'),
    request: envelope('USER_REQUEST', base.request),
    sceneState: envelope('SCENE_STATE', base.sceneState),
    activeContext: b.activeContext,
  });

  assert.deepEqual(payloadA, payloadB);
});
