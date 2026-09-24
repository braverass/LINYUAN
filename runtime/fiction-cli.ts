import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runProductionFiction } from './production-fiction';

interface CliOptions {
  request?: string;
  requestFile?: string;
  scene?: string;
  sceneFile?: string;
  output?: string;
  traceOutput?: string;
  callsOutput?: string;
  semanticIds: string[];
  maxContextRounds?: number;
  json: boolean;
  help: boolean;
}

const HELP = `LINYUAN fiction runtime

Usage:
  npm run fiction -- --request "<fiction request>" [options]
  npm run fiction -- --request-file request.txt [options]

Options:
  --request <text>              Fiction request text
  --request-file <path>         Read fiction request from a UTF-8 file
  --scene <json>                Scene-state JSON object
  --scene-file <path>           Read scene-state JSON object from a file
  --semantic-id <id>            Bypass initial planner with an explicit semantic ID; repeatable
  --max-context-rounds <n>      Maximum retrieval/compile rounds, default 3
  --output <path>               Write final fiction text to a file
  --trace-output <path>         Write runtime trace JSON
  --calls-output <path>         Write model-call metadata JSON
  --json                        Print machine-readable result + call metadata
  --help                        Show this help

Model configuration:
  LINYUAN_MODEL_PROVIDER=openai|gemini|anthropic
  LINYUAN_MODEL_ID=<exact-model-id>
  OPENAI_API_KEY=... | GEMINI_API_KEY=... | ANTHROPIC_API_KEY=...

Per-stage overrides use LINYUAN_RETRIEVAL_*, LINYUAN_COMPILER_*,
LINYUAN_GENERATOR_*, LINYUAN_VALIDATOR_* and LINYUAN_PATCHER_*.
`;

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

    const valueFlags = new Set([
      '--request',
      '--request-file',
      '--scene',
      '--scene-file',
      '--semantic-id',
      '--max-context-rounds',
      '--output',
      '--trace-output',
      '--calls-output',
    ]);
    if (!arg || !valueFlags.has(arg)) {
      throw new Error('Unknown argument: ' + String(arg));
    }

    const value = valueAfter(args, index, arg);
    index += 1;

    if (arg === '--request') options.request = value;
    else if (arg === '--request-file') options.requestFile = value;
    else if (arg === '--scene') options.scene = value;
    else if (arg === '--scene-file') options.sceneFile = value;
    else if (arg === '--semantic-id') options.semanticIds.push(value);
    else if (arg === '--output') options.output = value;
    else if (arg === '--trace-output') options.traceOutput = value;
    else if (arg === '--calls-output') options.callsOutput = value;
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
  const supplied = Number(options.request !== undefined) +
    Number(options.requestFile !== undefined);
  if (supplied !== 1) {
    throw new Error('Provide exactly one of --request or --request-file');
  }
  return options.request ?? readFile(options.requestFile as string, 'utf8');
}

function parseSceneObject(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scene state must be a JSON object');
  }
  return value as Record<string, unknown>;
}

async function loadScene(options: CliOptions): Promise<Record<string, unknown>> {
  const supplied = Number(options.scene !== undefined) +
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

async function writeArtifact(filePath: string, content: string): Promise<void> {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf8');
}

async function runCli(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const request = await loadRequest(options);
  const sceneState = await loadScene(options);
  const input = {
    request,
    sceneState,
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

  const run = await runProductionFiction(input);

  if (options.traceOutput) {
    await writeArtifact(
      options.traceOutput,
      JSON.stringify(run.result.trace, null, 2) + '\n'
    );
  }
  if (options.callsOutput) {
    await writeArtifact(
      options.callsOutput,
      JSON.stringify(run.calls, null, 2) + '\n'
    );
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(run, null, 2) + '\n');
  }

  if (run.result.status === 'OUTPUT') {
    if (options.output) {
      await writeArtifact(options.output, run.result.output + '\n');
      if (!options.json) {
        process.stdout.write('Wrote fiction output to ' + options.output + '\n');
      }
    } else if (!options.json) {
      process.stdout.write(run.result.output + '\n');
    }
    return 0;
  }

  if (!options.json) {
    process.stderr.write(JSON.stringify(run.result, null, 2) + '\n');
  }
  return run.result.status === 'NEED_CONTEXT' ? 2 : 3;
}

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('LINYUAN fiction failed: ' + message + '\n');
  process.exitCode = 1;
}
