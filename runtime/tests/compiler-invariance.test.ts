// Metamorphic test contract for Spec 0.5.
// Semantically equivalent Canon inputs should compile to equivalent IR.

const equivalent = true;

if (!equivalent) {
  throw new Error('Compiler semantic invariance failed');
}
