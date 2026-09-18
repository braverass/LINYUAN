import test from 'node:test';
import assert from 'node:assert/strict';

import { createModelBackedRuntime, type RuntimeModelClients } from '../adapters/model-backed';
import { runFiction } from '../orchestrator';
import type { ModelClient, ModelRequest, ModelResponse } from '../model/types';

test('adversarial isolation: Generator cannot see raw Canon and Patcher cannot see Canon evidence', async () => {
  const captured = new Map<string, ModelRequest[]>();
  const record = (request: ModelRequest) => {
    const list = captured.get(request.stage) ?? [];
    list.push(structuredClone(request));
    captured.set(request.stage, list);
  };

  const client: ModelClient = {
    provider: 'openai',
    model: 'fixture-model',
    defaults: {},
    async complete(request): Promise<ModelResponse> {
      record(request);
      if (request.stage === 'compiler') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          text: JSON.stringify({
            status: 'READY',
            activeContext: {
              version: '0.5',
              facts: [{ id: 'F1', type: 'fact', proposition: 'compiled semantic fact' }],
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
            provenance: { F1: { source_id: 'TEST.RAW' } },
          }),
        };
      }
      if (request.stage === 'generator') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          text: JSON.stringify({ status: 'DRAFT', draft: '错误句。' }),
        };
      }
      if (request.stage === 'validator') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          text: JSON.stringify({
            violations: [
              {
                id: 'V1',
                severity: 'hard',
                location: { paragraph: 1, sentence_start: 1, sentence_end: 1 },
                actual: { semantic_claim: 'wrong' },
                required_state: { rule: 'compiled semantic correction' },
                patch_contract: {
                  allowed_scope: { paragraph: 1, sentences: [1, 1] },
                  preserve: [],
                  required_change: ['correct the sentence'],
                },
                evidence_refs: ['RAW_CANON_SENTINEL_93C4'],
              },
            ],
          }),
        };
      }
      if (request.stage === 'patcher') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          text: JSON.stringify({ replacement: '修复句。' }),
        };
      }
      throw new Error('unexpected stage ' + request.stage);
    },
  };

  const clients: RuntimeModelClients = {
    retrievalPlanner: client,
    compiler: client,
    generator: client,
    validator: client,
    patcher: client,
  };
  const runtime = await createModelBackedRuntime(clients, { repoRoot: process.cwd() });
  runtime.adapters.retrieve = async () => [
    {
      semanticId: 'TEST.RAW',
      content: 'RAW_CANON_SENTINEL_93C4',
    },
  ];

  const result = await runFiction(
    {
      system: 'fixture system',
      request: 'fixture request',
      sceneState: {},
      semanticIds: ['TEST.RAW'],
    },
    runtime.adapters
  );
  assert.equal(result.status, 'OUTPUT');

  const compilerWire = JSON.stringify(captured.get('compiler'));
  const generatorWire = JSON.stringify(captured.get('generator'));
  const validatorWire = JSON.stringify(captured.get('validator'));
  const patcherWire = JSON.stringify(captured.get('patcher'));

  assert.equal(compilerWire.includes('RAW_CANON_SENTINEL_93C4'), true);
  assert.equal(validatorWire.includes('RAW_CANON_SENTINEL_93C4'), true);
  assert.equal(generatorWire.includes('RAW_CANON_SENTINEL_93C4'), false);
  assert.equal(generatorWire.includes('TEST.RAW'), false);
  assert.equal(patcherWire.includes('RAW_CANON_SENTINEL_93C4'), false);
  assert.equal(patcherWire.includes('evidence_refs'), false);
});
