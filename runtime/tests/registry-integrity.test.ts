import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertRoleAccess,
  lintRegistry,
  loadRegistry,
  resolveRegisteredSourcePath,
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


test('registered source paths stay inside repoRoot and resolve to regular files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linyuan-registry-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'linyuan-registry-outside-'));
  try {
    const insideFile = path.join(root, 'canon.md');
    const outsideFile = path.join(outside, 'secret.md');
    await writeFile(insideFile, 'inside', 'utf8');
    await writeFile(outsideFile, 'outside', 'utf8');

    assert.equal(
      await resolveRegisteredSourcePath(root, 'canon.md'),
      await realpath(insideFile)
    );

    await assert.rejects(
      () => resolveRegisteredSourcePath(root, outsideFile),
      /relative repository path/
    );

    await assert.rejects(
      () => resolveRegisteredSourcePath(root, path.relative(root, outsideFile)),
      /escapes repository root/
    );

    const escapeLink = path.join(root, 'escape-link.md');
    await symlink(outsideFile, escapeLink);
    await assert.rejects(
      () => resolveRegisteredSourcePath(root, 'escape-link.md'),
      /resolves outside repository root/
    );

    await mkdir(path.join(root, 'directory-source'));
    await assert.rejects(
      () => resolveRegisteredSourcePath(root, 'directory-source'),
      /regular file/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
