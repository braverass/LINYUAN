import { stableHash } from '../runtime/trace';
import type { RealEvalManifest } from './run-manifest';
import type { EvalSuiteReport } from './types';

export function assertBaselinePair(
  report: EvalSuiteReport,
  manifest: RealEvalManifest
): void {
  const actual = stableHash(report);
  if (manifest.report_hash !== actual) {
    throw new Error(
      'Baseline report/manifest mismatch: manifest report_hash ' +
        manifest.report_hash +
        ' does not match report hash ' +
        actual
    );
  }
}
