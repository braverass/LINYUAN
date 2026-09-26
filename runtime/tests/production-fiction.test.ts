import test from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeModelClients } from '../adapters/model-backed';
import type {
  ModelClient,
  ModelRequest,
  ModelResponse,
} from '../model/types';
import { runProductionFiction } from '../production-fiction';

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

test('production fiction entry runs retrieval through local patching', async () => {
  const handler = (request: ModelRequest): string => {
    if (request.stage === 'retrieval_planner') {
      return JSON.stringify({ semantic_ids: ['AUTHOR.PERSONALITY'] });
    }
    if (request.stage === 'compiler') {
      return JSON.stringify({
        status: 'READY',
        activeContext: {
          version: '0.5',
          facts: [
            {
              id: 'F1',
              type: 'fact',
              proposition: 'Fixture fact',
            },
          ],
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
        provenance: {
          F1: { source_id: 'AUTHOR.PERSONALITY', scene_relevance: 'material', scene_impact: 'The fact constrains this test scene.' },
        },
      });
    }
    if (request.stage === 'generator') {
      return JSON.stringify({
        status: 'DRAFT',
        draft: '第一句。第二句。',
      });
    }
    if (request.stage === 'validator') {
      return JSON.stringify({
        violations: [
          {
            id: 'V1',
            severity: 'hard',
            location: {
              paragraph: 1,
              sentence_start: 2,
              sentence_end: 2,
            },
            actual: { semantic_claim: 'fixture mismatch', draft_quote: '第二句。' },
            required_state: { corrected: true },
            patch_contract: {
              allowed_scope: {
                paragraph: 1,
                sentences: [2, 2],
              },
              preserve: ['第一句。'],
              required_change: ['replace second sentence'],
            },
            evidence_refs: ['AUTHOR.PERSONALITY'],
          },
        ],
      });
    }
    if (request.stage === 'patcher') {
      return JSON.stringify({ replacement: '第二句修正。' });
    }
    throw new Error('Unexpected stage: ' + request.stage);
  };

  const client = fixtureClient(handler);
  const clients: RuntimeModelClients = {
    retrievalPlanner: client,
    compiler: client,
    generator: client,
    validator: client,
    patcher: client,
  };

  const run = await runProductionFiction(
    {
      request: '写一个测试场景',
      sceneState: { location: 'fixture' },
      system: 'fixture fiction system',
      repoRoot: process.cwd(),
    },
    clients
  );

  assert.equal(run.result.status, 'OUTPUT');
  if (run.result.status !== 'OUTPUT') return;

  assert.equal(run.result.output, '第一句。第二句修正。');
  assert.deepEqual(
    run.result.trace.retrieval.map((item) => item.semantic_id),
    ['AUTHOR.PERSONALITY']
  );
  assert.deepEqual(
    run.calls.map((call) => call.stage),
    [
      'retrieval_planner',
      'compiler',
      'generator',
      'validator',
      'patcher',
    ]
  );
  assert.deepEqual(run.result.trace.patcher.scopes, [
    { paragraph: 1, sentences: [2, 2] },
  ]);
});
