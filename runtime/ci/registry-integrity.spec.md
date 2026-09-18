# Spec 0.5 Registry Integrity Acceptance

SOURCE_REGISTRY is the only authority for physical source locations.

Checks:

- every semantic id resolves
- every path exists
- no runtime component accesses undeclared sources
- physical Canon paths do not enter generator contracts
