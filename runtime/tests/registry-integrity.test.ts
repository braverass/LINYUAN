import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

test('loadRegistry rejects malformed source access maps before runtime use', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'linyuan-registry-'));
  const registryPath = path.join(dir, 'SOURCE_REGISTRY.yaml');

  try {
    await writeFile(
      registryPath,
      [
        'version: "0.5"',
        'sources:',
        '  BROKEN:',
        '    path: "canon.md"',
        '    authority: "L0"',
        '    content_role: "author_canon"',
        '    instruction_capability: false',
        '    access:',
        '      retriever: read',
        '      orchestrator: read',
        '      compiler: read',
        '      generator: deny',
        '      validator: read',
        '',
      ].join('\n'),
      'utf8'
    );

    await assert.rejects(
      () => loadRegistry(registryPath),
      /BROKEN: access\.patcher must be "read" or "deny"/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('lintRegistry rejects paths that escape the repository root', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'linyuan-registry-'));
  const registryPath = path.join(dir, 'SOURCE_REGISTRY.yaml');

  try {
    await writeFile(
      registryPath,
      [
        'version: "0.5"',
        'sources:',
        '  ESCAPE:',
        '    path: "../outside.md"',
        '    authority: "L0"',
        '    content_role: "author_canon"',
        '    instruction_capability: false',
        '    access:',
        '      retriever: read',
        '      orchestrator: read',
        '      compiler: read',
        '      generator: deny',
        '      validator: read',
        '      patcher: deny',
        '',
      ].join('\n'),
      'utf8'
    );

    const registry = await loadRegistry(registryPath);
    const errors = await lintRegistry(registry, dir);
    assert.deepEqual(errors, [
      'ESCAPE: path escapes repository root: ../outside.md',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
