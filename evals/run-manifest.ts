import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadRegistry } from '../runtime/registry';
import { stableHash } from '../runtime/trace';
import {
  MODEL_PROMPT_TEMPLATES,
  type RuntimeModelClients,
} from '../runtime/adapters/model-backed';
import type {
  ModelCallRecord,
  ModelClient,
  ModelDefaults,
} from '../runtime/model/types';
import type { EvalCase } from './types';

export interface RealEvalManifest {
  version: '0.7';
  created_at: string;
  commit_sha: string;
  case_set_hash: string;
  stage_models: Record<
    string,
    {
      provider: string;
      model: string;
      defaults: ModelDefaults;
    }
  >;
  prompt_template_hashes: Record<string, string>;
  source_hashes: Record<string, string>;
  calls: ModelCallRecord[];
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

function descriptor(client: ModelClient) {
  return {
    provider: client.provider,
    model: client.model,
    defaults: structuredClone(client.defaults),
  };
}

async function sourceHashes(
  repoRoot: string
): Promise<Record<string, string>> {
  const registry = await loadRegistry(path.join(repoRoot, 'SOURCE_REGISTRY.yaml'));
  const hashes: Record<string, string> = {};
  for (const [semanticId, source] of Object.entries(registry.sources)) {
    const content = await readFile(path.join(repoRoot, source.path), 'utf8');
    hashes[semanticId] = stableHash(content);
  }
  return hashes;
}

export async function buildRealEvalManifest(input: {
  cases: EvalCase[];
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
    stage_models: {
      retrieval_planner: descriptor(input.clients.retrievalPlanner),
      compiler: descriptor(input.clients.compiler),
      generator: descriptor(input.clients.generator),
      validator: descriptor(input.clients.validator),
      patcher: descriptor(input.clients.patcher),
      eval_judge: descriptor(input.judgeClient),
    },
    prompt_template_hashes: Object.fromEntries(
      Object.entries(MODEL_PROMPT_TEMPLATES).map(([key, value]) => [
        key,
        stableHash(value),
      ])
    ),
    source_hashes: await sourceHashes(repoRoot),
    calls: input.calls.map((call) => structuredClone(call)),
  };
}
