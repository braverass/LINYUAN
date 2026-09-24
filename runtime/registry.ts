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

const RUNTIME_ROLES: readonly RuntimeRole[] = [
  'retriever',
  'orchestrator',
  'compiler',
  'generator',
  'validator',
  'patcher',
];

type JsonRecord = Record<string, unknown>;

function registryRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object');
  }
  return value as JsonRecord;
}

function registryString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(label + ' must be a non-empty string');
  }
  return value;
}

function assertRegistryKeys(
  value: JsonRecord,
  allowed: readonly string[],
  label: string
): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(label + ' contains unexpected field: ' + key);
    }
  }
}

export function validateRegistry(value: unknown): SourceRegistry {
  const root = registryRecord(value, 'SOURCE_REGISTRY');
  assertRegistryKeys(root, ['version', 'sources'], 'SOURCE_REGISTRY');
  if (root.version !== '0.5') {
    throw new Error('SOURCE_REGISTRY version must be 0.5');
  }

  const rawSources = registryRecord(root.sources, 'SOURCE_REGISTRY.sources');
  const sources: Record<string, RegistrySource> = {};

  for (const [semanticId, rawSource] of Object.entries(rawSources)) {
    registryString(semanticId, 'SOURCE_REGISTRY semantic ID');
    const label = 'SOURCE_REGISTRY.sources.' + semanticId;
    const source = registryRecord(rawSource, label);
    assertRegistryKeys(
      source,
      ['path', 'authority', 'content_role', 'instruction_capability', 'access'],
      label
    );

    if (typeof source.instruction_capability !== 'boolean') {
      throw new Error(label + '.instruction_capability must be boolean');
    }

    const rawAccess = registryRecord(source.access, label + '.access');
    assertRegistryKeys(rawAccess, RUNTIME_ROLES, label + '.access');
    const access = {} as Record<RuntimeRole, 'read' | 'deny'>;
    for (const role of RUNTIME_ROLES) {
      const permission = rawAccess[role];
      if (permission !== 'read' && permission !== 'deny') {
        throw new Error(
          label + '.access.' + role + ' must be read or deny'
        );
      }
      access[role] = permission;
    }

    sources[semanticId] = {
      path: registryString(source.path, label + '.path'),
      authority: registryString(source.authority, label + '.authority'),
      content_role: registryString(source.content_role, label + '.content_role'),
      instruction_capability: source.instruction_capability,
      access,
    };
  }

  return {
    version: '0.5',
    sources,
  };
}

export async function loadRegistry(
  registryPath = 'SOURCE_REGISTRY.yaml'
): Promise<SourceRegistry> {
  const raw = await readFile(registryPath, 'utf8');
  return validateRegistry(parse(raw) as unknown);
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
