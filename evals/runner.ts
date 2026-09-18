import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

import { loadEvalCases } from './loader';
import { assertThresholds, evaluateSuite } from './metrics';
import { referenceExecutor } from './reference-executor';
import type {
  EvalExecutor,
  EvalThresholds,
} from './types';

async function loadThresholds(): Promise<EvalThresholds> {
  const raw = await readFile('evals/thresholds.yaml', 'utf8');
  return parse(raw) as EvalThresholds;
}

async function loadExecutor(): Promise<EvalExecutor> {
  const modulePath = process.env.EVAL_ADAPTER;
  if (!modulePath) {
    return referenceExecutor;
  }

  const resolved = path.resolve(modulePath);
  const imported = await import(pathToFileURL(resolved).href);
  const executor = imported.default ?? imported.executor;

  if (typeof executor !== 'function') {
    throw new Error(
      'EVAL_ADAPTER must export a default function or named executor function'
    );
  }

  return executor as EvalExecutor;
}

const cases = await loadEvalCases();
const executor = await loadExecutor();
const observations = [];

for (const testCase of cases) {
  observations.push(await executor(testCase));
}

const report = evaluateSuite(cases, observations);
const json = JSON.stringify(report, null, 2);
console.log(json);

const output = process.env.EVAL_OUTPUT;
if (output) {
  await writeFile(output, json + '\n', 'utf8');
}

if (process.argv.includes('--enforce')) {
  assertThresholds(report, await loadThresholds());
}
