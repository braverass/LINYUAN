import test from 'node:test';
import assert from 'node:assert/strict';

import type { ExplainModelClients } from '../explain';
import { publicExplainOutput, runProductionExplain } from '../explain';
import type { RuntimeModelClients } from '../adapters/model-backed';
import type { ModelClient, ModelRequest, ModelResponse } from '../model/types';
import { runProductionFiction } from '../production-fiction';

function client(
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
        latencyMs: 1,
        text: handler(request),
      };
    },
  };
}

test('EXPLAIN defaults to answer-only output and does not return raw evidence', async () => {
  const explainClient = client((request) => {
    assert.equal(request.stage, 'explain');
    assert.equal(request.prompt.includes('零渊'), true);
    return JSON.stringify({ answer: '直接回答用户的问题。' });
  });
  const clients: ExplainModelClients = {
    retrievalPlanner: explainClient,
    explainer: explainClient,
  };

  const run = await runProductionExplain(
    {
      request: '解释零渊的基本设定',
      semanticIds: ['AUTHOR.PERSONALITY'],
    },
    clients
  );

  assert.equal(run.answer, '直接回答用户的问题。');
  assert.equal('evidence_summary' in run, false);
  assert.equal(JSON.stringify(run).includes('零渊真实人格'), false);
});

test('EXPLAIN evidence mode exposes only the explicit user-facing evidence summary', async () => {
  const explainClient = client(() =>
    JSON.stringify({
      answer: '结论。',
      evidence_summary: '依据 AUTHOR.PERSONALITY 中的作者层设定。',
    })
  );
  const clients: ExplainModelClients = {
    retrievalPlanner: explainClient,
    explainer: explainClient,
  };

  const run = await runProductionExplain(
    {
      request: '给出结论和依据',
      semanticIds: ['AUTHOR.PERSONALITY'],
      includeEvidence: true,
    },
    clients
  );

  assert.equal(run.answer, '结论。');
  assert.equal(
    run.evidence_summary,
    '依据 AUTHOR.PERSONALITY 中的作者层设定。'
  );
});

test('EXPLAIN default output rejects semantic-id/process leakage', async () => {
  const explainClient = client(() =>
    JSON.stringify({
      answer: '我读取了 AUTHOR.PERSONALITY 后得到这个结论。',
    })
  );
  const clients: ExplainModelClients = {
    retrievalPlanner: explainClient,
    explainer: explainClient,
  };

  await assert.rejects(
    () =>
      runProductionExplain(
        {
          request: '解释设定',
          semanticIds: ['AUTHOR.PERSONALITY'],
        },
        clients
      ),
    /exposes internal (?:retrieval|source) metadata/
  );
});

test('EXPLAIN planner selects Canon without exposing planner state', async () => {
  const stages: string[] = [];
  const explainClient = client((request) => {
    stages.push(request.stage);
    if (request.stage === 'retrieval_planner') {
      return JSON.stringify({ semantic_ids: ['AUTHOR.PERSONALITY'] });
    }
    if (request.stage === 'explain') {
      return JSON.stringify({ answer: '规划后直接回答。' });
    }
    throw new Error('unexpected stage ' + request.stage);
  });

  const run = await runProductionExplain(
    { request: '解释人物' },
    {
      retrievalPlanner: explainClient,
      explainer: explainClient,
    }
  );

  assert.deepEqual(stages, ['retrieval_planner', 'explain']);
  assert.deepEqual(run.semantic_ids, ['AUTHOR.PERSONALITY']);
  assert.equal(run.answer, '规划后直接回答。');
});

test('EXPLAIN context is not reused as FICTION model history', async () => {
  const sentinel = 'EXPLAIN_ONLY_SENTINEL_9182';
  const explainClient = client(() =>
    JSON.stringify({ answer: '解释完成。' })
  );

  const explainRun = await runProductionExplain(
    {
      request: '解释人物：' + sentinel,
      semanticIds: ['AUTHOR.PERSONALITY'],
    },
    {
      retrievalPlanner: explainClient,
      explainer: explainClient,
    }
  );
  assert.equal(JSON.stringify(explainRun).includes(sentinel), false);

  const observed: ModelRequest[] = [];
  const fictionClient = client((request) => {
    observed.push(structuredClone(request));
    if (request.stage === 'compiler') {
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
    if (request.stage === 'generator') {
      return JSON.stringify({ status: 'DRAFT', draft: '正文。' });
    }
    if (request.stage === 'validator') {
      return JSON.stringify({ violations: [] });
    }
    throw new Error('unexpected stage ' + request.stage);
  });
  const fictionClients: RuntimeModelClients = {
    retrievalPlanner: fictionClient,
    compiler: fictionClient,
    generator: fictionClient,
    validator: fictionClient,
    patcher: fictionClient,
  };

  await runProductionFiction(
    {
      request: '写一个短场景',
      semanticIds: ['AUTHOR.PERSONALITY'],
    },
    fictionClients
  );

  assert.equal(
    JSON.stringify(observed.filter((request) => request.stage === 'generator'))
      .includes(sentinel),
    false
  );
});


test('EXPLAIN public output strips semantic IDs and call metadata, including JSON-facing output', async () => {
  const explainClient = client(() =>
    JSON.stringify({ answer: '只给结论。' })
  );
  const run = await runProductionExplain(
    {
      request: '解释人物',
      semanticIds: ['AUTHOR.PERSONALITY'],
    },
    {
      retrievalPlanner: explainClient,
      explainer: explainClient,
    }
  );

  const output = publicExplainOutput(run);
  const serialized = JSON.stringify(output);
  assert.deepEqual(output, { answer: '只给结论。' });
  assert.equal(serialized.includes('AUTHOR.PERSONALITY'), false);
  assert.equal(serialized.includes('request_hash'), false);
  assert.equal(serialized.includes('response_hash'), false);
});

test('EXPLAIN default output rejects selected physical source filenames', async () => {
  const explainClient = client(() =>
    JSON.stringify({
      answer: '依据 00B-AUTHOR-CANON-零渊真实人格.md 可以得出结论。',
    })
  );

  await assert.rejects(
    () =>
      runProductionExplain(
        {
          request: '解释人物',
          semanticIds: ['AUTHOR.PERSONALITY'],
        },
        {
          retrievalPlanner: explainClient,
          explainer: explainClient,
        }
      ),
    /internal source metadata/
  );
});

test('EXPLAIN evidence mode may name a source but may not narrate hidden retrieval process', async () => {
  const explainClient = client(() =>
    JSON.stringify({
      answer: '结论。',
      evidence_summary: 'Retrieval Planner 先选择了 AUTHOR.PERSONALITY。',
    })
  );

  await assert.rejects(
    () =>
      runProductionExplain(
        {
          request: '给出依据',
          semanticIds: ['AUTHOR.PERSONALITY'],
          includeEvidence: true,
        },
        {
          retrievalPlanner: explainClient,
          explainer: explainClient,
        }
      ),
    /hidden retrieval\/process metadata/
  );
});
