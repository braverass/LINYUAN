import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeModelClients } from '../adapters/model-backed';
import {
  LiveFictionBundleError,
  runLiveFictionBundle,
  sanitizeLiveFailureMessage,
} from '../live-fiction';
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

function compilerReady(): string {
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
      F1: { source_id: 'AUTHOR.PERSONALITY' },
    },
  });
}

test('live fiction writes an auditable evidence bundle', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-live-'));
  try {
    const client = fixtureClient((request) => {
      if (request.stage === 'compiler') return compilerReady();
      if (request.stage === 'generator') {
        return JSON.stringify({
          status: 'DRAFT',
          draft: '测试正文。',
        });
      }
      if (request.stage === 'validator') {
        return JSON.stringify({ violations: [] });
      }
      throw new Error('Unexpected stage: ' + request.stage);
    });
    const clients: RuntimeModelClients = {
      retrievalPlanner: client,
      compiler: client,
      generator: client,
      validator: client,
      patcher: client,
    };

    const run = await runLiveFictionBundle(
      {
        request: '写一个测试场景',
        sceneState: { location: 'fixture' },
        semanticIds: ['AUTHOR.PERSONALITY'],
        system: 'fixture fiction system',
        repoRoot: process.cwd(),
      },
      { runDir, clients }
    );

    assert.equal(run.result.status, 'OUTPUT');
    assert.equal(run.manifest.version, '0.9');
    assert.equal(run.manifest.status, 'OUTPUT');
    assert.equal(run.manifest.runtime_contract.system_hash?.length, 64);
    assert.deepEqual(
      run.manifest.calls.map((call) => call.stage),
      ['compiler', 'generator', 'validator']
    );
    assert.deepEqual(
      run.manifest.retrieval.map((item) => item.semantic_id),
      ['AUTHOR.PERSONALITY']
    );

    const output = await readFile(path.join(runDir, 'output.md'), 'utf8');
    assert.equal(output, '测试正文。\n');

    const manifest = JSON.parse(
      await readFile(path.join(runDir, 'manifest.json'), 'utf8')
    ) as { artifacts: Record<string, { sha256: string }> };
    assert.equal(manifest.artifacts['input.json']?.sha256.length, 64);
    assert.equal(manifest.artifacts['trace.json']?.sha256.length, 64);
    assert.equal(manifest.artifacts['calls.json']?.sha256.length, 64);
    assert.equal(manifest.artifacts['output.md']?.sha256.length, 64);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('live fiction preserves failure evidence without recording secrets', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-live-fail-'));
  const secret = 'fixture-super-secret-key';
  const previous = process.env.LINYUAN_TEST_API_KEY;
  process.env.LINYUAN_TEST_API_KEY = secret;

  try {
    const client = fixtureClient((request) => {
      if (request.stage === 'compiler') return compilerReady();
      if (request.stage === 'generator') {
        throw new Error('provider failure contained ' + secret);
      }
      throw new Error('Unexpected stage: ' + request.stage);
    });
    const clients: RuntimeModelClients = {
      retrievalPlanner: client,
      compiler: client,
      generator: client,
      validator: client,
      patcher: client,
    };

    await assert.rejects(
      () =>
        runLiveFictionBundle(
          {
            request: '写一个测试场景',
            semanticIds: ['AUTHOR.PERSONALITY'],
            system: 'fixture fiction system',
            repoRoot: process.cwd(),
          },
          { runDir, clients }
        ),
      (error: unknown) => error instanceof LiveFictionBundleError
    );

    const failureText = await readFile(
      path.join(runDir, 'failure.json'),
      'utf8'
    );
    assert.equal(failureText.includes(secret), false);
    assert.equal(failureText.includes('[REDACTED]'), true);

    const manifestText = await readFile(
      path.join(runDir, 'manifest.json'),
      'utf8'
    );
    assert.equal(manifestText.includes(secret), false);
    const manifest = JSON.parse(manifestText) as {
      status: string;
      calls: Array<{ stage: string }>;
    };
    assert.equal(manifest.status, 'ERROR');
    assert.deepEqual(
      manifest.calls.map((call) => call.stage),
      ['compiler']
    );
  } finally {
    if (previous === undefined) delete process.env.LINYUAN_TEST_API_KEY;
    else process.env.LINYUAN_TEST_API_KEY = previous;
    await rm(runDir, { recursive: true, force: true });
  }
});

test('failure sanitizer removes configured secret values', () => {
  const secret = 'fixture-direct-secret';
  const previous = process.env.LINYUAN_MODEL_API_KEY;
  process.env.LINYUAN_MODEL_API_KEY = secret;
  try {
    assert.equal(
      sanitizeLiveFailureMessage('bad credential ' + secret),
      'bad credential [REDACTED]'
    );
  } finally {
    if (previous === undefined) delete process.env.LINYUAN_MODEL_API_KEY;
    else process.env.LINYUAN_MODEL_API_KEY = previous;
  }
});
