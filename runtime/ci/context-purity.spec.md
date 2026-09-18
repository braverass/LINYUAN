# Spec 0.5 Context Purity Acceptance

## Generator boundary

A generation inference payload MUST NOT contain:

- raw Canon text
- Canon file paths
- provenance records
- retrieval evidence
- source registry entries

Allowed inputs:

- user request
- scene state
- ACTIVE_CONTEXT IR
- mode contract

## Assertion

RAW_CANON -> GENERATOR direct data flow MUST be impossible by construction.
