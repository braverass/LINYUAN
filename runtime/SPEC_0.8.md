# Spec 0.8 · Production Fiction Entry Point

status: IMPLEMENTED

## Goal

Make the isolated Canon runtime directly usable for fiction generation without
routing through the evaluation harness.

## Production path

```text
request + scene state
        |
Retrieval Planner
        |
SOURCE_REGISTRY
        |
Raw Canon Retriever
        |
Compiler
        |
ACTIVE_CONTEXT
        |
isolated Generator
        |
Draft
        |
Validator + Canon evidence
        |
local Patcher
        |
Output
```

`runProductionFiction()` is the reusable API. `npm run fiction` is the CLI.

The production entry does not import EvalCase, EvalGold, Judge, thresholds, or
baseline code.

## CLI

```bash
npm run fiction -- --request "..." --scene '{"location":"..."}'
```

Optional artifacts:

```bash
--output <fiction.txt>
--trace-output <trace.json>
--calls-output <calls.json>
```

`calls.json` contains hashes, provider/model identity, latency, usage and
sampling settings. It does not contain API keys.

## Provider boundary

OpenAI, Gemini and Anthropic remain behind `ModelClient`.

OpenAI Responses requests with `responseFormat: json` now set the API text
format to JSON object mode instead of relying only on prompt wording. Gemini
already uses `application/json` response MIME type.

## Verification

CI runs the normal runtime/eval contracts plus a CLI help smoke test.

A deterministic model-client test exercises the production entry through the
real SOURCE_REGISTRY and Retriever, then Compiler, Generator, Validator and
Patcher. External API credentials are deliberately not required in CI.
