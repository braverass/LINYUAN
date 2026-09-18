import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';

import { createModelClientFromEnv } from '../runtime/model/providers';
import type { RuntimeModelClients } from '../runtime/adapters/model-backed';
import { loadEvalCases } from './loader';
import { assertThresholds, evaluateSuite } from './metrics';
import { executeRealEvalCase } from './real-executor';
import { buildRealEvalManifest } from './run-manifest';
import type { EvalThresholds } from './types';

async function loadThresholds(): Promise<EvalThresholds> {
  const raw = await readFile('evals/thresholds.yaml', 'utf8');
  return parse(raw) as EvalThresholds;
}

const clients: RuntimeModelClients = {
  retrievalPlanner: createModelClientFromEnv('retrieval'),
  compiler: createModelClientFromEnv('compiler'),
  generator: createModelClientFromEnv('generator'),
  validator: createModelClientFromEnv('validator'),
  patcher: createModelClientFromEnv('patcher'),
};
const judgeClient = createModelClientFromEnv('judge');

const cases = await loadEvalCases();
const observations = [];
const calls = [];

for (const testCase of cases) {
  const executed = await executeRealEvalCase(
    testCase,
    clients,
    judgeClient
  );
  observations.push(executed.observation);
  calls.push(...executed.calls);
}

const report = evaluateSuite(cases, observations);
const manifest = await buildRealEvalManifest({
  cases,
  clients,
  judgeClient,
  calls,
});

console.log(JSON.stringify(report, null, 2));

const reportOutput = process.env.EVAL_OUTPUT;
if (reportOutput) {
  await writeFile(
    reportOutput,
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );
}

const manifestOutput = process.env.EVAL_MANIFEST_OUTPUT;
if (manifestOutput) {
  await writeFile(
    manifestOutput,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
}

if (process.argv.includes('--enforce')) {
  assertThresholds(report, await loadThresholds());
}
