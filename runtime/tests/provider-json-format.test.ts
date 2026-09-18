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
