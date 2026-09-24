import type {
  ModelClient,
  ModelResponse,
  ModelUsage,
} from './types';

function validateUsage(usage: ModelUsage | undefined): void {
  if (usage === undefined) return;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new Error('Model response usage must be an object when present');
  }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
    const value = usage[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0)
    ) {
      throw new Error(
        'Model response usage.' + key + ' must be a non-negative safe integer'
      );
    }
  }
}

export function validateModelResponse(
  client: ModelClient,
  response: ModelResponse
): void {
  if (!response || typeof response !== 'object') {
    throw new Error('Model client must return a response object');
  }
  if (response.provider !== client.provider) {
    throw new Error(
      'Model response provider does not match configured client provider'
    );
  }
  if (typeof response.model !== 'string' || response.model.trim().length === 0) {
    throw new Error('Model response model must be a non-empty string');
  }
  if (typeof response.text !== 'string') {
    throw new Error('Model response text must be a string');
  }
  if (
    typeof response.latencyMs !== 'number' ||
    !Number.isFinite(response.latencyMs) ||
    response.latencyMs < 0
  ) {
    throw new Error('Model response latencyMs must be a non-negative finite number');
  }
  for (const [label, value] of [
    ['requestId', response.requestId],
    ['responseId', response.responseId],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.trim().length === 0)
    ) {
      throw new Error('Model response ' + label + ' must be non-empty when present');
    }
  }
  validateUsage(response.usage);
}
