import test from 'node:test';
import assert from 'node:assert/strict';

import { runFiction } from '../orchestrator';
import type { RuntimeAdapters } from '../orchestrator';

test('NEED_CONTEXT causes retrieval/recompile and a fresh Generator call', async () => {
  let generatorCalls = 0;

  const adapters: RuntimeAdapters = {
    retrieve: async (ids) =>
      ids.map((semanticId) => ({
        semanticId,
        content: semanticId === 'EXTRA.KNOWLEDGE' ? 'extra fact' : 'base fact',
      })),

    planAdditionalRetrieval: async () => ['EXTRA.KNOWLEDGE'],

    compile: async (input) => ({
      status: 'READY',
      activeContext: {
        version: '0.5',
        facts: input.canonFragments.map((fragment, index) => ({
          id: `F${index + 1}`,
          type: 'fact',
          proposition: fragment.content,
        })),
        constraints: [],
        unknowns: [],
        inference_barriers: [],
        open_dimensions: {
          action_selection: true,
          dialogue_realization: true,
          pacing: true,
          nonverbal_behavior: true,
          emotional_expression: true,
        },
      },
      provenance: {},
    }),

    generate: async (payload) => {
      generatorCalls += 1;
      assert.equal('provenance' in payload, false);
      assert.equal('rawCanon' in payload, false);

      if (generatorCalls === 1) {
        return {
          status: 'NEED_CONTEXT',
          missing: [
            {
              type: 'epistemic_state',
              subject: 'A',
              question: 'Does A know X?',
            },
          ],
        };
      }

      return {
        status: 'DRAFT',
        draft: 'final draft',
      };
    },

    validate: async () => [],

    patch: async () => {
      throw new Error('patch should not run without violations');
    },
  };

  const result = await runFiction(
    {
      system: 'fiction',
      request: 'write',
      sceneState: {},
      semanticIds: ['BASE'],
    },
    adapters
  );

  assert.equal(result.status, 'OUTPUT');
  if (result.status !== 'OUTPUT') return;

  assert.equal(result.output, 'final draft');
  assert.equal(generatorCalls, 2);
  assert.equal(result.trace.generator.call_count, 2);
  assert.equal(result.trace.generator.need_context.length, 1);
  assert.deepEqual(
    result.trace.retrieval.map((item) => item.semantic_id).sort(),
    ['BASE', 'EXTRA.KNOWLEDGE'].sort()
  );
});
