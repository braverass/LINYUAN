import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function commitLike(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value);
}

export async function detectGitCommit(repoRoot: string): Promise<string> {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  if (process.env.LINYUAN_COMMIT) return process.env.LINYUAN_COMMIT;

  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const commit = stdout.trim();
    if (commitLike(commit)) return commit;
  } catch {
    // Fall through to UNKNOWN. git rev-parse also handles packed refs/worktrees.
  }

  return 'UNKNOWN';
}
