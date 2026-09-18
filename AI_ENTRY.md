# AI_ENTRY

## Runtime Entry

All AI tasks must enter through the Spec 0.5 runtime.

Flow:

REQUEST
→ ORCHESTRATOR
→ RETRIEVAL
→ COMPILATION
→ ACTIVE_CONTEXT
→ GENERATOR
→ VALIDATION
→ PATCH

Raw Canon files are never directly provided to Generator or Patcher.

Generator accepts only:
- user request
- scene state
- ACTIVE_CONTEXT
- fiction mode contract

Provenance is runtime-only data.
