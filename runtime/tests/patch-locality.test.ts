import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNoEvidenceLeak,
  patchWithAdapter,
} from '../patcher';
import type { Violation } from '../types';
import { stripEvidenceForPatcher } from '../validator';

test('Patcher changes only declared paragraph/sentence scope', async () => {
  const draft =
    '第一段第一句。第一段第二句。\n\n' +
    '第二段第一句。第二段第二句。第二段第三句。\n\n' +
    '第三段第一句。';

  const violation: Violation = {
    id: 'V1',
    severity: 'hard',
    location: {
      paragraph: 2,
      sentence_start: 2,
      sentence_end: 2,
    },
    actual: {
      semantic_claim: 'A knows X with certainty',
    },
    required_state: {
      epistemic_status: 'unconfirmed',
    },
    patch_contract: {
      allowed_scope: {
        paragraph: 2,
        sentences: [2, 2],
      },
      preserve: ['POV', 'scene_goal', 'emotional_state'],
      required_change: [
        'certainty must become inference or uncertainty',
      ],
    },
    evidence_refs: ['KNOWLEDGE.X17'],
  };

  const patchVisible = stripEvidenceForPatcher(violation);
  assert.equal('evidence_refs' in patchVisible, false);

  const patched = await patchWithAdapter(
    async () => ({
      replacement: '第二段第二句现在只是推测。',
    }),
    draft,
    patchVisible
  );

  assert.equal(
    patched,
    '第一段第一句。第一段第二句。\n\n' +
      '第二段第一句。第二段第二句现在只是推测。第二段第三句。\n\n' +
      '第三段第一句。'
  );
  assert.ok(patched.startsWith('第一段第一句。第一段第二句。'));
  assert.ok(patched.endsWith('第三段第一句。'));
});

test('Patcher rejects evidence/provenance metadata', () => {
  assert.throws(
    () =>
      assertNoEvidenceLeak({
        violation: {
          evidence_refs: ['X'],
        },
      }),
    /PATCHER EVIDENCE LEAK/
  );
});
