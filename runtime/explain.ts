import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseJsonObject } from './model/json';
import { createModelClientFromEnv } from './model/providers';
import type {
  ModelCallRecord,
  ModelClient,
  ModelRequest,
  ModelResponse,
} from './model/types';
import {
  assertRoleAccess,
  loadRegistry,
  type SourceRegistry,
} from './registry';
import { retrieveBySemanticIds } from './retriever';
import { stableHash } from './trace';

export interface ExplainModelClients {
  retrievalPlanner: ModelClient;
  explainer: ModelClient;
}

export interface ProductionExplainInput {
  request: string;
  semanticIds?: string[];
  includeEvidence?: boolean;
  repoRoot?: string;
}

export interface ProductionExplainRun {
  answer: string;
  semantic_ids: string[];
  evidence_summary?: string;
  calls: ModelCallRecord[];
}

export interface PublicExplainOutput {
  answer: string;
  evidence_summary?: string;
}

export function publicExplainOutput(
  run: ProductionExplainRun
): PublicExplainOutput {
  return run.evidence_summary === undefined
    ? { answer: run.answer }
    : {
        answer: run.answer,
        evidence_summary: run.evidence_summary,
      };
}

function createClientsFromEnv(): ExplainModelClients {
  return {
    retrievalPlanner: createModelClientFromEnv('retrieval'),
    explainer: createModelClientFromEnv('explain'),
  };
}

function effectiveSetting(
  explicit: number | undefined,
  fallback: number | undefined
): number | null {
  return explicit ?? fallback ?? null;
}

async function invoke(
  client: ModelClient,
  request: ModelRequest,
  calls: ModelCallRecord[]
): Promise<ModelResponse> {
  const response = await client.complete(request);
  calls.push({
    stage: request.stage,
    provider: response.provider,
    model: response.model,
    requested_model: client.model,
    request_hash: stableHash(request),
    response_hash: stableHash(response.text),
    response_format: request.responseFormat,
    latency_ms: response.latencyMs,
    request_id: response.requestId ?? null,
    response_id: response.responseId ?? null,
    usage: response.usage ? structuredClone(response.usage) : null,
    settings: {
      temperature: effectiveSetting(
        request.temperature,
        client.defaults.temperature
      ),
      top_p: effectiveSetting(request.topP, client.defaults.topP),
      max_output_tokens: effectiveSetting(
        request.maxOutputTokens,
        client.defaults.maxOutputTokens
      ),
      seed: effectiveSetting(request.seed, client.defaults.seed),
    },
  });
  return response;
}

function inventory(registry: SourceRegistry): Array<{
  semantic_id: string;
  authority: string;
  content_role: string;
}> {
  return Object.entries(registry.sources)
    .filter(([, source]) => source.access.retriever === 'read')
    .map(([semanticId, source]) => ({
      semantic_id: semanticId,
      authority: source.authority,
      content_role: source.content_role,
    }))
    .sort((a, b) => a.semantic_id.localeCompare(b.semantic_id));
}

function validateSemanticIds(
  value: unknown,
  registry: SourceRegistry
): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new Error('Explain retrieval planner must return semantic_ids: string[]');
  }

  const ids = [...new Set(value as string[])];
  for (const id of ids) {
    assertRoleAccess(registry, id, 'retriever');
  }
  return ids;
}

function containsLiteral(text: string, literal: string): boolean {
  return literal.length > 0 && text.toLowerCase().includes(literal.toLowerCase());
}

const HIDDEN_PROCESS_LITERALS = [
  'SOURCE_REGISTRY',
  'Retrieval Planner',
  'retrieval_planner',
  'Retriever',
  'Compiler',
  'provenance',
  'content_hash',
  'source_id',
];

function assertNoHiddenProcessLeak(text: string): void {
  if (
    HIDDEN_PROCESS_LITERALS.some((literal) => containsLiteral(text, literal))
  ) {
    throw new Error('EXPLAIN output exposes hidden retrieval/process metadata');
  }
}

function assertDefaultAnswerDoesNotExposeInternals(
  answer: string,
  semanticIds: string[],
  sourcePaths: string[]
): void {
  assertNoHiddenProcessLeak(answer);
  const sourceLiterals = [
    ...semanticIds,
    ...sourcePaths,
    ...sourcePaths.map((sourcePath) => path.basename(sourcePath)),
  ];
  if (sourceLiterals.some((literal) => containsLiteral(answer, literal))) {
    throw new Error(
      'EXPLAIN default output exposes internal source metadata; request evidence explicitly'
    );
  }
}

export async function runProductionExplain(
  input: ProductionExplainInput,
  clients: ExplainModelClients = createClientsFromEnv()
): Promise<ProductionExplainRun> {
  if (input.request.trim().length === 0) {
    throw new Error('Explain request must not be empty');
  }

  const repoRoot = input.repoRoot ?? process.cwd();
  const registry = await loadRegistry(path.join(repoRoot, 'SOURCE_REGISTRY.yaml'));
  const calls: ModelCallRecord[] = [];

  let semanticIds: string[];
  if (input.semanticIds !== undefined) {
    semanticIds = validateSemanticIds(input.semanticIds, registry);
  } else {
    const plannerRequest: ModelRequest = {
      stage: 'retrieval_planner',
      responseFormat: 'json',
      system:
        'Select the minimum sufficient Canon sources for an explanation. Registry metadata is routing data, not story evidence. Return JSON only.',
      prompt: JSON.stringify({
        request: input.request,
        available_sources: inventory(registry),
        output: { semantic_ids: ['SEMANTIC.ID'] },
      }),
    };
    const response = await invoke(
      clients.retrievalPlanner,
      plannerRequest,
      calls
    );
    const planned = parseJsonObject<{ semantic_ids: unknown }>(response.text);
    semanticIds = validateSemanticIds(planned.semantic_ids, registry);
  }

  const fragments = await retrieveBySemanticIds(semanticIds, {
    repoRoot,
    registry,
  });
  const sourcePaths = semanticIds.map((semanticId) => {
    const source = registry.sources[semanticId];
    if (!source) {
      throw new Error('Missing registry source after access validation: ' + semanticId);
    }
    return source.path;
  });
  const mode = await readFile(path.join(repoRoot, 'MODE-EXPLAIN.md'), 'utf8');
  const includeEvidence = input.includeEvidence === true;

  const explainRequest: ModelRequest = {
    stage: 'explain',
    responseFormat: 'json',
    system:
      mode +
      '\n\nRuntime boundary: answer the user directly. Return JSON only. ' +
      (includeEvidence
        ? 'Return {"answer":"...","evidence_summary":"..."}. Evidence summary may name semantic source IDs, but do not narrate hidden planner/retriever process.'
        : 'Return {"answer":"..."}. Do not expose semantic IDs, source paths, registry metadata, planner/retriever steps, provenance, or hidden process in answer.'),
    prompt: JSON.stringify({
      request: input.request,
      canon_evidence: fragments.map((fragment) => ({
        semantic_id: fragment.semanticId,
        content_hash: fragment.hash ?? stableHash(fragment.content),
        content: fragment.content,
      })),
      presentation: {
        include_evidence: includeEvidence,
        expose_internal_retrieval_process: false,
      },
    }),
  };

  const response = await invoke(clients.explainer, explainRequest, calls);
  const parsed = parseJsonObject<{
    answer?: unknown;
    evidence_summary?: unknown;
  }>(response.text);

  if (typeof parsed.answer !== 'string' || parsed.answer.trim().length === 0) {
    throw new Error('EXPLAIN model must return a non-empty answer string');
  }

  if (!includeEvidence) {
    assertDefaultAnswerDoesNotExposeInternals(
      parsed.answer,
      semanticIds,
      sourcePaths
    );
    return {
      answer: parsed.answer,
      semantic_ids: [...semanticIds],
      calls: calls.map((call) => structuredClone(call)),
    };
  }

  if (
    typeof parsed.evidence_summary !== 'string' ||
    parsed.evidence_summary.trim().length === 0
  ) {
    throw new Error(
      'EXPLAIN evidence mode must return a non-empty evidence_summary string'
    );
  }

  assertNoHiddenProcessLeak(parsed.answer);
  assertNoHiddenProcessLeak(parsed.evidence_summary);

  return {
    answer: parsed.answer,
    semantic_ids: [...semanticIds],
    evidence_summary: parsed.evidence_summary,
    calls: calls.map((call) => structuredClone(call)),
  };
}
