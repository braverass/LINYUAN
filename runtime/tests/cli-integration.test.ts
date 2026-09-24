import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runCli(script: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', script, ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env },
    }
  );
}

for (const [script, label] of [
  ['runtime/fiction-cli.ts', 'fiction'],
  ['runtime/live-fiction-cli.ts', 'fiction:live'],
  ['runtime/verify-live-bundle-cli.ts', 'fiction:verify'],
  ['runtime/explain-cli.ts', 'explain'],
] as const) {
  test(label + ' CLI --help starts and exits zero', () => {
    const result = runCli(script, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.toLowerCase().includes('usage:'), true);
  });

  test(label + ' CLI rejects unknown arguments', () => {
    const result = runCli(script, ['--definitely-unknown']);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes('Unknown argument'), true);
  });
}

test('fiction:verify requires --run-dir outside help mode', () => {
  const result = runCli('runtime/verify-live-bundle-cli.ts', []);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes('--run-dir is required'), true);
});

test('explain requires exactly one request source', () => {
  const result = runCli('runtime/explain-cli.ts', []);
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.includes('Provide exactly one of --request or --request-file'),
    true
  );
});
