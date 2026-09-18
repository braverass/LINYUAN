# Spec 0.6 · Compiler Quality & Evaluation Harness

Spec 0.5 proved **information isolation**. Spec 0.6 measures whether the isolated pipeline still retrieves the right evidence, compiles the right semantics, preserves uncertainty, and leaves enough creative freedom.

This directory is evaluation-only. Nothing under `evals/` may be injected into production Generator context.

## Corpus

```text
evals/
├── cases/
│   ├── personality/
│   ├── behavior/
│   ├── knowledge/
│   ├── ability/
│   └── continuity/
├── adversarial/
├── expected/
├── schemas/
├── tests/
├── loader.ts
├── metrics.ts
├── reference-executor.ts
├── runner.ts
└── thresholds.yaml
```

Each case declares:

- request and scene state;
- semantic sources that retrieval should find;
- semantic requirements the compiled IR must preserve;
- forbidden inferences;
- forbidden overconstraints;
- expected NEED_CONTEXT items;
- desired behavioral diversity;
- Validator gold positives and negatives;
- optional metamorphic group and synthetic Canon wording.

The `synthetic_canon` field is test material only. It is deliberately not part of the real Canon registry.

## Metrics

Spec 0.6 reports:

- `retrieval_recall`
- `constraint_fidelity`
- `forbidden_inference_rate`
- `ir_overconstraint_rate`
- `need_context_precision`
- `need_context_recall`
- `behavioral_diversity`
- `validator_false_positive_rate`
- `validator_false_negative_rate`
- `patch_locality`
- `metamorphic_invariance_rate`

High-is-good metrics use minimum thresholds. Error rates use maximum thresholds.

## Reference executor

`reference-executor.ts` mirrors gold annotations. It exists only to prove that:

- cases load;
- metric arithmetic works;
- threshold enforcement works;
- metamorphic grouping works;
- CI is wired.

A score of 1.0 from the reference executor is **not** a claim about model quality. That would be the evaluation equivalent of grading your own exam with the answer key open.

## Candidate execution

The original `EVAL_ADAPTER` hook remains a Spec 0.6 harness extension and receives the full EvalCase. It is suitable for deterministic harness self-tests, not for a trustworthy real-model baseline.

Spec 0.7 adds the real candidate path:

```bash
npm run eval:real
```

That path splits each EvalCase into candidate-visible input and evaluator-only gold before any candidate model call. The production runtime never receives the gold labels. See `SPEC_0.7.md` for provider configuration, Judge separation, repeated Generator sampling and run manifests.

## Metamorphic test

The adversarial pair rewrites the same semantic proposition with materially different wording. A candidate should produce equivalent normalized IR and identical Generator payload hashes after compilation. This detects leakage of Canon wording through the supposedly semantic boundary.

## CI

```bash
npm run typecheck
npm test
npm run eval:smoke
npm run ci
```

The smoke evaluation uses only the reference executor. Production/model adapters should be run separately and compared against `thresholds.yaml`.
