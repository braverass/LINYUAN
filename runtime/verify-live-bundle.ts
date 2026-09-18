import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

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

const LIVE_CALL_STAGES = new Set([
  'retrieval_planner',
  'compiler',
  'generator',
  'validator',
  'patcher',
]);

const LIVE_PROVIDERS = new Set(['openai', 'gemini', 'anthropic']);

function validProviderId(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function validSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validNullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
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

export async function verifyLiveFictionBundle(
  runDirInput: string
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
    if (!entry || !entry.isFile()) continue;
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
  } else if (artifactMetadata.has('input.json')) {
    addIssue(
      errors,
      'INPUT_STRUCTURE_INVALID',
      'input.json and manifest.input must both be JSON objects',
      'input.json'
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
  }

  if (manifestCalls && stageModels) {
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
      if (!LIVE_CALL_STAGES.has(call.stage)) {
        addIssue(
          errors,
          'CALL_STAGE_INVALID',
          'Call stage is not valid for live fiction evidence: ' + call.stage,
          'manifest.json'
        );
      }
      if (
        !hasOwn(call, 'request_id') ||
        !validProviderId(call.request_id)
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
        !validProviderId(call.response_id)
      ) {
        addIssue(
          errors,
          'CALL_RESPONSE_ID_INVALID',
          'Call response_id must be null or a non-empty string when present',
          'manifest.json'
        );
      }

      if (
        typeof call.provider !== 'string' ||
        !LIVE_PROVIDERS.has(call.provider)
      ) {
        addIssue(
          errors,
          'CALL_PROVIDER_INVALID',
          'Call provider must be openai, gemini, or anthropic',
          'manifest.json'
        );
      }
      if (typeof call.model !== 'string' || call.model.trim().length === 0) {
        addIssue(
          errors,
          'CALL_MODEL_INVALID',
          'Call model must be a non-empty string',
          'manifest.json'
        );
      }
      if (!validSha256(call.request_hash)) {
        addIssue(
          errors,
          'CALL_REQUEST_HASH_INVALID',
          'Call request_hash must be a lowercase SHA-256 digest',
          'manifest.json'
        );
      }
      if (!validSha256(call.response_hash)) {
        addIssue(
          errors,
          'CALL_RESPONSE_HASH_INVALID',
          'Call response_hash must be a lowercase SHA-256 digest',
          'manifest.json'
        );
      }
      if (
        call.response_format !== 'json' &&
        call.response_format !== 'text'
      ) {
        addIssue(
          errors,
          'CALL_RESPONSE_FORMAT_INVALID',
          'Call response_format must be json or text',
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

      if (call.usage !== null) {
        const usage = asRecord(call.usage);
        if (!usage) {
          addIssue(
            errors,
            'CALL_USAGE_INVALID',
            'Call usage must be null or an object',
            'manifest.json'
          );
        } else {
          for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
            if (hasOwn(usage, key) && !validNonNegativeInteger(usage[key])) {
              addIssue(
                errors,
                'CALL_USAGE_INVALID',
                'Call usage token counts must be non-negative safe integers',
                'manifest.json'
              );
              break;
            }
          }
        }
      }

      const settings = asRecord(call.settings);
      if (!settings) {
        addIssue(
          errors,
          'CALL_SETTINGS_INVALID',
          'Call settings must be an object',
          'manifest.json'
        );
      } else {
        for (const key of [
          'temperature',
          'top_p',
          'max_output_tokens',
          'seed',
        ]) {
          if (
            !hasOwn(settings, key) ||
            !validNullableFiniteNumber(settings[key])
          ) {
            addIssue(
              errors,
              'CALL_SETTINGS_INVALID',
              'Call settings must contain finite numbers or null for all recorded settings',
              'manifest.json'
            );
            break;
          }
        }
      }

      const descriptor = asRecord(stageModels[call.stage]);
      if (!descriptor) {
        addIssue(
          errors,
          'CALL_STAGE_MODEL_MISSING',
          'No stage model descriptor for call stage ' + call.stage,
          'manifest.json'
        );
        continue;
      }
      if (
        call.provider !== descriptor.provider ||
        call.model !== descriptor.model
      ) {
        addIssue(
          errors,
          'CALL_STAGE_MODEL_MISMATCH',
          'Call provider/model differs from the stage model descriptor',
          'manifest.json'
        );
      }
    }
  }


  if (manifestCalls && status && status !== 'ERROR') {
    const callStages = manifestCalls
      .map((rawCall) => asRecord(rawCall)?.stage)
      .filter((stage): stage is string => typeof stage === 'string');

    if (callStages.length === 0) {
      addIssue(
        errors,
        'CALLS_EMPTY',
        'Non-error live evidence must contain model call records',
        'manifest.json'
      );
    }

    const compilerIndex = callStages.indexOf('compiler');
    if (compilerIndex < 0) {
      addIssue(
        errors,
        'CALL_SEQUENCE_INVALID',
        'Non-error live evidence must contain a compiler call',
        'manifest.json'
      );
    }

    if (status === 'OUTPUT') {
      const generatorIndex = callStages.indexOf('generator');
      const validatorIndex = callStages.indexOf('validator');
      if (
        compilerIndex < 0 ||
        generatorIndex < 0 ||
        validatorIndex < 0 ||
        !(compilerIndex < generatorIndex && generatorIndex < validatorIndex)
      ) {
        addIssue(
          errors,
          'CALL_SEQUENCE_INVALID',
          'OUTPUT evidence must contain compiler -> generator -> validator calls in order',
          'manifest.json'
        );
      }
    }

    if (
      manifestInput &&
      manifestInput.semantic_ids === null &&
      compilerIndex >= 0
    ) {
      const plannerIndex = callStages.indexOf('retrieval_planner');
      if (plannerIndex < 0 || plannerIndex > compilerIndex) {
        addIssue(
          errors,
          'CALL_SEQUENCE_INVALID',
          'Planner-driven live evidence must contain retrieval_planner before compiler',
          'manifest.json'
        );
      }
    }
  }

  if (status === 'ERROR') {
    if (manifest.failure === null || asRecord(manifest.failure) === null) {
      addIssue(
        errors,
        'FAILURE_MISSING',
        'ERROR manifest must contain structured failure metadata',
        'manifest.json'
      );
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
