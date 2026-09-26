import { access, readFile } from 'node:fs/promises';
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
  section_heading?: string;
  subsection_headings?: string[];
  authority: string;
  content_role: string;
  routing_hint?: string;
  instruction_capability: boolean;
  access: Record<RuntimeRole, 'read' | 'deny'>;
}

export function selectRegistrySection(content: string, heading: string): string {
  const prefix = heading.match(/^(.*-)\d{2}[a-z]?-/)?.[1];
  if (!prefix) {
    throw new Error(`Invalid section heading: ${heading}`);
  }
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `## ${heading}`);
  if (start < 0 || lines.findIndex((line, index) =>
    index > start && line.trimEnd() === `## ${heading}`) >= 0) {
    throw new Error(`section heading not found or duplicated: ${heading}`);
  }
  const sibling = new RegExp(`^## ${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{2}[a-z]?-`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (sibling.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd() + '\n';
}

export function selectRegisteredContent(content: string, source: RegistrySource): string {
  if (!source.section_heading) {
    if (source.subsection_headings?.length) {
      throw new Error('subsection_headings requires section_heading');
    }
    return content;
  }
  const chapter = selectRegistrySection(content, source.section_heading);
  if (!source.subsection_headings?.length) return chapter;
  const lines = chapter.split('\n');
  const selected: string[] = [`## ${source.section_heading}`];
  for (const heading of source.subsection_headings) {
    const start = lines.findIndex((line, index) =>
      index > 0 && line.trimEnd() === `## ${heading}`);
    if (start < 0 || lines.findIndex((line, index) =>
      index > start && line.trimEnd() === `## ${heading}`) >= 0) {
      throw new Error(`subsection heading not found or duplicated: ${heading}`);
    }
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if ((lines[index] ?? '').startsWith('## ')) {
        end = index;
        break;
      }
    }
    selected.push(lines.slice(start, end).join('\n').trimEnd());
  }
  return selected.join('\n\n') + '\n';
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

    if (source.access?.retriever === 'read' && !source.routing_hint?.trim()) {
      errors.push(`${semanticId}: retrievable source must define routing_hint`);
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
      const physicalPath = path.resolve(repoRoot, source.path);
      await access(physicalPath);
      if (source.section_heading || source.subsection_headings) {
        try {
          selectRegisteredContent(await readFile(physicalPath, 'utf8'), source);
        } catch (error) {
          errors.push(`${semanticId}: ${(error as Error).message}`);
        }
      }
    } catch {
      errors.push(`${semanticId}: path does not exist: ${source.path}`);
    }
  }

  return errors;
}
