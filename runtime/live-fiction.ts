import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createModelBackedRuntime,
  MODEL_PROMPT_TEMPLATES,
  type ModelBackedRuntime,
  type RuntimeModelClients,
} from './adapters/model-backed';
import type { ModelCallRecord, ModelClient, ModelDefaults } from './model/types';
import {
  runFiction,
  type FictionRunInput,
  type FictionRunResult,
} from './orchestrator';
import {
  createProductionModelClientsFromEnv,
  type ProductionFictionInput,
} from './production-fiction';
import { stableHash } from './trace';

export type LiveFictionStatus =
  | 'OUTPUT'
  | 'NEED_CONTEXT'
  | 'CONFLICT'
  | 'ERROR';

export interface LiveArtifact {
  file: string;
  sha256: string;
  bytes: number;
}

export interface LiveFailure {
  name: string;
  message: string;
}

export interface LiveFictionManifest {
  version: '0.9';
  bundle_id: string;
  runtime_run_id: string | null;
  started_at: string;
  finished_at: string;
  commit_sha: string;
  status: LiveFictionStatus;
  input: {
    request_hash: string;
    scene_state_hash: string;
    semantic_ids: string[] | null;
    max_context_rounds: number;
    custom_system: boolean;
  };
  runtime_contract: {
    system_hash: string | null;
    source_registry_hash: string | null;
    prompt_template_hashes: Record<string, string>;
  };
  stage_models: Record<
    string,
    {
      provider: string;
      model: string;
      defaults: ModelDefaults;
    }
  >;
  retrieval: Array<{
    semantic_id: string;
    content_hash: string;
  }>;
  calls: ModelCallRecord[];
  artifacts: Record<string, LiveArtifact>;
  failure: LiveFailure | null;
}

export interface LiveFictionBundleOptions {
  runDir: string;
  clients?: RuntimeModelClients;
}

export interface LiveFictionBundleRun {
  runDir: string;
  manifest: LiveFictionManifest;
  result: FictionRunResult;
}

export class LiveFictionBundleError extends Error {
  readonly runDir: string;
  readonly manifest: LiveFictionManifest;

  constructor(
    runDir: string,
    manifest: LiveFictionManifest,
    cause: unknown
  ) {
    super(
      'Live fiction failed: ' +
        (manifest.failure?.message ?? 'unknown error') +
        '. Evidence bundle: ' +
        runDir,
      { cause: sanitizedFailureCause(cause) }
    );
    this.name = 'LiveFictionBundleError';
    this.runDir = runDir;
    this.manifest = manifest;
  }
}

function sha256Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

async function prepareRunDirectory(runDir: string): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const existing = await readdir(runDir);
  if (existing.length > 0) {
    throw new Error(
      'Live evidence run directory must be empty: ' +
        runDir +
        '. Use a new run directory for every execution.'
    );
  }
}

async function writeTracked(
  runDir: string,
  file: string,
  content: string,
  artifacts: Record<string, LiveArtifact>
): Promise<void> {
  await writeFile(path.join(runDir, file), content, 'utf8');
  artifacts[file] = {
    file,
    sha256: sha256Text(content),
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

async function detectGitCommit(repoRoot: string): Promise<string> {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  if (process.env.LINYUAN_COMMIT) return process.env.LINYUAN_COMMIT;

  try {
    const head = (await readFile(path.join(repoRoot, '.git/HEAD'), 'utf8')).trim();
    if (!head.startsWith('ref: ')) return head;
    const refPath = head.slice(5).trim();
    return (
      await readFile(path.join(repoRoot, '.git', refPath), 'utf8')
    ).trim();
  } catch {
    return 'UNKNOWN';
  }
}

function descriptor(client: ModelClient): {
  provider: string;
  model: string;
  defaults: ModelDefaults;
} {
  return {
    provider: client.provider,
    model: client.model,
    defaults: structuredClone(client.defaults),
  };
}

function stageModels(
  clients: RuntimeModelClients | null
): LiveFictionManifest['stage_models'] {
  if (!clients) return {};
  return {
    retrieval_planner: descriptor(clients.retrievalPlanner),
    compiler: descriptor(clients.compiler),
    generator: descriptor(clients.generator),
    validator: descriptor(clients.validator),
    patcher: descriptor(clients.patcher),
  };
}

function promptTemplateHashes(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(MODEL_PROMPT_TEMPLATES).map(([key, value]) => [
      key,
      stableHash(value),
    ])
  );
}

function assertInput(input: ProductionFictionInput): void {
  if (input.request.trim().length === 0) {
    throw new Error('Fiction request must not be empty');
  }
  if (
    input.maxContextRounds !== undefined &&
    (!Number.isInteger(input.maxContextRounds) || input.maxContextRounds < 1)
  ) {
    throw new Error('maxContextRounds must be a positive integer');
  }
}

function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /API_KEY|TOKEN|SECRET|PASSWORD/i.test(key) &&
        typeof value === 'string' &&
        value.length >= 4
    )
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
}

export function sanitizeLiveFailureMessage(message: string): string {
  let sanitized = message;
  for (const secret of secretValues()) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  sanitized = sanitized.replace(
    /Bearer\s+[A-Za-z0-9._~+\/=:-]+/gi,
    'Bearer [REDACTED]'
  );
  return sanitized;
}

function failureFrom(error: unknown): LiveFailure {
  const name = error instanceof Error ? error.name : 'Error';
  const raw = error instanceof Error ? error.message : String(error);
  return {
    name,
    message: sanitizeLiveFailureMessage(raw),
  };
}

function sanitizedFailureCause(error: unknown): Error {
  const failure = failureFrom(error);
  const safe = new Error(failure.message);
  safe.name = failure.name;
  return safe;
}

function inputArtifact(input: ProductionFictionInput): Record<string, unknown> {
  const value: Record<string, unknown> = {
    request: input.request,
    scene_state: structuredClone(input.sceneState ?? {}),
    semantic_ids: input.semanticIds ? [...input.semanticIds] : null,
    max_context_rounds: input.maxContextRounds ?? 3,
  };
  if (input.system !== undefined) {
    value.system_override = input.system;
  }
  return value;
}

function runInput(
  input: ProductionFictionInput,
  system: string
): FictionRunInput {
  const value: FictionRunInput = {
    system,
    request: input.request,
    sceneState: structuredClone(input.sceneState ?? {}),
  };
  if (input.semanticIds !== undefined) {
    value.semanticIds = [...input.semanticIds];
  }
  if (input.maxContextRounds !== undefined) {
    value.maxContextRounds = input.maxContextRounds;
  }
  return value;
}

function resultSummary(result: FictionRunResult): Record<string, unknown> {
  if (result.status === 'OUTPUT') {
    return {
      status: result.status,
      output_hash: stableHash(result.output),
    };
  }
  if (result.status === 'NEED_CONTEXT') {
    return {
      status: result.status,
      missing: result.missing,
    };
  }
  return {
    status: result.status,
    conflict: result.conflict,
  };
}

function buildManifest(input: {
  bundleId: string;
  startedAt: string;
  finishedAt: string;
  commitSha: string;
  status: LiveFictionStatus;
  sourceInput: ProductionFictionInput;
  systemHash: string | null;
  registryHash: string | null;
  clients: RuntimeModelClients | null;
  calls: ModelCallRecord[];
  result: FictionRunResult | null;
  artifacts: Record<string, LiveArtifact>;
  failure: LiveFailure | null;
}): LiveFictionManifest {
  return {
    version: '0.9',
    bundle_id: input.bundleId,
    runtime_run_id: input.result?.trace.run_id ?? null,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    commit_sha: input.commitSha,
    status: input.status,
    input: {
      request_hash: stableHash(input.sourceInput.request),
      scene_state_hash: stableHash(input.sourceInput.sceneState ?? {}),
      semantic_ids: input.sourceInput.semanticIds
        ? [...input.sourceInput.semanticIds]
        : null,
      max_context_rounds: input.sourceInput.maxContextRounds ?? 3,
      custom_system: input.sourceInput.system !== undefined,
    },
    runtime_contract: {
      system_hash: input.systemHash,
      source_registry_hash: input.registryHash,
      prompt_template_hashes: promptTemplateHashes(),
    },
    stage_models: stageModels(input.clients),
    retrieval: input.result
      ? input.result.trace.retrieval.map((item) => ({ ...item }))
      : [],
    calls: input.calls.map((call) => structuredClone(call)),
    artifacts: structuredClone(input.artifacts),
    failure: input.failure ? structuredClone(input.failure) : null,
  };
}

export async function runLiveFictionBundle(
  input: ProductionFictionInput,
  options: LiveFictionBundleOptions
): Promise<LiveFictionBundleRun> {
  const runDir = path.resolve(options.runDir);
  const repoRoot = input.repoRoot ?? process.cwd();
  const bundleId = randomUUID();
  const startedAt = new Date().toISOString();
  const commitSha = await detectGitCommit(repoRoot);
  const artifacts: Record<string, LiveArtifact> = {};

  await prepareRunDirectory(runDir);
  await writeTracked(
    runDir,
    'input.json',
    jsonText(inputArtifact(input)),
    artifacts
  );

  let clients: RuntimeModelClients | null = options.clients ?? null;
  let runtime: ModelBackedRuntime | null = null;
  let systemHash: string | null = null;
  let registryHash: string | null = null;

  try {
    assertInput(input);

    const system =
      input.system ??
      (await readFile(path.join(repoRoot, 'MODE-FICTION.md'), 'utf8'));
    systemHash = stableHash(system);
    registryHash = stableHash(
      await readFile(path.join(repoRoot, 'SOURCE_REGISTRY.yaml'), 'utf8')
    );

    if (!clients) {
      clients = createProductionModelClientsFromEnv();
    }

    runtime = await createModelBackedRuntime(clients, { repoRoot });
    const result = await runFiction(runInput(input, system), runtime.adapters);
    const calls = runtime.calls.map((call) => structuredClone(call));

    await writeTracked(runDir, 'trace.json', jsonText(result.trace), artifacts);
    await writeTracked(runDir, 'calls.json', jsonText(calls), artifacts);
    await writeTracked(
      runDir,
      'result.json',
      jsonText(resultSummary(result)),
      artifacts
    );
    if (result.status === 'OUTPUT') {
      await writeTracked(
        runDir,
        'output.md',
        result.output + '\n',
        artifacts
      );
    }

    const manifest = buildManifest({
      bundleId,
      startedAt,
      finishedAt: new Date().toISOString(),
      commitSha,
      status: result.status,
      sourceInput: input,
      systemHash,
      registryHash,
      clients,
      calls,
      result,
      artifacts,
      failure: null,
    });
    await writeFile(
      path.join(runDir, 'manifest.json'),
      jsonText(manifest),
      'utf8'
    );

    return {
      runDir,
      manifest,
      result,
    };
  } catch (error) {
    const calls = runtime
      ? runtime.calls.map((call) => structuredClone(call))
      : [];
    const failure = failureFrom(error);

    await writeTracked(runDir, 'calls.json', jsonText(calls), artifacts);
    await writeTracked(
      runDir,
      'failure.json',
      jsonText(failure),
      artifacts
    );

    const manifest = buildManifest({
      bundleId,
      startedAt,
      finishedAt: new Date().toISOString(),
      commitSha,
      status: 'ERROR',
      sourceInput: input,
      systemHash,
      registryHash,
      clients,
      calls,
      result: null,
      artifacts,
      failure,
    });
    await writeFile(
      path.join(runDir, 'manifest.json'),
      jsonText(manifest),
      'utf8'
    );

    throw new LiveFictionBundleError(runDir, manifest, error);
  }
}
