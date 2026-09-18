# Spec 0.7 · Real Model Execution & Measurement Boundary

status: IMPLEMENTED

## Goal

Spec 0.7 connects external models to the production Spec 0.5 runtime while preserving the measurement integrity established by Spec 0.6.

The central rule is:

```text
candidate-visible input != evaluator-only gold
```

A real model run is useful only if the candidate cannot see the labels used to score it.

## Boundary

```text
EvalCase
   |
   +--> CandidateInput --------------------+
   |                                       |
   |                                 production runtime
   |                                       |
   |                                 runtime artifacts
   |                                       |
   +--> EvalGold --> evaluator Judge <------+
                         |
                         v
                   EvalObservation
                         |
                         v
                     metrics.ts
```

CandidateInput contains only:

- request;
- scene_state;
- optional synthetic Canon stimulus used by metamorphic tests.

It does not contain case id/category descriptions, required source labels, semantic requirements, forbidden inference labels, expected NEED_CONTEXT labels, validator gold, diversity targets, or metamorphic group labels.

## Real runtime

The real candidate path reuses `runFiction()`.

Provider-specific code is below the provider-neutral `ModelClient` interface. The runtime currently supports direct HTTP clients for:

- OpenAI Responses API;
- Gemini generateContent;
- Anthropic Messages API.

Every model call is stateless at the runtime stage boundary and records:

- stage;
- exact returned model id;
- provider;
- request hash;
- response hash;
- generation settings;
- latency;
- token usage when provided;
- provider request id when provided.

## Retrieval

`FictionRunInput.semanticIds` is now optional.

When it is absent, production runtime calls `planInitialRetrieval(request, sceneState)`. The planner sees registry metadata but not eval `required_sources`.

This makes retrieval recall a real measurement instead of copying the answer key into the initial semantic id list.

## Canonical Generator payload

Compiler output is canonicalized before it is wrapped as ACTIVE_CONTEXT.

Arrays with semantic ids are sorted by id before the Generator sees them. Therefore metamorphic equality is a runtime property, not an evaluator-only normalization trick.

## Behavioral diversity

For a case requesting N diversity samples:

1. normal runtime reaches one compiled Generator payload;
2. that exact payload is frozen for the diversity measurement;
3. Generator is called N fresh times;
4. the evaluator Judge assigns semantic behavior signatures.

Compiler variance is therefore not mixed into Generator diversity.

## Evaluator Judge

The Judge has a separate stateless inference call and is the only model-facing component allowed to see EvalGold.

Deterministic fields remain deterministic:

- retrieval source ids come from runtime trace;
- patch count comes from runtime trace;
- patch locality is enforced by runtime splicing;
- normalized IR and Generator payload hashes are computed by runtime code.

The Judge maps semantic artifacts to eval label ids for:

- requirement satisfaction;
- forbidden inference;
- overconstraint;
- NEED_CONTEXT equivalence;
- behavioral signatures;
- validator positives.

The candidate never grades itself.

## Run manifest

A real run can emit a separate manifest containing:

- commit SHA;
- case-set hash;
- stage-to-provider/model mapping;
- per-stage default sampling settings;
- prompt-template hashes;
- every registered Canon source hash;
- every real model call record.

## Commands

Configure one model for every stage:

```bash
export LINYUAN_MODEL_PROVIDER=openai
export LINYUAN_MODEL_ID=<exact-model-id>
export OPENAI_API_KEY=...
```

Or override individual stages:

```bash
export LINYUAN_COMPILER_PROVIDER=gemini
export LINYUAN_COMPILER_MODEL=<exact-model-id>
export GEMINI_API_KEY=...

export LINYUAN_JUDGE_PROVIDER=anthropic
export LINYUAN_JUDGE_MODEL=<exact-model-id>
export ANTHROPIC_API_KEY=...
```

Then run:

```bash
EVAL_OUTPUT=evals/baselines/report.json \
EVAL_MANIFEST_OUTPUT=evals/baselines/manifest.json \
npm run eval:real
```

Add `-- --enforce` only when the run is intended to gate against the frozen Spec 0.6 thresholds.

CI never requires external API keys. CI tests the boundary and wiring with deterministic local doubles; real model baselines are explicit experiments.
