import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileWithAdapter,
  type CompilerAdapter,
} from '../compiler';
import { buildGeneratorPayload } from '../generator';
import {
  runFiction,
  type RuntimeAdapters,
} from '../orchestrator';
import { envelope } from '../types';

test('runtime plans initial retrieval when semanticIds are not supplied', async () => {
  let initialPlannerCalls = 0;
  let retrieved: string[] = [];

  const adapters: RuntimeAdapters = {
    planInitialRetrieval: async () => {
      initialPlannerCalls += 1;
      return ['AUTHOR.PERSONALITY'];
    },
    retrieve: async (ids) => {
      retrieved = [...ids];
      return ids.map((semanticId) => ({
        semanticId,
        content: 'fixture',
      }));
    },
    planAdditionalRetrieval: async () => [],
    compile: async () => ({
      status: 'READY',
      activeContext: {
        version: '0.5',
        facts: [],
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
    generate: async () => ({
      status: 'DRAFT',
      draft: 'draft',
    }),
    validate: async () => [],
    patch: async () => ({ replacement: '' }),
  };

  const result = await runFiction(
    {
      system: 'fiction',
      request: 'write',
      sceneState: {},
    },
    adapters
  );

  assert.equal(result.status, 'OUTPUT');
  assert.equal(initialPlannerCalls, 1);
  assert.deepEqual(retrieved, ['AUTHOR.PERSONALITY']);
});

test('explicit semanticIds remain supported for deterministic callers', async () => {
  let initialPlannerCalls = 0;
  let retrieved: string[] = [];

  const adapters: RuntimeAdapters = {
    planInitialRetrieval: async () => {
      initialPlannerCalls += 1;
      return ['SHOULD.NOT.BE.USED'];
    },
    retrieve: async (ids) => {
      retrieved = [...ids];
      return ids.map((semanticId) => ({
        semanticId,
        content: 'fixture',
      }));
    },
    planAdditionalRetrieval: async () => [],
    compile: async () => ({
      status: 'READY',
      activeContext: {
        version: '0.5',
        facts: [],
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
    generate: async () => ({ status: 'DRAFT', draft: 'draft' }),
    validate: async () => [],
    patch: async () => ({ replacement: '' }),
  };

  await runFiction(
    {
      system: 'fiction',
      request: 'write',
      sceneState: {},
      semanticIds: ['AUTHOR.ABILITY'],
    },
    adapters
  );

  assert.equal(initialPlannerCalls, 0);
  assert.deepEqual(retrieved, ['AUTHOR.ABILITY']);
});

test('Compiler canonicalizes semantic arrays before Generator payload construction', async () => {
  const adapter: CompilerAdapter = async () => ({
    status: 'READY',
    activeContext: {
      version: '0.5',
      facts: [
        { id: 'B', type: 'fact', proposition: 'second' },
        { id: 'A', type: 'fact', proposition: 'first' },
      ],
      constraints: [
        {
          id: 'Z',
          type: 'constraint',
          proposition: 'z',
          severity: 'hard',
        },
        {
          id: 'C',
          type: 'constraint',
          proposition: 'c',
          severity: 'soft',
        },
      ],
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
  });

  const compiled = await compileWithAdapter(adapter, {
    request: 'write',
    sceneState: {},
    canonFragments: [],
  });
  assert.equal(compiled.status, 'READY');
  if (compiled.status !== 'READY') return;

  assert.deepEqual(
    compiled.activeContext.value.facts.map((item) => item.id),
    ['A', 'B']
  );
  assert.deepEqual(
    compiled.activeContext.value.constraints.map((item) => item.id),
    ['C', 'Z']
  );

  const payload = buildGeneratorPayload({
    system: envelope('SYSTEM_FICTION', 'fiction'),
    request: envelope('USER_REQUEST', 'write'),
    sceneState: envelope('SCENE_STATE', {}),
    activeContext: compiled.activeContext,
  });

  assert.deepEqual(
    payload.activeContext.facts.map((item) => item.id),
    ['A', 'B']
  );
});
