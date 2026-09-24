import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadRegistry, resolveRegisteredSourcePath } from '../runtime/registry';
import { stableHash } from '../runtime/trace';
import { detectGitCommit } from '../runtime/git';
import {
  MODEL_PROMPT_TEMPLATES,
  type RuntimeModelClients,
} from '../runtime/adapters/model-backed';
import type {
  ModelCallRecord,
  ModelClient,
  ModelDefaults,
} from '../runtime/model/types';
import type { EvalCase, EvalSuiteReport } from './types';

export const EVALUATION_CONTRACT_FILES = {
  judge: 'evals/judge.ts',
  metrics: 'evals/metrics.ts',
  candidate_boundary: 'evals/candidate-boundary.ts',
  real_executor: 'evals/real-executor.ts',
  patch_locality: 'evals/patch-locality.ts',
} as const;

export interface RealEvalManifest {
  version: '0.7';
  created_at: string;
  commit_sha: string;
  case_set_hash: string;
  report_hash: string;
  stage_models: Record<
    string,
    {
      provider: string;
      model: string;
      defaults: ModelDefaults;
      endpoint_kind?: 'official' | 'custom';
      endpoint_hash?: string;
    }
  >;
  prompt_template_hashes: Record<string, string>;
  evaluation_contract_hashes: Record<string, string>;
  source_hashes: Record<string, string>;
  calls: ModelCallRecord[];
}

function descriptor(client: ModelClient) {
  return {
    provider: client.provider,
    model: client.model,
    defaults: structuredClone(client.defaults),
    ...(client.endpoint_kind !== undefined
      ? { endpoint_kind: client.endpoint_kind }
      : {}),
    ...(client.endpoint_hash !== undefined
      ? { endpoint_hash: client.endpoint_hash }
      : {}),
  };
}

async function evaluationContractHashes(
  repoRoot: string
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(EVALUATION_CONTRACT_FILES).map(async ([key, file]) => [
        key,
        stableHash(await readFile(path.join(repoRoot, file), 'utf8')),
      ])
    )
  );
}

async function sourceHashes(
  repoRoot: string
): Promise<Record<string, string>> {
  const registry = await loadRegistry(path.join(repoRoot, 'SOURCE_REGISTRY.yaml'));
  const hashes: Record<string, string> = {};
  for (const [semanticId, source] of Object.entries(registry.sources)) {
    const sourcePath = await resolveRegisteredSourcePath(repoRoot, source.path);
    const content = await readFile(sourcePath, 'utf8');
    hashes[semanticId] = stableHash(content);
  }
  return hashes;
}

export async function buildRealEvalManifest(input: {
  cases: EvalCase[];
  report: EvalSuiteReport;
  clients: RuntimeModelClients;
  judgeClient: ModelClient;
  calls: ModelCallRecord[];
  repoRoot?: string;
}): Promise<RealEvalManifest> {
  const repoRoot = input.repoRoot ?? process.cwd();
  return {
    version: '0.7',
    created_at: new Date().toISOString(),
    commit_sha: await detectGitCommit(repoRoot),
    case_set_hash: stableHash(input.cases),
    report_hash: stableHash(input.report),
    stage_models: {
      retrieval_planner: descriptor(input.clients.retrievalPlanner),
      compiler: descriptor(input.clients.compiler),
      generator: descriptor(input.clients.generator),
      validator: descriptor(input.clients.validator),
      patcher: descriptor(input.clients.patcher),
      eval_judge: descriptor(input.judgeClient),
    },
    prompt_template_hashes: {
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
    },
    evaluation_contract_hashes: await evaluationContractHashes(repoRoot),
    source_hashes: await sourceHashes(repoRoot),
    calls: input.calls.map((call) => structuredClone(call)),
  };
}
