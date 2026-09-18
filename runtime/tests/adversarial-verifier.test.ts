import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeModelClients } from '../adapters/model-backed';
import { runLiveFictionBundle } from '../live-fiction';
import { createModelClient } from '../model/providers';
import type { ModelClient, ModelRequest, ModelResponse } from '../model/types';
import { verifyLiveFictionBundle } from '../verify-live-bundle';

function fixtureClient(): ModelClient {
  return {
    provider: 'openai',
    model: 'fixture-model',
    defaults: {},
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (request.stage === 'compiler') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          requestId: 'req-compiler',
          responseId: 'resp-compiler',
          text: JSON.stringify({
            status: 'READY',
            activeContext: {
              version: '0.5',
              facts: [{ id: 'F1', type: 'fact', proposition: 'Fixture fact' }],
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
            provenance: { F1: { source_id: 'AUTHOR.PERSONALITY' } },
          }),
        };
      }
      if (request.stage === 'generator') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          requestId: 'req-generator',
          responseId: 'resp-generator',
          text: JSON.stringify({ status: 'DRAFT', draft: 'fixture output' }),
        };
      }
      if (request.stage === 'validator') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          requestId: 'req-validator',
          responseId: 'resp-validator',
          text: JSON.stringify({ violations: [] }),
        };
      }
      throw new Error('unexpected stage ' + request.stage);
    },
  };
}

function clients(): RuntimeModelClients {
  const client = fixtureClient();
  return {
    retrievalPlanner: client,
    compiler: client,
    generator: client,
    validator: client,
    patcher: client,
  };
}

async function validBundle(runDir: string): Promise<void> {
  await runLiveFictionBundle(
    {
      request: 'fixture request',
      sceneState: {},
      semanticIds: ['AUTHOR.PERSONALITY'],
      system: 'fixture system',
      repoRoot: process.cwd(),
    },
    { runDir, clients: clients() }
  );
  const report = await verifyLiveFictionBundle(runDir);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeTrackedJson(runDir: string, name: string, value: unknown, manifest: any) {
  const text = JSON.stringify(value, null, 2) + '\n';
  await writeFile(path.join(runDir, name), text, 'utf8');
  manifest.artifacts[name] = {
    file: name,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

test('adversarial: verifier must not accept OUTPUT after stage_models is removed', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-stage-models-'));
  try {
    await validBundle(runDir);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = await readJson(manifestPath);
    delete manifest.stage_models;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'verifier accepted a bundle with no stage_models');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial: verifier must not accept OUTPUT with all provider calls deleted', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-empty-calls-'));
  try {
    await validBundle(runDir);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = await readJson(manifestPath);
    manifest.calls = [];
    await writeTrackedJson(runDir, 'calls.json', [], manifest);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'verifier accepted OUTPUT with zero recorded calls');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial: verifier validates bundle identity and commit provenance', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-provenance-'));
  try {
    await validBundle(runDir);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = await readJson(manifestPath);
    manifest.bundle_id = 7;
    manifest.commit_sha = 'UNKNOWN';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'verifier accepted malformed bundle_id / UNKNOWN commit');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial: run directory claim is atomic under concurrent live runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-race-root-'));
  const runDir = path.join(root, 'run');
  try {
    const input = {
      request: 'fixture request',
      sceneState: {},
      semanticIds: ['AUTHOR.PERSONALITY'],
      system: 'fixture system',
      repoRoot: process.cwd(),
    };

    const results = await Promise.allSettled([
      runLiveFictionBundle(input, { runDir, clients: clients() }),
      runLiveFictionBundle(input, { runDir, clients: clients() }),
    ]);

    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    assert.equal(fulfilled.length, 1, JSON.stringify(results.map((r) => r.status)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adversarial: Anthropic Messages API uses x-api-key authentication', async () => {
  const originalFetch = globalThis.fetch;
  let capturedXApiKey: string | null = null;
  let capturedAuthorization: string | null = null;

  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    capturedXApiKey = headers.get('x-api-key');
    capturedAuthorization = headers.get('authorization');
    return new Response(
      JSON.stringify({
        id: 'msg_fixture',
        model: 'claude-fixture',
        content: [{ type: 'text', text: '{}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'request-id': 'req_fixture' },
      }
    );
  };

  try {
    const client = createModelClient({
      provider: 'anthropic',
      model: 'claude-fixture',
      apiKey: 'anthropic-secret',
      baseUrl: 'https://anthropic.invalid',
    });
    await client.complete({
      stage: 'compiler',
      prompt: '{}',
      responseFormat: 'json',
    });

    assert.equal(capturedXApiKey, 'anthropic-secret');
    assert.equal(capturedAuthorization, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('compatibility: old 0.9 call records without response_id remain valid', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-compat-'));
  try {
    await validBundle(runDir);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = await readJson(manifestPath);
    const calls = await readJson(path.join(runDir, 'calls.json'));
    for (const call of calls) delete call.response_id;
    for (const call of manifest.calls) delete call.response_id;
    await writeTrackedJson(runDir, 'calls.json', calls, manifest);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
