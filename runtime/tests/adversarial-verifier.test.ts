import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
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
            provenance: { F1: { source_id: 'AUTHOR.PERSONALITY', scene_relevance: 'material', scene_impact: 'Fixture fact applies to the requested scene.' } },
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

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        runLiveFictionBundle(input, { runDir, clients: clients() })
      )
    );

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


async function errorBundle(runDir: string): Promise<void> {
  const client: ModelClient = {
    provider: 'openai',
    model: 'fixture-model',
    defaults: {},
    async complete(request): Promise<ModelResponse> {
      if (request.stage === 'compiler') {
        throw new Error('fixture provider failure');
      }
      throw new Error('unexpected stage ' + request.stage);
    },
  };
  const failingClients: RuntimeModelClients = {
    retrievalPlanner: client,
    compiler: client,
    generator: client,
    validator: client,
    patcher: client,
  };
  try {
    await runLiveFictionBundle(
      {
        request: 'fixture request',
        sceneState: {},
        semanticIds: ['AUTHOR.PERSONALITY'],
        system: 'fixture system',
        repoRoot: process.cwd(),
      },
      { runDir, clients: failingClients }
    );
    assert.fail('expected live run to fail');
  } catch {
    // The ERROR bundle is the artifact under test.
  }
  const report = await verifyLiveFictionBundle(runDir);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.status, 'ERROR');
}

test('adversarial matrix: artifact content, byte count, and manifest hash tampering are rejected', async () => {
  for (const mode of ['content', 'bytes', 'hash'] as const) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-artifact-'));
    try {
      await validBundle(runDir);
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifest = await readJson(manifestPath);
      if (mode === 'content') {
        await writeFile(path.join(runDir, 'output.md'), 'tampered\n', 'utf8');
      } else if (mode === 'bytes') {
        manifest.artifacts['output.md'].bytes += 1;
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      } else {
        manifest.artifacts['output.md'].sha256 = '0'.repeat(64);
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      }

      const report = await verifyLiveFictionBundle(runDir);
      assert.equal(report.ok, false, mode);
      const codes = new Set(report.errors.map((issue) => issue.code));
      if (mode === 'content') assert.equal(codes.has('ARTIFACT_HASH_MISMATCH'), true);
      if (mode === 'bytes') assert.equal(codes.has('ARTIFACT_SIZE_MISMATCH'), true);
      if (mode === 'hash') assert.equal(codes.has('ARTIFACT_HASH_MISMATCH'), true);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }
});

test('adversarial matrix: calls.json and manifest.calls divergence is rejected even with a refreshed artifact hash', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-calls-mismatch-'));
  try {
    await validBundle(runDir);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = await readJson(manifestPath);
    const calls = await readJson(path.join(runDir, 'calls.json'));
    calls[0].request_id = 'req-mutated-only-in-calls-file';
    await writeTrackedJson(runDir, 'calls.json', calls, manifest);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(report.errors.some((i) => i.code === 'CALLS_MANIFEST_MISMATCH'), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial matrix: trace retrieval/run id and result status divergence are rejected', async () => {
  const cases = ['trace_run_id', 'trace_retrieval', 'result_status'] as const;
  for (const mode of cases) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-cross-file-'));
    try {
      await validBundle(runDir);
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifest = await readJson(manifestPath);
      if (mode.startsWith('trace_')) {
        const trace = await readJson(path.join(runDir, 'trace.json'));
        if (mode === 'trace_run_id') trace.run_id = '00000000-0000-4000-8000-000000000000';
        else trace.retrieval = [];
        await writeTrackedJson(runDir, 'trace.json', trace, manifest);
      } else {
        const result = await readJson(path.join(runDir, 'result.json'));
        result.status = 'CONFLICT';
        await writeTrackedJson(runDir, 'result.json', result, manifest);
      }
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

      const report = await verifyLiveFictionBundle(runDir);
      assert.equal(report.ok, false, mode);
      const expected =
        mode === 'trace_run_id'
          ? 'TRACE_RUN_ID_MISMATCH'
          : mode === 'trace_retrieval'
            ? 'TRACE_RETRIEVAL_MISMATCH'
            : 'RESULT_STATUS_MISMATCH';
      assert.equal(report.errors.some((i) => i.code === expected), true);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }
});

test('adversarial matrix: forbidden status artifacts are rejected for OUTPUT and ERROR', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-forbidden-output-'));
  const errorDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-forbidden-error-'));
  try {
    await validBundle(outputDir);
    {
      const manifestPath = path.join(outputDir, 'manifest.json');
      const manifest = await readJson(manifestPath);
      await writeTrackedJson(outputDir, 'failure.json', { name: 'Fake', message: 'fake' }, manifest);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      const report = await verifyLiveFictionBundle(outputDir);
      assert.equal(report.ok, false);
      assert.equal(report.errors.some((i) => i.code === 'TRACKED_ARTIFACT_UNEXPECTED'), true);
    }

    await errorBundle(errorDir);
    {
      const manifestPath = path.join(errorDir, 'manifest.json');
      const manifest = await readJson(manifestPath);
      await writeTrackedJson(errorDir, 'output.md', 'fake output\n', manifest);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      const report = await verifyLiveFictionBundle(errorDir);
      assert.equal(report.ok, false);
      assert.equal(report.errors.some((i) => i.code === 'TRACKED_ARTIFACT_UNEXPECTED'), true);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(errorDir, { recursive: true, force: true });
  }
});

test('adversarial matrix: missing required files, extra files, and extra directories are rejected', async () => {
  for (const mode of ['missing', 'file', 'dir'] as const) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-closure-'));
    try {
      await validBundle(runDir);
      if (mode === 'missing') {
        await unlink(path.join(runDir, 'output.md'));
      } else if (mode === 'file') {
        await writeFile(path.join(runDir, 'extra.txt'), 'extra', 'utf8');
      } else {
        await mkdir(path.join(runDir, 'extra-dir'));
      }
      const report = await verifyLiveFictionBundle(runDir);
      assert.equal(report.ok, false, mode);
      const expected = mode === 'missing' ? 'ARTIFACT_MISSING' : 'UNTRACKED_ENTRY';
      assert.equal(report.errors.some((i) => i.code === expected), true);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }
});

test('adversarial matrix: a symlink cannot masquerade as a regular evidence artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-symlink-root-'));
  const runDir = path.join(root, 'run');
  const external = path.join(root, 'external-output.md');
  try {
    await mkdir(runDir);
    await validBundle(runDir);
    const original = await readFile(path.join(runDir, 'output.md'), 'utf8');
    await writeFile(external, original, 'utf8');
    await unlink(path.join(runDir, 'output.md'));
    await symlink(external, path.join(runDir, 'output.md'));

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(report.errors.some((i) => i.code === 'NON_FILE_ENTRY'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adversarial matrix: unsafe artifact filenames and path traversal are rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-path-'));
  try {
    await validBundle(runDir);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = await readJson(manifestPath);
    manifest.artifacts['../escape.json'] = {
      file: '../escape.json',
      sha256: '0'.repeat(64),
      bytes: 0,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(report.errors.some((i) => i.code === 'ARTIFACT_NAME_INVALID'), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial matrix: stale artifacts make a reused run directory fail closed', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-stale-'));
  try {
    await writeFile(path.join(runDir, 'stale.json'), '{}\n', 'utf8');
    await assert.rejects(
      () =>
        runLiveFictionBundle(
          {
            request: 'fixture request',
            semanticIds: ['AUTHOR.PERSONALITY'],
            system: 'fixture system',
            repoRoot: process.cwd(),
          },
          { runDir, clients: clients() }
        ),
      /run directory must be empty/
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial matrix: invalid request_id / response_id values are rejected while old absent response_id stays compatible', async () => {
  for (const field of ['request_id', 'response_id'] as const) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-id-'));
    try {
      await validBundle(runDir);
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifest = await readJson(manifestPath);
      const calls = await readJson(path.join(runDir, 'calls.json'));
      calls[0][field] = '   ';
      manifest.calls[0][field] = '   ';
      await writeTrackedJson(runDir, 'calls.json', calls, manifest);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

      const report = await verifyLiveFictionBundle(runDir);
      assert.equal(report.ok, false, field);
      const expected = field === 'request_id' ? 'CALL_REQUEST_ID_INVALID' : 'CALL_RESPONSE_ID_INVALID';
      assert.equal(report.errors.some((i) => i.code === expected), true);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }
});

test('adversarial matrix: malformed call hashes/settings/usage cannot be made valid by rehashing calls.json', async () => {
  for (const mode of ['hash', 'settings', 'usage'] as const) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-call-schema-'));
    try {
      await validBundle(runDir);
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifest = await readJson(manifestPath);
      const calls = await readJson(path.join(runDir, 'calls.json'));
      if (mode === 'hash') calls[0].request_hash = 'not-a-hash';
      if (mode === 'settings') calls[0].settings.temperature = 'hot';
      if (mode === 'usage') calls[0].usage = { totalTokens: -1 };
      manifest.calls = JSON.parse(JSON.stringify(calls));
      await writeTrackedJson(runDir, 'calls.json', calls, manifest);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

      const report = await verifyLiveFictionBundle(runDir);
      assert.equal(report.ok, false, mode);
      const expected =
        mode === 'hash'
          ? 'CALL_HASH_INVALID'
          : mode === 'settings'
            ? 'CALL_SETTINGS_INVALID'
            : 'CALL_USAGE_INVALID';
      assert.equal(report.errors.some((i) => i.code === expected), true);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }
});


test('adversarial: non-output success states cannot be justified by an unrelated call', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-fake-conflict-'));
  try {
    await validBundle(runDir);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = await readJson(manifestPath);
    const calls = await readJson(path.join(runDir, 'calls.json'));

    const unrelated = calls.find((call: any) => call.stage === 'generator');
    assert.ok(unrelated);
    manifest.status = 'CONFLICT';
    manifest.calls = [unrelated];
    delete manifest.artifacts['output.md'];
    await unlink(path.join(runDir, 'output.md'));
    await writeTrackedJson(runDir, 'calls.json', [unrelated], manifest);
    await writeTrackedJson(
      runDir,
      'result.json',
      { status: 'CONFLICT', conflict: 'fabricated conflict' },
      manifest
    );
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(report.errors.some((i) => i.code === 'CALL_STAGE_REQUIRED'), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
