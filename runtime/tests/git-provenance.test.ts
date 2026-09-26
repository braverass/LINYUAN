import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LiveFictionBundleError, runLiveFictionBundle } from '../live-fiction';
import { verifyLiveFictionBundle } from '../verify-live-bundle';

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

test('live evidence records the commit from a linked Git worktree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linyuan-worktree-'));
  const repo = path.join(root, 'repo');
  const worktree = path.join(root, 'linked');
  const runDir = path.join(root, 'run');
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousLinyuanCommit = process.env.LINYUAN_COMMIT;
  const previousGitDir = process.env.GIT_DIR;

  try {
    await mkdir(repo);
    git('init', '--quiet', repo);
    await writeFile(path.join(repo, 'fixture.txt'), 'fixture\n');
    git('-C', repo, 'add', 'fixture.txt');
    git('-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '--quiet', '-m', 'fixture');
    const expectedCommit = git('-C', repo, 'rev-parse', 'HEAD');
    git('-C', repo, 'worktree', 'add', '--quiet', '--detach', worktree, 'HEAD');

    delete process.env.GITHUB_SHA;
    delete process.env.LINYUAN_COMMIT;
    let manifest: LiveFictionBundleError['manifest'] | undefined;
    try {
      await runLiveFictionBundle(
        { request: '', repoRoot: worktree },
        { runDir }
      );
      assert.fail('empty request should produce a failure evidence bundle');
    } catch (error) {
      assert.ok(error instanceof LiveFictionBundleError);
      manifest = error.manifest;
    }

    assert.equal(manifest.commit_sha, expectedCommit);
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true, JSON.stringify(report.errors));

    process.env.GIT_DIR = path.join(process.cwd(), '.git');
    let inheritedManifest: LiveFictionBundleError['manifest'] | undefined;
    try {
      await runLiveFictionBundle(
        { request: '', repoRoot: worktree },
        { runDir: path.join(root, 'run-inherited-git-dir') }
      );
      assert.fail('empty request should produce a failure evidence bundle');
    } catch (error) {
      assert.ok(error instanceof LiveFictionBundleError);
      inheritedManifest = error.manifest;
    }
    assert.equal(inheritedManifest.commit_sha, expectedCommit);
  } finally {
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousLinyuanCommit === undefined) delete process.env.LINYUAN_COMMIT;
    else process.env.LINYUAN_COMMIT = previousLinyuanCommit;
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    await rm(root, { recursive: true, force: true });
  }
});

test('live evidence still reads a loose HEAD when Git is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linyuan-no-git-'));
  const repo = path.join(root, 'repo');
  const runDir = path.join(root, 'run');
  const expectedCommit = 'a'.repeat(40);
  const previousPath = process.env.PATH;
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousLinyuanCommit = process.env.LINYUAN_COMMIT;

  try {
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await writeFile(path.join(repo, '.git', 'HEAD'), expectedCommit + '\n');
    process.env.PATH = '';
    delete process.env.GITHUB_SHA;
    delete process.env.LINYUAN_COMMIT;

    let manifest: LiveFictionBundleError['manifest'] | undefined;
    try {
      await runLiveFictionBundle(
        { request: '', repoRoot: repo },
        { runDir }
      );
      assert.fail('empty request should produce a failure evidence bundle');
    } catch (error) {
      assert.ok(error instanceof LiveFictionBundleError);
      manifest = error.manifest;
    }

    assert.equal(manifest.commit_sha, expectedCommit);
    const report = await verifyLiveFictionBundle(runDir);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousLinyuanCommit === undefined) delete process.env.LINYUAN_COMMIT;
    else process.env.LINYUAN_COMMIT = previousLinyuanCommit;
    await rm(root, { recursive: true, force: true });
  }
});
