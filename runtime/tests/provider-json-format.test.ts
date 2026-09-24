import test from 'node:test';
import assert from 'node:assert/strict';

import { createModelClient } from '../model/providers';

test('OpenAI Responses requests JSON mode for structured runtime stages', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies: Record<string, unknown>[] = [];

  globalThis.fetch = async (_input, init) => {
    capturedBodies.push(
      JSON.parse(String(init?.body)) as Record<string, unknown>
    );
    return new Response(
      JSON.stringify({
        id: 'resp_fixture',
        model: 'fixture-model',
        output_text: '{}',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };

  try {
    const client = createModelClient({
      provider: 'openai',
      model: 'fixture-model',
      apiKey: 'fixture-key',
      baseUrl: 'https://example.invalid/v1',
    });

    await client.complete({
      stage: 'compiler',
      prompt: '{}',
      responseFormat: 'json',
    });

    const capturedBody = capturedBodies[0];
    assert.ok(capturedBody);
    assert.deepEqual(capturedBody.text, {
      format: { type: 'json_object' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('provider evidence separates transport request IDs from response object IDs', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes('openai.invalid')) {
      return new Response(
        JSON.stringify({
          id: 'resp_openai_fixture',
          model: 'openai-fixture-model',
          output_text: '{}',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req_openai_fixture',
          },
        }
      );
    }

    if (url.includes('gemini.invalid')) {
      return new Response(
        JSON.stringify({
          responseId: 'resp_gemini_fixture',
          modelVersion: 'gemini-fixture-model',
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.includes('anthropic.invalid')) {
      return new Response(
        JSON.stringify({
          id: 'msg_anthropic_fixture',
          model: 'anthropic-fixture-model',
          content: [{ type: 'text', text: '{}' }],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'request-id': 'req_anthropic_fixture',
          },
        }
      );
    }

    throw new Error('Unexpected fixture URL: ' + url);
  };

  try {
    const openai = createModelClient({
      provider: 'openai',
      model: 'openai-fixture-model',
      apiKey: 'fixture-key',
      baseUrl: 'https://openai.invalid/v1',
    });
    const gemini = createModelClient({
      provider: 'gemini',
      model: 'gemini-fixture-model',
      apiKey: 'fixture-key',
      baseUrl: 'https://gemini.invalid/v1beta',
    });
    const anthropic = createModelClient({
      provider: 'anthropic',
      model: 'anthropic-fixture-model',
      apiKey: 'fixture-key',
      baseUrl: 'https://anthropic.invalid',
    });

    const request = {
      stage: 'compiler' as const,
      prompt: '{}',
      responseFormat: 'json' as const,
    };

    const openaiResponse = await openai.complete(request);
    assert.equal(openaiResponse.requestId, 'req_openai_fixture');
    assert.equal(openaiResponse.responseId, 'resp_openai_fixture');

    const geminiResponse = await gemini.complete(request);
    assert.equal(geminiResponse.requestId, undefined);
    assert.equal(geminiResponse.responseId, 'resp_gemini_fixture');

    const anthropicResponse = await anthropic.complete(request);
    assert.equal(anthropicResponse.requestId, 'req_anthropic_fixture');
    assert.equal(anthropicResponse.responseId, 'msg_anthropic_fixture');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('provider HTTP contracts preserve request format, exact model identity, usage, and IDs', async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    captured.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });

    if (url.includes('openai.invalid')) {
      return new Response(
        JSON.stringify({
          id: 'resp_openai',
          model: 'openai-returned-model',
          output_text: '{"ok":"openai"}',
          usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req_openai',
          },
        }
      );
    }
    if (url.includes('gemini.invalid')) {
      return new Response(
        JSON.stringify({
          responseId: 'resp_gemini',
          modelVersion: 'gemini-returned-model',
          candidates: [{ content: { parts: [{ text: '{"ok":"gemini"}' }] } }],
          usageMetadata: {
            promptTokenCount: 13,
            candidatesTokenCount: 5,
            totalTokenCount: 18,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req_gemini',
          },
        }
      );
    }
    if (url.includes('anthropic.invalid')) {
      return new Response(
        JSON.stringify({
          id: 'msg_anthropic',
          model: 'anthropic-returned-model',
          content: [{ type: 'text', text: '{"ok":"anthropic"}' }],
          usage: { input_tokens: 17, output_tokens: 3 },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'request-id': 'req_anthropic',
          },
        }
      );
    }
    throw new Error('Unexpected URL: ' + url);
  };

  try {
    const openai = createModelClient({
      provider: 'openai',
      model: 'openai-configured-model',
      apiKey: 'openai-key',
      baseUrl: 'https://openai.invalid/v1',
      defaults: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 123,
      },
    });
    const gemini = createModelClient({
      provider: 'gemini',
      model: 'gemini/configured:model',
      apiKey: 'gemini-key',
      baseUrl: 'https://gemini.invalid/v1beta',
      defaults: {
        temperature: 0.3,
        topP: 0.7,
        maxOutputTokens: 234,
        seed: 42,
      },
    });
    const anthropic = createModelClient({
      provider: 'anthropic',
      model: 'anthropic-configured-model',
      apiKey: 'anthropic-key',
      baseUrl: 'https://anthropic.invalid',
      defaults: {
        temperature: 0.4,
        topP: 0.6,
        maxOutputTokens: 345,
      },
    });

    const baseRequest = {
      stage: 'compiler' as const,
      system: 'system text',
      prompt: 'prompt text',
      responseFormat: 'json' as const,
    };
    const openaiResponse = await openai.complete(baseRequest);
    const geminiResponse = await gemini.complete(baseRequest);
    const anthropicResponse = await anthropic.complete(baseRequest);

    const [openaiCall, geminiCall, anthropicCall] = captured;
    assert.ok(openaiCall);
    assert.equal(openaiCall.url, 'https://openai.invalid/v1/responses');
    assert.equal(openaiCall.headers.get('authorization'), 'Bearer openai-key');
    assert.deepEqual(openaiCall.body, {
      model: 'openai-configured-model',
      input: 'prompt text',
      store: false,
      instructions: 'system text',
      text: { format: { type: 'json_object' } },
      max_output_tokens: 123,
      temperature: 0.2,
      top_p: 0.8,
    });
    assert.equal(openaiResponse.text, '{"ok":"openai"}');
    assert.equal(openaiResponse.model, 'openai-returned-model');
    assert.equal(openaiResponse.requestId, 'req_openai');
    assert.equal(openaiResponse.responseId, 'resp_openai');
    assert.deepEqual(openaiResponse.usage, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });

    assert.ok(geminiCall);
    assert.equal(
      geminiCall.url,
      'https://gemini.invalid/v1beta/models/gemini%2Fconfigured%3Amodel:generateContent'
    );
    assert.equal(geminiCall.headers.get('x-goog-api-key'), 'gemini-key');
    assert.deepEqual(geminiCall.body, {
      contents: [{ role: 'user', parts: [{ text: 'prompt text' }] }],
      system_instruction: { parts: [{ text: 'system text' }] },
      generationConfig: {
        maxOutputTokens: 234,
        temperature: 0.3,
        topP: 0.7,
        seed: 42,
        responseMimeType: 'application/json',
      },
    });
    assert.equal(geminiResponse.text, '{"ok":"gemini"}');
    assert.equal(geminiResponse.model, 'gemini-returned-model');
    assert.equal(geminiResponse.requestId, 'req_gemini');
    assert.equal(geminiResponse.responseId, 'resp_gemini');
    assert.deepEqual(geminiResponse.usage, {
      inputTokens: 13,
      outputTokens: 5,
      totalTokens: 18,
    });

    assert.ok(anthropicCall);
    assert.equal(anthropicCall.url, 'https://anthropic.invalid/v1/messages');
    assert.equal(anthropicCall.headers.get('x-api-key'), 'anthropic-key');
    assert.equal(anthropicCall.headers.get('authorization'), null);
    assert.equal(anthropicCall.headers.get('anthropic-version'), '2023-06-01');
    assert.deepEqual(anthropicCall.body, {
      model: 'anthropic-configured-model',
      max_tokens: 345,
      messages: [{ role: 'user', content: 'prompt text' }],
      system: 'system text',
      temperature: 0.4,
      top_p: 0.6,
    });
    assert.equal(anthropicResponse.text, '{"ok":"anthropic"}');
    assert.equal(anthropicResponse.model, 'anthropic-returned-model');
    assert.equal(anthropicResponse.requestId, 'req_anthropic');
    assert.equal(anthropicResponse.responseId, 'msg_anthropic');
    assert.deepEqual(anthropicResponse.usage, {
      inputTokens: 17,
      outputTokens: 3,
      totalTokens: 20,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider HTTP errors preserve status/request id, redact secrets, and successful responses require returned model identity', async () => {
  const originalFetch = globalThis.fetch;
  const envSecret = 'provider-env-secret-5555';
  const apiKey = 'provider-api-key-1234';
  const bearer = 'provider-bearer-secret';
  const previous = process.env.LINYUAN_PROVIDER_TEST_SECRET;
  process.env.LINYUAN_PROVIDER_TEST_SECRET = envSecret;

  try {
    globalThis.fetch = async () =>
      new Response(
        'provider exploded ' +
          envSecret +
          ' ' +
          apiKey +
          ' Bearer ' +
          bearer,
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'x-request-id': 'req_http_error' },
        }
      );

    const openai = createModelClient({
      provider: 'openai',
      model: 'configured',
      apiKey,
      baseUrl: 'https://openai.invalid/v1',
    });

    let httpError: unknown;
    try {
      await openai.complete({
        stage: 'compiler',
        prompt: '{}',
        responseFormat: 'json',
      });
    } catch (error) {
      httpError = error;
    }
    assert.ok(httpError instanceof Error);
    assert.match(httpError.message, /429 Too Many Requests/);
    assert.match(httpError.message, /req_http_error/);
    assert.match(httpError.message, /provider exploded/);
    assert.equal(httpError.message.includes(envSecret), false);
    assert.equal(httpError.message.includes(apiKey), false);
    assert.equal(httpError.message.includes(bearer), false);
    assert.equal(httpError.message.includes('[REDACTED]'), true);

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ id: 'resp_without_model', output_text: '{}' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    await assert.rejects(
      () =>
        openai.complete({
          stage: 'compiler',
          prompt: '{}',
          responseFormat: 'json',
        }),
      /missing required model/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.LINYUAN_PROVIDER_TEST_SECRET;
    else process.env.LINYUAN_PROVIDER_TEST_SECRET = previous;
  }
});

test('unsupported seed settings are rejected rather than recorded as if applied', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be reached');
  };

  try {
    for (const provider of ['openai', 'anthropic'] as const) {
      const client = createModelClient({
        provider,
        model: 'fixture',
        apiKey: 'key',
        baseUrl: 'https://example.invalid',
        defaults: { seed: 42 },
      });
      await assert.rejects(
        () =>
          client.complete({
            stage: 'compiler',
            prompt: '{}',
            responseFormat: 'json',
          }),
        /does not support seed/
      );
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('model settings reject invalid token limits and non-integer seeds before fetch', async () => {
  assert.throws(
    () =>
      createModelClient({
        provider: 'openai',
        model: 'fixture',
        apiKey: 'key',
        defaults: { maxOutputTokens: 0 },
      }),
    /maxOutputTokens must be a positive safe integer/
  );

  assert.throws(
    () =>
      createModelClient({
        provider: 'gemini',
        model: 'fixture',
        apiKey: 'key',
        defaults: { seed: 1.5 },
      }),
    /seed must be a safe integer/
  );

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be reached');
  };

  try {
    const client = createModelClient({
      provider: 'openai',
      model: 'fixture',
      apiKey: 'key',
      baseUrl: 'https://example.invalid/v1',
    });

    await assert.rejects(
      () =>
        client.complete({
          stage: 'compiler',
          prompt: '{}',
          responseFormat: 'json',
          maxOutputTokens: -1,
        }),
      /maxOutputTokens must be a positive safe integer/
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('provider clients record endpoint provenance without exposing the endpoint URL', () => {
  const customUrl = 'https://proxy.example.invalid/v1?token=secret-value';
  const custom = createModelClient({
    provider: 'openai',
    model: 'fixture',
    apiKey: 'key',
    baseUrl: customUrl,
  });

  assert.equal(custom.endpoint_kind, 'custom');
  assert.equal(typeof custom.endpoint_hash, 'string');
  assert.equal(custom.endpoint_hash?.length, 64);
  assert.equal(custom.endpoint_hash?.includes('proxy.example.invalid'), false);
  assert.equal(custom.endpoint_hash?.includes('secret-value'), false);

  const official = createModelClient({
    provider: 'openai',
    model: 'fixture',
    apiKey: 'key',
  });
  assert.equal(official.endpoint_kind, 'official');
  assert.equal(official.endpoint_hash?.length, 64);
  assert.notEqual(custom.endpoint_hash, official.endpoint_hash);
});
