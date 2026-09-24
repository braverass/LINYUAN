# Spec 1.0 · Closed Live Evidence Verification

Spec 0.9 records auditable live-run evidence. Spec 1.0 makes that evidence independently checkable as a closed bundle.

## Threat model

The verifier is designed to catch accidental corruption, stale files, partial copies, mismatched manifests, post-run edits to tracked artifacts, and internally inconsistent claims about one recorded execution.

It deliberately does **not** claim cryptographic authenticity against an attacker who can rewrite both every artifact and the manifest. It also does not prove that an external model provider actually served a request. Provider contact is established by the real execution environment and preserved workflow/run provenance, not by pretending a SHA-256 digest is a witness.

A syntactically valid `commit_sha` is therefore not, by itself, proof that the bundle was produced by that repository commit. Offline verification preserves that compatibility boundary.

When `fiction:verify` is invoked with `--repo-root <checkout>`, the verifier additionally binds the bundle to the actual checked-out Git commit (ignoring commit environment overrides), requires no tracked worktree changes, binds `SOURCE_REGISTRY.yaml`, re-resolves every recorded retrieval semantic ID and recomputes its Canon content hash, checks both the short prompt-template hashes and the executable `runtime/adapters/model-backed.ts` source hash, and checks the default `MODE-FICTION.md` system contract when no custom system was used. This strengthens repository provenance but still does not prove that an external provider served the recorded calls.

## Single-use run directories

`fiction:live` refuses to write into a non-empty run directory and claims a new run directory atomically.

This prevents stale files from a previous run surviving beside a new manifest and prevents concurrent live runs from sharing one evidence directory.

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
- Bundle identity fields have the expected UUID / concrete-commit shapes.
- The directory contains only `manifest.json` plus the artifacts declared by the manifest.
- Every tracked artifact is a regular top-level file.
- Every tracked artifact has the exact declared byte count and SHA-256.
- `OUTPUT`, `NEED_CONTEXT`, `CONFLICT`, and `ERROR` have the correct required and forbidden artifact sets.
- `input.json` hashes and execution options agree with `manifest.input`.
- Successful inputs use a valid scene object, semantic-ID shape, and positive `max_context_rounds`.
- When a custom `system_override` is recorded for a successful run, its content is bound to `runtime_contract.system_hash`.
- `calls.json` exactly matches `manifest.calls`.
- Call hashes, latency, usage, settings, provider identity, configured/requested model identity, provider-returned model identity, and request/response identifiers have valid shapes.
- Stage model descriptors may record non-secret endpoint provenance as `endpoint_kind: official|custom` plus a SHA-256 of the resolved base URL. The raw endpoint URL is not stored.
- Recorded call settings agree with the configured stage-model defaults used by the live runtime.
- Non-error call records must follow the executable runtime state machine; `OUTPUT`, `NEED_CONTEXT`, and `CONFLICT` each have valid terminal stages and forbidden stage combinations.
- Successful/non-error `trace.json` uses the supported trace version and validates retrieval hashes, compiler READY evidence, generator payload hashes/missing-context shape, validator summaries, and patch scopes.
- Generator call counts, compiler READY counts, validator violations, and patcher scopes agree with recorded model calls and with each other.
- `result.json.status` agrees with the manifest status.
- For `OUTPUT`, the runtime output reconstructed from `output.md` agrees with `result.output_hash`.
- For `ERROR`, `failure.json` exactly matches `manifest.failure`.

Exit code is `0` only when every check passes; otherwise it is `1`.

## Provider call identity

Live call records distinguish two provider-native identifiers when available:

- `request_id` is the HTTP/API request identifier returned by provider response headers, such as OpenAI `x-request-id` or Claude `request-id`.
- `response_id` is the provider response object identifier from the JSON payload, such as an OpenAI response ID, Gemini `responseId`, or Claude message ID.

The two identifiers are intentionally not conflated. Model identity is likewise split: `requested_model` records the configured model ID sent by the runtime, while `model` records the provider-returned model ID. This permits normal alias-to-snapshot resolution without losing the configured identity.

Provider label and network endpoint are also kept distinct. A client configured with a custom OpenAI/Gemini/Anthropic-compatible base URL records `endpoint_kind: custom` and only the endpoint hash; it is not represented as evidence of direct contact with the provider's official endpoint.

Older 0.9 bundles without `response_id` or `requested_model` remain valid when the rest of the preserved evidence satisfies the current verifier.

## CI and live workflow

Normal CI runs the verifier tests with fixture model clients and does not spend provider credits.

The manual Spec 0.9 live workflow runs `fiction:verify` after the production chain and before artifact upload. The verification step uses `if: always()`, so a structured `ERROR` bundle is checked too. If execution dies before a bundle exists, verification fails rather than manufacturing evidence.

## Compatibility

The evidence manifest remains version `0.9`. Spec 1.0 adds validation semantics around that format rather than changing the serialized version.

Preserved 0.9 bundles without the additive `response_id` field remain compatible when they contain concrete Git commit provenance and otherwise satisfy the closed-bundle invariants.

Historical 0.9 bundles whose producer recorded `commit_sha: "UNKNOWN"` are no longer accepted by the hardened verifier. That is an intentional provenance tightening, so compatibility is not unconditional across every artifact an older producer could emit.
