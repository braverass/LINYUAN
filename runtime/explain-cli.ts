import { readFile } from 'node:fs/promises';

import { runProductionExplain } from './explain';

interface CliOptions {
  request?: string;
  requestFile?: string;
  semanticIds: string[];
  evidence: boolean;
  json: boolean;
  help: boolean;
}

const HELP = [
  'LINYUAN explain runtime',
  '',
  'Usage:',
  '  npm run explain -- --request "<question>" [options]',
  '  npm run explain -- --request-file request.txt [options]',
  '',
  'Options:',
  '  --request <text>              Explanation request',
  '  --request-file <path>         Read request from a UTF-8 file',
  '  --semantic-id <id>            Bypass initial planner with an explicit semantic ID; repeatable',
  '  --evidence                    Include a user-facing evidence summary',
  '  --json                        Print machine-readable output',
  '  --help                        Show this help',
  '',
  'EXPLAIN uses a separate inference chain from FICTION.',
  'Default output does not expose retrieval internals or semantic source IDs.',
  '',
].join('\n');

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(flag + ' requires a value');
  }
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    semanticIds: [],
    evidence: false,
    json: false,
    help: false,
  };
  const valueFlags = new Set(['--request', '--request-file', '--semantic-id']);

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
    if (arg === '--evidence') {
      options.evidence = true;
      continue;
    }
    if (!arg || !valueFlags.has(arg)) {
      throw new Error('Unknown argument: ' + String(arg));
    }

    const value = valueAfter(args, index, arg);
    index += 1;
    if (arg === '--request') options.request = value;
    else if (arg === '--request-file') options.requestFile = value;
    else if (arg === '--semantic-id') options.semanticIds.push(value);
  }
  return options;
}

async function loadRequest(options: CliOptions): Promise<string> {
  const supplied =
    Number(options.request !== undefined) +
    Number(options.requestFile !== undefined);
  if (supplied !== 1) {
    throw new Error('Provide exactly one of --request or --request-file');
  }
  return options.request ?? readFile(options.requestFile as string, 'utf8');
}

async function runCli(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const input = {
    request: await loadRequest(options),
    includeEvidence: options.evidence,
  } as {
    request: string;
    includeEvidence: boolean;
    semanticIds?: string[];
  };
  if (options.semanticIds.length > 0) {
    input.semanticIds = [...options.semanticIds];
  }

  const run = await runProductionExplain(input);
  if (options.json) {
    process.stdout.write(JSON.stringify(run, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(run.answer + '\n');
  if (run.evidence_summary) {
    process.stdout.write('\n' + run.evidence_summary + '\n');
  }
  return 0;
}

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('LINYUAN explain failed: ' + message + '\n');
  process.exitCode = 1;
}
