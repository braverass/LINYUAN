# Canon-to-Generation Runtime · Spec 0.5

Spec 0.5 turns the repository from a “read documents, then write” prompt workflow into an explicit compilation runtime.

## Boundary

```text
Raw Canon
   |
Retriever
   |
Compiler ---------> Provenance / Run Trace
   |
ACTIVE_CONTEXT
   |
======== information firewall ========
   |
NEW Generator inference
   |
Draft
   |
Validator <-------- Raw Canon / Provenance allowed
   |
Structured violations
   |
======== evidence firewall ===========
   |
Local Patcher
   |
Output
```

The Generator and Patcher are isolated by payload construction, not by instructions to “ignore” earlier messages.

## Files

- `../AI_ENTRY.md`: mode routing.
- `../SOURCE_REGISTRY.yaml`: semantic ID to physical path and access policy.
- `compiler.ts`: Raw Canon -> sanitized ACTIVE_CONTEXT + separate provenance.
- `generator.ts`: origin-gated Generator payload.
- `validator.ts`: structured violation adapter and evidence stripping.
- `patcher.ts`: deterministic local replacement enforcement.
- `orchestrator.ts`: creates separate calls and handles NEED_CONTEXT rounds.
- `retriever.ts`: Registry-backed raw source loader.
- `trace.ts`: payload/source hashes and audit trace.
- `schemas/`: serialization contracts.
- `tests/`: executable acceptance tests.
- `ci/lint-registry.ts`: path/permission integrity check.

## Hard properties

1. Raw Canon origin cannot be used to construct Generator payload.
2. Generator payload has exactly: system, request, sceneState, activeContext.
3. Provenance/evidence metadata is recursively rejected from Generator.
4. Patcher receives violations only after evidence refs are stripped.
5. Patcher returns only a replacement string. Runtime splices that string into the declared paragraph/sentence range.
6. Generator NEED_CONTEXT causes retrieval/recompilation and another stateless Generator call.
7. Physical Canon paths are resolved by SOURCE_REGISTRY, not operational protocols.
8. Canon documents have instruction_capability=false in Registry.

## Commands

```bash
npm ci
npm run typecheck
npm test
npm run lint:registry
npm run ci
```

GitHub Actions runs the same `npm run ci` contract for runtime-related changes.


## Production fiction entry · Spec 0.8

The runtime now has a production entry point rather than only evaluation
runners.

Configure a provider:

```bash
export LINYUAN_MODEL_PROVIDER=openai
export LINYUAN_MODEL_ID=<exact-model-id>
export OPENAI_API_KEY=...
```

Run a real fiction request:

```bash
npm run fiction -- \
  --request "写零渊第一次进入庄园镇的场景" \
  --scene '{"location":"庄园镇","time":"night"}'
```

For longer inputs, keep request and scene state in files:

```bash
npm run fiction -- \
  --request-file request.txt \
  --scene-file scene.json \
  --output runs/fiction.md \
  --trace-output runs/trace.json \
  --calls-output runs/calls.json
```

The normal path uses the Retrieval Planner. `--semantic-id <id>` is available
for deterministic/reproduction runs and may be repeated.

The reusable API is `runProductionFiction()` in
`runtime/production-fiction.ts`. It executes the same Registry-backed
Retriever -> Compiler -> isolated Generator -> Validator -> local Patcher
pipeline used by the runtime contract.
