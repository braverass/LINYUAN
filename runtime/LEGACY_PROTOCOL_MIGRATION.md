# Legacy Protocol Migration

The former reading protocol remains a human-facing specification.

Runtime execution authority moves to:

1. SOURCE_REGISTRY
2. COMPILER
3. ACTIVE_CONTEXT
4. ORCHESTRATOR
5. VALIDATOR
6. PATCHER

Legacy instructions must not directly inject file contents into generation context.

Path references should resolve through semantic IDs rather than hardcoded physical paths.

Migration invariant:

RAW_CANON -> COMPILER -> ACTIVE_CONTEXT -> GENERATOR

No direct RAW_CANON -> GENERATOR path is allowed.
