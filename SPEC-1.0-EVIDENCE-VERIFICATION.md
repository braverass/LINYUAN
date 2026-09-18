# Spec 1.0 · Closed Live Evidence Verification

Spec 0.9 records auditable live-run evidence. Spec 1.0 makes that evidence independently checkable as a closed bundle.

## Threat model

The verifier is designed to catch accidental corruption, stale files, partial copies, mismatched manifests, and post-run edits to tracked artifacts.

It deliberately does **not** claim cryptographic authenticity against an attacker who can rewrite both every artifact and the manifest. It also does not prove that an external model provider actually served a request. Provider contact is established by the real execution environment and preserved workflow/run provenance, not by pretending a SHA-256 digest is a witness.

## Single-use run directories

`fiction:live` now refuses to write into a non-empty run directory.

This closes a concrete Spec 0.9 hole: reusing a directory could otherwise leave an old `output.md` or `trace.json` beside a new failure manifest. A live evidence directory is now one execution, once.

## Verifier

```bash
npm run fiction:verify -- --run-dir runs/live/RUN-0001
```

Machine-readable output:

```bash
npm run fiction:verify -- \
  --run-dir runs/live/RUN-0001 \
  --json
```

The verifier checks:

- `manifest.json` exists, parses, and uses the supported live-manifest version.
- The directory contains only `manifest.json` plus the artifacts declared by the manifest.
- Every tracked artifact is a regular top-level file.
- Every tracked artifact has the exact declared byte count and SHA-256.
- `OUTPUT`, `NEED_CONTEXT`, `CONFLICT`, and `ERROR` have the correct required and forbidden artifact sets.
- `input.json` hashes and execution options agree with `manifest.input`.
- `calls.json` exactly matches `manifest.calls`, recorded calls agree with their stage model descriptors, and provider identity fields are type-checked.
- Successful/non-error `trace.json` agrees with the runtime run ID and retrieval evidence in the manifest.
- `result.json.status` agrees with the manifest status.
- For `OUTPUT`, the runtime output reconstructed from `output.md` agrees with `result.output_hash`.
- For `ERROR`, `failure.json` exactly matches `manifest.failure`.

Exit code is `0` only when every check passes; otherwise it is `1`.

## Provider call identity

New live call records distinguish two provider-native identifiers when available:

- `request_id` is the HTTP/API request identifier returned by the provider response headers, such as OpenAI `x-request-id` or Claude `request-id`.
- `response_id` is the provider response object identifier from the JSON payload, such as an OpenAI response ID, Gemini `responseId`, or Claude message ID.

The two identifiers are intentionally not conflated. Older 0.9 bundles without `response_id` remain valid because the verifier treats the manifest as recorded evidence and does not require this additive field.

## CI and live workflow

Normal CI runs the verifier tests with fixture model clients and does not spend provider credits.

The manual Spec 0.9 live workflow now runs `fiction:verify` after the production chain and before artifact upload. The verification step uses `if: always()`, so a structured `ERROR` bundle is checked too. If execution dies before a bundle exists, verification fails rather than manufacturing evidence.

## Compatibility

The evidence manifest remains version `0.9`. Spec 1.0 adds validation semantics around that format rather than silently changing its schema. Existing preserved 0.9 bundles can therefore be checked by the 1.0 verifier.
