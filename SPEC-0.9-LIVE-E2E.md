# Spec 0.9 · Live Fiction E2E Evidence

Spec 0.8 makes the production fiction path executable. Spec 0.9 makes a real external-model run auditable and repeatable.

## Command

```bash
export LINYUAN_MODEL_PROVIDER=openai
export LINYUAN_MODEL_ID=<exact-model-id>
export OPENAI_API_KEY=...

npm run fiction:live -- \
  --request-file request.txt \
  --scene-file scene.json \
  --run-dir runs/live/RUN-0001
```

The live command uses the same Retriever -> Compiler -> isolated Generator -> Validator -> Local Patcher runtime as `npm run fiction`. It does not create a second shortcut pipeline.

## Evidence bundle

A successful run writes:

- `input.json`: exact request, scene state, explicit semantic IDs and optional system override.
- `trace.json`: runtime isolation/retrieval/validation trace.
- `calls.json`: provider/model/request-hash/response-hash/latency/usage metadata. Raw prompts and API keys are not stored.
- `result.json`: terminal runtime status and output hash or structured non-output result.
- `output.md`: final patched fiction when status is `OUTPUT`.
- `manifest.json`: commit SHA, contract hashes, stage model descriptors, retrieved Canon hashes, calls and artifact byte hashes.

A failed run still writes `input.json`, any completed `calls.json`, `failure.json`, and `manifest.json`. Failure messages redact configured environment values whose names look like API keys, tokens, secrets, or passwords.

The manifest does not hash itself. Every other bundle artifact is recorded with an exact SHA-256 byte hash.

## GitHub Actions

`.github/workflows/spec-0.9-live.yml` is manual-only. Choose provider and exact model ID in `workflow_dispatch`. The selected repository secret (`OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`) must already exist. The workflow runs the full five-stage production path and uploads the evidence bundle.

Normal push/PR CI never spends external model credits. It tests the same live bundle code with fixture model clients.

## Exit codes

- `0`: `OUTPUT`
- `2`: `NEED_CONTEXT`
- `3`: `CONFLICT`
- `1`: configuration, provider, parsing, runtime, or filesystem failure

A green normal CI run proves the live E2E machinery is wired correctly. It does not claim that a real provider was contacted. Only a preserved live evidence bundle can support that claim.


## Verification in Spec 1.0

Live run directories are now single-use evidence containers. The runtime refuses to write into a non-empty run directory, preventing stale files from a previous run from surviving beside a new manifest.

After a bundle is produced, verify it independently:

```bash
npm run fiction:verify -- --run-dir runs/live/RUN-0001
```

The verifier checks the closed file set, byte counts, SHA-256 values, status-specific layout, and cross-file consistency between `input.json`, `trace.json`, `calls.json`, `result.json` / `failure.json`, `output.md`, and `manifest.json`.
