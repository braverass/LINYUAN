import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { MODEL_PROMPT_TEMPLATES } from './adapters/model-backed';
import { officialModelEndpointHash } from './model/providers';
import { detectGitCommit, trackedGitWorktreeIsClean } from './git';
import { loadRegistry, resolveRegisteredSourcePath } from './registry';
import { stableHash } from './trace';

export interface LiveBundleVerificationIssue {
  code: string;
  file: string | null;
  message: string;
}

export interface LiveBundleVerificationReport {
  version: '1.0';
  run_dir: string;
  ok: boolean;
  bundle_id: string | null;
  manifest_version: string | null;
  status: string | null;
  verified_artifacts: string[];
  errors: LiveBundleVerificationIssue[];
}

export interface VerifyLiveBundleOptions {
  repoRoot?: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function sha256Bytes(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function addIssue(
  errors: LiveBundleVerificationIssue[],
  code: string,
  message: string,
  file: string | null = null
): void {
  errors.push({ code, file, message });
}

async function readJsonArtifact(
  runDir: string,
  file: string,
  errors: LiveBundleVerificationIssue[]
): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path.join(runDir, file), 'utf8')) as unknown;
  } catch (error) {
    addIssue(
      errors,
      'JSON_INVALID',
      'Cannot read or parse JSON: ' + errorMessage(error),
      file
    );
    return null;
  }
}

function safeArtifactName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    path.basename(name) === name &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

function expectedArtifacts(status: string): string[] | null {
  if (status === 'OUTPUT') {
    return ['input.json', 'trace.json', 'calls.json', 'result.json', 'output.md'];
  }
  if (status === 'NEED_CONTEXT' || status === 'CONFLICT') {
    return ['input.json', 'trace.json', 'calls.json', 'result.json'];
  }
  if (status === 'ERROR') {
    return ['input.json', 'calls.json', 'failure.json'];
  }
  return null;
}

const LIVE_STAGES = new Set([
  'retrieval_planner',
  'compiler',
  'generator',
  'validator',
  'patcher',
]);

const LIVE_PROVIDERS = new Set(['openai', 'gemini', 'anthropic']);

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isCommitSha(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (/^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validNullableNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function validateUsage(
  value: unknown,
  errors: LiveBundleVerificationIssue[]
): void {
  if (value === null) return;
  const usage = asRecord(value);
  if (!usage) {
    addIssue(errors, 'CALL_USAGE_INVALID', 'Call usage must be null or an object', 'manifest.json');
    return;
  }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
    if (!hasOwn(usage, key)) continue;
    const tokenCount = usage[key];
    if (!Number.isSafeInteger(tokenCount) || (tokenCount as number) < 0) {
      addIssue(
        errors,
        'CALL_USAGE_INVALID',
        'Call usage token counts must be non-negative safe integers',
        'manifest.json'
      );
    }
  }
}

function validateSettings(
  value: unknown,
  errors: LiveBundleVerificationIssue[]
): void {
  const settings = asRecord(value);
  if (!settings) {
    addIssue(errors, 'CALL_SETTINGS_INVALID', 'Call settings must be an object', 'manifest.json');
    return;
  }

  for (const key of ['temperature', 'top_p']) {
    if (!hasOwn(settings, key) || !validNullableNumber(settings[key])) {
      addIssue(
        errors,
        'CALL_SETTINGS_INVALID',
        'Call settings must contain nullable finite numeric ' + key,
        'manifest.json'
      );
    }
  }

  const maxOutputTokens = settings.max_output_tokens;
  if (
    !hasOwn(settings, 'max_output_tokens') ||
    (maxOutputTokens !== null &&
      (!Number.isSafeInteger(maxOutputTokens) ||
        (maxOutputTokens as number) < 1))
  ) {
    addIssue(
      errors,
      'CALL_SETTINGS_INVALID',
      'Call max_output_tokens must be null or a positive safe integer',
      'manifest.json'
    );
  }

  const seed = settings.seed;
  if (
    !hasOwn(settings, 'seed') ||
    (seed !== null && !Number.isSafeInteger(seed))
  ) {
    addIssue(
      errors,
      'CALL_SETTINGS_INVALID',
      'Call seed must be null or a safe integer',
      'manifest.json'
    );
  }
}

function validateModelDefaults(
  value: unknown,
  errors: LiveBundleVerificationIssue[],
  stage: string
): JsonRecord | null {
  const defaults = asRecord(value);
  if (!defaults) {
    addIssue(
      errors,
      'STAGE_MODEL_DEFAULTS_INVALID',
      'Stage model defaults must be an object for ' + stage,
      'manifest.json'
    );
    return null;
  }

  for (const key of ['temperature', 'topP']) {
    if (
      hasOwn(defaults, key) &&
      (typeof defaults[key] !== 'number' || !Number.isFinite(defaults[key]))
    ) {
      addIssue(
        errors,
        'STAGE_MODEL_DEFAULTS_INVALID',
        'Stage model default ' + key + ' must be a finite number when present',
        'manifest.json'
      );
    }
  }

  if (
    hasOwn(defaults, 'maxOutputTokens') &&
    (!Number.isSafeInteger(defaults.maxOutputTokens) ||
      (defaults.maxOutputTokens as number) < 1)
  ) {
    addIssue(
      errors,
      'STAGE_MODEL_DEFAULTS_INVALID',
      'Stage model default maxOutputTokens must be a positive safe integer',
      'manifest.json'
    );
  }

  if (
    hasOwn(defaults, 'seed') &&
    !Number.isSafeInteger(defaults.seed)
  ) {
    addIssue(
      errors,
      'STAGE_MODEL_DEFAULTS_INVALID',
      'Stage model default seed must be a safe integer',
      'manifest.json'
    );
  }
  return defaults;
}

function settingsFromDefaults(defaults: JsonRecord): JsonRecord {
  return {
    temperature: hasOwn(defaults, 'temperature') ? defaults.temperature : null,
    top_p: hasOwn(defaults, 'topP') ? defaults.topP : null,
    max_output_tokens: hasOwn(defaults, 'maxOutputTokens')
      ? defaults.maxOutputTokens
      : null,
    seed: hasOwn(defaults, 'seed') ? defaults.seed : null,
  };
}

function positiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function validateErrorCallPrefix(
  stages: string[],
  semanticIds: unknown,
  errors: LiveBundleVerificationIssue[]
): void {
  if (stages.length === 0) return;

  if (semanticIds === null && stages[0] !== 'retrieval_planner') {
    addIssue(
      errors,
      'CALL_SEQUENCE_INVALID',
      'Planner-driven ERROR evidence must begin with retrieval_planner when successful calls exist',
      'manifest.json'
    );
  } else if (Array.isArray(semanticIds) && stages[0] !== 'compiler') {
    addIssue(
      errors,
      'CALL_SEQUENCE_INVALID',
      'Explicit semantic-id ERROR evidence must begin with compiler when successful calls exist',
      'manifest.json'
    );
  }

  const transitions: Record<string, Set<string>> = {
    retrieval_planner: new Set(['compiler']),
    compiler: new Set(['retrieval_planner', 'generator']),
    generator: new Set(['retrieval_planner', 'validator']),
    validator: new Set(['patcher']),
    patcher: new Set(['patcher']),
  };

  for (let index = 0; index < stages.length - 1; index += 1) {
    const current = stages[index] as string;
    const next = stages[index + 1] as string;
    const allowed = transitions[current];
    if (!allowed || !allowed.has(next)) {
      addIssue(
        errors,
        'CALL_SEQUENCE_INVALID',
        'Illegal ERROR call-history transition: ' + current + ' -> ' + next,
        'manifest.json'
      );
    }
  }
}

function validateSuccessfulCallSequence(
  status: string,
  stages: string[],
  semanticIds: unknown,
  errors: LiveBundleVerificationIssue[]
): void {
  if (stages.length === 0) return;

  if (semanticIds === null && stages[0] !== 'retrieval_planner') {
    addIssue(
      errors,
      'CALL_SEQUENCE_INVALID',
      'Planner-driven evidence must begin with retrieval_planner',
      'manifest.json'
    );
  } else if (Array.isArray(semanticIds) && stages[0] !== 'compiler') {
    addIssue(
      errors,
      'CALL_SEQUENCE_INVALID',
      'Explicit semantic-id evidence must begin with compiler',
      'manifest.json'
    );
  }

  const transitions: Record<string, Set<string>> = {
    retrieval_planner: new Set(['compiler']),
    compiler: new Set(['retrieval_planner', 'generator']),
    generator: new Set(['retrieval_planner', 'validator']),
    validator: new Set(['patcher']),
    patcher: new Set(['patcher']),
  };

  for (let index = 0; index < stages.length - 1; index += 1) {
    const current = stages[index] as string;
    const next = stages[index + 1] as string;
    const allowed = transitions[current];
    if (!allowed || !allowed.has(next)) {
      addIssue(
        errors,
        'CALL_SEQUENCE_INVALID',
        'Illegal live call transition: ' + current + ' -> ' + next,
        'manifest.json'
      );
    }
  }

  const last = stages[stages.length - 1];
  if (status === 'OUTPUT' && last !== 'validator' && last !== 'patcher') {
    addIssue(
      errors,
      'CALL_SEQUENCE_INVALID',
      'OUTPUT evidence must end with validator or patcher',
      'manifest.json'
    );
  }
  if (status === 'CONFLICT' && last !== 'compiler') {
    addIssue(
      errors,
      'CALL_SEQUENCE_INVALID',
      'CONFLICT evidence must end with compiler',
      'manifest.json'
    );
  }
  if (status === 'NEED_CONTEXT' && last !== 'retrieval_planner') {
    addIssue(
      errors,
      'CALL_SEQUENCE_INVALID',
      'NEED_CONTEXT evidence must end with retrieval_planner',
      'manifest.json'
    );
  }
}

function validateTraceRetrieval(
  value: unknown,
  errors: LiveBundleVerificationIssue[]
): void {
  if (!Array.isArray(value)) {
    addIssue(
      errors,
      'TRACE_RETRIEVAL_INVALID',
      'trace.retrieval must be an array',
      'trace.json'
    );
    return;
  }
  for (const raw of value) {
    const item = asRecord(raw);
    if (!item || !nonEmptyString(item.semantic_id) || !isSha256(item.content_hash)) {
      addIssue(
        errors,
        'TRACE_RETRIEVAL_INVALID',
        'trace.retrieval entries require a semantic_id and SHA-256 content_hash',
        'trace.json'
      );
    }
  }
}

function validateTraceMissing(
  value: unknown,
  errors: LiveBundleVerificationIssue[]
): void {
  if (!Array.isArray(value)) {
    addIssue(
      errors,
      'TRACE_GENERATOR_NEED_CONTEXT_INVALID',
      'trace.generator.need_context must be an array',
      'trace.json'
    );
    return;
  }
  for (const group of value) {
    if (!Array.isArray(group)) {
      addIssue(
        errors,
        'TRACE_GENERATOR_NEED_CONTEXT_INVALID',
        'Each need_context entry must be an array',
        'trace.json'
      );
      continue;
    }
    for (const raw of group) {
      const item = asRecord(raw);
      if (
        !item ||
        !nonEmptyString(item.type) ||
        !nonEmptyString(item.question) ||
        (hasOwn(item, 'subject') && !nonEmptyString(item.subject))
      ) {
        addIssue(
          errors,
          'TRACE_GENERATOR_NEED_CONTEXT_INVALID',
          'Generator missing-context entries require type/question and optional non-empty subject',
          'trace.json'
        );
      }
    }
  }
}

function validateTraceScope(
  value: unknown,
  errors: LiveBundleVerificationIssue[]
): void {
  const scope = asRecord(value);
  if (
    !scope ||
    !positiveSafeInteger(scope.paragraph) ||
    !Array.isArray(scope.sentences) ||
    scope.sentences.length !== 2 ||
    !positiveSafeInteger(scope.sentences[0]) ||
    !positiveSafeInteger(scope.sentences[1]) ||
    (scope.sentences[1] as number) < (scope.sentences[0] as number)
  ) {
    addIssue(
      errors,
      'TRACE_PATCH_SCOPE_INVALID',
      'trace.patcher.scopes contains an invalid patch scope',
      'trace.json'
    );
  }
}

async function verifyRepositoryBinding(
  repoRootInput: string,
  manifest: JsonRecord,
  runtimeContract: JsonRecord | null,
  manifestInput: JsonRecord | null,
  errors: LiveBundleVerificationIssue[]
): Promise<void> {
  const repoRoot = path.resolve(repoRootInput);
  if (!runtimeContract || !manifestInput) {
    addIssue(
      errors,
      'REPO_BINDING_UNAVAILABLE',
      'Repository-bound verification requires runtime_contract and manifest.input',
      'manifest.json'
    );
    return;
  }

  const currentCommit = await detectGitCommit(repoRoot, {
    useEnvironment: false,
  });
  if (!isCommitSha(currentCommit)) {
    addIssue(
      errors,
      'REPO_COMMIT_UNAVAILABLE',
      'Could not resolve the current repository commit',
      'manifest.json'
    );
  } else if (manifest.commit_sha !== currentCommit) {
    addIssue(
      errors,
      'REPO_COMMIT_MISMATCH',
      'manifest.commit_sha does not match the current repository commit',
      'manifest.json'
    );
  }

  const clean = await trackedGitWorktreeIsClean(repoRoot);
  if (clean === null) {
    addIssue(
      errors,
      'REPO_WORKTREE_STATUS_UNAVAILABLE',
      'Could not inspect tracked repository worktree state',
      'manifest.json'
    );
  } else if (!clean) {
    addIssue(
      errors,
      'REPO_WORKTREE_DIRTY',
      'Repository-bound verification requires no tracked working-tree changes',
      'manifest.json'
    );
  }

  try {
    const registryPath = path.join(repoRoot, 'SOURCE_REGISTRY.yaml');
    const registryText = await readFile(registryPath, 'utf8');
    if (runtimeContract.source_registry_hash !== stableHash(registryText)) {
      addIssue(
        errors,
        'REPO_REGISTRY_HASH_MISMATCH',
        'runtime_contract.source_registry_hash does not match SOURCE_REGISTRY.yaml',
        'manifest.json'
      );
    }

    const registry = await loadRegistry(registryPath);
    if (!Array.isArray(manifest.retrieval)) {
      addIssue(
        errors,
        'REPO_RETRIEVAL_BINDING_INVALID',
        'manifest.retrieval must be an array for repository-bound verification',
        'manifest.json'
      );
    } else {
      for (const raw of manifest.retrieval) {
        const item = asRecord(raw);
        if (!item || !nonEmptyString(item.semantic_id) || !isSha256(item.content_hash)) {
          continue;
        }
        const source = registry.sources[item.semantic_id];
        if (!source) {
          addIssue(
            errors,
            'REPO_RETRIEVAL_SOURCE_MISSING',
            'Retrieved semantic ID is absent from SOURCE_REGISTRY.yaml: ' + item.semantic_id,
            'manifest.json'
          );
          continue;
        }
        try {
          const sourcePath = await resolveRegisteredSourcePath(repoRoot, source.path);
          const content = await readFile(sourcePath, 'utf8');
          if (item.content_hash !== stableHash(content)) {
            addIssue(
              errors,
              'REPO_RETRIEVAL_HASH_MISMATCH',
              'Retrieved Canon content hash does not match current repository source: ' +
                item.semantic_id,
              'manifest.json'
            );
          }
        } catch (error) {
          addIssue(
            errors,
            'REPO_RETRIEVAL_SOURCE_UNREADABLE',
            'Cannot verify retrieved source ' +
              item.semantic_id +
              ': ' +
              errorMessage(error),
            'manifest.json'
          );
        }
      }
    }
  } catch (error) {
    addIssue(
      errors,
      'REPO_REGISTRY_UNREADABLE',
      'Cannot read or parse SOURCE_REGISTRY.yaml: ' + errorMessage(error),
      'manifest.json'
    );
  }

  const promptHashes = asRecord(runtimeContract.prompt_template_hashes);
  let expectedPromptHashes: Record<string, string> | null = null;
  try {
    expectedPromptHashes = {
      ...Object.fromEntries(
        Object.entries(MODEL_PROMPT_TEMPLATES).map(([stage, template]) => [
          stage,
          stableHash(template),
        ])
      ),
      runtime_adapter_source: stableHash(
        await readFile(
          path.join(repoRoot, 'runtime/adapters/model-backed.ts'),
          'utf8'
        )
      ),
    };
  } catch (error) {
    addIssue(
      errors,
      'REPO_PROMPT_SOURCE_UNREADABLE',
      'Cannot read executable prompt source: ' + errorMessage(error),
      'manifest.json'
    );
  }
  if (
    !promptHashes ||
    !expectedPromptHashes ||
    !isDeepStrictEqual(promptHashes, expectedPromptHashes)
  ) {
    addIssue(
      errors,
      'REPO_PROMPT_HASH_MISMATCH',
      'runtime_contract.prompt_template_hashes does not match executable prompt templates/source',
      'manifest.json'
    );
  }

  if (manifestInput.custom_system === false) {
    try {
      const system = await readFile(path.join(repoRoot, 'MODE-FICTION.md'), 'utf8');
      if (runtimeContract.system_hash !== stableHash(system)) {
        addIssue(
          errors,
          'REPO_SYSTEM_HASH_MISMATCH',
          'runtime_contract.system_hash does not match MODE-FICTION.md',
          'manifest.json'
        );
      }
    } catch (error) {
      addIssue(
        errors,
        'REPO_SYSTEM_UNREADABLE',
        'Cannot read MODE-FICTION.md: ' + errorMessage(error),
        'manifest.json'
      );
    }
  }
}

export async function verifyLiveFictionBundle(
  runDirInput: string,
  options: VerifyLiveBundleOptions = {}
): Promise<LiveBundleVerificationReport> {
  const runDir = path.resolve(runDirInput);
  const errors: LiveBundleVerificationIssue[] = [];
  const verifiedArtifacts: string[] = [];

  let entries;
  try {
    entries = await readdir(runDir, { withFileTypes: true });
  } catch (error) {
    addIssue(
      errors,
      'RUN_DIR_UNREADABLE',
      'Cannot read run directory: ' + errorMessage(error)
    );
    return {
      version: '1.0',
      run_dir: runDir,
      ok: false,
      bundle_id: null,
      manifest_version: null,
      status: null,
      verified_artifacts: [],
      errors,
    };
  }

  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  if (!entryMap.has('manifest.json')) {
    addIssue(errors, 'MANIFEST_MISSING', 'manifest.json is missing', 'manifest.json');
    return {
      version: '1.0',
      run_dir: runDir,
      ok: false,
      bundle_id: null,
      manifest_version: null,
      status: null,
      verified_artifacts: [],
      errors,
    };
  }

  const manifestValue = await readJsonArtifact(runDir, 'manifest.json', errors);
  const manifest = asRecord(manifestValue);
  if (!manifest) {
    addIssue(errors, 'MANIFEST_INVALID', 'manifest.json must contain a JSON object', 'manifest.json');
    return {
      version: '1.0',
      run_dir: runDir,
      ok: false,
      bundle_id: null,
      manifest_version: null,
      status: null,
      verified_artifacts: [],
      errors,
    };
  }

  const manifestVersion =
    typeof manifest.version === 'string' ? manifest.version : null;
  const status = typeof manifest.status === 'string' ? manifest.status : null;
  const bundleId =
    typeof manifest.bundle_id === 'string' ? manifest.bundle_id : null;

  if (manifestVersion !== '0.9') {
    addIssue(
      errors,
      'MANIFEST_VERSION_UNSUPPORTED',
      'Expected live manifest version 0.9, got ' + String(manifest.version),
      'manifest.json'
    );
  }

  if (!isUuid(manifest.bundle_id)) {
    addIssue(
      errors,
      'BUNDLE_ID_INVALID',
      'manifest.bundle_id must be a UUID generated for this execution',
      'manifest.json'
    );
  }

  if (!isCommitSha(manifest.commit_sha)) {
    addIssue(
      errors,
      'COMMIT_SHA_INVALID',
      'manifest.commit_sha must be a concrete Git commit SHA',
      'manifest.json'
    );
  }

  if (status !== 'ERROR' && !isUuid(manifest.runtime_run_id)) {
    addIssue(
      errors,
      'RUNTIME_RUN_ID_INVALID',
      'Non-error manifests must contain a runtime UUID',
      'manifest.json'
    );
  }
  if (status === 'ERROR' && manifest.runtime_run_id !== null) {
    addIssue(
      errors,
      'RUNTIME_RUN_ID_INVALID',
      'ERROR manifests must have runtime_run_id: null',
      'manifest.json'
    );
  }

  const expected = status ? expectedArtifacts(status) : null;
  if (!expected) {
    addIssue(
      errors,
      'STATUS_INVALID',
      'Unsupported or missing manifest status: ' + String(manifest.status),
      'manifest.json'
    );
  }

  const artifactsRecord = asRecord(manifest.artifacts);
  const artifactMetadata = new Map<
    string,
    { sha256: string; bytes: number; file: string }
  >();

  if (!artifactsRecord) {
    addIssue(
      errors,
      'ARTIFACTS_INVALID',
      'manifest.artifacts must be an object',
      'manifest.json'
    );
  } else {
    for (const [name, rawMetadata] of Object.entries(artifactsRecord)) {
      if (!safeArtifactName(name) || name === 'manifest.json') {
        addIssue(
          errors,
          'ARTIFACT_NAME_INVALID',
          'Artifact keys must be safe top-level filenames and may not be manifest.json',
          'manifest.json'
        );
        continue;
      }
      const metadata = asRecord(rawMetadata);
      if (!metadata) {
        addIssue(
          errors,
          'ARTIFACT_METADATA_INVALID',
          'Artifact metadata must be an object',
          name
        );
        continue;
      }
      const file = typeof metadata.file === 'string' ? metadata.file : '';
      const sha256 = typeof metadata.sha256 === 'string' ? metadata.sha256 : '';
      const bytes = typeof metadata.bytes === 'number' ? metadata.bytes : -1;

      if (file !== name) {
        addIssue(
          errors,
          'ARTIFACT_FILE_MISMATCH',
          'Artifact metadata file field must equal its key',
          name
        );
      }
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        addIssue(
          errors,
          'ARTIFACT_HASH_INVALID',
          'Artifact SHA-256 must be 64 lowercase hex characters',
          name
        );
      }
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        addIssue(
          errors,
          'ARTIFACT_SIZE_INVALID',
          'Artifact byte count must be a non-negative safe integer',
          name
        );
      }
      if (
        file === name &&
        /^[0-9a-f]{64}$/.test(sha256) &&
        Number.isSafeInteger(bytes) &&
        bytes >= 0
      ) {
        artifactMetadata.set(name, { file, sha256, bytes });
      }
    }
  }

  if (expected) {
    const expectedSet = new Set(expected);
    for (const file of expected) {
      if (!artifactMetadata.has(file)) {
        addIssue(
          errors,
          'REQUIRED_ARTIFACT_MISSING',
          'Required artifact is not tracked for status ' + status,
          file
        );
      }
    }
    for (const file of artifactMetadata.keys()) {
      if (!expectedSet.has(file)) {
        addIssue(
          errors,
          'TRACKED_ARTIFACT_UNEXPECTED',
          'Artifact is not allowed for status ' + status,
          file
        );
      }
    }
  }

  const allowedNames = new Set(['manifest.json', ...artifactMetadata.keys()]);
  for (const entry of entries) {
    if (!allowedNames.has(entry.name)) {
      addIssue(
        errors,
        'UNTRACKED_ENTRY',
        'Run directory contains an entry not covered by manifest.artifacts',
        entry.name
      );
    } else if (!entry.isFile()) {
      addIssue(
        errors,
        'NON_FILE_ENTRY',
        'Evidence bundle entries must be regular files',
        entry.name
      );
    }
  }

  for (const [name, metadata] of artifactMetadata) {
    const entry = entryMap.get(name);
    if (!entry) {
      addIssue(
        errors,
        'ARTIFACT_MISSING',
        'Artifact is tracked by the manifest but missing from the run directory',
        name
      );
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const content = await readFile(path.join(runDir, name));
      let valid = true;
      if (content.byteLength !== metadata.bytes) {
        valid = false;
        addIssue(
          errors,
          'ARTIFACT_SIZE_MISMATCH',
          'Expected ' + metadata.bytes + ' bytes, got ' + content.byteLength,
          name
        );
      }
      const actualHash = sha256Bytes(content);
      if (actualHash !== metadata.sha256) {
        valid = false;
        addIssue(
          errors,
          'ARTIFACT_HASH_MISMATCH',
          'Artifact SHA-256 does not match manifest',
          name
        );
      }
      if (valid) verifiedArtifacts.push(name);
    } catch (error) {
      addIssue(
        errors,
        'ARTIFACT_UNREADABLE',
        'Cannot read artifact: ' + errorMessage(error),
        name
      );
    }
  }

  const runtimeContract = asRecord(manifest.runtime_contract);
  if (status && status !== 'ERROR' && !runtimeContract) {
    addIssue(
      errors,
      'RUNTIME_CONTRACT_INVALID',
      'Non-error manifest.runtime_contract must be an object',
      'manifest.json'
    );
  } else if (status && status !== 'ERROR' && runtimeContract) {
    if (!isSha256(runtimeContract.system_hash)) {
      addIssue(
        errors,
        'RUNTIME_SYSTEM_HASH_INVALID',
        'runtime_contract.system_hash must be a SHA-256 value',
        'manifest.json'
      );
    }
    if (!isSha256(runtimeContract.source_registry_hash)) {
      addIssue(
        errors,
        'RUNTIME_REGISTRY_HASH_INVALID',
        'runtime_contract.source_registry_hash must be a SHA-256 value',
        'manifest.json'
      );
    }
    const promptHashes = asRecord(runtimeContract.prompt_template_hashes);
    if (!promptHashes) {
      addIssue(
        errors,
        'RUNTIME_PROMPT_HASHES_INVALID',
        'runtime_contract.prompt_template_hashes must be an object',
        'manifest.json'
      );
    } else {
      for (const stage of LIVE_STAGES) {
        if (!isSha256(promptHashes[stage])) {
          addIssue(
            errors,
            'RUNTIME_PROMPT_HASHES_INVALID',
            'Missing or invalid prompt-template hash for ' + stage,
            'manifest.json'
          );
        }
      }
      if (
        hasOwn(promptHashes, 'runtime_adapter_source') &&
        !isSha256(promptHashes.runtime_adapter_source)
      ) {
        addIssue(
          errors,
          'RUNTIME_PROMPT_HASHES_INVALID',
          'runtime_adapter_source must be a SHA-256 value when present',
          'manifest.json'
        );
      }
    }
  }

  const manifestInput = asRecord(manifest.input);
  const inputValue = artifactMetadata.has('input.json')
    ? await readJsonArtifact(runDir, 'input.json', errors)
    : null;
  const input = asRecord(inputValue);
  if (input && manifestInput) {
    if (
      typeof input.request !== 'string' ||
      stableHash(input.request) !== manifestInput.request_hash
    ) {
      addIssue(
        errors,
        'INPUT_REQUEST_HASH_MISMATCH',
        'input.request does not match manifest.input.request_hash',
        'input.json'
      );
    }
    if (
      !hasOwn(input, 'scene_state') ||
      stableHash(input.scene_state) !== manifestInput.scene_state_hash
    ) {
      addIssue(
        errors,
        'INPUT_SCENE_HASH_MISMATCH',
        'input.scene_state does not match manifest.input.scene_state_hash',
        'input.json'
      );
    }
    if (!isDeepStrictEqual(input.semantic_ids, manifestInput.semantic_ids)) {
      addIssue(
        errors,
        'INPUT_SEMANTIC_IDS_MISMATCH',
        'input.semantic_ids does not match manifest.input.semantic_ids',
        'input.json'
      );
    }
    if (input.max_context_rounds !== manifestInput.max_context_rounds) {
      addIssue(
        errors,
        'INPUT_CONTEXT_ROUNDS_MISMATCH',
        'input.max_context_rounds does not match manifest',
        'input.json'
      );
    }
    const customSystem = hasOwn(input, 'system_override');
    if (customSystem !== manifestInput.custom_system) {
      addIssue(
        errors,
        'INPUT_SYSTEM_FLAG_MISMATCH',
        'system_override presence does not match manifest.input.custom_system',
        'input.json'
      );
    }


    if (status && status !== 'ERROR') {
      if (typeof input.request !== 'string' || input.request.trim().length === 0) {
        addIssue(
          errors,
          'INPUT_REQUEST_INVALID',
          'Successful input.request must be a non-empty string',
          'input.json'
        );
      }

      if (
        !Number.isSafeInteger(input.max_context_rounds) ||
        (input.max_context_rounds as number) < 1
      ) {
        addIssue(
          errors,
          'INPUT_CONTEXT_ROUNDS_INVALID',
          'Successful input.max_context_rounds must be a positive safe integer',
          'input.json'
        );
      }

      const semanticIds = input.semantic_ids;
      if (
        semanticIds !== null &&
        (!Array.isArray(semanticIds) ||
          semanticIds.some(
            (item) => typeof item !== 'string' || item.trim().length === 0
          ))
      ) {
        addIssue(
          errors,
          'INPUT_SEMANTIC_IDS_INVALID',
          'Successful input.semantic_ids must be null or an array of non-empty strings',
          'input.json'
        );
      }

      if (!asRecord(input.scene_state)) {
        addIssue(
          errors,
          'INPUT_SCENE_STATE_INVALID',
          'Successful input.scene_state must be a JSON object',
          'input.json'
        );
      }

      if (
        customSystem &&
        (typeof input.system_override !== 'string' ||
          input.system_override.trim().length === 0 ||
          !runtimeContract ||
          runtimeContract.system_hash !== stableHash(input.system_override))
      ) {
        addIssue(
          errors,
          'INPUT_SYSTEM_HASH_MISMATCH',
          'system_override content does not match runtime_contract.system_hash',
          'input.json'
        );
      }
    }
  } else if (artifactMetadata.has('input.json')) {
    addIssue(
      errors,
      'INPUT_STRUCTURE_INVALID',
      'input.json and manifest.input must both be JSON objects',
      'input.json'
    );
  }

  if (
    options.repoRoot &&
    status &&
    status !== 'ERROR'
  ) {
    await verifyRepositoryBinding(
      options.repoRoot,
      manifest,
      runtimeContract,
      manifestInput,
      errors
    );
  }

  const manifestCalls = Array.isArray(manifest.calls) ? manifest.calls : null;
  const callsValue = artifactMetadata.has('calls.json')
    ? await readJsonArtifact(runDir, 'calls.json', errors)
    : null;
  if (!manifestCalls || !Array.isArray(callsValue)) {
    if (artifactMetadata.has('calls.json')) {
      addIssue(
        errors,
        'CALLS_STRUCTURE_INVALID',
        'calls.json and manifest.calls must both be arrays',
        'calls.json'
      );
    }
  } else if (!isDeepStrictEqual(callsValue, manifestCalls)) {
    addIssue(
      errors,
      'CALLS_MANIFEST_MISMATCH',
      'calls.json does not exactly match manifest.calls',
      'calls.json'
    );
  }

  const stageModels = asRecord(manifest.stage_models);
  if (!stageModels) {
    addIssue(
      errors,
      'STAGE_MODELS_INVALID',
      'manifest.stage_models must be an object',
      'manifest.json'
    );
  } else {
    for (const [stage, rawDescriptor] of Object.entries(stageModels)) {
      if (!LIVE_STAGES.has(stage)) {
        addIssue(
          errors,
          'STAGE_MODEL_STAGE_INVALID',
          'Unknown live stage model descriptor: ' + stage,
          'manifest.json'
        );
        continue;
      }
      const descriptor = asRecord(rawDescriptor);
      if (
        !descriptor ||
        !LIVE_PROVIDERS.has(String(descriptor.provider)) ||
        !nonEmptyString(descriptor.model) ||
        !asRecord(descriptor.defaults)
      ) {
        addIssue(
          errors,
          'STAGE_MODEL_DESCRIPTOR_INVALID',
          'Stage model descriptors require provider, non-empty model, and defaults object',
          'manifest.json'
        );
      }
      if (descriptor) {
        validateModelDefaults(descriptor.defaults, errors, stage);
        const hasEndpointKind = hasOwn(descriptor, 'endpoint_kind');
        const hasEndpointHash = hasOwn(descriptor, 'endpoint_hash');
        if (hasEndpointKind !== hasEndpointHash) {
          addIssue(
            errors,
            'STAGE_MODEL_ENDPOINT_INVALID',
            'Stage endpoint_kind and endpoint_hash must be recorded together',
            'manifest.json'
          );
        } else if (hasEndpointKind) {
          if (
            descriptor.endpoint_kind !== 'official' &&
            descriptor.endpoint_kind !== 'custom'
          ) {
            addIssue(
              errors,
              'STAGE_MODEL_ENDPOINT_INVALID',
              'Stage endpoint_kind must be official or custom',
              'manifest.json'
            );
          }
          if (!isSha256(descriptor.endpoint_hash)) {
            addIssue(
              errors,
              'STAGE_MODEL_ENDPOINT_INVALID',
              'Stage endpoint_hash must be a SHA-256 value',
              'manifest.json'
            );
          } else if (LIVE_PROVIDERS.has(String(descriptor.provider))) {
            const officialHash = officialModelEndpointHash(
              descriptor.provider as 'openai' | 'gemini' | 'anthropic'
            );
            if (
              descriptor.endpoint_kind === 'official' &&
              descriptor.endpoint_hash !== officialHash
            ) {
              addIssue(
                errors,
                'STAGE_MODEL_ENDPOINT_INVALID',
                'Official endpoint hash does not match the provider runtime contract',
                'manifest.json'
              );
            }
            if (
              descriptor.endpoint_kind === 'custom' &&
              descriptor.endpoint_hash === officialHash
            ) {
              addIssue(
                errors,
                'STAGE_MODEL_ENDPOINT_INVALID',
                'Custom endpoint metadata resolves to the official provider endpoint',
                'manifest.json'
              );
            }
          }
        }
      }
    }

    if (status && status !== 'ERROR') {
      for (const stage of LIVE_STAGES) {
        if (!hasOwn(stageModels, stage)) {
          addIssue(
            errors,
            'STAGE_MODEL_MISSING',
            'Non-error manifest is missing stage model descriptor ' + stage,
            'manifest.json'
          );
        }
      }
    }
  }

  const callStageCounts = new Map<string, number>();
  const callStages: string[] = [];
  if (manifestCalls) {
    for (const rawCall of manifestCalls) {
      const call = asRecord(rawCall);
      if (!call || typeof call.stage !== 'string') {
        addIssue(
          errors,
          'CALL_STRUCTURE_INVALID',
          'Each manifest call must be an object with a stage',
          'manifest.json'
        );
        continue;
      }

      callStageCounts.set(call.stage, (callStageCounts.get(call.stage) ?? 0) + 1);
      callStages.push(call.stage);

      if (!LIVE_STAGES.has(call.stage)) {
        addIssue(
          errors,
          'CALL_STAGE_INVALID',
          'Live evidence contains an unknown model-call stage: ' + call.stage,
          'manifest.json'
        );
      }
      if (!LIVE_PROVIDERS.has(String(call.provider))) {
        addIssue(
          errors,
          'CALL_PROVIDER_INVALID',
          'Call provider must be openai, gemini, or anthropic',
          'manifest.json'
        );
      }
      if (!nonEmptyString(call.model)) {
        addIssue(
          errors,
          'CALL_MODEL_INVALID',
          'Call model must be a non-empty string',
          'manifest.json'
        );
      }
      if (!isSha256(call.request_hash) || !isSha256(call.response_hash)) {
        addIssue(
          errors,
          'CALL_HASH_INVALID',
          'Call request_hash and response_hash must be SHA-256 values',
          'manifest.json'
        );
      }
      if (call.response_format !== 'text' && call.response_format !== 'json') {
        addIssue(
          errors,
          'CALL_RESPONSE_FORMAT_INVALID',
          'Call response_format must be text or json',
          'manifest.json'
        );
      }
      if (
        typeof call.latency_ms !== 'number' ||
        !Number.isFinite(call.latency_ms) ||
        call.latency_ms < 0
      ) {
        addIssue(
          errors,
          'CALL_LATENCY_INVALID',
          'Call latency_ms must be a non-negative finite number',
          'manifest.json'
        );
      }
      if (
        !hasOwn(call, 'request_id') ||
        (call.request_id !== null && !nonEmptyString(call.request_id))
      ) {
        addIssue(
          errors,
          'CALL_REQUEST_ID_INVALID',
          'Call request_id must be null or a non-empty string',
          'manifest.json'
        );
      }
      if (
        hasOwn(call, 'response_id') &&
        call.response_id !== null &&
        !nonEmptyString(call.response_id)
      ) {
        addIssue(
          errors,
          'CALL_RESPONSE_ID_INVALID',
          'Call response_id must be null or a non-empty string when present',
          'manifest.json'
        );
      }
      validateUsage(call.usage, errors);
      validateSettings(call.settings, errors);

      const descriptor = stageModels ? asRecord(stageModels[call.stage]) : null;
      if (stageModels && !descriptor) {
        addIssue(
          errors,
          'CALL_STAGE_MODEL_MISSING',
          'No stage model descriptor for call stage ' + call.stage,
          'manifest.json'
        );
      } else if (descriptor && call.provider !== descriptor.provider) {
        addIssue(
          errors,
          'CALL_STAGE_PROVIDER_MISMATCH',
          'Call provider differs from the stage model descriptor',
          'manifest.json'
        );
      }

      if (descriptor) {
        if (hasOwn(call, 'requested_model')) {
          if (
            !nonEmptyString(call.requested_model) ||
            call.requested_model !== descriptor.model
          ) {
            addIssue(
              errors,
              'CALL_REQUESTED_MODEL_MISMATCH',
              'Call requested_model differs from the configured stage model',
              'manifest.json'
            );
          }
        } else if (call.model !== descriptor.model) {
          addIssue(
            errors,
            'CALL_STAGE_MODEL_MISMATCH',
            'Legacy call model differs from the configured stage model',
            'manifest.json'
          );
        }
      }

      if (descriptor) {
        const defaults = asRecord(descriptor.defaults);
        const settings = asRecord(call.settings);
        if (
          defaults &&
          settings &&
          !isDeepStrictEqual(settings, settingsFromDefaults(defaults))
        ) {
          addIssue(
            errors,
            'CALL_SETTINGS_STAGE_DEFAULTS_MISMATCH',
            'Call settings do not match the configured stage model defaults',
            'manifest.json'
          );
        }
      }
    }

    if (status && status !== 'ERROR' && manifestCalls.length === 0) {
      addIssue(
        errors,
        'CALL_EVIDENCE_MISSING',
        'Non-error live evidence must contain model-call records',
        'manifest.json'
      );
    }
    if (status && status !== 'ERROR') {
      if ((callStageCounts.get('compiler') ?? 0) < 1) {
        addIssue(
          errors,
          'CALL_STAGE_REQUIRED',
          status + ' evidence requires at least one compiler call',
          'manifest.json'
        );
      }
    }
    if (status === 'OUTPUT') {
      for (const stage of ['generator', 'validator']) {
        if ((callStageCounts.get(stage) ?? 0) < 1) {
          addIssue(
            errors,
            'CALL_STAGE_REQUIRED',
            'OUTPUT evidence requires at least one ' + stage + ' call',
            'manifest.json'
          );
        }
      }
    }

    if (status === 'ERROR') {
      validateErrorCallPrefix(
        callStages,
        manifestInput?.semantic_ids,
        errors
      );
    }

    if (status && status !== 'ERROR') {
      validateSuccessfulCallSequence(
        status,
        callStages,
        manifestInput?.semantic_ids,
        errors
      );

      const validatorCount = callStageCounts.get('validator') ?? 0;
      const patcherCount = callStageCounts.get('patcher') ?? 0;
      if (status === 'OUTPUT' && validatorCount !== 1) {
        addIssue(
          errors,
          'CALL_STAGE_COUNT_INVALID',
          'OUTPUT evidence requires exactly one validator call',
          'manifest.json'
        );
      }
      if (
        (status === 'NEED_CONTEXT' || status === 'CONFLICT') &&
        (validatorCount !== 0 || patcherCount !== 0)
      ) {
        addIssue(
          errors,
          'CALL_STAGE_FORBIDDEN',
          status + ' evidence may not contain validator or patcher calls',
          'manifest.json'
        );
      }
    }
  }

  if (status === 'ERROR') {
    const failureRecord = asRecord(manifest.failure);
    if (!failureRecord) {
      addIssue(
        errors,
        'FAILURE_MISSING',
        'ERROR manifest must contain structured failure metadata',
        'manifest.json'
      );
    } else {
      const keys = Object.keys(failureRecord).sort();
      if (
        !isDeepStrictEqual(keys, ['message', 'name']) ||
        !nonEmptyString(failureRecord.name) ||
        typeof failureRecord.message !== 'string'
      ) {
        addIssue(
          errors,
          'FAILURE_INVALID',
          'ERROR failure metadata must contain exactly non-empty name and string message',
          'manifest.json'
        );
      }
    }
    const failureValue = artifactMetadata.has('failure.json')
      ? await readJsonArtifact(runDir, 'failure.json', errors)
      : null;
    if (
      failureValue !== null &&
      !isDeepStrictEqual(failureValue, manifest.failure)
    ) {
      addIssue(
        errors,
        'FAILURE_MANIFEST_MISMATCH',
        'failure.json does not exactly match manifest.failure',
        'failure.json'
      );
    }
  } else if (status) {
    if (manifest.failure !== null) {
      addIssue(
        errors,
        'FAILURE_UNEXPECTED',
        'Non-error manifest must have failure: null',
        'manifest.json'
      );
    }

    const traceValue = artifactMetadata.has('trace.json')
      ? await readJsonArtifact(runDir, 'trace.json', errors)
      : null;
    const trace = asRecord(traceValue);
    if (trace) {
      if (trace.version !== '0.5') {
        addIssue(
          errors,
          'TRACE_VERSION_INVALID',
          'trace.version must be 0.5',
          'trace.json'
        );
      }
      validateTraceRetrieval(trace.retrieval, errors);

      if (trace.run_id !== manifest.runtime_run_id) {
        addIssue(
          errors,
          'TRACE_RUN_ID_MISMATCH',
          'trace.run_id does not match manifest.runtime_run_id',
          'trace.json'
        );
      }
      if (!isDeepStrictEqual(trace.retrieval, manifest.retrieval)) {
        addIssue(
          errors,
          'TRACE_RETRIEVAL_MISMATCH',
          'trace.retrieval does not match manifest.retrieval',
          'trace.json'
        );
      }

      const compilerTrace = asRecord(trace.compiler);
      if (
        !compilerTrace ||
        !Array.isArray(compilerTrace.active_context_hashes) ||
        !Array.isArray(compilerTrace.provenance)
      ) {
        addIssue(
          errors,
          'TRACE_COMPILER_INVALID',
          'trace.compiler must contain active_context_hashes and provenance arrays',
          'trace.json'
        );
      } else {
        if (compilerTrace.active_context_hashes.some((hash) => !isSha256(hash))) {
          addIssue(
            errors,
            'TRACE_COMPILER_HASH_INVALID',
            'trace.compiler.active_context_hashes must contain SHA-256 values',
            'trace.json'
          );
        }
        if (compilerTrace.provenance.some((item) => asRecord(item) === null)) {
          addIssue(
            errors,
            'TRACE_COMPILER_PROVENANCE_INVALID',
            'trace.compiler.provenance must contain objects',
            'trace.json'
          );
        }
      }

      const generatorTrace = asRecord(trace.generator);
      let generatorCount: unknown = null;
      if (!generatorTrace) {
        addIssue(
          errors,
          'TRACE_GENERATOR_INVALID',
          'trace.generator must be an object',
          'trace.json'
        );
      } else {
        generatorCount = generatorTrace.call_count;
        if (
          !Number.isSafeInteger(generatorCount) ||
          (generatorCount as number) < 0
        ) {
          addIssue(
            errors,
            'TRACE_GENERATOR_CALL_COUNT_INVALID',
            'trace.generator.call_count must be a non-negative safe integer',
            'trace.json'
          );
        } else if (
          manifestCalls &&
          generatorCount !== (callStageCounts.get('generator') ?? 0)
        ) {
          addIssue(
            errors,
            'TRACE_GENERATOR_CALL_COUNT_MISMATCH',
            'trace.generator.call_count does not match generator call evidence',
            'trace.json'
          );
        }

        if (!Array.isArray(generatorTrace.payload_hashes)) {
          addIssue(
            errors,
            'TRACE_GENERATOR_PAYLOAD_INVALID',
            'trace.generator.payload_hashes must be an array',
            'trace.json'
          );
        } else {
          if (generatorTrace.payload_hashes.some((hash) => !isSha256(hash))) {
            addIssue(
              errors,
              'TRACE_GENERATOR_PAYLOAD_INVALID',
              'trace.generator.payload_hashes must contain SHA-256 values',
              'trace.json'
            );
          }
          if (
            Number.isSafeInteger(generatorCount) &&
            generatorTrace.payload_hashes.length !== generatorCount
          ) {
            addIssue(
              errors,
              'TRACE_GENERATOR_PAYLOAD_COUNT_MISMATCH',
              'trace.generator.payload_hashes length does not match call_count',
              'trace.json'
            );
          }
        }
        validateTraceMissing(generatorTrace.need_context, errors);
      }

      if (
        compilerTrace &&
        Array.isArray(compilerTrace.active_context_hashes) &&
        Array.isArray(compilerTrace.provenance) &&
        Number.isSafeInteger(generatorCount)
      ) {
        if (
          compilerTrace.active_context_hashes.length !== generatorCount ||
          compilerTrace.provenance.length !== generatorCount
        ) {
          addIssue(
            errors,
            'TRACE_COMPILER_READY_COUNT_MISMATCH',
            'Each READY compiler result must correspond to one generator call',
            'trace.json'
          );
        }
      }

      const validatorTrace = asRecord(trace.validator);
      const validatorViolations =
        validatorTrace && Array.isArray(validatorTrace.violations)
          ? validatorTrace.violations
          : null;
      if (!validatorViolations) {
        addIssue(
          errors,
          'TRACE_VALIDATOR_INVALID',
          'trace.validator.violations must be an array',
          'trace.json'
        );
      } else {
        for (const rawViolation of validatorViolations) {
          const violation = asRecord(rawViolation);
          if (
            !violation ||
            !nonEmptyString(violation.id) ||
            (violation.severity !== 'hard' && violation.severity !== 'soft') ||
            !Array.isArray(violation.evidence_refs) ||
            violation.evidence_refs.some((ref) => typeof ref !== 'string')
          ) {
            addIssue(
              errors,
              'TRACE_VALIDATOR_INVALID',
              'trace.validator.violations contains an invalid entry',
              'trace.json'
            );
          }
        }
      }

      const patcherTrace = asRecord(trace.patcher);
      const patchScopes =
        patcherTrace && Array.isArray(patcherTrace.scopes)
          ? patcherTrace.scopes
          : null;
      if (!patchScopes) {
        addIssue(
          errors,
          'TRACE_PATCHER_INVALID',
          'trace.patcher.scopes must be an array',
          'trace.json'
        );
      } else {
        for (const scope of patchScopes) {
          validateTraceScope(scope, errors);
        }
        if (
          manifestCalls &&
          patchScopes.length !== (callStageCounts.get('patcher') ?? 0)
        ) {
          addIssue(
            errors,
            'TRACE_PATCHER_CALL_COUNT_MISMATCH',
            'trace.patcher.scopes length does not match patcher call evidence',
            'trace.json'
          );
        }
        if (
          validatorViolations &&
          patchScopes.length !== validatorViolations.length
        ) {
          addIssue(
            errors,
            'TRACE_PATCHER_VIOLATION_COUNT_MISMATCH',
            'Each validator violation must correspond to exactly one patch scope',
            'trace.json'
          );
        }
      }

      if (
        (status === 'NEED_CONTEXT' || status === 'CONFLICT') &&
        ((validatorViolations?.length ?? 0) !== 0 ||
          (patchScopes?.length ?? 0) !== 0)
      ) {
        addIssue(
          errors,
          'TRACE_STATUS_CAUSALITY_INVALID',
          status + ' trace may not contain validation or patch activity',
          'trace.json'
        );
      }
    } else if (artifactMetadata.has('trace.json')) {
      addIssue(
        errors,
        'TRACE_STRUCTURE_INVALID',
        'trace.json must contain a JSON object',
        'trace.json'
      );
    }

    const resultValue = artifactMetadata.has('result.json')
      ? await readJsonArtifact(runDir, 'result.json', errors)
      : null;
    const result = asRecord(resultValue);
    if (result) {
      if (result.status !== status) {
        addIssue(
          errors,
          'RESULT_STATUS_MISMATCH',
          'result.status does not match manifest.status',
          'result.json'
        );
      }
      if (status === 'OUTPUT' && artifactMetadata.has('output.md')) {
        try {
          const output = await readFile(path.join(runDir, 'output.md'), 'utf8');
          if (!output.endsWith('\n')) {
            addIssue(
              errors,
              'OUTPUT_TERMINATOR_MISSING',
              'output.md must contain the writer-added terminal newline',
              'output.md'
            );
          } else {
            const runtimeOutput = output.slice(0, -1);
            if (result.output_hash !== stableHash(runtimeOutput)) {
              addIssue(
                errors,
                'OUTPUT_RESULT_HASH_MISMATCH',
                'output.md content does not match result.output_hash',
                'output.md'
              );
            }
          }
        } catch (error) {
          addIssue(
            errors,
            'OUTPUT_UNREADABLE',
            'Cannot read output.md: ' + errorMessage(error),
            'output.md'
          );
        }
      }
    } else if (artifactMetadata.has('result.json')) {
      addIssue(
        errors,
        'RESULT_STRUCTURE_INVALID',
        'result.json must contain a JSON object',
        'result.json'
      );
    }
  }

  verifiedArtifacts.sort();
  return {
    version: '1.0',
    run_dir: runDir,
    ok: errors.length === 0,
    bundle_id: bundleId,
    manifest_version: manifestVersion,
    status,
    verified_artifacts: verifiedArtifacts,
    errors,
  };
}
