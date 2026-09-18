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
