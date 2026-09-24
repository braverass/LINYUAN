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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertProductionFictionInput(
  input: ProductionFictionInput
): void {
  if (typeof input.request !== 'string' || input.request.trim().length === 0) {
    throw new Error('Fiction request must be a non-empty string');
  }
  if (input.sceneState !== undefined && !isPlainObject(input.sceneState)) {
    throw new Error('sceneState must be a plain JSON object');
  }
  if (
    input.semanticIds !== undefined &&
    (!Array.isArray(input.semanticIds) ||
      input.semanticIds.some(
        (semanticId) =>
          typeof semanticId !== 'string' || semanticId.trim().length === 0
      ))
  ) {
    throw new Error('semanticIds must be an array of non-empty strings');
  }
  if (
    input.maxContextRounds !== undefined &&
    (!Number.isSafeInteger(input.maxContextRounds) || input.maxContextRounds < 1)
  ) {
    throw new Error('maxContextRounds must be a positive safe integer');
  }
  if (
    input.system !== undefined &&
    (typeof input.system !== 'string' || input.system.trim().length === 0)
  ) {
    throw new Error('system must be a non-empty string when provided');
  }
  if (
    input.repoRoot !== undefined &&
    (typeof input.repoRoot !== 'string' || input.repoRoot.trim().length === 0)
  ) {
    throw new Error('repoRoot must be a non-empty string when provided');
  }
}

export async function runProductionFiction(
  input: ProductionFictionInput,
  clients?: RuntimeModelClients
): Promise<ProductionFictionRun> {
  assertProductionFictionInput(input);

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
