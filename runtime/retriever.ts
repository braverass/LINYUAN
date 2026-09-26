import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { RawCanonFragment } from './compiler';
import {
  assertRoleAccess,
  loadRegistry,
  SourceRegistry,
  selectRegisteredContent,
} from './registry';
import { stableHash } from './trace';

export interface RetrieverOptions {
  repoRoot?: string;
  registry?: SourceRegistry;
}

export async function retrieveBySemanticIds(
  semanticIds: string[],
  options: RetrieverOptions = {}
): Promise<RawCanonFragment[]> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const registry = options.registry ?? (await loadRegistry(
    path.join(repoRoot, 'SOURCE_REGISTRY.yaml')
  ));

  const fragments: RawCanonFragment[] = [];

  for (const semanticId of [...new Set(semanticIds)]) {
    const source = assertRoleAccess(registry, semanticId, 'retriever');
    const physicalPath = path.resolve(repoRoot, source.path);
    const raw = await readFile(physicalPath, 'utf8');
    const content = selectRegisteredContent(raw, source);

    fragments.push({
      semanticId,
      content,
      hash: stableHash(content),
    });
  }

  return fragments;
}
