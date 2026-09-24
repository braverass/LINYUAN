import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

export type RuntimeRole =
  | 'retriever'
  | 'orchestrator'
  | 'compiler'
  | 'generator'
  | 'validator'
  | 'patcher';

export interface RegistrySource {
  path: string;
  authority: string;
  content_role: string;
  instruction_capability: boolean;
  access: Record<RuntimeRole, 'read' | 'deny'>;
}

export interface SourceRegistry {
  version: '0.5';
  sources: Record<string, RegistrySource>;
}

export async function loadRegistry(
  registryPath = 'SOURCE_REGISTRY.yaml'
): Promise<SourceRegistry> {
  const raw = await readFile(registryPath, 'utf8');
  const parsed = parse(raw) as SourceRegistry;

  if (parsed.version !== '0.5' || !parsed.sources) {
    throw new Error('Invalid SOURCE_REGISTRY version or shape');
  }

  return parsed;
}

export function assertRoleAccess(
  registry: SourceRegistry,
  semanticId: string,
  role: RuntimeRole
): RegistrySource {
  const source = registry.sources[semanticId];
  if (!source) {
    throw new Error(`Unknown semantic source: ${semanticId}`);
  }

  if (source.access?.[role] !== 'read') {
    throw new Error(`${role} is denied access to ${semanticId}`);
  }

  return source;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}

export async function resolveRegisteredSourcePath(
  repoRoot: string,
  sourcePath: string
): Promise<string> {
  if (!sourcePath || path.isAbsolute(sourcePath)) {
    throw new Error('registered source path must be a relative repository path');
  }

  const root = await realpath(repoRoot);
  const lexicalTarget = path.resolve(root, sourcePath);
  if (!isWithinRoot(root, lexicalTarget)) {
    throw new Error('registered source path escapes repository root');
  }

  const resolvedTarget = await realpath(lexicalTarget);
  if (!isWithinRoot(root, resolvedTarget)) {
    throw new Error('registered source path resolves outside repository root');
  }

  const metadata = await stat(resolvedTarget);
  if (!metadata.isFile()) {
    throw new Error('registered source path must resolve to a regular file');
  }

  return resolvedTarget;
}

export async function lintRegistry(
  registry: SourceRegistry,
  repoRoot = process.cwd()
): Promise<string[]> {
  const errors: string[] = [];

  for (const [semanticId, source] of Object.entries(registry.sources)) {
    if (!source.path) {
      errors.push(`${semanticId}: missing physical path`);
      continue;
    }

    if (source.instruction_capability !== false) {
      errors.push(
        `${semanticId}: Canon/data sources must set instruction_capability=false`
      );
    }

    if (source.access.generator !== 'deny') {
      errors.push(`${semanticId}: Generator must be denied raw source access`);
    }

    if (source.access.patcher !== 'deny') {
      errors.push(`${semanticId}: Patcher must be denied raw source access`);
    }

    try {
      await resolveRegisteredSourcePath(repoRoot, source.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${semanticId}: invalid physical path ${source.path}: ${message}`);
    }
  }

  return errors;
}
