import { readFile } from 'node:fs/promises';

import { assertBaselinePair } from './baseline-integrity';
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

console.log(
  JSON.stringify(
    {
      status: 'ok',
      report_hash: manifest.report_hash,
      commit_sha: manifest.commit_sha,
      case_set_hash: manifest.case_set_hash,
    },
    null,
    2
  )
);
