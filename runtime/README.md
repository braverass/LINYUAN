# Runtime Spec 0.5

This directory implements Canon-to-Generation compilation.

Guarantees:

1. Generator never receives raw Canon.
2. Patcher never receives raw Canon.
3. Provenance is isolated from generation.
4. Context is compiled into ACTIVE_CONTEXT IR.

The runtime boundary is enforced by payload construction, not prompts.
