import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runFiction, type RuntimeAdapters } from '../orchestrator';
import {
  runLiveFictionBundle,
  sanitizeLiveFailureMessage,
} from '../live-fiction';
import { createModelClient } from '../model/providers';
import type {
  ModelCallRecord,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ModelStage,
} from '../model/types';
import { stableHash } from '../trace';
import { verifyLiveFictionBundle } from '../verify-live-bundle';
import { executeRealEvalCase } from '../../evals/real-executor';
import type { EvalCase } from '../../evals/types';
import type { RuntimeModelClients } from '../adapters/model-backed';

type JsonRecord = Record<string, unknown>;

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function sha256Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function call(stage: ModelStage): ModelCallRecord {
  return {
    stage,
    provider: 'openai',
    model: 'fixture-model',
    request_hash: '1'.repeat(64),
    response_hash: '2'.repeat(64),
    response_format: 'json',
    latency_ms: 1,
    request_id: 'req_' + stage,
    response_id: 'resp_' + stage,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
    settings: {
      temperature: 0,
      top_p: 1,
      max_output_tokens: 256,
      seed: null,
    },
  };
}

function stageModels(): Record<string, unknown> {
  const descriptor = {
    provider: 'openai',
    model: 'fixture-model',
    defaults: {},
  };
  return {
    retrieval_planner: structuredClone(descriptor),
    compiler: structuredClone(descriptor),
    generator: structuredClone(descriptor),
    validator: structuredClone(descriptor),
    patcher: structuredClone(descriptor),
  };
}

async function createOutputBundle(options: {
  calls?: unknown[];
  stageModels?: unknown;
  requestIdMutator?: (calls: JsonRecord[]) => void;
} = {}): Promise<string> {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-bundle-'));
  const request = 'fixture request';
  const sceneState = { location: 'fixture' };
  const output = 'fixture output';
  const calls = structuredClone(
    options.calls ?? [call('compiler'), call('generator'), call('validator')]
  ) as JsonRecord[];
  options.requestIdMutator?.(calls);

  const input = {
    request,
    scene_state: sceneState,
    semantic_ids: ['AUTHOR.PERSONALITY'],
    max_context_rounds: 3,
  };
  const trace = {
    version: '0.5',
    run_id: 'run-fixture',
    retrieval: [
      {
        semantic_id: 'AUTHOR.PERSONALITY',
        content_hash: '3'.repeat(64),
      },
    ],
    compiler: {
      active_context_hashes: ['4'.repeat(64)],
      provenance: [],
    },
    generator: {
      call_count: 1,
      payload_hashes: ['5'.repeat(64)],
      need_context: [],
    },
    validator: {
      violations: [],
    },
    patcher: {
      scopes: [],
    },
  };
  const result = {
    status: 'OUTPUT',
    output_hash: stableHash(output),
  };

  const artifactTexts: Record<string, string> = {
    'input.json': json(input),
    'trace.json': json(trace),
    'calls.json': json(calls),
    'result.json': json(result),
    'output.md': output + '\n',
  };

  const artifacts: Record<string, unknown> = {};
  for (const [file, text] of Object.entries(artifactTexts)) {
    await writeFile(path.join(runDir, file), text, 'utf8');
    artifacts[file] = {
      file,
      sha256: sha256Text(text),
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  }

  const manifest = {
    version: '0.9',
    bundle_id: 'bundle-fixture',
    runtime_run_id: 'run-fixture',
    started_at: '2026-09-18T00:00:00.000Z',
    finished_at: '2026-09-18T00:00:01.000Z',
    commit_sha: '5991e938d13458cbd52f9020a6834ce138b590f4',
    status: 'OUTPUT',
    input: {
      request_hash: stableHash(request),
      scene_state_hash: stableHash(sceneState),
      semantic_ids: ['AUTHOR.PERSONALITY'],
      max_context_rounds: 3,
      custom_system: false,
    },
    runtime_contract: {
      system_hash: '6'.repeat(64),
      source_registry_hash: '7'.repeat(64),
      prompt_template_hashes: {},
    },
    stage_models:
      options.stageModels === undefined ? stageModels() : options.stageModels,
    retrieval: structuredClone(trace.retrieval),
    calls,
    artifacts,
    failure: null,
  };
  await writeFile(path.join(runDir, 'manifest.json'), json(manifest), 'utf8');
  return runDir;
}

async function rewriteManifest(
  runDir: string,
  mutate: (manifest: JsonRecord) => void
): Promise<void> {
  const file = path.join(runDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')) as JsonRecord;
  mutate(manifest);
  await writeFile(file, json(manifest), 'utf8');
}

async function rewriteTrackedJson(
  runDir: string,
  file: string,
  value: unknown,
  updateArtifactMetadata: boolean
): Promise<void> {
  const text = json(value);
  await writeFile(path.join(runDir, file), text, 'utf8');
  if (!updateArtifactMetadata) return;
  await rewriteManifest(runDir, (manifest) => {
    const artifacts = manifest.artifacts as JsonRecord;
    artifacts[file] = {
      file,
      sha256: sha256Text(text),
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  });
}

test('control: a structurally normal OUTPUT fixture verifies', async () => {
  const runDir = await createOutputBundle();
  try {
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('artifact content tampering is rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    await writeFile(path.join(runDir, 'output.md'), 'tampered\n', 'utf8');
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'ARTIFACT_HASH_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('declared byte-size tampering is rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    await rewriteManifest(runDir, (manifest) => {
      const artifacts = manifest.artifacts as JsonRecord;
      const output = artifacts['output.md'] as JsonRecord;
      output.bytes = Number(output.bytes) + 1;
    });
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'ARTIFACT_SIZE_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('manifest artifact-hash tampering is rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    await rewriteManifest(runDir, (manifest) => {
      const artifacts = manifest.artifacts as JsonRecord;
      const output = artifacts['output.md'] as JsonRecord;
      output.sha256 = '0'.repeat(64);
    });
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'ARTIFACT_HASH_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('calls.json and manifest.calls divergence is rejected even when calls.json hash is updated', async () => {
  const runDir = await createOutputBundle();
  try {
    await rewriteTrackedJson(runDir, 'calls.json', [call('compiler')], true);
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'CALLS_MANIFEST_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('trace retrieval and manifest retrieval divergence is rejected after rehashing trace', async () => {
  const runDir = await createOutputBundle();
  try {
    const trace = JSON.parse(
      await readFile(path.join(runDir, 'trace.json'), 'utf8')
    ) as JsonRecord;
    trace.retrieval = [];
    await rewriteTrackedJson(runDir, 'trace.json', trace, true);
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'TRACE_RETRIEVAL_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('result status and manifest status divergence is rejected after rehashing result', async () => {
  const runDir = await createOutputBundle();
  try {
    const result = {
      status: 'CONFLICT',
      conflict: 'fixture',
    };
    await rewriteTrackedJson(runDir, 'result.json', result, true);
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'RESULT_STATUS_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('forbidden tracked artifact in OUTPUT bundle is rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    const failureText = json({ name: 'Error', message: 'stale' });
    await writeFile(path.join(runDir, 'failure.json'), failureText, 'utf8');
    await rewriteManifest(runDir, (manifest) => {
      const artifacts = manifest.artifacts as JsonRecord;
      artifacts['failure.json'] = {
        file: 'failure.json',
        sha256: sha256Text(failureText),
        bytes: Buffer.byteLength(failureText, 'utf8'),
      };
    });
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some(
        (issue) => issue.code === 'TRACKED_ARTIFACT_UNEXPECTED'
      ),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('missing required artifact is rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    await unlink(path.join(runDir, 'result.json'));
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('untracked extra file and directory are rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    await writeFile(path.join(runDir, 'extra.txt'), 'extra', 'utf8');
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(path.join(runDir, 'extra-dir'))
    );
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.filter((issue) => issue.code === 'UNTRACKED_ENTRY').length >=
        2,
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('non-regular tracked file is rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    await unlink(path.join(runDir, 'output.md'));
    await symlink(path.join(runDir, 'input.json'), path.join(runDir, 'output.md'));
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'NON_FILE_ENTRY'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('unsafe artifact filename and path traversal metadata are rejected', async () => {
  const runDir = await createOutputBundle();
  try {
    await rewriteManifest(runDir, (manifest) => {
      const artifacts = manifest.artifacts as JsonRecord;
      artifacts['../escape.json'] = {
        file: '../escape.json',
        sha256: '0'.repeat(64),
        bytes: 0,
      };
    });
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'ARTIFACT_NAME_INVALID'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('run directory reuse with stale artifact is rejected before execution', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-adv-reuse-'));
  try {
    await writeFile(path.join(runDir, 'stale.txt'), 'stale', 'utf8');
    await assert.rejects(
      () => runLiveFictionBundle({ request: 'fixture' }, { runDir }),
      /run directory must be empty/
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('old 0.9 call records without response_id remain accepted', async () => {
  const legacyCalls = [call('compiler'), call('generator'), call('validator')].map(
    (item) => {
      const legacy = { ...item } as JsonRecord;
      delete legacy.response_id;
      return legacy;
    }
  );
  const runDir = await createOutputBundle({ calls: legacyCalls });
  try {
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial: OUTPUT with zero model calls must not verify', async () => {
  const runDir = await createOutputBundle({ calls: [] });
  try {
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'Verifier accepted OUTPUT evidence with calls=[]'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial: missing stage_models must not verify when calls exist', async () => {
  const runDir = await createOutputBundle({ stageModels: null });
  try {
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'Verifier accepted model calls with manifest.stage_models=null'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial: malformed model-call hashes must not verify', async () => {
  const malformed = [call('compiler'), call('generator'), call('validator')];
  malformed[0]!.request_hash = 'not-a-sha256';
  malformed[0]!.response_hash = 'also-not-a-sha256';
  const runDir = await createOutputBundle({ calls: malformed });
  try {
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'Verifier accepted malformed request_hash/response_hash metadata'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial: whitespace-only request_id must not verify', async () => {
  const runDir = await createOutputBundle({
    requestIdMutator(calls) {
      calls[0]!.request_id = '   ';
    },
  });
  try {
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'Verifier accepted whitespace-only request_id'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('documented authenticity limit: a fully fabricated but internally consistent bundle verifies', async () => {
  const runDir = await createOutputBundle();
  try {
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('secret sanitizer removes env secret values and bearer tokens from provider-style errors', () => {
  const previous = process.env.LINYUAN_TEST_TOKEN;
  process.env.LINYUAN_TEST_TOKEN = 'fixture-env-secret';
  try {
    const sanitized = sanitizeLiveFailureMessage(
      'provider said fixture-env-secret and Authorization: Bearer abc.DEF-123+/='
    );
    assert.equal(sanitized.includes('fixture-env-secret'), false);
    assert.equal(sanitized.includes('abc.DEF-123+/='), false);
    assert.equal(
      sanitized,
      'provider said [REDACTED] and Authorization: Bearer [REDACTED]'
    );
  } finally {
    if (previous === undefined) delete process.env.LINYUAN_TEST_TOKEN;
    else process.env.LINYUAN_TEST_TOKEN = previous;
  }
});

test('provider adapters preserve request format, model ids, usage and provider identities', async () => {
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
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            total_tokens: 18,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
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
            'Content-Type': 'application/json',
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
          usage: {
            input_tokens: 17,
            output_tokens: 5,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'request-id': 'req-anthropic',
          },
        }
      );
    }

    throw new Error('unexpected URL ' + url);
  };

  try {
    const request: ModelRequest = {
      stage: 'compiler',
      system: 'system fixture',
      prompt: 'prompt fixture',
      responseFormat: 'json',
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 123,
    };

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
    });
    const anthropic = createModelClient({
      provider: 'anthropic',
      model: 'anthropic-configured-model',
      apiKey: 'anthropic-key',
      baseUrl: 'https://anthropic.invalid',
    });

    const oa = await openai.complete(request);
    const ge = await gemini.complete(request);
    const an = await anthropic.complete(request);

    assert.equal(seen[0]!.url, 'https://openai.invalid/v1/responses');
    assert.equal(seen[0]!.headers.Authorization, 'Bearer openai-key');
    assert.deepEqual(seen[0]!.body.text, {
      format: { type: 'json_object' },
    });
    assert.equal(seen[0]!.body.model, 'openai-configured-model');
    assert.equal(seen[0]!.body.input, 'prompt fixture');
    assert.equal(seen[0]!.body.instructions, 'system fixture');

    assert.equal(
      seen[1]!.url,
      'https://gemini.invalid/v1beta/models/gemini-configured-model:generateContent'
    );
    assert.equal(seen[1]!.headers['x-goog-api-key'], 'gemini-key');
    const geminiConfig = seen[1]!.body.generationConfig as JsonRecord;
    assert.equal(geminiConfig.responseMimeType, 'application/json');
    assert.equal(geminiConfig.maxOutputTokens, 123);
    assert.equal(geminiConfig.temperature, 0.2);
    assert.equal(geminiConfig.topP, 0.8);

    assert.equal(seen[2]!.url, 'https://anthropic.invalid/v1/messages');
    assert.equal(seen[2]!.headers.Authorization, 'Bearer anthropic-key');
    assert.equal(seen[2]!.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen[2]!.body.model, 'anthropic-configured-model');
    assert.equal(seen[2]!.body.max_tokens, 123);
    assert.equal(seen[2]!.body.system, 'system fixture');

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

test('adversarial: Gemini configured seed must be sent because GenerationConfig supports seed', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies: JsonRecord[] = [];
  globalThis.fetch = async (_input, init) => {
    capturedBodies.push(JSON.parse(String(init?.body)) as JsonRecord);
    return new Response(
      JSON.stringify({
        responseId: 'resp-seed',
        modelVersion: 'gemini-model',
        candidates: [{ content: { parts: [{ text: '{}' }] } }],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };

  try {
    const client = createModelClient({
      provider: 'gemini',
      model: 'gemini-model',
      apiKey: 'fixture',
      baseUrl: 'https://gemini.invalid/v1beta',
      defaults: { seed: 42 },
    });
    await client.complete({
      stage: 'generator',
      prompt: '{}',
      responseFormat: 'json',
    });
    const config = capturedBodies[0]?.generationConfig as JsonRecord | undefined;
    assert.equal(
      config?.seed,
      42,
      'ModelDefaults.seed is exposed/recorded but Gemini request omitted it'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider HTTP errors preserve status, request id and bounded response body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('fixture-provider-error', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'Content-Type': 'text/plain',
        'x-request-id': 'req-http-error',
      },
    });

  try {
    const client = createModelClient({
      provider: 'openai',
      model: 'fixture',
      apiKey: 'fixture',
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
        return (
          message.includes('429 Too Many Requests') &&
          message.includes('req-http-error') &&
          message.includes('fixture-provider-error')
        );
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generator payload does not receive retrieved raw Canon', async () => {
  const secret = 'RAW_CANON_SECRET_SHOULD_NOT_REACH_GENERATOR';
  let generatorPayload = '';

  const adapters: RuntimeAdapters = {
    retrieve: async () => [
      {
        semanticId: 'FIXTURE.CANON',
        content: secret,
      },
    ],
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
    generate: async (payload) => {
      generatorPayload = JSON.stringify(payload);
      return { status: 'DRAFT', draft: '第一句。' };
    },
    validate: async () => [],
    patch: async () => ({ replacement: 'unused' }),
  };

  const result = await runFiction(
    {
      system: 'fixture system',
      request: 'fixture request',
      sceneState: {},
      semanticIds: ['FIXTURE.CANON'],
    },
    adapters
  );

  assert.equal(result.status, 'OUTPUT');
  assert.equal(generatorPayload.includes(secret), false);
});

test('patcher payload does not receive validator Canon evidence or evidence_refs', async () => {
  const canonSecret = 'CANON_EVIDENCE_SECRET';
  const evidenceRef = 'EVIDENCE_REF_SECRET';
  let patcherPayload = '';

  const adapters: RuntimeAdapters = {
    retrieve: async () => [
      {
        semanticId: 'FIXTURE.CANON',
        content: canonSecret,
      },
    ],
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
      provenance: {
        F1: {
          source_id: 'FIXTURE.CANON',
          evidence: [{ locator: evidenceRef }],
        },
      },
    }),
    generate: async () => ({ status: 'DRAFT', draft: '第一句。' }),
    validate: async () => [
      {
        id: 'V1',
        severity: 'hard',
        location: {
          paragraph: 1,
          sentence_start: 1,
          sentence_end: 1,
        },
        actual: { semantic_claim: 'fixture' },
        required_state: { fixed: true },
        patch_contract: {
          allowed_scope: {
            paragraph: 1,
            sentences: [1, 1],
          },
          preserve: [],
          required_change: ['fix'],
        },
        evidence_refs: [evidenceRef],
      },
    ],
    patch: async (payload) => {
      patcherPayload = JSON.stringify(payload);
      return { replacement: '修正。' };
    },
  };

  const result = await runFiction(
    {
      system: 'fixture system',
      request: 'fixture request',
      sceneState: {},
      semanticIds: ['FIXTURE.CANON'],
    },
    adapters
  );

  assert.equal(result.status, 'OUTPUT');
  assert.equal(patcherPayload.includes(canonSecret), false);
  assert.equal(patcherPayload.includes(evidenceRef), false);
  assert.equal(patcherPayload.includes('evidence_refs'), false);
});

function fixtureModelClient(
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
        requestId: 'req-' + request.stage,
        responseId: 'resp-' + request.stage,
      };
    },
  };
}

test('candidate does not receive evaluator gold and evaluator does not backfill retrieval evidence', async () => {
  const client = fixtureModelClient((request) => {
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
      return JSON.stringify({ status: 'DRAFT', draft: 'fixture draft' });
    }
    if (request.stage === 'validator') {
      return JSON.stringify({ violations: [] });
    }
    if (request.stage === 'eval_judge') {
      assert.equal(request.prompt.includes('GOLD.SHOULD.NOT.BE.RETRIEVED'), false);
      return JSON.stringify({
        satisfied_requirement_ids: [],
        triggered_forbidden_inference_ids: [],
        triggered_overconstraint_ids: [],
        predicted_need_context_ids: [],
        behavior_signatures: [],
        validator_positive_ids: [],
      });
    }
    throw new Error('unexpected stage ' + request.stage);
  });

  const clients: RuntimeModelClients = {
    retrievalPlanner: client,
    compiler: client,
    generator: client,
    validator: client,
    patcher: client,
  };

  const testCase: EvalCase = {
    version: '0.6',
    id: 'adversarial.synthetic-gold-isolation',
    category: 'adversarial',
    description: 'fixture',
    request: 'fixture request',
    scene_state: {},
    required_sources: ['GOLD.SHOULD.NOT.BE.RETRIEVED'],
    requirements: [],
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
    synthetic_canon: 'synthetic canon only',
  };

  const executed = await executeRealEvalCase(testCase, clients, client);
  assert.deepEqual(executed.observation.retrieved_sources, ['EVAL.SYNTHETIC']);
  assert.equal(
    executed.observation.retrieved_sources.includes(
      'GOLD.SHOULD.NOT.BE.RETRIEVED'
    ),
    false
  );
});
