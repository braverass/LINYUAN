export type ModelProvider = 'openai' | 'gemini' | 'anthropic';

export type ModelStage =
  | 'retrieval_planner'
  | 'compiler'
  | 'generator'
  | 'validator'
  | 'patcher'
  | 'explain'
  | 'eval_judge';

export interface ModelDefaults {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  seed?: number;
}

export interface ModelRequest {
  stage: ModelStage;
  system?: string;
  prompt: string;
  responseFormat: 'text' | 'json';
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  seed?: number;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelResponse {
  provider: ModelProvider;
  model: string;
  text: string;
  latencyMs: number;
  requestId?: string;
  responseId?: string;
  usage?: ModelUsage;
}

export interface ModelClient {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly defaults: ModelDefaults;
  readonly endpoint_kind?: 'official' | 'custom';
  readonly endpoint_hash?: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelCallRecord {
  stage: ModelStage;
  provider: ModelProvider;
  model: string;
  requested_model?: string;
  request_hash: string;
  response_hash: string;
  response_format: 'text' | 'json';
  latency_ms: number;
  request_id: string | null;
  response_id: string | null;
  usage: ModelUsage | null;
  settings: {
    temperature: number | null;
    top_p: number | null;
    max_output_tokens: number | null;
    seed: number | null;
  };
}
