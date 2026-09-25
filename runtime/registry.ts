import { access, readFile, realpath } from 'node:fs/promises';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(
  value: unknown,
  field: string,
  semanticId?: string
): string {
  if (typeof value !== 'string' || value.length === 0) {
    const prefix = semanticId ? semanticId + ': ' : '';
    throw new Error(prefix + field + ' must be a non-empty string');
  }
  return value;
}

function validateAccess(
  value: unknown,
  semanticId: string
): Record<RuntimeRole, 'read' | 'deny'> {
  if (!isRecord(value)) {
    throw new Error(semanticId + ': access must be an object');
  }

  const accessMap = {} as Record<RuntimeRole, 'read' | 'deny'>;
  for (const role of RUNTIME_ROLES) {
    const permission = value[role];
    if (permission !== 'read' && permission !== 'deny') {
      throw new Error(
        semanticId + ': access.' + role + ' must be "read" or "deny"'
      );
    }
    accessMap[role] = permission;
  }

  return accessMap;
}

function validateRegistrySource(
  value: unknown,
  semanticId: string
): RegistrySource {
  if (!isRecord(value)) {
    throw new Error(semanticId + ': source entry must be an object');
  }

  if (typeof value.instruction_capability !== 'boolean') {
    throw new Error(
      semanticId + ': instruction_capability must be a boolean'
    );
  }

  return {
    path: requireString(value.path, 'path', semanticId),
    authority: requireString(value.authority, 'authority', semanticId),
    content_role: requireString(value.content_role, 'content_role', semanticId),
    instruction_capability: value.instruction_capability,
    access: validateAccess(value.access, semanticId),
  };
}

function validateRegistry(value: unknown): SourceRegistry {
  if (!isRecord(value)) {
    throw new Error('Invalid SOURCE_REGISTRY root');
  }
  if (value.version !== '0.5') {
    throw new Error('Invalid SOURCE_REGISTRY version');
  }
  if (!isRecord(value.sources)) {
    throw new Error('Invalid SOURCE_REGISTRY sources map');
  }

  const sources = Object.create(null) as Record<string, RegistrySource>;
  for (const [semanticId, source] of Object.entries(value.sources)) {
    if (semanticId.length === 0) {
      throw new Error('SOURCE_REGISTRY contains an empty semantic ID');
    }
    sources[semanticId] = validateRegistrySource(source, semanticId);
  }

  return {
    version: '0.5',
    sources,
  };
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative))
  );
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

  if (source.access[role] !== 'read') {
    throw new Error(`${role} is denied access to ${semanticId}`);
  }

  return source;
}

export async function lintRegistry(
  registry: SourceRegistry,
  repoRoot = process.cwd()
): Promise<string[]> {
  const errors: string[] = [];
  const resolvedRoot = path.resolve(repoRoot);
  const realRoot = await realpath(resolvedRoot);

  for (const [semanticId, source] of Object.entries(registry.sources)) {
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

    const resolvedSource = path.resolve(resolvedRoot, source.path);
    if (!isWithinRoot(resolvedRoot, resolvedSource)) {
      errors.push(
        `${semanticId}: path escapes repository root: ${source.path}`
      );
      continue;
    }

    try {
      await access(resolvedSource);
      const realSource = await realpath(resolvedSource);
      if (!isWithinRoot(realRoot, realSource)) {
        errors.push(
          `${semanticId}: path resolves outside repository root: ${source.path}`
        );
      }
    } catch {
      errors.push(`${semanticId}: path does not exist: ${source.path}`);
    }
  }

  return errors;
}
