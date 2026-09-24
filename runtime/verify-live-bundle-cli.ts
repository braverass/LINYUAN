import { verifyLiveFictionBundle } from './verify-live-bundle';

interface CliOptions {
  runDir?: string;
  repoRoot?: string;
  json: boolean;
  help: boolean;
}

const HELP = [
  'LINYUAN live evidence verifier',
  '',
  'Usage:',
  '  npm run fiction:verify -- --run-dir <evidence-directory> [--repo-root <repo>] [--json]',
  '',
  'Options:',
  '  --run-dir <path>   Live evidence bundle directory',
  '  --repo-root <path> Also bind commit, registry, prompt templates, and default system to this repository',
  '  --json             Print the full machine-readable verification report',
  '  --help             Show this help',
  '',
  'Verification checks directory closure, artifact byte counts and SHA-256 hashes,',
  'status-specific file layout, and cross-file manifest consistency.',
  '--repo-root additionally binds repository-controlled provenance to the selected checkout.',
  'It still does not prove that an external provider actually served the recorded calls.',
  '',
].join('\n');

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--run-dir' || arg === '--repo-root') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(arg + ' requires a value');
      }
      if (arg === '--run-dir') options.runDir = value;
      else options.repoRoot = value;
      index += 1;
      continue;
    }
    throw new Error('Unknown argument: ' + String(arg));
  }

  return options;
}

async function runCli(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!options.runDir) {
    throw new Error('--run-dir is required');
  }

  const report = await verifyLiveFictionBundle(options.runDir, {
    ...(options.repoRoot ? { repoRoot: options.repoRoot } : {}),
  });
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (report.ok) {
    process.stdout.write(
      'Live evidence bundle verified: ' +
        report.run_dir +
        ' (' +
        report.status +
        ')\n'
    );
  } else {
    process.stderr.write(
      'Live evidence verification failed: ' + report.run_dir + '\n'
    );
    for (const issue of report.errors) {
      process.stderr.write(
        '- [' +
          issue.code +
          '] ' +
          (issue.file ? issue.file + ': ' : '') +
          issue.message +
          '\n'
      );
    }
  }

  return report.ok ? 0 : 1;
}

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('LINYUAN evidence verifier failed: ' + message + '\n');
  process.exitCode = 1;
}
