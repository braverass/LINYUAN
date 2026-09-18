import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { MODEL_PROMPT_TEMPLATES } from '../runtime/adapters/model-backed';
import { loadRegistry } from '../runtime/registry';
import { stableHash } from '../runtime/trace';
import { loadEvalCases } from './loader';
import type { RealEvalManifest } from './run-manifest';

export interface BaselineProvenanceSnapshot {
  case_set_hash: string;
  prompt_template_hashes: Record<string, string>;
  source_hashes: Record<string, string>;
}

function promptTemplateHashes(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(MODEL_PROMPT_TEMPLATES).map(([key, value]) => [
      key,
      stableHash(value),
    ])
  );
}

async function registeredSourceHashes(
  repoRoot: string
): Promise<Record<string, string>> {
  const registry = await loadRegistry(
    path.join(repoRoot, 'SOURCE_REGISTRY.yaml')
  );
  const hashes: Record<string, string> = {};
  for (const [semanticId, source] of Object.entries(registry.sources)) {
    const content = await readFile(path.join(repoRoot, source.path), 'utf8');
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
    prompt_template_hashes: promptTemplateHashes(),
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
