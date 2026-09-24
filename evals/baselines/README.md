# Real model baselines

This directory is reserved for deliberately committed real-model baseline reports and their matching Spec 0.7 manifests.

Do not commit API keys or raw authorization headers.

A baseline is interpretable only when its report and manifest refer to the same
run. Spec 0.7.1 stores `report_hash` in the manifest so that pairing is
machine-verifiable.

Spec 0.7.2 additionally verifies that the manifest still matches the current
evaluation cases, model prompt/runtime sources, evaluator implementation
(Judge, metrics, candidate boundary, real executor and patch-locality logic),
and registered Canon source contents. It also validates call-to-stage-model
consistency and rejects `commit_sha: UNKNOWN`.

If model provider/model environment variables are supplied during verification,
the saved stage model configuration is compared against them without requiring
API keys or contacting a provider.

Verify a pair before comparing or committing it:

```bash
npm run eval:verify-baseline -- \
  evals/baselines/report.json \
  evals/baselines/manifest.json
```

For an exact experiment commit check:

```bash
LINYUAN_BASELINE_COMMIT=<experiment-commit-sha> \
npm run eval:verify-baseline -- \
  evals/baselines/report.json \
  evals/baselines/manifest.json
```
