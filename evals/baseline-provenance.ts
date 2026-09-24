import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { MODEL_PROMPT_TEMPLATES } from '../runtime/adapters/model-backed';
import {
  modelDescriptorFromEnv,
  officialModelEndpointHash,
  type ModelEnvironmentDescriptor,
} from '../runtime/model/providers';
import { loadRegistry, resolveRegisteredSourcePath } from '../runtime/registry';
import { stableHash } from '../runtime/trace';
import { loadEvalCases } from './loader';
import type { RealEvalManifest } from './run-manifest';

export interface BaselineProvenanceSnapshot {
  case_set_hash: string;
  prompt_template_hashes: Record<string, string>;
  source_hashes: Record<string, string>;
}

export type BaselineStageModels = Record<string, ModelEnvironmentDescriptor>;

const BASELINE_STAGE_ENV = [
  ['retrieval_planner', 'retrieval'],
  ['compiler', 'compiler'],
  ['generator', 'generator'],
  ['validator', 'validator'],
  ['patcher', 'patcher'],
  ['eval_judge', 'judge'],
] as const;

export function expectedBaselineStageModelsFromEnv():
  | BaselineStageModels
  | null {
  const resolved = BASELINE_STAGE_ENV.map(([manifestStage, envStage]) => [
    manifestStage,
    modelDescriptorFromEnv(envStage),
  ] as const);

  if (resolved.every(([, descriptor]) => descriptor === null)) {
    return null;
  }

  const missing = resolved
    .filter(([, descriptor]) => descriptor === null)
    .map(([stage]) => stage);
  if (missing.length > 0) {
    throw new Error(
      'Baseline model provenance is only partially configured; missing stages: ' +
        missing.join(', ')
    );
  }

  return Object.fromEntries(
    resolved.map(([stage, descriptor]) => [stage, descriptor])
  ) as BaselineStageModels;
}

export function assertBaselineStageModels(
  manifest: RealEvalManifest,
  expected: BaselineStageModels
): void {
  if (stableHash(manifest.stage_models) !== stableHash(expected)) {
    throw new Error(
      'Baseline provenance mismatch: stage_models differ from configured model descriptors'
    );
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function expectedSettings(defaults: JsonRecord): JsonRecord {
  return {
    temperature:
      typeof defaults.temperature === 'number' ? defaults.temperature : null,
    top_p: typeof defaults.topP === 'number' ? defaults.topP : null,
    max_output_tokens:
      typeof defaults.maxOutputTokens === 'number'
        ? defaults.maxOutputTokens
        : null,
    seed: typeof defaults.seed === 'number' ? defaults.seed : null,
  };
}

const REAL_EVAL_STAGES = [
  'retrieval_planner',
  'compiler',
  'generator',
  'validator',
  'patcher',
  'eval_judge',
] as const;

export function assertBaselineModelEvidence(
  manifest: RealEvalManifest
): void {
  const stageModels = asRecord(manifest.stage_models);
  if (!stageModels) {
    throw new Error('Baseline model evidence mismatch: stage_models must be an object');
  }

  const expectedStageSet = new Set<string>(REAL_EVAL_STAGES);
  for (const key of Object.keys(stageModels)) {
    if (!expectedStageSet.has(key)) {
      throw new Error(
        'Baseline model evidence mismatch: unexpected stage model ' + key
      );
    }
  }

  for (const stage of REAL_EVAL_STAGES) {
    const descriptor = asRecord(stageModels[stage]);
    if (!descriptor) {
      throw new Error(
        'Baseline model evidence mismatch: missing stage model ' + stage
      );
    }
    if (
      descriptor.provider !== 'openai' &&
      descriptor.provider !== 'gemini' &&
      descriptor.provider !== 'anthropic'
    ) {
      throw new Error(
        'Baseline model evidence mismatch: invalid provider for ' + stage
      );
    }
    if (
      typeof descriptor.model !== 'string' ||
      descriptor.model.trim().length === 0
    ) {
      throw new Error(
        'Baseline model evidence mismatch: invalid model for ' + stage
      );
    }
    const defaults = asRecord(descriptor.defaults);
    if (!defaults) {
      throw new Error(
        'Baseline model evidence mismatch: defaults must be an object for ' + stage
      );
    }

    const hasEndpointKind = Object.prototype.hasOwnProperty.call(
      descriptor,
      'endpoint_kind'
    );
    const hasEndpointHash = Object.prototype.hasOwnProperty.call(
      descriptor,
      'endpoint_hash'
    );
    if (hasEndpointKind !== hasEndpointHash) {
      throw new Error(
        'Baseline model evidence mismatch: endpoint metadata must be paired for ' +
          stage
      );
    }
    if (hasEndpointKind) {
      if (
        descriptor.endpoint_kind !== 'official' &&
        descriptor.endpoint_kind !== 'custom'
      ) {
        throw new Error(
          'Baseline model evidence mismatch: invalid endpoint_kind for ' + stage
        );
      }
      if (
        typeof descriptor.endpoint_hash !== 'string' ||
        !/^[0-9a-f]{64}$/.test(descriptor.endpoint_hash)
      ) {
        throw new Error(
          'Baseline model evidence mismatch: invalid endpoint_hash for ' + stage
        );
      }
      const officialHash = officialModelEndpointHash(descriptor.provider);
      if (
        descriptor.endpoint_kind === 'official' &&
        descriptor.endpoint_hash !== officialHash
      ) {
        throw new Error(
          'Baseline model evidence mismatch: official endpoint hash differs for ' +
            stage
        );
      }
      if (
        descriptor.endpoint_kind === 'custom' &&
        descriptor.endpoint_hash === officialHash
      ) {
        throw new Error(
          'Baseline model evidence mismatch: custom endpoint equals official endpoint for ' +
            stage
        );
      }
    }
  }

  if (!Array.isArray(manifest.calls)) {
    throw new Error('Baseline model evidence mismatch: calls must be an array');
  }

  for (const rawCall of manifest.calls as unknown[]) {
    const call = asRecord(rawCall);
    if (!call || typeof call.stage !== 'string') {
      throw new Error('Baseline model evidence mismatch: malformed call record');
    }
    if (!expectedStageSet.has(call.stage)) {
      throw new Error(
        'Baseline model evidence mismatch: unknown call stage ' + call.stage
      );
    }
    const descriptor = asRecord(stageModels[call.stage]);
    if (!descriptor) {
      throw new Error(
        'Baseline model evidence mismatch: missing descriptor for call stage ' +
          call.stage
      );
    }
    if (call.provider !== descriptor.provider) {
      throw new Error(
        'Baseline model evidence mismatch: call provider differs at ' + call.stage
      );
    }
    if (typeof call.model !== 'string' || call.model.trim().length === 0) {
      throw new Error(
        'Baseline model evidence mismatch: call model is invalid at ' + call.stage
      );
    }

    if (Object.prototype.hasOwnProperty.call(call, 'requested_model')) {
      if (
        typeof call.requested_model !== 'string' ||
        call.requested_model !== descriptor.model
      ) {
        throw new Error(
          'Baseline model evidence mismatch: requested model differs at ' +
            call.stage
        );
      }
    } else if (call.model !== descriptor.model) {
      throw new Error(
        'Baseline model evidence mismatch: legacy call model differs at ' +
          call.stage
      );
    }

    const settings = asRecord(call.settings);
    const defaults = asRecord(descriptor.defaults);
    if (
      !settings ||
      !defaults ||
      stableHash(settings) !== stableHash(expectedSettings(defaults))
    ) {
      throw new Error(
        'Baseline model evidence mismatch: call settings differ at ' + call.stage
      );
    }
  }
}

async function promptTemplateHashes(
  repoRoot: string
): Promise<Record<string, string>> {
  return {
    ...Object.fromEntries(
      Object.entries(MODEL_PROMPT_TEMPLATES).map(([key, value]) => [
        key,
        stableHash(value),
      ])
    ),
    runtime_adapter_source: stableHash(
      await readFile(
        path.join(repoRoot, 'runtime/adapters/model-backed.ts'),
        'utf8'
      )
    ),
    mode_fiction: stableHash(
      await readFile(path.join(repoRoot, 'MODE-FICTION.md'), 'utf8')
    ),
  };
}

async function registeredSourceHashes(
  repoRoot: string
): Promise<Record<string, string>> {
  const registry = await loadRegistry(
    path.join(repoRoot, 'SOURCE_REGISTRY.yaml')
  );
  const hashes: Record<string, string> = {};
  for (const [semanticId, source] of Object.entries(registry.sources)) {
    const sourcePath = await resolveRegisteredSourcePath(repoRoot, source.path);
    const content = await readFile(sourcePath, 'utf8');
    hashes[semanticId] = stableHash(content);
  }
  return hashes;
}

export async function buildCurrentBaselineProvenance(
  repoRoot = process.cwd()
): Promise<BaselineProvenanceSnapshot> {
  const cases = await loadEvalCases([
    path.join(repoRoot, 'evals/cases'),
    path.join(repoRoot, 'evals/adversarial'),
  ]);
  return {
    case_set_hash: stableHash(cases),
    prompt_template_hashes: await promptTemplateHashes(repoRoot),
    source_hashes: await registeredSourceHashes(repoRoot),
  };
}

function assertHashMap(
  label: string,
  recorded: Record<string, string>,
  current: Record<string, string>
): void {
  const keys = [...new Set([...Object.keys(recorded), ...Object.keys(current)])]
    .sort();

  for (const key of keys) {
    if (recorded[key] !== current[key]) {
      throw new Error(
        'Baseline provenance mismatch: ' +
          label +
          ' differs at ' +
          key +
          ' (manifest=' +
          String(recorded[key]) +
          ', current=' +
          String(current[key]) +
          ')'
      );
    }
  }
}

export function assertBaselineProvenance(
  manifest: RealEvalManifest,
  current: BaselineProvenanceSnapshot,
  expectedCommit?: string
): void {
  if (!manifest.commit_sha || manifest.commit_sha === 'UNKNOWN') {
    throw new Error(
      'Baseline provenance mismatch: manifest commit_sha is UNKNOWN'
    );
  }

  if (
    expectedCommit !== undefined &&
    manifest.commit_sha !== expectedCommit
  ) {
    throw new Error(
      'Baseline provenance mismatch: manifest commit ' +
        manifest.commit_sha +
        ' does not match expected commit ' +
        expectedCommit
    );
  }

  if (manifest.case_set_hash !== current.case_set_hash) {
    throw new Error(
      'Baseline provenance mismatch: case_set_hash ' +
        manifest.case_set_hash +
        ' does not match current case set ' +
        current.case_set_hash
    );
  }

  assertHashMap(
    'prompt_template_hashes',
    manifest.prompt_template_hashes,
    current.prompt_template_hashes
  );
  assertHashMap(
    'source_hashes',
    manifest.source_hashes,
    current.source_hashes
  );
}
