import { createHash } from 'node:crypto';
import type { MissingContext, PatchScope, Provenance } from './types';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function stableHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export interface RunTrace {
  version: '0.5';
  run_id: string;
  retrieval: Array<{
    semantic_id: string;
    content_hash: string;
  }>;
  compiler: {
    active_context_hashes: string[];
    provenance: Provenance[];
  };
  generator: {
    call_count: number;
    payload_hashes: string[];
    need_context: MissingContext[][];
  };
  validator: {
    violations: Array<{
      id: string;
      severity: string;
      evidence_refs: string[];
    }>;
  };
  patcher: {
    scopes: PatchScope[];
  };
}

export function newRunTrace(runId: string): RunTrace {
  return {
    version: '0.5',
    run_id: runId,
    retrieval: [],
    compiler: {
      active_context_hashes: [],
      provenance: [],
    },
    generator: {
      call_count: 0,
      payload_hashes: [],
      need_context: [],
    },
    validator: {
      violations: [],
    },
    patcher: {
      scopes: [],
    },
  };
}
