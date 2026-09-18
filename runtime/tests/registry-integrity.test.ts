import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRoleAccess,
  lintRegistry,
  loadRegistry,
} from '../registry';

test('SOURCE_REGISTRY resolves existing paths and denies Generator/Patcher raw access', async () => {
  const registry = await loadRegistry();
  const errors = await lintRegistry(registry);
  assert.deepEqual(errors, []);

  assert.throws(
    () => assertRoleAccess(registry, 'AUTHOR.PERSONALITY', 'generator'),
    /denied access/
  );
  assert.throws(
    () => assertRoleAccess(registry, 'AUTHOR.PERSONALITY', 'patcher'),
    /denied access/
  );

  assert.doesNotThrow(() =>
    assertRoleAccess(registry, 'AUTHOR.PERSONALITY', 'compiler')
  );
});
