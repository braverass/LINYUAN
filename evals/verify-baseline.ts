import { readFile } from 'node:fs/promises';

import { assertBaselinePair } from './baseline-integrity';
import {
  assertBaselineProvenance,
  buildCurrentBaselineProvenance,
} from './baseline-provenance';
import type { RealEvalManifest } from './run-manifest';
import type { EvalSuiteReport } from './types';

const [reportPath, manifestPath] = process.argv.slice(2);

if (!reportPath || !manifestPath) {
  throw new Error(
    'Usage: npm run eval:verify-baseline -- <report.json> <manifest.json>'
  );
}

const report = JSON.parse(
  await readFile(reportPath, 'utf8')
) as EvalSuiteReport;
const manifest = JSON.parse(
  await readFile(manifestPath, 'utf8')
) as RealEvalManifest;

assertBaselinePair(report, manifest);

const current = await buildCurrentBaselineProvenance();
assertBaselineProvenance(
  manifest,
  current,
  process.env.LINYUAN_BASELINE_COMMIT
);

console.log(
  JSON.stringify(
    {
      status: 'ok',
      report_hash: manifest.report_hash,
      commit_sha: manifest.commit_sha,
      case_set_hash: manifest.case_set_hash,
      prompt_template_hashes_verified: true,
      source_hashes_verified: true,
    },
    null,
    2
  )
);
