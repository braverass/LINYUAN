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

type JsonRecord = Record<string, unknown>;

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
              facts: [{ id: 'F1', type: 'fact', proposition: 'fixture fact' }],
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

async function makeBundle(runDir: string): Promise<void> {
  await runLiveFictionBundle(
    {
      request: 'fixture request',
      sceneState: { location: 'fixture' },
      semanticIds: ['AUTHOR.PERSONALITY'],
      maxContextRounds: 3,
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

async function saveManifest(runDir: string, manifest: any): Promise<void> {
  await writeFile(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
}

async function rewriteTrackedJson(
  runDir: string,
  name: string,
  value: unknown,
  manifest: any
): Promise<void> {
  const text = JSON.stringify(value, null, 2) + '\n';
  await writeFile(path.join(runDir, name), text, 'utf8');
  manifest.artifacts[name] = {
    file: name,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

test('independent recheck control: mock-backed bundle verifies but is not real-provider proof', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-control-'));
  try {
    await makeBundle(runDir);
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent recheck: OUTPUT with zero calls is rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-zero-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    manifest.calls = [];
    await rewriteTrackedJson(runDir, 'calls.json', [], manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'OUTPUT with calls=[] must fail');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent recheck: missing stage_models is rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-stage-models-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    manifest.stage_models = null;
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'stage_models=null must fail when calls exist');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent recheck: malformed call hashes are rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-call-hash-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    calls[0].request_hash = 'not-a-sha256';
    calls[0].response_hash = 'also-not-a-sha256';
    manifest.calls = JSON.parse(JSON.stringify(calls));
    await rewriteTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'malformed request/response hashes must fail');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent recheck: whitespace-only request_id is rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-request-id-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    calls[0].request_id = '   ';
    manifest.calls = JSON.parse(JSON.stringify(calls));
    await rewriteTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'whitespace request_id must fail');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent recheck: legacy 0.9 calls without response_id remain accepted', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-legacy-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    for (const item of calls) delete item.response_id;
    for (const item of manifest.calls) delete item.response_id;
    await rewriteTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent provider mock: request formats, ids, model ids and usage are preserved', async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{
    url: string;
    headers: Record<string, string>;
    body: JsonRecord;
  }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as JsonRecord;
    seen.push({ url, headers, body });

    if (url.includes('openai.invalid')) {
      return new Response(
        JSON.stringify({
          id: 'resp-openai',
          model: 'openai-returned-model',
          output_text: '{"ok":true}',
          usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-openai',
          },
        }
      );
    }
    if (url.includes('gemini.invalid')) {
      return new Response(
        JSON.stringify({
          responseId: 'resp-gemini',
          modelVersion: 'gemini-returned-model',
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: {
            promptTokenCount: 13,
            candidatesTokenCount: 9,
            totalTokenCount: 22,
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-gemini',
          },
        }
      );
    }
    if (url.includes('anthropic.invalid')) {
      return new Response(
        JSON.stringify({
          id: 'msg-anthropic',
          model: 'anthropic-returned-model',
          content: [{ type: 'text', text: '{"ok":true}' }],
          usage: { input_tokens: 17, output_tokens: 5 },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'request-id': 'req-anthropic',
          },
        }
      );
    }
    throw new Error('unexpected URL ' + url);
  };

  try {
    const openai = createModelClient({
      provider: 'openai',
      model: 'openai-configured-model',
      apiKey: 'openai-key',
      baseUrl: 'https://openai.invalid/v1',
    });
    const gemini = createModelClient({
      provider: 'gemini',
      model: 'gemini-configured-model',
      apiKey: 'gemini-key',
      baseUrl: 'https://gemini.invalid/v1beta',
      defaults: { seed: 42 },
    });
    const anthropic = createModelClient({
      provider: 'anthropic',
      model: 'anthropic-configured-model',
      apiKey: 'anthropic-key',
      baseUrl: 'https://anthropic.invalid',
    });

    const request: ModelRequest = {
      stage: 'compiler',
      system: 'system fixture',
      prompt: 'prompt fixture',
      responseFormat: 'json',
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 123,
    };

    const oa = await openai.complete(request);
    const ge = await gemini.complete(request);
    const an = await anthropic.complete(request);

    const openaiWire = seen[0];
    const geminiWire = seen[1];
    const anthropicWire = seen[2];
    assert.ok(openaiWire);
    assert.ok(geminiWire);
    assert.ok(anthropicWire);

    assert.equal(openaiWire.url, 'https://openai.invalid/v1/responses');
    assert.equal(openaiWire.headers.Authorization, 'Bearer openai-key');
    assert.equal(openaiWire.body.model, 'openai-configured-model');
    assert.deepEqual(openaiWire.body.text, { format: { type: 'json_object' } });

    assert.equal(
      geminiWire.url,
      'https://gemini.invalid/v1beta/models/gemini-configured-model:generateContent'
    );
    assert.equal(geminiWire.headers['x-goog-api-key'], 'gemini-key');
    const gc = geminiWire.body.generationConfig as JsonRecord;
    assert.equal(gc.responseMimeType, 'application/json');
    assert.equal(gc.seed, 42);

    assert.equal(anthropicWire.url, 'https://anthropic.invalid/v1/messages');
    assert.equal(anthropicWire.headers['x-api-key'], 'anthropic-key');
    assert.equal('Authorization' in anthropicWire.headers, false);
    assert.equal(anthropicWire.headers['anthropic-version'], '2023-06-01');

    assert.equal(oa.model, 'openai-returned-model');
    assert.equal(oa.requestId, 'req-openai');
    assert.equal(oa.responseId, 'resp-openai');
    assert.deepEqual(oa.usage, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });

    assert.equal(ge.model, 'gemini-returned-model');
    assert.equal(ge.requestId, 'req-gemini');
    assert.equal(ge.responseId, 'resp-gemini');
    assert.deepEqual(ge.usage, {
      inputTokens: 13,
      outputTokens: 9,
      totalTokens: 22,
    });

    assert.equal(an.model, 'anthropic-returned-model');
    assert.equal(an.requestId, 'req-anthropic');
    assert.equal(an.responseId, 'msg-anthropic');
    assert.deepEqual(an.usage, {
      inputTokens: 17,
      outputTokens: 5,
      totalTokens: 22,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('independent provider mock: HTTP error details redact API key and bearer tokens', async () => {
  const originalFetch = globalThis.fetch;
  const apiKey = 'direct-fixture-api-key';
  globalThis.fetch = async () =>
    new Response(
      'echo key=' + apiKey + ' Authorization: Bearer secondary.fixture-token',
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'x-request-id': 'req-error' },
      }
    );

  try {
    const client = createModelClient({
      provider: 'openai',
      model: 'fixture-model',
      apiKey,
      baseUrl: 'https://openai.invalid/v1',
    });

    await assert.rejects(
      () =>
        client.complete({
          stage: 'compiler',
          prompt: '{}',
          responseFormat: 'json',
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.includes(apiKey), false);
        assert.equal(message.includes('secondary.fixture-token'), false);
        assert.equal(message.includes('[REDACTED]'), true);
        assert.equal(message.includes('401 Unauthorized'), true);
        assert.equal(message.includes('req-error'), true);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('independent provider mock: malformed successful JSON response is rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{broken-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  try {
    const client = createModelClient({
      provider: 'openai',
      model: 'fixture-model',
      apiKey: 'fixture-key',
      baseUrl: 'https://openai.invalid/v1',
    });
    await assert.rejects(() =>
      client.complete({
        stage: 'compiler',
        prompt: '{}',
        responseFormat: 'json',
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('independent provider mock: unsupported seed is rejected for OpenAI and Anthropic', async () => {
  for (const provider of ['openai', 'anthropic'] as const) {
    const client = createModelClient({
      provider,
      model: 'fixture-model',
      apiKey: 'fixture-key',
      baseUrl:
        provider === 'openai'
          ? 'https://openai.invalid/v1'
          : 'https://anthropic.invalid',
      defaults: { seed: 42 },
    });
    await assert.rejects(
      () =>
        client.complete({
          stage: 'generator',
          prompt: '{}',
          responseFormat: 'json',
        }),
      /does not support seed/
    );
  }
});


function specializedClient(mode: 'NEED_CONTEXT' | 'CONFLICT' | 'ERROR'): ModelClient {
  return {
    provider: 'openai',
    model: 'fixture-model',
    defaults: {},
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (request.stage === 'retrieval_planner' && mode === 'NEED_CONTEXT') {
        return {
          provider: 'openai',
          model: 'fixture-model',
          latencyMs: 1,
          requestId: 'req-retrieval',
          responseId: 'resp-retrieval',
          text: JSON.stringify({ semantic_ids: [] }),
        };
      }
      if (request.stage === 'compiler') {
        if (mode === 'NEED_CONTEXT') {
          return {
            provider: 'openai',
            model: 'fixture-model',
            latencyMs: 1,
            requestId: 'req-compiler',
            responseId: 'resp-compiler',
            text: JSON.stringify({
              status: 'NEED_CONTEXT',
              missing: [{ type: 'fixture', question: 'need fixture context' }],
            }),
          };
        }
        if (mode === 'CONFLICT') {
          return {
            provider: 'openai',
            model: 'fixture-model',
            latencyMs: 1,
            requestId: 'req-compiler',
            responseId: 'resp-compiler',
            text: JSON.stringify({
              status: 'CONFLICT',
              conflict: 'fixture conflict',
            }),
          };
        }
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
        };
      }
      if (request.stage === 'generator' && mode === 'ERROR') {
        throw new Error('fixture provider failure');
      }
      throw new Error('unexpected stage ' + request.stage);
    },
  };
}

async function makeSpecialBundle(
  runDir: string,
  mode: 'NEED_CONTEXT' | 'CONFLICT' | 'ERROR'
): Promise<void> {
  const model = specializedClient(mode);
  const modelClients: RuntimeModelClients = {
    retrievalPlanner: model,
    compiler: model,
    generator: model,
    validator: model,
    patcher: model,
  };
  try {
    await runLiveFictionBundle(
      {
        request: 'fixture special request',
        sceneState: {},
        semanticIds: ['AUTHOR.PERSONALITY'],
        maxContextRounds: 1,
        system: 'fixture system',
        repoRoot: process.cwd(),
      },
      { runDir, clients: modelClients }
    );
  } catch (error) {
    if (mode !== 'ERROR') throw error;
  }
}

async function addTrackedText(
  runDir: string,
  name: string,
  content: string
): Promise<void> {
  const manifest = await readJson(path.join(runDir, 'manifest.json'));
  await writeFile(path.join(runDir, name), content, 'utf8');
  manifest.artifacts[name] = {
    file: name,
    bytes: Buffer.byteLength(content, 'utf8'),
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
  };
  await saveManifest(runDir, manifest);
}

test('independent status closure: ERROR rejects tracked output.md', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-error-layout-'));
  try {
    await makeSpecialBundle(runDir, 'ERROR');
    await addTrackedText(runDir, 'output.md', 'stale output\n');
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.status, 'ERROR');
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'TRACKED_ARTIFACT_UNEXPECTED'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent status closure: NEED_CONTEXT rejects tracked failure.json', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-need-layout-'));
  try {
    await makeSpecialBundle(runDir, 'NEED_CONTEXT');
    await addTrackedText(
      runDir,
      'failure.json',
      JSON.stringify({ name: 'Error', message: 'stale failure' }, null, 2) + '\n'
    );
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.status, 'NEED_CONTEXT');
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'TRACKED_ARTIFACT_UNEXPECTED'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent status closure: CONFLICT rejects tracked output.md', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-conflict-layout-'));
  try {
    await makeSpecialBundle(runDir, 'CONFLICT');
    await addTrackedText(runDir, 'output.md', 'stale output\n');
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.status, 'CONFLICT');
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'TRACKED_ARTIFACT_UNEXPECTED'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('independent identity validation: whitespace-only response_id is rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-response-id-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    calls[0].response_id = '   ';
    manifest.calls = JSON.parse(JSON.stringify(calls));
    await rewriteTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false, 'whitespace response_id must fail');
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('documented identity boundary: swapping syntactically valid request_id and response_id is not detectable offline', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-independent-id-swap-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    const originalRequestId = calls[0].request_id;
    calls[0].request_id = calls[0].response_id;
    calls[0].response_id = originalRequestId;
    manifest.calls = JSON.parse(JSON.stringify(calls));
    await rewriteTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      true,
      'offline verifier currently checks ID shape/consistency, not provider-native ID namespace semantics'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
