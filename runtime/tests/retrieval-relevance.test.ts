import test from 'node:test';
import assert from 'node:assert/strict';

import { createModelBackedRuntime } from '../adapters/model-backed';
import type {
  ModelClient,
  ModelRequest,
  ModelResponse,
} from '../model/types';

function fixtureClient(
  handler: (request: ModelRequest) => string
): ModelClient {
  return {
    provider: 'openai',
    model: 'fixture-model',
    defaults: {},
    async complete(request): Promise<ModelResponse> {
      return {
        provider: 'openai',
        model: 'fixture-model',
        text: handler(request),
        latencyMs: 1,
      };
    },
  };
}

test('retrieval planner receives scene-relevance routing hints and compiler filters macro lore', async () => {
  let compilerSystem = '';

  const client = fixtureClient((request) => {
    if (request.stage === 'retrieval_planner') {
      assert.match(
        request.system ?? '',
        /materially change the requested scene/
      );
      assert.match(
        request.system ?? '',
        /WORLD\.ALL is a fallback/
      );

      const payload = JSON.parse(request.prompt ?? '') as {
        available_sources: Array<{
          semantic_id: string;
          routing_hint: string;
        }>;
      };
      const inventory = new Map(
        payload.available_sources.map((source) => [
          source.semantic_id,
          source.routing_hint,
        ])
      );

      assert.match(
        inventory.get('WORLD.CULTURE') ?? '',
        /Everyday lived life: housing, commuting, neighborhoods/
      );
      assert.match(
        inventory.get('WORLD.PEOPLE') ?? '',
        /First-choice source for child\/family\/generation scenes/
      );
      assert.match(
        inventory.get('WORLD.ALL') ?? '',
        /Fallback only/
      );

      return JSON.stringify({
        semantic_ids: ['WORLD.CULTURE', 'WORLD.PEOPLE'],
      });
    }

    if (request.stage === 'compiler') {
      compilerSystem = request.system ?? '';
      return JSON.stringify({
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
      });
    }

    throw new Error('Unexpected stage: ' + request.stage);
  });

  const runtime = await createModelBackedRuntime(
    {
      retrievalPlanner: client,
      compiler: client,
      generator: client,
      validator: client,
      patcher: client,
    },
    { repoRoot: process.cwd() }
  );

  const ids = await runtime.adapters.planInitialRetrieval!(
    '写一个 Alpha 世界幼儿园孩子放学回家的普通日常场景',
    { location: 'kindergarten', present_characters: ['child', 'parent'] }
  );

  assert.deepEqual(ids, ['WORLD.CULTURE', 'WORLD.PEOPLE']);

  await runtime.adapters.compile({
    request: '写一个 Alpha 世界幼儿园孩子放学回家的普通日常场景',
    sceneState: { location: 'kindergarten' },
    canonFragments: [
      {
        semanticId: 'WORLD.CULTURE',
        content: 'ordinary daily-life facts',
      },
      {
        semanticId: 'WORLD.SKELETON',
        content: 'macro interstellar facts that do not affect this scene',
      },
    ],
  });

  assert.match(
    compilerSystem,
    /Omit true but scene-irrelevant macro facts/
  );
  assert.match(
    compilerSystem,
    /Do not turn background worldbuilding into exposition obligations/
  );
});
