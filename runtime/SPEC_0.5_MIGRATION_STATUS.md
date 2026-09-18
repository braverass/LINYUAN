# Spec 0.5 Migration Status

## Runtime boundary

The runtime boundary is defined as:

RAW_CANON -> Compiler -> ACTIVE_CONTEXT -> Generator

Raw Canonical documents must not be included in Generator or Patcher payloads.

## Migration rules

- Physical paths are resolved through SOURCE_REGISTRY.
- Semantic IDs are used instead of hardcoded paths.
- Provenance remains runtime trace data and is not generation context.
- Validation and patching operate through structured contracts.
