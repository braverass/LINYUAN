# Spec 0.5 Migration Status

status: COMPLETE

## Delivered contracts

- AI entry and FICTION / EXPLAIN mode separation
- complete semantic SOURCE_REGISTRY for current root Canon/bundles
- Registry access policy with Generator/Patcher deny
- Registry-backed Retriever
- Compiler adapter with ACTIVE_CONTEXT sanitization
- provenance split from Generation IR
- origin-gated Generator payload construction
- structured NEED_CONTEXT round-trip
- Validator structured violation contract
- evidence stripping before Patcher
- deterministic patch locality enforcement
- runtime-only Run Trace with hashes
- executable context-isolation test
- executable compiler-invariance test
- executable patch-locality test
- executable Registry-integrity test
- executable IR-sufficiency / fresh-call test
- TypeScript typecheck and GitHub Actions CI entry
- legacy reading protocol migrated to Retrieval / Compilation Protocol

## Acceptance boundary

Spec 0.5 compliance means Raw Canon is physically absent from every Generator and Patcher inference payload. A prompt telling a model to ignore Raw Canon does not satisfy this spec.
