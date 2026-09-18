# Real model baselines

This directory is reserved for deliberately committed real-model baseline reports and their matching Spec 0.7 manifests.

Do not commit API keys or raw authorization headers.

A baseline is interpretable only when its report and manifest refer to the same
run. Spec 0.7.1 stores `report_hash` in the manifest so that pairing is
machine-verifiable.

Verify a pair before comparing or committing it:

```bash
npm run eval:verify-baseline -- \
  evals/baselines/report.json \
  evals/baselines/manifest.json
```
