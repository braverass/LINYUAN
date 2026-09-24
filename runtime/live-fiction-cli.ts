import { readFile } from 'node:fs/promises';

import {
  LiveFictionBundleError,
  runLiveFictionBundle,
} from './live-fiction';

interface CliOptions {
  request?: string;
  requestFile?: string;
  scene?: string;
  sceneFile?: string;
  runDir?: string;
  semanticIds: string[];
  maxContextRounds?: number;
  json: boolean;
  help: boolean;
}

const HELP = [
  'LINYUAN live fiction E2E',
  '',
  'Usage:',
  '  npm run fiction:live -- --request "<fiction request>" [options]',
  '  npm run fiction:live -- --request-file request.txt [options]',
  '',
  'Options:',
  '  --request <text>              Fiction request text',
  '  --request-file <path>         Read fiction request from a UTF-8 file',
  '  --scene <json>                Scene-state JSON object',
  '  --scene-file <path>           Read scene-state JSON object from a file',
  '  --semantic-id <id>            Explicit initial Canon semantic ID; repeatable',
  '  --max-context-rounds <n>      Maximum retrieval/compile rounds, default 3',
  '  --run-dir <path>              Evidence bundle directory',
  '  --json                        Print machine-readable bundle summary',
  '  --help                        Show this help',
  '',
  'The bundle records input, trace, call metadata, result/output, artifact hashes,',
  'commit provenance, model descriptors, retrieved Canon hashes, and safe failure',
  'diagnostics. API keys are never written to the bundle.',
  '',
  'Model configuration is identical to npm run fiction.',
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
    json: false,
    help: false,
  };
  const valueFlags = new Set([
    '--request',
    '--request-file',
    '--scene',
    '--scene-file',
    '--run-dir',
    '--semantic-id',
    '--max-context-rounds',
  ]);

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
    if (!arg || !valueFlags.has(arg)) {
      throw new Error('Unknown argument: ' + String(arg));
    }

    const value = valueAfter(args, index, arg);
    index += 1;

    if (arg === '--request') options.request = value;
    else if (arg === '--request-file') options.requestFile = value;
    else if (arg === '--scene') options.scene = value;
    else if (arg === '--scene-file') options.sceneFile = value;
    else if (arg === '--run-dir') options.runDir = value;
    else if (arg === '--semantic-id') options.semanticIds.push(value);
    else if (arg === '--max-context-rounds') {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error('--max-context-rounds must be a positive integer');
      }
      options.maxContextRounds = parsed;
    }
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
  if (options.request !== undefined) return options.request;
  return readFile(options.requestFile as string, 'utf8');
}

function parseSceneObject(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scene state must be a JSON object');
  }
  return value as Record<string, unknown>;
}

async function loadScene(options: CliOptions): Promise<Record<string, unknown>> {
  const supplied =
    Number(options.scene !== undefined) +
    Number(options.sceneFile !== undefined);
  if (supplied > 1) {
    throw new Error('Provide at most one of --scene or --scene-file');
  }
  if (options.scene !== undefined) return parseSceneObject(options.scene);
  if (options.sceneFile !== undefined) {
    return parseSceneObject(await readFile(options.sceneFile, 'utf8'));
  }
  return {};
}

function defaultRunDir(): string {
  return (
    'runs/live/' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-local'
  );
}

async function runCli(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const input = {
    request: await loadRequest(options),
    sceneState: await loadScene(options),
  } as {
    request: string;
    sceneState: Record<string, unknown>;
    semanticIds?: string[];
    maxContextRounds?: number;
  };

  if (options.semanticIds.length > 0) {
    input.semanticIds = [...options.semanticIds];
  }
  if (options.maxContextRounds !== undefined) {
    input.maxContextRounds = options.maxContextRounds;
  }

  const run = await runLiveFictionBundle(input, {
    runDir: options.runDir ?? defaultRunDir(),
  });

  const summary = {
    run_dir: run.runDir,
    status: run.result.status,
    manifest: run.manifest,
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write(
      'Live fiction ' +
        run.result.status +
        '. Evidence bundle: ' +
        run.runDir +
        '\n'
    );
  }

  if (run.result.status === 'OUTPUT') return 0;
  if (run.result.status === 'NEED_CONTEXT') return 2;
  return 3;
}

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  if (error instanceof LiveFictionBundleError) {
    process.stderr.write(error.message + '\n');
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('LINYUAN live fiction failed: ' + message + '\n');
  }
  process.exitCode = 1;
}
