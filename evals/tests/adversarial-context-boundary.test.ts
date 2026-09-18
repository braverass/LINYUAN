import test from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeModelClients } from '../../runtime/adapters/model-backed';
import type { ModelClient, ModelRequest, ModelResponse } from '../../runtime/model/types';
import { executeRealEvalCase } from '../real-executor';
import type { EvalCase } from '../types';

test('adversarial eval isolation: candidate never sees gold and retrieval evidence is not backfilled', async () => {
  const candidateRequests: ModelRequest[] = [];
  const judgeRequests: ModelRequest[] = [];

  const candidateClient: ModelClient = {
    provider: 'openai',
    model: 'candidate-fixture',
    defaults: {},
    async complete(request): Promise<ModelResponse> {
      candidateRequests.push(structuredClone(request));
      if (request.stage === 'compiler') {
        return {
          provider: 'openai',
          model: 'candidate-fixture',
          latencyMs: 1,
          text: JSON.stringify({
            status: 'READY',
            activeContext: {
              version: '0.5',
              facts: [{ id: 'F1', type: 'fact', proposition: 'synthetic fact' }],
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
            provenance: { F1: { source_id: 'EVAL.SYNTHETIC' } },
          }),
        };
      }
      if (request.stage === 'generator') {
        return {
          provider: 'openai',
          model: 'candidate-fixture',
          latencyMs: 1,
          text: JSON.stringify({ status: 'DRAFT', draft: 'candidate output' }),
        };
      }
      if (request.stage === 'validator') {
        return {
          provider: 'openai',
          model: 'candidate-fixture',
          latencyMs: 1,
          text: JSON.stringify({ violations: [] }),
        };
      }
      throw new Error('unexpected candidate stage ' + request.stage);
    },
  };

  const judgeClient: ModelClient = {
    provider: 'openai',
    model: 'judge-fixture',
    defaults: {},
    async complete(request): Promise<ModelResponse> {
      judgeRequests.push(structuredClone(request));
      return {
        provider: 'openai',
        model: 'judge-fixture',
        latencyMs: 1,
        text: JSON.stringify({
          satisfied_requirement_ids: [],
          triggered_forbidden_inference_ids: [],
          triggered_overconstraint_ids: [],
          predicted_need_context_ids: [],
          behavior_signatures: [],
          validator_positive_ids: [],
        }),
      };
    },
  };

  const clients: RuntimeModelClients = {
    retrievalPlanner: candidateClient,
    compiler: candidateClient,
    generator: candidateClient,
    validator: candidateClient,
    patcher: candidateClient,
  };

  const testCase: EvalCase = {
    version: '0.6',
    id: 'GOLD_SENTINEL_CASE_7A91',
    category: 'adversarial',
    description: 'GOLD_SENTINEL_DESCRIPTION_7A91',
    request: 'candidate-visible request',
    scene_state: {},
    required_sources: ['GOLD.SOURCE.SENTINEL.7A91'],
    requirements: [
      {
        id: 'GOLD_REQUIREMENT_SENTINEL_7A91',
        kind: 'fact',
        description: 'gold-only requirement',
      },
    ],
    forbidden_inferences: [],
    forbidden_overconstraints: [],
    expected_need_context: [],
    behavioral_diversity: {
      sample_count: 0,
      minimum_unique_signatures: 0,
    },
    validator: {
      gold_violations: [],
      gold_non_violations: [],
    },
    metamorphic_group: null,
    synthetic_canon: 'candidate-visible synthetic Canon',
  };

  const run = await executeRealEvalCase(testCase, clients, judgeClient);
  const candidateWire = JSON.stringify(candidateRequests);
  const judgeWire = JSON.stringify(judgeRequests);

  assert.equal(candidateWire.includes('GOLD_SENTINEL_CASE_7A91'), false);
  assert.equal(candidateWire.includes('GOLD_SENTINEL_DESCRIPTION_7A91'), false);
  assert.equal(candidateWire.includes('GOLD_REQUIREMENT_SENTINEL_7A91'), false);
  assert.equal(candidateWire.includes('GOLD.SOURCE.SENTINEL.7A91'), false);

  assert.equal(judgeWire.includes('GOLD_REQUIREMENT_SENTINEL_7A91'), true);
  assert.deepEqual(run.observation.retrieved_sources, ['EVAL.SYNTHETIC']);
  assert.equal(
    run.observation.retrieved_sources.includes('GOLD.SOURCE.SENTINEL.7A91'),
    false
  );
});
