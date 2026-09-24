import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeModelClients } from '../adapters/model-backed';
import { runLiveFictionBundle } from '../live-fiction';
import type { ModelClient, ModelRequest, ModelResponse } from '../model/types';
import { verifyLiveFictionBundle } from '../verify-live-bundle';

function client(): ModelClient {
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
              facts: [{ id: 'F1', type: 'fact', proposition: 'fixture' }],
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
  const model = client();
  return {
    retrievalPlanner: model,
    compiler: model,
    generator: model,
    validator: model,
    patcher: model,
  };
}

async function makeBundle(runDir: string): Promise<void> {
  await runLiveFictionBundle(
    {
      request: 'fixture request',
      sceneState: {},
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

async function writeTrackedJson(
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

async function saveManifest(runDir: string, manifest: any): Promise<void> {
  await writeFile(
    path.join(runDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
}

test('independent recheck control bundle verifies', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-control-'));
  try {
    await makeBundle(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial recheck: OUTPUT call order cannot be arbitrarily reversed', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-order-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    calls.reverse();
    manifest.calls = JSON.parse(JSON.stringify(calls));
    await writeTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'verifier accepted validator -> generator -> compiler as OUTPUT execution evidence'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial recheck: trace generator call_count must agree with calls evidence', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-trace-count-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const trace = await readJson(path.join(runDir, 'trace.json'));
    trace.generator.call_count = 999;
    await writeTrackedJson(runDir, 'trace.json', trace, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'verifier accepted trace.generator.call_count=999 with one generator call'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial recheck: custom system_override content must bind to runtime_contract.system_hash', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-system-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const input = await readJson(path.join(runDir, 'input.json'));
    input.system_override = 'different system after execution';
    await writeTrackedJson(runDir, 'input.json', input, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'verifier accepted changed system_override while system_hash stayed unchanged'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial recheck: call settings must agree with the stage model defaults used by this live runtime', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-settings-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    calls[0].settings.temperature = 0.99;
    manifest.calls = JSON.parse(JSON.stringify(calls));
    await writeTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'verifier accepted call.settings that disagree with stage_models defaults'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial recheck: impossible successful max_context_rounds is rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-rounds-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const input = await readJson(path.join(runDir, 'input.json'));
    input.max_context_rounds = -7;
    manifest.input.max_context_rounds = -7;
    await writeTrackedJson(runDir, 'input.json', input, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      false,
      'verifier accepted OUTPUT with impossible max_context_rounds=-7'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('compatibility boundary: old 0.9 shape without response_id still passes when commit provenance is concrete', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-old09-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    for (const item of calls) delete item.response_id;
    for (const item of manifest.calls) delete item.response_id;
    await writeTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('compatibility boundary: historical 0.9 UNKNOWN commit provenance is now rejected', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-old09-unknown-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    for (const item of calls) delete item.response_id;
    for (const item of manifest.calls) delete item.response_id;
    manifest.commit_sha = 'UNKNOWN';
    await writeTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'COMMIT_SHA_INVALID'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('documented authenticity limit: another syntactically valid commit SHA is not repository-bound by offline verification', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-commit-limit-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    manifest.commit_sha = 'f'.repeat(40);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(
      report.ok,
      true,
      'this test documents the offline verifier boundary; repository provenance is external'
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});


test('adversarial recheck: OUTPUT cannot resume compilation after validation', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-post-validator-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const calls = await readJson(path.join(runDir, 'calls.json'));
    calls.push(structuredClone(calls[0]));
    manifest.calls = JSON.parse(JSON.stringify(calls));
    await writeTrackedJson(runDir, 'calls.json', calls, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'CALL_SEQUENCE_INVALID'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial recheck: trace schema and patch causality cannot drift', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-trace-shape-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    const trace = await readJson(path.join(runDir, 'trace.json'));
    trace.version = '0.4';
    trace.validator.violations.push({
      id: 'V-extra',
      severity: 'hard',
      evidence_refs: [],
    });
    await writeTrackedJson(runDir, 'trace.json', trace, manifest);
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'TRACE_VERSION_INVALID'),
      true
    );
    assert.equal(
      report.errors.some(
        (issue) => issue.code === 'TRACE_PATCHER_VIOLATION_COUNT_MISMATCH'
      ),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('adversarial recheck: successful runtime contract hashes must be SHA-256 values', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-contract-hash-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    manifest.runtime_contract.source_registry_hash = 'not-a-hash';
    await saveManifest(runDir, manifest);

    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, false);
    assert.equal(
      report.errors.some((issue) => issue.code === 'RUNTIME_REGISTRY_HASH_INVALID'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});


test('repository-bound recheck accepts a bundle produced from the current checkout', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-repo-bound-'));
  try {
    await makeBundle(runDir);
    const report = await verifyLiveFictionBundle(runDir, {
      repoRoot: process.cwd(),
    });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('repository-bound recheck rejects a syntactically valid but wrong commit SHA', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-repo-commit-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    manifest.commit_sha = 'f'.repeat(40);
    await saveManifest(runDir, manifest);

    const offline = await verifyLiveFictionBundle(runDir);
    assert.equal(offline.ok, true, JSON.stringify(offline.errors));

    const bound = await verifyLiveFictionBundle(runDir, {
      repoRoot: process.cwd(),
    });
    assert.equal(bound.ok, false);
    assert.equal(
      bound.errors.some((issue) => issue.code === 'REPO_COMMIT_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test('repository-bound recheck binds registry and executable prompt hashes', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'linyuan-recheck-repo-contract-'));
  try {
    await makeBundle(runDir);
    const manifest = await readJson(path.join(runDir, 'manifest.json'));
    manifest.runtime_contract.source_registry_hash = 'a'.repeat(64);
    manifest.runtime_contract.prompt_template_hashes.compiler = 'b'.repeat(64);
    await saveManifest(runDir, manifest);

    const offline = await verifyLiveFictionBundle(runDir);
    assert.equal(offline.ok, true, JSON.stringify(offline.errors));

    const bound = await verifyLiveFictionBundle(runDir, {
      repoRoot: process.cwd(),
    });
    assert.equal(bound.ok, false);
    assert.equal(
      bound.errors.some((issue) => issue.code === 'REPO_REGISTRY_HASH_MISMATCH'),
      true
    );
    assert.equal(
      bound.errors.some((issue) => issue.code === 'REPO_PROMPT_HASH_MISMATCH'),
      true
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
