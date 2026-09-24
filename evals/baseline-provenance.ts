import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { MODEL_PROMPT_TEMPLATES } from '../runtime/adapters/model-backed';
import {
  modelDescriptorFromEnv,
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
