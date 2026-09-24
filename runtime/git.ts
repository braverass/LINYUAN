import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function commitLike(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value);
}

export interface DetectGitCommitOptions {
  useEnvironment?: boolean;
}

export async function detectGitCommit(
  repoRoot: string,
  options: DetectGitCommitOptions = {}
): Promise<string> {
  if (options.useEnvironment !== false) {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
    if (process.env.LINYUAN_COMMIT) return process.env.LINYUAN_COMMIT;
  }

  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const commit = stdout.trim();
    if (commitLike(commit)) return commit;
  } catch {
    // Fall through to UNKNOWN. git rev-parse handles packed refs and worktrees.
  }

  return 'UNKNOWN';
}

export async function trackedGitWorktreeIsClean(
  repoRoot: string
): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=no'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    );
    return stdout.trim().length === 0;
  } catch {
    return null;
  }
}
