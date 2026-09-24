import test from 'node:test';
import assert from 'node:assert/strict';

import { compileWithAdapter } from '../compiler';
import { generateIsolated } from '../generator';
import { validateWithAdapter } from '../validator';
import type { ActiveContext } from '../types';

function activeContext(): ActiveContext {
  return {
    version: '0.5',
    facts: [],
    constraints: [],
    unknowns: [],
    inference_barriers: [],
    open_dimensions: {
      action_selection: true,
      dialogue_realization: true,
      pacing: true,
      nonverbal_behavior: true,
      emotional_expression: true,
    },
  };
}

test('Compiler rejects unsupported statuses and schema drift', async () => {
  const input = {
    request: 'fixture',
    sceneState: {},
    canonFragments: [],
  };

  await assert.rejects(
    () => compileWithAdapter(async () => ({ status: 'BANANA' } as any), input),
    /unsupported status/
  );

  await assert.rejects(
    () =>
      compileWithAdapter(
        async () =>
          ({
            status: 'READY',
            activeContext: {
              ...activeContext(),
              raw_extra_field: true,
            },
            provenance: {},
          } as any),
        input
      ),
    /unexpected field/
  );

  await assert.rejects(
    () =>
      compileWithAdapter(
        async () =>
          ({
            status: 'NEED_CONTEXT',
            missing: [{ type: 'knowledge', question: '' }],
          } as any),
        input
      ),
    /non-empty string/
  );
});

test('Generator rejects unsupported statuses and malformed payloads', async () => {
  const payload = {
    system: 'fixture',
    request: 'fixture',
    sceneState: {},
    activeContext: activeContext(),
  };

  await assert.rejects(
    () => generateIsolated(async () => ({ status: 'BANANA' } as any), payload),
    /unsupported status/
  );

  await assert.rejects(
    () =>
      generateIsolated(
        async () => ({ status: 'DRAFT', draft: 42 } as any),
        payload
      ),
    /string draft/
  );

  await assert.rejects(
    () =>
      generateIsolated(
        async () =>
          ({
            status: 'NEED_CONTEXT',
            missing: [{ type: '', question: 'missing' }],
          } as any),
        payload
      ),
    /non-empty string/
  );
});

test('Validator rejects violations outside the runtime schema', async () => {
  await assert.rejects(
    () =>
      validateWithAdapter(
        async () =>
          ([
            {
              id: 'V1',
              severity: 'fatal',
              location: {
                paragraph: 1,
                sentence_start: 1,
                sentence_end: 1,
              },
              actual: { semantic_claim: 'fixture' },
              required_state: {},
              patch_contract: {
                allowed_scope: { paragraph: 1, sentences: [1, 1] },
                preserve: [],
                required_change: ['fix'],
              },
            },
          ] as any),
        {
          draft: 'fixture',
          activeContext: activeContext(),
          evidence: { rawCanon: [], provenance: {} },
        }
      ),
    /severity must be hard or soft/
  );
});
