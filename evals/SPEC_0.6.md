# Spec 0.6 · Compiler Quality & Evaluation Harness

status: IMPLEMENTED

## Goal

Spec 0.6 evaluates the quality of the Spec 0.5 Canon-to-Generation runtime without weakening its isolation boundary.

It asks four questions:

1. Did retrieval obtain the minimum sufficient evidence?
2. Did Compiler preserve the relevant semantic constraints without inventing policy?
3. Did Generator receive enough information while retaining open action space?
4. Did Validator/Patcher catch real errors without rewriting unrelated text?

## Non-goals

Spec 0.6 does not:

- add Raw Canon back into Generator;
- use eval gold annotations as production context;
- claim a particular external model currently passes thresholds;
- replace human Canon authority with an evaluator model.

## Acceptance metrics

`thresholds.yaml` freezes the first machine-readable targets.

Particularly important:

```text
forbidden_inference_rate -> 0
ir_overconstraint_rate   -> 0
patch_locality           -> 1
metamorphic_invariance   -> 1
```

The diversity metric exists because a perfectly faithful compiler can still fail by turning a person into a deterministic state machine.

## Metamorphic invariant

For semantically equivalent Canon wording:

```text
normalize(IR_A) == normalize(IR_B)
generator_payload_hash_A == generator_payload_hash_B
```

This is evaluated at the compiled boundary, not by demanding identical sampled prose.

## Separation from production

Eval cases, expected labels and thresholds are development artifacts. Runtime production code must not read them while generating fiction.
