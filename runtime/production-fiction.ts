import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createModelBackedRuntime,
  type RuntimeModelClients,
} from './adapters/model-backed';
import { createModelClientFromEnv } from './model/providers';
import type { ModelCallRecord } from './model/types';
import {
  runFiction,
  type FictionRunInput,
  type FictionRunResult,
} from './orchestrator';

export interface ProductionFictionInput {
  request: string;
  sceneState?: Record<string, unknown>;
  semanticIds?: string[];
  maxContextRounds?: number;
  system?: string;
  repoRoot?: string;
}

export interface ProductionFictionRun {
  result: FictionRunResult;
  calls: ModelCallRecord[];
}

export function createProductionModelClientsFromEnv(): RuntimeModelClients {
  return {
    retrievalPlanner: createModelClientFromEnv('retrieval'),
    compiler: createModelClientFromEnv('compiler'),
    generator: createModelClientFromEnv('generator'),
    validator: createModelClientFromEnv('validator'),
    patcher: createModelClientFromEnv('patcher'),
  };
}

function assertProductionInput(input: ProductionFictionInput): void {
  if (input.request.trim().length === 0) {
    throw new Error('Fiction request must not be empty');
  }
  if (
    input.maxContextRounds !== undefined &&
    (!Number.isSafeInteger(input.maxContextRounds) || input.maxContextRounds < 1)
  ) {
    throw new Error('maxContextRounds must be a positive integer');
  }
}

export async function runProductionFiction(
  input: ProductionFictionInput,
  clients?: RuntimeModelClients
): Promise<ProductionFictionRun> {
  assertProductionInput(input);

  const repoRoot = input.repoRoot ?? process.cwd();
  const system =
    input.system ??
    (await readFile(path.join(repoRoot, 'MODE-FICTION.md'), 'utf8'));
  const runtime = await createModelBackedRuntime(
    clients ?? createProductionModelClientsFromEnv(),
    { repoRoot }
  );

  const runInput: FictionRunInput = {
    system,
    request: input.request,
    sceneState: structuredClone(input.sceneState ?? {}),
  };
  if (input.semanticIds !== undefined) {
    runInput.semanticIds = [...input.semanticIds];
  }
  if (input.maxContextRounds !== undefined) {
    runInput.maxContextRounds = input.maxContextRounds;
  }

  const result = await runFiction(runInput, runtime.adapters);
  return {
    result,
    calls: runtime.calls.map((call) => structuredClone(call)),
  };
}
