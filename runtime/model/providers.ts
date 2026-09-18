import type {
  ModelClient,
  ModelDefaults,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelUsage,
} from './types';

export interface ProviderConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  defaults?: ModelDefaults;
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid numeric model setting: ' + value);
  }
  return parsed;
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizeProviderErrorDetail(
  message: string,
  headers: Record<string, string>
): string {
  const secrets = new Set<string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (
      /API_KEY|TOKEN|SECRET|PASSWORD/i.test(key) &&
      typeof value === 'string' &&
      value.length >= 4
    ) {
      secrets.add(value);
    }
  }
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|api-key/i.test(key) && value.length >= 4) {
      secrets.add(value);
      const bearer = /^Bearer\s+(.+)$/i.exec(value);
      if (bearer?.[1]) secrets.add(bearer[1]);
    }
  }

  let sanitized = message;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized.replace(
    /Bearer\s+[A-Za-z0-9._~+\/=:-]+/gi,
    'Bearer [REDACTED]'
  );
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<{ data: Record<string, unknown>; latencyMs: number; requestId?: string }> {
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  const requestId =
    response.headers.get('request-id') ??
    response.headers.get('x-request-id') ??
    undefined;
  if (!response.ok) {
    throw new Error(
      'Model API request failed (' +
        response.status +
        ' ' +
        response.statusText +
        ')' +
        (requestId ? ' [request-id ' + requestId + ']' : '') +
        ': ' +
        sanitizeProviderErrorDetail(responseText.slice(0, 1200), headers)
    );
  }
  return {
    data: JSON.parse(responseText) as Record<string, unknown>,
    latencyMs: Date.now() - started,
    ...(requestId ? { requestId } : {}),
  };
}

function requiredResponseString(
  data: Record<string, unknown>,
  key: string,
  provider: ModelProvider
): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      'Model API response from ' + provider + ' is missing required ' + key
    );
  }
  return value;
}

function usageObject(
  inputTokens: unknown,
  outputTokens: unknown,
  totalTokens: unknown
): ModelUsage | undefined {
  const usage: ModelUsage = {};
  if (typeof inputTokens === 'number') usage.inputTokens = inputTokens;
  if (typeof outputTokens === 'number') usage.outputTokens = outputTokens;
  if (typeof totalTokens === 'number') usage.totalTokens = totalTokens;
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function mergedDefaults(
  defaults: ModelDefaults,
  request: ModelRequest
): ModelDefaults {
  const merged: ModelDefaults = { ...defaults };
  if (request.temperature !== undefined) merged.temperature = request.temperature;
  if (request.topP !== undefined) merged.topP = request.topP;
  if (request.maxOutputTokens !== undefined) {
    merged.maxOutputTokens = request.maxOutputTokens;
  }
  if (request.seed !== undefined) merged.seed = request.seed;
  return merged;
}

function openAIText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string') return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  return parts.join('');
}

function createOpenAIClient(config: ProviderConfig): ModelClient {
  const defaults = config.defaults ?? {};
  const baseUrl = cleanBaseUrl(config.baseUrl ?? 'https://api.openai.com/v1');

  return {
    provider: 'openai',
    model: config.model,
    defaults,
    async complete(request): Promise<ModelResponse> {
      const settings = mergedDefaults(defaults, request);
      if (settings.seed !== undefined) {
        throw new Error(
          'OpenAI Responses adapter does not support seed; remove the seed setting'
        );
      }
      const body: Record<string, unknown> = {
        model: config.model,
        input: request.prompt,
        store: false,
      };
      if (request.system) body.instructions = request.system;
      if (request.responseFormat === 'json') {
        body.text = { format: { type: 'json_object' } };
      }
      if (settings.maxOutputTokens !== undefined) {
        body.max_output_tokens = settings.maxOutputTokens;
      }
      if (settings.temperature !== undefined) {
        body.temperature = settings.temperature;
      }
      if (settings.topP !== undefined) body.top_p = settings.topP;

      const { data, latencyMs, requestId } = await postJson(
        baseUrl + '/responses',
        {
          Authorization: 'Bearer ' + config.apiKey,
          'Content-Type': 'application/json',
        },
        body
      );

      const rawUsage =
        data.usage && typeof data.usage === 'object'
          ? (data.usage as Record<string, unknown>)
          : {};
      const usage = usageObject(
        rawUsage.input_tokens,
        rawUsage.output_tokens,
        rawUsage.total_tokens
      );
      const result: ModelResponse = {
        provider: 'openai',
        model: requiredResponseString(data, 'model', 'openai'),
        text: openAIText(data),
        latencyMs,
      };
      if (requestId) result.requestId = requestId;
      if (typeof data.id === 'string') result.responseId = data.id;
      if (usage) result.usage = usage;
      return result;
    },
  };
}

function createGeminiClient(config: ProviderConfig): ModelClient {
  const defaults = config.defaults ?? {};
  const baseUrl = cleanBaseUrl(
    config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
  );

  return {
    provider: 'gemini',
    model: config.model,
    defaults,
    async complete(request): Promise<ModelResponse> {
      const settings = mergedDefaults(defaults, request);
      const generationConfig: Record<string, unknown> = {};
      if (settings.maxOutputTokens !== undefined) {
        generationConfig.maxOutputTokens = settings.maxOutputTokens;
      }
      if (settings.temperature !== undefined) {
        generationConfig.temperature = settings.temperature;
      }
      if (settings.topP !== undefined) generationConfig.topP = settings.topP;
      if (settings.seed !== undefined) generationConfig.seed = settings.seed;
      if (request.responseFormat === 'json') {
        generationConfig.responseMimeType = 'application/json';
      }

      const body: Record<string, unknown> = {
        contents: [
          {
            role: 'user',
            parts: [{ text: request.prompt }],
          },
        ],
      };
      if (request.system) {
        body.system_instruction = { parts: [{ text: request.system }] };
      }
      if (Object.keys(generationConfig).length > 0) {
        body.generationConfig = generationConfig;
      }

      const { data, latencyMs, requestId } = await postJson(
        baseUrl +
          '/models/' +
          encodeURIComponent(config.model) +
          ':generateContent',
        {
          'x-goog-api-key': config.apiKey,
          'Content-Type': 'application/json',
        },
        body
      );

      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const first =
        candidates[0] && typeof candidates[0] === 'object'
          ? (candidates[0] as Record<string, unknown>)
          : {};
      const candidateContent =
        first.content && typeof first.content === 'object'
          ? (first.content as Record<string, unknown>)
          : {};
      const parts = Array.isArray(candidateContent.parts)
        ? candidateContent.parts
        : [];
      const text = parts
        .map((part) =>
          part && typeof part === 'object'
            ? (part as Record<string, unknown>).text
            : undefined
        )
        .filter((value): value is string => typeof value === 'string')
        .join('');

      const rawUsage =
        data.usageMetadata && typeof data.usageMetadata === 'object'
          ? (data.usageMetadata as Record<string, unknown>)
          : {};
      const usage = usageObject(
        rawUsage.promptTokenCount,
        rawUsage.candidatesTokenCount,
        rawUsage.totalTokenCount
      );
      const result: ModelResponse = {
        provider: 'gemini',
        model: requiredResponseString(data, 'modelVersion', 'gemini'),
        text,
        latencyMs,
      };
      if (requestId) result.requestId = requestId;
      if (typeof data.responseId === 'string') result.responseId = data.responseId;
      if (usage) result.usage = usage;
      return result;
    },
  };
}

function createAnthropicClient(config: ProviderConfig): ModelClient {
  const defaults = config.defaults ?? {};
  const baseUrl = cleanBaseUrl(config.baseUrl ?? 'https://api.anthropic.com');

  return {
    provider: 'anthropic',
    model: config.model,
    defaults,
    async complete(request): Promise<ModelResponse> {
      const settings = mergedDefaults(defaults, request);
      if (settings.seed !== undefined) {
        throw new Error(
          'Anthropic Messages adapter does not support seed; remove the seed setting'
        );
      }
      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: settings.maxOutputTokens ?? 4096,
        messages: [{ role: 'user', content: request.prompt }],
      };
      if (request.system) body.system = request.system;
      if (settings.temperature !== undefined) body.temperature = settings.temperature;
      if (settings.topP !== undefined) body.top_p = settings.topP;

      const { data, latencyMs, requestId } = await postJson(
        baseUrl + '/v1/messages',
        {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body
      );

      const blocks = Array.isArray(data.content) ? data.content : [];
      const text = blocks
        .map((part) =>
          part && typeof part === 'object'
            ? (part as Record<string, unknown>).text
            : undefined
        )
        .filter((value): value is string => typeof value === 'string')
        .join('');

      const rawUsage =
        data.usage && typeof data.usage === 'object'
          ? (data.usage as Record<string, unknown>)
          : {};
      const inputTokens = rawUsage.input_tokens;
      const outputTokens = rawUsage.output_tokens;
      const totalTokens =
        typeof inputTokens === 'number' && typeof outputTokens === 'number'
          ? inputTokens + outputTokens
          : undefined;
      const usage = usageObject(inputTokens, outputTokens, totalTokens);
      const result: ModelResponse = {
        provider: 'anthropic',
        model: requiredResponseString(data, 'model', 'anthropic'),
        text,
        latencyMs,
      };
      if (requestId) result.requestId = requestId;
      if (typeof data.id === 'string') result.responseId = data.id;
      if (usage) result.usage = usage;
      return result;
    },
  };
}

export function createModelClient(config: ProviderConfig): ModelClient {
  if (config.provider === 'openai') return createOpenAIClient(config);
  if (config.provider === 'gemini') return createGeminiClient(config);
  return createAnthropicClient(config);
}

function providerKey(provider: ModelProvider): string | undefined {
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.ANTHROPIC_API_KEY;
}

export function createModelClientFromEnv(stage: string): ModelClient {
  const prefix = 'LINYUAN_' + stage.toUpperCase() + '_';
  const providerRaw =
    process.env[prefix + 'PROVIDER'] ?? process.env.LINYUAN_MODEL_PROVIDER;
  const model =
    process.env[prefix + 'MODEL'] ?? process.env.LINYUAN_MODEL_ID;

  if (
    providerRaw !== 'openai' &&
    providerRaw !== 'gemini' &&
    providerRaw !== 'anthropic'
  ) {
    throw new Error(
      prefix +
        'PROVIDER or LINYUAN_MODEL_PROVIDER must be openai, gemini, or anthropic'
    );
  }
  if (!model) {
    throw new Error(prefix + 'MODEL or LINYUAN_MODEL_ID is required');
  }

  const apiKey =
    process.env[prefix + 'API_KEY'] ??
    process.env.LINYUAN_MODEL_API_KEY ??
    providerKey(providerRaw);
  if (!apiKey) {
    throw new Error('No API key configured for provider ' + providerRaw);
  }

  const defaults: ModelDefaults = {};
  const temperature = numberFromEnv(
    process.env[prefix + 'TEMPERATURE'] ?? process.env.LINYUAN_MODEL_TEMPERATURE
  );
  const topP = numberFromEnv(
    process.env[prefix + 'TOP_P'] ?? process.env.LINYUAN_MODEL_TOP_P
  );
  const maxOutputTokens = numberFromEnv(
    process.env[prefix + 'MAX_OUTPUT_TOKENS'] ??
      process.env.LINYUAN_MODEL_MAX_OUTPUT_TOKENS
  );
  const seed = numberFromEnv(
    process.env[prefix + 'SEED'] ?? process.env.LINYUAN_MODEL_SEED
  );
  if (temperature !== undefined) defaults.temperature = temperature;
  if (topP !== undefined) defaults.topP = topP;
  if (maxOutputTokens !== undefined) defaults.maxOutputTokens = maxOutputTokens;
  if (seed !== undefined) defaults.seed = seed;

  const baseUrl =
    process.env[prefix + 'BASE_URL'] ?? process.env.LINYUAN_MODEL_BASE_URL;
  const config: ProviderConfig = {
    provider: providerRaw,
    model,
    apiKey,
    defaults,
  };
  if (baseUrl) config.baseUrl = baseUrl;
  return createModelClient(config);
}
